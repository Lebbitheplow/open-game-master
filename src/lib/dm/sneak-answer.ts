// What a spend that answers the turn's Sneak Attack may land on (Wails from
// the Grave: "After a sneak attack drops or wounds a creature, a second
// creature within 30 feet takes half your sneak attack dice in necrotic
// damage"). Every spend whose die_damage carries `afterSneak` goes through
// here before it rolls, so a refusal spends nothing.
//
// The first creature is the one the hit that spent the turn's Sneak Attack
// struck (action-budget.ts SNEAK_HIT, marked by attack-swing.ts). The stored
// text says "within 30 feet" and names no point; the feature it condenses
// measures from the first creature ("within 30 feet of the first creature"),
// so the distance is taken from it.
import { SNEAK_HIT } from "@/lib/dm/action-budget";
import { withinFeet } from "@/lib/dm/authored-saves";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import type { ToolError } from "@/lib/dm/tool-errors";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { isNamed } from "@/lib/srd/feature-names";

export type SneakAnswer = { firstId: string; alsoFirst: boolean };

export function sneakAnswerFor(input: {
  encounter: Encounter | null;
  marks: string[] | undefined;
  sheet: CharacterSheet;
  enemy: EncounterEnemy;
  label: string;
  rule: { rangeFt: number; firstToo?: string };
}): SneakAnswer | ToolError {
  const { encounter, sheet, enemy, label, rule } = input;
  const mark = (input.marks ?? []).find((entry) => entry.startsWith(SNEAK_HIT));
  if (!encounter || !mark) {
    return { error: `${label} answers a Sneak Attack, and ${sheet.name} has dealt none this turn. Nothing was spent.`, refused: "rules" };
  }
  const firstId = mark.slice(SNEAK_HIT.length);
  if (enemy.id === firstId) {
    return { error: `${label} strikes a second creature, not the one the Sneak Attack hit: pass another targetEnemyId. Nothing was spent.`, retry: true };
  }
  if (!withinFeet(encounter.id, firstId, enemy.id, rule.rangeFt)) {
    return { error: `${enemy.displayName} is beyond ${rule.rangeFt} feet of the creature the Sneak Attack hit; ${label} reaches no further. Nothing was spent.`, refused: "rules" };
  }
  const alsoFirst = Boolean(rule.firstToo) && sheet.features.some((feature) => isNamed(feature.name, rule.firstToo ?? ""));
  return { firstId, alsoFirst };
}
