// Channel Divinity: Path to the Grave (Grave Domain): "curse a creature
// within 30 feet until the end of your next turn; the next attack hit against
// it, it has vulnerability to all of that attack's damage, and the curse
// ends." The spend lays the curse as a condition on the creature
// (src/lib/srd/authored-effects-w2-divine.ts); the blow that lands an attack
// hit on a creature (src/lib/dm/pc-attack-damage.ts landBlow, the shared end
// of pc_attack on either dice path and of a character's opportunity attack)
// asks here first, so every part of that one blow meets the vulnerability and
// the curse goes with it. Damage that is not an attack's hit (a spell's save,
// an area) never reads it.
import { getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { DAMAGE_TYPES } from "@/lib/srd/authored-effects";

export const GRAVE_CURSE = "path to the grave";

// The creature as the blow should meet it, and the end of the curse, or
// null when it carries none.
export function graveCurseFor(enemy: EncounterEnemy): { enemy: EncounterEnemy; end: () => string } | null {
  const cursed = enemy.conditions.find((entry) => isConditionNamed(entry, GRAVE_CURSE));
  if (!cursed) {
    return null;
  }
  const own = (enemy.stats.vulnerable ?? "").trim();
  return {
    // A clause of its own, so the block's qualified lines ("from
    // nonmagical attacks") are left as they are.
    enemy: { ...enemy, stats: { ...enemy.stats, vulnerable: [own, DAMAGE_TYPES.join(", ")].filter(Boolean).join("; ") } },
    end: () => {
      const fresh = getEnemy(enemy.id) ?? enemy;
      const left = removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, [cursed]);
      patchEnemyConditions(fresh.id, left.conditions, left.meta as typeof fresh.conditionMeta);
      return `The Path to the Grave curse on ${enemy.displayName} is spent: the hit's damage met its vulnerability.`;
    },
  };
}
