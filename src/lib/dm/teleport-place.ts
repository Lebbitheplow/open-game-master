// A token teleported by a door that places it itself: set on its square, and
// the square it left put on record (last-save.ts recordTeleport) for what
// answers a teleport (Magic-User's Nemesis puts the creature back there).
// Every such door goes through here: move_token's teleport
// (map-tools.ts handleTeleportToken), a feature's move (feature-move.ts),
// Distant Strike (distant-strike.ts), Benign Transposition and its kin
// (ar-ws-transposition.ts) and Shadow Walk's step (ar-ws-shadow-walk.ts).
// A walk is no teleport and moves through moveToken.
import { placeToken } from "@/lib/db/battle-maps";
import type { BattleToken } from "@/lib/battlemap/types";
import { recordTeleport } from "@/lib/dm/last-save";

export function placeTeleported(campaignId: string, token: Pick<BattleToken, "id" | "refId" | "name" | "kind" | "x" | "y">, to: { x: number; y: number }): void {
  const from = { x: token.x, y: token.y };
  placeToken(token.id, to.x, to.y);
  if (token.refId) {
    recordTeleport(campaignId, { id: token.refId, name: token.name }, from, token.kind === "enemy");
  }
}
