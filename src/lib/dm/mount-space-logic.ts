// Where a rider's token comes to stand as they mount (issue 1055).
//
// A rider's token fills the mount's space, so mounting a Large horse turns
// one square into four. The pair takes a space that still covers the square
// the rider stands on: the rider climbs up, they do not walk anywhere. Where
// no such space is clear of walls and of other creatures there is no room
// for the mount, and the caller refuses the mount with that reason.
//
// Pure: the board in, the square out.

import { anchorsCovering, footprintFits, footprintIndexes, footprintTiles, type Footprint } from "@/lib/battlemap/footprint";
import { nearestStand, type Standing } from "@/lib/battlemap/ground-change";
import { blocksMoveFor, tileAt, tileIndex, type XY } from "@/lib/battlemap/types";

export type MountingBoard = {
  terrain: string;
  width: number;
  height: number;
  // Every square another creature holds: not the rider's own, and not the
  // mount's when it stands on the board (it is what they climb onto).
  occupied: Set<number>;
  flying: boolean;
};

// The top-left square of the space the pair takes, or null when there is no
// room. The rider's own square is tried first, so a rider with open ground
// below and to the right does not shift at all.
export function mountingAnchor(board: MountingBoard, at: XY, footprint: Footprint): XY | null {
  const clear = (anchor: XY) =>
    footprintFits(board.width, board.height, anchor, footprint) &&
    footprintTiles(anchor, footprint).every(
      (tile) => !blocksMoveFor(tileAt(board.terrain, board.width, tile.x, tile.y), board.flying) && !board.occupied.has(tileIndex(board.width, tile.x, tile.y)),
    );
  return anchorsCovering(at, footprint).find(clear) ?? null;
}

// The refusal's words, for the GM and the player who reads it on the Hand.
export function noRoomToMount(rider: string, mount: string, size: string, footprint: Footprint): string {
  return `${rider} has no room to mount ${mount} here: a ${size} mount fills a space ${footprint} squares by ${footprint} (${footprint * 5} feet a side), and no such space around the square ${rider} stands on is clear of walls and other creatures. They move to open ground first. Nothing was spent.`;
}

// A board being set: everyone is given one square, and a rider needs the
// mount's. Each rider (`riders` holds their tokens' ids) takes the nearest
// space to the square they were given that is open ground nobody else
// holds; the others stay where they were set. A rider the board has no room
// for at all stays put, as a creature with nowhere to go does.
export function seatRiders(ground: string, width: number, height: number, standing: Standing[], riders: ReadonlySet<string>): Array<{ id: string; x: number; y: number }> {
  const taken = new Set<number>();
  for (const token of standing) {
    if (!riders.has(token.id)) {
      footprintIndexes(width, token, token.footprint).forEach((index) => taken.add(index));
    }
  }
  const moves: Array<{ id: string; x: number; y: number }> = [];
  for (const token of standing) {
    if (!riders.has(token.id)) {
      continue;
    }
    const spot = nearestStand(ground, width, height, token, token.footprint, taken) ?? { x: token.x, y: token.y };
    footprintIndexes(width, spot, token.footprint).forEach((index) => taken.add(index));
    if (spot.x !== token.x || spot.y !== token.y) {
      moves.push({ id: token.id, x: spot.x, y: spot.y });
    }
  }
  return moves;
}
