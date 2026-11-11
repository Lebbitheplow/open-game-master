// The two things a wizard's feature makes that hold one spell and do not last:
// a Chronurgist's bead and a Scribe's scroll. Each is a row of the pack like
// any other, marked `conjured`, so it is carried, handed over and seen as an
// item is; this module says what the mark means.
//
// Arcane Abeyance (Chronurgy Magic 10): "Store a spell of 4th level or lower
// for an hour in a bead that anyone can break to cast it with your spell save
// DC and spell attack bonus". The bead is a spell storer of one spell
// (src/lib/srd/spell-storing.ts isSpellStorer reads isBead): its row carries
// the spell in storedSpells, as a Ring of Spell Storing's does, with the level
// of the slot it was cast from and its wizard's numbers, and `until`, the
// minute of the campaign clock it fades at.
//
// Master Scrivener (Order of Scribes 10): "create a magic scroll of a 1st- or
// 2nd-level wizard spell from your book with a casting time of an action; it
// is cast as if one level higher, and it vanishes once cast or when you finish
// a long rest." The scroll is a spell scroll (tags scroll, its spell in
// `spell`), read through the scroll door (src/lib/dm/consumables.ts), which
// asks scrollCastLevel for the level it casts at.
//
// Pure: the Hand reads it too (hand-ring.ts through spell-storing.ts,
// hand-items.ts).

import { findNamed, textKey } from "@/lib/language/text-logic";
import type { EquipmentItem } from "@/lib/schemas/sheet";

type Marked = { conjured?: EquipmentItem["conjured"] };

// The name the store door is asked for when a spell goes into a new bead
// (cast-guard.ts `storing.ring`): no row answers to it, a bead is made.
export const BEAD_SLOT = "Arcane Abeyance bead";
export const BEAD_MAX_LEVEL = 4;
export const BEAD_MINUTES = 60;

export const isBead = (item: Marked): boolean => item.conjured?.kind === "bead";
export const isScrivenerScroll = (item: Marked): boolean => item.conjured?.kind === "scroll";
// By the feature's name too: storeIn "Arcane Abeyance".
export const isBeadSlot = (name: string): boolean => [BEAD_SLOT, "Arcane Abeyance"].some((slot) => textKey(slot) === textKey(name));

// A name no row of this pack has yet: the tools tell rows apart by name, so a
// second bead of one spell is numbered as a second ring is.
export function freeRowName(equipment: readonly Pick<EquipmentItem, "name">[], base: string): string {
  let name = base;
  for (let number = 2; findNamed(equipment, name, (item) => [item.name]); number += 1) {
    name = `${base} (${number})`;
  }
  return name;
}

export const beadName = (spell: string) => `Abeyance Bead (${spell})`;
export const scrivenerScrollName = (spell: string) => `Scrivener's Scroll (${spell})`;

// The pack once the hour of each bead in it has run out, or null when none has.
export function withoutFadedBeads<T extends Marked>(equipment: readonly T[], now: number): T[] | null {
  const kept = equipment.filter((item) => !(isBead(item) && typeof item.conjured?.until === "number" && item.conjured.until <= now));
  return kept.length === equipment.length ? null : kept;
}

// The pack after its holder's long rest: a Master Scrivener's scroll vanishes
// "when you finish a long rest", and no bead outlasts the night. Null when the
// pack holds neither.
export function withoutConjuredAtLongRest<T extends Marked>(equipment: readonly T[] | undefined): T[] | null {
  if (!equipment) {
    return null;
  }
  const kept = equipment.filter((item) => !isBead(item) && !isScrivenerScroll(item));
  return kept.length === equipment.length ? null : kept;
}

// The level a scroll's spell is cast at: its own, or one higher from a Master
// Scrivener's scroll ("it is cast as if one level higher").
export function scrollCastLevel(item: Marked, level: number): number {
  return isScrivenerScroll(item) ? Math.min(9, level + 1) : level;
}
