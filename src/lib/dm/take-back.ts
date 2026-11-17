import { seesStorytellerSecrets, type MemberContext } from "@/lib/campaign-api";
import { getDatabase } from "@/lib/db/core";
import { markDmTurnReverted } from "@/lib/db/dm-turns";
import { getCampaignMessage } from "@/lib/db/messages";
import { enqueueDmJobFirst, runningDmJob } from "@/lib/dm/queue";
import { setDmStatus } from "@/lib/dm/status";
import { runTurnRevert } from "@/lib/dm/turn-revert-run";
import { publishPersisted } from "@/lib/events";

// "Take back and rewrite": the newest player move, a typo or a slip the GM
// already answered, is taken back whole. The GM turns that answered it are
// reverted the way "Revert this turn" reverts one (src/lib/dm/turn-revert-run.ts:
// sheets, clock, fight, and the rows the turn journal kept), and the move and
// every line after it leave the transcript, so neither the table nor the
// narrator reads them again. The words go back to the composer to correct
// and send. Ported from carlitose's fork (PR #1000).
//
// What goes is what those lines were: the messages, the pins and beats on
// them, their rolls, the scene summary cut from them, the facts drawn from
// them, and the item offers the reverted turns made. What stays is the
// record of what happened to the record: the sheet audit and the correction
// ledger (each revert writes its rows), content reports, the event log, and
// a player's own notes.

export type TakeBackResult =
  | { ok: true; text: string; reverted: number; corrections?: string[] }
  | { ok: false; status: number; error: string; warnings?: string[] };

export async function takeBackMove(
  context: MemberContext,
  messageId: string,
  options: { confirm?: boolean } = {},
): Promise<TakeBackResult> {
  const campaignId = context.campaign.id;
  const message = getCampaignMessage(messageId);
  if (!message || message.campaignId !== campaignId) {
    return { ok: false, status: 404, error: "Message not found." };
  }
  if (message.authorType !== "player") {
    return { ok: false, status: 400, error: "Only a player's move can be taken back." };
  }
  if (runningDmJob(campaignId)) {
    return { ok: false, status: 409, error: "The GM is still answering. Take it back once the turn is done, or stop it first." };
  }
  let result: TakeBackResult = { ok: false, status: 500, error: "The move could not be taken back." };
  // On the GM queue, ahead of anything waiting there, so no turn can start
  // between the reverts and the lines leaving the transcript.
  await enqueueDmJobFirst(campaignId, async () => {
    result = takeBackNow(context, message.seq, message.createdAt, message.content, options.confirm === true);
  });
  return result;
}

function takeBackNow(
  context: MemberContext,
  seq: number,
  createdAt: string,
  text: string,
  confirm: boolean,
): TakeBackResult {
  const campaignId = context.campaign.id;
  const db = getDatabase();
  const later = db
    .prepare(`SELECT 1 FROM campaign_messages WHERE campaign_id = ? AND author_type = 'player' AND seq > ? LIMIT 1`)
    .get(campaignId, seq);
  if (later) {
    return { ok: false, status: 400, error: "Only the newest move can be taken back." };
  }
  // A chapter that opened or closed on the answer would be left without its
  // lines; rewinding the chapter is the way back past one.
  const chapter = db
    .prepare(`SELECT 1 FROM chapters WHERE campaign_id = ? AND (seq_start > ? OR (seq_end IS NOT NULL AND seq_end >= ?)) LIMIT 1`)
    .get(campaignId, seq, seq);
  if (chapter) {
    return {
      ok: false,
      status: 400,
      error: "The GM's answer to this move closed the chapter. Rewind the chapter to take it back.",
    };
  }

  // The GM turns that answered it, newest first, so each revert finds the
  // state its own turn left.
  const turnIds = (
    db
      .prepare(
        `SELECT id FROM dm_turns WHERE campaign_id = ? AND created_at >= ? AND reverted_at IS NULL
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(campaignId, createdAt) as Array<{ id: string }>
  ).map((row) => row.id);

  // One transaction around every revert and the lines leaving: a turn that
  // cannot be put back leaves the table exactly as it was, never with its
  // first answer reverted and its words still on screen. The reverts' own
  // transactions nest inside it as savepoints.
  const answeringTurns = JSON.stringify(turnIds);
  const outcome = db.transaction((): TakeBackResult => {
    let reverted = 0;
    const corrections: string[] = [];
    for (const [index, turnId] of turnIds.entries()) {
      // The first turn's warnings (a sheet changed since, the clock moved)
      // are read before anything changes; the lead confirms once for all.
      const result = runTurnRevert(context.campaign, context.user.id, turnId, {
        confirm: confirm || index > 0,
        seesSecrets: seesStorytellerSecrets(context),
      });
      if (result.ok) {
        reverted += 1;
        corrections.push(...(result.corrections ?? []));
        continue;
      }
      if ("nothingToRevert" in result && result.nothingToRevert) {
        // A turn that changed nothing has nothing to put back; it still goes.
        markDmTurnReverted(turnId);
        continue;
      }
      throw new TakeBackRefused(
        "warnings" in result
          ? { ok: false, status: 409, error: "Taking this move back would undo newer changes.", warnings: result.warnings }
          : { ok: false, status: result.status, error: result.error },
      );
    }
    // Pins name messages: they go first, while the messages exist.
    db.prepare(
      `DELETE FROM campaign_pins WHERE campaign_id = ?
         AND message_id IN (SELECT id FROM campaign_messages WHERE campaign_id = ? AND seq >= ?)`,
    ).run(campaignId, campaignId, seq);
    db.prepare(`DELETE FROM dm_beats WHERE campaign_id = ? AND seq >= ?`).run(campaignId, seq);
    db.prepare(`DELETE FROM rolls WHERE campaign_id = ? AND (seq >= ? OR (seq IS NULL AND created_at >= ?))`).run(
      campaignId,
      seq,
      createdAt,
    );
    db.prepare(`DELETE FROM scene_chunks WHERE campaign_id = ? AND seq_start >= ?`).run(campaignId, seq);
    // A fact the narrator drew from the answer would keep telling it what
    // never happened.
    db.prepare(`DELETE FROM world_facts WHERE campaign_id = ? AND source_seq >= ?`).run(campaignId, seq);
    // An item the answer offered, still waiting on a yes, is not offered.
    db.prepare(
      `DELETE FROM item_proposals WHERE campaign_id = ? AND status = 'pending'
         AND turn_id IN (SELECT value FROM json_each(?))`,
    ).run(campaignId, answeringTurns);
    db.prepare(`DELETE FROM campaign_messages WHERE campaign_id = ? AND seq >= ?`).run(campaignId, seq);
    return { ok: true, text, reverted, ...(corrections.length ? { corrections } : {}) };
  });
  let done: TakeBackResult;
  try {
    done = outcome();
  } catch (error) {
    if (error instanceof TakeBackRefused) {
      return error.result;
    }
    throw error;
  }
  setDmStatus(campaignId, "idle");
  // Incremental events cannot say "these lines are gone": every client reads
  // the table again (useCampaignStream.ts reloadsSnapshot).
  publishPersisted(campaignId, "campaign_rewound", { boundarySeq: seq - 1, takenBack: true });
  return done;
}

// Thrown inside the transaction so a refused revert rolls back the ones
// before it; caught outside and answered as the refusal.
class TakeBackRefused extends Error {
  readonly result: TakeBackResult;
  constructor(result: TakeBackResult) {
    super("take back refused");
    this.result = result;
  }
}
