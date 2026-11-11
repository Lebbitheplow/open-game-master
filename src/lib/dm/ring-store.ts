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
// The credits live in the database on the server (src/lib/db/item-cast-credits.ts).
import "@/lib/db/item-cast-credits";
import { recordItemCast, runningItemSpell, type ItemCast } from "@/lib/srd/item-cast-credit";
import { rowName } from "@/lib/srd/item-row";
import { beadStoreRefusal, putInBead } from "@/lib/dm/ar-ws-bead-store";
import { isBead, isBeadSlot } from "@/lib/srd/ar-ws-conjured";
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

// A second ring on one row: this one takes the spell, and the rest of the stack
// becomes a row of its own under a name of its own, since the sheet and the
// tools tell rows apart by name. The ring being worn stays what it is; the others
// are in the pack, unworn and unattuned.
function splitStack(equipment: readonly EquipmentItem[], ring: EquipmentItem): { equipment: EquipmentItem[]; ring: EquipmentItem } {
  if (ring.qty <= 1) {
    return { equipment: [...equipment], ring };
  }
  let number = 2;
  while (findNamed(equipment, `${ring.name} (${number})`, (item) => [item.name])) {
    number += 1;
  }
  const one = { ...ring, qty: 1 };
  const rest: EquipmentItem = {
    ...ring,
    name: `${ring.name} (${number})`,
    srdName: rowName(ring),
    qty: ring.qty - 1,
    equipped: false,
    attuned: undefined,
    attuning: undefined,
    layered: undefined,
    storedSpells: undefined,
    castRunning: undefined,
  };
  return { equipment: equipment.flatMap((item) => (item === ring ? [one, rest] : [item])), ring: one };
}

// Why this spell at this level cannot go in the ring as it stands, or null. A
// ring that has gone, or filled up since a casting began, is asked the same.
export function storeRefusal(holderId: string, ringName: string, spell: string, level: number): ToolError | null {
  // A new Arcane Abeyance bead, not a ring on the pack (ar-ws-bead-store.ts).
  if (isBeadSlot(ringName)) {
    return beadStoreRefusal(holderId, spell, level);
  }
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
  if (isBeadSlot(ringName)) {
    putInBead(campaign, turnId, holderId, entry);
    return;
  }
  const holder = getSheetById(holderId);
  const ring = holder ? storerNamed(holder, ringName) : null;
  if (holder && ring) {
    const split = splitStack(holder.equipment, ring);
    writeCharges(campaign.id, holder, withStored(split.equipment, split.ring, [...storedSpellsOf(ring), entry]), "use_spell_slot", `${entry.spell} stored in ${ring.name}`, turnId);
  }
}

// The spell has been cast, so it leaves the ring and frees its space.
export function takeFromRing(campaign: Campaign, turnId: string | null, sheetId: string, ringName: string, spell: string) {
  const sheet = getSheetById(sheetId);
  const ring = sheet ? storerNamed(sheet, ringName) : null;
  const entry = ring ? storedSpellNamed(ring, spell) : null;
  if (sheet && ring && entry) {
    // A bead is broken to cast its spell: the row goes with it. A
    // Spell-Storing Item keeps its spell until its last casting.
    const counted = typeof entry.uses === "number" && entry.uses > 1;
    const equipment = isBead(ring)
      ? sheet.equipment.filter((item) => item !== ring)
      : withStored(sheet.equipment, ring, counted ? storedSpellsOf(ring).map((other) => (other === entry ? { ...other, uses: (entry.uses ?? 1) - 1 } : other)) : storedSpellsOf(ring).filter((other) => other !== entry));
    writeCharges(campaign.id, sheet, equipment, "use_item", `${entry.spell} cast from ${ring.name}`, turnId);
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
