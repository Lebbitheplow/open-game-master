// The watch stop's before-the-roll answers besides Portent's number (the
// maintainer's ruling on issue #908): Cosmic Omen and Restore Balance on
// another creature's roll, chosen at the stop and set on the d20 as it is
// thrown (src/lib/db/dice-scripts.ts armBeforeRoll), paid only if a d20 took
// them. And the stop out of a fight: with the Watch toggle on, a sheet holding
// a before-the-roll feature is asked before an ally's check or save, which is
// otherwise thrown at once (invoke-roll.ts).
//
// The rules of the two features are src/lib/dm/before-roll-logic.ts; the
// stop itself is foresight.ts, which asks this file.

import type { Campaign } from "@/lib/db/campaigns";
import { armBeforeRoll, disarmBeforeRoll } from "@/lib/db/dice-scripts";
import { watchChoiceOf, type WatchChoice, type WatchPower, type WatchRoll, type WatchStop } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import type { RollTag } from "@/lib/dice-script-logic";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import {
  BALANCE_RANGE_FEET,
  balanceLeft,
  BEFORE_ROLL_COUNTER,
  BEFORE_ROLL_FEATURES,
  beforeRollLine,
  isBeforeRollPower,
  OMEN_RANGE_FEET,
  OMEN_WORDS,
  omenLeft,
  type BeforeRollPower,
} from "@/lib/dm/before-roll-logic";
import { canReactNow, inShiftReach } from "@/lib/dm/chronal-shift";
import type { About, Seen } from "@/lib/dm/foresight-saves";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { getFoe } from "@/lib/dm/sheet-foe";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The rolls the omen answers: an attack roll, a saving throw (a death save
// among them) or an ability check.
const OMEN_KINDS: readonly RollTag["kind"][] = ["attack", "save", "check", "death_save"];

// Cosmic Omen or Restore Balance for this watcher on what `about` is about to
// roll, or null. Weal answers a friend's roll and Woe a foe's: the other way
// round only hurts the druid's own side. Restore Balance answers any roll in
// reach, since whether it has an edge, and which, is the watcher's to read
// from the fiction; it is paid only if it had one. The watcher's own roll is
// answered at the hold before it (invoke-roll.ts, character-roll.ts), so it
// is not offered here. `friend`: whether a creature is on the watcher's side
// (always so out of a fight).
export function beforeRollAt(
  campaignId: string,
  watcher: CharacterSheet,
  about: About,
  sheets: readonly CharacterSheet[],
  friend: (ref: string) => boolean,
): { power: BeforeRollPower; rolls: Seen[] } | null {
  if (!canReactNow(campaignId, watcher)) {
    return null;
  }
  const reaches = (roll: Seen, feet: number) => {
    const creature = sheets.find((sheet) => sheet.id === roll.ref) ?? getFoe(roll.ref);
    return roll.ref !== watcher.id && Boolean(creature) && inShiftReach(campaignId, watcher, creature!, feet);
  };
  const omen = omenLeft(watcher);
  if (omen) {
    const rolls = about.rolls.filter((roll) => OMEN_KINDS.includes(roll.tag.kind) && friend(roll.ref) === (omen === "weal") && reaches(roll, OMEN_RANGE_FEET));
    if (rolls.length) {
      return { power: "cosmic_omen", rolls };
    }
  }
  if (balanceLeft(watcher)) {
    const rolls = about.rolls.filter((roll) => reaches(roll, BALANCE_RANGE_FEET));
    if (rolls.length) {
      return { power: "restore_balance", rolls };
    }
  }
  return null;
}

// The watcher for an ally's check or save out of a fight, and the choices
// they are offered, or null: Portent's number first, then Cosmic Omen's Weal
// or Restore Balance. Only a sheet whose player turned the Watch toggle on
// (`watching`) is asked, and never the roller about their own roll.
export function tableWatcherFor(
  campaignId: string,
  about: About,
  sheets: readonly CharacterSheet[],
  watching: (sheet: CharacterSheet) => boolean,
): { watcher: CharacterSheet; power: WatchPower; choices: WatchChoice[] } | null {
  const choicesOf = (rolls: Seen[]): WatchChoice[] => [{ name: rolls[0].name, rolls: rolls.map((roll): WatchRoll => ({ tag: roll.tag, reverse: "success" })) }];
  for (const sheet of sheets) {
    if (sheet.id === about.rollerId || !watching(sheet)) {
      continue;
    }
    if (foretoldLeft(sheet).length > 0) {
      return { watcher: sheet, power: "portent", choices: choicesOf(about.rolls) };
    }
    const before = beforeRollAt(campaignId, sheet, about, sheets, () => true);
    if (before) {
      return { watcher: sheet, power: before.power, choices: choicesOf(before.rolls) };
    }
  }
  return null;
}

// What a stop arms on its first call's d20: Portent's chosen number, or the
// before-the-roll power the watcher said to use. Null when the stop arms
// nothing on the dice (a pass, an after-the-roll watch row, a stop answered
// where it stands).
export type BeforeChoice = { watcherId: string; face: number | null; power?: BeforeRollPower; tags: readonly RollTag[]; line: string };
export function beforeChoiceOf(stop: WatchStop, watcherId: string): BeforeChoice | null {
  const picked = watchChoiceOf(stop);
  const tags = picked ? picked.rolls.map((roll) => roll.tag) : [stop.tag, ...(stop.also ?? [])];
  if ((stop.power ?? "portent") === "portent") {
    return stop.face !== null ? { watcherId, face: stop.face, tags, line: stop.line } : null;
  }
  return isBeforeRollPower(stop.power) && stop.shift ? { watcherId, face: null, power: stop.power, tags, line: stop.line } : null;
}

// Runs one held call with Cosmic Omen's d6 or Restore Balance's one d20 set on
// its first fitting d20, and pays for it (a use and the reaction) only if a
// d20 took it. The line is for the model's answer. Spent some other way since
// it was chosen (the use, the reaction, the omen gone): the roll is made as
// it stands, and nothing is paid.
export async function runWithBeforeRoll<T>(campaign: Campaign, choice: BeforeChoice & { power: BeforeRollPower }, run: () => Promise<T>): Promise<{ result: T; portent: string | null }> {
  const holder = getSheetById(choice.watcherId);
  const omen = holder ? omenLeft(holder) : null;
  const able = holder && canReactNow(campaign.id, holder) && (choice.power === "cosmic_omen" ? omen !== null : balanceLeft(holder));
  if (!holder || !able) {
    return { result: await run(), portent: null };
  }
  armBeforeRoll(campaign.id, { power: choice.power, omen, tags: choice.tags });
  let took: { before: number; after: number; who: string } | null = null;
  let result: T;
  try {
    result = await run();
  } finally {
    took = disarmBeforeRoll(campaign.id);
  }
  const feature = choice.power === "cosmic_omen" && omen ? `${BEFORE_ROLL_FEATURES[choice.power]} (${OMEN_WORDS[omen]})` : BEFORE_ROLL_FEATURES[choice.power];
  if (!took || !spendFeatureUse(campaign, holder.id, BEFORE_ROLL_COUNTER[choice.power], feature, "player")) {
    return { result, portent: null };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    markReactionUsed(encounter, holder.id);
  }
  return { result, portent: beforeRollLine(choice.power, holder.name, took.who, took.before, took.after, omen) };
}
