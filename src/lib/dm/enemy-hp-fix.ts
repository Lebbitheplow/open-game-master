import { patchEnemyConditions, patchEnemyHp, type EncounterEnemy } from "@/lib/db/encounters";
import { enemyHpCorrection } from "@/lib/dm/catalog-enemy-hp";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

// A person's correction of an enemy's hit points, judged by
// enemyHpCorrection (catalog-enemy-hp.ts) and written: the GM's route
// (src/app/api/campaigns/[campaignId]/dm/enemy-hp/route.ts) and a prepared
// fight's "hurt" event (src/lib/dm/fight-events.ts) set a creature's hit
// points the one way, with the one set of refusals. The caller publishes the
// fight and keeps any ledger row.
export function fixEnemyHp(enemy: EncounterEnemy, wanted: number): { currentHp: number; wakes: boolean } | { error: string } {
  const correction = enemyHpCorrection(enemy, wanted);
  if ("error" in correction) {
    return correction;
  }
  // Read back after the write: a regained hit point may have ended a
  // condition there (a caltrops wound, condition-logic.ts endedByRegain).
  const healed = patchEnemyHp(enemy.id, correction.currentHp, "alive") ?? enemy;
  if (correction.wakes) {
    const meta = { ...(healed.conditionMeta as ConditionMetaMap) };
    const kept = healed.conditions.filter((entry) => {
      const woke = entry.trim().toLowerCase() === "unconscious";
      if (woke) {
        delete meta[entry];
      }
      return !woke;
    });
    patchEnemyConditions(enemy.id, kept, meta);
  }
  return correction;
}
