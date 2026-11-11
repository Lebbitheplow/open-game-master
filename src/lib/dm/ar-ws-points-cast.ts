// A spell a sorcerer pays for with sorcery points in place of a spell slot.
//
// Two origins give one: Shadow Magic's Eyes of the Dark ("From 3rd level you
// know darkness ... you can cast it with 2 sorcery points as well as a slot,
// and when you do you can see through that darkness") and the Aberrant Mind's
// Psionic Sorcery ("Cast your psionic spells by spending sorcery points equal
// to the spell's level instead of a slot, with no verbal, somatic or costly
// components"). Both rows said the cast tools did it "with the points spent",
// and the cast tools had no such price: with no slot left the casting was
// refused, and a silenced Aberrant Mind could not cast at all.
//
// The cast guard (cast-guard.ts castSpell, the one door every casting pays
// through) asks here, so every cast tool reads one rule. The cast tools carry
// no word for how a casting is paid, so the payment is read from what the call
// already says:
//
//   - Darkness (Eyes of the Dark): the points pay when the call names no slot
//     level and 2 points are held, since the casting they buy is the better
//     one (seen through) and the feature is how a shadow sorcerer casts it.
//     A slot level named spends that slot, as the text's "as well as a slot"
//     allows; with no slot that can pay, the points pay whatever was named.
//   - A psionic spell (Psionic Sorcery): a slot pays while one can and the
//     caster can make the spell's components. The points pay, equal to the
//     spell's own level, once no slot can, or when the caster cannot speak,
//     gesture or produce the material: cast for points it needs none of them.
//
// Points cast a spell at its own level only. A psionic spell is one of the
// origin's Psionic Spells table at the sorcerer's level, or the spell a
// level-up put in the place of one (the sheet's record,
// ar-ws-spell-swap-record.ts): the one swapped in is paid with points, the
// one given up no longer. None of the table's spells consumes a costly material, so a
// casting the points pay because no slot is left reads the material as the
// slot would (the caster had it, and nothing is used up).
//
// The offer itself is pure and lives in ar-ws-points-offer.ts, so the Hand's
// spell card can ask it without the database (hand-spells.ts). This module
// borrows the silence and material checks. Must not import cast-guard.ts
// (which imports it).

import { materialPlan } from "@/lib/dm/cast-materials";
import type { SlotPlan } from "@/lib/dm/cast-rules";
import type { ToolError } from "@/lib/dm/tool-errors";
import { silenceProblem } from "@/lib/dm/zone-rules";
import { pointsLeft, POOL, type PointsOffer } from "@/lib/dm/ar-ws-points-offer";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";

// The pure half (what a casting may be paid with), which the Hand reads too.
export { bareFacts, pointsOfferFor, type PointsOffer } from "@/lib/dm/ar-ws-points-offer";

// Whether the points pay before any slot is asked for: the offer says so and
// the points are there, or the spell is cast bare and the caster cannot make
// its components as written (`problem` is the hands' and the focus's refusal;
// the silence and the material are asked here).
export function pointsPayFirst(
  campaignId: string,
  sheet: CharacterSheet,
  offer: PointsOffer | null,
  made: { facts: SpellFacts | null; problem: ToolError | null },
  ctx: { inFight: boolean; units?: number },
): boolean {
  if (!offer) {
    return false;
  }
  if (offer.first && pointsLeft(sheet) >= offer.points) {
    return true;
  }
  if (!offer.bare) {
    return false;
  }
  if (made.problem || silenceProblem(campaignId, sheet.id, sheet.name, made.facts)) {
    return true;
  }
  return "error" in materialPlan(sheet, made.facts, { inFight: ctx.inFight, units: ctx.units, slotLevel: offer.level });
}

// The casting's price in points, or the refusal when they are short.
export function pointsPlan(sheet: CharacterSheet, name: string, offer: PointsOffer): SlotPlan | ToolError {
  const left = pointsLeft(sheet);
  if (left < offer.points) {
    return {
      error: `${sheet.name} has ${left} sorcery point${left === 1 ? "" : "s"} left, and ${name} through ${offer.feature} costs ${offer.points}. Nothing was spent.`,
      refused: "rules",
    };
  }
  const how = offer.bare ? ", with no verbal, somatic or material component" : offer.seesThrough ? `; ${sheet.name} sees through it` : "";
  return { kind: "none", note: `${name} is cast with ${offer.points} sorcery point${offer.points === 1 ? "" : "s"} in place of a spell slot (${offer.feature})${how}. ${left - offer.points} left.` };
}

// With no slot that can pay, the points do when they are there. A slot's own
// refusal stands when they are not.
export function pointsWhenNoSlot(sheet: CharacterSheet, name: string, offer: PointsOffer | null, planned: SlotPlan | ToolError): { slot: SlotPlan | ToolError; paid: boolean } {
  if (!offer || !("error" in planned) || pointsLeft(sheet) < offer.points) {
    return { slot: planned, paid: false };
  }
  return { slot: pointsPlan(sheet, name, offer), paid: true };
}

// The points taken, on top of whatever the casting already wrote to the
// resources.
export function pointsSpent(sheet: CharacterSheet, patch: FullPatchSheetInput, offer: PointsOffer): FullPatchSheetInput["resources"] {
  const resources = patch.resources ?? sheet.resources;
  const state = resources[POOL];
  return { ...resources, [POOL]: { ...state, used: state.used + offer.points } };
}
