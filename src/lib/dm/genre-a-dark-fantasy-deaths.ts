// What a creature's death ends or sets off for the dark fantasy classes,
// called once from src/lib/dm/enemy-damage.ts applyEnemyDamage as the creature
// is written dead. Hunter's Brand lasts "until it dies or you rest": the brand
// on a creature that died is taken off its hunter here, so the next brand is a
// bonus action of its own. Before this the brand outlived its creature and
// moved to the next one attacked as Hunter's Mark does.
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { BRAND_CONDITIONS } from "@/lib/srd/genre-a-dark-fantasy-conditions";
import { quarrySlainMark } from "@/lib/dm/genre-cc-a-spends";

// The brands on the dead creature come off, a line for each hunter.
export function darkFantasyOnDeath(campaign: Campaign, enemyId: string): string[] {
  const lines: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const meta = sheet.conditionMeta as ConditionMetaMap;
    const ended = sheet.conditions.filter((entry) => meta[entry]?.quarry === enemyId && BRAND_CONDITIONS.some((name) => isConditionNamed(entry, name)));
    if (!ended.length) {
      continue;
    }
    const cleared = removeConditions(sheet.conditions, meta, ended);
    // No Rest for the Wicked: "an extra full turn immediately after killing
    // your branded quarry", spent before this turn ends (genre-cc-a-spends.ts).
    const slain = quarrySlainMark(sheet);
    const updated = patchSheet(sheet.id, slain ? { conditions: [...cleared.conditions, slain.condition], conditionMeta: { ...cleared.meta, [slain.condition]: { ...slain.meta, quarry: enemyId } } } : { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${sheet.name}'s Hunter's Brand ends with the creature it marked.`);
  }
  return lines;
}
