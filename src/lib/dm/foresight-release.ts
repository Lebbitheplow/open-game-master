// A watch stop answered: the choice is written and the turn resumes once
// nothing else waits. Apart from src/lib/dm/foresight.ts because the turn loop
// reads that one and this one wakes the turn loop.

import { getCampaignById } from "@/lib/db/campaigns";
import { dropHeldCalls, getDmTurn, getPendingRoll, listPendingForTurn, publicPendingRoll, resolvePendingWatch, saveDmTurn, takeHeldCalls, watchChoiceOf, type PendingRoll } from "@/lib/db/dm-turns";
import { runWithShift } from "@/lib/dm/chronal-shift";
import { runWithForetold } from "@/lib/dm/foresight";
import { clearWatchAnswered, markWatchAnswered, runHeldCallNow } from "@/lib/dm/held-call";
import { resumeHumanTurn } from "@/lib/dm/invoke";
import { runInTurnScope } from "@/lib/dm/job-control";
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
  if (!listPendingForTurn(answered.turnId).some((entry) => entry.status === "pending")) {
    const { campaignId, turnId } = answered;
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
  const watcherId = pending.characterId;
  const picked = watchChoiceOf(stop);
  const shifting = Boolean(stop.power) && stop.power !== "portent";
  for (const [at, call] of stop.calls.entries()) {
    const choice = at === 0 && !shifting && stop.face !== null ? { watcherId, face: stop.face, tags: picked ? picked.rolls.map((roll) => roll.tag) : [stop.tag, ...(stop.also ?? [])], line: stop.line } : null;
    const shift = at === 0 && shifting && stop.shift && picked && stop.power && stop.power !== "portent" ? { wizardId: watcherId, rolls: picked.rolls, power: stop.power } : null;
    if (at === 0) {
      markWatchAnswered(campaign.id, call.tape ?? []);
    }
    try {
      await runInTurnScope(turn.id, () =>
        runWithShift(campaign.id, shift, () => runWithForetold(campaign, turn.id, choice, async () => runHeldCallNow(campaign, turn, { name: call.name, rawArguments: call.rawArguments, toolCallId: call.id ?? null }))),
      );
    } catch (error) {
      console.error(`[foresight] a held ${call.name} threw:`, error);
    } finally {
      clearWatchAnswered(campaign.id);
    }
  }
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
