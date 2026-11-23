// SRD 5.1, Ring of Regeneration: "While wearing this ring, you regain 1d6
// hit points every 10 minutes, provided that you have at least 1 hit
// point." The clock's half of it (src/lib/db/clock.ts advanceClock): every
// ten-minute mark the clock moves past heals a worn, attuned ring's wearer
// a d6, rolled where the table sees it, until they are whole. Nothing read the ring before: its
// wearer healed nothing on the road or through a short rest.
//
// SRD 5.1, Ioun Stone, Regeneration: "You regain 15 hit points at the end of
// each hour this pearly white spindle orbits your head, provided that you
// have at least 1 hit point." The same clock, by the hour, and no die: a
// stone orbiting is "an object that is being worn", and it is attuned.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { recordRoll } from "@/lib/dm/roll-record";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { diceExpression, rollExpression } from "@/lib/dice";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { regainHitPoints, regainRoom } from "@/lib/dm/regain";
import { wearsWorkingItem } from "@/lib/srd/magic-items";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const REGENERATION_RING = "Ring of Regeneration";
export const REGENERATION_STONE = "Ioun Stone of Regeneration";

// A day of marks at most: past it the wearer is long since whole.
const MOST_MARKS = 144;
const MOST_HOURS = 24;
const STONE_HIT_POINTS = 15;

// The ten-minute marks after `from` and at or before `to`.
export function tenMinuteMarks(from: number, to: number): number {
  return to > from ? Math.min(MOST_MARKS, Math.floor(to / 10) - Math.floor(from / 10)) : 0;
}

// The hours that end after `from` and at or before `to`.
export function hourEnds(from: number, to: number): number {
  return to > from ? Math.min(MOST_HOURS, Math.floor(to / 60) - Math.floor(from / 60)) : 0;
}

// Whether this wearer heals from `item` now: alive, up from 0, short of the
// maximum, and wearing it attuned.
function heals(sheet: CharacterSheet, item: string): boolean {
  return !sheet.deathSaves?.dead && sheet.currentHp >= 1 && sheet.currentHp < effectiveMaxHp(sheet) && wearsWorkingItem(sheet.equipment, sheet, item);
}

function ringHeals(campaign: Campaign, sheet: CharacterSheet, marks: number) {
  if (!marks || !heals(sheet, REGENERATION_RING)) {
    return;
  }
  // No more dice than the hit points the wearer is short of: each d6 heals at
  // least 1, so a die past that count changes nothing, and a wearer who can
  // regain none (mummy rot, Chill Touch) rolls none. Rolled for every mark of
  // a day, the dice healed a wearer 5 short as they would a wearer 500 short,
  // and a cursed wearer's were thrown for nothing.
  const dice = Math.min(marks, regainRoom(campaign.id, sheet));
  if (dice < 1) {
    return;
  }
  // Still more, for a wearer far down over most of a day, than one term of a
  // roll holds: the count is written as a roll may hold it.
  const rolled = rollExpression(diceExpression(dice, 6));
  // On the turn of the call that moved the clock; the clock moved outside
  // one holds no turn.
  recordRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "custom",
    detail: `${REGENERATION_RING}: ${dice * 10} minutes`,
    result: rolled,
    // Thrown here, on the server's dice.
    landing: null,
  });
  regainHitPoints(campaign, null, sheet, rolled.total, REGENERATION_RING);
}

export function regenerationClock(campaignId: string, from: number, to: number) {
  const marks = tenMinuteMarks(from, to);
  const hours = hourEnds(from, to);
  const campaign = marks || hours ? getCampaignById(campaignId) : null;
  if (!campaign) {
    return;
  }
  for (const stale of listSheets(campaignId)) {
    const sheet = getSheetById(stale.id) ?? stale;
    ringHeals(campaign, sheet, marks);
    // Read again: the ring may have healed them first.
    const after = getSheetById(stale.id) ?? sheet;
    if (hours && heals(after, REGENERATION_STONE)) {
      regainHitPoints(campaign, null, after, hours * STONE_HIT_POINTS, REGENERATION_STONE);
    }
  }
}
