// Convergent Future and Bend Luck (src/lib/dm/fate-turn-logic.ts) against the
// database: who they reach, what they cost, and the two windows they answer a
// roll in before its outcome lands.
//   - a player's roll that waits on its card (after-roll.ts allyChoicesFor):
//     the holder's player answers a failing roll from their own screen, and a
//     chronurgist their own;
//   - a save or check the server throws inside a call: decided at the watch
//     stop before the call runs (foresight.ts), and takeFate answers it at the
//     roll site once the roll is known, as takeShift does for Chronal Shift.
// A hit on the holder or an ally stays the reaction card's (authored-reactions.ts).
//
// Everything that spends either feature on a roll goes through payFate.

import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { RollTag } from "@/lib/dice-script-logic";
import { rollExpression, type RollResult } from "@/lib/dice";
import type { AfterRollOption } from "@/lib/dm/after-roll-logic";
import { unseenBecause, withinFeet } from "@/lib/dm/authored-saves";
import { armedFor, canReactNow } from "@/lib/dm/chronal-shift";
import { BEND_LUCK_POINTS, BEND_LUCK_SIDES, CONVERGENT_RANGE_FEET, FATE_NAMES, fateLine, fateOption, holdsFate, withBentLuck, withDictatedRoll, type FatePower, type JudgedRoll } from "@/lib/dm/fate-turn-logic";
import { markReactionUsed } from "@/lib/dm/turn-budget";
import { publishPersisted } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const POWERS: readonly FatePower[] = ["convergent_future", "bend_luck"];

// Whether the holder could spend it now: the feature and its cost in hand, and
// a reaction to take.
export function canTurnFate(campaignId: string, holder: CharacterSheet, power: FatePower): boolean {
  return holdsFate(holder, power) && canReactNow(campaignId, holder);
}

// "A creature you can see within 60 feet" (Convergent Future), "another
// creature you can see" (Bend Luck). With no board the fiction decides.
export function inFateReach(campaignId: string, holder: CharacterSheet, creature: Parameters<typeof unseenBecause>[2], power: FatePower): boolean {
  if (holder.id === creature.id) {
    return power === "convergent_future";
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return true;
  }
  return (power === "bend_luck" || withinFeet(encounter.id, holder.id, creature.id, CONVERGENT_RANGE_FEET)) && !unseenBecause(encounter.id, holder, creature);
}

// What the card of a failing roll offers: the roller's own Convergent Future,
// and each of `others` (seats whose players can answer) holding either.
export function fateChoicesFor(campaignId: string, roller: CharacterSheet, roll: JudgedRoll, others: readonly CharacterSheet[], ownToo: boolean): AfterRollOption[] {
  const own = ownToo && canTurnFate(campaignId, roller, "convergent_future") ? fateOption(roller, "convergent_future", roll, roller.name, true) : null;
  const help = others.flatMap((holder) =>
    POWERS.flatMap((power) => (canTurnFate(campaignId, holder, power) && inFateReach(campaignId, holder, roller, power) ? (fateOption(holder, power, roll, roller.name, false) ?? []) : [])),
  );
  return [...(own ? [own] : []), ...help];
}

// Pays for one: the reaction in a fight, and the level of exhaustion or the
// two sorcery points. False when it can no longer be paid; nothing is spent.
export function payFate(campaign: Campaign, holderId: string, power: FatePower): boolean {
  const holder = getSheetById(holderId);
  if (!holder || !canTurnFate(campaign.id, holder, power)) {
    return false;
  }
  const points = holder.resources?.sorcery_points;
  const patch = power === "convergent_future"
    ? { exhaustion: Math.min(6, (holder.exhaustion ?? 0) + 1) }
    : { resources: { ...holder.resources, sorcery_points: { max: points!.max, used: points!.used + BEND_LUCK_POINTS } } };
  const updated = patchSheet(holder.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: holder.id,
    turnId: null,
    actor: "player",
    kind: "use_resource",
    delta: power === "convergent_future" ? { resource: FATE_NAMES[power], exhaustion: 1 } : { resource: FATE_NAMES[power], spent: BEND_LUCK_POINTS },
    reason: FATE_NAMES[power],
    seq: allocateSeq(campaign.id),
    before: holder,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: holder.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    markReactionUsed(encounter, holder.id);
  }
  return true;
}

// The roll as the feature leaves it: dictated to succeed or fail, or bent by a
// d4 the right way. `succeed`: the way the holder wants it to go.
function turned(power: FatePower, outcome: RollResult, target: number, succeed: boolean): RollResult {
  return power === "convergent_future" ? withDictatedRoll(outcome, target, succeed) : withBentLuck(outcome, rollExpression(`1d${BEND_LUCK_SIDES}`).total, succeed);
}

// The card's choice, paid for and on the dice (after-roll.ts spendAfterRoll).
// Null when it is no longer on offer; nothing is spent then.
export function spendFateAfterRoll(campaign: Campaign, roller: CharacterSheet, power: FatePower, outcome: RollResult, payer: CharacterSheet | undefined, target: number | null): { outcome: RollResult; choosing: boolean } | null {
  if (target === null || !payFate(campaign, (payer ?? roller).id, power)) {
    return null;
  }
  return { outcome: turned(power, outcome, target, true), choosing: false };
}

// The roll site's question for one armed at the watch stop: does it answer
// this save or check, now that its total is known? It is paid for only when
// the roll goes the way the holder said to answer (and, for Bend Luck, where
// a d4 could turn it). Null leaves the roll as it was.
export function takeFate(campaignId: string, tag: RollTag | undefined, who: string, outcome: RollResult, target: number): { outcome: RollResult; line: string } | null {
  const armed = armedFor(campaignId, tag);
  if (!armed || (armed.power !== "convergent_future" && armed.power !== "bend_luck")) {
    return null;
  }
  const succeeded = outcome.total >= target;
  if ((armed.reverse === "success") !== succeeded) {
    return null;
  }
  const reach = succeeded ? outcome.total - BEND_LUCK_SIDES < target : outcome.total + BEND_LUCK_SIDES >= target;
  const campaign = getCampaignById(campaignId);
  if ((armed.power === "bend_luck" && !reach) || !campaign || !payFate(campaign, armed.holderId, armed.power)) {
    return null;
  }
  const after = turned(armed.power, outcome, target, !succeeded);
  const helper = getSheetById(armed.holderId)?.name ?? "A watcher";
  const line = fateLine(armed.power, helper, who, tag?.kind === "check" ? "check" : "save", outcome.total, after.total, target);
  armed.use(line);
  return { outcome: after, line: `${FATE_NAMES[armed.power]}: ${outcome.total} became ${after.total}` };
}
