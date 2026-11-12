// Exalted Champion (Oath of the Crown 20): "advantage on Wisdom saves for you
// and allies within 30 feet, and death saves at advantage for the same". The
// paladin's own two are the condition row's (src/lib/srd/authored-conditions.ts
// exalted_champion: advantageOn and deathSaveAdvantage); this is the allies'
// part, which the counter's guidance once left out ("The server applies both
// to the paladin"). Read by src/lib/dm/forced-save.ts rollExtrasFor, the
// campaign context every character save and death save is rolled with, and
// applied by src/lib/dm/rolls.ts resolveRollExpression.

import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { sideOf } from "@/lib/dm/combatant";
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const EXALTED = "exalted champion";
const RANGE_FT = 30;

export type AllyAdvantage = { saves: string[]; death: boolean; note: string };

// The ally's advantage from a paladin's Exalted Champion within 30 feet, or
// null. With no fight on, there is no board to measure: the party is
// together, as withinFeet reads a fight with no board.
export function exaltedAllyAdvantage(campaignId: string, sheet: Pick<CharacterSheet, "id">): AllyAdvantage | null {
  const encounter = getActiveEncounter(campaignId);
  for (const stale of listSheets(campaignId)) {
    if (stale.id === sheet.id) {
      continue;
    }
    const holder = getSheetById(stale.id) ?? stale;
    if (holder.currentHp <= 0 || holder.deathSaves?.dead || !holder.conditions.some((name) => isConditionNamed(name, EXALTED))) {
      continue;
    }
    if (encounter && (sideOf(encounter, "sheet", holder.id, holder) !== sideOf(encounter, "sheet", sheet.id) || !withinFeet(encounter.id, holder.id, sheet.id, RANGE_FT))) {
      continue;
    }
    return { saves: ["wis"], death: true, note: `Exalted Champion (${holder.name}, within ${RANGE_FT} feet): advantage` };
  }
  return null;
}
