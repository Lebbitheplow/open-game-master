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

// A mark shared by a kind of creature ("the Dreadful Glare of all mummies
// (but not mummy lords)", SRD 5.1) keeps the kinds it covers and those it
// sets apart in its instance's `sources`, as these keys.
const KIND = "kind:";
const NOT = "not:";

// The kind among `kinds` this creature is, by its block's slug or its name
// as whole words, the longest that fits ("mummy lord" before "mummy"), or null.
function kindOf(enemy: { slug: string; displayName: string }, kinds: string[]): string | null {
  const said = [` ${textKey(enemy.slug.replace(/[-_]+/g, " "))} `, ` ${textKey(enemy.displayName)} `];
  return [...kinds].sort((a, b) => b.length - a.length).find((kind) => said.some((words) => words.includes(` ${textKey(kind)} `))) ?? null;
}

// Whether this character is immune to this creature's use now: a mark from
// the creature itself, or a shared one whose kinds take it in.
export function immuneToUse(sheet: { conditions: string[]; conditionMeta?: unknown }, use: Pick<EnemyUse, "enemy" | "name" | "immuneAfter">): boolean {
  if (!use.immuneAfter) {
    return false;
  }
  const mark = saveImmunityMark(use.name);
  const held = sheet.conditions.find((entry) => textKey(entry) === mark);
  return Boolean(held) && instancesOf((sheet.conditionMeta as ConditionMetaMap | undefined)?.[held as string]).some((entry) => {
    if (entry.source === use.enemy.id) {
      return true;
    }
    const covered = (entry.sources ?? []).filter((key) => key.startsWith(KIND)).map((key) => key.slice(KIND.length));
    const apart = (entry.sources ?? []).filter((key) => key.startsWith(NOT)).map((key) => key.slice(NOT.length));
    const kind = covered.length ? kindOf(use.enemy, [...covered, ...apart]) : null;
    return kind !== null && covered.includes(kind) && !apart.includes(kind);
  });
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
  const shared = [...(use.immuneAfter.kinds ?? []).map((kind) => `${KIND}${kind}`), ...(use.immuneAfter.except ?? []).map((kind) => `${NOT}${kind}`)];
  const laid = addConditionInstance(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, saveImmunityMark(use.name), {
    source: use.enemy.id,
    rounds: use.immuneAfter.rounds,
    ...(shared.length ? { sources: shared.slice(0, 20) } : {}),
  });
  const updated = patchSheet(sheet.id, { conditions: laid.conditions, conditionMeta: laid.meta });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
  return true;
}
