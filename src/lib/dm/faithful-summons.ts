// Faithful Summons (Circle of the Shepherd 14): "When you are reduced to 0
// hit points or incapacitated against your will, you gain the effects of
// conjure animals cast with a 9th-level slot: four beasts of your choice,
// each challenge rating 2 or lower, appear within 20 feet, protect you and
// attack your foes for an hour without concentration, or until you dismiss
// them. Once per long rest."
//
// The moment comes mid-blow or mid-spell, with nobody at a card to choose
// from, so the beasts are four wolves (a CR 1/4 beast the SRD prints, pack
// hunters that knock foes prone): a sensible pack for a druid who has just
// fallen. They arrive through the summoning machinery a Conjure Animals
// casting uses (src/lib/dm/summon-store.ts): allies on the board and in the
// order, Mighty Summoner's hit points with them, gone at 0 hit points or
// after the hour. The druid dismisses them as any summon is dismissed.
//
// Before this it was a resource the GM spent by hand, at a moment the engine
// never stopped at. The incapacity watch (src/lib/db/incapacity-watch.ts)
// calls this whichever route laid the condition, once the write's own
// handler has finished.

import { randomUUID } from "node:crypto";
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { onIncapacity } from "@/lib/db/incapacity-watch";
import { getSheetById } from "@/lib/db/sheets";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { publishPersisted } from "@/lib/events";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { isIncapacitated, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { tableNote } from "@/lib/dm/between-io";
import { spawnSummons } from "@/lib/dm/summon-store";
import { summonRecord } from "@/lib/dm/summon-rules";
import { authoredSummonHitPoints } from "@/lib/srd/authored-effects-more";
import { findSummonForm } from "@/lib/srd/summon-forms";
import { holdsFeature } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const FAITHFUL_SUMMONS = "sub_faithful_summons";
const BEAST = "Wolf";
const COUNT = 4;
// An hour, in rounds.
const HOUR = 600;

// Whether the druid answers this fall: holding the feature with its use,
// alive, and laid low by something that is not their own doing (a condition
// whose source is the druid themself is by their will).
export function answersWithSummons(sheet: CharacterSheet | null | undefined): boolean {
  if (!sheet || sheet.deathSaves?.dead || !holdsFeature(sheet, "faithful summons")) {
    return false;
  }
  const uses = sheet.resources?.[FAITHFUL_SUMMONS];
  if (!uses || uses.used >= uses.max) {
    return false;
  }
  const meta = (sheet.conditionMeta ?? {}) as ConditionMetaMap;
  return sheet.conditions.some((entry) => isIncapacitated([entry]) && meta[entry]?.source !== sheet.id);
}

// The four beasts, the use spent; null when the druid does not answer.
export function faithfulSummons(campaign: Campaign, sheetId: string): string | null {
  const sheet = getSheetById(sheetId);
  const form = findSummonForm(BEAST);
  if (!sheet || !form || !answersWithSummons(sheet)) {
    return null;
  }
  const uses = sheet.resources[FAITHFUL_SUMMONS];
  patchSheetAudited(campaign.id, sheet.id, { resources: { ...sheet.resources, [FAITHFUL_SUMMONS]: { max: uses.max, used: uses.used + 1 } } }, { kind: "use_resource", reason: "Faithful Summons, as the druid falls", delta: { resource: "Faithful Summons", spent: 1 } });
  const record = summonRecord(form, { spell: "Faithful Summons", casterId: sheet.id, casterName: sheet.name, concentration: false, castId: randomUUID().slice(0, 8) });
  // Mighty Summoner (Circle of the Shepherd 6): beasts a spell conjures
  // arrive with 2 more hit points per Hit Die; these come as Conjure Animals.
  const mighty = authoredSummonHitPoints(getSheetById(sheet.id) ?? sheet, form);
  const created = spawnSummons(campaign, getSheetById(sheet.id) ?? sheet, {
    form,
    count: COUNT,
    record,
    rounds: HOUR,
    slotLevel: 9,
    initiative: "group",
    overrides: mighty ? { hp: form.hp + mighty.hp } : {},
  });
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  const line = `Faithful Summons: as ${sheet.name} falls, ${created.length} wolves (${created.map((entry) => entry.name).join(", ")}) answer the call. They guard ${sheet.name} and attack their foes for an hour, no concentration needed.`;
  tableNote(campaign, line, "cue-battle");
  return line;
}

onIncapacity((campaignId, sheetId) => {
  const campaign = getCampaignById(campaignId);
  if (campaign) {
    faithfulSummons(campaign, sheetId);
  }
});
