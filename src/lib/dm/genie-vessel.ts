// The Genie warlock's vessel as a place and a thing: who is inside it, whose
// vessel holds them, what staying inside buys, and what it takes to break it.
//
// Genie's Vessel (1st level): "Your vessel is a Tiny object (AC equal to your
// spell save DC, hit points equal to your warlock level + your proficiency
// bonus) and your spellcasting focus." Its numbers are the warlock's, never
// the caller's: object-damage.ts damageObject asks vesselObject for any
// object named as a vessel, and cast-materials.ts focusProblem reads the
// feature as the focus.
//
// Sanctuary Vessel (subclasses.json, warlock, The Genie, 10th level): "Anyone
// who stays inside at least 10 minutes gains the benefit of a short rest, and
// anyone who spends Hit Dice in it adds your proficiency bonus to the hit
// points each die restores."
//
// Inside is the condition Bottled Respite lays ("in the genie's vessel"); its
// meta's source names the warlock whose vessel it is (the warlock's own, or
// the party Sanctuary Vessel takes in with them: authored-effects-w2-arcane.ts).
// Every Hit Die spent passes hit-dice.ts spendHitDice (the rest's own spend
// and the player's after it), which asks sanctuaryDieBonus; a short rest asks
// sanctuaryShortRest (rest-tools.ts handleTakeRest).
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { hasCondition } from "@/lib/srd/authored-effects";
import { holdsFeature } from "@/lib/srd/feature-names";
import { classLevelOf } from "@/lib/srd/trait-rules";

export const IN_VESSEL = "in the genie's vessel";
// "at least 10 minutes": the short rest a vessel holds is that long.
export const VESSEL_REST_MINUTES = 10;

// The warlock whose Sanctuary Vessel this creature is inside, or null (not
// inside one, or inside a vessel below 10th level, which shelters only).
export function sanctuaryHost(sheet: CharacterSheet): CharacterSheet | null {
  if (!hasCondition(sheet, IN_VESSEL)) {
    return null;
  }
  const source = sheet.conditionMeta?.[IN_VESSEL]?.source ?? sheet.id;
  const host = source === sheet.id ? sheet : getSheetById(source);
  return host && holdsFeature(host, "Sanctuary Vessel") ? host : null;
}

// What each Hit Die this creature spends adds: the host's proficiency bonus
// inside a Sanctuary Vessel, else nothing.
export function sanctuaryDieBonus(sheet: CharacterSheet): { bonus: number; host: string } | null {
  const host = sanctuaryHost(sheet);
  return host ? { bonus: computeSheetDerived(host).proficiencyBonus, host: host.name } : null;
}

export type VesselRest = { minutes: number; inside: string[]; outside: string[] };

// A short rest taken while a Sanctuary Vessel holds anyone is the vessel's:
// ten minutes, and its benefit goes to those inside. Those outside have only
// waited ten minutes; their own short rest is an hour, taken once the vessel
// is left. Null when nobody of the party is inside one.
export function sanctuaryShortRest(sheets: CharacterSheet[]): VesselRest | null {
  const fresh = sheets.map((stale) => getSheetById(stale.id) ?? stale).filter((sheet) => !sheet.deathSaves?.dead);
  const inside = fresh.filter((sheet) => sanctuaryHost(sheet));
  if (!inside.length) {
    return null;
  }
  const held = new Set(inside.map((sheet) => sheet.id));
  return { minutes: VESSEL_REST_MINUTES, inside: inside.map((sheet) => sheet.id), outside: fresh.filter((sheet) => !held.has(sheet.id)).map((sheet) => sheet.name) };
}

// What a Genie's vessel is called when nobody's name is in it.
const VESSEL_NAMES = ["vessel", "the vessel", "genie's vessel", "the genie's vessel"];

// The vessel an object's name stands for, with its numbers from its warlock,
// or null: "<warlock>'s vessel" for any Genie warlock of this campaign, or
// the vessel by itself when there is only one.
export function vesselObject(campaignId: string, name: string): { key: string; ac: number; hp: number; owner: string } | null {
  const named = textKey(name);
  const genies = listSheets(campaignId).filter((sheet) => holdsFeature(sheet, "Genie's Vessel"));
  const host =
    genies.find((sheet) => [`${sheet.name}'s vessel`, `${sheet.name}'s genie's vessel`].some((whole) => textKey(whole) === named)) ??
    (genies.length === 1 && VESSEL_NAMES.some((whole) => textKey(whole) === named) ? genies[0] : null);
  if (!host) {
    return null;
  }
  const derived = computeSheetDerived(host);
  // A warlock casts with Charisma (SRD 5.1, Warlock, Spellcasting Ability),
  // whatever the sheet's first class casts with.
  const ac = 8 + derived.proficiencyBonus + derived.abilityMods.cha;
  const hp = classLevelOf(host, "warlock") + derived.proficiencyBonus;
  return { key: `vessel ${host.id}`, ac, hp, owner: host.name };
}
