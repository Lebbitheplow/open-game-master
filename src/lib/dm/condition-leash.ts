// A condition held by its source's presence, with no count of rounds: it ends
// when that source is down, dead or incapacitated, or more than `leashFeet`
// from the creature holding it. Champion Challenge (Oath of the Crown) lets a
// creature go once the paladin is incapacitated or dead, or once it stands
// more than 30 feet from them (the subclass table's own wording, subclasses.json).
//
// Checked as every turn ends (src/lib/dm/turn-end.ts endTurns), and after
// every move (afterMoveLeashes: move_token, a character's walk, the board's
// move route), so a creature carried past the distance is let go the moment
// it is: it stayed challenged until some turn ended. The creature's own walk
// is held to the leash (leashRefusal): "cannot move more than 30 feet away
// from you" was shown on the condition and never enforced, so the goblin
// walked off and the turn's end then let it go, the option undoing itself.

import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getTokenByRef } from "@/lib/db/battle-maps";
import type { BattleToken } from "@/lib/battlemap/types";
import { tilesApart } from "@/lib/dm/board-reach";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { Campaign } from "@/lib/db/campaigns";
import type { ToolError } from "@/lib/dm/tool-errors";
import { getSheetById } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { instancesOf, isIncapacitated, removeConditionInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";

// Whether the source still holds this creature. A source that is neither a
// sheet nor an enemy any more is gone, and holds nothing.
function sourceHolds(encounterId: string, holderId: string, entry: ConditionMeta): boolean {
  if (!entry.leashFeet || !entry.source) {
    return true;
  }
  const sheet = getSheetById(entry.source);
  const enemy = sheet ? null : getEnemy(entry.source);
  if (!sheet && !enemy) {
    return false;
  }
  const down = sheet ? sheet.currentHp <= 0 || Boolean(sheet.deathSaves?.dead) : enemy!.status !== "alive" || enemy!.currentHp <= 0;
  // A leash that only ends the condition (Panache: "until you and the target
  // are more than 60 feet apart") is held by the distance alone.
  if (!entry.leashEnds && (down || isIncapacitated((sheet ?? enemy)!.conditions))) {
    return false;
  }
  return withinFeet(encounterId, entry.source, holderId, entry.leashFeet);
}

// Every leashed condition on the encounter's enemies whose source has let go
// ends. Returns the table lines, and whether any enemy row changed.
export function endLeashes(encounterId: string): { lines: string[]; enemiesChanged: boolean } {
  const lines: string[] = [];
  let enemiesChanged = false;
  for (const stale of listEnemies(encounterId)) {
    let enemy: EncounterEnemy = getEnemy(stale.id) ?? stale;
    for (const name of enemy.conditions) {
      const meta = enemy.conditionMeta as ConditionMetaMap;
      if (!instancesOf(meta?.[name]).some((entry) => entry.leashFeet)) {
        continue;
      }
      const removed = removeConditionInstances(enemy.conditions, meta, name, (entry) => !sourceHolds(encounterId, enemy.id, entry));
      if (!removed.removed) {
        continue;
      }
      patchEnemyConditions(enemy.id, removed.conditions, removed.meta);
      enemiesChanged = true;
      if (removed.ended) {
        lines.push(`${enemy.displayName} is no longer held by ${name}.`);
      }
      enemy = getEnemy(enemy.id) ?? enemy;
    }
  }
  return { lines, enemiesChanged };
}

// The refusal of a walk of the creature's own that would end farther from a
// leash's source than the leash allows, or null. A push, a pull or a carry is
// not the creature's own: it is not asked here, and ends the leash instead.
export function leashRefusal(mapId: string, enemy: EncounterEnemy, token: BattleToken, landing: { x: number; y: number }): ToolError | null {
  const meta = enemy.conditionMeta as ConditionMetaMap;
  for (const name of enemy.conditions) {
    for (const entry of instancesOf(meta?.[name])) {
      const source = entry.leashFeet && entry.source ? getTokenByRef(mapId, entry.source) : null;
      if (!source || !entry.leashFeet || entry.leashEnds) {
        continue;
      }
      if (tilesApart({ ...token, x: landing.x, y: landing.y }, source) > Math.floor(entry.leashFeet / 5)) {
        return {
          error: `${enemy.displayName} is held by ${name}: it cannot move more than ${entry.leashFeet} feet from ${source.name}, and (${landing.x},${landing.y}) is farther. It moves within ${entry.leashFeet} feet, or stays. Nothing was moved.`,
          refused: "rules",
        };
      }
    }
  }
  return null;
}

// After anything moves on the board: the leashes whose source has let go
// end now. Returns the table lines.
export function afterMoveLeashes(campaign: Campaign): string[] {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return [];
  }
  const ended = endLeashes(encounter.id);
  if (ended.enemiesChanged) {
    publishEncounter(campaign.id);
  }
  return ended.lines;
}
