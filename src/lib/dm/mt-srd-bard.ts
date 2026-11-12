// The bard's SRD 5.1 clauses that had no door of their own.
//
//   Countercharm (bard 6): "As an action, you can start a performance that
//     lasts until the end of your next turn. During that time, you and any
//     friendly creatures within 30 feet of you have advantage on saving
//     throws against being frightened or charmed. A creature must be able to
//     hear you to gain this benefit. The performance ends early if you are
//     incapacitated or silenced or if you voluntarily end it (no action
//     required)."
//     The advantage is the "countercharm" condition's (srd/trait-rules.ts).
//     use_resource Countercharm lays it on the bard and on each friend who
//     hears within 30 feet, every instance naming the bard as its source and
//     ending with the bard's next turn (turn-end.ts untilTurnEnd). It ends
//     early through endPerformance: by the bard's own word (variant 'end'),
//     the moment the bard falls incapacitated (the incapacity watch), and as
//     any turn ends with the bard silenced, or a listener deafened or past 30
//     feet (endBrokenPerformances, called by turn-end.ts endTurns).
//   Song of Rest (bard 2): "you or any friendly creatures who can hear your
//     performance". hearsSong is what the short rest asks before it adds the
//     die (rest-tools.ts).

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveBoard, getActiveEncounter } from "@/lib/db/encounters";
import { onIncapacity } from "@/lib/db/incapacity-watch";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { patchSheetAudited } from "@/lib/dm/audited-patch";
import { priceTheAction, publishSheet } from "@/lib/dm/combat-features";
import { instancesOf, isIncapacitated, removeConditionInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { fieldedSheets } from "@/lib/dm/roster";
import { toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { silenceAround } from "@/lib/dm/zone-rules";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";

export const COUNTERCHARM = "countercharm";
const REACH_TILES = 6;
const END_WORDS = new Set(["end", "stop", "end performance", "end the performance"]);

const deafened = (sheet: Pick<CharacterSheet, "conditions">) => sheet.conditions.some((entry) => isConditionNamed(entry, "deafened"));

// Whether a creature at a short rest hears the bard's song.
export function hearsSong(sheet: Pick<CharacterSheet, "conditions">): boolean {
  return !deafened(sheet);
}

// Whether a friend is in the performance's reach: within 30 feet on a board,
// and off one the party is together.
function inReach(campaignId: string, bardId: string, listenerId: string): boolean {
  const board = getActiveBoard(campaignId);
  const apart = board && bardId !== listenerId ? tilesBetween(board.id, bardId, listenerId) : null;
  return apart === null || apart <= REACH_TILES;
}

const performedBy = (bardId: string) => (entry: ConditionMeta) => entry.source === bardId;

// Takes one bard's performance off a sheet. Returns whether it was there.
function stopHearing(campaignId: string, sheet: CharacterSheet, bardId: string, reason: string): boolean {
  const held = sheet.conditions.find((entry) => isConditionNamed(entry, COUNTERCHARM));
  if (!held || !instancesOf((sheet.conditionMeta as ConditionMetaMap)[held]).some(performedBy(bardId))) {
    return false;
  }
  const cleared = removeConditionInstances(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, held, performedBy(bardId));
  patchSheetAudited(campaignId, sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta }, {
    kind: "clear_condition",
    reason,
    delta: { condition: held },
  });
  return true;
}

// The bard's performance ends for everyone under it. Returns their names.
export function endPerformance(campaignId: string, bardId: string, reason: string): string[] {
  const ended: string[] = [];
  for (const stale of listSheets(campaignId)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (stopHearing(campaignId, sheet, bardId, reason)) {
      ended.push(sheet.name);
    }
  }
  return ended;
}

// As a turn ends: a performance whose bard is silenced, down or incapacitated
// ends, and a listener who can no longer hear it, or stands past its reach,
// loses it. Returns the table lines.
export function endBrokenPerformances(campaignId: string): string[] {
  const lines: string[] = [];
  for (const stale of listSheets(campaignId)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const held = sheet.conditions.find((entry) => isConditionNamed(entry, COUNTERCHARM));
    if (!held) {
      continue;
    }
    for (const instance of instancesOf((sheet.conditionMeta as ConditionMetaMap)[held])) {
      const bard = instance.source ? getSheetById(instance.source) : null;
      if (!bard) {
        continue;
      }
      const broken = bard.currentHp <= 0 || Boolean(bard.deathSaves?.dead) || isIncapacitated(bard.conditions) || silenceAround(campaignId, bard.id) !== null;
      if (broken) {
        const names = endPerformance(campaignId, bard.id, "the performance ended early");
        if (names.length) {
          lines.push(`${bard.name}'s Countercharm ends early: they are silenced or cannot act.`);
        }
      } else if (sheet.id !== bard.id && (deafened(sheet) || !inReach(campaignId, bard.id, sheet.id))) {
        if (stopHearing(campaignId, getSheetById(sheet.id) ?? sheet, bard.id, "out of the performance's hearing")) {
          lines.push(`${sheet.name} no longer hears ${bard.name}'s Countercharm.`);
        }
      }
    }
  }
  return lines;
}

export function countercharm(campaign: Campaign, stale: CharacterSheet, variant: string | undefined): ToolResult {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!holdsFeature(sheet, "countercharm")) {
    return { error: `${sheet.name} does not have Countercharm (a bard's 6th level feature).`, refused: "rules" };
  }
  if (variant && END_WORDS.has(textKey(variant))) {
    const names = endPerformance(campaign.id, sheet.id, "ended their performance");
    return names.length
      ? { ok: true, feature: "Countercharm", cost: "no action", applied: `${sheet.name} ends the performance: ${names.join(", ")} no longer have its advantage.` }
      : { error: `${sheet.name} is not performing a Countercharm. Nothing was spent.`, refused: "rules" };
  }
  if (silenceAround(campaign.id, sheet.id) !== null) {
    return { error: `${sheet.name} stands inside a Silence, where no sound is made, and a Countercharm must be heard. Nothing was spent.`, refused: "rules" };
  }
  const price = priceTheAction(sheet, getActiveEncounter(campaign.id), "Countercharm");
  if ("error" in price) {
    return toolError(price);
  }
  // A performance already running is started again, not doubled.
  endPerformance(campaign.id, sheet.id, "a new performance began");
  const heard: string[] = [];
  const unheard: string[] = [];
  for (const entry of fieldedSheets(campaign, listSheets(campaign.id))) {
    const listener = getSheetById(entry.id) ?? entry;
    if (listener.deathSaves?.dead || !inReach(campaign.id, sheet.id, listener.id)) {
      continue;
    }
    if (listener.id !== sheet.id && deafened(listener)) {
      unheard.push(listener.name);
      continue;
    }
    const held = listener.conditions.find((name) => isConditionNamed(name, COUNTERCHARM)) ?? COUNTERCHARM;
    const meta = listener.conditionMeta as ConditionMetaMap;
    const others = listener.conditions.includes(held) ? instancesOf(meta[held]) : [];
    const [first, ...rest] = [...others, untilTurnEnd(sheet.id, { source: sheet.id })];
    patchSheetAudited(campaign.id, listener.id, {
      conditions: listener.conditions.includes(held) ? listener.conditions : [...listener.conditions, held],
      conditionMeta: { ...meta, [held]: rest.length ? { ...first, others: rest } : first },
    }, { kind: "set_condition", reason: "Countercharm", delta: { condition: held } });
    publishSheet(campaign, listener.id);
    heard.push(listener.name);
  }
  price.commit();
  return {
    ok: true,
    feature: "Countercharm",
    cost: "their action",
    applied: `${sheet.name} performs until the end of their next turn: ${heard.join(", ")} have advantage on saves against being frightened or charmed while within 30 feet and able to hear.${unheard.length ? ` ${unheard.join(", ")} cannot hear it.` : ""} It ends early if ${sheet.name} is incapacitated or silenced, or by their word (variant 'end').`,
  };
}

// The moment a bard falls incapacitated, their performance is over.
onIncapacity((campaignId, sheetId) => {
  if (getCampaignById(campaignId)) {
    endPerformance(campaignId, sheetId, "the performer was incapacitated");
  }
});
