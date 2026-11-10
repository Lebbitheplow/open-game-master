// How far a character can jump now, long and high: the one answer the board
// view's jump reach (src/lib/battlemap/view-moves.ts) and the jump door
// (src/lib/dm/jump-move.ts) both read, so the reach a player is shown is the
// reach the move accepts. Every addition to a jump goes through here:
//   - the Strength score (long) or 3 + the Strength modifier (high), halved
//     from a standing start (src/lib/srd/jump.ts);
//   - the running jump's class features (runningJumpFeet below);
//   - flat feet from authored features (authored-effects `jump_feet`,
//     Peerless Athlete's 10), added after the Strength reach, so a standing
//     start halves the Strength part and never these;
//   - the multipliers: the Jump spell's tripling (a condition on the sheet)
//     and the turn's own (Step of the Wind, which the door knows), on the
//     whole distance.
// Pure: no database.

import { computeAbilityScore } from "@/lib/dm/roll-riders";
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

export type JumpReach = {
  // What planLongJump takes: the Strength-like score it halves for a
  // standing start, and the flat feet it adds after.
  strength: number;
  extraFeet: number;
  // The reach in feet, long and high.
  longFeet: number;
  highFeet: number;
};

// `turnLeap`: the multiplier only the turn knows (Step of the Wind's 2).
export function jumpReach(sheet: CharacterSheet, runningStart: boolean, turnLeap = 1): JumpReach {
  const score = computeAbilityScore(sheet, "str");
  const leap = conditionJumpMultiplier(sheet.conditions) * turnLeap;
  const extra = runningJumpFeet(sheet, runningStart);
  const flat = authoredJumpFeet(sheet);
  // A running long jump covers the Strength score in feet, so the class
  // features' extra feet ride on it.
  const strength = (score + extra.long) * leap;
  const extraFeet = flat * leap;
  return {
    strength,
    extraFeet,
    longFeet: longJumpFeet(strength, runningStart) + extraFeet,
    highFeet: (highJumpFeet(score, runningStart) + extra.high + flat) * leap,
  };
}
