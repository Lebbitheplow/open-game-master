// Master of Hexes (Hexblade 14): "When the creature cursed by your Hexblade's
// Curse dies, you can move the curse to another creature ... you don't regain
// hit points from the first creature's death when you do."
//
// The curse's healing lands as the creature dies (authored-hooks.ts); for a
// holder of Master of Hexes it leaves a marker naming what it gave, until the
// end of the warlock's next turn. Moving the curse (the spend, which answers
// the death record: authored-spends.ts triggerRefusal) takes those hit points
// back. Without a marker (a death before this was kept) nothing is taken.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const CURSE_HEALED = "hexblade's curse healed";

// The marker keeps the dead creature as its quarry, so the death record
// still names the creature the curse was on (trigger-table.ts quarryOf reads
// "hexblade's curse ..." conditions) after the curse itself has ended.
export function noteCurseHeal(campaign: Campaign, holderId: string, given: number, quarry: string) {
  const holder = getSheetById(holderId);
  if (!holder || !holdsFeature(holder, "Master of Hexes")) {
    return;
  }
  const marker = `${CURSE_HEALED} (${given})`;
  const kept = removeConditions(holder.conditions, holder.conditionMeta as ConditionMetaMap, holder.conditions.filter((entry) => textKey(entry).startsWith(textKey(CURSE_HEALED))));
  const updated = patchSheet(holder.id, {
    conditions: [...kept.conditions, marker],
    conditionMeta: { ...kept.meta, [marker]: { untilTurnEndOf: holder.id, quarry } } as CharacterSheet["conditionMeta"],
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The patch that takes the curse's healing back, and its line; null with no marker.
// `before` is the sheet as the spend found it (the moved curse's own patch may
// already have dropped the marker with the old curse); `sheet` as it will be.
export function curseHealTakenBack(before: CharacterSheet, sheet: CharacterSheet): { patch: Pick<CharacterSheet, "currentHp" | "conditions" | "conditionMeta">; line: string } | null {
  const marker = before.conditions.find((entry) => textKey(entry).startsWith(textKey(CURSE_HEALED)));
  if (!marker) {
    return null;
  }
  const given = Number(/\((\d+)\)/.exec(marker)?.[1] ?? 0);
  // The marker goes either way: the death is answered.
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, [marker]);
  return {
    patch: { currentHp: Math.max(1, sheet.currentHp - given), conditions: cleared.conditions, conditionMeta: cleared.meta as CharacterSheet["conditionMeta"] },
    line: given > 0 ? `The curse moves, so ${sheet.name} does not regain the ${given} hit points the first creature's death gave.` : "The curse moves; the first creature's death gave no hit points to take back.",
  };
}
