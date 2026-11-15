// SRD 5.1, Ring of Regeneration: "While wearing this ring, you regain 1d6
// hit points every 10 minutes, provided that you have at least 1 hit
// point." The clock's half of it (src/lib/db/clock.ts advanceClock): every
// ten-minute mark the clock moves past heals a worn, attuned ring's wearer
// a d6, rolled where the table sees it. Nothing read the ring before: its
// wearer healed nothing on the road or through a short rest.

import { getCampaignById } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { regainHitPoints } from "@/lib/dm/regain";
import { publishWithSeq } from "@/lib/events";
import { wearsWorkingItem } from "@/lib/srd/magic-items";

export const REGENERATION_RING = "Ring of Regeneration";

// A day of marks at most: past it the wearer is long since whole.
const MOST_MARKS = 144;

// The ten-minute marks after `from` and at or before `to`.
export function tenMinuteMarks(from: number, to: number): number {
  return to > from ? Math.min(MOST_MARKS, Math.floor(to / 10) - Math.floor(from / 10)) : 0;
}

export function regenerationClock(campaignId: string, from: number, to: number) {
  const marks = tenMinuteMarks(from, to);
  const campaign = marks ? getCampaignById(campaignId) : null;
  if (!campaign) {
    return;
  }
  for (const stale of listSheets(campaignId)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (sheet.deathSaves?.dead || sheet.currentHp < 1 || sheet.currentHp >= effectiveMaxHp(sheet) || !wearsWorkingItem(sheet.equipment, sheet, REGENERATION_RING)) {
      continue;
    }
    const rolled = rollExpression(`${marks}d6`);
    const roll = insertRoll({
      campaignId,
      characterId: sheet.id,
      requestedBy: "dm",
      kind: "custom",
      detail: `${REGENERATION_RING}: ${marks * 10} minutes`,
      result: rolled,
    });
    publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", { roll, source: "digital" });
    regainHitPoints(campaign, null, sheet, rolled.total, REGENERATION_RING);
  }
}
