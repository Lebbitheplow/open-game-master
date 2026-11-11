// Arcane Deflection as the engine resolves it (wizard, War Magic 2): "A
// reaction after being hit or failing a save grants +2 AC or +4 on the save,
// at the cost of casting only cantrips on your next turn"
// (src/lib/srd/subclasses.json, wizard::Arcane Deflection).
//
// The +2 against a hit is the authored reaction's own (ac_vs_hit in
// src/lib/dm/authored-reactions.ts). This module holds what that row could
// not say, and is called from there:
//
//   - The other half (deflectSaveHalf, through deflectionFirst from the row's resolver before
//     anything is spent): +4 on a saving throw the wizard has just failed.
//     The failed save is the roll on record (the rolls table, where every
//     save a character rolls lands, as Indomitable's reroll reads it), made
//     in the turn now running; out of a fight, the wizard's latest roll. With
//     none on record the reaction is refused and nothing is spent. When the
//     +4 reaches the DC the save is a success: the conditions that failure
//     laid which that same save ends come off, as a reroll that succeeds
//     takes them off (feature-spends.ts indomitable), and the result says
//     what the server could not undo. Short of the DC the failure stands and
//     the reaction is spent all the same.
//     Ruling: a failed save to keep concentration is not answered. The engine
//     ends the spell with the failed roll, its effects with it, and nothing
//     here can put them back.
//     The reaction gate judges this half as the wizard stood before the
//     failure (standingForDeflection), so a save that has just paralyzed them
//     can still be turned.
//     Which half a call means: the variant "save" (or the feature named
//     "Arcane Deflection save") is the save's; with no variant, the hit's
//     while one is open on the wizard, else the save's.
//   - The price (deflectionAftermath, once the reaction is decided, paid and
//     spent): a mark on the wizard to the end of their next turn, which the
//     cast door reads (src/lib/dm/ar-ws-deflection-mark.ts). A use on the
//     wizard's own turn (an opportunity attack turned aside) bars the rest of
//     that turn and all of the next, so an older mark is replaced, never kept.
//   - Deflecting Shroud (War Magic 14): "Arcane Deflection also deals half
//     your wizard level in force damage to up to three creatures within 60
//     feet", from either half of the reaction (deflectingShroud, inside
//     deflectionAftermath). The creatures are foes the wizard can see within
//     60 feet: the ones the call names in targetEnemyIds (three at most), else
//     the three nearest. A creature named beyond the reach, unseen, or a
//     fourth one is refused before the reaction is spent (shroudRefusal,
//     through deflectionFirst).
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { feetBetween } from "@/lib/dm/combat-features";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { foesOfSheet, resolveTargetFoe } from "@/lib/dm/sheet-foe";
import { holdsFeature } from "@/lib/srd/feature-names";
import { classLevelOf } from "@/lib/srd/trait-rules";
import { listRecentRolls, type StoredRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { beforeFailedSave, DEFLECTED } from "@/lib/dm/ar-ws-deflection-mark";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { answeredBy, answerKey, freshLastHit } from "@/lib/dm/last-hit";
import { heldAuthored } from "@/lib/srd/authored-effects";
import { answerSave, openSaves, turnBeganAt } from "@/lib/dm/last-save";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { reactionPatch } from "@/lib/dm/reaction-refund";
import type { Ctx } from "@/lib/dm/reaction-tools";
import type { ToolError, ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

const SAVE_ABILITY = /\b(str|dex|con|int|wis|cha)\b/i;
const KEEPS_CONCENTRATION = /concentration/i;

const failedSave = (roll: StoredRoll) => roll.kind === "saving_throw" && roll.dc !== null && roll.total < roll.dc;

type Encounter = Ctx["encounter"];

// The saving throw a character has just failed, off the roll record (also
// read by flash-of-genius.ts): the
// latest one failed in the turn now running, or out of a fight their latest
// roll when it is one.
export function failedSaveRollOf(campaignId: string, sheetId: string, encounter: Encounter): StoredRoll | null {
  const own = listRecentRolls(campaignId, 60).filter((roll) => roll.characterId === sheetId);
  if (!encounter || encounter.status !== "active") {
    const last = own.at(-1);
    return last && failedSave(last) ? last : null;
  }
  const since = Date.parse(turnBeganAt(campaignId) ?? encounter.createdAt);
  return own.filter((roll) => failedSave(roll) && !(Date.parse(roll.createdAt) < since)).at(-1) ?? null;
}

const abilityOf = (roll: StoredRoll) => (SAVE_ABILITY.exec(roll.detail)?.[1] ?? "").toLowerCase();

// Whether a call means the save's half, and the failed save it would answer.
function saveAsked(campaignId: string, sheet: CharacterSheet, encounter: Encounter, wanted: string, label: string): { asked: boolean; failed: StoredRoll | null } {
  const failed = failedSaveRollOf(campaignId, sheet.id, encounter);
  if (wanted === "save") {
    return { asked: true, failed };
  }
  const hitOpen = Boolean(freshLastHit(campaignId, sheet.id, (hit) => hit.source === "attack" && !answeredBy(hit, label)));
  return { asked: !wanted && !hitOpen && Boolean(failed), failed };
}

// The character as the reaction gate should judge them for this call
// (reaction-tools.ts, before reactionRefusal): for the save's half of a
// reaction they hold, as they stood before the failed save
// (ar-ws-deflection-mark.ts beforeFailedSave); for anything else, as they are.
export function standingForDeflection(campaignId: string, sheet: CharacterSheet, encounter: Encounter, feature: string, variant: string | undefined): CharacterSheet {
  const asked = textKey(feature);
  for (const held of heldAuthored(sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      const name = textKey(reaction.name);
      if (reaction.does.kind !== "ac_vs_hit" || reaction.does.orSave === undefined || !(asked === name || asked.startsWith(`${name} `))) continue;
      const wanted = textKey(asked.slice(name.length).trim() || variant || "");
      const { asked: save, failed } = saveAsked(campaignId, sheet, encounter, wanted, answerKey(name, sheet.id));
      return save && failed ? beforeFailedSave(sheet, abilityOf(failed), failed.dc) : sheet;
    }
  }
  return sheet;
}

// The save half of the reaction, or null when this call answers a hit.
// Decided before anything is spent: a refusal here costs nothing.
function deflectSaveHalf(ctx: Ctx, variant: string, name: string, bonus: number, label: string): ToolResult | ToolError | null {
  const { asked, failed } = saveAsked(ctx.campaign.id, ctx.sheet, ctx.encounter, textKey(variant || ctx.args.variant || ""), label);
  if (!asked) {
    return null;
  }
  if (!failed) {
    return { error: `${name} answers a saving throw ${ctx.sheet.name} has just failed, and the server has none on record this turn. Nothing was spent.`, refused: "rules" };
  }
  if (KEEPS_CONCENTRATION.test(failed.detail)) {
    return { error: `${name} cannot turn the save to keep concentration: the spell ended with the failed roll, and its effects with it. Nothing was spent.`, refused: "rules" };
  }
  const ability = abilityOf(failed);
  const dc = failed.dc ?? 0;
  const total = failed.total + bonus;
  const shown = `${ability ? `${ability.toUpperCase()} ` : ""}save`;
  // The record of it a creature forced, so its card goes and the result can
  // say what came through the failure (last-save.ts).
  const record = openSaves(ctx.campaign.id).filter((save) => save.characterId === ctx.sheet.id && save.success === false && (!ability || save.ability === ability) && !(save.answered ?? []).includes(label)).at(-1);
  if (record) {
    answerSave(ctx.campaign.id, record.id, label);
  }
  if (total < dc) {
    return { applied: `+${bonus} on the ${shown}: ${failed.total} becomes ${total} against DC ${dc}, and the failure stands.`, save: "failure" };
  }
  // What that failure laid on them which the same save ends comes off, as a
  // reroll that succeeds takes it off (feature-spends.ts indomitable).
  const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
  const meta = now.conditionMeta as ConditionMetaMap;
  const lifted = now.conditions.filter((entry) => {
    const ends = meta[entry]?.saveEnds;
    return Boolean(ends) && ends!.ability === ability && ends!.dc === dc;
  });
  if (lifted.length) {
    const cleared = removeConditions(now.conditions, now.conditionMeta, lifted);
    reactionPatch(ctx.campaign, ctx.turn.id, now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, `${name}: the save succeeds`);
  }
  const through = record?.damage?.amount ? ` ${now.name} took ${record.damage.amount}${record.damage.type ? ` ${record.damage.type}` : ""} damage through the failed save.` : "";
  return {
    applied: `+${bonus} on the ${shown}: ${failed.total} becomes ${total} against DC ${dc}, and the save succeeds${lifted.length ? `; ${lifted.join(", ")} no longer holds them` : ""}.`,
    save: "success",
    also: `The save is a success now: give back what the failure alone did that the server could not (damage a success would have halved or spared, a condition with no save to end it).${through}`,
  };
}

const SHROUD = "Deflecting Shroud";
const SHROUD_FEET = 60;
const SHROUD_MOST = 3;

// The creatures the call names for the shroud: its list, never the one
// creature of targetEnemyId, which a call may carry for the attacker it
// answers (an archer 80 feet off would have refused the whole reaction).
const shroudNamed = (ctx: Ctx): string[] => [...new Set((ctx.args.targetEnemyIds ?? []).map((ref) => ref.trim()).filter(Boolean))];

const standing = (enemy: EncounterEnemy) => enemy.status === "alive" && enemy.currentHp > 0;

// The foes the shroud can reach: standing, within 60 feet, seen by the wizard.
function shroudReach(ctx: Ctx, holder: CharacterSheet): EncounterEnemy[] {
  const encounter = ctx.encounter;
  if (!encounter) {
    return [];
  }
  return foesOfSheet(ctx.campaign.id, encounter, holder.id).filter(
    (enemy) => standing(enemy) && withinFeet(encounter.id, holder.id, enemy.id, SHROUD_FEET) && !unseenBecause(encounter.id, holder, enemy),
  );
}

// The refusal of a shroud aimed where it cannot go, said before the reaction
// is spent; null for a wizard without the feature, whose call names nobody.
function shroudRefusal(ctx: Ctx): ToolError | null {
  const encounter = ctx.encounter;
  const named = shroudNamed(ctx);
  if (!encounter || !named.length || !holdsFeature(ctx.sheet, SHROUD)) {
    return null;
  }
  if (named.length > SHROUD_MOST) {
    return { error: `${SHROUD} strikes up to three creatures, and ${named.length} were named. Name three at most, or none for the three nearest. Nothing was spent.`, retry: true };
  }
  const foes = new Set(foesOfSheet(ctx.campaign.id, encounter, ctx.sheet.id).map((enemy) => enemy.id));
  for (const ref of named) {
    const enemy = resolveTargetFoe(ctx.campaign.id, encounter, ref);
    if (!enemy || !standing(enemy) || !foes.has(enemy.id)) {
      return { error: `${SHROUD} strikes creatures standing against ${ctx.sheet.name} in the fight, and "${ref}" is none of them. Nothing was spent.`, retry: true };
    }
    if (!withinFeet(encounter.id, ctx.sheet.id, enemy.id, SHROUD_FEET)) {
      return { error: `${enemy.displayName} is beyond ${SHROUD_FEET} feet of ${ctx.sheet.name}, and ${SHROUD} reaches ${SHROUD_FEET} feet. Nothing was spent.`, refused: "rules" };
    }
    const unseen = unseenBecause(encounter.id, ctx.sheet, enemy);
    if (unseen) {
      return { error: `${ctx.sheet.name} cannot see ${enemy.displayName} (${unseen}), and ${SHROUD} strikes creatures they can see. Nothing was spent.`, refused: "rules" };
    }
  }
  return null;
}

// What is asked of a use of Arcane Deflection before anything is spent: a
// shroud's named creatures are in its reach, and, for the save's half, the
// whole of it (its result, or its refusal). Null when the call answers a hit.
export function deflectionFirst(ctx: Ctx, variant: string, name: string, bonus: number, label: string): ToolResult | ToolError | null {
  return shroudRefusal(ctx) ?? deflectSaveHalf(ctx, variant, name, bonus, label);
}

// Deflecting Shroud: half the wizard level in force to up to three creatures.
function deflectingShroud(ctx: Ctx, holder: CharacterSheet): Record<string, unknown> {
  const encounter = ctx.encounter;
  if (!encounter || !holdsFeature(holder, SHROUD)) {
    return {};
  }
  const amount = Math.floor(classLevelOf(holder, "wizard") / 2);
  const reach = shroudReach(ctx, holder);
  const named = shroudNamed(ctx).map((ref) => resolveTargetFoe(ctx.campaign.id, encounter, ref)?.id);
  const feet = (enemy: EncounterEnemy) => feetBetween(encounter.id, holder.id, enemy.id) ?? 0;
  const chosen = (named.length ? reach.filter((enemy) => named.includes(enemy.id)) : [...reach].sort((a, b) => feet(a) - feet(b))).slice(0, SHROUD_MOST);
  if (!chosen.length || amount < 1) {
    return { shroud: `${SHROUD}: no creature ${holder.name} can see stands within ${SHROUD_FEET} feet.` };
  }
  const struck: string[] = [];
  for (const target of chosen) {
    const enemy = getEnemy(target.id) ?? target;
    const before = enemy.currentHp;
    applyEnemyDamage(ctx.campaign, ctx.turn, encounter, enemy, amount, ctx.sheets, ctx.sheetsById, "force", { magical: true });
    const after = getEnemy(target.id)?.currentHp ?? before;
    struck.push(`${enemy.displayName} takes ${Math.max(0, before - after)} force`);
  }
  publishEncounter(ctx.campaign.id);
  return { shroud: `${SHROUD} (${amount} force, half ${holder.name}'s wizard level, to up to three creatures within ${SHROUD_FEET} feet): ${struck.join("; ")}.` };
}

// The mark, laid with the reaction's own audit row so "Revert this turn"
// takes it back with the reaction.
function layPrice(ctx: Ctx, holder: CharacterSheet): string {
  const now = getSheetById(holder.id) ?? holder;
  const kept = now.conditions.filter((entry) => !isConditionNamed(entry, DEFLECTED));
  const meta = Object.fromEntries(Object.entries(now.conditionMeta ?? {}).filter(([name]) => !isConditionNamed(name, DEFLECTED)));
  const fighting = Boolean(ctx.encounter && ctx.encounter.status === "active");
  reactionPatch(
    ctx.campaign,
    ctx.turn.id,
    now.id,
    {
      conditions: [...kept, DEFLECTED],
      conditionMeta: { ...meta, [DEFLECTED]: fighting ? { untilTurnEndOf: now.id, source: "Arcane Deflection" } : { rounds: 1, source: "Arcane Deflection" } },
    },
    "Arcane Deflection: only cantrips until the end of their next turn",
  );
  return `${now.name} casts only cantrips until the end of their next turn.`;
}

// What a use of Arcane Deflection leaves behind, for the reaction's result.
export function deflectionAftermath(ctx: Ctx, holder: CharacterSheet): Record<string, unknown> {
  return { price: layPrice(ctx, holder), ...deflectingShroud(ctx, holder) };
}
