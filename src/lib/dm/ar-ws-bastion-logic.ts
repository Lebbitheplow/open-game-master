// The ward of Bastion of Law (Clockwork Soul 6) as a condition a character
// carries: "bastion of law (3d8)", the dice left in its name, so the sheet,
// the party card and the engine read one thing. src/lib/dm/ar-ws-bastion.ts
// lays and spends it; the Hand deals the warded creature a card while a hit
// on them is open (src/lib/battlemap/hand-ar-ws-ward.ts).
//
// Pure: no database.

import { isConditionNamed } from "@/lib/srd/feature-names";

export const BASTION_OF_LAW = "Bastion of Law";
export const WARD = "bastion of law";
export const WARD_DIE = "d8";
// The variant of use_resource that spends the ward's dice off a hit.
export const WARD_REDUCE = "reduce";

export const wardCondition = (dice: number) => `${WARD} (${dice}${WARD_DIE})`;

// The ward a character carries: its condition as written, and the dice left.
export function wardOn(sheet: { conditions?: readonly string[] }): { condition: string; dice: number } | null {
  for (const condition of sheet.conditions ?? []) {
    const dice = /\((\d+)d\d+\)\s*$/.exec(condition);
    if (dice && isConditionNamed(condition.replace(/\s*\(.*$/, ""), WARD)) {
      return { condition, dice: Number(dice[1]) };
    }
  }
  return null;
}
