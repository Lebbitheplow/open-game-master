import { allocateSeq } from "@/lib/db/campaigns";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { publishPersisted } from "@/lib/events";

// What a GM turn changed beyond the sheets and the clock, kept under the turn
// so "Revert this turn" takes it back with them (issue 685). The sheet audit
// (sheet-audit.ts) and the clock's moves (clock-moves.ts) keep the rest; the
// revert route reads all three.
//
//   - fight_event: a prepared fight's event that fired, with what it did
//     (src/lib/dm/fight-event-undo.ts takes it back and arms it again).
//   - dice_face: a forced face a test table's dice script spent, and where
//     it stood in the queue; dice_seed: how far the turn ran the seed
//     (src/lib/db/dice-scripts.ts gives them back, so a replay rolls the same).
//   - card: a player's card the GM resolved as played (src/lib/dm/
//     resolve-card.ts puts it back in "Waiting on you").
//   - budget: the action economy the turn spent in a fight
//     (src/lib/db/spent-budget.ts), given back while the fight is still on
//     that turn. Bookkeeping: it rides along with the turn's other changes,
//     and alone it does not make a turn the event log offers to revert.
//
// A row is written only under a turn: work outside every turn is nobody's to
// revert.

export type TurnChangeKind = "fight_event" | "dice_face" | "dice_seed" | "card" | "budget";

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

const KINDS: readonly TurnChangeKind[] = ["fight_event", "dice_face", "dice_seed", "card", "budget"];

// Kept for the revert, never shown or counted in the event log.
const BOOKKEEPING: readonly TurnChangeKind[] = ["budget"];

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
    .prepare(`SELECT * FROM turn_changes WHERE campaign_id = ? AND reverted_at IS NULL AND kind NOT IN ('budget') ORDER BY rowid DESC LIMIT ?`)
    .all(campaignId, limit) as Row[];
  return rows
    .reverse()
    .map(mapRow)
    .filter((change): change is TurnChange => change !== null && !BOOKKEEPING.includes(change.kind))
    .map(viewOf);
}
