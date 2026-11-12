// What two Arcane Shot options do after the arrow has landed, at the doors
// where it happens (src/lib/dm/mt-fb-arcane-shot.ts lays the conditions):
//   - Grasping Arrow's brambles: "it takes 2d6 slashing damage the first time
//     on each turn it moves 1 foot or more without teleporting". Every walk
//     and every push goes through zone-triggers.ts zonesAfterMove, which asks
//     here; a teleport does not go through it.
//   - Beguiling Arrow's charm "ends early if the chosen ally attacks the
//     charmed target, deals damage to it, or forces it to make a saving
//     throw": the ally's attack (attack-swing.ts), spell at it
//     (cast-at-enemy.ts), area (aoe-damage.ts), spend's damage
//     (authored-spend-effects.ts damageEnemy) and every save it forces
//     (forced-save.ts rollEnemySave, by the save's origin) ask here.
// The speed the brambles take and the 5 feet a Shadow Arrow leaves of a
// creature's sight are rows of src/lib/srd/authored-conditions.ts, read where
// every speed and every sight is read. Kept apart from the resolver so the
// doors that call it import nothing of the spend path.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, turnKey } from "@/lib/db/encounters";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { rollCard } from "@/lib/dm/roll-card";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { BEGUILED, GRASPING } from "@/lib/srd/mt-fb-arcane-shot";

type Meta = Record<string, Record<string, unknown> | undefined>;

// A creature in the brambles moved: 2d6 slashing, once on each turn. The
// turn it was last torn on is kept on the condition.
export function bramblesAfterMove(campaign: Campaign, encounterId: string, enemyId: string): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const enemy = getEnemy(enemyId);
  if (!encounter || encounter.id !== encounterId || !enemy || enemy.status !== "alive") {
    return [];
  }
  const held = enemy.conditions.find((entry) => isConditionNamed(entry, GRASPING));
  const meta = (enemy.conditionMeta ?? {}) as Meta;
  const key = turnKey(encounter);
  if (!held || meta[held]?.tornOn === key) {
    return [];
  }
  patchEnemyConditions(enemy.id, enemy.conditions, { ...meta, [held]: { ...meta[held], tornOn: key } } as typeof enemy.conditionMeta);
  const rolled = rollCard(campaign, null, null, "damage", `${enemy.displayName}: the Grasping Arrow's brambles as it moves`, "2d6", null).total;
  return [hurtEnemy(campaign, encounter, getEnemy(enemyId) ?? enemy, rolled, "slashing", "the Grasping Arrow's brambles")];
}

// The ally a Beguiling Arrow charmed a creature by has harmed it: the charm
// ends. Returns the table line, or null when no such charm holds.
export function beguilingBroken(campaignId: string, allyId: string, enemyId: string): string | null {
  const enemy = getEnemy(enemyId);
  const held = enemy?.conditions.find((entry) => isConditionNamed(entry, "charmed"));
  const meta = (enemy?.conditionMeta ?? {}) as Meta;
  if (!enemy || !held || meta[held]?.[BEGUILED] !== true || meta[held]?.source !== allyId) {
    return null;
  }
  const cleared = removeConditions(enemy.conditions, meta as ConditionMetaMap, [held]);
  patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta as typeof enemy.conditionMeta);
  publishEncounter(campaignId);
  return `${enemy.displayName} is no longer charmed: the ally the Beguiling Arrow charmed it by has turned on it.`;
}
