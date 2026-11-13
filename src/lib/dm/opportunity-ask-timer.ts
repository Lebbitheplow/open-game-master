// The answer to the ask before an opportunity attack (opportunity-ask.ts),
// from the player's card, from a screen that draws it as a roll, or from the
// clock.
//
// The clock runs only while another player is at the table (the deadline is
// set as the card is put out), for the after-the-roll card's reason
// (after-roll-timer.ts): one player must not hold up the rest. When it runs
// out the swing is TAKEN, the old behaviour and the common choice, with a
// note that the time ran out. The deadline rides the card, so a restart arms
// it again.
//
// The landing is imported when it is needed: the card is put out under the
// turn loop that the landing resumes.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getPendingRoll, listOpenOpportunityAsks, setPendingCarry, type PendingRoll } from "@/lib/db/dm-turns";
import type { RollResult } from "@/lib/dice";
import { tableBreakOn } from "@/lib/dm/table-break";

const BREAK_RECHECK_MS = 5000;

// An answer is no roll: the held call reads the answer off the card's carry,
// and this stands where the landing expects dice.
const NO_DICE: RollResult = { expression: "0", total: 0, terms: [] };

// The answer, written on the card and landed: the walk's call runs again with
// it. Null when the card was already answered.
export async function answerOpportunityAsk(campaign: Campaign, pending: PendingRoll, answer: { strike: boolean; timedOut?: boolean }) {
  const ask = pending.carry?.ask;
  if (!ask || pending.status !== "pending") {
    return null;
  }
  const carry = { ...pending.carry, ask: { ...ask, strike: answer.strike, ...(answer.timedOut ? { timedOut: true } : {}) } };
  const written = setPendingCarry(pending.id, carry);
  if (!written) {
    return null;
  }
  const { landPendingRoll } = await import("@/lib/dm/pending-roll-land");
  return landPendingRoll(campaign, written, NO_DICE, { status: answer.timedOut ? "fallback" : "submitted", physical: false, source: "digital" });
}

export function armOpportunityAsk(pendingId: string, deadline: string | undefined) {
  if (!deadline) {
    return;
  }
  const timer = setTimeout(() => void takeOpportunityWhenDue(pendingId), Math.max(0, new Date(deadline).getTime() - Date.now()));
  timer.unref?.();
}

// The clock's answer: the swing, unless the card was answered, its time is not
// up, or a break holds the table.
export async function takeOpportunityWhenDue(pendingId: string, now = Date.now()): Promise<boolean> {
  const pending = getPendingRoll(pendingId);
  const deadline = pending?.carry?.ask?.deadline;
  if (!pending || pending.status !== "pending" || !deadline) {
    return false;
  }
  const campaign = getCampaignById(pending.campaignId);
  if (!campaign) {
    return false;
  }
  if (new Date(deadline).getTime() > now) {
    armOpportunityAsk(pendingId, deadline);
    return false;
  }
  if (tableBreakOn(campaign.id)) {
    const timer = setTimeout(() => void takeOpportunityWhenDue(pendingId), BREAK_RECHECK_MS);
    timer.unref?.();
    return false;
  }
  return Boolean(await answerOpportunityAsk(campaign, pending, { strike: true, timedOut: true }));
}

// The clocks lived in the last process: each open card gets its own again.
export function rearmOpportunityAsks(): number {
  const open = listOpenOpportunityAsks();
  for (const pending of open) {
    armOpportunityAsk(pending.id, pending.carry?.ask?.deadline);
  }
  return open.length;
}
