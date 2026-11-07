// A condition held by its source's presence, with no count of rounds: it ends
// when that source is down, dead or incapacitated, or more than `leashFeet`
// from the creature holding it. Champion Challenge (Oath of the Crown): the
// effect ends on a creature "if you are incapacitated or die or if the creature
// is more than 30 feet away from you".
//
// Checked as every turn ends (src/lib/dm/turn-end.ts endTurns), so a creature
// carried past the distance mid-turn is let go at that turn's end.

import { getEnemy, listEnemies, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
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
  if (down || isIncapacitated((sheet ?? enemy)!.conditions)) {
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
