// A pointer move held for a watch stop. The saves a move rolls (a
// character's end-of-turn save against Hold Person, the enemies' against
// theirs, the death saves of the dying whose turns it starts:
// foresight-more.ts moveSavesAbout) are thrown by the move itself, outside any
// call of the GM's, so a watching player's Portent, Chronal Shift, Flash of
// Genius or Favored by the Gods had no stop before them (SRD 5.1 Portent:
// "before the roll"). The model's end_turn moves the pointer inside its call,
// and the stop before that call holds it (foresight.ts parkForWatch). A
// player's End Turn moves it in the request, so here the move is held instead:
// the request says the turn is ending, the pointer stays, the ending character
// acts no more (held-turn.ts heldTurnRefusal), and the move runs once the stop
// is answered, at its 20 seconds, or after a restart (restart-recovery.ts).
// Only a stop a watcher could answer holds anything: an ordinary turn never
// waits, nor does a turn whose only watcher is the one ending it.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { closeStandInTurn, openStandInTurn, takeHeldCalls, watchChoiceOf, type PendingRoll } from "@/lib/db/dm-turns";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getActiveEncounter, saveEncounter, type Encounter } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { tableNote } from "@/lib/dm/between-io";
import { runWithShift } from "@/lib/dm/chronal-shift";
import { openWatchStop, runWithForetold, watchFor } from "@/lib/dm/foresight";
import { moveSavesAbout } from "@/lib/dm/foresight-more";
import { publishPersisted } from "@/lib/events";

// The one call a held move's stop holds: the move, for this character.
export const HELD_MOVE = "pass_turn";

export function isHeldMove(pending: Pick<PendingRoll, "watch">): boolean {
  return pending.watch?.calls[0]?.name === HELD_MOVE;
}

// Holds the move off this character's turn when a watcher could answer a save
// it rolls. True when it did; the caller makes the move itself otherwise.
export function holdMoveForWatch(campaign: Campaign, encounter: Encounter, characterId: string): boolean {
  const sheets = listSheets(campaign.id);
  const about = moveSavesAbout(campaign, encounter, sheets);
  if (!about || !watchFor(campaign.id, encounter, about, true, sheets)) {
    return false;
  }
  // A stop is a turn's: the move's is a stand-in turn's, as the engine's own
  // rolls outside a GM turn are (dm-turns.ts openStandInTurn).
  const anchor = openStandInTurn(campaign.id);
  closeStandInTurn(anchor);
  const stop = openWatchStop(campaign, anchor.id, [{ name: HELD_MOVE, rawArguments: JSON.stringify({ characterId }) }], about, true, encounter, sheets);
  if (!stop) {
    return false;
  }
  const live = getActiveEncounter(campaign.id) ?? encounter;
  live.legendary.heldMove = { pendingId: stop.id, characterId, watcher: stop.watcher.name };
  saveEncounter(live);
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  return true;
}

// The held character's own words for a refusal while the move waits.
export function heldMoveLine(encounter: Encounter | null, characterId: string): string | null {
  const held = encounter?.legendary.heldMove;
  return held && held.characterId === characterId ? `The turn is ending: it passes once ${held.watcher || "the watcher"} has answered the roll it brings, in a moment.` : null;
}

// The stop is closed: the move runs with what the watcher chose armed on its
// dice, as a held call runs (turn.ts runHeldCalls), and the GM's turn the End
// Turn asks for follows it.
export async function runHeldMove(pendingId: string): Promise<void> {
  const stop = takeHeldCalls(pendingId);
  const { getPendingRoll } = await import("@/lib/db/dm-turns");
  const pending = getPendingRoll(pendingId);
  const campaign = pending ? getCampaignById(pending.campaignId) : null;
  if (!stop || stop.taken || !pending || !campaign) {
    return;
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter?.legendary.heldMove?.pendingId === pendingId) {
    delete encounter.legendary.heldMove;
    saveEncounter(encounter);
  }
  const characterId = (() => {
    try {
      return String((JSON.parse(stop.calls[0]?.rawArguments ?? "{}") as { characterId?: unknown }).characterId ?? "");
    } catch {
      return "";
    }
  })();
  const watcherId = pending.characterId ?? "";
  const picked = watchChoiceOf(stop);
  const shifting = Boolean(stop.power) && stop.power !== "portent";
  const choice = !shifting && stop.face !== null && watcherId ? { watcherId, face: stop.face, tags: picked ? picked.rolls.map((roll) => roll.tag) : [stop.tag, ...(stop.also ?? [])], line: stop.line } : null;
  const shift = shifting && stop.shift && picked && stop.power && stop.power !== "portent" && watcherId ? { wizardId: watcherId, rolls: picked.rolls, power: stop.power } : null;
  const { endHeldOwnTurn } = await import("@/lib/dm/encounter-tools");
  const ran = await runWithShift(campaign.id, shift, () => runWithForetold(campaign, pending.turnId, choice, async () => endHeldOwnTurn(campaign.id, characterId)));
  const told = [ran.result.portent, ran.shift].filter((line): line is string => Boolean(line));
  if (told.length) {
    tableNote(campaign, told.join(" "), "cue-bell");
  }
  publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
  const { requestDmTurn } = await import("@/lib/dm/loop");
  requestDmTurn(campaign.id);
}
