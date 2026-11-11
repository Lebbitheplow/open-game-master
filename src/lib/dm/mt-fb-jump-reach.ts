// How far and how high a character jumps, with everything that changes it,
// in one place. The board's jump move (src/lib/dm/jump-move.ts) and the
// player's jump ruler (src/lib/battlemap/view-moves.ts) both read this: the
// ruler once counted the bare Strength jump and Totem Spirit's tiger only, so
// a Champion, a Thief, a monk on Step of the Wind and anyone under the Jump
// spell were shown a shorter jump than the move route then allowed. Anything
// new that changes a jump goes here, never at one of the two callers. Pure:
// no database.

import type { Encounter } from "@/lib/db/encounters";
import { budgetApplies, WIND_STEP } from "@/lib/dm/action-budget";
import { computeAbilityScore } from "@/lib/dm/roll-riders";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { authoredJump, jumpStrength } from "@/lib/srd/authored-mt-fb";
import { conditionJumpMultiplier } from "@/lib/srd/condition-effect-queries";
import { holdsFeature } from "@/lib/srd/feature-names";
import { highJumpFeet, longJumpFeet } from "@/lib/srd/jump";

// The feet class features add to a running jump, long and high:
//   - SRD 5.1 fighter, Champion, Remarkable Athlete: "when you make a running
//     long jump, the distance you can cover increases by a number of feet
//     equal to your Strength modifier."
//   - SRD 5.1 rogue, Thief, Second-Story Work: "when you make a running jump,
//     the distance you cover increases by a number of feet equal to your
//     Dexterity modifier" (a running high jump too).
// A negative modifier shortens nothing: "increases by".
export function runningJumpFeet(sheet: CharacterSheet, runningStart: boolean): { long: number; high: number } {
  if (!runningStart) {
    return { long: 0, high: 0 };
  }
  const mod = (ability: "str" | "dex") => Math.max(0, Math.floor((computeAbilityScore(sheet, ability) - 10) / 2));
  const athlete = holdsFeature(sheet, "Remarkable Athlete") ? mod("str") : 0;
  const climber = holdsFeature(sheet, "Second-Story Work") ? mod("dex") : 0;
  return { long: athlete + climber, high: climber };
}

// Step of the Wind's mark on the jumper's running turn (bonus-actions.ts
// spendKiTechnique, action-tools.ts take_action's bonus route). SRD 5.1
// monk, Step of the Wind: "your jump distance is doubled for the turn." Read
// from the stored budget and never through budgetFor, which begins a held
// turn: the ruler only looks.
export function windStepOn(encounter: Encounter, sheetId: string): boolean {
  return budgetApplies(encounter.turnBudget, sheetId, encounter.round) && encounter.turnBudget.oncePerTurn.includes(WIND_STEP);
}

export type JumpReach = {
  // The Strength score the long jump is planned with (src/lib/srd/jump.ts
  // planLongJump), every bonus and multiplier in it.
  strength: number;
  longFeet: number;
  highFeet: number;
};

// `windStep`: whether Step of the Wind is on this turn (windStepOn; never in
// an exploration scene, which has no turns).
export function jumpReach(sheet: CharacterSheet, input: { runningStart: boolean; windStep: boolean }): JumpReach {
  const { runningStart } = input;
  const score = computeAbilityScore(sheet, "str");
  // The Jump spell triples the distance (condition-effects-last.ts), and
  // Step of the Wind doubles it for the turn.
  const leap = conditionJumpMultiplier(sheet.conditions) * (input.windStep ? 2 : 1);
  const extra = runningJumpFeet(sheet, runningStart);
  // Feet a feature adds to any jump, standing too (Totem Spirit's tiger).
  const flat = authoredJump(sheet);
  // A running long jump covers the Strength score in feet, so the class
  // features' extra feet ride on it.
  const strength = jumpStrength(score + extra.long, flat.long, runningStart) * leap;
  return {
    strength,
    longFeet: longJumpFeet(strength, runningStart),
    highFeet: (highJumpFeet(score, runningStart) + extra.high + flat.high) * leap,
  };
}
