// The divine package's authored spends that read the table rather than
// change it (src/lib/srd/authored-effects-w2-divine.ts rows), resolved from
// src/lib/dm/authored-spend-effects.ts resolveSpendEffect like every
// authored spend: a refusal returns before anything is paid.
import { getActiveEncounter } from "@/lib/db/encounters";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { swallowCoverError } from "@/lib/dm/swallow";
import type { ToolError } from "@/lib/dm/tool-errors";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import { flameUnder, quenchFlame } from "@/lib/dm/cauterizing-flames";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";
import { resolveFormula } from "@/lib/srd/authored-effects";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { choiceIn, isConditionNamed } from "@/lib/srd/feature-names";
import { publishPersisted } from "@/lib/events";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { rollOwnDice } from "@/lib/dm/character-roll";
import { attacksAllowedFor, budgetFor } from "@/lib/dm/turn-budget";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { DIVINE_SMITE_LANDED } from "@/lib/dm/divine-marks";

type Resolution = ToolError | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

// Every kind this module resolves comes through here, so the shared
// resolver carries one case per kind and no rules of its own.
export function divineSpend(ctx: SpendContext, does: Extract<SpendDoes, { kind: "reveal_defenses" | "smite_temp_hp" | "forge_blessing" | "cauterizing" }>): Resolution {
  switch (does.kind) {
    case "reveal_defenses":
      return revealDefenses(ctx);
    case "smite_temp_hp":
      return smiteTempHp(ctx, does);
    case "forge_blessing":
      return forgeBlessing(ctx, does);
    case "cauterizing":
      return cauterizing(ctx, does);
  }
}

// Cauterizing Flames: the creature named must stand in one of the druid's
// spectral flames, and the druid must see it; the flame goes out with the
// heal or the burn (src/lib/dm/cauterizing-flames.ts says how the flames are laid).
function cauterizing(ctx: SpendContext, does: Extract<SpendDoes, { kind: "cauterizing" }>): Resolution {
  const { campaign, sheet } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} answers a creature entering a spectral flame, which happens in a fight; there is no fight. Nothing was spent.`, refused: "rules" };
  }
  const ref = (does.mode === "heal" ? ctx.args.targetCharacterId : ctx.args.targetEnemyId)?.trim();
  if (!ref) {
    return { error: `${ctx.spend.name} ${does.mode === "heal" ? "heals" : "burns"} the creature that entered the flame: pass ${does.mode === "heal" ? "targetCharacterId" : "targetEnemyId"}. Nothing was spent.`, retry: true };
  }
  const creature = does.mode === "heal" ? getSheetById(ref) : resolveTargetFoe(encounter.campaignId, encounter, ref);
  if (!creature || ("status" in creature ? creature.status !== "alive" : creature.deathSaves?.dead)) {
    return { error: `${ctx.spend.name} needs a living creature in the fight: pass ${does.mode === "heal" ? "targetCharacterId" : "targetEnemyId"} from GAME STATE. Nothing was spent.`, retry: true };
  }
  const name = "displayName" in creature ? creature.displayName : creature.name;
  const flame = flameUnder(campaign.id, sheet, creature.id);
  if (!flame) {
    return { error: `${name} stands in none of ${sheet.name}'s spectral flames: Cauterizing Flames answers a creature entering the space of one, laid where a Small or larger creature died within 30 feet of them. Nothing was spent.`, refused: "rules" };
  }
  if (creature.id !== sheet.id) {
    const unseen = unseenBecause(encounter.id, sheet, creature);
    if (unseen) {
      return { error: `${sheet.name} cannot see ${name} (${unseen}), and ${ctx.spend.name} takes a creature they can see. Nothing was spent.`, refused: "rules" };
    }
  }
  const outcome = resolveSpendEffect({ ...ctx, args: { ...ctx.args, variant: does.mode } }, { kind: "flames", formula: does.formula, type: does.type });
  if ("error" in outcome) {
    return outcome;
  }
  quenchFlame(campaign.id, sheet, flame);
  return { ...outcome, result: { ...outcome.result, flame: `The spectral flame at (${flame.x},${flame.y}) goes out.` } };
}

// Blessing of the Forge: "enchant a weapon or suit of armor you touch with a
// +1 bonus until you use the feature again". The new blessing takes the
// cleric's earlier one off whoever carries it (its meta names the cleric as
// the source; one laid before sources were written is the cleric's too), so
// two objects never hold it at once; the counter keeps it to once a long rest.
function forgeBlessing(ctx: SpendContext, does: Extract<SpendDoes, { kind: "forge_blessing" }>): Resolution {
  const { campaign, sheet } = ctx;
  const targetId = ctx.args.targetCharacterId?.trim() || sheet.id;
  const target = getSheetById(targetId);
  if (!target || target.campaignId !== campaign.id) {
    return { error: `${ctx.spend.name} goes to a creature at the table: pass targetCharacterId. Nothing was spent.`, retry: true };
  }
  const lines: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const other = getSheetById(stale.id) ?? stale;
    const meta = (other.conditionMeta ?? {}) as Record<string, { source?: string } | undefined>;
    const old = other.conditions.filter((entry) => isConditionNamed(entry, does.family) || choiceIn(entry, does.family) !== null);
    const mine = old.filter((entry) => !meta[entry]?.source || meta[entry]?.source === sheet.id);
    if (!mine.length) continue;
    const left = removeConditions(other.conditions, other.conditionMeta as ConditionMetaMap, mine);
    const patch: FullPatchSheetInput = { conditions: left.conditions, conditionMeta: left.meta as FullPatchSheetInput["conditionMeta"] };
    const updated = patchSheet(other.id, patch);
    if (updated) publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    lines.push(`The earlier blessing on ${other.name} fades.`);
  }
  const fresh = getSheetById(target.id) ?? target;
  const kept = fresh.conditions.filter((entry) => !isConditionNamed(entry, does.condition));
  const blessed: FullPatchSheetInput = {
    conditions: [...kept, does.condition],
    conditionMeta: { ...fresh.conditionMeta, [does.condition]: { rounds: does.rounds, source: sheet.id } } as FullPatchSheetInput["conditionMeta"],
  };
  lines.push(`${target.name} carries ${does.condition} until ${sheet.name} uses the feature again.`);
  if (target.id === sheet.id) {
    return { patch: blessed, result: { applied: lines } };
  }
  const updated = patchSheet(target.id, blessed);
  if (updated) publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  return { result: { applied: lines } };
}


// Inspiring Smite: "After a Divine Smite, hand out temporary hit points of
// 2d8 + paladin level split among creatures within 30 feet." The turn's
// record of a smite the hit paid for (attack-swing.ts) opens it; the total is
// rolled once and shared between the creature named and the paladin, the
// named one's part in amount (all of it when amount is not given). Before
// this the use and the bonus action were spent and nobody gained anything.
function smiteTempHp(ctx: SpendContext, does: Extract<SpendDoes, { kind: "smite_temp_hp" }>): Resolution {
  const { campaign, sheet } = ctx;
  const encounter = getActiveEncounter(campaign.id);
  const budget = encounter ? budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions)) : null;
  if (!encounter || !budget?.oncePerTurn.includes(DIVINE_SMITE_LANDED)) {
    return { error: `${ctx.spend.name} comes right after a Divine Smite, and ${sheet.name} has landed none this turn: pc_attack with smite first. Nothing was spent.`, refused: "rules" };
  }
  const named = ctx.args.targetCharacterId && ctx.args.targetCharacterId !== sheet.id ? getSheetById(ctx.args.targetCharacterId) : null;
  if (ctx.args.targetCharacterId && ctx.args.targetCharacterId !== sheet.id && (!named || named.campaignId !== campaign.id)) {
    return { error: `${ctx.spend.name} goes to a creature at the table: pass targetCharacterId from GAME STATE. Nothing was spent.`, retry: true };
  }
  if (named && !withinFeet(encounter.id, sheet.id, named.id, does.rangeFt)) {
    return { error: `${named.name} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  const dice = resolveFormula(does.formula, ctx.held.level, ctx.mods);
  // The paladin's own dice (character-roll.ts rollOwnDice).
  const total = Math.max(0, Number(rollOwnDice(campaign, sheet, `${ctx.spend.name}: temporary hit points`, dice, { turn: ctx.turn }).total));
  const theirs = named ? Math.max(0, Math.min(total, Math.floor(ctx.args.amount ?? total))) : 0;
  const mine = total - theirs;
  const lines: string[] = [];
  // Temporary hit points do not stack: each keeps the larger.
  if (named && theirs > 0) {
    if (theirs > named.tempHp) {
      const updated = patchSheet(named.id, { tempHp: theirs });
      if (updated) publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${named.name}: ${Math.max(theirs, named.tempHp)} temporary hit points.`);
  }
  if (mine > 0) {
    lines.push(`${sheet.name}: ${Math.max(mine, sheet.tempHp)} temporary hit points.`);
  }
  return {
    ...(mine > sheet.tempHp ? { patch: { tempHp: mine } } : {}),
    result: { rolled: total, applied: lines.length ? lines : [`${total} temporary hit points rolled; none given.`] },
  };
}

const line = (text: string | undefined) => (text ?? "").trim();

// Hunter's Sense: "An action reveals a creature's damage immunities,
// resistances and vulnerabilities". Gap study WAVE2 D3: the answer is the
// creature's stat block (its immunities, resistances and vulnerabilities, or
// that it has none), the use is spent; a creature the ranger cannot see is
// refused, spending nothing. Before this the use was spent and the model
// was left to say what the block holds, or to guess.
export function revealDefenses(ctx: SpendContext): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} reads a creature in a fight; there is no fight. Nothing was spent.`, refused: "rules" };
  }
  const ref = ctx.args.targetEnemyId?.trim();
  if (!ref) {
    return { error: `${ctx.spend.name} reads one creature: pass targetEnemyId from GAME STATE. Nothing was spent.`, retry: true };
  }
  const enemy = resolveTargetFoe(encounter.campaignId, encounter, ref);
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name} needs a living creature in the fight: pass targetEnemyId from GAME STATE. Nothing was spent.`, retry: true };
  }
  const walled = swallowCoverError(ctx.sheet.id, enemy.id);
  if (walled) {
    return walled;
  }
  const unseen = unseenBecause(encounter.id, ctx.sheet, enemy);
  if (unseen) {
    return { error: `${ctx.sheet.name} cannot see ${enemy.displayName} (${unseen}), and ${ctx.spend.name} reads a creature they can see. Nothing was spent.`, refused: "rules" };
  }
  const immune = line(enemy.stats.immune);
  const resist = line(enemy.stats.resist);
  const vulnerable = line(enemy.stats.vulnerable);
  const parts = [
    immune ? `immune to ${immune}` : "",
    resist ? `resists ${resist}` : "",
    vulnerable ? `vulnerable to ${vulnerable}` : "",
  ].filter(Boolean);
  return {
    result: {
      creature: enemy.displayName,
      immunities: immune || "none",
      resistances: resist || "none",
      vulnerabilities: vulnerable || "none",
      reveals: parts.length
        ? `${ctx.sheet.name} senses ${enemy.displayName}: ${parts.join("; ")}.`
        : `${ctx.sheet.name} senses ${enemy.displayName} has no damage immunities, resistances or vulnerabilities.`,
    },
  };
}
