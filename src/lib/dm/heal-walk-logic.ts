// The walk a healing feature makes past the creatures it heals (Balm of
// Peace: "you can move up to your speed ... and when you move within 5 feet
// of any other creature during this action, you can restore" hit points). A
// creature is healed only if the walk can come within 5 feet of it, so two
// allies 30 feet apart in opposite directions are not both reached by a
// cleric with 30 feet of speed, as a straight radius of speed + 5 feet had it.
//
// Greedy: from where the walker stands, the nearest creature still to heal
// (by the board's own movement costs: walls, difficult terrain, other
// creatures' spaces), then the next from there, until the speed runs out.
// Pure: the board in, the order and the square the walk ends on out.

import { reachableTiles } from "@/lib/battlemap/movement";
import type { MoveTraits, XY } from "@/lib/battlemap/types";

export type WalkBoard = {
  terrain: string;
  width: number;
  height: number;
  occupied: Set<number>;
  flying: boolean;
  traits: MoveTraits;
};

export type WalkTarget = { id: string; tiles: XY[] };

export function healWalk(board: WalkBoard, from: XY, budget: number, targets: WalkTarget[]): { order: string[]; end: XY } {
  const order: string[] = [];
  const remaining = [...targets];
  let at = from;
  let left = Math.max(0, budget);
  while (remaining.length) {
    const costs = reachableTiles(board.terrain, board.width, board.height, board.occupied, at, left, 1, board.flying, board.traits);
    let pick: { target: WalkTarget; cost: number; at: XY } | null = null;
    for (const [index, cost] of costs) {
      const spot = { x: index % board.width, y: Math.floor(index / board.width) };
      for (const target of remaining) {
        const beside = target.tiles.some((tile) => Math.max(Math.abs(tile.x - spot.x), Math.abs(tile.y - spot.y)) <= 1);
        if (beside && (!pick || cost < pick.cost)) {
          pick = { target, cost, at: spot };
        }
      }
    }
    if (!pick) {
      break;
    }
    order.push(pick.target.id);
    remaining.splice(remaining.indexOf(pick.target), 1);
    at = pick.at;
    left -= pick.cost;
  }
  return { order, end: at };
}
