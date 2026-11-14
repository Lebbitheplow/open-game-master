// The horror features that read the whole party (WAVE2 D5):
//   Sole Survivor (survivor 15): "While you are the last conscious party
//     member, resist all damage and your speed doubles": read live, every
//     blow (pc-damage.ts blowDefenses) and every board move
//     (battlemap/view.ts), so it holds from the moment the last ally drops
//     and ends the moment one stands, with no condition to lay or forget.
// A party member is a character of the campaign; one at 0 hit points, dead,
// or unconscious is not conscious.
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { DAMAGE_TYPES } from "@/lib/srd/authored-effects";
import { horrorHolds } from "@/lib/srd/genre-a-horror-holds";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const conscious = (sheet: CharacterSheet) =>
  sheet.currentHp > 0 && !sheet.deathSaves?.dead && !sheet.conditions.some((entry) => isConditionNamed(entry, "unconscious"));

// The holder is conscious and every other party member is not (a party of one
// has no last member: the text names a party the others have fallen from).
export function lastConscious(campaignId: string, sheet: CharacterSheet): boolean {
  if (!conscious(sheet)) {
    return false;
  }
  const others = listSheets(campaignId).filter((entry) => entry.id !== sheet.id).map((entry) => getSheetById(entry.id) ?? entry);
  return others.length > 0 && !others.some(conscious);
}

const soleSurvivor = (campaignId: string, sheet: CharacterSheet) => horrorHolds(sheet, "Sole Survivor") && lastConscious(campaignId, sheet);

// The resistances Sole Survivor adds to a blow's defenses: every type.
export function soleSurvivorResistances(campaignId: string, sheet: CharacterSheet): string {
  return soleSurvivor(campaignId, sheet) ? DAMAGE_TYPES.join(", ") : "";
}

// The speed Sole Survivor doubles.
export function soleSurvivorSpeed(campaignId: string, sheet: CharacterSheet, speed: number): number {
  return soleSurvivor(campaignId, sheet) ? speed * 2 : speed;
}
