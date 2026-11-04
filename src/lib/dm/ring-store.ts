// What a Ring of Spell Storing's row holds, written and taken away. Split from
// spell-storing.ts because the cast guard and the held castings reach it, and
// they must not reach what that module does. The rules are in
// src/lib/srd/spell-storing.ts.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { writeCharges } from "@/lib/dm/item-charges";
import { carriedItemsMatching } from "@/lib/dm/item-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { findNamed } from "@/lib/language/text-logic";
import { computeSheetDerived, spellAttackFor, spellSaveDcFor } from "@/lib/srd";
import { recordItemCast, runningItemSpell, type ItemCast } from "@/lib/srd/item-cast-credit";
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

// The item's numbers ride on its row while the spell holds, for its later
// effects (item-cast-credit.ts runningItemSpell). What has ended goes as this
// is written, and a scroll used up has no row: its spell keeps the old way.
export function noteRunning(sheetId: string, cast: ItemCast) {
  const sheet = getSheetById(sheetId);
  const row = sheet ? findNamed(sheet.equipment, cast.item, (item) => [item.name]) : null;
  if (!sheet || !row) {
    return;
  }
  const kept = (row.castRunning ?? []).filter((entry) => !findNamed([entry], cast.spell, (one) => [one.spell]) && runningItemSpell(sheet, entry.spell));
  const entry = {
    spell: cast.spell,
    level: cast.level,
    ...(cast.saveDc ? { saveDc: cast.saveDc } : {}),
    ...(cast.attackBonus ? { attackBonus: cast.attackBonus } : {}),
    ...(cast.abilityMod !== undefined ? { abilityMod: cast.abilityMod } : {}),
  };
  patchSheet(sheet.id, { equipment: sheet.equipment.map((item) => (item === row ? { ...item, castRunning: [...kept, entry] } : item)) });
}

// A new casting from their own slots: an item's numbers for the spell are done.
export function equipmentWithoutRunning(equipment: readonly EquipmentItem[], spell: string): EquipmentItem[] | null {
  if (!equipment.some((item) => findNamed(item.castRunning ?? [], spell, (entry) => [entry.spell]))) {
    return null;
  }
  return equipment.map((item) => {
    const left = (item.castRunning ?? []).filter((entry) => !findNamed([entry], spell, (one) => [one.spell]));
    return item.castRunning ? { ...item, castRunning: left.length ? left : undefined } : item;
  });
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
