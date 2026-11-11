// Arcane Deflection as the engine resolves it (wizard, War Magic 2): "A
// reaction after being hit or failing a save grants +2 AC or +4 on the save,
// at the cost of casting only cantrips on your next turn"
// (src/lib/srd/subclasses.json, wizard::Arcane Deflection).
//
// The +2 against a hit is the authored reaction's own (ac_vs_hit in
// src/lib/dm/authored-reactions.ts). This module holds what that row could
// not say, and is called from there:
//
//   - The other half (deflectSaveHalf, from the row's resolver before
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
import type { CharacterSheet } from "@/lib/schemas/sheet";
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

// The saving throw the wizard has just failed, off the roll record: the
// latest one failed in the turn now running, or out of a fight their latest
// roll when it is one.
function failedSaveOf(campaignId: string, sheetId: string, encounter: Encounter): StoredRoll | null {
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
  const failed = failedSaveOf(campaignId, sheet.id, encounter);
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
export function deflectSaveHalf(ctx: Ctx, variant: string, name: string, bonus: number, label: string): ToolResult | ToolError | null {
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
  return { price: layPrice(ctx, holder) };
}
