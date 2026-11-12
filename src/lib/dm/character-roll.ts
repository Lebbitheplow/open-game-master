// The one door a player character's d20 is thrown through inside a tool
// call: a check, a save, an attack, initiative, a death save. Whatever tool
// rolls it, the roll is the player's in the same ways:
//
// - a seat on physical dice (or one holding its rolls) gets a card and rolls
//   it, as request_roll's roll does (src/lib/dice/held-rolls.ts);
// - a wizard holding a foretold number may use Portent on it before it is
//   thrown (foretold-logic.ts);
// - once the server throws it, a roll that falls short waits on the player's
//   Lucky, Bardic Inspiration, Dark One's Own Luck, Chronal Shift and the rest
//   of the after-the-roll card (after-roll-logic.ts), and on an ally's.
//
// Waiting is done by holding the call (src/lib/dm/held-call.ts): the call is
// rolled back, the card parked, and the call run again when the roll lands,
// this helper then handing back the roll as it landed. Outside a held call (a
// save the clock rolls, a damage hook in a player's own request) nothing can
// wait and the roll is thrown, a held die settled as forced-save.ts does.
//
// A new site that throws a character's d20 calls rollCharacterD20 rather than
// rollExpression: scripts/test-enforce-sweep-dice-sites.mjs walks the source
// for sites that throw one and fails on a site it has not classified.

import { beforeRollWords, ownBeforeRollChoices } from "@/lib/dm/before-roll-logic";
import { entryDice, rollExpression, type Advantage, type RollResult } from "@/lib/dice";
import { heroRollTag, type RollTag } from "@/lib/dice-script-logic";
import { dicePreferencesOf, type DecidedRoll, type DmTurn } from "@/lib/db/dm-turns";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertRoll, type RollKind, type RollVisibility, type StoredRoll } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { parkReasonFor } from "@/lib/dice/held-rolls";
import { afterAttackOptions, afterRollOptions, type AfterRollOption } from "@/lib/dm/after-roll-logic";
import { afterRollRow } from "@/lib/dm/after-roll-table";
import { allyChoicesFor, reactionFreeFor, rollsCanWait } from "@/lib/dm/after-roll";
import { afterRollDeadline } from "@/lib/dm/after-roll-timer";
import { heldDieWaits, settleHeldDie } from "@/lib/dm/forced-save";
import { foretoldLeft } from "@/lib/dm/foretold-logic";
import { heldCallTurn, inHeldCall, parkHeldCall, takeDecided, tapeMark } from "@/lib/dm/held-call";
import { noteShift, shiftArmedFor, takeSaveHelp, takeShift } from "@/lib/dm/chronal-shift";
import { takeFate } from "@/lib/dm/fate-turn";
import { tranceFloored } from "@/lib/dm/ar-ws-trance-floor";
import { publishWithSeq } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export type CharacterRoll = {
  // As the roll is stored: a death save is a saving throw.
  // Damage is theirs to roll on physical dice too ("You roll your attacks
  // and their damage"), and never waits on a choice. Nor do the other dice
  // of their own a call rolls, stored as "custom": the healing of a feature,
  // a potion or a spell (issue 902).
  kind: Extract<RollKind, "skill_check" | "ability_check" | "saving_throw" | "attack" | "initiative" | "damage" | "custom">;
  // What the dice are tagged as (a test table's script aims by it); the
  // stored kind's own tag when left out.
  tag?: RollTag;
  // The whole roll, as a player would roll it at the table.
  expression: string;
  // What the card and the roll's record say it is.
  detail: string;
  dc?: number | null;
  // An attack roll: what it must reach, for the after-the-roll card.
  attack?: { ac: number; critRange?: number; melee?: boolean };
  advantage?: Advantage;
  reason?: string;
  visibility?: RollVisibility;
  // The site's own throw, when it does more than roll the expression.
  throwIt?: () => RollResult;
  // What the site's throw does to the dice (a floor under the d20), done to
  // faces entered at the table too.
  adjust?: (outcome: RollResult) => RollResult;
  // The site adds a held Bardic Inspiration die where it carries a roll that
  // cannot wait (forced-save.ts settleHeldDie).
  settleHeldDie?: boolean;
  // The site's own way of settling a held die on a roll that cannot wait,
  // in place of settleHeldDie's (a death save, which a natural 1 fails).
  settle?: (thrown: RollResult) => RollResult;
  // False for a roll that never waits on its player's choice.
  mayWait?: boolean;
};

// Why this player's rolls park, at this table, now.
function seatParks(campaign: Campaign, sheet: CharacterSheet): "real_dice" | "held" | null {
  if (!sheet.userId || sheet.isCompanion) {
    return null;
  }
  const preferences = dicePreferencesOf(campaign.id, sheet.userId);
  const reason = parkReasonFor(preferences.dicePolicy, preferences.member);
  return reason === "real_dice" || reason === "held" ? reason : null;
}

function choicesFor(campaign: Campaign, sheet: CharacterSheet, roll: CharacterRoll, outcome: RollResult): AfterRollOption[] {
  const reactionFree = reactionFreeFor(campaign.id, sheet.id);
  if (roll.attack) {
    const critRange = roll.attack.critRange ?? 20;
    // A hit's choices (Touch of Death, Combat Inspiration, Violent
    // Attraction) ride a pc_attack's record; an attack thrown by another
    // tool asks only about a miss.
    const onMiss = (option: AfterRollOption) => afterRollRow(option.id).when !== "hit";
    const own = afterAttackOptions(sheet, { outcome, ac: roll.attack.ac, critRange, reactionFree, melee: roll.attack.melee === true }).filter(onMiss);
    return [...own, ...allyChoicesFor(campaign.id, sheet, { kind: "attack", outcome, ac: roll.attack.ac, critRange }).filter(onMiss)];
  }
  const dc = typeof roll.dc === "number" ? roll.dc : null;
  return [
    ...afterRollOptions(sheet, { kind: roll.kind, outcome, dc, reactionFree, check: { skill: roll.kind === "skill_check" ? roll.detail : null } }),
    ...allyChoicesFor(campaign.id, sheet, { kind: roll.kind, outcome, dc }),
  ];
}

// Whether this character's initiative would wait on the after-the-roll card,
// whatever its d20 shows: with no DC to reach, a luck point or a held die is
// offered on any face. Read before the opening throws it, so a fight opens
// with their card out rather than holding the whole call.
export function initiativeWaits(campaign: Campaign, stale: CharacterSheet): boolean {
  const sheet = getSheetById(stale.id) ?? stale;
  if (!inHeldCall() || !rollsCanWait(sheet)) {
    return false;
  }
  const lowest = rollExpression("1d20", () => 1);
  return choicesFor(campaign, sheet, { kind: "initiative", expression: "1d20", detail: "initiative" }, lowest).length > 0;
}

// A flat amount (a heal of three times a monk's level) has no die in it:
// there is nothing for a player to roll. An expression that cannot be read
// is left to the throw to refuse.
function hasDice(expression: string): boolean {
  try {
    return entryDice(expression).length > 0;
  } catch {
    return true;
  }
}

export function rollCharacterD20(campaign: Campaign, stale: CharacterSheet, roll: CharacterRoll): RollResult {
  return rollAtDoor(campaign, stale, roll).outcome;
}

// How a roll the player made came in (pending-roll-land.ts RollLanding), for
// the site that records it; null for dice thrown here.
export type DoorLanding = NonNullable<DecidedRoll["landing"]>;

// The door, for a site that keeps its own record of the dice (a short rest's
// hit dice, hit-dice.ts): the roll, and how it landed when the player made it.
export function rollCharacterDice(campaign: Campaign, sheet: CharacterSheet, roll: CharacterRoll): { outcome: RollResult; landing: DoorLanding | null } {
  return rollAtDoor(campaign, sheet, roll);
}

function rollAtDoor(campaign: Campaign, stale: CharacterSheet, asked: CharacterRoll): { outcome: RollResult; landing: DoorLanding | null } {
  const thrownHere = (outcome: RollResult) => ({ outcome, landing: null });
  const sheet = getSheetById(stale.id) ?? stale;
  // Trance of Order: a d20 of 9 or lower counts as 10 (ar-ws-trance-floor.ts).
  // Never on damage or the other dice of their own (a heal), as
  // tranceResolved leaves those kinds alone.
  const roll = asked.kind === "damage" || asked.kind === "custom" ? asked : { ...asked, expression: tranceFloored(sheet, asked.expression) };
  const decided = takeDecided(sheet.id, roll.kind);
  if (decided) {
    return { outcome: decided.raw && roll.adjust ? roll.adjust(decided.outcome) : decided.outcome, landing: decided.landing ?? null };
  }
  const tag = roll.tag ?? heroRollTag(roll.kind, sheet.name);
  const held = inHeldCall();
  const visible = (roll.visibility ?? "public") === "public";
  const card = {
    sheet: { id: sheet.id, userId: sheet.userId, name: sheet.name },
    kind: roll.kind,
    detail: roll.detail,
    expression: roll.expression,
    advantage: roll.advantage ?? "none",
    // An attack's card names the number it must reach, as a check's does.
    dc: roll.attack ? roll.attack.ac : typeof roll.dc === "number" ? roll.dc : null,
    reason: roll.reason ?? roll.detail,
    visibility: roll.visibility ?? "public",
  };
  const mayWait = held && visible && roll.mayWait !== false && hasDice(roll.expression);
  const parks = mayWait ? seatParks(campaign, sheet) : null;
  if (parks) {
    parkHeldCall({ ...card, parkedFor: parks, note: `Waiting on ${sheet.name} to roll ${roll.detail}: their player rolls it.` });
  }
  // A watcher already answered this roll at the stop before it: their
  // answer is armed and taken as the roll lands, so the card does not ask
  // again (foresight.ts, chronal-shift.ts).
  const waits = mayWait && roll.kind !== "damage" && roll.kind !== "custom" && rollsCanWait(sheet) && !shiftArmedFor(campaign.id, tag);
  // Portent replaces the d20 before it is thrown: a wizard holding a number
  // decides here, as on a requested check (invoke-roll.ts). So does a druid's
  // Weal or a sorcerer's Restore Balance (before-roll-logic.ts, issue #908).
  const beforeOwn = waits && !roll.attack ? ownBeforeRollChoices(sheet, { kind: roll.kind, expression: roll.expression, reactionFree: reactionFreeFor(campaign.id, sheet.id) }) : [];
  if (waits && !roll.attack && roll.kind !== "initiative" && (foretoldLeft(sheet).length > 0 || beforeOwn.length > 0)) {
    parkHeldCall({ ...card, parkedFor: "foretold", note: `Waiting on ${sheet.name} to roll or to use ${beforeRollWords(sheet, beforeOwn)}.` });
  }
  const mark = tapeMark();
  const throwOnce = () => (roll.throwIt ? roll.throwIt() : rollExpression(roll.expression, undefined, { ...(tag ? { purpose: tag } : {}) }));
  const thrown = throwOnce();
  if (waits) {
    const options = choicesFor(campaign, sheet, roll, thrown);
    if (options.length) {
      parkHeldCall(
        {
          ...card,
          parkedFor: "after_roll",
          thrown: { outcome: thrown, options, choosing: false, landing: { status: "fallback", physical: false, source: "digital" }, deadline: afterRollDeadline(campaign.id, sheet.userId) },
          note: `Waiting on ${sheet.name} to decide what to do with their roll.`,
        },
        mark,
      );
    }
    return thrownHere(thrown);
  }
  const settle = (outcome: RollResult) =>
    roll.settle ? roll.settle(outcome) : roll.settleHeldDie && typeof roll.dc === "number" && heldDieWaits(sheet, roll.dc) ? settleHeldDie(campaign.id, sheet.id, outcome, roll.dc) : outcome;
  return thrownHere(answerArmed(campaign.id, sheet.name, tag, roll.dc, settle(thrown), () => settle(throwOnce())));
}

// The other dice of a character's own that a call rolls: the healing or the
// temporary hit points of their feature, potion, spell or kit (issue 902).
// Thrown through the door above, so a seat on physical dice rolls them;
// stored under the one who rolls them, whoever they are for; sent to the
// table; and added to the turn's cards, so the chronicle shows the roll. A
// site that throws such dice calls this rather than rollCard (roll-card.ts),
// which throws them where it stands.
//
// Dice the player rolled at the table are recorded as theirs, "(physical)" as
// a roll card's are (pending-roll-land.ts), and sent as physical: sent as
// digital, the stage threw a die on screen that the player had already rolled.
//
// A flat amount has nothing to roll, and gets a card only where the site
// always gave it one (`flatCard`). `turn` is the turn the card joins when the
// site holds one; left out, it is the held call's own.
export function rollOwnDice(
  campaign: Campaign,
  roller: CharacterSheet,
  detail: string,
  expression: string,
  options: OwnDiceOptions = {},
): RollResult {
  return rollOwnDiceStored(campaign, roller, detail, expression, options).outcome;
}

type OwnDiceOptions = { mayWait?: boolean; flatCard?: boolean; turn?: DmTurn | null };

// rollOwnDice, with the roll's own record for a site that keeps a note of it
// (a healing spell's dice, which Empowered Healing may roll again:
// ar-ws-empowered-healing.ts noteHealingRoll). The record is null for a flat
// amount that gets no card.
export function rollOwnDiceStored(
  campaign: Campaign,
  roller: CharacterSheet,
  detail: string,
  expression: string,
  options: OwnDiceOptions = {},
): { outcome: RollResult; roll: StoredRoll | null } {
  const said = detail.slice(0, 200);
  const { outcome, landing } = rollAtDoor(campaign, roller, { kind: "custom", expression, detail: said, ...(options.mayWait === false ? { mayWait: false } : {}) });
  if (!options.flatCard && !outcome.terms.some((term) => term.kind === "dice")) {
    return { outcome, roll: null };
  }
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: roller.id,
    requestedBy: "dm",
    kind: "custom",
    detail: landing?.physical ? `${said} (physical)` : said,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: landing?.source ?? "digital" });
  (options.turn ?? heldCallTurn())?.rollIds.push(roll.id);
  return { outcome, roll };
}

// What a card for such dice says when they are for somebody else.
export function diceFor(what: string, roller: Pick<CharacterSheet, "id">, target: Pick<CharacterSheet, "id" | "name">): string {
  return target.id === roller.id ? what : `${what} on ${target.name}`;
}

const ROLLED_AGAIN: Partial<Record<RollTag["kind"], string>> = { save: "save", check: "check", death_save: "death save" };

// What a watcher armed at the stop before this roll (foresight.ts): a Chronal
// Shift rolls a save or check with a DC again and the new roll stands, and
// Flash of Genius or Favored by the Gods adds to one that fails. A roll
// nobody armed anything for comes back as it was.
function answerArmed(campaignId: string, who: string, tag: RollTag | undefined, dc: number | null | undefined, landed: RollResult, again: () => RollResult): RollResult {
  const words = tag ? ROLLED_AGAIN[tag.kind] : undefined;
  if (!tag || !words || typeof dc !== "number") {
    return landed;
  }
  let outcome = landed;
  const shiftedBy = takeShift(campaignId, tag, outcome.total >= dc);
  if (shiftedBy) {
    outcome = again();
    noteShift(campaignId, `${shiftedBy} used Chronal Shift: ${who} rolled the ${words} again, ${outcome.total} against DC ${dc}, and the new roll stands.`);
  }
  // Convergent Future or Bend Luck set on it at the stop (fate-turn.ts).
  outcome = takeFate(campaignId, tag, who, outcome, dc)?.outcome ?? outcome;
  return takeSaveHelp(campaignId, tag, who, outcome, dc)?.outcome ?? outcome;
}
