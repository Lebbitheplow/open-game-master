import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { correctionsField } from "@/lib/correction-reasons";
import { getCampaignById } from "@/lib/db/campaigns";
import { previewTurnClockRewind, rewindTurnClock } from "@/lib/db/clock";
import { getDmTurn, markDmTurnReverted } from "@/lib/db/dm-turns";
import { listAuditForTurn } from "@/lib/db/sheet-audit";
import { liveTurnChanges } from "@/lib/db/turn-changes";
import { REVERT_WINDOW_TURNS, revertWindowStart } from "@/lib/db/turn-rows";
import { describeInstant } from "@/lib/dm/calendar";
import { publishSceneState } from "@/lib/dm/scene-state";
import { currentScene } from "@/lib/dm/sky";
import { bringBackTakenRows, takeBackTurnChanges, turnChangeWarnings } from "@/lib/dm/turn-revert";
import { publishPersisted } from "@/lib/events";
import { revertAuditEntry, undoConflictWarnings } from "@/lib/sheet-undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  turnId: z.string().min(1).max(80),
  confirm: z.boolean().optional(),
});

// Party lead reverts every live sheet change from one DM turn, newest
// first, so each field lands back on its pre-turn value, and puts back the
// time the turn moved the clock on (issue #622). It takes back what else the
// turn kept for it (issue 685, src/lib/db/turn-changes.ts): the fight and the
// board as the turn found them (hit points, conditions, creatures it brought
// in, tokens, areas, effects, the order of turns), the creatures it called
// up, a prepared fight's event it fired (armed again), the test dice it
// spent, a card the GM resolved in it. World events and a companion's leaving
// stay: the chapter rewind is what takes those back.
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
  if (!entries.length && !clock && !changes.length) {
    return Response.json({ error: "Nothing left to revert for that turn." }, { status: 400 });
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
  warnings.push(...turnChangeWarnings(context.campaign, turnId, changes));
  if (warnings.length && !confirm) {
    return Response.json({ warnings: [...new Set(warnings)] }, { status: 409 });
  }

  // A creature the turn sent away comes back first, so its sheet's own
  // changes can be put back on it.
  if (changes.length) {
    bringBackTakenRows(context.campaign, turnId);
  }
  const errors: string[] = [];
  // One ledger row per AI change reverted, each in its own undo's transaction.
  const corrections: string[] = [];
  for (const entry of [...entries].sort((a, b) => b.seq - a.seq)) {
    const outcome = revertAuditEntry(context.campaign, entry, { userId: context.user.id, kind: "turn_revert" });
    if (!outcome.ok) {
      errors.push(outcome.error);
    } else if (outcome.correctionId) {
      corrections.push(outcome.correctionId);
    }
  }
  if (entries.length && errors.length === entries.length && !clock && !changes.length) {
    return Response.json({ error: errors[0] }, { status: 400 });
  }
  // After the sheets too: the fight's events, the test dice, the cards.
  const takenBack = changes.length ? takeBackTurnChanges(context.campaign, turnId, changes) : 0;
  if (takenBack) {
    // `reverted`: the event log stops offering what the turn kept.
    publishPersisted(campaignId, "turn_changed", { reverted: turnId });
  }
  // After the sheets, so what their undo wrote to the clock (a long rest
  // forgotten) is kept.
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
  // The test fight's turn trace reads the turn as taken back from here on.
  markDmTurnReverted(turnId);
  return Response.json({
    ok: true,
    reverted: entries.length - errors.length,
    ...(rewound ? { clock: "restored" in rewound ? "restored" : "kept" } : {}),
    ...(takenBack ? { takenBack } : {}),
    ...correctionsField(corrections),
  });
}
