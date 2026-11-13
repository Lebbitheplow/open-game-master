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
