// Hide in Plain Sight (SRD 5.1, ranger 10): "Once you move or take an action
// or a reaction, you must camouflage yourself again to gain this benefit."
//
// The camouflage is the "camouflaged" condition (srd-feature-spends.ts). It
// ends at the doors a character moves and acts through, which are the two
// that already end an invisibility kept by stillness: endShadowInvisibility
// (one-with-shadows.ts: the walk, take_action, a reaction) and
// endInvisibilityOnCast (attack-marks.ts: an attack, a spell). Both call
// endCamouflage, so a new door for moving or acting joins those two and gets
// this with them.

import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

const CAMOUFLAGED = "camouflaged";

// Returns a line for the table, or null when they held no camouflage.
export function endCamouflage(campaignId: string, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  const held = sheet?.conditions.find((entry) => isConditionNamed(entry, CAMOUFLAGED));
  if (!sheet || !held) {
    return null;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, [held]);
  patchSheetAudited(campaignId, sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, {
    kind: "clear_condition",
    reason: "moved or acted: the camouflage is lost",
    delta: { condition: held },
  });
  return `${sheet.name} moves or acts, and their camouflage is lost: Hide in Plain Sight must be set up again.`;
}
