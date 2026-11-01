import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { listLiveTurnChangeViews, liveTurnChangeOf, recordTurnChange, type TurnChangeView } from "@/lib/db/turn-changes";
import { currentTurnId, onTurnWorkDone } from "@/lib/dm/job-control";
import { fightLine } from "@/lib/dm/turn-rows-logic";

// The fight and the board as a GM turn found them, row by row, so "Revert
// this turn" puts back what the turn's own calls did there (issue 685): an
// enemy's hit points, conditions, standing and initiative, the creatures
// the turn brought in, the fight's order, round and the action, reactions
// and legendary actions spent, the tokens it moved or hid, the areas it laid
// on the board, the effects it started, the items it dropped. Before, the
// revert put back the sheets and the clock alone, and a boss felled in a
// reverted turn stayed down.
//
// The writers of those tables call keepRow just before they write (keepNew
// after they insert). Only the first write of a turn reads the row: a
// process-wide set remembers the rows each turn has kept, so a turn that
// writes a goblin twenty times reads it once. When the turn's work is done
// (job-control.ts turnWorkDone) each kept row is read once more as the turn
// left it, which is what tells a change made since. Work outside every turn
// keeps nothing. The rules of putting rows back: src/lib/dm/turn-rows-logic.ts.

export const KEPT_TABLES = ["encounters", "encounter_enemies", "battle_maps", "battle_tokens", "active_effects", "dropped_items"] as const;
export type KeptTable = (typeof KEPT_TABLES)[number];

export type Row = Record<string, unknown>;

export type KeptRow = {
  table: KeptTable;
  rowId: string;
  // Null: the turn made the row.
  before: Row | null;
  // As the turn left it: undefined before the turn's work was done, null
  // when the turn took the row away.
  after: Row | null | undefined;
};

declare global {
  // turn id -> "table:id" of every row it has kept.
  var __odmTurnRowsSeen: Map<string, Set<string>> | undefined;
}

// A bound keeps the memory flat; a turn forgotten here only reads its rows
// again, and the insert below keeps the first image.
function seenBy(turnId: string): Set<string> {
  const all = (globalThis.__odmTurnRowsSeen ??= new Map());
  let seen = all.get(turnId);
  if (!seen) {
    if (all.size >= 500) {
      all.clear();
    }
    seen = new Set();
    all.set(turnId, seen);
  }
  return seen;
}

function store(turnId: string, campaignId: string, table: KeptTable, rowId: string, before: Row | null) {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO turn_rows (campaign_id, turn_id, tbl, row_id, before_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(campaignId, turnId, table, rowId, before === null ? null : JSON.stringify(before), nowIso());
  // The turn's first fight change makes it one the event log offers to
  // revert, once per turn.
  const seen = seenBy(turnId);
  if (!seen.has("#fight")) {
    seen.add("#fight");
    if (!liveTurnChangeOf(campaignId, turnId, "fight")) {
      recordTurnChange(campaignId, turnId, "fight", { line: fightLine({}) });
    }
  }
}

// Before a write to one row.
export function keepRow(table: KeptTable, rowId: string) {
  const turnId = currentTurnId();
  if (!turnId) {
    return;
  }
  const seen = seenBy(turnId);
  const key = `${table}:${rowId}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  const row = getDatabase().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId) as Row | undefined;
  if (row && typeof row.campaign_id === "string") {
    store(turnId, row.campaign_id, table, rowId, row);
  }
}

// After an insert: the row is the turn's own, and its revert takes it away.
export function keepNew(table: KeptTable, rowId: string, campaignId: string) {
  const turnId = currentTurnId();
  if (!turnId) {
    return;
  }
  const seen = seenBy(turnId);
  const key = `${table}:${rowId}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  store(turnId, campaignId, table, rowId, null);
}

// Before a write to every row a condition picks (a round's movement reset, a
// token named by its creature). `where` is the writer's own fixed SQL.
export function keepRowsWhere(table: KeptTable, where: string, params: unknown[]) {
  const turnId = currentTurnId();
  if (!turnId) {
    return;
  }
  const seen = seenBy(turnId);
  const rows = getDatabase().prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params) as Row[];
  for (const row of rows) {
    const rowId = String(row.id ?? "");
    const key = `${table}:${rowId}`;
    if (!rowId || seen.has(key) || typeof row.campaign_id !== "string") {
      continue;
    }
    seen.add(key);
    store(turnId, row.campaign_id, table, rowId, row);
  }
}

export function readRow(table: KeptTable, rowId: string): Row | null {
  return (getDatabase().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId) as Row | undefined) ?? null;
}

// The turn's work is done: each row it kept, as it left it.
function seal(turnId: string) {
  const db = getDatabase();
  const rows = db.prepare(`SELECT tbl, row_id FROM turn_rows WHERE turn_id = ? AND reverted_at IS NULL`).all(turnId) as Array<{
    tbl: KeptTable;
    row_id: string;
  }>;
  if (!rows.length) {
    return;
  }
  const write = db.prepare(`UPDATE turn_rows SET after_json = ?, sealed = 1 WHERE turn_id = ? AND tbl = ? AND row_id = ?`);
  db.transaction(() => {
    for (const row of rows) {
      if (!(KEPT_TABLES as readonly string[]).includes(row.tbl)) {
        continue;
      }
      const now = readRow(row.tbl, row.row_id);
      write.run(now ? JSON.stringify(now) : null, turnId, row.tbl, row.row_id);
    }
  })();
}

onTurnWorkDone(seal);

export function listKeptRows(turnId: string): KeptRow[] {
  const rows = getDatabase()
    .prepare(`SELECT tbl, row_id, before_json, after_json, sealed FROM turn_rows WHERE turn_id = ? AND reverted_at IS NULL ORDER BY rowid ASC`)
    .all(turnId) as Array<{ tbl: string; row_id: string; before_json: string | null; after_json: string | null; sealed: number }>;
  return rows.flatMap((row) => {
    const table = KEPT_TABLES.find((entry) => entry === row.tbl);
    if (!table) {
      return [];
    }
    const before = row.before_json === null ? null : parseJson<Row | null>(row.before_json, null);
    const after = row.sealed ? (row.after_json === null ? null : parseJson<Row | null>(row.after_json, null)) : undefined;
    return [{ table, rowId: row.row_id, before, after }];
  });
}

// How many rows of each table the campaign's live turns kept, for the event
// log's line (counts only: a creature the GM keeps off the board is never
// named there).
export function keptCounts(campaignId: string): Map<string, Partial<Record<KeptTable, number>>> {
  const rows = getDatabase()
    .prepare(`SELECT turn_id, tbl, COUNT(*) AS n FROM turn_rows WHERE campaign_id = ? AND reverted_at IS NULL GROUP BY turn_id, tbl`)
    .all(campaignId) as Array<{ turn_id: string; tbl: KeptTable; n: number }>;
  const counts = new Map<string, Partial<Record<KeptTable, number>>>();
  for (const row of rows) {
    counts.set(row.turn_id, { ...(counts.get(row.turn_id) ?? {}), [row.tbl]: row.n });
  }
  return counts;
}

// What the event log lists of the campaign's live turns (the snapshot's
// turnChanges), each turn's fight changes read as counts.
export function listTurnChangeViews(campaignId: string): TurnChangeView[] {
  const views = listLiveTurnChangeViews(campaignId);
  if (!views.some((view) => view.kind === "fight")) {
    return views;
  }
  const counts = keptCounts(campaignId);
  return views.map((view) => (view.kind === "fight" ? { ...view, line: fightLine(counts.get(view.turnId) ?? {}) } : view));
}

export function markRowsReverted(turnId: string) {
  getDatabase().prepare(`UPDATE turn_rows SET reverted_at = ? WHERE turn_id = ? AND reverted_at IS NULL`).run(nowIso(), turnId);
}

// ---- writing rows back (the revert route, outside every turn) ----

function columnsOf(table: KeptTable): Set<string> {
  const columns = getDatabase().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(columns.map((column) => column.name));
}

// Sets the named columns from `values`; only columns the table has.
export function writeRow(table: KeptTable, rowId: string, values: Row) {
  const known = columnsOf(table);
  const columns = Object.keys(values).filter((column) => known.has(column) && column !== "id");
  if (!columns.length) {
    return;
  }
  const stamp = known.has("updated_at") && !columns.includes("updated_at") ? ", updated_at = ?" : "";
  getDatabase()
    .prepare(`UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(", ")}${stamp} WHERE id = ?`)
    .run(...columns.map((column) => values[column] as never), ...(stamp ? [nowIso()] : []), rowId);
}

// A row the turn took away, back as it was.
export function insertRow(table: KeptTable, row: Row) {
  const known = columnsOf(table);
  const columns = Object.keys(row).filter((column) => known.has(column));
  getDatabase()
    .prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...columns.map((column) => row[column] as never));
}

export function deleteRow(table: KeptTable, rowId: string) {
  getDatabase().prepare(`DELETE FROM ${table} WHERE id = ?`).run(rowId);
}
