// A feature that moves its holder to a square the call names, made on the
// board in the spend itself: a teleport (Misty Wanderer's misty step, with a
// willing creature beside them brought along) or a step the swarm carries
// them that draws no opportunity attack (Gathered Swarm). Before this the
// spend paid and handed the move back as words for a move_token call.
//
// With no square named the spend keeps its old door: the teleport is
// credited (feature-teleport.ts) and move_token makes it. The square rides
// use_resource's x and y, which the console and the Hand send; the model's
// tool description does not name them (the compact tool budget), and the
// credited move_token stays its way.
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveBoard, listEnemies } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, listTokens, moveToken, placeToken } from "@/lib/db/battle-maps";
import { blocksMove, tileAt, tileIndex, TILE_FEET } from "@/lib/battlemap/types";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { planTeleportFx } from "@/lib/battlemap/fx-plan";
import { publishFx } from "@/lib/dm/fx";
import { placeTeleported } from "@/lib/dm/teleport-place";
import { openSquaresBeside } from "@/lib/dm/companion-approach";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { tilesApart } from "@/lib/dm/board-reach";
import type { ToolError } from "@/lib/dm/tool-errors";

export type Square = { x: number; y: number };

// The square, checked for the mover, or the refusal: on the board, open
// floor, free, and within `feet`.
function landing(campaignId: string, refId: string, square: Square, feet: number, what: string) {
  const board = getActiveBoard(campaignId);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const token = map ? getTokenByRef(map.id, refId) : null;
  if (!board || !map || !token) {
    return { error: `${what} moves its holder on the battle map, and they have no token on one. Nothing was spent.`, refused: "rules" } as ToolError;
  }
  if (square.x < 0 || square.y < 0 || square.x >= map.width || square.y >= map.height) {
    return { error: `(${square.x},${square.y}) is outside the ${map.width}x${map.height} map. Nothing was spent.`, retry: true } as ToolError;
  }
  if (blocksMove(tileAt(map.terrain, map.width, square.x, square.y))) {
    return { error: `(${square.x},${square.y}) is a wall; ${what} needs open floor. Nothing was spent.`, retry: true } as ToolError;
  }
  const enemiesById = new Map(listEnemies(board.id).map((enemy) => [enemy.id, enemy]));
  if (occupiedTiles(map, listTokens(map.id), token, footprintLookup(enemiesById)).has(tileIndex(map.width, square.x, square.y))) {
    return { error: `(${square.x},${square.y}) is occupied by another combatant. Nothing was spent.`, retry: true } as ToolError;
  }
  const apart = Math.max(Math.abs(square.x - token.x), Math.abs(square.y - token.y)) * TILE_FEET;
  if (apart > feet) {
    return { error: `(${square.x},${square.y}) is ${apart} feet from where they stand; ${what} goes ${feet} feet. Nothing was spent.`, retry: true } as ToolError;
  }
  return { board, map, token };
}

// Checked before anything is paid; `go()` makes the move once it is.
export function planFeatureMove(
  campaign: Campaign,
  input: { refId: string; square: Square; feet: number; what: string; teleport: boolean; along?: { refId: string; withinFeet: number } | null },
): ToolError | { go: () => string[] } {
  const spot = landing(campaign.id, input.refId, input.square, input.feet, input.what);
  if ("error" in spot) {
    return spot;
  }
  const { board, map, token } = spot;
  const friend = input.along ? getTokenByRef(map.id, input.along.refId) : null;
  if (input.along && friend && tilesApart(token, friend) * TILE_FEET > input.along.withinFeet) {
    return { error: `${friend.name} is not within ${input.along.withinFeet} feet of ${token.name}, so ${input.what} cannot bring them along. Nothing was spent.`, refused: "rules" };
  }
  return {
    go: () => {
      const from = { x: token.x, y: token.y };
      if (input.teleport) {
        placeTeleported(campaign.id, token, input.square);
        publishFx(campaign.id, planTeleportFx({ from, to: input.square, tokenId: token.id }));
      } else {
        // Carried, not walked: the turn's movement is not spent.
        moveToken(token.id, input.square.x, input.square.y, token.movedThisRound);
      }
      const lines = [`${token.name} ${input.teleport ? "teleports" : "is carried"} to (${input.square.x},${input.square.y})${input.teleport ? "" : " without drawing opportunity attacks"}.`];
      if (friend) {
        const moved = getTokenByRef(map.id, input.refId);
        const beside = moved ? openSquaresBeside(board.id, map, friend, moved, 1)[0] : undefined;
        if (beside) {
          // Brought along by a teleport, it is on record as teleported too.
          if (input.teleport) placeTeleported(campaign.id, friend, beside);
          else placeToken(friend.id, beside.x, beside.y);
          publishFx(campaign.id, planTeleportFx({ from: { x: friend.x, y: friend.y }, to: beside, tokenId: friend.id }));
          lines.push(`${friend.name} comes along to (${beside.x},${beside.y}).`);
        } else {
          lines.push(`No open square beside (${input.square.x},${input.square.y}) holds ${friend.name}, who stays.`);
        }
      }
      releaseGrapplesOutOfReach(campaign);
      publishBattleMapUpdate(campaign.id);
      return lines;
    },
  };
}
