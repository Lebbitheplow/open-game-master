// The lineages' after-the-roll choices against the database (their rules are
// src/lib/dm/lineage-after-roll-logic.ts): the allies a hobgoblin sees for
// Saving Face, what a parked roll offers, and spending what the player chose.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { RollResult } from "@/lib/dice";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { withFlatBonus, type AfterRollId, type AfterRollOption } from "@/lib/dm/after-roll-logic";
import { inShiftReach } from "@/lib/dm/chronal-shift";
import { lineageOffers, SAVING_FACE, SAVING_FACE_FEET, savingFaceBonus } from "@/lib/dm/lineage-after-roll-logic";
import { inPlay } from "@/lib/dm/roster";
import { holdsFeature } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The roller's allies they can see within 30 feet: the other characters in
// play, up and not dead. Off a board the fiction decides, and every one of
// them counts (chronal-shift.ts inShiftReach).
export function alliesInSight(campaignId: string, sheet: CharacterSheet, feet = SAVING_FACE_FEET): number {
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((other) => other.id !== sheet.id && !other.deathSaves?.dead && other.currentHp > 0 && inPlay(campaignId, other) && inShiftReach(campaignId, sheet, other, feet)).length;
}

type Roll =
  | { kind: string; outcome: RollResult; dc: number | null; spent?: readonly AfterRollId[]; detail?: string | null }
  | { kind: "attack"; outcome: RollResult; ac: number; critRange: number };

// The roller's own lineage choices on this roll (after-roll.ts allyChoicesFor
// asks, beside the helpers'). `kept`: the roller already let it stand.
export function lineageChoicesFor(campaignId: string, sheet: CharacterSheet, roll: Roll, kept = false): AfterRollOption[] {
  if (kept || !holdsFeature(sheet, "Saving Face")) {
    return [];
  }
  const outcome = roll.outcome;
  return lineageOffers(sheet, {
    kind: roll.kind,
    total: outcome.total,
    natural: outcome.natural,
    target: "ac" in roll ? { ac: roll.ac, critRange: roll.critRange } : { dc: roll.dc },
    taken: new Set("spent" in roll ? (roll.spent ?? []) : []),
    allies: alliesInSight(campaignId, sheet),
  });
}

// The player's choice, paid for and on the dice. Null when it is no longer
// on offer; nothing is spent then.
export function spendLineageAfterRoll(campaign: Campaign, stale: CharacterSheet, id: AfterRollId, outcome: RollResult): { outcome: RollResult; choosing: boolean } | null {
  const sheet = getSheetById(stale.id) ?? stale;
  if (id === "saving_face") {
    const bonus = savingFaceBonus(alliesInSight(campaign.id, sheet));
    if (bonus < 1 || !spendFeatureUse(campaign, sheet.id, SAVING_FACE, "Saving Face", "player")) {
      return null;
    }
    return { outcome: withFlatBonus(outcome, bonus), choosing: false };
  }
  return null;
}
