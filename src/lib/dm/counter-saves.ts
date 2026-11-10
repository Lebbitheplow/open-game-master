// A counter whose use makes creatures save (Breath Weapon, Drake's Breath,
// Infectious Fury, Words of Terror, the Artillerist's cannon...) is rolled in
// the spend itself: each creature named saves against the feature's DC, the
// dice are rolled once, the damage and the condition land. Before this the
// spend paid the use and the action and handed the numbers back for an
// aoe_damage call: the AI GM could make it, and at a table a person runs the
// Hand's card stopped after the spend with the creature untouched.
//
// Everything that resolves such a save goes through resolveCounterSave: the
// generic counters' "enemy_save" and "aoe" effects (resource-tools.ts
// computeUseResource) and the authored spends' "aoe_report"
// (authored-spend-effects.ts). It refuses before it rolls, so a refusal
// spends nothing.
//
// Must not import mutations.ts.
import type { Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { layEnemyConditionInstance } from "@/lib/dm/enemy-condition-lay";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { immuneToCondition } from "@/lib/dm/damage-logic";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { swallowCoverBetween } from "@/lib/dm/swallow";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { creatureTypeOf } from "@/lib/bestiary/creature-type";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

export type SaveAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type CounterSave = {
  // The feature's name, as the dice cards and the lines read.
  name: string;
  save: SaveAbility;
  dc: number;
  dice?: string | null;
  type?: string;
  // Half the damage on a success ("half on a success"); otherwise none.
  half?: boolean;
  condition?: string;
  rounds?: number;
  // A spell or another magical effect (Magic Resistance answers it).
  magical?: boolean;
  // How far from the holder a creature may stand, and whether it must be
  // one they can see.
  rangeFt?: number;
  sight?: boolean;
  // The creature types it takes ("humanoid" for Words of Terror).
  types?: string[];
  // The most creatures one use takes (Enthralling Performance: the bard's
  // Charisma modifier).
  most?: number;
};

export type CounterSaveAim = { turnId?: string; targetEnemyId?: string; targetEnemyIds?: string[] };

export type CounterSaveResult = { result: Record<string, unknown> } | ToolError;

// The creatures the call names, in order, each once.
function namedRefs(aim: CounterSaveAim): string[] {
  const refs = [...(aim.targetEnemyIds ?? []), ...(aim.targetEnemyId ? [aim.targetEnemyId] : [])].map((ref) => ref.trim()).filter(Boolean);
  return [...new Set(refs)];
}

// Whether a fight (or a scene with creatures on the board) is on to roll in.
export function counterSaveTable(campaign: Campaign) {
  return getActiveEncounter(campaign.id);
}

export function resolveCounterSave(campaign: Campaign, sheet: CharacterSheet, spec: CounterSave, aim: CounterSaveAim): CounterSaveResult {
  const encounter = getActiveEncounter(campaign.id);
  // The feature's numbers, said whatever happens next, so the story and the
  // card read the same dice and DC the creatures roll against.
  const numbers = { ...(spec.dice ? { damage: spec.dice } : {}), saveAbility: spec.save, dc: spec.dc, ...(spec.type ? { type: spec.type } : {}), ...(spec.condition ? { condition: spec.condition } : {}) };
  // No creature is on the board to save: the use is paid and the GM tells it
  // in the story (as a save area does with no fight on, authored-spend-effects.ts).
  if (!encounter) {
    return { result: { ...numbers, applied: [`${spec.name}: there is no fight, so no creature on the board saves; the GM resolves it in the story on the creature the player names.`] } };
  }
  const refs = namedRefs(aim);
  if (!refs.length) {
    return {
      error: `${spec.name} makes the creatures it catches save: pass targetEnemyId, or targetEnemyIds for every creature in its area. Nothing was spent.`,
      retry: true,
    };
  }
  const found: EncounterEnemy[] = [];
  for (const ref of refs) {
    const enemy = resolveTargetFoe(campaign.id, encounter, ref);
    if (!enemy || enemy.status !== "alive") {
      return { error: `${spec.name} needs living creatures in the fight: "${ref}" is none. Pass ids from GAME STATE. Nothing was spent.`, retry: true };
    }
    // Asked of every creature before a die is rolled.
    if (swallowCoverBetween(sheet.id, enemy.id)) {
      return { error: `${enemy.displayName} is on the other side of a swallower's wall from ${sheet.name}; ${spec.name} does not reach it. Nothing was spent.`, refused: "rules" };
    }
    if (spec.rangeFt && !withinFeet(encounter.id, sheet.id, enemy.id, spec.rangeFt)) {
      return { error: `${enemy.displayName} is beyond ${spec.rangeFt} feet of ${sheet.name}; ${spec.name} reaches no further. Nothing was spent.`, refused: "rules" };
    }
    const unseen = spec.sight ? unseenBecause(encounter.id, sheet, enemy) : null;
    if (unseen) {
      return { error: `${sheet.name} cannot see ${enemy.displayName} (${unseen}), and ${spec.name} takes a creature they can see. Nothing was spent.`, refused: "rules" };
    }
    if (spec.types && !spec.types.includes(creatureTypeOf(enemy.stats))) {
      return { error: `${enemy.displayName} is not ${spec.types.join(" or ")} (${creatureTypeOf(enemy.stats)}); ${spec.name} takes one. Nothing was spent.`, refused: "rules" };
    }
    found.push(enemy);
  }
  if (spec.most && found.length > spec.most) {
    return { error: `${spec.name} takes at most ${spec.most} creature${spec.most === 1 ? "" : "s"} for ${sheet.name}; ${found.length} were named. Nothing was spent.`, retry: true };
  }
  const turn = aim.turnId ? getDmTurn(aim.turnId) : null;
  // One roll of the dice for every creature caught, as an area spell rolls.
  const rolled = spec.dice ? rollCard(campaign, turn, sheet.id, "damage", spec.name, spec.dice, sheetAttacker(sheet)).total : 0;
  const lines: string[] = [];
  const saves: Array<{ target: string; save: number; dc: number; saved: boolean }> = [];
  for (const enemy of found) {
    const save = rollEnemySave(campaign.id, enemy, spec.save, spec.dc, {
      ...(spec.magical ? { magical: true } : {}),
      resist: Boolean(spec.condition) && bindsWorthResisting([spec.condition ?? ""]),
      against: spec.condition,
      origin: { ref: sheet.id },
      record: { turn: turn ?? undefined, detail: `${enemy.displayName}: ${spec.save.toUpperCase()} save against ${spec.name}` },
    });
    saves.push({ target: enemy.displayName, save: save.total ?? 0, dc: spec.dc, saved: save.success });
    const amount = spec.dice ? (save.success ? (spec.half ? Math.floor(rolled / 2) : 0) : rolled) : 0;
    const parts: string[] = [];
    if (amount > 0) {
      const live = getActiveEncounter(campaign.id) ?? encounter;
      const fresh = getEnemy(enemy.id) ?? enemy;
      if (turn) {
        const sheets = listSheets(campaign.id);
        applyEnemyDamage(campaign, turn, live, fresh, amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), spec.type, { magical: Boolean(spec.magical) });
      } else {
        hurtEnemy(campaign, live, fresh, amount, spec.type ?? "", spec.name, !spec.magical);
      }
      parts.push(`takes ${amount}${spec.type ? ` ${spec.type}` : ""} damage`);
    }
    if (!save.success && spec.condition) {
      const fresh = getEnemy(enemy.id) ?? enemy;
      if (immuneToCondition(fresh, spec.condition)) {
        parts.push(`cannot be ${spec.condition}`);
      } else {
        layEnemyConditionInstance(campaign, fresh, spec.condition, { source: sheet.id, ...(spec.rounds ? { rounds: spec.rounds } : {}) });
        parts.push(`is ${spec.condition}`);
      }
    }
    const verdict = save.legendaryResistance ? "with Legendary Resistance" : `(${spec.save.toUpperCase()} ${save.total} vs DC ${spec.dc})`;
    lines.push(`${enemy.displayName} ${save.success ? "saves" : "fails"} ${verdict}${parts.length ? `: ${parts.join(", and ")}` : ""}.`);
  }
  publishEncounter(campaign.id);
  return { result: { ...numbers, ...(spec.dice ? { rolled: `${spec.dice}: ${rolled}` } : {}), saves, applied: lines } };
}

const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

// Extra damage a counter adds to a weapon hit of this turn (Fury of the
// Small), on the creature the hit landed on: refused with no such hit, or on a
// creature no larger than the holder when the feature asks for one.
export function resolveCounterHit(
  campaign: Campaign,
  sheet: CharacterSheet,
  spec: { name: string; dice: string; type?: string; larger?: boolean; holderSize?: string },
  aim: CounterSaveAim,
): CounterSaveResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || (encounter.kind ?? "fight") !== "fight") {
    return { error: `${spec.name} rides a weapon hit in a fight, and there is no fight. Nothing was spent.`, refused: "rules" };
  }
  const ref = aim.targetEnemyId?.trim() ?? encounter.targets?.pairs[sheet.id]?.at(-1);
  const enemy = ref ? resolveTargetFoe(campaign.id, encounter, ref) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${spec.name} lands on the creature ${sheet.name} hit: pass its targetEnemyId. Nothing was spent.`, retry: true };
  }
  const marks = encounter.turnBudget?.ownerId === sheet.id ? encounter.turnBudget.oncePerTurn : [];
  if (!marks.includes(`weapon-hit:${enemy.id}`)) {
    return { error: `${spec.name} follows ${sheet.name}'s weapon hit on ${enemy.displayName} this turn, and they have landed none on it. Nothing was spent.`, refused: "rules" };
  }
  if (spec.larger) {
    const theirs = SIZES.indexOf(textKey(String(enemy.stats.size ?? "medium")));
    const mine = SIZES.indexOf(textKey(spec.holderSize ?? "small"));
    if (theirs <= mine) {
      return { error: `${spec.name} works on a creature larger than ${sheet.name}, and ${enemy.displayName} is not. Nothing was spent.`, refused: "rules" };
    }
  }
  const turn = aim.turnId ? getDmTurn(aim.turnId) : null;
  const amount = rollCard(campaign, turn, sheet.id, "damage", spec.name, spec.dice, sheetAttacker(sheet)).total;
  const live = getActiveEncounter(campaign.id) ?? encounter;
  if (turn) {
    const sheets = listSheets(campaign.id);
    applyEnemyDamage(campaign, turn, live, enemy, amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), spec.type);
  } else {
    hurtEnemy(campaign, live, enemy, amount, spec.type ?? "", spec.name, true);
  }
  publishEncounter(campaign.id);
  return { result: { target: enemy.displayName, damage: amount, applied: [`${enemy.displayName} takes ${amount} more damage from ${spec.name}.`] } };
}
