// The cyberpunk classes' defenses that read a moment, not just the sheet
// (WAVE2 D5): each is a row of src/lib/srd/authored-effects-genre-a-cyberpunk.ts
// and this module is its one reader, called from the door the moment passes
// through, so no other door can read the row differently.
//   fall_resist (Kinetic Buffer, "Resistance to falling damage"): the fall
//     in src/lib/dm/hazard-tools.ts adds the fall's own type to the
//     resistances applyPcDamage weighs, so it never halves twice;
//   concentration_adv (Split Focus, "Advantage on concentration saves"):
//     the concentration save in src/lib/dm/concentration.ts;
//   attacked_disadv with besideDowned (Shield the Fallen, "While adjacent to
//     a downed ally, attacks against you have disadvantage"): the incoming
//     attack in src/lib/dm/authored-hooks.ts authoredIncomingAttack.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { activeAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";

// The fall's damage type when a row resists falling, for applyPcDamage's
// `resists`; nothing otherwise.
export function fallResistances(sheet: AuthoredSheet, damageType: string): string[] {
  return activeAuthored(sheet, "fall_resist").length ? [damageType] : [];
}

// The feature that gives advantage on the save to keep concentration.
export function concentrationAdvantage(sheet: AuthoredSheet): string | null {
  return activeAuthored(sheet, "concentration_adv")[0]?.held.feature ?? null;
}

// "Downed": at 0 hit points and not dead, a creature to stand over.
const downed = (sheet: Pick<CharacterSheet, "currentHp" | "deathSaves">) => sheet.currentHp <= 0 && !sheet.deathSaves?.dead;

// An ally of `target` at 0 hit points within 5 feet of them on the board.
export function besideDownedAlly(campaignId: string, encounterId: string, target: Pick<CharacterSheet, "id">): CharacterSheet | null {
  const party = listSheets(campaignId).map((stale) => getSheetById(stale.id) ?? stale);
  return party.find((ally) => ally.id !== target.id && downed(ally) && withinFeet(encounterId, target.id, ally.id, 5)) ?? null;
}
