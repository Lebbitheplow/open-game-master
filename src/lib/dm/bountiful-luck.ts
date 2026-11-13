// Bountiful Luck (a halfling's feat): when an ally in sight within 30 feet
// rolls a 1 on the d20 of an attack roll, an ability check or a saving throw,
// the halfling's reaction lets them roll that die again, and the new roll
// stands. Their own Lucky trait then does nothing until the end of their next
// turn (feature-effects.ts hasHalflingLuck reads the mark this lays).
//
// It answers a roll that waits on its card (after-roll.ts allyChoicesFor):
// the halfling's player presses it from their own screen, as a helper does
// Chronal Shift's. A roll the server throws inside a call has no stop for it.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { rollExpression, type RollResult } from "@/lib/dice";
import { addSheetCondition } from "@/lib/dm/action-common";
import { extraD20Expression, withRerolledD20, type AfterRollOption } from "@/lib/dm/after-roll-logic";
import { afterRollRow, fillWords } from "@/lib/dm/after-roll-table";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { canReactNow } from "@/lib/dm/chronal-shift";
import type { JudgedRoll } from "@/lib/dm/fate-turn-logic";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsFeat } from "@/lib/srd/feat-effects";
import { BOUNTIFUL_LUCK_LENT } from "@/lib/srd/feature-effects";

const RANGE_FEET = 30;

// The kept d20 shows a 1, and the roll fails as it stands: a natural 1 misses
// any attack; a check or save is offered when it falls short of its DC, or has
// none the helper could read.
export function rolledOne(roll: JudgedRoll): boolean {
  if (roll.outcome.natural !== 1) {
    return false;
  }
  return "ac" in roll || roll.dc === null || roll.outcome.total < roll.dc;
}

function canLend(campaignId: string, holder: CharacterSheet, roller: CharacterSheet): boolean {
  if (holder.id === roller.id || !holdsFeat(holder, "Bountiful Luck") || !canReactNow(campaignId, holder)) {
    return false;
  }
  const encounter = getActiveEncounter(campaignId);
  return !encounter || (withinFeet(encounter.id, holder.id, roller.id, RANGE_FEET) && !unseenBecause(encounter.id, holder, roller));
}

// What the card of an ally's natural 1 offers: each of `others` (seats whose
// players can answer) holding the feat, in reach and in sight.
export function bountifulLuckChoicesFor(campaignId: string, roller: CharacterSheet, roll: JudgedRoll, others: readonly CharacterSheet[]): AfterRollOption[] {
  if (!rolledOne(roll)) {
    return [];
  }
  const row = afterRollRow("bountiful_luck");
  const words = { kind: roll.kind, name: roller.name };
  return others.filter((holder) => canLend(campaignId, holder, roller)).map((holder) => ({
    id: "bountiful_luck" as const,
    by: holder.id,
    label: fillWords(row.label, words),
    note: fillWords(row.note, words),
  }));
}

// The kept 1 thrown again, obeying what the first throw obeyed (a halfling
// roller's own reroll of a 1); only that die, as advantage allows one.
function withOneRolledAgain(outcome: RollResult): RollResult | null {
  const lead = outcome.terms[0];
  if (!lead || lead.kind !== "dice" || lead.sides !== 20) {
    return null;
  }
  const at = lead.dice.findIndex((die) => die.kept !== false && die.value === 1);
  if (at < 0) {
    return null;
  }
  const thrown = rollExpression(extraD20Expression(outcome.expression)).terms[0];
  const fresh = thrown && thrown.kind === "dice" ? thrown.dice[0] : null;
  if (!fresh) {
    return null;
  }
  return withRerolledD20(outcome, lead.dice.map((die, index) => (index === at ? { ...fresh, kept: true } : die)));
}

// The card's choice, paid and on the dice (after-roll.ts spendAfterRoll):
// the halfling's reaction, and the mark that sets their Lucky aside until
// the end of their next turn (a round outside a fight). Null when it is no
// longer on offer; nothing is spent then.
export function spendBountifulLuck(campaign: Campaign, roller: CharacterSheet, outcome: RollResult, payer: CharacterSheet | undefined): { outcome: RollResult; choosing: boolean } | null {
  const holder = payer ? (getSheetById(payer.id) ?? payer) : null;
  if (!holder || outcome.natural !== 1 || !canLend(campaign.id, holder, roller)) {
    return null;
  }
  const again = withOneRolledAgain(outcome);
  if (!again) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    markReactionUsed(encounter, holder.id);
  }
  addSheetCondition(campaign, holder, BOUNTIFUL_LUCK_LENT, encounter ? { untilTurnEndOf: holder.id } : { rounds: 1 }, "Bountiful Luck");
  return { outcome: again, choosing: false };
}
