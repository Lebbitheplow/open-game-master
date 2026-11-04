// What a Ring of Spell Storing's row holds, written and taken away. Split from
// spell-storing.ts because the cast guard and the held castings reach it, and
// they must not reach what that module does. The rules are in
// src/lib/srd/spell-storing.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { writeCharges } from "@/lib/dm/item-charges";
import { carriedItemsMatching } from "@/lib/dm/item-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { computeSheetDerived, spellAttackFor, spellSaveDcFor } from "@/lib/srd";
import { recordItemCast } from "@/lib/srd/item-cast-credit";
import {
  isSpellStorer,
  SPELL_STORE_LEVELS,
  storedSpellNamed,
  storedSpellsOf,
  storeLevelsFree,
  type StoredSpell,
} from "@/lib/srd/spell-storing";

export function storerNamed(sheet: CharacterSheet, itemName: string): EquipmentItem | null {
  return carriedItemsMatching(sheet.equipment, itemName).find(isSpellStorer) ?? null;
}

function withStored(equipment: readonly EquipmentItem[], ring: EquipmentItem, storedSpells: StoredSpell[]): EquipmentItem[] {
  return equipment.map((item) => (item === ring ? { ...item, storedSpells: storedSpells.length ? storedSpells : undefined } : item));
}

// Why this spell at this level cannot go in the ring as it stands, or null. A
// ring that has gone, or filled up since a casting began, is asked the same.
export function storeRefusal(holderId: string, ringName: string, spell: string, level: number): ToolError | null {
  const holder = getSheetById(holderId);
  const ring = holder ? storerNamed(holder, ringName) : null;
  if (!ring) {
    return { error: `No Ring of Spell Storing named "${ringName}" is there to hold ${spell}. Nothing was spent.`, retry: true };
  }
  if (level < 1 || level > SPELL_STORE_LEVELS) {
    return { error: `${ring.name} stores spells of 1st through 5th level, not level ${level}. Nothing was spent.`, refused: "rules" };
  }
  const free = storeLevelsFree(ring);
  return level > free ? { error: `${ring.name} has ${free} of ${SPELL_STORE_LEVELS} levels free, and ${spell} at level ${level} does not fit. Nothing was spent.`, refused: "rules" } : null;
}

// The numbers a stored spell keeps from the caster who cast it into the ring.
// The modifier is the spell's own ability's, read as heal-spell.ts reads it
// from the save DC.
export function casterNumbers(caster: CharacterSheet, spell: string): Pick<StoredSpell, "saveDc" | "attackBonus" | "abilityMod"> {
  const saveDc = spellSaveDcFor(caster, spell);
  const attackBonus = spellAttackFor(caster, spell);
  return {
    ...(saveDc ? { saveDc, abilityMod: saveDc - 8 - computeSheetDerived(caster).proficiencyBonus } : {}),
    ...(attackBonus ? { attackBonus } : {}),
  };
}

// Puts a spell in the ring, asked first with storeRefusal. Reads the sheet
// again: the caster's own cast may have just written this same one.
export function putInRing(campaign: Campaign, turnId: string | null, holderId: string, ringName: string, entry: StoredSpell) {
  const holder = getSheetById(holderId);
  const ring = holder ? storerNamed(holder, ringName) : null;
  if (holder && ring) {
    writeCharges(campaign.id, holder, withStored(holder.equipment, ring, [...storedSpellsOf(ring), entry]), "use_spell_slot", `${entry.spell} stored in ${ring.name}`, turnId);
  }
}

// The spell has been cast, so it leaves the ring and frees its space.
export function takeFromRing(campaign: Campaign, turnId: string | null, sheetId: string, ringName: string, spell: string) {
  const sheet = getSheetById(sheetId);
  const ring = sheet ? storerNamed(sheet, ringName) : null;
  const entry = ring ? storedSpellNamed(ring, spell) : null;
  if (sheet && ring && entry) {
    writeCharges(campaign.id, sheet, withStored(sheet.equipment, ring, storedSpellsOf(ring).filter((other) => other !== entry)), "use_item", `${entry.spell} cast from ${ring.name}`, turnId);
  }
}

// The credit the spell's own tool takes (src/lib/srd/item-cast-credit.ts). The
// spell stays in the ring until that tool casts it, so a cast the rules refuse
// loses nothing.
export function creditStoredSpell(sheetId: string, ring: { name: string }, entry: StoredSpell) {
  recordItemCast(sheetId, {
    spell: entry.spell,
    level: entry.level,
    item: ring.name,
    storedIn: ring.name,
    ...(entry.saveDc ? { saveDc: entry.saveDc } : {}),
    ...(entry.attackBonus ? { attackBonus: entry.attackBonus } : {}),
    ...(entry.abilityMod !== undefined ? { abilityMod: entry.abilityMod } : {}),
  });
}
