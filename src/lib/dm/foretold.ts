// Portent's numbers (src/lib/dm/foretold-logic.ts) against the database.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { foretoldLeft, foretoldWithout, PORTENT } from "@/lib/dm/foretold-logic";
import { publishPersisted } from "@/lib/events";

// Pays for a foretold number, audited under the parked turn so its revert gives
// the number back. False when the sheet no longer holds it.
export function spendForetold(campaign: Campaign, sheetId: string, value: number, turnId: string, about: string): boolean {
  const sheet = getSheetById(sheetId);
  if (!sheet || !foretoldLeft(sheet).includes(value)) {
    return false;
  }
  const state = sheet.resources[PORTENT];
  const patch = {
    resources: { ...sheet.resources, [PORTENT]: { max: state.max, used: state.used + 1 } },
    foretold: foretoldWithout(sheet.foretold ?? [], value),
  };
  const spent = patchSheet(sheet.id, patch);
  if (spent) {
    const entry = insertSheetAudit({
      campaignId: campaign.id,
      characterId: sheet.id,
      turnId,
      actor: "player",
      kind: "use_resource",
      delta: { resource: "Portent", spent: 1 },
      reason: `Foretold ${value} used on ${about}`,
      seq: allocateSeq(campaign.id),
      before: sheet,
      patch,
    });
    publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
    publishPersisted(campaign.id, "sheet_updated", { sheet: spent });
  }
  return Boolean(spent);
}
