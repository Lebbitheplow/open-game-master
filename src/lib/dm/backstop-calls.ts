// The enemy-turn backstop as a held step.
//
// A creature's turn the GM narrated and never played is played by the server
// once the turn's narration is in (encounter-tools.ts advanceAfterTurn). Each
// of those creatures' turns runs as a held call of its own (held-call.ts
// runHeld), so a d20 in it waits as a GM's enemy_attack waits: a watcher
// holding Portent is asked before the creature's attack roll, and a save the
// creature forces on a seat on physical dice is that seat's to roll. Then the
// pass stops at that creature, the ones after it stay due, and the turn waits
// (awaiting_rolls); once the answer is in, the held call runs that creature's
// turn and the pass goes on from the next one (backstop-resume.ts).
//
// The pending roll a stop or a card parks remembers the call by this name.

import { listPendingForTurn, type PendingRoll } from "@/lib/db/dm-turns";

export const BACKSTOP_CALL = "backstop_enemy_turn";

// A roll the backstop parked: a card that holds its call, or a watch stop.
export function isBackstopPending(pending: PendingRoll): boolean {
  return pending.carry?.call?.name === BACKSTOP_CALL || pending.watch?.calls?.[0]?.name === BACKSTOP_CALL;
}

// Whether this turn's backstop is waiting on a roll or a watcher now.
export function backstopWaiting(turnId: string): boolean {
  return listPendingForTurn(turnId).some((pending) => pending.status === "pending" && isBackstopPending(pending));
}

// Whether any roll of this turn was the backstop's: its narration is in, so
// what follows the rolls is the rest of the pass, never another model call.
export function backstopTurn(pendings: readonly PendingRoll[]): boolean {
  return pendings.some(isBackstopPending);
}
