// The state of a Wild Surge as the sheet's conditions keep it, for the engine
// (src/lib/dm/mt-fb-wild-surge.ts writes it) and the Hand, which deals the
// surge's cards by the same reading. Pure.
//
//   wild surge (N)        the effect of the table in force for this rage
//   wild surge pending    a Controlled Surge's two rolls wait on the choice
//   wild surge roll (N)   one of the two numbers rolled (none when both dice
//                         matched: any effect of the table)
//   wild surge ward       effect 6's +1 AC on the barbarian and their allies
import { isConditionNamed } from "@/lib/srd/feature-names";

export const SURGE = "wild surge";
export const SURGE_PENDING = "wild surge pending";
export const SURGE_ROLL = "wild surge roll";
export const SURGE_WARD = "wild surge ward";

type Held = { conditions: string[] };
const numbered = (entry: string, name: string): number | null => {
  const found = new RegExp(`^${name} \\((\\d)\\)$`, "i").exec(entry.trim());
  const number = found ? Number(found[1]) : 0;
  return number >= 1 && number <= 8 ? number : null;
};

// The surge in force: its number, or null.
export function surgeOf(sheet: Held): number | null {
  return sheet.conditions.map((entry) => numbered(entry, SURGE)).find((number) => number !== null) ?? null;
}

// The numbers a Controlled Surge left to choose from: null when none is
// pending, every number when both dice matched.
export function pendingSurge(sheet: Held): number[] | null {
  if (!sheet.conditions.some((entry) => isConditionNamed(entry, SURGE_PENDING))) {
    return null;
  }
  const numbers = sheet.conditions.map((entry) => numbered(entry, SURGE_ROLL)).filter((number): number is number => number !== null);
  return numbers.length ? numbers : [1, 2, 3, 4, 5, 6, 7, 8];
}
