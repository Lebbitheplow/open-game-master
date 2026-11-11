// The mark Slayer's Counter's hit leaves on the ranger (slayers-counter.ts):
// "and a hit means the save automatically succeeds". The ranger's reaction
// attack is made at the stop before the save, so by the time the held call
// throws that save the answer is on the sheet, and the save site
// (forced-save.ts rollCharacterSave) reads and takes it there. It is kept on
// the sheet, not in memory, so a held call rolled back and run again (a roll
// parked for another character it catches) finds it again. It names the
// creature whose forced save it answers, and the fight's clock takes it after
// a round when the call it was laid for threw no save.
// Imported by forced-save.ts: must stay free of the attack's modules.

import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const COUNTERED_SAVE = "slayer's counter";

export function layCounteredSave(rangerId: string, preyId: string): CharacterSheet | null {
  const now = getSheetById(rangerId);
  if (!now) {
    return null;
  }
  const kept = now.conditions.filter((entry) => entry !== COUNTERED_SAVE);
  return patchSheet(now.id, { conditions: [...kept, COUNTERED_SAVE], conditionMeta: { ...now.conditionMeta, [COUNTERED_SAVE]: { quarry: preyId, rounds: 1 } } });
}

// Whether the mark answers a save this creature forces; taken when it does.
export function takeCounteredSave(sheetId: string, forcerId: string): boolean {
  const now = getSheetById(sheetId);
  const meta = (now?.conditionMeta ?? {}) as ConditionMetaMap;
  if (!now || !now.conditions.includes(COUNTERED_SAVE) || (meta[COUNTERED_SAVE] as { quarry?: string } | undefined)?.quarry !== forcerId) {
    return false;
  }
  const cleared = removeConditions(now.conditions, now.conditionMeta, [COUNTERED_SAVE]);
  patchSheet(now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  return true;
}
