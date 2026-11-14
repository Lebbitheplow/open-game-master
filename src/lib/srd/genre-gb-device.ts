// A salvage tech's Field Fabricator device (salvage tech 11): "During a long
// rest, build one temporary device that duplicates a 2nd-level tech effect;
// anyone can trigger it". The device is a row of a pack named for the spell
// it holds and the numbers its maker cast with, "Fabricated Device: Web (DC
// 15, +7)", so whoever carries it casts that spell once from it with those
// numbers, as an Elemental Gem is used up by its one summoning
// (src/lib/srd/item-spells.ts reads the name). No attunement and no class:
// anyone can trigger it. It falls apart at the end of the next long rest
// (src/lib/srd/ar-ws-conjured.ts withoutConjuredAtLongRest).
//
// Pure; no database.
import type { ItemSpell } from "@/lib/srd/item-spells";

const DEVICE = /^fabricated device: (.+?) \(dc (\d+), \+(\d+)\)$/i;

export function deviceName(spell: string, dc: number, attack: number): string {
  return `Fabricated Device: ${spell} (DC ${dc}, +${attack})`;
}

export function isFabricatedDevice(item: { name?: string }): boolean {
  return DEVICE.test((item.name ?? "").trim());
}

// The one cast the device holds, or null for any other row.
export function deviceSpells(itemName: string): ItemSpell[] | null {
  const found = DEVICE.exec(itemName.trim());
  return found ? [{ spell: found[1], charges: 0, level: 2, dc: Number(found[2]), attackBonus: Number(found[3]), usesUp: true }] : null;
}
