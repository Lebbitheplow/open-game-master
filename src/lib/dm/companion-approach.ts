import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef, listTokens, type BattleMap } from "@/lib/db/battle-maps";
import { listEnemies, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { footprintDistance, footprintFits, enemyFootprint, footprintIndexes, type Footprint } from "@/lib/battlemap/footprint";
import { chebyshev, type BattleToken } from "@/lib/battlemap/types";
import { footprintLookup, occupiedTiles } from "@/lib/battlemap/view";
import { walkCharacter } from "@/lib/dm/token-rules";
import { tokenFootprint } from "@/lib/dm/board-reach";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The open squares beside a target of the given footprint, nearest the mover
// first: where a character must stand to strike it in melee. The companion's
// walk below tries them in turn; a player's attack out of reach is refused
// with the first one named (map-tools.ts checkPcAttackRange), so a model that
// cannot count tiles still knows where to move.
export function openSquaresBeside(
  encounterId: string,
  map: BattleMap,
  mover: BattleToken,
  target: BattleToken,
  size: number,
): Array<{ x: number; y: number }> {
  const enemiesById = new Map(listEnemies(encounterId).map((enemy) => [enemy.id, enemy]));
  const footprints = footprintLookup(enemiesById);
  const occupied = occupiedTiles(map, listTokens(map.id), mover, footprints);
  // The mover's own space: a rider's is the mount's (issue 1055), and every
  // square of it has to be free and outside the target's, with one of them
  // touching it. For a mover of one square these are the squares around.
  const mine = footprints(mover);
  const squares: Array<{ x: number; y: number }> = [];
  for (let x = target.x - mine; x <= target.x + size; x += 1) {
    for (let y = target.y - mine; y <= target.y + size; y += 1) {
      const inside = footprintDistance({ x, y }, mine, target, size as Footprint) === 0;
      if (!inside && footprintFits(map.width, map.height, { x, y }, mine) && footprintIndexes(map.width, { x, y }, mine).every((index) => !occupied.has(index))) {
        squares.push({ x, y });
      }
    }
  }
  return squares.sort((a, b) => chebyshev(mover.x, mover.y, a.x, a.y) - chebyshev(mover.x, mover.y, b.x, b.y));
}

// An AI companion getting into reach before its basic attack, when the
// server plays its turn (encounter-tools.ts companionAutoAct: the AI's
// backstop, and a person's "Play their turn"). The enemies the server plays
// walk to their target first (enemy-approach.ts); a companion stood where
// it was and reported it was out of reach. It walks as a character walks on
// the board (walkCharacter: its speed this turn, prone, allies' spaces,
// fear, the opportunity attacks it draws), toward the nearest open square
// beside the target, as far as its speed carries it. Returns the line for
// the table note, or null when it did not move.
export function approachForCompanion(
  campaign: Campaign,
  encounter: Encounter,
  sheet: CharacterSheet,
  target: EncounterEnemy,
): string | null {
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return null;
  }
  const me = getTokenByRef(map.id, sheet.id);
  const them = getTokenByRef(map.id, target.id);
  if (!me || !them) {
    return null;
  }
  const size = enemyFootprint(target);
  // Already beside it from any square of its own space: a companion on a
  // Large horse whose far square touches the target is in reach, and a walk
  // from there would only spend movement and draw opportunity attacks
  // (issue 1055).
  if (footprintDistance(me, tokenFootprint(me), them, size) <= 1) {
    return null;
  }
  for (const square of openSquaresBeside(encounter.id, map, me, them, size)) {
    const walked = walkCharacter(campaign, encounter, map, sheet, me, square);
    if ("error" in walked) {
      continue;
    }
    const now = getTokenByRef(map.id, sheet.id);
    return now && (now.x !== me.x || now.y !== me.y)
      ? `${sheet.name} moves toward ${target.displayName}.`
      : null;
  }
  return null;
}
