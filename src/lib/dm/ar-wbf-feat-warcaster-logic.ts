// War Caster's third clause: "you can cast a one-action spell targeting one
// creature as an opportunity attack." On the battle map the server rolls an
// opportunity attack itself the moment a creature leaves a reach
// (src/lib/dm/opportunity.ts), so the choice of a spell cannot wait for the
// trigger: the War Caster names the spell beforehand (use_resource "War
// Caster" with the spell as variant, ar-wbf-feat-warcaster.ts), and it stays
// on their sheet as the mark below until they name another or go back to the
// weapon. Everything that asks "which spell, if any" reads it here.
//
// No database in this file: the cast guard reads it (cast-guard.ts), and the
// door that casts reaches the guard.
import { AsyncLocalStorage } from "node:async_hooks";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeat } from "@/lib/srd/feat-use";
import { opportunitySpellOf } from "@/lib/dm/ar-wbf-feat-warcaster-rule";

export { isOpportunityMark, opportunityMark, opportunitySpellOf, opportunitySpellProblem } from "@/lib/dm/ar-wbf-feat-warcaster-rule";

// The character whose opportunity spell is being cast: the cast guard prices
// that casting as a reaction, not as the action its casting time names.
const casting = new AsyncLocalStorage<string>();

export function asOpportunityCast<T>(sheetId: string, run: () => T): T {
  return casting.run(sheetId, run);
}

export function castsAsOpportunity(sheetId: string): boolean {
  return casting.getStore() === sheetId;
}

// One sentence for a refusal that tells a War Caster where the choice is made.
export function warCasterPointer(sheet: Pick<CharacterSheet, "name" | "feats" | "conditions">): string {
  if (!holdsFeat(sheet, "War Caster")) {
    return "";
  }
  const spell = opportunitySpellOf(sheet);
  return spell
    ? ` War Caster: ${sheet.name}'s opportunity attacks cast ${spell}; use_resource "War Caster" with another spell (or "weapon") as variant changes it.`
    : ` War Caster: use_resource "War Caster" with a one-action spell as variant makes ${sheet.name}'s opportunity attacks cast it.`;
}
