// What the horror classes' features held by an engine outside the authored
// layer answer (src/lib/srd/authored-effects-genre-a-horror.ts holds their
// rows): each reader asks here, so a feature is found by its class's row and
// never by a name another class's feature shares.
//
// Pure: the sheet alone.
import { heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import { isNamed } from "@/lib/srd/feature-names";

export function horrorHolds(sheet: AuthoredSheet, feature: string): boolean {
  return heldAuthored(sheet).some((entry) => isNamed(entry.feature, feature));
}

// Death's Old Acquaintance (survivor 17): "Advantage on death saves", read by
// src/lib/dm/death.ts rollDeathSave beside Diehard and Beacon of Hope.
export function horrorDeathSaveAdvantage(sheet: AuthoredSheet): string | null {
  return horrorHolds(sheet, "Death's Old Acquaintance") ? "Death's Old Acquaintance" : null;
}

// Death's Old Acquaintance: "stabilizing you takes no check". The healer
// still spends the action (src/lib/dm/stabilize.ts); the Medicine check is
// not rolled and the creature is stable.
export function horrorStabilizesWithoutCheck(sheet: AuthoredSheet): string | null {
  return horrorHolds(sheet, "Death's Old Acquaintance") ? "Death's Old Acquaintance" : null;
}
