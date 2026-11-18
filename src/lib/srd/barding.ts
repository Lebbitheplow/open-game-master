// Barding: armor for a mount.
//
// "Barding is armor designed to protect an animal's head, neck, chest, and
// body. Any type of armor shown on the Armor table can be purchased as
// barding" (SRD 5.1, Mounts and Vehicles). The rules give it no numbers of
// its own, so it is the suit it is named for: that suit's Armor Class with
// as much of the mount's Dexterity as the suit lets through.
//
// A mount has no pack of its own. Barding its rider carries is what the
// mount wears, as a saddle is read (src/lib/dm/mount-tools.ts): a row named
// for a suit and the word barding ("Chain Mail Barding", "Barding (Plate)",
// "Barding, Leather").

import { abilityMod } from "@/lib/srd";
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

export function bardingAc(suit: SrdArmor, dexScore: number): number {
  const dex = abilityMod(dexScore);
  // Heavy armor takes none of the modifier, in either direction (armor.ts dexThrough).
  return suit.baseAc + (suit.category === "heavy" ? 0 : Math.min(dex, suit.dexCap ?? dex));
}

// The best barding among what a rider carries, on a mount of this
// Dexterity: its name as carried and the Armor Class it gives.
export function carriedBarding(equipment: readonly RowItem[], dexScore: number): { name: string; ac: number } | null {
  let best: { name: string; ac: number } | null = null;
  for (const item of equipment) {
    const name = rowName(item);
    const suit = bardingSuit(name);
    const ac = suit ? bardingAc(suit, dexScore) : 0;
    if (suit && (!best || ac > best.ac)) {
      best = { name, ac };
    }
  }
  return best;
}
