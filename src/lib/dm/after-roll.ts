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
  extraD20Expression,
  heldBardicDie,
  heldOwnLuckDie,
  helperOption,
  hitHelperOption,
  holdsMoteDie,
  holdsRow,
  luckRodeThrow,
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
import { AFTER_ROLL_ROWS, afterRollRow, ownsItself, type AfterRollRow } from "@/lib/dm/after-roll-table";
import { allyShifters, canReactNow, inShiftReach, payChronalShift, playerAtTable, SHIFT_RANGE_FEET } from "@/lib/dm/chronal-shift";
import { LUCK_SPEND } from "@/lib/dm/roll-riders";
import { luckPointsLeft } from "@/lib/srd/class-resources";
import { rollsWrathDice } from "@/lib/dm/destructive-wrath-logic";
import { getActiveEncounter } from "@/lib/db/encounters";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { inPlay } from "@/lib/dm/roster";
import { combatDie, unfailingDieKept } from "@/lib/dm/ar-wbf-bard-dice-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { swingFacts } from "@/lib/dm/mt-mr-offers";
import { fateChoicesFor, spendFateAfterRoll } from "@/lib/dm/fate-turn";
import { isFatePower } from "@/lib/dm/fate-turn-logic";
import { propheticChoicesFor, spendPropheticState } from "@/lib/dm/mt-fb-runes";

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
    const own = done.kept ? [] : afterAttackOptions(sheet, { outcome, ac, critRange, spent: [...spent, ...bought], reactionFree, melee: record.melee === true && record.ranged !== true, wrathDice: rollsWrathDice(record.damageExpression, record.damageType, record.riders), swing: swingFacts(pending.campaignId, sheet, record) });
    const allies = allyChoicesFor(pending.campaignId, sheet, { kind: "attack", outcome, ac, critRange, weapon: record.weaponAttack === true }, done);
    return [...own, ...allies];
  }
  const upFront: AfterRollId[] = luckRodeThrow(pending.expression, pending.advantage) ? ["lucky"] : [];
  const own = done.kept ? [] : afterRollOptions(sheet, { kind: pending.kind, outcome, dc: pending.dc, spent: [...spent, ...upFront], reactionFree, check: { skill: pending.kind === "skill_check" ? pending.detail : null, tool: pending.carry?.tool } });
  const allies = allyChoicesFor(pending.campaignId, sheet, { kind: pending.kind, outcome, dc: pending.dc, spent }, done);
  return [...own, ...allies];
}

// Who could answer a roll from their own screen, for a player whose rolls wait
// (invoke-roll.ts, pc-attack-parked.ts throwForChoice): the roll parks on them
// as it would on the roller's own options. Every row of after-roll-table.ts
// that answers another's roll: Chronal Shift, War God's Blessing and Flash
// of Genius on a miss or a failure (the artificer may also
// spend Flash of Genius on their own roll), Violent Attraction on a weapon's
// hit; then the rows of their own: Convergent Future and Bend Luck
// (fate-turn.ts), a Rune Knight's prophetic state (mt-fb-runes.ts), the
// roller's own among them. A helper on the bench (one character fielded per
// player) answers nobody.
export function allyChoicesFor(
  campaignId: string,
  sheet: CharacterSheet,
  roll: { kind: string; outcome: RollResult; dc: number | null; spent?: readonly AfterRollId[] } | { kind: "attack"; outcome: RollResult; ac: number; critRange: number; weapon?: boolean },
  done: Pick<ThrownRoll, "shiftedBy" | "declined" | "kept"> = {},
): AfterRollOption[] {
  const shifts = shiftCanHelp(roll) ? allyShifters(campaignId, sheet, roll.kind, done) : [];
  const skip = new Set([sheet.id, ...(done.shiftedBy ?? []), ...(done.declined ?? [])]);
  const others = listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((other) => !skip.has(other.id) && rollsCanWait(other) && playerAtTable(campaignId, other) && inPlay(campaignId, other) && canReactNow(campaignId, other));
  const fight = getActiveEncounter(campaignId);
  // "Within N feet" and, where the text asks for it, "a creature you can
  // see". War God's Blessing asks for 30 feet and not for sight, so a cleric
  // beside an unseen ally may still bless the roll.
  const reaches = (helper: CharacterSheet, row: AfterRollRow) =>
    row.sight ? inShiftReach(campaignId, helper, sheet, row.rangeFt) : !fight || withinFeet(fight.id, helper.id, sheet.id, row.rangeFt ?? SHIFT_RANGE_FEET);
  const modifierOf = (helper: CharacterSheet, row: AfterRollRow) => (row.amount?.kind === "ability" ? computeSheetDerived(helper).abilityMods[row.amount.ability] : undefined);
  const spent = "spent" in roll ? (roll.spent ?? []) : [];
  const helps: AfterRollOption[] = [];
  for (const row of AFTER_ROLL_ROWS as readonly AfterRollRow[]) {
    // Chronal Shift's helpers are allyShifters' (above), as at the watch stop;
    // a row of its own is offered by its module, below.
    if (row.whose === "own" || row.effect === "reroll" || ownsItself(row)) continue;
    const id = row.id as AfterRollId;
    if (row.ownAmongHelpers && !("ac" in roll) && !done.kept && !spent.includes(id) && canReactNow(campaignId, sheet)) {
      const own = helperOption(sheet, id, roll, { rollerName: sheet.name, modifier: modifierOf(sheet, row), own: true });
      if (own) helps.push(own);
    }
    for (const helper of others) {
      if (!reaches(helper, row)) continue;
      const option = row.when === "hit"
        ? ("ac" in roll ? hitHelperOption(helper, id, { ...roll, weapon: roll.weapon === true }, sheet.name) : null)
        : helperOption(helper, id, roll, { rollerName: sheet.name, modifier: modifierOf(helper, row) });
      if (option) helps.push(option);
    }
  }
  return [...shifts, ...helps, ...fateChoicesFor(campaignId, sheet, roll, others, !done.kept), ...propheticChoicesFor(campaignId, sheet, roll, others, !done.kept)];
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

// The die a held_die row adds for this character: the condition they hold,
// or Dark One's Own Luck's own use.
function heldDieFor(row: AfterRollRow, sheet: CharacterSheet): string | null {
  if (row.amount?.kind !== "held") return null;
  return row.amount.condition === "bardic inspiration" ? (heldBardicDie(sheet)?.die ?? null) : ownLuckDie(sheet);
}

// Pays for a row on the card: its use, die or luck point, and the reaction
// for a row that costs one. False when it can no longer be paid; nothing is
// spent then.
function payRow(campaign: Campaign, row: AfterRollRow, giver: CharacterSheet): boolean {
  const encounter = row.reaction ? getActiveEncounter(campaign.id) : null;
  if (row.reaction) {
    // Chronal Shift on the wizard's own roll asks only that the reaction is
    // free this round, as it always has; the others that the character could
    // take a reaction at all.
    const able = row.effect === "reroll" ? !encounter?.reactionsUsed.includes(giver.id) : canReactNow(campaign.id, giver);
    if (!able) return false;
  }
  if (row.cost === "luck_point") {
    if (luckPointsLeft(giver.resources) < 1) return false;
    // Audited, so an undo of the turn gives the point back.
    spendRollCarriers(campaign.id, giver.id, LUCK_SPEND, "player");
  } else if (row.cost === "held_die") {
    const held = row.amount?.kind === "held" && row.amount.condition === "bardic inspiration" ? heldBardicDie(giver) : heldOwnLuckDie(giver);
    if (held) {
      spendRollCarriers(campaign.id, giver.id, held.condition, "player");
    } else if (!row.counter || !spendFeatureUse(campaign, giver.id, row.counter, row.feature, "player")) {
      return false;
    }
  } else if (row.cost === "channel_divinity") {
    if (!spendFeatureUse(campaign, giver.id, CHANNEL_DIVINITY, `Channel Divinity: ${row.feature}`, "player")) return false;
  } else if (!spendFeatureUse(campaign, giver.id, row.counter!, row.feature, "player")) {
    return false;
  }
  if (encounter) {
    markReactionUsed(encounter, giver.id);
  }
  return true;
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
  // What the roll must reach (its Difficulty Class, an attack's Armor Class)
  // when the caller knows it: an Eloquence bard's die that leaves the roll
  // short of it is kept (ar-wbf-bard-dice-logic.ts).
  target: number | null = null,
): { outcome: RollResult; choosing: boolean; touchOfDeath?: number; destructiveWrath?: boolean; combatInspiration?: boolean; helperHit?: string } | null {
  const row = afterRollRow(id);
  const giver = payer ?? sheet;
  const die = (sides: number) => ({ sides, value: rollExpression(`1d${sides}`).total, kept: true });
  // The rows of their own (after-roll-table.ts effect "own") spend in their
  // modules; the monk's and rogue's go through the route's mrSpendAfterRoll.
  if (id === "prophetic_state") {
    return spendPropheticState(campaign, sheet, outcome, payer);
  }
  if (isFatePower(id)) {
    return spendFateAfterRoll(campaign, sheet, id, outcome, payer, target);
  }
  if (id === "combat_inspiration") {
    // Paid by the hit itself too: the die leaves its holder once the hit stands.
    return combatDie(sheet) ? { outcome, choosing: false, combatInspiration: true } : null;
  }
  if (ownsItself(row)) {
    return null;
  }
  if (row.when === "hit") {
    // Paid by the hit itself (attack-swing.ts hitSwing): a Parry or a Shield
    // can still turn the roll as it lands, and a use spent here was lost then.
    if (row.whose === "other") {
      return payer && payer.id !== sheet.id && canReactNow(campaign.id, payer) && holdsRow(payer, row) ? { outcome, choosing: false, helperHit: payer.id } : null;
    }
    const state = sheet.resources?.[CHANNEL_DIVINITY];
    if (!state || state.max - state.used < 1) return null;
    return row.amount?.kind === "max" ? { outcome, choosing: false, destructiveWrath: true } : { outcome, choosing: false, touchOfDeath: touchOfDeathDamage(sheet) };
  }
  if (row.effect === "reroll" && payer && payer.id !== sheet.id) {
    return payChronalShift(campaign.id, payer.id) ? rerollD20s(outcome) : null;
  }
  // The die is read before it is paid: a held die is gone once spent.
  const held = row.cost === "held_die" ? heldDieFor(row, giver) : null;
  // An Eloquence bard's die that leaves the roll short of `target` stays on
  // its holder (ar-wbf-bard-dice-logic.ts unfailingDieKept), so it is rolled
  // before it is paid, and paid only if it turned the roll.
  const bardic = row.cost === "held_die" && row.amount?.kind === "held" && row.amount.condition === "bardic inspiration" ? heldBardicDie(giver) : null;
  if (bardic) {
    const added = withBonusDie(outcome, die(sidesOf(bardic.die)));
    if (!unfailingDieKept(giver, bardic.condition, added.total, target)) {
      spendRollCarriers(campaign.id, giver.id, bardic.condition, "player");
    }
    return { outcome: added, choosing: false };
  }
  if ((row.cost === "held_die" && !held) || !payRow(campaign, row, giver)) {
    return null;
  }
  switch (row.effect) {
    case "extra_d20": {
      const extra = rollExpression(extraD20Expression(outcome.expression)).terms[0];
      const pooled = extra.kind === "dice" ? withExtraD20(outcome, extra.dice[0]) : null;
      return pooled ? { outcome: pooled, choosing: true } : null;
    }
    case "add_die":
      return { outcome: withBonusDie(outcome, die(sidesOf(held!))), choosing: false };
    case "add_dice": {
      const amount = row.amount?.kind === "dice" ? row.amount : null;
      let added = outcome;
      for (let at = 0; at < (amount?.count ?? 0); at += 1) added = withBonusDie(added, die(amount!.sides));
      return { outcome: added, choosing: false };
    }
    case "add_flat": {
      const amount = row.amount;
      const value = amount?.kind === "flat" ? amount.value : amount?.kind === "ability" ? computeSheetDerived(giver).abilityMods[amount.ability] : 0;
      return { outcome: withFlatBonus(outcome, value), choosing: false };
    }
    case "reroll":
      return rerollD20s(outcome);
    case "reroll_edge": {
      // Obeying what the first throw obeyed (a halfling's reroll of a 1), and
      // Elven Accuracy's third die on the advantage it now has.
      const fresh = Array.from({ length: advantage === "disadvantage" ? 1 : elvenAccuracy ? 3 : 2 }).flatMap(() => rollExpression(extraD20Expression(outcome.expression)).terms.flatMap((term) => (term.kind === "dice" ? term.dice.slice(0, 1) : [])));
      const again = withAdvantageReroll(outcome, fresh);
      return again ? { outcome: again, choosing: false } : null;
    }
    default:
      return null;
  }
}

// A helper's dice on a hit that now stands (Violent Attraction's 1d10),
// chosen on the card the hit waited on: the use and the reaction are paid
// here, as the hit lands (attack-swing.ts). Null when the helper can no
// longer pay; the hit then deals what it would have.
export function payHelperHit(campaign: Campaign, help: { by: string; use: AfterRollId }): { expression: string; note: string } | null {
  const row = afterRollRow(help.use);
  const helper = getSheetById(help.by);
  const amount = row.amount?.kind === "dice" ? row.amount : null;
  if (!helper || row.when !== "hit" || !amount || !payRow(campaign, row, helper)) {
    return null;
  }
  const dice = `${amount.count}d${amount.sides}`;
  return { expression: dice, note: `${row.feature}: ${helper.name} adds ${dice} to the damage` };
}
