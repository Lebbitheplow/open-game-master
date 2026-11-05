import { paintTerrain, type Brush } from "@/lib/battlemap/paint";
import { footprintFits, footprintIndexes, type Footprint } from "@/lib/battlemap/footprint";
import { blocksMove, inBounds, type XY } from "@/lib/battlemap/types";

// The ground changing under a running fight on purpose: a prepared fight's
// event turns squares of its map to another kind of ground (issue 685,
// src/lib/dm/fight-ground.ts). The strokes go through the painter, so the
// walled border and the terrain alphabet hold exactly as for a GM's brush.
//
// Two things differ from a brush on the live board, both because the change
// was planned rather than slipped:
//   - Whoever stands where the ground no longer holds them is moved first,
//     to the nearest square they can stand on, as a map laid under a fight
//     restands everyone (map-library.ts restandOnPrepared). The GM's brush
//     refuses instead, because there the GM is at hand to move the token.
//   - The field may be split. A bridge giving way is meant to leave the two
//     banks apart; the painter's "walled off from the rest of the field"
//     refusal guards a GM's slip, and the engine already plays ground in
//     pieces (a prepared map laid under a fight is never held to it, and a
//     creature that cannot reach says so).
//
// Pure (no database), so the suites drive it directly.

export type Standing = { id: string; x: number; y: number; footprint: Footprint };

export type GroundPlan =
  | { terrain: string; moves: Array<{ id: string; x: number; y: number }> }
  | { error: string };

// The nearest anchor where a creature of this footprint stands on open
// ground that nobody else holds: nearestOpenTile's ring search
// (paint.ts), for the creature's whole footprint. Null when there is none.
function nearestStand(ground: string, width: number, height: number, from: XY, footprint: Footprint, taken: Set<number>): XY | null {
  const fits = (x: number, y: number) =>
    inBounds(width, height, x, y) &&
    footprintFits(width, height, { x, y }, footprint) &&
    footprintIndexes(width, { x, y }, footprint).every((index) => !blocksMove(ground[index]) && !taken.has(index));
  if (fits(from.x, from.y)) {
    return { x: from.x, y: from.y };
  }
  for (let radius = 1; radius < Math.max(width, height); radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === radius && fits(from.x + dx, from.y + dy)) {
          return { x: from.x + dx, y: from.y + dy };
        }
      }
    }
  }
  return null;
}

// `drawn` is the terrain the painter edits (door glyphs and all), `ground`
// the one the engine walks now (a locked door as rock, a wall of force):
// the squares this change leaves alone keep what the engine reads of them.
export function planGroundChange(input: {
  drawn: string;
  ground: string;
  width: number;
  height: number;
  tiles: XY[];
  terrain: Brush;
  standing: Standing[];
}): GroundPlan {
  const { width, height } = input;
  const painted = paintTerrain({
    terrain: input.drawn,
    width,
    height,
    strokes: input.tiles.map((tile) => ({ x: tile.x, y: tile.y, brush: input.terrain })),
    limit: width * height,
  });
  if ("error" in painted) {
    return painted;
  }
  const after = input.ground.split("");
  for (let index = 0; index < after.length; index += 1) {
    if (painted.terrain[index] !== input.drawn[index]) {
      after[index] = painted.terrain[index];
    }
  }
  const moves = restandOn(after.join(""), width, height, input.standing);
  return "error" in moves ? moves : { terrain: painted.terrain, moves };
}

// Whoever the ground no longer holds, set on the nearest square they can
// stand on that nobody else holds. Shared with the revert of a change of
// ground (src/lib/dm/fight-event-undo-logic.ts), which puts squares back and
// must not leave anyone inside them either.
export function restandOn(
  ground: string,
  width: number,
  height: number,
  standing: Standing[],
): Array<{ id: string; x: number; y: number }> | { error: string } {
  const taken = new Set<number>();
  for (const token of standing) {
    for (const index of footprintIndexes(width, token, token.footprint)) {
      taken.add(index);
    }
  }
  const moves: Array<{ id: string; x: number; y: number }> = [];
  for (const token of standing) {
    const own = footprintIndexes(width, token, token.footprint);
    if (!own.some((index) => blocksMove(ground[index] ?? ""))) {
      continue;
    }
    own.forEach((index) => taken.delete(index));
    const spot = nearestStand(ground, width, height, token, token.footprint, taken);
    if (!spot) {
      return { error: "There is no open ground left for someone standing there." };
    }
    footprintIndexes(width, spot, token.footprint).forEach((index) => taken.add(index));
    moves.push({ id: token.id, x: spot.x, y: spot.y });
  }
  return moves;
}

// The map as the change would leave it, for the editor's picture of the
// plan: the painter's own strokes over the drawn terrain, unchanged when
// nothing is picked yet.
export function previewGround(terrain: string, width: number, height: number, tiles: XY[], brush: Brush): string {
  if (!tiles.length || terrain.length !== width * height) {
    return terrain;
  }
  const painted = paintTerrain({
    terrain,
    width,
    height,
    strokes: tiles.map((tile) => ({ x: tile.x, y: tile.y, brush })),
    limit: width * height,
  });
  return "error" in painted ? terrain : painted.terrain;
}

// Whether a creature stands on walkable ground: what a change of ground
// promises for everyone on the board once it lands.
export function standsOnOpenGround(ground: string, width: number, at: XY, footprint: Footprint = 1): boolean {
  return footprintIndexes(width, at, footprint).every((index) => !blocksMove(ground[index] ?? "#"));
}
