// An enemy dragging the character it grapples (SRD 5.1, Grappling: Moving a
// Grappled Creature), for move_token with drag: the walk costs double unless
// every creature held is two sizes smaller, and each one is set down beside
// the enemy where it stops (src/lib/dm/drag.ts). The player's side is the
// battle-map move route's `drag`, and move_token walking a character on their
// own turn (token-rules.ts walkCharacter).
//
// A held creature that rides is dragged out of the saddle. The grapple holds
// the rider, not the mount under it, and the drag moves what the grappler
// holds: "you can drag or carry the grappled creature with you". Issue 1055,
// ruling 6, says of a push that names the rider: "the rider is pushed out of
// the saddle, and the mount stays ... Moving the mount when the rider was the
// target would move a creature the effect never touched." A drag names the
// rider the same way, so the mount stays where the pair stood and no save to
// stay on is owed: that save is for a mount moved "against its will" (SRD
// 5.1, Mounting and Dismounting), and this one was not moved. Nothing in the
// drag's rule knocks the creature prone, so the rider is set down standing
// beside the grappler, still held. A drag used to move the pair's one token,
// mount and all, and ask a character the save.

import { moveToken, type BattleMap } from "@/lib/db/battle-maps";
import type { Campaign } from "@/lib/db/campaigns";
import { getMounts } from "@/lib/db/mounts";
import { listSheets } from "@/lib/db/sheets";
import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { sheetSize } from "@/lib/srd";
import { occupiedTiles } from "@/lib/battlemap/view";
import { footprintForSize, footprintIndexes, type Footprint } from "@/lib/battlemap/footprint";
import type { BattleToken, XY } from "@/lib/battlemap/types";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { dragCostFactor, dragPlacements, grappledBy } from "@/lib/dm/drag";
import { draggedFromSaddle } from "@/lib/dm/enemy-rider-falls";
import { pushedFromSaddle } from "@/lib/dm/pc-rider-push";
import type { ToolError } from "@/lib/dm/tool-errors";

export type EnemyDrag = { factor: 1 | 2; held: BattleToken[] };

// The characters this enemy holds on the board and what dragging them costs,
// or the refusal when it holds nobody.
export function enemyDrag(campaignId: string, enemy: EncounterEnemy, tokens: BattleToken[]): EnemyDrag | ToolError {
  const sheets = listSheets(campaignId).filter((sheet) =>
    grappledBy({ id: sheet.id, conditions: sheet.conditions, conditionMeta: sheet.conditionMeta as ConditionMetaMap }, enemy.id),
  );
  const held = sheets
    .map((sheet) => tokens.find((token) => token.refId === sheet.id))
    .filter((token): token is BattleToken => Boolean(token));
  if (!held.length) {
    return { error: `${enemy.displayName} is not grappling anyone on the board, so there is nothing to drag. Move it without drag.`, retry: true };
  }
  const factor = dragCostFactor(
    enemy.stats.size,
    sheets.map((sheet) => ({ refId: sheet.id, name: sheet.name, size: sheetSize(sheet) })),
  );
  return { factor, held };
}

// The enemies this character holds on the board and what dragging them
// costs, as the move route prices it, or the refusal when they hold nobody.
export function characterDrag(sheet: CharacterSheet, enemies: EncounterEnemy[], tokens: BattleToken[]): EnemyDrag | ToolError {
  const gripped = enemies.filter((enemy) => enemy.status === "alive" && grappledBy(enemy, sheet.id));
  const held = gripped
    .map((enemy) => tokens.find((token) => token.refId === enemy.id))
    .filter((token): token is BattleToken => Boolean(token));
  if (!held.length) {
    return { error: `${sheet.name} is not grappling anyone on the board, so there is nothing to drag. Move them without drag.`, retry: true };
  }
  const factor = dragCostFactor(
    sheetSize(sheet),
    gripped.map((enemy) => ({ refId: enemy.id, name: enemy.displayName, size: enemy.stats.size })),
  );
  return { factor, held };
}

// Whether the creature on this held token rides a mount: a character with a
// mount on record, or an enemy on another enemy's back. Its token is the
// pair's (db/battle-maps.ts getTokenByRef).
function ridesMount(map: BattleMap, token: BattleToken): boolean {
  if (token.kind === "pc") {
    return Boolean(getMounts(map.campaignId)[token.refId]);
  }
  return token.kind === "enemy" && Boolean(getEnemy(token.refId)?.ridesEnemyId);
}

// Where the held creatures go once the grappler lands; null when there is no
// room beside it. A rider goes alone, at its own size, and the space the pair
// held stays taken: its mount keeps it.
export function dragLandings(input: {
  map: BattleMap;
  tokens: BattleToken[];
  mover: BattleToken;
  landing: XY;
  walked: XY[];
  held: BattleToken[];
  footprintOf: (token: BattleToken) => Footprint;
}): Array<{ token: BattleToken; at: XY }> | null {
  const heldIds = new Set(input.held.map((token) => token.id));
  const landed = input.tokens
    .filter((token) => !heldIds.has(token.id))
    .map((token) => (token.id === input.mover.id ? { ...token, x: input.landing.x, y: input.landing.y } : token));
  const occupied = occupiedTiles(input.map, landed, null, input.footprintOf);
  const riders = new Set(input.held.filter((token) => ridesMount(input.map, token)).map((token) => token.id));
  for (const token of input.held) {
    if (riders.has(token.id)) {
      for (const cell of footprintIndexes(input.map.width, token, input.footprintOf(token))) {
        occupied.add(cell);
      }
    }
  }
  const alone = (token: BattleToken): Footprint => (token.kind === "enemy" ? footprintForSize(getEnemy(token.refId)?.stats.size) : 1);
  return dragPlacements({
    terrain: input.map.terrain,
    width: input.map.width,
    height: input.map.height,
    occupied,
    landing: input.landing,
    walked: input.walked,
    dragged: input.held.map((token) => ({ token, footprint: riders.has(token.id) ? alone(token) : input.footprintOf(token) })),
  });
}

// Sets each dragged creature down where dragLandings put it, once the
// grappler has moved. A rider leaves the saddle and its mount stays; anyone
// else is moved as they stand. `by` is the grappler's name. Returns where
// each one ended, and whether it left a saddle to get there.
export function setDownDragged(campaign: Campaign, map: BattleMap, carried: Array<{ token: BattleToken; at: XY }>, by: string): Array<{ token: BattleToken; at: XY; unsaddled?: true }> {
  return carried.map((entry) => {
    const { token } = entry;
    if (ridesMount(map, token)) {
      const rider = token.kind === "enemy" ? getEnemy(token.refId) : null;
      const out = rider ? draggedFromSaddle(campaign, rider, entry.at, by) : pushedFromSaddle(campaign, map, token.refId, entry.at, { draggedBy: by });
      if (out) {
        return { token, at: out.at, unsaddled: true };
      }
    }
    moveToken(token.id, entry.at.x, entry.at.y, token.movedThisRound);
    return entry;
  });
}

// The dragged, as a move's result names them.
export function draggedWords(setDown: Array<{ token: BattleToken; at: XY; unsaddled?: true }>): string {
  return setDown.map((entry) => `${entry.token.name} to (${entry.at.x},${entry.at.y})${entry.unsaddled ? ", out of the saddle (its mount stays where the pair stood; no save to stay on)" : ""}`).join("; ");
}
