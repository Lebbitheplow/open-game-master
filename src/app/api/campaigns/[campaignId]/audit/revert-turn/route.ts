import { z } from "zod";
import { isErrorResponse, requireStoryAuthority, seesStorytellerSecrets } from "@/lib/campaign-api";
import { correctionsField } from "@/lib/correction-reasons";
import { getCampaignById } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { previewTurnClockRewind, rewindTurnClock } from "@/lib/db/clock";
import { getDmTurn, markDmTurnReverted } from "@/lib/db/dm-turns";
import { listAuditForTurn } from "@/lib/db/sheet-audit";
import { liveTurnChanges } from "@/lib/db/turn-changes";
import { forgetTurnItemCasts } from "@/lib/db/item-cast-credits";
import { REVERT_WINDOW_TURNS, revertWindowStart, turnHasKeptRows } from "@/lib/db/turn-rows";
import { describeInstant } from "@/lib/dm/calendar";
import { forgetTurnAnswers, forgetTurnHits } from "@/lib/dm/last-hit";
import { turnStillPlaying } from "@/lib/dm/queue";
import { publishSceneState } from "@/lib/dm/scene-state";
import { currentScene } from "@/lib/dm/sky";
import { bringBackTakenRows, takeBackTurnChanges, turnChangeWarnings, turnRevertRefusal } from "@/lib/dm/turn-revert";
import { publishPersisted } from "@/lib/events";
import { revertAuditEntry, undoConflictWarnings } from "@/lib/sheet-undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  turnId: z.string().min(1).max(80),
  confirm: z.boolean().optional(),
});

// Party lead reverts every live sheet change from one DM turn, newest
// first, so each field lands back on its pre-turn value, and puts back what
// the turn changed on the clock (issue #622). It takes back what else the
// turn kept for it (issue 685, src/lib/db/turn-changes.ts): the fight and the
// board as the turn found them (hit points, conditions, creatures it brought
// in, tokens, areas, effects, the order of turns), the creatures it called
// up, a prepared fight's event it fired (armed again), the test dice it
// spent, a card the GM resolved in it, and every other row the turn wrote
// (src/lib/db/turn-journal.ts): the floor and the scene, the party's place,
// an NPC, a bond, a quest, a whisper, a companion who joined or left, a
// disease, the weather. A fight the turn ended is opened again; a turn that
// ended a fight with another on since is refused, saying why (WAVE1
// maintainer decisions on LC-REV-11, LC-REV-12 and LC-REV-13: "a revert takes
// back afflictions, scene trackers, location and party moves, and a turn
// that ended a fight reopens it (or refuses with a sentence saying why it
// cannot, if reopening is unsafe)"). The transcript stays: what was said was
// said.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid revert request." }, { status: 400 });
  }
  const { turnId, confirm } = parsed.data;

  // Only a turn this table played. Rows once filed under a made-up turn
  // ("clock", issue #622) gathered changes from the whole campaign, and a
  // revert of it undid them all at once.
  const turn = getDmTurn(turnId);
  if (!turn || turn.campaignId !== campaignId) {
    return Response.json({ error: "That is not a GM turn of this table." }, { status: 400 });
  }
  if (turnStillPlaying(campaignId, turn)) {
    return Response.json(
      { error: "That turn is still being played. Revert it once it is done, or stop it first." },
      { status: 409 },
    );
  }
  // Past the window the rows a revert puts the fight back from are gone
  // (src/lib/db/turn-rows.ts REVERT_WINDOW_TURNS): half a revert is refused.
  const reach = revertWindowStart(campaignId);
  if (reach && turn.createdAt < reach) {
    return Response.json(
      { error: `That turn is too far back to revert: a table's last ${REVERT_WINDOW_TURNS} GM turns can be. Rewinding the chapter takes older ones back.` },
      { status: 400 },
    );
  }

  const entries = listAuditForTurn(campaignId, turnId).filter(
    (entry) => entry.undoable && entry.kind !== "undo",
  );
  const clock = previewTurnClockRewind(campaignId, turnId);
  const changes = liveTurnChanges(campaignId, turnId);
  const rows = turnHasKeptRows(turnId);
  if (!entries.length && !clock && !changes.length && !rows) {
    return Response.json({ error: "Nothing left to revert for that turn." }, { status: 400 });
  }
  const refusal = rows ? turnRevertRefusal(turnId) : null;
  if (refusal) {
    return Response.json({ error: refusal }, { status: 400 });
  }

  // Changes recorded after this turn conflict; changes inside it are being
  // reverted anyway, so they are ignored. A clock moved again since stays
  // where it is, and the lead is told before saying yes.
  const warnings = entries.flatMap((entry) => undoConflictWarnings(entry, turnId));
  if (clock && "kept" in clock) {
    warnings.push(
      `The clock has moved since this turn; it stays at ${describeInstant(clock.kept.calendar, clock.kept.instant)}.`,
    );
  }
  warnings.push(...turnChangeWarnings(context.campaign, turnId, changes, seesStorytellerSecrets(context)));
  if (warnings.length && !confirm) {
    return Response.json({ warnings: [...new Set(warnings)] }, { status: 409 });
  }

  // One transaction: a step that fails leaves the table as it was, rather
  // than its sheets put back, its events armed again and its test dice given
  // back, with the revert still offered (and the dice given back twice).
  const outcome = getDatabase().transaction(() => {
    // A creature the turn sent away comes back first, so its sheet's own
    // changes can be put back on it.
    if (rows) {
      bringBackTakenRows(context.campaign, turnId);
    }
    const errors: string[] = [];
    // One ledger row per AI change reverted, each in its own undo's transaction.
    const corrections: string[] = [];
    for (const entry of [...entries].sort((a, b) => b.seq - a.seq)) {
      const undone = revertAuditEntry(context.campaign, entry, { userId: context.user.id, kind: "turn_revert" });
      if (!undone.ok) {
        errors.push(undone.error);
      } else if (undone.correctionId) {
        corrections.push(undone.correctionId);
      }
    }
    if (entries.length && errors.length === entries.length && !clock && !changes.length && !rows) {
      return Response.json({ error: errors[0] }, { status: 400 });
    }
    // The turn's blows are taken back with the hit points they took: no
    // reaction may answer one again.
    forgetTurnHits(campaignId, turnId);
    // And a reaction the turn took puts the hit it answered back as it was,
    // open to be answered again (the refund and the spend are its audit rows).
    forgetTurnAnswers(campaignId, turnId);
    forgetTurnItemCasts(campaignId, turnId);
    // After the sheets, so what their undo wrote to the clock (a long rest
    // forgotten) is kept, and before the turn's rows are marked taken back:
    // the clock as the turn found it is read from them (clock.ts).
    const rewound = rewindTurnClock(campaignId, turnId);
    if (rewound) {
      const now = "restored" in rewound ? rewound.restored : rewound.kept;
      // `reverted`: the event log stops offering this turn's time back.
      publishPersisted(campaignId, "clock_changed", { clock: now, reverted: turnId });
      // The status bar's hour and the sky read the scene state.
      const campaign = getCampaignById(campaignId);
      if (campaign) {
        publishSceneState(campaignId, currentScene(campaign));
      }
    }
    // After the sheets too: the fight's events, the test dice, the cards.
    const takenBack = changes.length || rows ? takeBackTurnChanges(context.campaign, turnId, changes) : 0;
    if (takenBack) {
      // `reverted`: the event log stops offering what the turn kept.
      publishPersisted(campaignId, "turn_changed", { reverted: turnId });
    }
    // The test fight's turn trace reads the turn as taken back from here on.
    markDmTurnReverted(turnId);
    return {
      ok: true,
      reverted: entries.length - errors.length,
      ...(rewound ? { clock: "restored" in rewound ? "restored" : "kept" } : {}),
      ...(takenBack ? { takenBack } : {}),
      ...correctionsField(corrections),
    };
  })();
  return outcome instanceof Response ? outcome : Response.json(outcome);
}
