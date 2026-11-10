import { allocateSeq } from "@/lib/db/campaigns";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { publishPersisted } from "@/lib/events";

// What a GM turn changed beyond the sheets and the clock, kept under the turn
// so "Revert this turn" takes it back with them (issue 685). The sheet audit
// (sheet-audit.ts) and the clock's moves (clock-moves.ts) keep the rest; the
// revert route reads all three.
//
//   - fight: the turn wrote rows of the fight or the board
//     (src/lib/db/turn-rows.ts keeps them, one row each, as the turn found
//     them); one per turn, what makes the event log offer its revert.
//   - story: the turn wrote rows outside the fight (the scene, an NPC, a
//     quest, a pet on a sheet no audit row names; src/lib/db/turn-journal.ts
//     keeps them); one per turn, written when the turn's work is done.
//   - fight_event: a prepared fight's event that fired, its line and the
//     GM's note of what it could not do (src/lib/dm/fight-event-undo.ts arms
//     it again; what it did is the turn's fight rows).
//   - summon: a creature a spell called up in the turn, sent away by the
//     revert (one sent away in the turn comes back through the fight rows,
//     kept whole). Bookkeeping, never shown.
//   - dice_face: a forced face a test table's dice script spent, and where
//     it stood in the queue; dice_seed: how far the turn ran the seed
//     (src/lib/db/dice-scripts.ts gives them back, so a replay rolls the same).
//   - card: a player's card the GM resolved as played (src/lib/dm/
//     resolve-card.ts puts it back in "Waiting on you").
//   - ledger: what one call paid in the turn, so the same call sent again in
//     it is answered with the first payout (src/lib/dm/turn-marks.ts; a
//     treasure roll). Bookkeeping, never shown; taken back with the turn, so
//     the call pays again once its payout is reverted.
//
// A row is written only under a turn: work outside every turn is nobody's to
// revert.

export type TurnChangeKind = "fight" | "story" | "fight_event" | "dice_face" | "dice_seed" | "card" | "summon" | "cue" | "ledger";

export type TurnChange = {
  id: string;
  campaignId: string;
  turnId: string;
  kind: TurnChangeKind;
  payload: Record<string, unknown>;
  seq: number;
  createdAt: string;
};

// What the event log shows of one, and counts toward the turn's revert. An
// empty line counts without a row of its own (a seed's run of dice).
export type TurnChangeView = { id: string; turnId: string; seq: number; kind: TurnChangeKind; line: string };

type Row = {
  id: string;
  campaign_id: string;
  turn_id: string;
  kind: string;
  payload_json: string;
  seq: number;
  created_at: string;
};

const KINDS: readonly TurnChangeKind[] = ["fight", "story", "fight_event", "dice_face", "dice_seed", "card", "summon", "cue", "ledger"];

// Kept for the revert, never shown or counted in the event log: a creature
// a spell called up, the prepared fight whose cue the turn spent, a call's
// payout.
const BOOKKEEPING: readonly TurnChangeKind[] = ["summon", "cue", "ledger"];

function mapRow(row: Row): TurnChange | null {
  const kind = KINDS.find((entry) => entry === row.kind);
  if (!kind) {
    return null;
  }
  return {
    id: row.id,
    campaignId: row.campaign_id,
    turnId: row.turn_id,
    kind,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    seq: row.seq,
    createdAt: row.created_at,
  };
}

function lineOf(change: TurnChange): string {
  const line = change.payload.line;
  return typeof line === "string" ? line : "";
}

export function viewOf(change: TurnChange): TurnChangeView {
  return { id: change.id, turnId: change.turnId, seq: change.seq, kind: change.kind, line: lineOf(change) };
}

// Writes the change and tells the table's event log, which offers the turn's
// revert from then on.
export function recordTurnChange(campaignId: string, turnId: string, kind: TurnChangeKind, payload: Record<string, unknown>): TurnChange {
  const id = crypto.randomUUID();
  const seq = allocateSeq(campaignId);
  getDatabase()
    .prepare(
      `INSERT INTO turn_changes (id, campaign_id, turn_id, kind, payload_json, seq, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, campaignId, turnId, kind, JSON.stringify(payload), seq, nowIso());
  const change: TurnChange = { id, campaignId, turnId, kind, payload, seq, createdAt: nowIso() };
  if (!BOOKKEEPING.includes(kind)) {
    publishPersisted(campaignId, "turn_changed", { change: viewOf(change) });
  }
  return change;
}

export function updateTurnChange(id: string, payload: Record<string, unknown>) {
  getDatabase().prepare(`UPDATE turn_changes SET payload_json = ? WHERE id = ?`).run(JSON.stringify(payload), id);
}

// The turn's changes not yet taken back, oldest first.
export function liveTurnChanges(campaignId: string, turnId: string): TurnChange[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM turn_changes WHERE campaign_id = ? AND turn_id = ? AND reverted_at IS NULL ORDER BY rowid ASC`)
    .all(campaignId, turnId) as Row[];
  return rows.map(mapRow).filter((change): change is TurnChange => change !== null);
}

export function liveTurnChangeOf(campaignId: string, turnId: string, kind: TurnChangeKind): TurnChange | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM turn_changes WHERE campaign_id = ? AND turn_id = ? AND kind = ? AND reverted_at IS NULL ORDER BY rowid DESC LIMIT 1`,
    )
    .get(campaignId, turnId, kind) as Row | undefined;
  return row ? mapRow(row) : null;
}

// A card's live changes, across every turn its calls ran in.
export function liveCardChanges(campaignId: string, messageId: string): TurnChange[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM turn_changes WHERE campaign_id = ? AND kind = 'card' AND reverted_at IS NULL
         AND json_extract(payload_json, '$.messageId') = ? ORDER BY rowid ASC`,
    )
    .all(campaignId, messageId) as Row[];
  return rows.map(mapRow).filter((change): change is TurnChange => change !== null);
}

export function markTurnChangesReverted(ids: readonly string[]) {
  const db = getDatabase();
  const mark = db.prepare(`UPDATE turn_changes SET reverted_at = ? WHERE id = ?`);
  const at = nowIso();
  db.transaction(() => {
    for (const id of ids) {
      mark.run(at, id);
    }
  })();
}

// The newest live changes, oldest first, for the event log (the campaign
// snapshot's turnChanges).
export function listLiveTurnChangeViews(campaignId: string, limit = 50): TurnChangeView[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM turn_changes WHERE campaign_id = ? AND reverted_at IS NULL AND kind NOT IN ('summon', 'cue', 'ledger') ORDER BY rowid DESC LIMIT ?`)
    .all(campaignId, limit) as Row[];
  return rows
    .reverse()
    .map(mapRow)
    .filter((change): change is TurnChange => change !== null && !BOOKKEEPING.includes(change.kind))
    .map(viewOf);
}
