// How far a character can jump now, long and high: the one answer the board
// view's jump reach (src/lib/battlemap/view-moves.ts) and the jump door
// (src/lib/dm/jump-move.ts) both read, so the reach a player is shown is the
// reach the move accepts. The ruler once counted the bare Strength jump, so a
// Champion, a Thief, a monk on Step of the Wind and anyone under the Jump
// spell were shown a shorter jump than the move route then allowed. Every
// addition to a jump goes through here, never at one of the two callers:
//   - the Strength score (long) or 3 + the Strength modifier (high), halved
//     from a standing start (src/lib/srd/jump.ts);
//   - the running jump's class features (runningJumpFeet below);
//   - feet a feature adds to any jump, standing too (authored-effects `jump`,
//     Totem Spirit's tiger: src/lib/srd/authored-mt-fb.ts authoredJump),
//     carried in the Strength the long jump is planned with;
//   - flat feet from authored features (authored-effects `jump_feet`,
//     Peerless Athlete's 10), added after the Strength reach, so a standing
//     start halves the Strength part and never these;
//   - the multipliers: the Jump spell's tripling (a condition on the sheet)
//     and Step of the Wind's doubling for the turn (windStepOn), on the whole
//     distance.
// Pure: no database.

import type { Encounter } from "@/lib/db/encounters";
import { budgetApplies, WIND_STEP } from "@/lib/dm/action-budget";
import { computeAbilityScore } from "@/lib/dm/roll-riders";
import { authoredJump, jumpStrength } from "@/lib/srd/authored-mt-fb";
import { authoredJumpFeet } from "@/lib/srd/carry-jump-effects";
import { conditionJumpMultiplier } from "@/lib/srd/condition-effect-queries";
import { holdsFeature } from "@/lib/srd/feature-names";
import { highJumpFeet, longJumpFeet } from "@/lib/srd/jump";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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
  // What planLongJump takes: the Strength-like score it halves for a
  // standing start, every bonus and multiplier in it, and the flat feet it
  // adds after.
  strength: number;
  extraFeet: number;
  // The reach in feet, long and high.
  longFeet: number;
  highFeet: number;
};

// `windStep`: whether Step of the Wind is on this turn (windStepOn; never in
// an exploration scene, which has no turns).
export function jumpReach(sheet: CharacterSheet, runningStart: boolean, windStep = false): JumpReach {
  const score = computeAbilityScore(sheet, "str");
  // The Jump spell triples the distance (condition-effects-last.ts), and
  // Step of the Wind doubles it for the turn.
  const leap = conditionJumpMultiplier(sheet.conditions) * (windStep ? 2 : 1);
  const extra = runningJumpFeet(sheet, runningStart);
  // Feet a feature adds to any jump, standing too (Totem Spirit's tiger).
  const totem = authoredJump(sheet);
  // Flat feet added after the Strength reach (Peerless Athlete).
  const flat = authoredJumpFeet(sheet);
  // A running long jump covers the Strength score in feet, so the class
  // features' extra feet ride on it.
  const strength = jumpStrength(score + extra.long, totem.long, runningStart) * leap;
  const extraFeet = flat * leap;
  return {
    strength,
    extraFeet,
    longFeet: longJumpFeet(strength, runningStart) + extraFeet,
    highFeet: (highJumpFeet(score, runningStart) + extra.high + totem.high + flat) * leap,
  };
}
