// The floor a press was made against (issue 931). The lead's floor button
// acts on whatever the floor is when the request lands: a "Skip turn" pressed
// on one turn, reaching the server after the pointer had moved, skipped the
// next combatant's turn instead. The screen sends the floor it showed; the
// route answers 409 when the floor has changed since, as the Stop route does
// with the job it was pressed on. A request that names none (an older app)
// acts as it always did.
//
// Pure: shared by the screens that press and the route that answers.
import type { Floor } from "@/lib/db/campaigns";

export type FloorExpect = { mode: Floor["mode"]; currentName?: string; round?: number };

// What a press names of the floor it saw: the mode, and in a fight whose
// turn and which round.
export function floorExpectOf(floor: Floor): FloorExpect {
  return floor.mode === "initiative" ? { mode: floor.mode, currentName: floor.currentName, round: floor.round } : { mode: floor.mode };
}

// Whether the floor has moved from what the press saw.
export function floorMoved(floor: Floor, expect: FloorExpect): boolean {
  if (floor.mode !== expect.mode) {
    return true;
  }
  if (floor.mode !== "initiative") {
    return false;
  }
  return (expect.currentName !== undefined && expect.currentName !== floor.currentName) || (expect.round !== undefined && expect.round !== floor.round);
}

// The refusal, saying where the floor is now.
export function floorMovedLine(floor: Floor): string {
  const now =
    floor.mode === "initiative"
      ? `it is now ${floor.currentName}'s turn (round ${floor.round})`
      : floor.mode === "hold"
        ? "responses are held"
        : floor.mode === "spotlight"
          ? "the floor is with the players picked"
          : "the floor is open";
  return `The floor changed before that reached the table (${now}), so nothing was done. Look again, then press.`;
}
