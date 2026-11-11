// The marks a character holds only while they can act: Hexblade's Curse lasts
// "until it or you die or you are incapacitated" (ConditionMeta
// endsIfIncapacitated, laid by src/lib/dm/authored-spend-effects.ts).
//
// Every door that incapacitates a character ends them here: set_condition
// (src/lib/dm/set-condition.ts) and the fall to 0 hit points, where the
// character is unconscious or dead (src/lib/dm/pc-damage.ts applyPcDamage).
// The fall once ended nothing, so a dead warlock's curse stood for its minute.
// A new way to incapacitate a character calls this too.
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { removeConditions, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";

// Ends the holder's own such conditions; answers the names that ended. The
// caller publishes the sheet.
export function endIncapacitationHeld(sheetId: string): string[] {
  const fresh = getSheetById(sheetId);
  if (!fresh) {
    return [];
  }
  const meta = (fresh.conditionMeta ?? {}) as ConditionMetaMap;
  const held = Object.entries(meta)
    .filter(([, entry]) => (entry as ConditionMeta | undefined)?.endsIfIncapacitated)
    .map(([name]) => name);
  if (!held.length) {
    return [];
  }
  const cleared = removeConditions(fresh.conditions, meta, held);
  patchSheet(sheetId, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  return held;
}
