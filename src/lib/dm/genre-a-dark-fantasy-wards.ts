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
// - Threnody: a creature that failed it "deal[s] half damage on their next
//   attack", weapon or spell; the attack that lands spends it.
import { listSheets } from "@/lib/db/sheets";
import { getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { THRENODY } from "@/lib/srd/genre-a-dark-fantasy-conditions";
import { withinFeet } from "@/lib/dm/authored-saves";
import { computeSheetDerived } from "@/lib/srd";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function darkFantasyWeaponWard(
  encounterId: string,
  attackerId: string,
  target: CharacterSheet,
  attack: { spellAttack?: boolean },
  amount: number,
): { amount: number; notes: string[] } {
  if (amount <= 0) {
    return { amount, notes: [] };
  }
  const notes: string[] = [];
  const foe = getEnemy(attackerId);
  const dirge = foe?.conditions.find((entry) => isConditionNamed(entry, THRENODY));
  if (foe && dirge) {
    const cleared = removeConditions(foe.conditions, foe.conditionMeta as ConditionMetaMap, [dirge]);
    patchEnemyConditions(foe.id, cleared.conditions, cleared.meta as typeof foe.conditionMeta);
    amount = Math.floor(amount / 2);
    notes.push(`Threnody: ${foe.displayName}'s blow deals half damage, and the dirge's hold on it ends.`);
  }
  if (attack.spellAttack || amount <= 0) {
    return { amount, notes };
  }
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

// The Litany Unbroken (15th): "Concentration on your litanies cannot be broken
// by damage of 20 or less". Every spell the witch hunter casts is a litany
// (Litany: "Casts paladin-list spells as litanies"), so damage of 20 or less
// asks no save; dropping to 0 still ends it (concentration.ts asks that first).
export function litanyHolds(sheet: CharacterSheet, damage: number): string | null {
  return damage <= 20 && holdsFeature(sheet, "The Litany Unbroken") ? "The Litany Unbroken: damage of 20 or less cannot break a litany" : null;
}
