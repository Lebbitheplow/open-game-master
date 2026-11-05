// What a Ring of Spell Storing holds. The row carries its own spells, so they
// go where the ring goes.
//
// SRD 5.1, Ring of Spell Storing: it stores spells of 1st through 5th level
// cast into it, up to five levels in all, and the level of the slot used is
// the space a spell takes. A stored spell keeps the slot level, spell save DC
// and spell attack bonus of its original caster, and casting it frees the
// space.
//
// Pure: the row in, the words and the numbers out.

import { findNamed, textKey } from "@/lib/language/text-logic";
import { isWorn } from "@/lib/srd/armor";
import { isWorkshopRow, type RowItem } from "@/lib/srd/item-row";
import { matchMagicItem } from "@/lib/srd/magic-items";
import type { EquipmentItem } from "@/lib/schemas/sheet";

export const SPELL_STORE_LEVELS = 5;

export type StoredSpell = NonNullable<EquipmentItem["storedSpells"]>[number];

type StorerRow = RowItem & { identified?: boolean; storedSpells?: StoredSpell[] };

// By the row's slug, so a ring named in the table's language is one too. A
// mystery ring is not known to be one until reveal_item names it, and a workshop
// entry is not the published item it may share a name with.
export function isSpellStorer(item: StorerRow): boolean {
  return item.identified !== false && !isWorkshopRow(item) && Boolean(matchMagicItem(item)?.slugs?.includes("ring-of-spell-storing"));
}

export function storedSpellsOf(item: StorerRow): StoredSpell[] {
  return item.storedSpells ?? [];
}

export function storeLevelsFree(item: StorerRow): number {
  return SPELL_STORE_LEVELS - storedSpellsOf(item).reduce((sum, entry) => sum + entry.level, 0);
}

export function storedSpellNamed(item: StorerRow, spell: string): StoredSpell | null {
  return findNamed(storedSpellsOf(item), spell, (entry) => [entry.spell]);
}

// The carried ring holding this spell, for a caster told to cast it from there.
export function storerHolding<T extends StorerRow>(equipment: readonly T[], spell: string): T | null {
  return equipment.find((item) => isSpellStorer(item) && storedSpellNamed(item, spell)) ?? null;
}

function storedWords(entry: StoredSpell): string {
  const numbers = [entry.saveDc ? `save DC ${entry.saveDc}` : "", entry.attackBonus ? `attack +${entry.attackBonus}` : ""].filter(Boolean);
  return `${entry.spell} (level ${entry.level}${numbers.length ? `, ${numbers.join(", ")}` : ""})`;
}

// Why its wearer cannot cast from this ring as they stand, or null: the ring's
// own two conditions, in the words the card greys with and use_item refuses with.
export function ringBarrier(sheet: { name: string; equipment: readonly EquipmentItem[] }, ring: EquipmentItem): string | null {
  if (!ring.attuned) {
    return `${ring.name} works only for someone attuned to it, and ${sheet.name} is not; attuning takes a short rest with the item. Nothing was spent.`;
  }
  return isWorn(ring, sheet.equipment) ? null : `${ring.name} casts its spells only while it is worn, and ${sheet.name} is not wearing it. Nothing was spent.`;
}

// The ring's words on the model's GAME STATE line.
export function storedSpellsLine(item: StorerRow): string {
  const held = storedSpellsOf(item);
  const free = `${storeLevelsFree(item)} of ${SPELL_STORE_LEVELS} levels free`;
  return held.length ? `holds ${held.map(storedWords).join(", ")}; ${free}` : `holds no spells; ${free}`;
}

// The sheet's short line under the ring.
export function storedSpellsSummary(item: StorerRow): string {
  const held = storedSpellsOf(item);
  return held.length ? `Holds ${held.map((entry) => `${entry.spell} (level ${entry.level})`).join(", ")}` : "Holds no spells";
}
