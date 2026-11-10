// The after-the-roll pause (src/lib/dm/after-roll-logic.ts) against the
// database: whose rolls may wait, what a parked roll offers now, and spending
// what the player chose. The roll lands through src/lib/dm/pending-roll-land.ts.

import { listConnectionGrants } from "@/lib/agents/grants";
import type { Campaign } from "@/lib/db/campaigns";
import type { PendingRoll } from "@/lib/db/dm-turns";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { rollExpression, type RollResult } from "@/lib/dice";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
import { withinFeet } from "@/lib/dm/authored-saves";
import { computeSheetDerived } from "@/lib/srd";
import { spendRollCarriers } from "@/lib/dm/forced-save";
import { attackTurnOver, recordTargetAc, type AttackRecord } from "@/lib/dm/attack-record";
import {
  afterAttackOptions,
  afterRollOptions,
  CHANNEL_DIVINITY,
  CHRONAL_SHIFT,
  DARK_ONES_OWN_LUCK,
  extraD20Expression,
  FAVORED_BY_THE_GODS,
  FLASH_OF_GENIUS,
  flashOfGeniusOption,
  GUIDED_STRIKE_BONUS,
  WAR_GODS_BLESSING_BONUS,
  warGodsBlessingOption,
  heldBardicDie,
  heldOwnLuckDie,
  holdsMoteDie,
  luckRodeThrow,
  MASTER_DUELIST,
  ownLuckDie,
  sidesOf,
  touchOfDeathDamage,
  withAdvantageReroll,
  withBonusDie,
  withExtraD20,
  withFlatBonus,
  withRerolledD20,
  shiftCanHelp,
  type AfterRollId,
  type AfterRollOption,
  type ThrownRoll,
} from "@/lib/dm/after-roll-logic";
import { allyShifters, canReactNow, inShiftReach, payChronalShift, playerAtTable, SHIFT_RANGE_FEET } from "@/lib/dm/chronal-shift";
import { LUCK_SPEND } from "@/lib/dm/roll-riders";
import { luckPointsLeft } from "@/lib/srd/class-resources";
import { rollsWrathDice } from "@/lib/dm/destructive-wrath-logic";
import { getActiveEncounter } from "@/lib/db/encounters";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { inPlay } from "@/lib/dm/roster";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Whether this character's rolls can wait on their player. A companion rolls
// for the party, and a die whose mote bursts at the throw is left as it was. A
// seat an agent plays has no card to press, so it rolls as it always did and
// its held die still rides its next roll.
export function rollsCanWait(sheet: CharacterSheet | null | undefined): sheet is CharacterSheet {
  if (!sheet?.userId || sheet.isCompanion || holdsMoteDie(sheet)) {
    return false;
  }
  const now = Date.now();
  return !listConnectionGrants(sheet.userId).some(
    (grant) => grant.scopes.includes("play") && !grant.revokedAt && new Date(grant.expiresAt).getTime() > now && (!grant.campaignId || grant.campaignId === sheet.campaignId),
  );
}

// Whether the character's reaction is still theirs this round: Chronal Shift
// costs it. Outside a fight there is no round, and it is.
export function reactionFreeFor(campaignId: string, sheetId: string): boolean {
  return !getActiveEncounter(campaignId)?.reactionsUsed.includes(sheetId);
}

// What this parked roll offers, given its dice as they now stand. A roll
// behind the GM's screen never waits: its card would show the table the dice.
// A parked attack's to-hit roll is judged against the target's AC as it now
// stands; its damage roll never waits. `done`: the thrown roll's record of the
// wizards who shifted it or let it stand, and whether the roller kept it
// (then only a wizard's Chronal Shift is left to offer).
export function optionsForPending(
  pending: PendingRoll,
  outcome: RollResult,
  spent: readonly AfterRollId[] = [],
  done: Pick<ThrownRoll, "shiftedBy" | "declined" | "kept"> = {},
): AfterRollOption[] {
  if (pending.visibility !== "public" || !pending.characterId || (pending.attack && pending.kind !== "attack")) {
    return [];
  }
  const sheet = getSheetById(pending.characterId);
  if (!sheet || !rollsCanWait(sheet)) {
    return [];
  }
  const reactionFree = reactionFreeFor(pending.campaignId, sheet.id);
  if (pending.attack) {
    const record = pending.attack as AttackRecord;
    // Its turn is over: the roll will not land, so nothing is spent on it.
    if (attackTurnOver(pending.campaignId, record, pending.characterId)) {
      return [];
    }
    // A luck point bought with the attack (pc_attack luck: true) was its one.
    // Read from the record, not the dice: Elven Accuracy throws a third d20 too.
    const bought: AfterRollId[] = record.luck ? ["lucky"] : [];
    const ac = recordTargetAc(pending.campaignId, record);
    const critRange = record.critRange ?? 20;
    const own = done.kept ? [] : afterAttackOptions(sheet, { outcome, ac, critRange, spent: [...spent, ...bought], reactionFree, melee: record.melee === true && record.ranged !== true, wrathDice: rollsWrathDice(record.damageExpression, record.damageType, record.riders) });
    const allies = allyChoicesFor(pending.campaignId, sheet, { kind: "attack", outcome, ac, critRange }, done);
    return [...own, ...allies];
  }
  const upFront: AfterRollId[] = luckRodeThrow(pending.expression, pending.advantage) ? ["lucky"] : [];
  const own = done.kept ? [] : afterRollOptions(sheet, { kind: pending.kind, outcome, dc: pending.dc, spent: [...spent, ...upFront], reactionFree });
  const allies = allyChoicesFor(pending.campaignId, sheet, { kind: pending.kind, outcome, dc: pending.dc, spent }, done);
  return [...own, ...allies];
}

// Who could answer a roll from their own screen, for a player whose rolls wait
// (invoke-roll.ts, pc-attack-parked.ts throwForChoice): the roll parks on them
// as it would on the roller's own options. Chronal Shift, War God's Blessing
// and Flash of Genius, which the artificer may also spend on their own roll.
// A helper on the bench (one character fielded per player) answers nobody.
export function allyChoicesFor(
  campaignId: string,
  sheet: CharacterSheet,
  roll: { kind: string; outcome: RollResult; dc: number | null; spent?: readonly AfterRollId[] } | { kind: "attack"; outcome: RollResult; ac: number; critRange: number },
  done: Pick<ThrownRoll, "shiftedBy" | "declined" | "kept"> = {},
): AfterRollOption[] {
  const shifts = shiftCanHelp(roll) ? allyShifters(campaignId, sheet, roll.kind, done) : [];
  const skip = new Set([sheet.id, ...(done.shiftedBy ?? []), ...(done.declined ?? [])]);
  const others = listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((other) => !skip.has(other.id) && rollsCanWait(other) && playerAtTable(campaignId, other) && inPlay(campaignId, other) && canReactNow(campaignId, other));
  if ("ac" in roll) {
    // "When a creature within 30 feet of you makes an attack roll": the text
    // asks for 30 feet and, unlike Chronal Shift and Flash of Genius ("a
    // creature you can see"), not for sight, so a cleric beside an unseen
    // ally may still bless the roll.
    const fight = getActiveEncounter(campaignId);
    const near = others.filter((cleric) => !fight || withinFeet(fight.id, cleric.id, sheet.id, SHIFT_RANGE_FEET));
    return [...shifts, ...near.flatMap((cleric) => warGodsBlessingOption(cleric, roll) ?? [])];
  }
  const flash = (artificer: CharacterSheet, ally: boolean) => flashOfGeniusOption(artificer, computeSheetDerived(artificer).abilityMods.int, roll, ally);
  const own = !done.kept && !roll.spent?.includes("flash_of_genius") && canReactNow(campaignId, sheet) ? flash(sheet, false) : null;
  const help = others.filter((artificer) => inShiftReach(campaignId, artificer, sheet)).flatMap((artificer) => flash(artificer, true) ?? []);
  return [...shifts, ...(own ? [own] : []), ...help];
}

// The roll's d20s thrown again, one fresh die for each it threw, obeying what
// they obeyed (a halfling's reroll of a 1); the new roll stands.
function rerollD20s(outcome: RollResult): { outcome: RollResult; choosing: boolean } | null {
  const lead = outcome.terms[0];
  const count = lead && lead.kind === "dice" ? lead.dice.length : 0;
  const fresh = Array.from({ length: count }).flatMap(() => rollExpression(extraD20Expression(outcome.expression)).terms.flatMap((term) => (term.kind === "dice" ? term.dice.slice(0, 1) : [])));
  const rerolled = withRerolledD20(outcome, fresh);
  return rerolled ? { outcome: rerolled, choosing: false } : null;
}

// The player's choice, paid for and on the dice. Null when the choice is no
// longer on offer; nothing is spent then.
export function spendAfterRoll(
  campaign: Campaign,
  sheet: CharacterSheet,
  id: AfterRollId,
  outcome: RollResult,
  advantage = "none",
  // Another character pays, answering this roll from their own screen.
  payer?: CharacterSheet,
  // Advantage on this attack throws a third d20 (attack-record.ts).
  elvenAccuracy = false,
): { outcome: RollResult; choosing: boolean; touchOfDeath?: number; destructiveWrath?: boolean } | null {
  const die = (sides: number) => ({ sides, value: rollExpression(`1d${sides}`).total, kept: true });
  if (id === "war_gods_blessing" || id === "flash_of_genius") {
    const giver = payer ?? sheet;
    if (!canReactNow(campaign.id, giver)) {
      return null;
    }
    const paid = id === "war_gods_blessing"
      ? spendFeatureUse(campaign, giver.id, CHANNEL_DIVINITY, "Channel Divinity: War God's Blessing", "player")
      : spendFeatureUse(campaign, giver.id, FLASH_OF_GENIUS, "Flash of Genius", "player");
    if (!paid) {
      return null;
    }
    const encounter = getActiveEncounter(campaign.id);
    if (encounter) {
      markReactionUsed(encounter, giver.id);
    }
    return { outcome: withFlatBonus(outcome, id === "war_gods_blessing" ? WAR_GODS_BLESSING_BONUS : computeSheetDerived(giver).abilityMods.int), choosing: false };
  }
  if (id === "guided_strike") {
    return spendFeatureUse(campaign, sheet.id, CHANNEL_DIVINITY, "Channel Divinity: Guided Strike", "player") ? { outcome: withFlatBonus(outcome, GUIDED_STRIKE_BONUS), choosing: false } : null;
  }
  if (id === "touch_of_death") {
    // Paid by the hit itself (attack-swing.ts hitSwing): a Parry or a Shield
    // can still turn the roll as it lands, and a use spent here was lost then.
    const state = sheet.resources?.[CHANNEL_DIVINITY];
    return state && state.max - state.used > 0 ? { outcome, choosing: false, touchOfDeath: touchOfDeathDamage(sheet) } : null;
  }
  if (id === "destructive_wrath") {
    // Paid by the hit itself, as Touch of Death is (attack-swing.ts hitSwing).
    const state = sheet.resources?.[CHANNEL_DIVINITY];
    return state && state.max - state.used > 0 ? { outcome, choosing: false, destructiveWrath: true } : null;
  }
  if (id === "favored_by_the_gods") {
    if (!spendFeatureUse(campaign, sheet.id, FAVORED_BY_THE_GODS, "Favored by the Gods", "player")) {
      return null;
    }
    return { outcome: withBonusDie(withBonusDie(outcome, die(4)), die(4)), choosing: false };
  }
  if (id === "master_duelist") {
    if (!spendFeatureUse(campaign, sheet.id, MASTER_DUELIST, "Master Duelist", "player")) {
      return null;
    }
    // Obeying what the first throw obeyed (a halfling's reroll of a 1), and
    // Elven Accuracy's third die on the advantage it now has.
    const fresh = Array.from({ length: advantage === "disadvantage" ? 1 : elvenAccuracy ? 3 : 2 }).flatMap(() => rollExpression(extraD20Expression(outcome.expression)).terms.flatMap((term) => (term.kind === "dice" ? term.dice.slice(0, 1) : [])));
    const again = withAdvantageReroll(outcome, fresh);
    return again ? { outcome: again, choosing: false } : null;
  }
  if (id === "lucky") {
    if (luckPointsLeft(sheet.resources) < 1) {
      return null;
    }
    // Audited, so an undo of the turn gives the point back.
    spendRollCarriers(campaign.id, sheet.id, LUCK_SPEND, "player");
    const extra = rollExpression(extraD20Expression(outcome.expression)).terms[0];
    const pooled = extra.kind === "dice" ? withExtraD20(outcome, extra.dice[0]) : null;
    return pooled ? { outcome: pooled, choosing: true } : null;
  }
  if (id === "chronal_shift" && payer && payer.id !== sheet.id) {
    if (!payChronalShift(campaign.id, payer.id)) {
      return null;
    }
    return rerollD20s(outcome);
  }
  if (id === "chronal_shift") {
    const encounter = getActiveEncounter(campaign.id);
    if (encounter?.reactionsUsed.includes(sheet.id) || !spendFeatureUse(campaign, sheet.id, CHRONAL_SHIFT, "Chronal Shift", "player")) {
      return null;
    }
    if (encounter) {
      markReactionUsed(encounter, sheet.id);
    }
    return rerollD20s(outcome);
  }
  if (id === "bardic") {
    const held = heldBardicDie(sheet);
    if (!held) {
      return null;
    }
    spendRollCarriers(campaign.id, sheet.id, held.condition, "player");
    return { outcome: withBonusDie(outcome, die(sidesOf(held.die))), choosing: false };
  }
  const held = heldOwnLuckDie(sheet);
  const size = ownLuckDie(sheet);
  if (!size) {
    return null;
  }
  if (held) {
    spendRollCarriers(campaign.id, sheet.id, held.condition, "player");
  } else if (!spendFeatureUse(campaign, sheet.id, DARK_ONES_OWN_LUCK, "Dark One's Own Luck", "player")) {
    return null;
  }
  return { outcome: withBonusDie(outcome, die(sidesOf(size))), choosing: false };
}
