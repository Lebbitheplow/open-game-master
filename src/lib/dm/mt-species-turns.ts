// What the lineage traits do as a turn ends (src/lib/dm/turn-end.ts endTurns
// calls this for the characters whose turns are ending):
//
//   - Feline Agility (tabaxi): "refreshed by not moving". A tabaxi who ends
//     a turn having moved 0 feet has the use back. Read from the board's
//     own count of the turn's movement, which the next turn's start resets.
//   - Celestial Revelation, Inner Radiance (aasimar): "each creature within
//     10 feet takes radiant damage equal to your proficiency bonus at the
//     end of each of your turns".
import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { computeSheetDerived } from "@/lib/srd";
import { textKey } from "@/lib/language/text-logic";
import { FELINE_AGILITY_COUNTER, RADIANCE } from "@/lib/srd/authored-conditions-mt-species";

const RADIANCE_FEET = 10;

export function speciesTurnEnd(campaign: Campaign, encounterId: string, combatantIds: string[]): string[] {
  const lines: string[] = [];
  const encounter = getActiveEncounter(campaign.id);
  const map = getBattleMapForEncounter(encounterId);
  for (const id of combatantIds) {
    const sheet = getSheetById(id);
    if (!sheet) {
      continue;
    }
    const agility = sheet.resources?.[FELINE_AGILITY_COUNTER];
    const token = map ? getTokenByRef(map.id, id) : null;
    if (agility && agility.used > 0 && token && token.movedThisRound === 0) {
      const updated = patchSheet(sheet.id, { resources: { ...sheet.resources, [FELINE_AGILITY_COUNTER]: { max: agility.max, used: 0 } } });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
      lines.push(`${sheet.name} moved 0 feet this turn: Feline Agility is ready again.`);
    }
    if (encounter && encounter.id === encounterId && sheet.currentHp > 0 && sheet.conditions.some((entry) => textKey(entry) === textKey(RADIANCE))) {
      const amount = computeSheetDerived(sheet).proficiencyBonus;
      for (const enemy of listEnemies(encounterId)) {
        const apart = tilesBetween(encounterId, sheet.id, enemy.id);
        if (enemy.status === "alive" && apart !== null && apart * 5 <= RADIANCE_FEET) {
          lines.push(hurtEnemy(campaign, encounter, enemy, amount, "radiant", `${sheet.name}'s Inner Radiance`));
        }
      }
    }
  }
  return lines;
}
