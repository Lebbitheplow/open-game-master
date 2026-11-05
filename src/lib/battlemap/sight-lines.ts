// The lines sight and cover are read along. The SRD says what cover means
// (SRD 5.1, Cover: half, three-quarters, and total when the target is
// "completely concealed") and not how to measure it on a grid, so the board
// measures it the way a table does with a ruler: from a corner of the
// attacker's space to the four corners of one square the target stands on,
// the attacker choosing the corner and the square that see the most.
//
//   none of the four lines blocked  no cover
//   one or two blocked              half
//   three blocked                   three-quarters
//   no line gets through at all     total: no attack
//
// Sight is the stricter of the two about one thing. A line sliding along a
// wall's face does not count as seeing past it, which is what keeps a shot
// from passing a wall square beside a window, or a pillar dead ahead. Cover
// counts such a line as clear, or a corridor's own walls would give everyone
// in it half cover. Both let a line clip a wall's corner point: forbid that as
// well and only one target's corner is ever left to see, so a shot with
// three lines blocked would be refused and nothing would have +5.
//
// A single line between square centres, which this replaced, refused a shot
// at a target that was mostly in the open, and could let one combatant shoot
// another who could not shoot back. Any line is the same line walked the
// other way, so whether a line exists at all does not depend on who asks.
//
// Pure geometry on whole numbers: no rounding, so no line changes its answer
// with the board's size or the direction it is walked.

import type { XY } from "@/lib/battlemap/types";

export type { XY };

// Whether a square stops a line. Walls for sight, one creature's squares for
// a creature's cover.
export type Blocks = (x: number, y: number) => boolean;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// A line along the edge between squares. Grazing lets it pass a wall on one
// side, never two: two are one solid face, or they pinch shut where they meet.
// Without grazing a wall on either side stops it.
function edgeClear(
  from: number,
  to: number,
  side: (along: number, before: boolean) => boolean,
  grazing: boolean,
): boolean {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let along = lo; along < hi; along += 1) {
    const before = side(along, true);
    const after = side(along, false);
    if (grazing ? before && after : before || after) {
      return false;
    }
    if (along > lo) {
      const beforeHere = before || side(along - 1, true);
      const afterHere = after || side(along - 1, false);
      if (grazing ? beforeHere && afterHere : beforeHere || afterHere) {
        return false;
      }
    }
  }
  return true;
}

// Whether a line between two corners of the grid gets through. The inside of
// a blocking square stops it, and so does squeezing between two walls that
// touch at a corner: a diagonal run of wall is a wall. With `grazing` it may
// also slide along a single wall's face.
export function lineClear(a: XY, b: XY, blocks: Blocks, grazing = false): boolean {
  if (a.x === b.x && a.y === b.y) {
    return true;
  }
  if (a.y === b.y) {
    return edgeClear(a.x, b.x, (x, before) => blocks(x, before ? a.y - 1 : a.y), grazing);
  }
  if (a.x === b.x) {
    return edgeClear(a.y, b.y, (y, before) => blocks(before ? a.x - 1 : a.x, y), grazing);
  }
  const [left, right] = a.x < b.x ? [a, b] : [b, a];
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  // Column by column, in numerators over dx so nothing is rounded.
  for (let column = left.x; column < right.x; column += 1) {
    const enters = left.y * dx + dy * (column - left.x);
    const leaves = enters + dy;
    const first = Math.floor(Math.min(enters, leaves) / dx);
    const last = Math.ceil(Math.max(enters, leaves) / dx) - 1;
    for (let row = first; row <= last; row += 1) {
      if (blocks(column, row)) {
        return false;
      }
    }
  }
  const steps = gcd(dx, Math.abs(dy));
  for (let step = 1; step < steps; step += 1) {
    const x = left.x + (step * dx) / steps;
    const y = left.y + (step * dy) / steps;
    // At a grid point the line passes between the two squares it does not enter.
    const pinched = dy > 0 ? blocks(x, y - 1) && blocks(x - 1, y) : blocks(x - 1, y - 1) && blocks(x, y);
    if (pinched) {
      return false;
    }
  }
  return true;
}

// A square's four corners, leaving out one walled off from it: where the two
// squares beside a corner both block, that corner belongs to the far side of
// a diagonal wall, and a line from it would start through the wall.
function openCorners(square: XY, blocks: Blocks): XY[] {
  const { x, y } = square;
  const corners: Array<[XY, boolean]> = [
    [{ x, y }, blocks(x - 1, y) && blocks(x, y - 1)],
    [{ x: x + 1, y }, blocks(x + 1, y) && blocks(x, y - 1)],
    [{ x, y: y + 1 }, blocks(x - 1, y) && blocks(x, y + 1)],
    [{ x: x + 1, y: y + 1 }, blocks(x + 1, y) && blocks(x, y + 1)],
  ];
  return corners.filter(([, sealed]) => !sealed).map(([corner]) => corner);
}

function spaceCorners(space: XY[], blocks: Blocks): XY[] {
  if (space.length === 1) {
    return openCorners(space[0], blocks);
  }
  const seen = new Map<string, XY>();
  for (const square of space) {
    for (const corner of openCorners(square, blocks)) {
      seen.set(`${corner.x},${corner.y}`, corner);
    }
  }
  return [...seen.values()];
}

// What stands in a creature's own space never hides that creature, or stops
// its own line: the attacker's square is ignored and a target standing in a
// doorway is still visible.
function outsideSpaces(from: XY[], to: XY[], blocks: Blocks): Blocks {
  if (from.length === 1 && to.length === 1) {
    const [a] = from;
    const [b] = to;
    return (x, y) => blocks(x, y) && !(x === a.x && y === a.y) && !(x === b.x && y === b.y);
  }
  return (x, y) =>
    blocks(x, y) && !from.some((square) => square.x === x && square.y === y) && !to.some((square) => square.x === x && square.y === y);
}

// How many of the four lines the attacker cannot get clear, from the corner
// and to the target's square that suit it best: 0 to 4. A line sliding along a
// wall counts as clear here. A target's corner walled off from it counts as
// blocked.
export function blockedLines(from: XY[], to: XY[], blocks: Blocks): number {
  const open = outsideSpaces(from, to, blocks);
  const starts = spaceCorners(from, open);
  let best = 4;
  for (const start of starts) {
    for (const square of to) {
      const corners = openCorners(square, open);
      let blocked = 4 - corners.length;
      for (const corner of corners) {
        if (blocked >= best) {
          break;
        }
        if (!lineClear(start, corner, open, true)) {
          blocked += 1;
        }
      }
      if (blocked < best) {
        best = blocked;
        if (best === 0) {
          return 0;
        }
      }
    }
  }
  return best;
}

// Whether any line gets through without sliding along a wall: sight. The same
// answer whichever space is named first, and quicker than counting them.
export function anyLineClear(from: XY[], to: XY[], blocks: Blocks): boolean {
  const open = outsideSpaces(from, to, blocks);
  const ends = spaceCorners(to, open);
  for (const start of spaceCorners(from, open)) {
    for (const end of ends) {
      if (lineClear(start, end, open)) {
        return true;
      }
    }
  }
  return false;
}

// Whether a wall square shows, for the fog of war. All four of its corners
// count, sealed or not: the wall in a room's corner has one corner facing the
// room, and the two walls beside it seal that corner against anything aiming
// to stand there, not against the eye. Without this every room's corners stay
// black, and stay unexplored.
export function wallInView(from: XY, wall: XY, blocks: Blocks): boolean {
  const open = outsideSpaces([from], [wall], blocks);
  const { x, y } = wall;
  const corners = [
    { x, y },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x + 1, y: y + 1 },
  ];
  return openCorners(from, open).some((start) => corners.some((corner) => lineClear(start, corner, open)));
}
