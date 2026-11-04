// use_reaction: a character's reaction, resolved by the engine.
//
// Before this the reaction was spent and the rest was a note: Uncanny Dodge
// told the model to "heal the difference back", Shield to "narrate
// accordingly", Cutting Words spent no die, a reaction spell's effect was
// "narrate its effect", and anyone could use any of them. Now:
//   - only the holder of a feature uses it, and a refusal spends nothing;
//   - a reaction to a hit that already landed re-resolves that attack from
//     the engine's record of it (src/lib/dm/last-hit.ts) and gives back what
//     the rules give back (src/lib/dm/reaction-refund.ts);
//   - a reaction spell is a cast through the one guard, and Hellish Rebuke
//     resolves as cast_at_enemy does;
//   - an opportunity attack is the server's own on a battle map, and off
//     the map is resolved here as one attack with the reaction.
// Split from action-tools.ts, which re-exports the handler.

import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { defensiveDuelist, lucky, mageSlayer, reservesRecovery, sentinel } from "@/lib/dm/feat-reactions";
import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import type { DmTurn } from "@/lib/db/dm-turns";
import { levenshtein } from "@/lib/dm/entity-logic";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { acBreakdownFor, computeSheetDerived } from "@/lib/srd";
import { martialArtsDie } from "@/lib/srd/feature-effects";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { kiSpend } from "@/lib/dm/bonus-actions";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { classLevelFor } from "@/lib/srd/multiclass";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellEngineName, spellFactsFor } from "@/lib/content";
import { addSheetCondition, rollCard } from "@/lib/dm/action-common";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { reactionRefusal } from "@/lib/dm/reaction-gate";
import { devotedGuard } from "@/lib/dm/devoted-guard";
import { reactionTimingOf, timingOfDoes, type ReactionTiming } from "@/lib/dm/reaction-kinds";
import { authoredReactionNamed, heldReaction } from "@/lib/srd/authored-effects";
import { removeConditions } from "@/lib/dm/condition-logic";
import { attackerFoeId, freshLastHit, heaviestHit, heaviestRaw, hitIdOf, openHitAimed, openHits, plainOfReroll, reactedLate, rerollAttacker, withHitAim, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import type { RollAttacker } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { opportunity, reactionSpell } from "@/lib/dm/reaction-spells";
import { settleLastHit } from "@/lib/dm/reaction-refund";
import { asReaction, lateReaction } from "@/lib/dm/held-turn";
import { authoredReaction } from "@/lib/dm/authored-reactions";
import { freeAuthoredReaction } from "@/lib/dm/authored-reactions-more";
import { srdFeatureReaction } from "@/lib/dm/srd-reactions";
import { maneuverReaction } from "@/lib/dm/maneuver-reactions";
// For the counter reactions' spend; mutations never imports back.
import { applyDmMutation } from "@/lib/dm/mutations";
import { matchResource } from "@/lib/srd/class-resources";
import { resolveSheetRef, unknownSheetRef } from "@/lib/dm/rolls";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { PRONE } from "@/lib/dm/vitals-logic";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import { swallowCoverBetween, swallowCoverError } from "@/lib/dm/swallow";
import { engineFeatNamed } from "@/lib/srd/feat-effects";
import { isPublishedFeatureName } from "@/lib/srd/features";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import { subclassNamed } from "@/lib/srd/subclass-name";

const useReactionSchema = z.object({
  characterId: z.string(),
  feature: z.string().max(80),
  targetCharacterId: z.string().optional(),
  targetEnemyId: z.string().optional(),
  // Counterspell: the spell being countered.
  spell: z.string().max(80).optional(),
  // A reaction spell cast from a higher slot (Counterspell at 5th).
  level: z.coerce.number().int().min(1).max(9).optional(),
  // A reaction that moves the character (Skirmisher, Relentless Avenger):
  // the square on the battle map.
  x: z.coerce.number().int().min(0).optional(),
  y: z.coerce.number().int().min(0).optional(),
  // The hit it answers when a character has several open (issue 685): the
  // hit's id from GAME STATE or the Hand's card, or the enemyId of the
  // creature that made it.
  hit: z.string().trim().max(120).optional(),
  reason: z.string().optional(),
});

type Args = z.infer<typeof useReactionSchema>;
export type Ctx = {
  campaign: Campaign;
  turn: DmTurn;
  sheet: CharacterSheet;
  args: Args;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  encounter: ReturnType<typeof getActiveEncounter>;
};

export function spendReaction(ctx: Ctx) {
  const live = ctx.encounter ? getActiveEncounter(ctx.campaign.id) : null;
  if (live && !live.reactionsUsed.includes(ctx.sheet.id)) {
    markReactionUsed(live, ctx.sheet.id);
  }
}

export const SPENT = (name: string) => `${name}'s reaction is used until the start of their next turn.`;

export function allyOf(ctx: Ctx): CharacterSheet | null {
  const ref = ctx.args.targetCharacterId
    ? resolveSheetRef(ctx.args.targetCharacterId, ctx.sheets, ctx.sheetsById)
    : null;
  return ref ? (getSheetById(ref.id) ?? ref) : null;
}

// A fall reaction sent before the fall: the fall is resolved first, then the
// reaction answers it, in the same turn.
export function noFall(who: string, feature: string): ToolError {
  return { error: `${feature} answers a fall that has landed: call apply_hazard falling for ${who} first, then send this use_reaction again. Nothing was spent.`, retry: true };
}

export function noHit(who: string, feature: string, what = "an attack that hit them"): ToolError {
  return { error: `${feature} answers ${what} this turn, and the server has none on record against ${who}. Nothing was spent.`, refused: "rules" };
}

export function settle(ctx: Ctx, record: LastHit, corrected: SwingRecord[], label: string) {
  return settleLastHit(ctx.campaign, ctx.turn.id, record, corrected, label, ctx.sheets, ctx.sheetsById);
}

// ---- features ----

function uncannyDodge(ctx: Ctx): ToolResult {
  const { sheet, campaign } = ctx;
  if (classLevelFor(sheet, "rogue") < 5 && !holdsFeature(sheet, "uncanny dodge")) {
    return { error: `${sheet.name} does not have Uncanny Dodge (a rogue's feature from 5th level). Nothing was spent.`, refused: "rules" };
  }
  // Unnamed, the heaviest blow among the open hits: the one halving helps most.
  const record = freshLastHit(campaign.id, sheet.id, (hit) => hit.source === "attack" && !hit.answered.includes("uncanny dodge") && heaviestHit(hit.swings) >= 0, (hit) => heaviestRaw(hit));
  const index = record ? heaviestHit(record.swings) : -1;
  if (!record || index < 0) {
    return noHit(sheet.name, "Uncanny Dodge");
  }
  const dodged = record.swings[index];
  const halved = Math.floor(dodged.raw / 2);
  const corrected = record.swings.map((swing, at) => (at === index ? { ...swing, raw: halved } : swing));
  spendReaction(ctx);
  const settled = settle(ctx, record, corrected, "uncanny dodge");
  return {
    ok: true,
    reaction: "Uncanny Dodge",
    spent: SPENT(sheet.name),
    applied: `The ${dodged.attack ?? record.attack} hit's damage is halved, ${dodged.raw} to ${halved}: ${settled.given} hit points come back. HP ${settled.hp}.`,
    ...(settled.notes.length ? { notes: settled.notes } : {}),
  };
}

function deflectMissiles(ctx: Ctx): ToolResult {
  const { sheet, campaign } = ctx;
  const monk = classLevelFor(sheet, "monk");
  if (monk < 3 && !holdsFeature(sheet, "deflect missiles")) {
    return { error: `${sheet.name} does not have Deflect Missiles (a monk's feature from 3rd level). Nothing was spent.`, refused: "rules" };
  }
  const ranged = (hit: LastHit) => (swing: SwingRecord) => swing.ranged ?? hit.ranged;
  const record = freshLastHit(
    campaign.id,
    sheet.id,
    (hit) => hit.source === "attack" && !hit.answered.includes("deflect missiles") && heaviestHit(hit.swings, ranged(hit)) >= 0,
    (hit) => heaviestRaw(hit, ranged(hit)),
  );
  const index = record ? heaviestHit(record.swings, ranged(record)) : -1;
  if (!record || index < 0) {
    return noHit(sheet.name, "Deflect Missiles", "a ranged weapon attack that hit them");
  }
  spendReaction(ctx);
  const dex = computeSheetDerived(sheet).abilityMods.dex;
  const die = rollCard(campaign, ctx.turn, sheet.id, "custom", `${sheet.name}: Deflect Missiles`, "1d10", null).total;
  const reduction = die + dex + (monk || sheet.level);
  const corrected = record.swings.map((swing, at) =>
    at === index ? { ...swing, raw: Math.max(0, swing.raw - reduction) } : swing,
  );
  const caught = corrected[index].raw === 0;
  const settled = settle(ctx, record, corrected, "deflect missiles");
  const thrown = caught && ctx.args.targetEnemyId ? throwBack(ctx, record, monk || sheet.level) : null;
  return {
    ok: true,
    reaction: "Deflect Missiles",
    spent: SPENT(sheet.name),
    reduction: `1d10 (${die}) + DEX ${dex} + monk level ${monk || sheet.level} = ${reduction}`,
    applied: `${settled.given} hit points come back. HP ${settled.hp}.${
      caught
        ? thrown
          ? " The missile is caught and thrown back."
          : " The missile is caught: the damage is gone. With 1 ki it can be thrown back: pass targetEnemyId with the reaction."
        : ""
    }`,
    ...(thrown ? { throwBack: thrown } : {}),
  };
}

// A caught missile thrown back for 1 ki, as part of the same reaction: a
// ranged attack with it as a monk weapon, proficient, range 20/60, DEX to
// hit and damage, the Martial Arts die.
function throwBack(ctx: Ctx, record: LastHit, monkLevel: number): Record<string, unknown> {
  const { sheet, campaign, encounter } = ctx;
  const enemy = encounter && ctx.args.targetEnemyId ? resolveTargetFoe(encounter.campaignId, encounter, ctx.args.targetEnemyId) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    return { error: "The missile can be thrown back at a living enemy from GAME STATE; it was caught and kept." };
  }
  // Not across a swallower's wall (swallow.ts).
  const walled = swallowCoverBetween(sheet.id, enemy.id);
  if (walled) {
    return { error: `${walled} The missile was caught and kept.` };
  }
  const apart = tilesBetween(encounter.id, sheet.id, enemy.id);
  if (apart !== null && apart > 12) {
    return { error: `${enemy.displayName} is ${apart * 5} ft away, past the missile's 60 ft; it was caught and kept.` };
  }
  const ki = kiSpend(getSheetById(sheet.id) ?? sheet, 1, "throwing the missile back");
  if ("error" in ki) {
    return { error: `${ki.error} The missile was caught and kept.` };
  }
  const paid = patchSheet(sheet.id, { resources: ki.resources });
  if (paid) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: paid });
  }
  const derived = computeSheetDerived(sheet);
  const bonus = derived.abilityMods.dex + derived.proficiencyBonus;
  const thrower: RollAttacker = { kind: "sheet", id: sheet.id, name: sheet.name };
  const hitRoll = rollCard(campaign, ctx.turn, sheet.id, "attack", rollAgainst("Caught missile", enemy.displayName), d20Expression(bonus, apart !== null && apart > 4 ? "disadvantage" : "none"), thrower);
  const ac = enemyAcWithEffects(campaign.id, enemy);
  const hit = hitRoll.crit !== "nat1" && (hitRoll.crit === "nat20" || hitRoll.total >= ac);
  if (!hit) {
    return { rolled: hitRoll.total, vsAc: ac, hit: false, ki: "1 ki spent" };
  }
  const faces = `1${martialArtsDie(monkLevel)}`;
  const damage = rollCard(campaign, ctx.turn, sheet.id, "damage", rollAgainst("Caught missile", enemy.displayName), hitRoll.crit === "nat20" ? `${faces}+${faces}+${derived.abilityMods.dex}` : `${faces}+${derived.abilityMods.dex}`, thrower);
  const applied = applyEnemyDamage(campaign, ctx.turn, encounter, enemy, Math.max(0, damage.total), ctx.sheets, ctx.sheetsById, record.type);
  publishEncounter(campaign.id);
  return { rolled: hitRoll.total, vsAc: ac, hit: true, damage: damage.total, ki: "1 ki spent", ...applied };
}

function bardDie(sheet: CharacterSheet): string {
  const level = classLevelFor(sheet, "bard") || sheet.level;
  return level >= 15 ? "1d12" : level >= 10 ? "1d10" : level >= 5 ? "1d8" : "1d6";
}

function cuttingWords(ctx: Ctx): ToolResult {
  const { sheet, campaign, encounter } = ctx;
  const lore = subclassNamed(sheet.subclass ?? "", "College of Lore") && classLevelFor(sheet, "bard") >= 3;
  if (!lore && !holdsFeature(sheet, "cutting words")) {
    return { error: `${sheet.name} does not have Cutting Words (a College of Lore bard's feature from 3rd level). Nothing was spent.`, refused: "rules" };
  }
  const pool = sheet.resources?.bardic_inspiration;
  if (!pool || pool.used >= pool.max) {
    return { error: `${sheet.name} has no Bardic Inspiration left to spend on Cutting Words. Nothing was spent.`, refused: "rules" };
  }
  const target = allyOf(ctx) ?? sheet;
  // The hit the prompt names (heaviestHit): the die once went off a
  // multiattack's last hit while the card offered its heaviest.
  const record = freshLastHit(
    campaign.id,
    target.id,
    (hit) => hit.source === "attack" && attackerFoeId(hit) !== null && !hit.answered.includes("cutting words") && heaviestHit(hit.swings) >= 0,
    (hit) => heaviestRaw(hit),
  );
  const index = record ? heaviestHit(record.swings) : -1;
  if (!record || index < 0) {
    return noHit(target.name, "Cutting Words", `an attack that hit ${target.name}`);
  }
  // The attacker has to be within 60 feet of the bard.
  const apart = encounter && record.attacker.id ? tilesBetween(encounter.id, sheet.id, record.attacker.id) : null;
  if (apart !== null && apart > 12) {
    return {
      error: `${record.attacker.name} is ${apart * 5} ft from ${sheet.name}; Cutting Words reaches a creature within 60 ft. Nothing was spent.`,
      refused: "rules",
    };
  }
  // The words reach no creature across a swallower's wall (swallow.ts).
  const walled = record.attacker.id ? swallowCoverError(sheet.id, record.attacker.id) : null;
  if (walled) {
    return walled;
  }
  spendReaction(ctx);
  const spentPool = patchSheet(sheet.id, {
    resources: { ...sheet.resources, bardic_inspiration: { max: pool.max, used: pool.used + 1 } },
  });
  if (spentPool) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: spentPool });
  }
  const dieExpression = bardDie(sheet);
  const die = rollCard(campaign, ctx.turn, sheet.id, "custom", `${sheet.name}: Cutting Words`, dieExpression, null).total;
  const swing = record.swings[index];
  // Off the attack roll when that turns the hit into a miss (a natural 20
  // hits whatever the total), otherwise off the damage.
  const missed = swing.natural !== 20 && swing.total - die < swing.vsAc;
  const corrected = record.swings.map((entry, at) =>
    at !== index ? entry : missed ? { ...entry, hit: false, raw: 0 } : { ...entry, raw: Math.max(0, entry.raw - die) },
  );
  const settled = settle(ctx, record, corrected, "cutting words");
  return {
    ok: true,
    reaction: "Cutting Words",
    spent: `${SPENT(sheet.name)} One Bardic Inspiration die is spent.`,
    rolled: `${dieExpression}: ${die}`,
    applied: missed
      ? `${record.attacker.name}'s roll falls from ${swing.total} to ${swing.total - die} against AC ${swing.vsAc}: the hit on ${target.name} becomes a miss, and ${settled.given} hit points come back. HP ${settled.hp}.`
      : `The roll still hits, so the die comes off the damage: ${settled.given} hit points come back to ${target.name}. HP ${settled.hp}.`,
  };
}

function protection(ctx: Ctx): ToolResult {
  const { sheet, campaign, encounter } = ctx;
  if (!holdsFeature(sheet, "protection")) {
    return { error: `${sheet.name} does not have the Protection fighting style. Nothing was spent.`, refused: "rules" };
  }
  if (!acBreakdownFor(sheet).shieldName) {
    return { error: `The Protection style needs a shield, and ${sheet.name} is not carrying one. Nothing was spent.`, refused: "rules" };
  }
  const ally = allyOf(ctx);
  if (!ally || ally.id === sheet.id) {
    return { error: "Protection covers another creature: pass the ally's targetCharacterId. Nothing was spent.", retry: true };
  }
  const apart = encounter ? tilesBetween(encounter.id, sheet.id, ally.id) : null;
  if (apart !== null && apart > 1) {
    return {
      error: `${ally.name} is ${apart * 5} ft from ${sheet.name}; Protection covers a creature within 5 ft. Nothing was spent.`,
      refused: "rules",
    };
  }
  // A shield does not reach across a swallower's wall (swallow.ts).
  const walled = swallowCoverError(sheet.id, ally.id);
  if (walled) {
    return walled;
  }
  spendReaction(ctx);
  addSheetCondition(campaign, ally, "protected", { untilTurnOf: sheet.id });
  // The attack that called for it, already rolled: rolled again at
  // disadvantage. A straight roll takes the lower of its die and a new one;
  // a roll with advantage becomes a straight one (its first die); one
  // already at disadvantage is unchanged.
  // The hit the prompt names (heaviestHit), not the routine's first swing:
  // after a multiattack whose first swing missed, Protection rolled nothing
  // again and the hit that landed stood.
  const record = freshLastHit(campaign.id, ally.id, (hit) => hit.source === "attack" && !hit.answered.includes("protection") && heaviestHit(hit.swings) >= 0, (hit) => heaviestRaw(hit));
  const index = record ? heaviestHit(record.swings) : -1;
  const first = record && index >= 0 ? record.swings[index] : null;
  let reread = "";
  if (record && first?.hit && first.natural !== null && first.faces.length) {
    const kept =
      first.advantage === "disadvantage"
        ? first.natural
        : first.advantage === "advantage"
          ? first.faces[0]
          : Math.min(first.natural, rollCard(campaign, ctx.turn, null, "attack", rollAgainst(`${first.attack ?? record.attack} again, at disadvantage (Protection)`, ally.name), "1d20", rerollAttacker(record)).total);
    const total = first.total - first.natural + kept;
    const missed = kept !== 20 && (kept === 1 || total < first.vsAc);
    if (missed) {
      const settled = settle(ctx, record, record.swings.map((swing, at) => (at === index ? { ...swing, hit: false, raw: 0 } : swing)), "protection");
      reread = ` The attack is rolled again at disadvantage: ${total} against AC ${first.vsAc} misses, and ${settled.given} hit points come back to ${ally.name}.`;
    } else {
      // Still a hit, and answered all the same; a critical the kept die no
      // longer makes lands as an ordinary hit (last-hit.ts plainOfReroll).
      const plain = plainOfReroll(first, kept);
      const settled = settle(ctx, record, record.swings.map((swing, at) => (at === index ? plain : swing)), "protection");
      reread = ` The attack is rolled again at disadvantage: ${total} against AC ${first.vsAc} still hits${plain !== first ? `, no longer a critical: ${settled.given} hit points come back to ${ally.name}` : ""}.`;
    }
  }
  return {
    ok: true,
    reaction: "Protection",
    spent: SPENT(sheet.name),
    applied: `${ally.name} is protected: attacks against them roll at disadvantage until ${sheet.name}'s next turn. The server applies it.${reread}`,
  };
}

// A fall answered after it landed: Slow Fall takes off five times the
// monk's level, Feather Fall all of it. Taking none of it means landing on
// their feet.
export function softenFall(ctx: Ctx, target: CharacterSheet, label: string, reduction: number | "all") {
  const record = freshLastHit(ctx.campaign.id, target.id, (hit) => hit.source === "fall" && !hit.answered.includes(label));
  if (!record) {
    return null;
  }
  const corrected = record.swings.map((swing) => ({
    ...swing,
    raw: reduction === "all" ? 0 : Math.max(0, swing.raw - reduction),
  }));
  const settled = settle(ctx, record, corrected, label);
  if (corrected.every((swing) => swing.raw === 0) && !record.before.conditions.some((c) => c.toLowerCase() === PRONE)) {
    const now = getSheetById(target.id);
    if (now?.conditions.some((c) => c.toLowerCase() === PRONE)) {
      const cleared = removeConditions(now.conditions, now.conditionMeta, [PRONE]);
      const updated = patchSheet(now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
      if (updated) {
        publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
  return settled;
}

function slowFall(ctx: Ctx): ToolResult {
  const { sheet } = ctx;
  const monk = classLevelFor(sheet, "monk");
  if (monk < 4 && !holdsFeature(sheet, "slow fall")) {
    return { error: `${sheet.name} does not have Slow Fall (a monk's feature from 4th level). Nothing was spent.`, refused: "rules" };
  }
  const record = freshLastHit(ctx.campaign.id, sheet.id, (hit) => hit.source === "fall");
  if (!record) {
    return noFall(sheet.name, "Slow Fall");
  }
  spendReaction(ctx);
  const settled = softenFall(ctx, sheet, "slow fall", 5 * (monk || sheet.level))!;
  return {
    ok: true,
    reaction: "Slow Fall",
    ...(ctx.encounter ? { spent: SPENT(sheet.name) } : {}),
    applied: `The fall's damage drops by ${5 * (monk || sheet.level)}: ${settled.given} hit points come back. HP ${settled.hp}.`,
  };
}

// When this reaction may still be taken by a character the triggering hit
// dropped (src/lib/dm/reaction-kinds.ts, issue 233). A reaction for another
// creature is judged as the reactor is now; one for themselves by what it
// does to the hit: an authored reaction by its effect, a spell and every
// named feature by the table.
export function timingOfUseReaction(
  campaign: Campaign,
  sheet: CharacterSheet,
  args: Pick<Args, "feature" | "targetCharacterId">,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ReactionTiming {
  const other = args.targetCharacterId ? resolveSheetRef(args.targetCharacterId, sheets, sheetsById) : null;
  if (other && other.id !== sheet.id) {
    return "after";
  }
  const feature = args.feature.trim();
  const authored = heldReaction(sheet, feature) ?? authoredReactionNamed(feature.replace(/\s*\(.*$/, ""));
  if (authored) {
    return timingOfDoes(authored.reaction.does);
  }
  const authors = spellAuthorsFor(campaign);
  const spell = spellFactsFor(feature, authors);
  if (spell?.castingTime === "reaction") {
    return reactionTimingOf(spellEngineName(spell.name, authors));
  }
  return reactionTimingOf(feature);
}

// The reactions that answer a hit on the reactor alone (SRD 5.1: Uncanny
// Dodge "an attack against you", Deflect Missiles, Slow Fall, Shield,
// Hellish Rebuke; Parry and Riposte, the Battle Master's own; Absorb
// Elements). Cutting Words, Protection, Feather Fall and the authored
// reactions for an ally take another's hit.
function answersOwnHitOnly(campaign: Campaign, feature: string): boolean {
  const name = feature.trim();
  if (isNamed(name, "uncanny dodge", "deflect missiles", "deflect missile", "slow fall", "parry", "riposte")) {
    return true;
  }
  const authors = spellAuthorsFor(campaign);
  const spell = spellFactsFor(name, authors);
  return spell?.castingTime === "reaction" && isNamed(spellEngineName(spell.name, authors), "shield", "absorb elements", "hellish rebuke");
}

// How far a hit id the model sent may stray from an open hit's and still be
// taken for a slip of it: the misses seen dropped one character of nine.
// Two random ids this close are about one in a billion.
const MISCOPIED_HIT = 2;

export function handleUseReaction(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  let args: Args;
  try {
    args = useReactionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: use_reaction needs characterId and feature.", retry: true };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return unknownSheetRef("characterId", args.characterId, sheets);
  }
  // The hit it answers, when the call names one (issue 685): it must still be
  // open, or the reaction would quietly answer another. A hit on someone
  // else names the ally a reaction for one is taken for (Cutting Words,
  // Protection) when the call left that out.
  if (args.hit) {
    const own = openHitAimed(campaign.id, args.hit, sheet.id);
    const aimed = own ?? openHitAimed(campaign.id, args.hit);
    if (!aimed) {
      const why = `No attack still open to a reaction matches hit "${args.hit}": it has been answered, its moment to answer has passed, or that creature made none.`;
      // A model can copy an id wrongly, and told only "no" it gave up with the
      // hit still standing. It is sent back with the open hits its id is a
      // slip of (a character or two off), and never given one unasked: that
      // is the quiet answer above. An id of a hit that has closed, a card's
      // or the model's own from earlier, resembles no open one (ids are
      // random), so it is told no rather than offered another hit to spend
      // the reaction on. So is a person, and a reactor already spent.
      const encounter = getActiveEncounter(campaign.id);
      const offers = turn.actor === "ai"
        && !(encounter && (encounter.reactionsUsed.includes(sheet.id) || reactedLate(campaign.id, encounter, sheet.id)));
      const sent = args.hit.trim().toLowerCase();
      const listed = !offers ? [] : (answersOwnHitOnly(campaign, args.feature) ? [sheet] : sheets).flatMap((holder) =>
        openHits(campaign.id, holder.id)
          .filter((record) => levenshtein(hitIdOf(record).toLowerCase(), sent) <= MISCOPIED_HIT)
          .map((record) => `hit "${hitIdOf(record)}" on ${holder.name} (${record.source === "fall" ? "a fall" : `${record.attacker.name}'s ${record.attack}`})`),
      );
      return listed.length
        ? { error: `${why} Open hits like it: ${listed.join(", ")}. Send the one this reaction answers as hit. Nothing was spent.`, retry: true }
        : { error: `${why} Nothing was spent.`, refused: "rules" };
    }
    // A reaction for the reactor alone answers only a hit on them: Uncanny
    // Dodge sent with an ally's hit once halved one of the rogue's own hits
    // in its place, quietly. The call is sent back with the reactor's own.
    if (!own && answersOwnHitOnly(campaign, args.feature)) {
      const mine = openHits(campaign.id, sheet.id);
      const holder = getSheetById(aimed.characterId)?.name ?? "another character";
      const listed = mine.map((record) => `hit "${hitIdOf(record)}" (${record.attacker.name}'s ${record.attack})`).join(", ");
      return mine.length
        ? { error: `Hit "${args.hit}" is on ${holder}, and ${args.feature.trim()} answers a hit on ${sheet.name}. ${sheet.name}'s open hits: ${listed}. Send one of those as hit. Nothing was spent.`, retry: true }
        : { error: `Hit "${args.hit}" is on ${holder}, and ${args.feature.trim()} answers a hit on ${sheet.name}, who has none open. Nothing was spent.`, refused: "rules" };
    }
    if (!own && !args.targetCharacterId) {
      args = { ...args, targetCharacterId: aimed.characterId };
    }
  }
  const aimedArgs = args;
  const result = withHitAim(args.hit, () => asReaction(sheet.id, () => useReaction(campaign, turn, sheet, aimedArgs, sheets, sheetsById)));
  // Taken against the enemies' pass after the engine began the reactor's
  // turn: it belongs before that turn (src/lib/dm/held-turn.ts).
  if (!("error" in result) && lateReaction(campaign, sheet.id)) {
    return { ...result, turnBegun: `${sheet.name}'s turn has begun since those attacks: the reaction comes back with it, and what lasts until the start of it has ended.` };
  }
  return result;
}

function useReaction(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  args: Args,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  const feature = args.feature.trim();
  const refused = reactionRefusal(campaign.id, sheet, encounter, feature, timingOfUseReaction(campaign, sheet, args, sheets, sheetsById));
  if (refused) {
    return refused;
  }
  // Each rule below is the reaction its whole name is (src/lib/srd/
  // feature-names.ts): Sentinel at Death's Door is no Sentinel, and a
  // homebrew Arcane Protection no Protection.
  const falling = isNamed(feature, "slow fall", "feather fall");
  if (!encounter && !falling) {
    return { error: "Reactions only exist in combat; there is no active encounter.", refused: "rules" };
  }
  // Part of a reaction already taken (Relentless Avenger's move after the
  // opportunity attack): src/lib/dm/authored-reactions-more.ts.
  const free = freeAuthoredReaction({ campaign, turn, sheet, args, sheets, sheetsById, encounter });
  if (free) {
    return free;
  }
  // A reaction is spent on someone ELSE's turn, so it cannot live in the
  // acting combatant's turn budget. Both sides of the table share
  // encounter.reactionsUsed; a combatant's entry leaves it as their own turn
  // starts (advancePointer).
  if (encounter && (encounter.reactionsUsed.includes(sheet.id) || reactedLate(campaign.id, encounter, sheet.id))) {
    return {
      error: `${sheet.name} has already used their reaction; it comes back at the start of their next turn. ${feature} does not happen.`,
      refused: "rules",
    };
  }
  const ctx: Ctx = { campaign, turn, sheet, args, sheets, sheetsById, encounter };
  // A devoted companion's Take the Blow (src/lib/dm/devoted-guard.ts).
  const guarded = devotedGuard(ctx);
  if (guarded) {
    return guarded;
  }

  if (isNamed(feature, "opportunity attack", "attack of opportunity")) {
    return opportunity(ctx);
  }
  // The authored subclass reactions (Spirit Shield, Spectral Defense, Storm's
  // Fury, Divine Allegiance...): src/lib/dm/authored-reactions.ts.
  const authored = authoredReaction(ctx);
  if (authored) {
    return authored;
  }
  // Retaliation, Stand Against the Tide (src/lib/dm/srd-reactions.ts).
  const srd = srdFeatureReaction(ctx);
  if (srd) {
    return srd;
  }
  // A reaction that is a spell is a cast: the caster must hold it and pay
  // its slot through the one guard (src/lib/dm/cast-guard.ts), which
  // refuses before the reaction is spent.
  const spell = spellFactsFor(feature, spellAuthorsFor(campaign));
  if (spell?.castingTime === "reaction") {
    return reactionSpell(ctx, spell.name);
  }
  // A limited-use reaction with a counter (Stone's Endurance, Misty Escape,
  // Warding Maneuver, Strength before Death...) is a use_resource spend: the
  // use, the reaction and the effect go together there, where before this
  // branch let use_reaction spend the reaction and leave the counter full.
  const counter = matchResource(feature);
  if (counter?.action === "reaction" && sheet.resources?.[counter.id]) {
    return applyDmMutation(
      campaign,
      turn.id,
      "use_resource",
      JSON.stringify({
        characterId: sheet.id,
        resource: feature,
        ...(args.targetCharacterId ? { targetCharacterId: args.targetCharacterId } : {}),
        ...(args.targetEnemyId ? { targetEnemyId: args.targetEnemyId } : {}),
        reason: args.reason ?? feature,
      }),
      sheets,
      sheetsById,
    ).result;
  }
  // Parry, Riposte and Brace, and the ally's side of Maneuvering Attack and
  // Commander's Strike (src/lib/dm/maneuver-reactions.ts).
  const maneuver = maneuverReaction(ctx);
  if (maneuver) {
    return maneuver;
  }
  if (isNamed(feature, "uncanny dodge")) {
    return uncannyDodge(ctx);
  }
  if (isNamed(feature, "deflect missiles", "deflect missile")) {
    return deflectMissiles(ctx);
  }
  if (isNamed(feature, "cutting words")) {
    return cuttingWords(ctx);
  }
  if (isNamed(feature, "protection")) {
    return protection(ctx);
  }
  if (isNamed(feature, "slow fall")) {
    return slowFall(ctx);
  }
  // The feats with a reaction (src/lib/dm/feat-reactions.ts).
  if (isNamed(feature, "defensive duelist")) {
    return defensiveDuelist(ctx);
  }
  if (isNamed(feature, "mage slayer")) {
    return mageSlayer(ctx);
  }
  if (isNamed(feature, "sentinel", "guarded warrior")) {
    return sentinel(ctx);
  }
  if (isNamed(feature, "lucky", "fortunate", "luck point")) {
    return lucky(ctx);
  }
  if (isNamed(feature, "boundless reserves")) {
    return reservesRecovery(ctx, "ki");
  }
  if (isNamed(feature, "sorcerous vigor")) {
    return reservesRecovery(ctx, "sorcery_points");
  }
  // Any other reaction must be one the sheet holds; the reaction is spent
  // and the effect is the feature's own text.
  const held = sheet.features.find((entry) => isNamed(entry.name, feature) || isNamed(feature, entry.name));
  if (!held) {
    // A spell, feat or feature the rules know is one they lack; a name nobody
    // knows is the call's to fix, from what is on their sheet.
    return spellFactsFor(feature, spellAuthorsFor(ctx.campaign)) || engineFeatNamed(feature) || isPublishedFeatureName(feature)
      ? {
          error: `${sheet.name} has no reaction called "${feature}" on their sheet: no feature by that name, and no reaction spell they can cast. Nothing was spent.`,
          refused: "rules",
        }
      : {
          error: `No reaction called "${feature}" is known. ${sheet.name}'s features are ${sheet.features.map((entry) => entry.name).join(", ") || "none"}: send the one meant, by the name on the sheet. Nothing was spent.`,
          retry: true,
        };
  }
  spendReaction(ctx);
  return {
    ok: true,
    reaction: held.name,
    spent: SPENT(sheet.name),
    note: `${held.name} is resolved from its own text; anything it rolls or changes goes through its own tool.`,
  };
}
