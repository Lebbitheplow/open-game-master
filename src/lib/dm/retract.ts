import type { MemberContext } from "@/lib/campaign-api";
import { getDatabase } from "@/lib/db/core";
import { getDmTurn, markDmTurnReverted } from "@/lib/db/dm-turns";
import { getCampaignMessage } from "@/lib/db/messages";
import { runningDmJob } from "@/lib/dm/queue";
import { setDmStatus } from "@/lib/dm/status";
import { runTurnRevert } from "@/lib/dm/turn-revert-run";
import { publishPersisted } from "@/lib/events";

// "Take back and rewrite": a player's newest move, a typo the GM already
// answered, is taken back whole. The GM turns that answered it are reverted
// (sheets, clock, fight, and what the NPC minds learned in them: their
// registers are journaled rows, src/lib/db/turn-journal.ts), and the move and
// everything said after it leave the transcript, so neither the table nor the
// narrator reads them again. The words come back to the player to correct and
// send again. Only the newest move, and only while the GM is not playing.

export type RetractResult =
  | { ok: true; text: string; reverted: number }
  | { ok: false; status: number; error: string };

export async function retractMove(context: MemberContext, messageId: string): Promise<RetractResult> {
  const campaignId = context.campaign.id;
  const message = getCampaignMessage(messageId);
  if (!message || message.campaignId !== campaignId) {
    return { ok: false, status: 404, error: "Message not found." };
  }
  if (message.authorType !== "player") {
    return { ok: false, status: 400, error: "Only a player's move can be taken back." };
  }
  if (runningDmJob(campaignId)) {
    return { ok: false, status: 409, error: "The GM is still playing. Take it back once the turn is done, or stop it first." };
  }
  const db = getDatabase();
  const later = db
    .prepare(`SELECT 1 FROM campaign_messages WHERE campaign_id = ? AND author_type = 'player' AND seq > ? LIMIT 1`)
    .get(campaignId, message.seq);
  if (later) {
    return { ok: false, status: 400, error: "Only the newest move can be taken back." };
  }

  // The GM turns that answered it, newest first, so each revert finds the
  // state its own turn left.
  const turnIds = (
    db
      .prepare(`SELECT id FROM dm_turns WHERE campaign_id = ? AND created_at >= ? AND reverted_at IS NULL ORDER BY created_at DESC, rowid DESC`)
      .all(campaignId, message.createdAt) as Array<{ id: string }>
  ).map((row) => row.id);
  let reverted = 0;
  for (const turnId of turnIds) {
    const response = runTurnRevert(context, turnId, true);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      // A turn that changed nothing has nothing to put back; it still goes.
      if (response.status !== 400 || body.error !== "Nothing left to revert for that turn.") {
        return { ok: false, status: response.status, error: body.error ?? "The GM's answer could not be taken back." };
      }
      if (getDmTurn(turnId)) {
        markDmTurnReverted(turnId);
      }
    } else {
      reverted += 1;
    }
  }

  db.transaction(() => {
    // Pins name messages: they go first, while the messages exist.
    db.prepare(
      `DELETE FROM campaign_pins WHERE campaign_id = ?
         AND message_id IN (SELECT id FROM campaign_messages WHERE campaign_id = ? AND seq >= ?)`,
    ).run(campaignId, campaignId, message.seq);
    db.prepare(`DELETE FROM campaign_messages WHERE campaign_id = ? AND seq >= ?`).run(campaignId, message.seq);
    db.prepare(`DELETE FROM dm_beats WHERE campaign_id = ? AND seq >= ?`).run(campaignId, message.seq);
    db.prepare(`DELETE FROM scene_chunks WHERE campaign_id = ? AND seq_start >= ?`).run(campaignId, message.seq);
    db.prepare(`DELETE FROM rolls WHERE campaign_id = ? AND (seq >= ? OR (seq IS NULL AND created_at >= ?))`).run(
      campaignId,
      message.seq,
      message.createdAt,
    );
  })();
  setDmStatus(campaignId, "idle");
  // Incremental events cannot say "these lines are gone": every client reads
  // the table again (useCampaignStream.ts reloadsSnapshot).
  publishPersisted(campaignId, "campaign_rewound", { boundarySeq: message.seq - 1, retracted: true });
  return { ok: true, text: message.content, reverted };
}
