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
import type { SpellMech } from "@/lib/srd/spell-mech-types";

const MARK = /^opportunity spell \((.+)\)$/i;

export const opportunityMark = (spell: string) => `opportunity spell (${spell.trim()})`;
export const isOpportunityMark = (condition: string) => MARK.test(condition.trim());

// The spell a War Caster's opportunity attacks cast, or null for the weapon.
export function opportunitySpellOf(sheet: Pick<CharacterSheet, "feats" | "conditions">): string | null {
  if (!holdsFeat(sheet, "War Caster")) {
    return null;
  }
  for (const entry of sheet.conditions) {
    const hit = MARK.exec(entry.trim());
    if (hit) {
      return hit[1];
    }
  }
  return null;
}

// "The spell must have a casting time of 1 action and must target only that
// creature": a spell attack, a save one creature makes, or one that strikes
// with no roll, and nothing with an area. The sentence that refuses, or null.
export function opportunitySpellProblem(name: string, castingTime: unknown, mech: Pick<SpellMech, "resolution" | "area"> | null): string | null {
  if (castingTime !== "action") {
    return `${name} does not have a casting time of 1 action, and War Caster's spell must.`;
  }
  if (!mech || mech.area || !(mech.resolution === "attack" || mech.resolution === "save" || mech.resolution === "auto")) {
    return `${name} is not a spell aimed at one creature alone (a spell attack, or a save that one creature makes), and War Caster's spell must target only the creature that provoked.`;
  }
  return null;
}

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
