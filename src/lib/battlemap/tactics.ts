import { hasLineOfSight } from "@/lib/battlemap/los";
import { reachableTiles } from "@/lib/battlemap/movement";
import { blocksMove, chebyshev, tileAt, tileIndex, type XY } from "@/lib/battlemap/types";

// Tactical positioning helpers, pure like the rest of the battlemap engine
// so scripts/test-battlemap-tactics.mjs can drive them directly.

// Best tile a ranged attacker can reach this round to gain both range and
// line of sight on the target: the cheapest qualifying reachable tile,
// closest to the target on cost ties. Null when nothing reachable works.
export function bestFiringPosition(
  terrain: string,
  width: number,
  height: number,
  occupied: Set<number>,
  from: XY,
  target: XY,
  budget: number,
  rangeTiles: number,
): { at: XY; cost: number } | null {
  const reach = reachableTiles(terrain, width, height, occupied, from, budget);
  let best: { at: XY; cost: number } | null = null;
  for (const [idx, cost] of reach) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (chebyshev(x, y, target.x, target.y) > rangeTiles) {
      continue;
    }
    if (!hasLineOfSight(terrain, width, x, y, target.x, target.y)) {
      continue;
    }
    if (
      !best ||
      cost < best.cost ||
      (cost === best.cost &&
        chebyshev(x, y, target.x, target.y) <
          chebyshev(best.at.x, best.at.y, target.x, target.y))
    ) {
      best = { at: { x, y }, cost };
    }
  }
  return best;
}

// The squares of a space `footprint` squares a side with its top-left
// corner at (x,y), or null when any of them is off the board, a wall or
// taken: where a creature that size may be set down.
export function openSpace(terrain: string, width: number, height: number, taken: ReadonlySet<number>, x: number, y: number, footprint = 1): number[] | null {
  const squares: number[] = [];
  for (let dy = 0; dy < footprint; dy += 1) {
    for (let dx = 0; dx < footprint; dx += 1) {
      const at = { x: x + dx, y: y + dy };
      if (at.x < 0 || at.y < 0 || at.x >= width || at.y >= height) {
        return null;
      }
      const idx = tileIndex(width, at.x, at.y);
      if (taken.has(idx) || blocksMove(tileAt(terrain, width, at.x, at.y))) {
        return null;
      }
      squares.push(idx);
    }
  }
  return squares;
}

// Free floor tiles for reinforcement spawns. With anchors (existing enemy
// tokens) new arrivals cluster near them; otherwise they enter from the
// ground farthest from the party. Each picked tile becomes occupied for the
// next pick so a group never stacks. `footprints` holds the size of each
// pick, in order (one square when none is given): an ogre arriving needs
// four open squares, and set down on one it stood half inside whoever was
// beside it.
export function findSpawnTiles(
  terrain: string,
  width: number,
  height: number,
  occupied: Set<number>,
  count: number,
  anchors: XY[],
  awayFrom: XY[],
  footprints: readonly number[] = [],
): XY[] {
  const taken = new Set(occupied);
  const picks: XY[] = [];
  for (let n = 0; n < count; n += 1) {
    const size = Math.max(1, footprints[n] ?? 1);
    let best: { at: XY; score: number; squares: number[] } | null = null;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const squares = openSpace(terrain, width, height, taken, x, y, size);
        if (!squares) {
          continue;
        }
        // Lower score wins: distance to the nearest anchor, or (with no
        // anchors) negative distance to the nearest party member.
        const score = anchors.length
          ? Math.min(...anchors.map((spot) => chebyshev(x, y, spot.x, spot.y)))
          : -Math.min(
              ...(awayFrom.length ? awayFrom : [{ x: 0, y: 0 }]).map((spot) =>
                chebyshev(x, y, spot.x, spot.y),
              ),
            );
        if (!best || score < best.score) {
          best = { at: { x, y }, score, squares };
        }
      }
    }
    if (!best) {
      break;
    }
    picks.push(best.at);
    for (const idx of best.squares) {
      taken.add(idx);
    }
  }
  return picks;
}
