// What the dark fantasy classes' marks do to a character's own attack roll,
// read once by src/lib/dm/authored-hooks.ts authoredAttackSituation:
// - Judgment Shot: "a ranged attack against your brand becomes an automatic
//   critical if it hits": the mark on the branded creature makes the next
//   ranged attack on it a critical hit if it hits, and that attack spends it.
// Before this the spend handed back its guidance and the attack rolled as any.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { EncounterEnemy } from "@/lib/db/encounters";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { JUDGMENT_SHOT } from "@/lib/srd/genre-a-dark-fantasy-conditions";

export function darkFantasyAttackEdge(sheet: CharacterSheet, enemy: EncounterEnemy, melee: boolean): { feature: string; spent: string; note: string } | null {
  const meta = sheet.conditionMeta as ConditionMetaMap;
  const shot = sheet.conditions.find((entry) => isConditionNamed(entry, JUDGMENT_SHOT) && meta[entry]?.quarry === enemy.id);
  if (shot && !melee) {
    return { feature: "Judgment Shot", spent: shot, note: "Judgment Shot: a hit on the branded creature is a critical hit, spent by this attack" };
  }
  return null;
}
