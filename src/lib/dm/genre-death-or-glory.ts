// A road warrior's Death or Glory (src/lib/classes/post-apocalyptic-features.json):
// "You may attack recklessly: advantage on melee attacks this turn, but
// attacks against you have advantage until your next turn." It is played by
// the same door as a barbarian's Reckless Attack (pc_attack reckless: true,
// src/lib/dm/pc-attack-options.ts), on any melee attack rather than only a
// Strength one, and leaves its own condition. Ride Eternal (20th level):
// "Death or Glory no longer grants enemies advantage against you", so the
// condition it leaves then opens nothing (DEATH_OR_GLORY_ETERNAL).
//
// Before this both were sentences in the GM's prompt: the road warrior's
// reckless turn was refused as "no Reckless Attack".
//
// Pure.
import { holdsFeature } from "@/lib/srd/feature-names";
import { DEATH_OR_GLORY, DEATH_OR_GLORY_ETERNAL } from "@/lib/srd/genre-b-post-apocalyptic-conditions";

type Holder = { features?: ReadonlyArray<{ name: string }> };

export function holdsDeathOrGlory(sheet: Holder): boolean {
  return holdsFeature(sheet, "Death or Glory");
}

export function recklessConditionFor(sheet: Holder): string {
  return holdsFeature(sheet, "Ride Eternal") ? DEATH_OR_GLORY_ETERNAL : DEATH_OR_GLORY;
}
