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

// What the horror classes' features add to one ability check, read by
// src/lib/dm/rolls.ts for skill checks and plain ability checks alike:
//   Forbidden Lore (occultist 1): "Double proficiency bonus on Arcana and
//     Religion checks" (expertise, as the bard's, on a trained skill);
//   Desperate Strength (survivor 11): "While below half HP, +2 to ... STR/DEX
//     checks" (its +2 to attack rolls is an attack_bonus row).
export type HorrorCheckRider = { expertise: boolean; bonus: number; notes: string[] };

export function horrorCheckRider(
  sheet: AuthoredSheet & { currentHp?: number; maxHp?: number },
  skill: string | null,
  ability: string,
): HorrorCheckRider {
  const out: HorrorCheckRider = { expertise: false, bonus: 0, notes: [] };
  if (skill && (skill === "arcana" || skill === "religion") && horrorHolds(sheet, "Forbidden Lore")) {
    out.expertise = true;
    out.notes.push("Forbidden Lore: double proficiency bonus");
  }
  const belowHalf = (sheet.currentHp ?? 0) < (sheet.maxHp ?? 0) / 2;
  if ((ability === "str" || ability === "dex") && belowHalf && horrorHolds(sheet, "Desperate Strength")) {
    out.bonus += 2;
    out.notes.push("Desperate Strength: +2 below half hit points");
  }
  return out;
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
