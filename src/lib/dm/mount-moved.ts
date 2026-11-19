// A mount moved against its will on the board.
//
// "If an effect moves your mount against its will while you're on it, you
// must succeed on a DC 10 Dexterity saving throw or fall off the mount,
// landing prone in a space within 5 feet of it" (SRD 5.1, Mounting and
// Dismounting).
//
// A rider and their mount stand on the board as the rider's one token, so a
// push, a pull or a forced move_token of that token is the mount moved. A
// push goes a square at a time and one call may push several times, so the
// doors that move a token only mark the rider here, and the save is asked
// once where the call finishes (encounter-tools.ts settleTurn,
// mount-tools.ts settleMovedRiders), as the prone save is (mount-thrown.ts).

import { getMounts } from "@/lib/db/mounts";

// The riders a call has moved against their will and not yet asked.
const moved = new Map<string, Set<string>>();

// Called by whatever moves a token without its owner choosing to: marks the
// token's sheet when it is riding.
export function mountMoved(campaignId: string, sheetId: string) {
  if (!getMounts(campaignId)[sheetId]) {
    return;
  }
  const riders = moved.get(campaignId) ?? new Set<string>();
  riders.add(sheetId);
  moved.set(campaignId, riders);
}

// A move the rider and their mount agreed to (a willing target) asks nothing.
export function mountWentWillingly(campaignId: string, sheetId: string) {
  moved.get(campaignId)?.delete(sheetId);
}

// The riders marked since the last settle, taken once.
export function takeMovedRiders(campaignId: string): string[] {
  const riders = [...(moved.get(campaignId) ?? [])];
  moved.delete(campaignId);
  return riders;
}
