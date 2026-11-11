// The light a Lunar sorcerer sheds in the Full Moon phase (Lunar Empowerment,
// Lunar Sorcery 14): "a bonus action sheds bright light in 10 feet and dim
// light 10 feet beyond (or douses it)". While it is lit the sorcerer's sheet
// carries the condition "moonlight" (src/lib/dm/ar-ws-lunar-empowerment.ts
// lays and ends it), and this module says what light that is, for every place
// that asks what light a character carries: light-timers.ts carriedLight, read
// by the board when the party steps onto it and by the light a check is made
// in off the board (place-light.ts).
//
// Pure: no database.

import { isConditionNamed } from "@/lib/srd/feature-names";

export const MOONLIGHT = "moonlight";

type Lit = { conditions?: readonly string[] };
type Light = { radius: number; dim: number; minutes: number };

export function shedsMoonlight(sheet: Lit): boolean {
  return (sheet.conditions ?? []).some((entry) => isConditionNamed(entry, MOONLIGHT));
}

// Feet as the board's tiles: the bright radius, and where the dim light ends.
export function lightTiles(brightFt: number, dimFt: number): { radius: number; dim: number } {
  return { radius: Math.floor(brightFt / 5), dim: Math.floor((brightFt + dimFt) / 5) };
}

// 10 feet of bright light and 10 more of dim, which never burns down.
export const MOON_LIGHT: Light = { ...lightTiles(10, 10), minutes: 0 };

// The light a character carries with the moonlight counted: whichever of the
// two is brighter (a torch outshines it and keeps its own hour).
export function withMoonlight<T extends Light>(sheet: Lit, carried: T): T | Light {
  return shedsMoonlight(sheet) && carried.radius < MOON_LIGHT.radius ? MOON_LIGHT : carried;
}
