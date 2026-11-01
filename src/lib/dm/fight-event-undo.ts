import type { Campaign } from "@/lib/db/campaigns";
import { getEncounter } from "@/lib/db/encounters";
import { getFightEvent, rearmFightEvent, type ArmedFightEvent } from "@/lib/db/fight-events";
import { getCampaignMessage, updateMessageContent } from "@/lib/db/messages";
import { deleteNote } from "@/lib/db/notes";
import { recordTurnChange, type TurnChange } from "@/lib/db/turn-changes";
import { publishPersisted } from "@/lib/events";

// "Revert this turn" for a prepared fight's event (issue 685). What the
// event did to the fight and the board is the turn's own fight rows
// (src/lib/db/turn-rows.ts), put back with everything else the turn did
// there; this arms the event again, so it fires when its moment comes round,
// marks its line in the chronicle as taken back, and drops the GM's note of
// what it could not do. Before, the event stayed fired: replayed, the moment
// came and nothing happened.

// The chronicle keeps what the table was told, as it keeps a reverted turn's
// narration; the line says it was taken back, so nobody reads it as
// standing, nor twice when the event fires again (a fresh line of its own).
// A change is reverted once, so the line is marked once.
export function takenBackLine(line: string): string {
  return `Taken back: ${line}`;
}

// Keeps the event under the turn it fired in.
export function recordFightEvent(
  campaign: Campaign,
  turnId: string,
  armed: ArmedFightEvent,
  told: { line: string; messageId: string | null; noteId: string | null },
) {
  recordTurnChange(campaign.id, turnId, "fight_event", {
    eventId: armed.id,
    encounterId: armed.encounterId,
    // Nothing told: the log still needs a row to offer the revert on, and the
    // fight's own name may be the GM's secret.
    line: told.line || "A prepared event of the fight ran.",
    messageId: told.messageId,
    noteId: told.noteId,
  });
}

function payloadOf(change: TurnChange) {
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    eventId: text(change.payload.eventId) ?? "",
    encounterId: text(change.payload.encounterId) ?? "",
    messageId: text(change.payload.messageId),
    noteId: text(change.payload.noteId),
  };
}

// Takes one event back while its fight is still on (an ended fight disarmed
// its events, and what was done in it stays). False when it could not be.
export function takeBackFightEvent(campaign: Campaign, change: TurnChange): boolean {
  const event = payloadOf(change);
  const encounter = getEncounter(event.encounterId);
  if (!encounter || encounter.status !== "active" || !getFightEvent(event.eventId)) {
    return false;
  }
  rearmFightEvent(event.eventId);
  const message = event.messageId ? getCampaignMessage(event.messageId) : null;
  if (message) {
    const updated = updateMessageContent(message.id, takenBackLine(message.content), []);
    if (updated) {
      publishPersisted(campaign.id, "message_updated", { message: updated });
    }
  }
  if (event.noteId) {
    deleteNote(event.noteId);
  }
  return true;
}
