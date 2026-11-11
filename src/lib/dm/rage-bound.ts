// A condition that lasts while its source rages: "until the rage ends" (Call
// the Hunt on the allies who answered it, Ancestral Protectors on the creature
// the barbarian struck). The instance names its barbarian in `whileRagingOf`;
// once that barbarian holds no rage, it ends.
//
// A rage ends in many places (a turn with no attack, a fall to 0, the minute,
// a rest, the barbarian's own word), so nothing at those places has to know:
// endRageBound runs before the reads that matter (a character's attack, a
// creature's attack), as a turn ends and at each round wrap. Every condition
// laid "until the rage ends" carries `whileRagingOf` and goes through here.

import { getActiveEncounter, getEnemy, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { instancesOf, removeConditionInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { RAGING } from "@/lib/srd/class-resources";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { endLostEchoes } from "@/lib/dm/mt-fb-echo";
import { fallAsRageEnds } from "@/lib/dm/mt-fb-rage-death";
import { SURGE, endSurgeTracesOf } from "@/lib/dm/mt-fb-wild-surge";
import { RAGING_ON } from "@/lib/dm/vitals-logic";

// The meta an instance laid until its source's rage ends carries.
export function whileRaging(sourceId: string): Pick<ConditionMeta, "whileRagingOf" | "source"> {
  return { whileRagingOf: sourceId, source: sourceId };
}

function stillRaging(sourceId: string): boolean {
  const source = getSheetById(sourceId);
  return Boolean(source && !source.deathSaves?.dead && source.conditions.some((entry) => isConditionNamed(entry, RAGING)));
}

// Every instance whose barbarian no longer rages ends. Returns the table
// lines, and whether an enemy row changed.
export function endRageBound(campaignId: string): { lines: string[]; enemiesChanged: boolean } {
  const lines: string[] = [];
  let enemiesChanged = false;
  const ended = (entry: ConditionMeta) => Boolean(entry.whileRagingOf) && !stillRaging(entry.whileRagingOf!);
  const bound = (conditions: string[], meta: ConditionMetaMap | undefined) =>
    conditions.filter((name) => instancesOf(meta?.[name]).some(ended));
  for (const stale of listSheets(campaignId)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const names = bound(sheet.conditions, sheet.conditionMeta as ConditionMetaMap);
    if (!names.length) continue;
    let conditions = sheet.conditions;
    let meta = sheet.conditionMeta as ConditionMetaMap;
    for (const name of names) {
      const removed = removeConditionInstances(conditions, meta, name, ended);
      conditions = removed.conditions;
      meta = removed.meta;
      if (removed.ended) lines.push(`${sheet.name} is no longer under ${name}: the rage it rode has ended.`);
    }
    patchSheetAudited(campaignId, sheet.id, { conditions, conditionMeta: meta }, { kind: "condition_clock", reason: `${names.join(" and ")} ended with the rage`, delta: { ended: names } });
    // A zealot the rage kept up at 0 hit points falls, or dies (mt-fb-rage-death.ts).
    const fell = names.some((name) => isConditionNamed(name, RAGING_ON)) ? fallAsRageEnds(campaignId, sheet.id) : null;
    if (fell) lines.push(fell);
    // A wild surge's aura on the board goes with it (mt-fb-wild-surge.ts).
    if (names.some((name) => isConditionNamed(name, SURGE))) endSurgeTracesOf(campaignId, sheet.id);
  }
  const encounter = getActiveEncounter(campaignId);
  for (const stale of encounter ? listEnemies(encounter.id) : []) {
    const enemy = getEnemy(stale.id) ?? stale;
    const names = bound(enemy.conditions, enemy.conditionMeta as ConditionMetaMap);
    if (!names.length) continue;
    let conditions = enemy.conditions;
    let meta = enemy.conditionMeta as ConditionMetaMap;
    for (const name of names) {
      const removed = removeConditionInstances(conditions, meta, name, ended);
      conditions = removed.conditions;
      meta = removed.meta;
      if (removed.ended) lines.push(`${enemy.displayName} is no longer under ${name}: the rage it rode has ended.`);
    }
    patchEnemyConditions(enemy.id, conditions, meta as typeof enemy.conditionMeta);
    enemiesChanged = true;
  }
  // The same settle points take an echo off the board whose knight is
  // incapacitated or let it go (mt-fb-echo.ts).
  lines.push(...endLostEchoes(campaignId));
  return { lines, enemiesChanged };
}
