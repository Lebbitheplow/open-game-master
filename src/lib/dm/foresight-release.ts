// A watch stop answered: the choice is written and the turn resumes once
// nothing else waits. Apart from src/lib/dm/foresight.ts because the turn loop
// reads that one and this one wakes the turn loop.

import { getCampaignById } from "@/lib/db/campaigns";
import { dropHeldCalls, getDmTurn, getPendingRoll, listPendingForTurn, publicPendingRoll, resolvePendingWatch, saveDmTurn, takeHeldCalls, type PendingRoll } from "@/lib/db/dm-turns";
import { backstopTurn } from "@/lib/dm/backstop-calls";
import { resumeBackstop, runWatchedCalls } from "@/lib/dm/backstop-resume";
import { resumeHumanTurn } from "@/lib/dm/invoke";
import { enqueueDmJob } from "@/lib/dm/queue";
import { tableBreakOn } from "@/lib/dm/table-break";
import { resumeDmTurn } from "@/lib/dm/turn";
import { isHeldMove, runHeldMove } from "@/lib/dm/turn-hold";
import { publishPersisted } from "@/lib/events";

export function answerWatch(pendingId: string, face: number | null, answer: { chosen?: number | null; shift?: boolean } = {}): boolean {
  const answered = resolvePendingWatch(pendingId, face, answer);
  if (!answered) {
    return false;
  }
  publishPersisted(answered.campaignId, "roll_pending", { pendingRoll: publicPendingRoll(answered) });
  // A held pointer move runs itself; no GM turn waits on it (turn-hold.ts).
  if (isHeldMove(answered)) {
    enqueueDmJob(answered.campaignId, () => runHeldMove(answered.id), { kind: "turn" });
    return true;
  }
  const pendings = listPendingForTurn(answered.turnId);
  if (!pendings.some((entry) => entry.status === "pending")) {
    const { campaignId, turnId } = answered;
    // A creature's turn the server plays after the narration (the backstop,
    // backstop-calls.ts) goes on without a model call.
    if (backstopTurn(pendings)) {
      enqueueDmJob(campaignId, () => resumeBackstop(campaignId, turnId), { kind: "turn" });
      return true;
    }
    // A person's console call the stop held has no model turn to run it
    // (L856 of the 2026-11-09 gap sweep: Portent had no door at a table a
    // person runs): it runs here, on the watcher's answer, and the turn closes.
    if (getDmTurn(turnId)?.actor === "human_dm") {
      enqueueDmJob(campaignId, () => runPersonsStop(answered), { kind: "turn" });
    } else {
      enqueueDmJob(campaignId, () => resumeDmTurn(campaignId, turnId), { kind: "turn" });
    }
  }
  return true;
}

// The calls a stop held at a person's table, run with the watcher's answer
// armed as the AI's turn runs them (turn.ts runHeldCalls).
async function runPersonsStop(pending: PendingRoll) {
  const campaign = getCampaignById(pending.campaignId);
  const turn = getDmTurn(pending.turnId);
  const stop = takeHeldCalls(pending.id);
  if (!campaign || !turn || !stop || !pending.characterId) {
    return;
  }
  await runWatchedCalls(campaign, turn, pending.characterId, stop);
  dropHeldCalls(pending.id);
  saveDmTurn(turn);
  resumeHumanTurn(turn.id);
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
