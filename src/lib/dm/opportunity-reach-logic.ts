// Where a walk crosses the edge of a reach, square by square (opportunity
// attacks, Polearm Master). Pure: opportunity.ts and opportunity-sides.ts
// both read it, and it imports nothing of theirs.

import { footprintDistance, type Footprint } from "@/lib/battlemap/footprint";

type XY = { x: number; y: number };

// The walker's space: one size for the whole walk, or a size for each step of
// it (the last one holding for the steps after it). A rider getting on or off
// a mount changes size on the way: its own square at one end, its mount's
// space at the other (issue 1091).
export type MoverSpace = Footprint | readonly Footprint[];

function spaceAt(space: MoverSpace, step: number): Footprint {
  return typeof space === "number" ? space : (space[Math.min(Math.max(step, 0), space.length - 1)] ?? 1);
}

// The square a walk enters a reactor's reach at, or null when it never
// does: Polearm Master's opportunity attack on a creature coming in. Reach
// is measured between the nearest squares of the two, so an ogre's reach
// starts at its edge and a walking ogre leaves a reach when its last square
// does (src/lib/battlemap/footprint.ts).
export function entersReachAt(
  steps: XY[],
  reactor: XY,
  reach: number,
  reactorFootprint: Footprint = 1,
  moverFootprint: MoverSpace = 1,
): XY | null {
  const apart = (step: XY) => footprintDistance(reactor, reactorFootprint, step, spaceAt(moverFootprint, steps.indexOf(step)));
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const here = steps[index];
    const next = steps[index + 1];
    if (apart(here) > reach && apart(next) <= reach) {
      return next;
    }
  }
  return null;
}

// The square a walker stood on when they left this reach, or null when the
// walk never leaves it. `steps` is every square of the walk in order, the
// starting one first.
export function leavesReachAt(
  steps: XY[],
  reactor: XY,
  reach: number,
  reactorFootprint: Footprint = 1,
  moverFootprint: MoverSpace = 1,
): XY | null {
  const apart = (step: XY) => footprintDistance(reactor, reactorFootprint, step, spaceAt(moverFootprint, steps.indexOf(step)));
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const here = steps[index];
    const next = steps[index + 1];
    if (apart(here) <= reach && apart(next) > reach) {
      return here;
    }
  }
  return null;
}

// The square a walker steps to while still inside this reach, or null when no
// step of the walk begins and ends within it: Hold the Line's opportunity
// attack on a creature that moves 5 feet or more while within the reach.
export function movesWithinReachAt(
  steps: XY[],
  reactor: XY,
  reach: number,
  reactorFootprint: Footprint = 1,
  moverFootprint: MoverSpace = 1,
): XY | null {
  const apart = (step: XY) => footprintDistance(reactor, reactorFootprint, step, spaceAt(moverFootprint, steps.indexOf(step)));
  for (let index = 0; index + 1 < steps.length; index += 1) {
    const here = steps[index];
    const next = steps[index + 1];
    if ((here.x !== next.x || here.y !== next.y) && apart(here) <= reach && apart(next) <= reach) {
      return next;
    }
  }
  return null;
}
