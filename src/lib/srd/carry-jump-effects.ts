// What authored features add to a character's load and their jumps, read
// from the effect kinds `carry_factor` and `jump_feet` (authored-effects-types.ts).
// One reader for each, so every door that weighs a pack or measures a jump
// agrees:
//   - carry_factor: src/lib/dm/load-rules.ts (capacityProblem, liftLimits),
//     src/lib/srd/index.ts speedFor's over-capacity walk, and every other
//     encumbranceFor caller that has the sheet, through `carryFactor`.
//   - jump_feet: src/lib/dm/jump-reach.ts jumpReach, which the board view
//     (src/lib/battlemap/view-moves.ts) and the jump door
//     (src/lib/dm/jump-move.ts) both ask.
// TCoE, Oath of Glory, Peerless Athlete: "you can carry, push, drag, and lift
// twice as much weight as normal, and the distance of your long and high
// jumps increases by 10 feet" while it lasts (the "peerless athlete" mark).

import { activeAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";

// How many times the normal weight the holder carries, pushes, drags and
// lifts now: the factors of every effect that holds, multiplied, 1 for none.
export function authoredCarryFactor(sheet: AuthoredSheet): number {
  return activeAuthored(sheet, "carry_factor").reduce((factor, { effect }) => factor * Math.max(1, effect.factor), 1);
}

// The flat feet effects add to the holder's long and high jumps, after the
// Strength reach (a standing jump halves the Strength part, never these).
export function authoredJumpFeet(sheet: AuthoredSheet): number {
  return activeAuthored(sheet, "jump_feet").reduce((feet, { effect }) => feet + Math.max(0, effect.feet), 0);
}
