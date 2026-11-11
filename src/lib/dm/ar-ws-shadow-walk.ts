// An authored spend that teleports its holder, with the square named.
//
// "A bonus action teleports 120 feet between dim or dark spaces" (Shadow Walk,
// Shadow Magic 14). The spend paid the bonus action and answered words: the
// teleport waited for a second call (move_token with teleport, which takes
// the credit feature-teleport.ts keeps), and a table that never made that
// call spent the bonus action for nothing. The 120 feet were held only by
// that second call, and the light at either end by nobody.
//
// use_resource with x and y (the square a feature moves its holder to, as every such spend names it)
// now makes the move in the spend: the holder goes to that square through the
// board's own teleport check (map-tools.ts teleportSquareRefusal: on the map,
// open floor, nobody there, within the feature's feet), and a spend whose row
// says it goes between shadows asks the light at both ends
// (ar-ws-shadow-light.ts). Everything is asked before anything is spent, so a
// refusal costs nothing. With no square named the spend is what it was: the
// teleport waits for move_token, which holds it to the same feet and the same
// light.
//
// A spend that moves a creature the holder touches (Hidden Paths' touch)
// names no such creature here and keeps waiting for move_token.
//
// Called by authored-spend-effects.ts for every spend of kind teleport.

import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { placeTeleported } from "@/lib/dm/teleport-place";
import { getActiveBoard } from "@/lib/db/encounters";
import { planTeleportFx } from "@/lib/battlemap/fx-plan";
import { TILE_FEET } from "@/lib/battlemap/types";
import { shadowsRefusal } from "@/lib/dm/ar-ws-shadow-light";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import { publishFx } from "@/lib/dm/fx";
import { publishBattleMapUpdate, teleportSquareRefusal } from "@/lib/dm/map-tools";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { SpendDoes } from "@/lib/srd/authored-effects-types";

// The holder moved to the square the call names, the refusal, or null when
// the call names no square (the spend then leaves the teleport waiting).
export function jumpToSquare(ctx: SpendContext, does: Extract<SpendDoes, { kind: "teleport" }>): ToolError | { result: Record<string, unknown> } | null {
  const { x, y } = ctx.args;
  if (x === undefined || y === undefined || does.touched) {
    return null;
  }
  const { campaign, sheet } = ctx;
  const name = ctx.spend.name;
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!map || !token) {
    return { error: `${name} moves ${sheet.name} on the battle map, and they have no token on one: spend it with no square. Nothing was spent.`, retry: true };
  }
  const refused = teleportSquareRefusal(map, token, x, y, does.feet) ?? (does.shadows ? shadowsRefusal(campaign.id, map, token, { x, y }, name) : null);
  if (refused) {
    return { ...refused, error: `${refused.error} Nothing was spent.` };
  }
  const from = { x: token.x, y: token.y };
  const feet = Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) * TILE_FEET;
  placeTeleported(ctx.campaign.id, token, { x, y });
  publishBattleMapUpdate(campaign.id);
  publishFx(campaign.id, planTeleportFx({ from, to: { x, y }, tokenId: token.id }));
  return { result: { moved: `${sheet.name} goes ${feet} feet to (${x},${y})${does.note ? `, ${does.note}` : ""}. No movement was spent; the board already shows it.` } };
}
