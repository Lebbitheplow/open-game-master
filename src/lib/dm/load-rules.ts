// What a character can carry, and what they can shift, under the standard
// rule rather than the encumbrance variant.
//
// SRD 5.1, Lifting and Carrying: "Your carrying capacity is your Strength
// score multiplied by 15. This is the weight (in pounds) that you can carry."
// "You can push, drag, or lift a weight in pounds up to twice your carrying
// capacity (or 30 times your Strength score). While pushing or dragging
// weight in excess of your carrying capacity, your speed drops to 5 feet."
// Larger creatures double both for each size above Medium; a Tiny one
// halves them.
//
// Grants and purchases that would take a pack past the capacity are refused
// (src/lib/dm/mutations.ts, src/lib/dm/shop-tools.ts); a character already
// past it moves at 5 feet (src/lib/srd/index.ts speedFor). Weights come from
// the item rows, the content pack by name, and the SRD armor table; an item
// nothing can weigh is not counted, so the refusal errs toward allowing.

import { itemWeightByName } from "@/lib/content";
import { carryMultiplier, encumbranceFor, type CarriedItem } from "@/lib/srd/encumbrance";
import { densityCarryFactor } from "@/lib/srd/ar-ws-density";
import { sizeForRace } from "@/lib/srd";
import { itemAbilityScore, type Wearer } from "@/lib/srd/magic-items";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { rowName } from "@/lib/srd/item-row";
import { purseCoins, type Purse } from "@/lib/srd/currency";
import { authoredCarryFactor } from "@/lib/srd/carry-jump-effects";
import type { AuthoredSheet } from "@/lib/srd/authored-effects";
import { carrySize } from "@/lib/srd/mt-species-traits";

// The authored fields too: a feature that multiplies what the character
// carries (Peerless Athlete) is read from them (authoredCarryFactor).
type Carrier = Pick<CharacterSheet, "name" | "abilities" | "race" | "gold"> & Partial<Pick<CharacterSheet, "copper">> & Partial<Wearer> & Pick<AuthoredSheet, "features" | "conditions" | "classes">;

// Per-unit weights the rows lack, from the content pack.
export function weighed(equipment: CarriedItem[]): CarriedItem[] {
  return equipment.map((item) => {
    if (typeof item.weight === "number" && item.weight > 0) {
      return item;
    }
    const weight = itemWeightByName(rowName(item));
    return weight === null ? item : { ...item, weight };
  });
}

// The feature's factor on what this carrier bears, read once for the load,
// the refusal and the lift alike. Typed on the Carrier alone: the pack's item
// shape is not the authored sheet's, and the gate reads only the mark.
function carryFactorOf(sheet: Carrier): number {
  return authoredCarryFactor(sheet);
}

function loadOf(sheet: Carrier, equipment: CarriedItem[], purse?: Purse) {
  return encumbranceFor({
    strength: sheet.abilities.str,
    equipment: weighed(equipment),
    coins: purseCoins(purse ?? { gold: sheet.gold ?? 0, copper: sheet.copper ?? 0 }),
    size: sheet.race ? sizeForRace(sheet.race) : undefined,
    wearer: sheet as Wearer,
    carryFactor: carryFactorOf(sheet),
  });
}

// Why a pack cannot take on this load, or null. Only a change that adds
// weight is refused: dropping things from a pack already too heavy is how a
// character gets back under it.
export function capacityProblem(
  sheet: Carrier & { equipment: CarriedItem[] },
  after: CarriedItem[],
  what: string,
  purse?: Purse,
): ToolError | null {
  const now = loadOf(sheet, sheet.equipment);
  const then = loadOf(sheet, after, purse);
  if (!then.overCapacity || then.carriedLb <= now.carriedLb) {
    return null;
  }
  // Both doublings are named, since both can hold at once (a goliath totem warrior).
  const factor = carryFactorOf(sheet);
  const powerful = carrySize("Medium", sheet as Wearer) !== "Medium";
  return { error: `${sheet.name} can carry ${then.capacityLb} lb (Strength x 15${powerful ? ", doubled by Powerful Build" : ""}${factor > 1 ? `, x ${factor} by a feature of theirs` : ""}) and would be carrying ${then.carriedLb} lb with ${what}. They cannot carry it: give it to someone else, leave something behind, or drag it (the lift tool) at 5 feet. Ask the player which.`, retry: true };
}

// A character's carrying capacity and push, drag or lift limit, in pounds.
export function liftLimits(sheet: Carrier & { equipment: CarriedItem[] }): { capacityLb: number; liftLb: number } {
  // A Belt of Giant Strength's score, or an Ioun Stone of Strength's +2.
  const set = itemAbilityScore("str", Math.floor(sheet.abilities.str || 1), sheet.equipment ?? [], sheet as Wearer);
  const strength = Math.max(1, set);
  // The same size and factor loadOf weighs by, so the lift and the capacity
  // agree; Adjust Density doubles or halves both (src/lib/srd/ar-ws-density.ts).
  const multiplier = carryMultiplier(carrySize(sheet.race ? sizeForRace(sheet.race) : undefined, sheet as Wearer)) * carryFactorOf(sheet) * densityCarryFactor(sheet.conditions);
  return { capacityLb: strength * 15 * multiplier, liftLb: strength * 30 * multiplier };
}
