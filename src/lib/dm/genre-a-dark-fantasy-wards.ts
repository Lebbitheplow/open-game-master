// The dark fantasy classes' cuts to a weapon blow that lands on a character,
// read once by src/lib/dm/enemy-attack.ts as each hit's damage is settled, before
// the target's resistances. Both keep at least 1 of a blow that dealt any:
// - Sepulchral Aura: "Enemies within 5 ft deal 1 less damage with weapon
//   attacks (minimum 1)", 10 feet from Sepulchral Dominion; one knight's aura
//   counts once, whoever the blow lands on.
// - Numb to the Lash: "Reduce all incoming weapon damage by your WIS modifier
//   (minimum 1 damage taken)", the penitent's own.
// A spell attack is no weapon attack and passes untouched. Off a board range is
// open, as the reactions and the auras read it.
import { listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function darkFantasyWeaponWard(
  encounterId: string,
  attackerId: string,
  target: CharacterSheet,
  attack: { spellAttack?: boolean },
  amount: number,
): { amount: number; notes: string[] } {
  if (amount <= 0 || attack.spellAttack) {
    return { amount, notes: [] };
  }
  const notes: string[] = [];
  let cut = 0;
  const knight = listSheets(target.campaignId).find(
    (sheet) =>
      holdsFeature(sheet, "Sepulchral Aura") &&
      sheet.currentHp > 0 &&
      !sheet.deathSaves?.dead &&
      withinFeet(encounterId, sheet.id, attackerId, holdsFeature(sheet, "Sepulchral Dominion") ? 10 : 5),
  );
  if (knight) {
    cut += 1;
    notes.push(`${knight.name}'s Sepulchral Aura: 1 less damage.`);
  }
  if (holdsFeature(target, "Numb to the Lash")) {
    const wis = Math.max(0, computeSheetDerived(target).abilityMods.wis ?? 0);
    if (wis > 0) {
      cut += wis;
      notes.push(`${target.name}'s Numb to the Lash: ${wis} less damage.`);
    }
  }
  return cut ? { amount: Math.max(1, amount - cut), notes } : { amount, notes };
}
