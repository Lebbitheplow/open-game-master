import { correctionsField } from "@/lib/correction-reasons";
import { getCampaignById, releaseStaleFightFloor, type Campaign } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import { previewTurnClockRewind, rewindTurnClock } from "@/lib/db/clock";
import { getDmTurn, markDmTurnReverted } from "@/lib/db/dm-turns";
import { listAuditForTurn } from "@/lib/db/sheet-audit";
import { listSheets, patchSheet } from "@/lib/db/sheets";
import { regainedSettle } from "@/lib/dm/vitals-logic";
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
import { translate } from "@/lib/i18n/translate";

type T = (key: string, vars?: Record<string, string | number>) => string;
const enT: T = (key, vars) => translate("en", key, vars);

// "Revert this turn" (the event log, src/app/api/campaigns/[campaignId]/audit/revert-turn/route.ts)
// and "Take back and rewrite" (a player's newest move, src/lib/dm/take-back.ts)
// share this: every live sheet change from one DM turn reverted newest
// first, so each field lands back on its pre-turn value, the clock put back
// (issue #622), and what else the turn kept taken back (issue 685,
// src/lib/db/turn-changes.ts and src/lib/db/turn-journal.ts). Without
// `confirm`, a revert that would clash with newer changes answers with the
// warnings for the lead to read first.
export type TurnRevertResult =
  | { ok: true; reverted: number; clock?: "restored" | "kept"; takenBack?: number; corrections?: string[] }
  // `nothingToRevert`: the turn changed nothing a revert could put back.
  | { ok: false; status: 400 | 409; error: string; nothingToRevert?: true }
  | { ok: false; status: 409; warnings: string[] };

export function runTurnRevert(
  campaign: Campaign,
  userId: string,
  turnId: string,
  // `t`: the asker's language for the refusals the event log shows raw
  // (revert-turn/route.ts); English when no route passes one.
  options: { confirm?: boolean; seesSecrets: boolean; t?: T },
): TurnRevertResult {
  const campaignId = campaign.id;
  const t = options.t ?? enT;
  // Only a turn this table played. Rows once filed under a made-up turn
  // ("clock", issue #622) gathered changes from the whole campaign, and a
  // revert of it undid them all at once.
  const turn = getDmTurn(turnId);
  if (!turn || turn.campaignId !== campaignId) {
    return { ok: false, status: 400, error: t("That is not a GM turn of this table.") };
  }
  if (turnStillPlaying(campaignId, turn)) {
    return { ok: false, status: 409, error: t("That turn is still being played. Revert it once it is done, or stop it first.") };
  }
  // Past the window the rows a revert puts the fight back from are gone
  // (src/lib/db/turn-rows.ts REVERT_WINDOW_TURNS): half a revert is refused.
  const reach = revertWindowStart(campaignId);
  if (reach && turn.createdAt < reach) {
    return {
      ok: false,
      status: 400,
      error: t("That turn is too far back to revert: a table's last {count} GM turns can be. Rewinding the chapter takes older ones back.", { count: REVERT_WINDOW_TURNS }),
    };
  }

  const entries = listAuditForTurn(campaignId, turnId).filter(
    (entry) => entry.undoable && entry.kind !== "undo",
  );
  const clock = previewTurnClockRewind(campaignId, turnId);
  const changes = liveTurnChanges(campaignId, turnId);
  const rows = turnHasKeptRows(turnId);
  if (!entries.length && !clock && !changes.length && !rows) {
    return { ok: false, status: 400, error: t("Nothing left to revert for that turn."), nothingToRevert: true };
  }
  const refusal = rows ? turnRevertRefusal(turnId) : null;
  if (refusal) {
    return { ok: false, status: 400, error: refusal };
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
  warnings.push(...turnChangeWarnings(campaign, turnId, changes, options.seesSecrets));
  if (warnings.length && !options.confirm) {
    return { ok: false, status: 409, warnings: [...new Set(warnings)] };
  }

  // One transaction: a step that fails leaves the table as it was, rather
  // than its sheets put back, its events armed again and its test dice given
  // back, with the revert still offered (and the dice given back twice).
  return getDatabase().transaction((): TurnRevertResult => {
    // A creature the turn sent away comes back first, so its sheet's own
    // changes can be put back on it.
    if (rows) {
      bringBackTakenRows(campaign, turnId);
    }
    const errors: string[] = [];
    // One ledger row per AI change reverted, each in its own undo's transaction.
    const corrections: string[] = [];
    for (const entry of [...entries].sort((a, b) => b.seq - a.seq)) {
      const undone = revertAuditEntry(campaign, entry, { userId: userId, kind: "turn_revert" });
      if (!undone.ok) {
        errors.push(undone.error);
      } else if (undone.correctionId) {
        corrections.push(undone.correctionId);
      }
    }
    if (entries.length && errors.length === entries.length && !clock && !changes.length && !rows) {
      return { ok: false, status: 400, error: errors[0] };
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
      const fresh = getCampaignById(campaignId);
      if (fresh) {
        publishSceneState(campaignId, currentScene(fresh));
      }
    }
    // After the sheets too: the fight's events, the test dice, the cards.
    const takenBack = changes.length || rows ? takeBackTurnChanges(campaign, turnId, changes) : 0;
    if (takenBack) {
      // `reverted`: the event log stops offering what the turn kept.
      publishPersisted(campaignId, "turn_changed", { reverted: turnId });
    }
    // A sheet whose hit points came back with its row, its death-save track
    // left from another turn, ends the dying it no longer has (issue 968,
    // vitals-logic.ts regainedSettle): the rows are written as they stood,
    // past the rule patchSheet keeps.
    for (const sheet of listSheets(campaignId)) {
      const settled = regainedSettle(sheet);
      if (settled) {
        const healed = patchSheet(sheet.id, settled, { restoring: true });
        if (healed) {
          publishPersisted(campaignId, "sheet_updated", { sheet: healed });
        }
      }
    }
    // A floor left naming a fight that is not on (a table an older revert
    // left so, issue 968) goes to what the table holds now.
    const released = releaseStaleFightFloor(campaignId);
    if (released) {
      publishPersisted(campaignId, "floor_changed", { floor: released });
    }
    // The test fight's turn trace reads the turn as taken back from here on.
    markDmTurnReverted(turnId);
    return {
      ok: true as const,
      reverted: entries.length - errors.length,
      ...(rewound ? { clock: "restored" in rewound ? "restored" : "kept" } : {}),
      ...(takenBack ? { takenBack } : {}),
      ...correctionsField(corrections),
    };
  })();

}
