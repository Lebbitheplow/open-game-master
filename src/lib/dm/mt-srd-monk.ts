// What a monk's hands decide (SRD 5.1, Monk).
//
// Martial Arts: "You gain the following benefits while you are unarmed or
// wielding only monk weapons and you aren't wearing armor or wielding a
// shield." A longsword in hand ends them for the unarmed strike too.
// martialArtsApplies (pc-attack-options.ts) asks wieldsOnlyMonkWeapons, and
// every reader of Martial Arts goes through martialArtsApplies.
//
// Deflect Missiles: "you can catch the missile if it is small enough for you
// to hold in one hand and you have at least one hand free." The throw-back
// (reaction-tools.ts throwBack) asks catchProblem before a ki point is spent.
//
// Timeless Body (monk 15): "you no longer need food or water." The supplies
// variant's dawn (supplies.ts upkeepAtDawns) skips such a monk: no ration
// eaten, no day counted without. The druid's feature of the same name slows
// aging only, so it is the monk's level that is read.
//
// Pure.

import { isMonkWeapon } from "@/lib/dm/attack-logic";
import { gearKindOf, handsFor, heldRows, weaponRowOf } from "@/lib/dm/gear-hands";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature } from "@/lib/srd/feature-names";
import { classLevelOf } from "@/lib/srd/trait-rules";

// A Way of the Kensei monk's chosen weapons are monk weapons for them, and
// which ones they chose is not on the sheet: their hands are not judged here.
const OWN_MONK_WEAPONS = "Path of the Kensei";

export function wieldsOnlyMonkWeapons(sheet: Pick<CharacterSheet, "equipment" | "features">): boolean {
  if (holdsFeature(sheet, OWN_MONK_WEAPONS)) {
    return true;
  }
  return heldRows(sheet.equipment).every((row) => gearKindOf(row) !== "weapon" || isMonkWeapon(weaponRowOf(row)));
}

// A missile too large for one hand: a giant's rock, a siege engine's shot.
const TOO_LARGE = /\b(rock|boulder|ballista|catapult|trebuchet|cannon)\b/i;

// Why the monk cannot catch the missile they stopped, or null.
export function catchProblem(sheet: Pick<CharacterSheet, "name" | "equipment">, missile: string): string | null {
  if (TOO_LARGE.test(missile)) {
    return `The ${missile.toLowerCase()} is too large to hold in one hand, so it cannot be caught and thrown back.`;
  }
  const held = heldRows(sheet.equipment);
  const hands = held.reduce((sum, row) => sum + handsFor(row), 0);
  return hands >= 2 ? `${sheet.name} has no hand free to catch the missile (${held.map((row) => row.name).join(", ")}), so it cannot be thrown back.` : null;
}

export function needsNoFoodOrWater(sheet: Parameters<typeof classLevelOf>[0]): boolean {
  return classLevelOf(sheet, "monk") >= 15;
}
