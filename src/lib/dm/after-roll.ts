// The after-the-roll pause (src/lib/dm/after-roll-logic.ts) against the
// database: whose rolls may wait, what a parked roll offers now, and spending
// what the player chose. The roll lands through src/lib/dm/pending-roll-land.ts.

import { listConnectionGrants } from "@/lib/agents/grants";
import type { Campaign } from "@/lib/db/campaigns";
import type { PendingRoll } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { rollExpression, type RollResult } from "@/lib/dice";
import { spendFeatureUse } from "@/lib/dm/attack-onhit";
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
  GUIDED_STRIKE_BONUS,
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
  type AfterRollId,
  type AfterRollOption,
} from "@/lib/dm/after-roll-logic";
import { LUCK_SPEND } from "@/lib/dm/roll-riders";
import { luckPointsLeft } from "@/lib/srd/class-resources";
import { getActiveEncounter } from "@/lib/db/encounters";
import { markReactionUsed } from "@/lib/dm/turn-budget";
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
// stands; its damage roll never waits.
export function optionsForPending(pending: PendingRoll, outcome: RollResult, spent: readonly AfterRollId[] = []): AfterRollOption[] {
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
    return afterAttackOptions(sheet, { outcome, ac: recordTargetAc(pending.campaignId, record), critRange: record.critRange ?? 20, spent: [...spent, ...bought], reactionFree, melee: record.melee === true && record.ranged !== true });
  }
  const upFront: AfterRollId[] = luckRodeThrow(pending.expression, pending.advantage) ? ["lucky"] : [];
  return afterRollOptions(sheet, { kind: pending.kind, outcome, dc: pending.dc, spent: [...spent, ...upFront], reactionFree });
}

// The player's choice, paid for and on the dice. Null when the choice is no
// longer on offer; nothing is spent then.
export function spendAfterRoll(
  campaign: Campaign,
  sheet: CharacterSheet,
  id: AfterRollId,
  outcome: RollResult,
  advantage = "none",
): { outcome: RollResult; choosing: boolean; touchOfDeath?: number } | null {
  const die = (sides: number) => ({ sides, value: rollExpression(`1d${sides}`).total, kept: true });
  if (id === "guided_strike") {
    return spendFeatureUse(campaign, sheet.id, CHANNEL_DIVINITY, "Channel Divinity: Guided Strike", "player") ? { outcome: withFlatBonus(outcome, GUIDED_STRIKE_BONUS), choosing: false } : null;
  }
  if (id === "touch_of_death") {
    return spendFeatureUse(campaign, sheet.id, CHANNEL_DIVINITY, "Channel Divinity: Touch of Death", "player") ? { outcome, choosing: false, touchOfDeath: touchOfDeathDamage(sheet) } : null;
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
    // Obeying what the first throw obeyed (a halfling's reroll of a 1).
    const fresh = Array.from({ length: advantage === "disadvantage" ? 1 : 2 }).flatMap(() => rollExpression(extraD20Expression(outcome.expression)).terms.flatMap((term) => (term.kind === "dice" ? term.dice.slice(0, 1) : [])));
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
  if (id === "chronal_shift") {
    const encounter = getActiveEncounter(campaign.id);
    if (encounter?.reactionsUsed.includes(sheet.id) || !spendFeatureUse(campaign, sheet.id, CHRONAL_SHIFT, "Chronal Shift", "player")) {
      return null;
    }
    if (encounter) {
      markReactionUsed(encounter, sheet.id);
    }
    const lead = outcome.terms[0];
    const count = lead && lead.kind === "dice" ? lead.dice.length : 0;
    // One fresh d20 for each the roll threw, obeying what they obeyed (a
    // halfling's reroll of a 1).
    const fresh = Array.from({ length: count }).flatMap(() => rollExpression(extraD20Expression(outcome.expression)).terms.flatMap((term) => (term.kind === "dice" ? term.dice.slice(0, 1) : [])));
    const rerolled = withRerolledD20(outcome, fresh);
    return rerolled ? { outcome: rerolled, choosing: false } : null;
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
