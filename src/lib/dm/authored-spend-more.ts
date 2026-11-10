// The authored spends the final round added (src/lib/dm/authored-spend-effects.ts
// resolves the rest):
//
//   - Gathered Swarm's push: after the ranger hits a creature, the swarm moves
//     it up to 15 feet on a failed STR save against the ranger's spell save
//     DC, in place of the swarm's damage that turn: the damage rides the hit
//     by default (the rider), and the push takes its die back off. With
//     Mighty Swarm the moved creature is also knocked prone.
//   - The reroll of the last failed save (Fanatical Focus, as Indomitable
//     does): a success lifts what that failure laid on them.

import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { getActiveEncounter, getEnemy, patchEnemyConditions, patchEnemyHp } from "@/lib/db/encounters";
import { listRecentRolls } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { computeSheetDerived } from "@/lib/srd";
import { swarmKnocksProne } from "@/lib/srd/authored-effects-more";
import { resolveFormula } from "@/lib/srd/authored-effects";
import { WEAPON_HIT } from "@/lib/dm/action-budget";
import type { Ability, SpendDoes } from "@/lib/srd/authored-effects-types";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollFeatureSave } from "@/lib/dm/contest-roll";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { pushTokenAway } from "@/lib/dm/map-tools";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { swallowCoverError } from "@/lib/dm/swallow";
import { swarmCarry } from "@/lib/dm/authored-spend-divine-rng";
import { textKey } from "@/lib/language/text-logic";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

export function swarmPush(ctx: SpendContext, does: Extract<SpendDoes, { kind: "swarm_push" }>): Resolution {
  // "or move you 5 feet without provoking": the variant "move" carries the
  // ranger instead (src/lib/dm/authored-spend-divine-rng.ts swarmCarry).
  if (textKey(ctx.args.variant ?? "") === "move") {
    return swarmCarry(ctx);
  }
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} moves a creature in a fight; there is no fight. Nothing was spent.`, refused: "rules" };
  }
  // The creature the ranger hit: the one named, else the last they attacked
  // this round.
  const pairs = encounter.targets?.round === encounter.round ? encounter.targets.pairs[ctx.sheet.id] : undefined;
  const ref = ctx.args.targetEnemyId ?? pairs?.[pairs.length - 1];
  const enemy = ref ? resolveTargetFoe(encounter.campaignId, encounter, ref) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name} moves the creature ${ctx.sheet.name} just hit: pass its targetEnemyId. Nothing was spent.`, retry: true };
  }
  // Not across a swallower's wall (swallow.ts).
  const walled = swallowCoverError(ctx.sheet.id, enemy.id);
  if (walled) {
    return walled;
  }
  // "a hit lets your swarm ...": a hit on this creature this turn, not an
  // attack. Asked only of the attack before, it took a miss and was refused
  // after every hit, the damage's once-a-turn key being held.
  const marks = ctx.marks ?? (encounter.turnBudget?.ownerId === ctx.sheet.id ? encounter.turnBudget.oncePerTurn : []);
  if (!marks.includes(`${WEAPON_HIT}${enemy.id}`)) {
    return { error: `${ctx.spend.name} follows ${ctx.sheet.name}'s weapon hit on ${enemy.displayName} this turn, and they have landed none on it. Nothing was spent.`, refused: "rules" };
  }
  // The swarm acts once a turn: its damage rode the turn's first weapon hit
  // (src/lib/dm/pc-attack-damage.ts claims "rider:gathered swarm" there), so a
  // push is in its place only on that creature, and its die comes back off.
  const first = marks.find((mark) => mark.startsWith(WEAPON_HIT));
  if (first && first !== `${WEAPON_HIT}${enemy.id}`) {
    const other = resolveTargetFoe(encounter.campaignId, encounter, first.slice(WEAPON_HIT.length));
    return { error: `${ctx.sheet.name}'s swarm already dealt its damage to ${other?.displayName ?? "another creature"} this turn, and it acts once a turn. Nothing was spent.`, refused: "rules" };
  }
  const refund = swarmDieBack(ctx, enemy);
  const derived = computeSheetDerived(ctx.sheet);
  const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.wis;
  const save = rollEnemySave(ctx.campaign.id, enemy, "str", dc, {
    magical: true,
    record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: STR save against ${ctx.spend.name}` },
  });
  const back = refund ? giveBack(ctx, enemy.id, refund) : [];
  if (save.success) {
    return { result: { target: enemy.displayName, save: save.total, dc, applied: [`${enemy.displayName} holds its ground against the swarm.`, ...back] } };
  }
  const steps = Math.max(1, Math.floor(does.feet / 5));
  let moved = 0;
  let stopped = "";
  for (let step = 0; step < steps; step += 1) {
    const pushed = pushTokenAway(ctx.campaign, encounter.id, ctx.sheet.id, enemy.id);
    if (!pushed.moved) {
      stopped = pushed.reason;
      break;
    }
    moved += 1;
  }
  const lines = [`The swarm moves ${enemy.displayName} ${moved * 5} feet${stopped && moved < steps ? ` (${stopped})` : ""}.`];
  const prone = swarmKnocksProne(ctx.sheet);
  const fresh = getEnemy(enemy.id);
  if (prone && fresh && !fresh.conditions.some((entry) => entry.toLowerCase() === "prone")) {
    patchEnemyConditions(fresh.id, [...fresh.conditions, "prone"], {
      ...(fresh.conditionMeta as ConditionMetaMap),
      prone: { source: ctx.sheet.id },
    } as typeof fresh.conditionMeta);
    lines.push(`${prone}: ${enemy.displayName} is knocked prone.`);
  }
  publishEncounter(ctx.campaign.id);
  return { result: { target: enemy.displayName, save: save.total, dc, applied: [...lines, ...back] } };
}

// The swarm's die on the hit it rode: the last die of its size on the
// holder's latest damage roll against the creature (the rider is added after
// the weapon's dice, src/lib/dm/pc-attack-damage.ts). Zero when the roll is
// not on record.
export function swarmDieBack(ctx: SpendContext, enemy: { id: string }): number {
  const rider = (ctx.held.entry.effects ?? []).find((effect) => effect.kind === "rider");
  const dice = rider && "dice" in rider && rider.dice ? resolveFormula(rider.dice, ctx.held.level) : "1d6";
  const sides = Number(/d(\d+)/.exec(dice)?.[1] ?? 6);
  const roll = listRecentRolls(ctx.campaign.id, 40)
    .filter((entry) => entry.kind === "damage" && entry.characterId === ctx.sheet.id && entry.targetEnemyId === enemy.id)
    .at(-1);
  const dieTerms = (roll?.breakdown?.terms ?? []).flatMap((term) => (term.kind === "dice" ? [term] : []));
  // The roll's first dice are the weapon's, so a lone die of the swarm's size
  // there is no swarm die: the swarm's, when it rode, is a term after it.
  const term = dieTerms.slice(1).filter((entry) => entry.sides === sides).at(-1);
  return term ? Math.max(0, term.subtotal) : 0;
}

// The swarm's damage taken back, as the push replaces it.
export function giveBack(ctx: SpendContext, enemyId: string, amount: number): string[] {
  const fresh = getEnemy(enemyId);
  if (!fresh || fresh.status !== "alive" || amount <= 0) {
    return [];
  }
  const hp = Math.min(fresh.maxHp, fresh.currentHp + amount);
  patchEnemyHp(fresh.id, hp, "alive");
  return [`The swarm moves it in place of its damage: the ${amount} the swarm dealt on the hit is taken back.`];
}

// The save the character last failed, rolled again; a success lifts what
// that failure laid on them (Fanatical Focus, as Indomitable does).
export function rerollLastSave(ctx: SpendContext): ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> } {
  const { campaign, sheet } = ctx;
  const failed = listRecentRolls(campaign.id, 60).find(
    (roll) => roll.characterId === sheet.id && roll.kind === "saving_throw" && roll.dc !== null && roll.total < roll.dc,
  );
  const ability = failed ? ((/\b(str|dex|con|int|wis|cha)\b/i.exec(failed.detail)?.[1] ?? "").toLowerCase() as Ability | "") : "";
  if (!failed || !ability) {
    return { error: `${sheet.name} has no failed saving throw to reroll; ${ctx.spend.name} was not spent.`, refused: "rules" };
  }
  const dc = failed.dc!;
  const against = /\bvs\.? (.+)$/i.exec(failed.detail)?.[1];
  const save = rollFeatureSave(campaign, sheet, ability, dc, `${ctx.spend.name} reroll`, against);
  if (!save.success) {
    return { result: { reroll: `The reroll fails too (${ability.toUpperCase()} ${save.total ?? "failed"} vs DC ${dc}); the failure stands.` } };
  }
  const now = getSheetById(sheet.id) ?? sheet;
  const meta = now.conditionMeta as ConditionMetaMap;
  const lifted = now.conditions.filter((name) => {
    const ends = meta[name]?.saveEnds;
    return ends && ends.ability === ability && ends.dc === dc;
  });
  const cleared = removeConditions(now.conditions, now.conditionMeta, lifted);
  return {
    patch: lifted.length ? { conditions: cleared.conditions, conditionMeta: cleared.meta } : {},
    result: { reroll: `The reroll succeeds (${ability.toUpperCase()} ${save.total} vs DC ${dc})${lifted.length ? `: ${lifted.join(", ")} no longer holds them` : ""}.` },
  };
}
