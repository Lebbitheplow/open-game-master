// What a horror class's feature does as its holder rolls initiative (WAVE2
// D5), called by src/lib/dm/feature-hooks.ts applyInitiativeRefills beside
// the counters a new fight gives back:
//   Bitter Endurance (survivor 7): "1/long rest, gain temp HP equal to twice
//     your level when combat starts". Combat starts with the roll, so the
//     server gives them then and spends the use; with as many temporary hit
//     points already on them the use is kept (temporary hit points never
//     stack, the larger stands).
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { horrorHolds } from "@/lib/srd/genre-a-horror-holds";

const BITTER = "horror_bitter_endurance";

export function horrorAtInitiative(campaign: Campaign, sheetId: string): string[] {
  const sheet = getSheetById(sheetId);
  const state = sheet?.resources?.[BITTER];
  if (!sheet || sheet.deathSaves?.dead || !state || state.used >= state.max || !horrorHolds(sheet, "Bitter Endurance")) {
    return [];
  }
  const amount = sheet.level * 2;
  if (amount <= sheet.tempHp) {
    return [];
  }
  const updated = patchSheet(sheet.id, { tempHp: amount, resources: { ...sheet.resources, [BITTER]: { max: state.max, used: state.used + 1 } } });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return [`Bitter Endurance: ${sheet.name} gains ${amount} temporary hit points (twice their level) as the fight starts.`];
}
