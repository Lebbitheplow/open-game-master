// The end of a Rage Beyond Death (mt-fb-rage-death-logic.ts has the rule): the
// rage that kept a zealot up at 0 hit points is over. With three death saves
// failed, the death that was held off is theirs; otherwise they fall as anyone
// at 0 hit points does, unconscious and prone, still dying or stable. Called by
// rage-bound.ts as the mark ends with the rage, so every way a rage ends (a
// turn with no attack, the minute, a rest, the barbarian's word) comes here.
import { getCampaignById } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { killOutright, rollStableTimer } from "@/lib/dm/death";
import { downConditions } from "@/lib/dm/vitals-logic";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";

export function fallAsRageEnds(campaignId: string, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  const campaign = getCampaignById(campaignId);
  if (!sheet || !campaign || sheet.currentHp > 0 || sheet.deathSaves?.dead) {
    return null;
  }
  if ((sheet.deathSaves?.failures ?? 0) >= 3) {
    killOutright(campaign, null, sheet, "failed death saving throws, held off until their rage ended");
    return `${sheet.name}'s rage ends at 0 hit points with three death saves failed, and they die.`;
  }
  if (sheet.deathSaves?.stable) {
    const wait = rollStableTimer(campaign, sheet);
    patchSheetAudited(campaignId, sheet.id, { conditions: wait.conditions, conditionMeta: wait.conditionMeta }, { kind: "condition_clock", reason: "their rage ended at 0 hit points", delta: { added: ["unconscious"] } });
    return `${sheet.name}'s rage ends at 0 hit points: stable, they fall unconscious.`;
  }
  const down = downConditions({ conditions: sheet.conditions, conditionMeta: sheet.conditionMeta as ConditionMetaMap });
  patchSheetAudited(campaignId, sheet.id, down, { kind: "condition_clock", reason: "their rage ended at 0 hit points", delta: { added: ["unconscious", "prone"] } });
  return `${sheet.name}'s rage ends at 0 hit points, and they fall unconscious, dying.`;
}
