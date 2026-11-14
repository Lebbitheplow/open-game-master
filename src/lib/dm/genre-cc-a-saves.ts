// Ashen Hymn (penitent 3): "Bonus action: chant for 1 minute; enemies within
// 10 ft have disadvantage on their first save against fear each turn", wired
// by the 2026-11-13 creator audit's second genre pass. While a penitent holds
// the hymn's mark, a creature within 10 feet of them rolls its first save
// against being frightened in each turn at disadvantage (a turn's mark on the
// fight, so its second save that turn is its own). Read by the one door every
// enemy save goes through (src/lib/dm/forced-save.ts rollEnemySave).
import { getActiveEncounter, turnKey, type EncounterEnemy } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { fightMarked, markFight } from "@/lib/dm/turn-marks";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { getSheetById } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

const HYMN = "ashen hymn";

export function ashenHymnSources(campaignId: string, enemy: Pick<EncounterEnemy, "id">, against: string | string[] | undefined): Array<"disadvantage"> {
  const fears = Array.isArray(against) ? against.includes("frightened") : against === "frightened";
  const encounter = fears ? getActiveEncounter(campaignId) : null;
  if (!encounter) {
    return [];
  }
  const chanting = listSheets(campaignId).some((sheet) => sheet.currentHp > 0 && sheet.conditions.some((entry) => isConditionNamed(entry, HYMN)) && withinFeet(encounter.id, sheet.id, enemy.id, 10));
  const key = `ashen hymn:${enemy.id}`;
  const stamp = `${encounter.id}:${turnKey(encounter)}`;
  if (!chanting || fightMarked(encounter.id, key, stamp)) {
    return [];
  }
  markFight(encounter.id, key, stamp);
  return ["disadvantage"];
}

// The Final Movement (dirgesinger 20): "your inspiration dice explode (max
// rolls add another die)": a Requiem die a holder of the feature gave
// (its condition's source) is rolled as it is spent, each maximum adding
// another, and folded in as the total; any other inspiration die is its
// own die in the expression. Read where a check or a save folds the die in
// (src/lib/dm/roll-feature-riders.ts).
export function inspirationDie(sheet: { conditionMeta?: unknown } | null | undefined, condition: string, die: string): string {
  const total = explodedDie(sheet, condition, die);
  return total === null ? `+1${die}` : `+${total}`;
}

// The same die settled after the d20 (src/lib/dm/forced-save.ts
// settleHeldDie): its exploded total, or null for an ordinary die.
export function explodedDie(sheet: { conditionMeta?: unknown } | null | undefined, condition: string, die: string): number | null {
  const source = (((sheet?.conditionMeta ?? {}) as Record<string, { source?: string }>)[condition] ?? {}).source;
  const giver = source ? getSheetById(source) : null;
  const sides = Number(/d(\d+)/.exec(die)?.[1] ?? 0);
  if (!giver || !sides || !holdsGenreFeature(giver, "dirgesinger", "The Final Movement")) {
    return null;
  }
  let total = 0;
  for (let rolls = 0; rolls < 20; rolls += 1) {
    const face = rollExpression(`1d${sides}`).total;
    total += face;
    if (face < sides) {
      break;
    }
  }
  return total;
}
