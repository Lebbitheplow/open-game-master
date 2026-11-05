import type { Campaign } from "@/lib/db/campaigns";
import {
  clearExplored,
  getBattleMapForEncounter,
  listTokens,
  placeToken,
  setBattleMapTerrain,
} from "@/lib/db/battle-maps";
import { listEnemies } from "@/lib/db/encounters";
import type { EncounterTemplate } from "@/lib/db/encounter-templates";
import type { ArmedFightEvent } from "@/lib/db/fight-events";
import { getPreparedMap } from "@/lib/db/prepared-maps";
import { listSheets } from "@/lib/db/sheets";
import { planGroundChange } from "@/lib/battlemap/ground-change";
import { footprintLookup } from "@/lib/battlemap/view";
import { fitEventsToBoard, outcomeLine, type FightAction, type FightEvent } from "@/lib/dm/fight-event-logic";
import { sameBoard, type BoardStamp } from "@/lib/dm/fight-ground-logic";
import { isDefeated } from "@/lib/dm/knockout";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";

// "The ground changes" at the table (issue 685; what it is:
// src/lib/dm/fight-ground-logic.ts). The squares name the fight's prepared
// map, so the change runs only on that map, as the deploy laid it; on any
// other board it was dropped when the fight was armed (fitEventsToBoard).
//
// It is the GM's brush on the live board, made in advance: the painter
// applies the strokes (src/lib/battlemap/ground-change.ts), the drawn terrain
// is written, fog memory goes as it does for a painted wall, and the board is
// published once. Movement, sight and cover read that terrain, so all of them
// follow. Nobody is left inside a wall: whoever stood there is set down on
// the nearest open square first, without spending their movement.

// The board this fight's plan was drawn on, when the deploy laid the
// fight's prepared map: the same size and the same ground, square for
// square. Null otherwise (no map linked, or one that could not be laid and
// left the generator's board), and then no change of ground is armed.
export function preparedBoard(campaign: Campaign, template: EncounterTemplate, encounterId: string): BoardStamp | null {
  const mapId = template.map.mapId;
  const prepared = mapId ? getPreparedMap(campaign.id, mapId) : null;
  const live = getBattleMapForEncounter(encounterId);
  if (!prepared || !live || live.width !== prepared.width || live.height !== prepared.height) {
    return null;
  }
  return live.drawnTerrain === prepared.terrain ? { width: live.width, height: live.height, seed: live.seed } : null;
}

// A save of the fight's plan keeps a change of ground only when the fight
// links a prepared map, its squares fitted to that map: with none linked
// there is nothing for the squares to name, and the editor says so.
export function fitPlanToMap<T extends { events: FightEvent[] }>(campaignId: string, extras: T, mapId: string | null): T {
  const map = mapId ? getPreparedMap(campaignId, mapId) : null;
  return { ...extras, events: fitEventsToBoard(extras.events, map) };
}

export function changeGround(
  campaign: Campaign,
  armed: ArmedFightEvent,
  action: Extract<FightAction, { kind: "ground" }>,
): { line: string } | { refused: string } {
  const map = getBattleMapForEncounter(armed.encounterId);
  if (!map || !sameBoard(armed.board, { width: map.width, height: map.height, seed: map.seed })) {
    return { refused: "the board on the table is no longer the map the plan was drawn on." };
  }
  const tokens = listTokens(map.id);
  const enemies = listEnemies(armed.encounterId);
  const footprint = footprintLookup(new Map(enemies.map((enemy) => [enemy.id, enemy])));
  const plan = planGroundChange({
    drawn: map.drawnTerrain,
    ground: map.terrain,
    width: map.width,
    height: map.height,
    tiles: action.tiles,
    terrain: action.terrain,
    standing: tokens.map((token) => ({ id: token.id, x: token.x, y: token.y, footprint: footprint(token) })),
  });
  if ("error" in plan) {
    return { refused: plan.error };
  }
  for (const move of plan.moves) {
    placeToken(move.id, move.x, move.y);
  }
  setBattleMapTerrain(map.id, plan.terrain);
  // A changed square is one a character may already have "seen" as it was,
  // so the fog memory goes, as it does for a GM's painted wall.
  clearExplored(map.id);
  publishBattleMapUpdate(campaign.id);
  return { line: outcomeLine({ kind: "ground", terrain: action.terrain, moved: movedNames(campaign, tokens, plan.moves, enemies) }) };
}

// Who the table is told was pushed clear: the people it can see standing
// up. A creature the GM keeps off the board, a prop, and anyone down (an
// enemy out of the fight, a hero at 0 hit points) are moved without a word.
function movedNames(
  campaign: Campaign,
  tokens: ReturnType<typeof listTokens>,
  moves: Array<{ id: string }>,
  enemies: ReturnType<typeof listEnemies>,
): string[] {
  const movedIds = new Set(moves.map((move) => move.id));
  const enemyById = new Map(enemies.map((enemy) => [enemy.id, enemy]));
  const sheetById = new Map(listSheets(campaign.id).map((sheet) => [sheet.id, sheet]));
  return tokens
    .filter((token) => movedIds.has(token.id) && !token.hidden && token.kind !== "prop")
    .filter((token) => {
      if (token.kind === "enemy") {
        const enemy = enemyById.get(token.refId);
        return Boolean(enemy && enemy.status === "alive" && !isDefeated(enemy));
      }
      if (token.kind === "pc") {
        return (sheetById.get(token.refId)?.currentHp ?? 1) > 0;
      }
      return true;
    })
    .map((token) => token.name);
}
