// How long a roll waits on its player's after-the-roll choice
// (src/lib/dm/after-roll.ts). A player who has stepped away would otherwise
// hold the whole table until someone noticed; past the deadline the dice are
// kept as they lie, as the player's own "Keep this roll" would keep them, and
// nothing is spent. Each choice gives a fresh deadline (a luck point's second
// d20 is a new decision). The deadline rides the thrown dice, so the card can
// count it down and a restart can find it.
//
// Only while someone else is at the table: the timer is there so one player
// cannot hold up the rest, and a player alone holds up nobody. A solo table
// keeps the old wait, with no clock taking their choice away while they read
// their sheet or look up from their real dice.
//
// The landing is imported when the timer fires: the roll that arms it
// (invoke-roll.ts) sits under the turn loop that the landing resumes.

import { getCampaignById } from "@/lib/db/campaigns";
import { getPendingRoll, listOpenAfterRolls } from "@/lib/db/dm-turns";
import { AFTER_ROLL_SECONDS } from "@/lib/dm/after-roll-logic";
import { tableBreakOn } from "@/lib/dm/table-break";
import { onlineUserIds } from "@/lib/events";

export { AFTER_ROLL_SECONDS };

// A break holds the table, so the wait is checked again this often until it ends.
const BREAK_RECHECK_MS = 5000;

// The deadline for a roll the roller now decides on, or none when nobody
// else is online at the table to be kept waiting.
export function afterRollDeadline(campaignId: string, rollerId: string, now = Date.now()): string | undefined {
  if (!onlineUserIds(campaignId).some((userId) => userId !== rollerId)) {
    return undefined;
  }
  return new Date(now + AFTER_ROLL_SECONDS * 1000).toISOString();
}

export function armAfterRollKeep(pendingId: string, deadline: string | undefined) {
  if (!deadline) {
    return;
  }
  const timer = setTimeout(() => void keepAfterRollWhenDue(pendingId), Math.max(0, new Date(deadline).getTime() - Date.now()));
  timer.unref?.();
}

// The timer's answer: the dice as they lie, unless the roll has landed, a
// later choice moved the deadline, or a break holds the table.
export async function keepAfterRollWhenDue(pendingId: string, now = Date.now()): Promise<boolean> {
  const pending = getPendingRoll(pendingId);
  const thrown = pending?.thrown;
  if (!pending || pending.status !== "pending" || !thrown?.deadline) {
    return false;
  }
  const campaign = getCampaignById(pending.campaignId);
  if (!campaign) {
    return false;
  }
  if (new Date(thrown.deadline).getTime() > now) {
    armAfterRollKeep(pendingId, thrown.deadline);
    return false;
  }
  if (tableBreakOn(campaign.id)) {
    const timer = setTimeout(() => void keepAfterRollWhenDue(pendingId), BREAK_RECHECK_MS);
    timer.unref?.();
    return false;
  }
  const { landPendingRoll } = await import("@/lib/dm/pending-roll-land");
  return Boolean(landPendingRoll(campaign, pending, thrown.outcome, thrown.landing));
}

// The timers lived in the last process: each open wait gets its own again,
// and one already past its deadline is kept as soon as the queue runs.
export function rearmAfterRollKeeps(): number {
  const open = listOpenAfterRolls();
  for (const pending of open) {
    armAfterRollKeep(pending.id, pending.thrown?.deadline);
  }
  return open.length;
}
