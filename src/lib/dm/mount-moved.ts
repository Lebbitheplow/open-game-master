// A mount moved against its will on the board.
//
// "If an effect moves your mount against its will while you're on it, you
// must succeed on a DC 10 Dexterity saving throw or fall off the mount,
// landing prone in a space within 5 feet of it" (SRD 5.1, Mounting and
// Dismounting).
//
// A rider and their mount stand on the board as the rider's one token. A
// push, a pull or a forced move_token that names the mount, a drag, and an
// area that catches the mount move that token with the pair on it: the mount
// moved. One that names the rider takes the rider alone (pc-rider-push.ts).
// A push goes a square at a time and one call may push several times, so the
// doors that move the pair only mark the rider here, and the save is asked
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

// Whether this call has already moved the mount this rider sits on: a push
// that then names the rider too has pushed both together, and the pair has
// gone as one (issue 1055, ruling 6: "the pair moves and the rider saves
// once").
export function wentWithMount(campaignId: string, sheetId: string): boolean {
  return Boolean(moved.get(campaignId)?.has(sheetId));
}

// What a door deep in a call did to a rider it named (pc-rider-push.ts), told
// where the call finishes: a shove's own result says only where its target
// went.
const told = new Map<string, string[]>();

export function tellOfRider(campaignId: string, line: string) {
  told.set(campaignId, [...(told.get(campaignId) ?? []), line]);
}

export function takeToldOfRiders(campaignId: string): string[] {
  const lines = told.get(campaignId) ?? [];
  told.delete(campaignId);
  return lines;
}

// The riders marked since the last settle, taken once.
export function takeMovedRiders(campaignId: string): string[] {
  const riders = [...(moved.get(campaignId) ?? [])];
  moved.delete(campaignId);
  return riders;
}
