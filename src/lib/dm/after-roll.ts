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
import {
  afterRollOptions,
  DARK_ONES_OWN_LUCK,
  extraD20Expression,
  heldBardicDie,
  heldOwnLuckDie,
  holdsMoteDie,
  ownLuckDie,
  sidesOf,
  withBonusDie,
  withExtraD20,
  type AfterRollId,
  type AfterRollOption,
} from "@/lib/dm/after-roll-logic";
import { LUCK_SPEND } from "@/lib/dm/roll-riders";
import { luckPointsLeft } from "@/lib/srd/class-resources";
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

// What this parked roll offers, given its dice as they now stand. A roll
// behind the GM's screen never waits: its card would show the table the dice.
// A parked attack keeps its own path (src/lib/dm/pc-attack-parked.ts).
export function optionsForPending(pending: PendingRoll, outcome: RollResult, spent: readonly AfterRollId[] = []): AfterRollOption[] {
  if (pending.visibility !== "public" || !pending.characterId || pending.attack) {
    return [];
  }
  const sheet = getSheetById(pending.characterId);
  if (!sheet || !rollsCanWait(sheet)) {
    return [];
  }
  return afterRollOptions(sheet, { kind: pending.kind, outcome, dc: pending.dc, spent });
}

// The player's choice, paid for and on the dice. Null when the choice is no
// longer on offer; nothing is spent then.
export function spendAfterRoll(
  campaign: Campaign,
  sheet: CharacterSheet,
  id: AfterRollId,
  outcome: RollResult,
): { outcome: RollResult; choosing: boolean } | null {
  const die = (sides: number) => ({ sides, value: rollExpression(`1d${sides}`).total, kept: true });
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
