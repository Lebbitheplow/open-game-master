import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { addConditionInstance, instancesOf, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { EnemyUse } from "@/lib/dm/enemy-casting";
import { textKey } from "@/lib/language/text-logic";

// A creature's ability that leaves whoever withstood it immune for a while
// (SRD 5.1: "If a creature's saving throw is successful or the effect ends
// for it, the creature is immune to the dragon's Frightful Presence for the
// next 24 hours"; the ghost's Horrifying Visage, the mummies' Dreadful Glare,
// the lich's gaze, the harpy's song). The immunity is a mark on the
// character, from that creature, that counts down on the clock as any
// condition does, so it outlasts the fight as the day it lasts does. Without
// it cast_at_player and aoe_damage asked the save again every round: a
// dragon's Multiattack uses its Frightful Presence each turn.

// "immune to frightful presence", the mark the character carries, one
// instance per creature it came from.
export function saveImmunityMark(abilityName: string): string {
  return `immune to ${textKey(abilityName)}`;
}

// Whether this character is immune to this creature's use now.
export function immuneToUse(sheet: { conditions: string[]; conditionMeta?: unknown }, use: Pick<EnemyUse, "enemy" | "name" | "immuneAfter">): boolean {
  if (!use.immuneAfter) {
    return false;
  }
  const mark = saveImmunityMark(use.name);
  const held = sheet.conditions.find((entry) => textKey(entry) === mark);
  return Boolean(held) && instancesOf((sheet.conditionMeta as ConditionMetaMap | undefined)?.[held as string]).some((entry) => entry.source === use.enemy.id);
}

export function immuneLine(name: string, use: Pick<EnemyUse, "enemy" | "name">): string {
  return `${name} withstood ${use.enemy.displayName}'s ${use.name} and is immune to it for 24 hours.`;
}

// After the save: a success leaves the character immune, and so does a
// failure whose text says the effect ending does too (the mark is laid as the
// condition is, so it holds from the moment the effect could end). The
// caller has rolled the save; returns whether a mark was laid.
export function settleSaveImmunity(campaignId: string, sheetId: string, use: Pick<EnemyUse, "enemy" | "name" | "immuneAfter">, saved: boolean): boolean {
  if (!use.immuneAfter || (!saved && !use.immuneAfter.onEnd)) {
    return false;
  }
  const sheet = getSheetById(sheetId);
  if (!sheet || immuneToUse(sheet, use)) {
    return false;
  }
  const laid = addConditionInstance(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, saveImmunityMark(use.name), {
    source: use.enemy.id,
    rounds: use.immuneAfter.rounds,
  });
  const updated = patchSheet(sheet.id, { conditions: laid.conditions, conditionMeta: laid.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return true;
}
