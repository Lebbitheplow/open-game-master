// The slayer's Quarry as its text plays it (WAVE2 D5):
//   Quarry (7): "mark a creature; your attacks against it deal +1d6 damage
//     until it dies": the mark ends with its creature (authoredOnKill calls
//     endHorrorMarks), it does not wait to be moved;
//   Improved Quarry (11): "rises to +2d6": a second d6 on hits against the
//     marked creature only (a hit_rider with vsMark, genre-a-strikes.ts);
//   Extinction (20): "Quarry marks two creatures at once": a second Quarry on
//     another living creature is written as its own mark, "quarry (second)",
//     which the quarry row reads as Quarry (attack-marks.ts planMarks), so both
//     creatures take the die.
// The Quarry spend (authored-spend-effects.ts) asks horrorMarkCondition which
// mark it writes.
import type { Campaign } from "@/lib/db/campaigns";
import { getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isKnockedOut } from "@/lib/dm/knockout";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";
import { classLevelFor } from "@/lib/srd/multiclass";

const QUARRY = "quarry";

const slayerHolds = (sheet: CharacterSheet, feature: string) => classLevelFor(sheet, "slayer") > 0 && holdsFeature(sheet, feature);
const SECOND = "quarry (second)";

// The holder's Quarry marks, with the creature each names.
function quarryMarks(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): Array<{ condition: string; enemyId: string | null }> {
  const meta = (sheet.conditionMeta ?? {}) as ConditionMetaMap;
  return sheet.conditions
    .filter((entry) => isConditionNamed(entry, QUARRY))
    .map((condition) => ({ condition, enemyId: meta[condition]?.quarry ?? null }));
}

// Whether one of the holder's Quarry marks names this creature (Deathblow).
export function quarryOn(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">, enemyId: string): boolean {
  return quarryMarks(sheet).some((entry) => entry.enemyId === enemyId);
}

const standing = (enemyId: string | null) => {
  const enemy = enemyId ? getEnemy(enemyId) : null;
  return Boolean(enemy && enemy.status === "alive" && !isKnockedOut(enemy));
};

// The mark a Quarry spend on `enemyId` writes. One mark, moved, for a slayer
// without Extinction. With it: the creature already marked keeps its mark; a
// first mark on a creature still standing stays and the second is laid as
// "quarry (second)" (a later one moves the second).
export function horrorMarkCondition(sheet: CharacterSheet, condition: string, enemyId: string): string {
  // Read by name and class: the feature's other clause (a reroll against the
  // Quarry) is not a row of the authored layer yet.
  if (!isConditionNamed(condition, QUARRY) || !slayerHolds(sheet, "Extinction")) {
    return condition;
  }
  const marks = quarryMarks(sheet);
  const already = marks.find((entry) => entry.enemyId === enemyId);
  if (already) {
    return already.condition;
  }
  const first = marks.find((entry) => !isConditionNamed(entry.condition, SECOND));
  return first && standing(first.enemyId) ? SECOND : QUARRY;
}

// Quarry lasts "until it dies": every Quarry mark on the fallen creature ends.
// Called by authoredOnKill (src/lib/dm/authored-hooks.ts) for each holder.
export function endHorrorMarks(campaign: Campaign, holders: CharacterSheet[], enemy: Pick<EncounterEnemy, "id" | "displayName">): string[] {
  const lines: string[] = [];
  for (const holder of holders) {
    const ended = quarryMarks(holder).filter((entry) => entry.enemyId === enemy.id).map((entry) => entry.condition);
    if (!ended.length) {
      continue;
    }
    const fresh = getSheetById(holder.id) ?? holder;
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, ended);
    const updated = patchSheet(holder.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`Quarry: ${enemy.displayName} is dead, and ${holder.name}'s mark on it ends.`);
  }
  return lines;
}
