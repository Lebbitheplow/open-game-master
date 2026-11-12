// The enemy-turn backstop going on after a held roll (backstop-calls.ts).
//
// The turn's narration is in and its creature turns stopped at one whose d20
// waited: a watcher's stop (Portent) or a seat's physical dice. A card's roll
// has already run the creature's turn as it landed (pending-roll-land.ts
// landHeld); a watcher's answer runs it here, with the number they chose
// armed as the AI's turn arms it (turn.ts runHeldCalls). Then the close of
// the turn goes on from the creature after it (encounter-tools.ts
// continueBackstop), and the turn closes, or waits again on the next one.

import { armsWatchRow } from "@/lib/dm/after-roll-table";
import { slayersCounterAtStop } from "@/lib/dm/slayers-counter";
import { forcerOfCall } from "@/lib/dm/foresight";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { dropHeldCalls, getDmTurn, listPendingForTurn, saveDmTurn, takeHeldCalls, watchChoiceOf, type DmTurn, type WatchStop } from "@/lib/db/dm-turns";
import { layCloudTurn } from "@/lib/dm/cloud-rune";
import { backstopWaiting, isBackstopPending } from "@/lib/dm/backstop-calls";
import { runWithShift } from "@/lib/dm/chronal-shift";
import { continueBackstop } from "@/lib/dm/encounter-tools";
import { runWithForetold } from "@/lib/dm/foresight";
import { beforeChoiceOf } from "@/lib/dm/foresight-before";
import { clearWatchAnswered, markWatchAnswered, runHeldCallNow } from "@/lib/dm/held-call";
import { runInTurnScope } from "@/lib/dm/job-control";
import { setDmStatus } from "@/lib/dm/status";
import { settleTableWait } from "@/lib/dm/table-wait";
import { wakeDm } from "@/lib/dm/wake";

// The calls a watch stop held, run outside a model's turn (a person's
// console call, the backstop), the first with the watcher's answer armed.
export async function runWatchedCalls(campaign: Campaign, turn: DmTurn, watcherId: string, stop: WatchStop) {
  const picked = watchChoiceOf(stop);
  const shifting = armsWatchRow(stop.power);
  for (const [at, call] of stop.calls.entries()) {
    const choice = at === 0 ? beforeChoiceOf(stop, watcherId) : null;
    const shift = at === 0 && shifting && stop.shift && picked && armsWatchRow(stop.power) ? { wizardId: watcherId, rolls: picked.rolls, power: stop.power } : null;
    if (at === 0) {
      markWatchAnswered(campaign.id, call.tape ?? []);
    }
    // Slayer's Counter is made before the call that forces the save (slayers-counter.ts).
    if (at === 0 && stop.power === "slayers_counter" && stop.shift) {
      runInTurnScope(turn.id, () => slayersCounterAtStop(campaign, turn, watcherId, forcerOfCall(call, getActiveEncounter(campaign.id)?.id)));
    }
    // The Cloud Rune's answer, read at the hit the call stopped on (cloud-rune.ts).
    if (at === 0) {
      layCloudTurn(watcherId, stop);
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
}

// Every roll of the turn has landed and the last was the backstop's: its
// creature's turn is played (a watcher's stop runs it now), the pass goes on,
// and the turn closes or waits on the next creature that waits.
export async function resumeBackstop(campaignId: string, turnId: string) {
  const campaign = getCampaignById(campaignId);
  const turn = getDmTurn(turnId);
  if (!campaign || !turn || turn.status !== "awaiting_rolls") {
    return;
  }
  const pendings = listPendingForTurn(turnId);
  if (pendings.some((pending) => pending.status === "pending")) {
    return;
  }
  for (const pending of pendings) {
    if (pending.parkedFor !== "watch" || !pending.characterId || !isBackstopPending(pending)) {
      continue;
    }
    const stop = takeHeldCalls(pending.id);
    // Taken already: the process died running it, and it may have happened.
    if (stop && !stop.taken) {
      await runWatchedCalls(campaign, turn, pending.characterId, stop);
    }
    dropHeldCalls(pending.id);
  }
  await runInTurnScope(turn.id, () => continueBackstop(campaign, turn));
  const ai = turn.actor !== "human_dm";
  if (backstopWaiting(turn.id)) {
    turn.status = "awaiting_rolls";
    saveDmTurn(turn);
    if (ai) {
      setDmStatus(campaignId, "awaiting_rolls");
    }
    return;
  }
  turn.status = "done";
  saveDmTurn(turn);
  if (ai) {
    setDmStatus(campaignId, "idle");
    // What the close of the turn held back while it waited (turn.ts finalize).
    if (settleTableWait(campaignId)) {
      wakeDm(campaignId);
    }
  }
}
