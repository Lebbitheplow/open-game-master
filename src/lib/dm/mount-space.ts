// The room a mount needs on the board (issue 1055): the database half of
// mount-space-logic.ts. Asked before a mount is taken, so a refusal spends
// nothing, and applied once the mount is on record.

import { footprintForSize, type Footprint } from "@/lib/battlemap/footprint";
import { forgetMoves } from "@/lib/battlemap/move-undo";
import type { BattleToken, XY } from "@/lib/battlemap/types";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { getBattleMap, getBattleMapForEncounter, getTokenByRef, listTokens, placeToken } from "@/lib/db/battle-maps";
import { getActiveBoard, listEnemies } from "@/lib/db/encounters";
import { getMounts } from "@/lib/db/mounts";
import { mountingAnchor, noRoomToMount, seatRiders } from "@/lib/dm/mount-space-logic";
import type { ToolError } from "@/lib/dm/tool-errors";

export type MountSpace = { encounterId: string; token: BattleToken; at: XY; footprint: Footprint };

// The space the pair will take, null when nothing on a board changes (no
// board, the rider not on it, a mount of one square), or the refusal when
// the mount has no room. `steedId` is the mount's own sheet when it stands
// on the board: its square is free for the pair, since it is the pair.
export function spaceToMount(
  campaignId: string,
  rider: { id: string; name: string },
  mount: { name: string; size: string },
  steedId?: string,
): MountSpace | ToolError | null {
  const footprint = footprintForSize(mount.size);
  const encounter = footprint > 1 ? getActiveBoard(campaignId) : null;
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  const token = map ? getTokenByRef(map.id, rider.id) : null;
  if (!encounter || !map || !token) {
    return null;
  }
  const others = listTokens(map.id).filter((entry) => entry.refId !== steedId);
  const occupied = occupiedTiles(map, others, token, footprintLookup(new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]))));
  const at = mountingAnchor({ terrain: map.terrain, width: map.width, height: map.height, occupied, flying: token.movement === "fly" }, token, footprint);
  return at ? { encounterId: encounter.id, token, at, footprint } : { error: noRoomToMount(rider.name, mount.name, mount.size, footprint), refused: "rules" };
}

// The pair takes its space: the token moves only when the rider's own square
// could not be the space's corner. A walk kept for Undo is forgotten either
// way, since taking it back would set four squares down where one stood.
export function takeMountSpace(space: MountSpace) {
  forgetMoves(space.encounterId);
  if (space.at.x !== space.token.x || space.at.y !== space.token.y) {
    placeToken(space.token.id, space.at.x, space.at.y);
  }
}

// A board has just been set, or a character has just been set on one: each
// was given a square, and anyone who rode in on a Large mount needs four.
// They take the nearest space that holds the pair (mount-space-logic.ts
// seatRiders). Nothing is read past the mount records when nobody rides.
export function seatMountedParty(campaignId: string, mapId: string) {
  const large = Object.entries(getMounts(campaignId)).filter(([, mount]) => footprintForSize(mount.size) > 1).map(([riderId]) => riderId);
  const map = large.length ? getBattleMap(mapId) : null;
  if (!map) {
    return;
  }
  const tokens = listTokens(mapId);
  const footprint = footprintLookup(new Map(listEnemies(map.encounterId).map((enemy) => [enemy.id, enemy])));
  const riders = new Set(tokens.filter((token) => token.kind === "pc" && large.includes(token.refId)).map((token) => token.id));
  const standing = tokens.map((token) => ({ id: token.id, x: token.x, y: token.y, footprint: footprint(token) }));
  for (const move of seatRiders(map.terrain, map.width, map.height, standing, riders)) {
    placeToken(move.id, move.x, move.y);
  }
}
