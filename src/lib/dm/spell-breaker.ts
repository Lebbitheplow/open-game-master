// Spell Breaker (Arcana Domain 6): "Restoring hit points with a spell also
// ends one spell of equal or lower level on the target." Before this the row
// was narrated, and an ally held by Hold Person stayed held after a Cure
// Wounds from a slot that could have broken it.
//
// What is "on" a creature is what the engine tracks: the condition instances
// a spell laid down, which carry the spell and the slot it was cast from
// (src/lib/dm/spell-effects.ts). Of those at or under the healing slot, the
// one ended is a spell the creature's foes laid on it, the highest first: a
// cleric breaking a spell on an ally means the hostile one, and an ally's own
// Bless is left alone. Called from src/lib/dm/heal-spell.ts.
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { spellFactsFor } from "@/lib/content";
import { instancesOf, removeConditionInstances, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { holdsFeature } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";

export function spellBreaker(campaign: Campaign, caster: CharacterSheet, targetId: string, slotLevel: number): string | null {
  if (slotLevel < 1 || !holdsFeature(caster, "Spell Breaker")) {
    return null;
  }
  const target = getSheetById(targetId);
  if (!target) {
    return null;
  }
  const party = new Set(listSheets(campaign.id).map((sheet) => sheet.id));
  const authors = spellAuthorsFor(campaign);
  const meta = (target.conditionMeta ?? {}) as ConditionMetaMap;
  let best: { spell: string; source: string; level: number } | null = null;
  for (const condition of target.conditions) {
    for (const instance of instancesOf(meta[condition])) {
      if (!instance.spell || (instance.source && party.has(instance.source))) {
        continue;
      }
      const level = instance.slotLevel ?? spellFactsFor(instance.spell, authors)?.level ?? null;
      if (level === null || level > slotLevel || (best && best.level >= level)) {
        continue;
      }
      best = { spell: instance.spell, source: instance.source ?? "", level };
    }
  }
  if (!best) {
    return null;
  }
  const ended = best;
  let conditions = target.conditions;
  let nextMeta = meta;
  for (const condition of target.conditions) {
    const cleared = removeConditionInstances(conditions, nextMeta, condition, (instance) => textKey(instance.spell ?? "") === textKey(ended.spell) && (instance.source ?? "") === ended.source);
    conditions = cleared.conditions;
    nextMeta = cleared.meta;
  }
  const updated = patchSheet(target.id, { conditions, conditionMeta: nextMeta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `Spell Breaker: ${ended.spell} (level ${ended.level}) on ${target.name} ends`;
}
