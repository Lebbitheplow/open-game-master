// The Combat Inspiration die spent on a hit's damage, against the database
// (the rule is src/lib/dm/ar-wbf-bard-dice-logic.ts).

import { getSheetById } from "@/lib/db/sheets";
import { combatDie } from "@/lib/dm/ar-wbf-bard-dice-logic";
import { spendRollCarriers } from "@/lib/dm/forced-save";

// The die chosen on the card the hit waited on, spent only now the hit
// stands: a Parry or a Shield that turns the roll as it lands leaves the die
// with its holder, as it leaves a Death cleric their Channel Divinity
// (attack-swing.ts hitSwing). Answers the die ("d8"), or null when the holder
// no longer has one. Audited through spendRollCarriers, so an undo of the
// turn gives the die back.
export function spendCombatDie(campaignId: string, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  const held = sheet ? combatDie(sheet) : null;
  if (!held) {
    return null;
  }
  spendRollCarriers(campaignId, sheetId, held.condition, "player");
  return held.die;
}
