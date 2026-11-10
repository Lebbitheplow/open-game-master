// A creature's move toward the characters on the board, put on record
// (last-save.ts, kind moved_near): for each character it came nearer to, how
// far it stood before the move and how near it came along the way. What
// answers "a creature moves into a space within N feet of you" (Halo of
// Spores, trigger-table.ts moved_near) reads that, so a reaction to a creature
// walking up is never taken on the call's word.
//
// Written by move_token's walk (map-tools.ts handleMoveToken), forced
// movement too: the text asks where the creature went, not why. Only moves
// that end or pass within NEAR_FEET are kept, since the record holds the
// fight's last few dozen events.
import type { BattleToken } from "@/lib/battlemap/types";
import { tilesApart } from "@/lib/dm/board-reach";
import { recordTrigger } from "@/lib/dm/last-save";

type XY = { x: number; y: number };

// The farthest reach a feature that answers a creature coming near reads.
export const NEAR_FEET = 30;

// For each character the mover came nearer to: the feet before the move and
// the nearest along the path walked (the landing among it). Pure.
export function nearings(tokens: readonly BattleToken[], mover: BattleToken, origin: XY, walked: readonly XY[]): Array<{ refId: string; fromFeet: number; feet: number }> {
  const at = (point: XY): BattleToken => ({ ...mover, x: point.x, y: point.y });
  const steps = walked.length ? walked : [origin];
  return tokens.flatMap((other) => {
    if (other.id === mover.id || other.kind !== "pc" || other.refId === mover.refId) return [];
    const fromFeet = tilesApart(at(origin), other) * 5;
    const feet = Math.min(...steps.map((step) => tilesApart(at(step), other) * 5));
    return feet < fromFeet && feet <= NEAR_FEET ? [{ refId: other.refId, fromFeet, feet }] : [];
  });
}

export function recordMovesNear(campaignId: string, tokens: readonly BattleToken[], mover: BattleToken, origin: XY, walked: readonly XY[]) {
  for (const near of nearings(tokens, mover, origin, walked)) {
    recordTrigger(campaignId, { kind: "moved_near", characterId: near.refId, forcer: { id: mover.refId, name: mover.name }, feet: near.feet, fromFeet: near.fromFeet });
  }
}
