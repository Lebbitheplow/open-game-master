// Barding: armor for a mount.
//
// "Barding is armor designed to protect an animal's head, neck, chest, and
// body. Any type of armor shown on the Armor table can be purchased as
// barding" (SRD 5.1, Mounts and Vehicles). The rules give it no numbers of
// its own, so it is the suit it is named for: that suit's Armor Class with
// as much of the mount's Dexterity as the suit lets through.
//
// A mount has no pack of its own. Barding is a row in its rider's equipment
// named for a suit and the word barding ("Chain Mail Barding", "Barding
// (Plate)", "Barding, Leather"), and it is tack (src/lib/srd/tack.ts): on
// the mount unless its player packed it, where it protects the mount and
// weighs nothing for the rider. Packed, it protects nothing and "weighs
// twice as much" as the suit.
//
// No import of the srd index here: the weight counter reads this module and
// the index reads the weight counter.

import { armorNamed, type SrdArmor } from "@/lib/srd/armor";
import { rowName, type RowItem } from "@/lib/srd/item-row";
import { textKey, words } from "@/lib/language/text-logic";

// The word that makes a suit's row barding, as the SRD's table names it.
const BARDING = textKey("barding");

// The suit a row of barding is made as, or null: a row that is no barding,
// names no suit, or names a shield.
export function bardingSuit(name: string): SrdArmor | null {
  const named = words(name);
  const rest = named.filter((word) => textKey(word) !== BARDING);
  if (rest.length === named.length || !rest.length) {
    return null;
  }
  // The rest of the row is the suit, by its whole name.
  const suit = armorNamed(rest.join(" "));
  return suit && suit.category !== "shield" ? suit : null;
}

// "Barding ... weighs twice as much" as the equivalent armor made for
// humanoids (SRD 5.1, Mounts and Vehicles).
export function bardingWeightLb(name: string): number | null {
  const suit = bardingSuit(name);
  return suit ? suit.weightLb * 2 : null;
}

export function bardingAc(suit: SrdArmor, dexScore: number): number {
  const dex = Math.floor((dexScore - 10) / 2);
  // Heavy armor takes none of the modifier, in either direction (armor.ts dexThrough).
  return suit.baseAc + (suit.category === "heavy" ? 0 : Math.min(dex, suit.dexCap ?? dex));
}

// The best barding on the mount among a rider's rows, for a mount of this
// Dexterity: its name as carried and the Armor Class it gives. One the
// player packed is cargo and protects nothing.
export function carriedBarding(equipment: ReadonlyArray<RowItem & { equipped?: boolean }>, dexScore: number): { name: string; ac: number } | null {
  let best: { name: string; ac: number } | null = null;
  for (const item of equipment) {
    if (item.equipped === false) {
      continue;
    }
    const name = rowName(item);
    const suit = bardingSuit(name);
    const ac = suit ? bardingAc(suit, dexScore) : 0;
    if (suit && (!best || ac > best.ac)) {
      best = { name, ac };
    }
  }
  return best;
}
