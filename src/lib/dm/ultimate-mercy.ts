// Hand of Ultimate Mercy (Way of Mercy, 17th level): "Once per long rest,
// spend 5 ki to return a creature dead no more than 24 hours to life with
// 4d10 + Wisdom hit points." Its counter's own heal path refused the dead it
// exists for ("is DEAD; ... cannot help"), so the use is resolved here,
// inside feature-spends.ts's spend order: every refusal below spends neither
// the use nor the ki.
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { returnToLife } from "@/lib/dm/heal-spell";
import { describeMinutes, minutesSinceDeath } from "@/lib/dm/revival";
import { diceFor, rollOwnDice } from "@/lib/dm/character-roll";
import type { ToolError } from "@/lib/dm/tool-errors";
import { computeSheetDerived } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const KI_COST = 5;
const WITHIN_MINUTES = 24 * 60;

export function ultimateMercy(campaign: Campaign, turnId: string, monk: CharacterSheet, targetId: string | undefined): ToolError | { result: Record<string, unknown> } {
  const target = targetId ? getSheetById(targetId) : null;
  if (!target || target.campaignId !== monk.campaignId) {
    return { error: "Hand of Ultimate Mercy returns a dead creature to life: pass its targetCharacterId. Nothing was spent.", retry: true };
  }
  if (!target.deathSaves?.dead) {
    return { error: `${target.name} is not dead; Hand of Ultimate Mercy returns the dead to life. Nothing was spent.`, refused: "rules" };
  }
  const since = minutesSinceDeath(campaign.id, target.id);
  if (since !== null && since > WITHIN_MINUTES) {
    return { error: `${target.name} died ${describeMinutes(since)} ago, longer than the 24 hours Hand of Ultimate Mercy reaches back. Nothing was spent.`, refused: "rules" };
  }
  const ki = monk.resources.ki;
  if (!ki || ki.max - ki.used < KI_COST) {
    return { error: `Hand of Ultimate Mercy costs ${KI_COST} ki, and ${monk.name} has ${ki ? ki.max - ki.used : 0} left. Nothing was spent.`, refused: "rules" };
  }
  const wis = computeSheetDerived(monk).abilityMods.wis;
  const expression = `4d10${wis >= 0 ? "+" : ""}${wis}`;
  // The monk's own dice (character-roll.ts rollOwnDice): on physical dice
  // their player rolls them, before any ki is spent.
  const rolled = rollOwnDice(campaign, monk, diceFor(`${monk.name}: Hand of Ultimate Mercy`, monk, target), expression).total;
  // The ki first, so the use's own patch (feature-spends.ts spend) reads it.
  const resources = { ...monk.resources, ki: { max: ki.max, used: ki.used + KI_COST } };
  const kiPatch = { resources };
  patchSheet(monk.id, kiPatch);
  insertSheetAudit({
    campaignId: campaign.id,
    characterId: monk.id,
    turnId,
    kind: "use_resource",
    delta: { resource: "Ki", spent: KI_COST },
    reason: `Hand of Ultimate Mercy on ${target.name}`,
    seq: allocateSeq(campaign.id),
    before: monk,
    patch: kiPatch,
  });
  const back = returnToLife(campaign, turnId, target, { hp: Math.max(1, rolled), ordeal: false, name: "Hand of Ultimate Mercy", reason: `Hand of Ultimate Mercy by ${monk.name}` });
  return {
    result: {
      revived: target.name,
      hp: `${back.hp} (${expression}: ${rolled})`,
      ki: `${KI_COST} spent`,
      note: `${target.name} returns to life with ${back.hp} hit points; narrate it.`,
    },
  };
}
