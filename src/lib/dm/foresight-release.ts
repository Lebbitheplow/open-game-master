// A watch stop answered: the choice is written and the turn resumes once
// nothing else waits. Apart from src/lib/dm/foresight.ts because the turn loop
// reads that one and this one wakes the turn loop.

import { getCampaignById } from "@/lib/db/campaigns";
import { getPendingRoll, listPendingForTurn, publicPendingRoll, resolvePendingWatch } from "@/lib/db/dm-turns";
import { enqueueDmJob } from "@/lib/dm/queue";
import { tableBreakOn } from "@/lib/dm/table-break";
import { resumeDmTurn } from "@/lib/dm/turn";
import { publishPersisted } from "@/lib/events";

export function answerWatch(pendingId: string, face: number | null, answer: { chosen?: number | null; shift?: boolean } = {}): boolean {
  const answered = resolvePendingWatch(pendingId, face, answer);
  if (!answered) {
    return false;
  }
  publishPersisted(answered.campaignId, "roll_pending", { pendingRoll: publicPendingRoll(answered) });
  if (!listPendingForTurn(answered.turnId).some((entry) => entry.status === "pending")) {
    const { campaignId, turnId } = answered;
    enqueueDmJob(campaignId, () => resumeDmTurn(campaignId, turnId), { kind: "turn" });
  }
  return true;
}

// The timer's answer. A break holds the table, so the stop waits it out.
export function releaseWatchWhenDue(pendingId: string) {
  const pending = getPendingRoll(pendingId);
  if (!pending || pending.status !== "pending" || !getCampaignById(pending.campaignId)) {
    return;
  }
  if (tableBreakOn(pending.campaignId)) {
    const timer = setTimeout(() => releaseWatchWhenDue(pendingId), 5000);
    timer.unref?.();
    return;
  }
  answerWatch(pendingId, null);
}
