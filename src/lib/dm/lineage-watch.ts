// Saving Face, Lucky Footwork, Inspired Ingenuity and Bountiful Luck at the
// watch stop before a roll a call throws (src/lib/dm/foresight.ts). They were
// offered only on the card a player's own roll waits on (after-roll.ts), so a
// save the server throws inside a call that no card waits on (an ally's on an
// agent seat or a companion, a hobgoblin's own rider save) passed them by.
// Now the player watching says "if it fails" at the stop, and the roll site
// asks takeLineage once the roll is known, as takeShift does for Chronal
// Shift: paid only where the card would have offered it, so the result is the
// one the after-the-roll choice gives.
//
//   Saving Face, Lucky Footwork, Inspired Ingenuity: the holder's own roll
//   (lineage-after-roll-logic.ts lineageOffers says when each carries it).
//   Bountiful Luck: an ally's roll in sight within 30 feet whose d20 shows a 1
//   (bountiful-luck.ts).

import { getCampaignById } from "@/lib/db/campaigns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { RollTag } from "@/lib/dice-script-logic";
import type { RollResult } from "@/lib/dice";
import { afterRollRow } from "@/lib/dm/after-roll-table";
import { rolledOne, spendBountifulLuck } from "@/lib/dm/bountiful-luck";
import { armedFor, canReactNow, inShiftReach } from "@/lib/dm/chronal-shift";
import type { Seen } from "@/lib/dm/foresight-saves";
import { alliesInSight, lineageChoicesFor, spendLineageAfterRoll } from "@/lib/dm/lineage-after-roll";
import { footworkGrounded, INSPIRED_INGENUITY, SAVING_FACE, savingFaceBonus } from "@/lib/dm/lineage-after-roll-logic";
import { findNamed } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { holdsFeature } from "@/lib/srd/feature-names";

export const LINEAGE_WATCH = ["saving_face", "lucky_footwork", "inspired_ingenuity", "bountiful_luck"] as const;
export type LineageWatch = (typeof LINEAGE_WATCH)[number];
export const isLineageWatch = (power: string | undefined): power is LineageWatch => (LINEAGE_WATCH as readonly string[]).includes(power ?? "");

const BOUNTIFUL_FEET = 30;

// The rolls each answers: Saving Face a miss or a failed check or save,
// Lucky Footwork a save (a Dexterity one, read at the roll), Inspired
// Ingenuity a check, Bountiful Luck an ally's attack, check or save.
const KINDS: Record<LineageWatch, readonly RollTag["kind"][]> = {
  saving_face: ["attack", "save", "check"],
  lucky_footwork: ["save"],
  inspired_ingenuity: ["check"],
  bountiful_luck: ["attack", "save", "check"],
};

const usesLeft = (sheet: Pick<CharacterSheet, "resources">, id: string) => {
  const state = sheet.resources?.[id];
  return state ? Math.max(0, state.max - state.used) : 0;
};

// Whether the holder could still pay for it now: the use, the reaction where
// it costs one, an ally in sight for Saving Face's bonus.
export function canLineageWatchNow(campaignId: string, sheet: CharacterSheet, power: LineageWatch): boolean {
  if (sheet.currentHp <= 0 || sheet.deathSaves?.dead) {
    return false;
  }
  if (power === "saving_face") {
    return holdsFeature(sheet, "Saving Face") && usesLeft(sheet, SAVING_FACE) > 0 && savingFaceBonus(alliesInSight(campaignId, sheet)) > 0;
  }
  if (power === "lucky_footwork") {
    return holdsFeature(sheet, "Lucky Footwork") && canReactNow(campaignId, sheet) && !footworkGrounded(sheet);
  }
  if (power === "inspired_ingenuity") {
    return holdsFeature(sheet, "Inspired Ingenuity") && usesLeft(sheet, INSPIRED_INGENUITY) > 0 && canReactNow(campaignId, sheet);
  }
  return holdsFeat(sheet, "Bountiful Luck") && canReactNow(campaignId, sheet);
}

// The rolls of `rolls` this holder's power answers: their own for the
// lineages' traits, an ally's in reach for Bountiful Luck. `ally`: whether a
// creature fights on the holder's side.
export function lineageWatchRolls(campaignId: string, sheet: CharacterSheet, power: LineageWatch, rolls: readonly Seen[], ally: (ref: string) => boolean, sheets: readonly CharacterSheet[]): Seen[] {
  return rolls.filter((roll) => {
    if (roll.tag.roller !== "hero" || !KINDS[power].includes(roll.tag.kind)) {
      return false;
    }
    if (power !== "bountiful_luck") {
      return roll.ref === sheet.id;
    }
    const roller = sheets.find((entry) => entry.id === roll.ref);
    return Boolean(roller) && roller!.id !== sheet.id && ally(roller!.id) && inShiftReach(campaignId, sheet, roller!, BOUNTIFUL_FEET);
  });
}

const KIND_WORDS: Partial<Record<RollTag["kind"], { stored: string; words: string }>> = {
  attack: { stored: "attack", words: "attack roll" },
  save: { stored: "saving_throw", words: "save" },
  check: { stored: "ability_check", words: "check" },
};

// The roll site's question for one armed at the stop: does it answer this
// roll, now that its total is known? `target`: the DC of a check or save, or
// the AC an attack must reach. `detail`: the save's record (Lucky Footwork
// answers a Dexterity save alone). Paid here when it does; null leaves the
// roll as it was.
export function takeLineage(
  campaignId: string,
  tag: RollTag | undefined,
  who: string,
  outcome: RollResult,
  target: { dc: number } | { ac: number; critRange: number },
  detail?: string | null,
): { outcome: RollResult; line: string } | null {
  const armed = armedFor(campaignId, tag);
  const kind = tag ? KIND_WORDS[tag.kind] : undefined;
  if (!armed || !isLineageWatch(armed.power) || armed.reverse !== "failure" || !kind) {
    return null;
  }
  const campaign = getCampaignById(campaignId);
  const holder = getSheetById(armed.holderId);
  if (!campaign || !holder) {
    return null;
  }
  const roll = "ac" in target
    ? { kind: "attack" as const, outcome, ac: target.ac, critRange: target.critRange }
    : { kind: kind.stored, outcome, dc: target.dc, detail: detail ?? null };
  let spent: { outcome: RollResult } | null = null;
  if (armed.power === "bountiful_luck") {
    const roller = findNamed(listSheets(campaignId), who, (sheet) => [sheet.name]);
    spent = roller && rolledOne(roll) ? spendBountifulLuck(campaign, getSheetById(roller.id) ?? roller, outcome, holder) : null;
  } else if (lineageChoicesFor(campaignId, holder, roll).some((option) => option.id === armed.power)) {
    spent = spendLineageAfterRoll(campaign, holder, armed.power, outcome);
  }
  if (!spent) {
    return null;
  }
  const feature = afterRollRow(armed.power).feature;
  const against = "ac" in target ? `AC ${target.ac}` : `DC ${target.dc}`;
  const verdict = spent.outcome.total >= ("ac" in target ? target.ac : target.dc) ? "it succeeds" : "it still falls short";
  armed.use(`${holder.name} used ${feature}: ${who}'s ${kind.words} went from ${outcome.total} to ${spent.outcome.total} against ${against}, and ${verdict}.`);
  return { outcome: spent.outcome, line: `${feature}: ${outcome.total} became ${spent.outcome.total}` };
}
