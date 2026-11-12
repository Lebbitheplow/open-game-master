import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { forgetTurnClockMoves } from "@/lib/db/clock-moves";
import { unfileTurnAudit } from "@/lib/db/sheet-audit";
import { listLiveTurnChangeViews, liveTurnChangeOf, markTurnChangesReverted, recordTurnChange, updateTurnChange, viewOf, type TurnChangeView } from "@/lib/db/turn-changes";
import { currentTurnId, onTurnWorkDone } from "@/lib/dm/job-control";
import { fightLine, isFightTable, storyLine, turnColumns, unchangedByTurn } from "@/lib/dm/turn-rows-logic";
import { publishPersisted } from "@/lib/events";

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
//
// A delete that takes other rows with it (a summoned creature sent away: its
// bot user, and its sheet with it) keeps every row the database removes
// (keepWithCascade), whole, so the revert brings the creature back as it was.
//
// Every other table a turn writes is kept here too, by the database's own
// triggers (src/lib/db/turn-journal.ts), whatever code wrote it: the calls
// below stay for the fight's writers, which also mark the turn as one with a
// fight change the moment they write.

// Any table a kept row is from: the fight's own (turn-rows-logic.ts
// FIGHT_TABLES), or one a cascade reached.
export type KeptTable = string;

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
  // turn id -> "table:key" of every row it has kept.
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

// ---- the database's own shape: tables, keys, cascades (read once) ----

let tables: Set<string> | null = null;
const keys = new Map<string, string[]>();
const cascades = new Map<string, Array<{ child: string; from: string; to: string }>>();

function tableNames(): Set<string> {
  tables ??= new Set(
    (getDatabase().prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  return tables;
}

function primaryKey(table: string): string[] {
  let key = keys.get(table);
  if (!key) {
    const columns = getDatabase().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>;
    key = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    keys.set(table, key);
  }
  return key;
}

// A row's key as turn_rows stores it: its id, or its key columns' values.
function keyOf(table: string, row: Row): string | null {
  const key = primaryKey(table);
  if (!key.length) {
    return null;
  }
  return key.length === 1 ? String(row[key[0]] ?? "") : JSON.stringify(key.map((column) => row[column] ?? null));
}

function whereKey(table: string, rowId: string): { sql: string; params: unknown[] } {
  const key = primaryKey(table);
  if (key.length === 1) {
    return { sql: `${key[0]} = ?`, params: [rowId] };
  }
  const values = parseJson<unknown[]>(rowId, []);
  return { sql: key.map((column) => `${column} = ?`).join(" AND "), params: key.map((_, index) => values[index] ?? null) };
}

// The tables whose rows go when a row of `table` is deleted (ON DELETE
// CASCADE), and by which columns.
function cascadeChildren(table: string) {
  let found = cascades.get(table);
  if (!found) {
    found = [];
    for (const child of tableNames()) {
      const links = getDatabase().prepare(`PRAGMA foreign_key_list(${child})`).all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
      for (const link of links) {
        if (link.table === table && link.on_delete.toUpperCase() === "CASCADE") {
          found.push({ child, from: link.from, to: link.to });
        }
      }
    }
    cascades.set(table, found);
  }
  return found;
}

// ---- keeping ----

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
  const mark = `${table}:${rowId}`;
  if (seen.has(mark)) {
    return;
  }
  seen.add(mark);
  const row = readRow(table, rowId);
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
  const mark = `${table}:${rowId}`;
  if (seen.has(mark)) {
    return;
  }
  seen.add(mark);
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
    const rowId = keyOf(table, row);
    if (!rowId || seen.has(`${table}:${rowId}`) || typeof row.campaign_id !== "string") {
      continue;
    }
    seen.add(`${table}:${rowId}`);
    store(turnId, row.campaign_id, table, rowId, row);
  }
}

// Before a delete the database carries on through its cascades: the row and
// every row it takes with it, each as the turn found it.
export function keepWithCascade(table: KeptTable, rowId: string, campaignId: string) {
  const turnId = currentTurnId();
  if (!turnId) {
    return;
  }
  const seen = seenBy(turnId);
  const db = getDatabase();
  const visit = (from: string, row: Row) => {
    const key = keyOf(from, row);
    if (key === null || seen.has(`${from}:${key}`)) {
      return;
    }
    seen.add(`${from}:${key}`);
    store(turnId, campaignId, from, key, row);
    for (const link of cascadeChildren(from)) {
      for (const child of db.prepare(`SELECT * FROM ${link.child} WHERE ${link.from} = ?`).all(row[link.to] as never) as Row[]) {
        visit(link.child, child);
      }
    }
  };
  const row = readRow(table, rowId);
  if (row) {
    visit(table, row);
  }
}

export function readRow(table: KeptTable, rowId: string): Row | null {
  if (!tableNames().has(table)) {
    return null;
  }
  const key = whereKey(table, rowId);
  return (getDatabase().prepare(`SELECT * FROM ${table} WHERE ${key.sql}`).get(...(key.params as never[])) as Row | undefined) ?? null;
}

// ---- when a turn's work is done ----

// Each row the turn kept, as it left it.
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
  const before = db.prepare(`SELECT before_json FROM turn_rows WHERE turn_id = ? AND tbl = ? AND row_id = ?`);
  const letGo = db.prepare(`DELETE FROM turn_rows WHERE turn_id = ? AND tbl = ? AND row_id = ?`);
  db.transaction(() => {
    for (const row of rows) {
      const now = readRow(row.tbl, row.row_id);
      // A row of another table the turn left as it found it (a scene line
      // written with the same words, a sheet whose change was taken back
      // within the turn) has nothing to revert: the journal lets it go, so
      // the turn offers no revert for it.
      if (!isFightTable(row.tbl)) {
        const was = before.get(turnId, row.tbl, row.row_id) as { before_json: string | null } | undefined;
        if (unchangedByTurn(row.tbl, was?.before_json ? parseJson<Row | null>(was.before_json, null) : null, now)) {
          letGo.run(turnId, row.tbl, row.row_id);
          continue;
        }
      }
      write.run(now ? JSON.stringify(now) : null, turnId, row.tbl, row.row_id);
    }
  })();
}

// How far back "Revert this turn" reaches: the table's newest
// REVERT_WINDOW_TURNS GM turns. The route had no window of its own, nor had
// the sheet audit or the clock's moves, so the rows kept for a revert grew
// with every turn a table ever played. Two hundred turns is several sessions
// at a table the AI runs and a long session at one a person runs (each
// console call is a turn), and well past what the event log lists (its last
// fifty changes). Past it the route refuses, rather than put back a turn's
// sheets without the fight its rows no longer hold. The sheet audit is not
// pruned with it: a single change's undo, the sheet history and a fight's
// summary read its rows whatever turn wrote them.
export const REVERT_WINDOW_TURNS = 200;

// When the oldest turn still in reach began, or null while the table has
// played fewer turns than the window holds.
export function revertWindowStart(campaignId: string): string | null {
  const row = getDatabase()
    // A stand-in opened inside another turn (a fired event's, a zone's) is
    // part of that turn, never one of its own to revert: counted, every
    // event and opportunity strike shortened the window.
    .prepare(`SELECT created_at FROM dm_turns WHERE campaign_id = ? AND owner_turn_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1 OFFSET ?`)
    .get(campaignId, REVERT_WINDOW_TURNS - 1) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

// The kept rows and changes of turns out of reach go. A row is kept no
// earlier than its turn began, so one kept before the window's oldest turn
// began is an older turn's. Two indexed reads when there is nothing to drop.
export function pruneOutOfReach(campaignId: string) {
  const start = revertWindowStart(campaignId);
  if (!start) {
    return;
  }
  const db = getDatabase();
  db.prepare(`DELETE FROM turn_rows WHERE campaign_id = ? AND created_at < ?`).run(campaignId, start);
  db.prepare(`DELETE FROM turn_changes WHERE campaign_id = ? AND created_at < ?`).run(campaignId, start);
}

declare global {
  var __odmPruneHeld: Set<string> | undefined;
}

const pruneHeld = () => (globalThis.__odmPruneHeld ??= new Set<string>());

// A turn opened in case it has something to take back (fight-events.ts
// asEventTurn) prunes once its opener knows whether it stays: counted while
// it waited to be dissolved, it pushed the oldest turn still in reach out of
// the window, rows and all, though the route still offered its revert.
export function holdPrune(turnId: string) {
  pruneHeld().add(turnId);
}

export function releasePrune(campaignId: string, turnId: string) {
  pruneHeld().delete(turnId);
  pruneOutOfReach(campaignId);
}

function turnDone(turnId: string) {
  seal(turnId);
  const turn = getDatabase().prepare(`SELECT campaign_id FROM dm_turns WHERE id = ?`).get(turnId) as { campaign_id: string } | undefined;
  if (turn) {
    tellFightLine(turn.campaign_id, turnId);
    tellStoryLine(turn.campaign_id, turnId);
    if (!pruneHeld().has(turnId)) {
      pruneOutOfReach(turn.campaign_id);
    }
  }
}

// A kept row of a creature or token the table cannot see. The event log's
// line goes to every seat, so it counts only what they can see: "1 creature"
// told the players that a hidden one had been touched.
const VISIBLE = `NOT EXISTS (SELECT 1 FROM battle_tokens t WHERE t.hidden = 1 AND (t.id = turn_rows.row_id OR t.ref_id = turn_rows.row_id))`;

// How many rows of each table one turn keeps (`seen`: only those of what the
// table can see, for the line it reads).
function turnCounts(turnId: string, seen = false): Partial<Record<KeptTable, number>> {
  const rows = getDatabase()
    .prepare(`SELECT tbl, COUNT(*) AS n FROM turn_rows WHERE turn_id = ? AND reverted_at IS NULL${seen ? ` AND ${VISIBLE}` : ""} GROUP BY tbl`)
    .all(turnId) as Array<{ tbl: KeptTable; n: number }>;
  // The fight's tables: the rest are the story line's.
  return Object.fromEntries(rows.filter((row) => isFightTable(row.tbl)).map((row) => [row.tbl, row.n]));
}

// The event log hears a turn's fight change when its first row is kept, as
// "The fight changes.", and only a reload read what it came to: a GM
// watching the log saw every console call so. Once the turn's work is done
// the line says what it changed, and the table is told.
function tellFightLine(campaignId: string, turnId: string) {
  const change = liveTurnChangeOf(campaignId, turnId, "fight");
  if (!change) {
    // Rows of the fight the journal kept from a writer that never called
    // keepRow: the turn still offers their revert.
    if (Object.keys(turnCounts(turnId)).length) {
      recordTurnChange(campaignId, turnId, "fight", { line: fightLine(turnCounts(turnId, true)) });
    }
    return;
  }
  const line = fightLine(turnCounts(turnId, true));
  if (line === change.payload.line) {
    return;
  }
  updateTurnChange(change.id, { ...change.payload, line });
  publishPersisted(campaignId, "turn_changed", { change: { ...viewOf(change), line } });
}

// What a turn changed outside the fight, by table, for the event log's line:
// a sheet only when no audit row of the turn names its character (the audit
// lists its own lines), and the campaign row only for more than the clock
// (the clock's moves list theirs).
function storyCounts(turnId: string): Partial<Record<KeptTable, number>> {
  const audited = new Set(
    (getDatabase().prepare(`SELECT DISTINCT character_id FROM sheet_audit WHERE turn_id = ?`).all(turnId) as Array<{ character_id: string }>).map(
      (row) => row.character_id,
    ),
  );
  const counts: Partial<Record<KeptTable, number>> = {};
  for (const row of listKeptRows(turnId)) {
    if (isFightTable(row.table)) {
      continue;
    }
    if (row.table === "character_sheets" && audited.has(row.rowId)) {
      continue;
    }
    if (row.before && row.after && !turnColumns(row.table, row.before, row.after).length) {
      continue;
    }
    counts[row.table] = (counts[row.table] ?? 0) + 1;
  }
  return counts;
}

// The turn's "story" change: written once its work is done, kept in step
// with what it still holds, gone when it holds nothing.
function tellStoryLine(campaignId: string, turnId: string) {
  const line = storyLine(storyCounts(turnId));
  const change = liveTurnChangeOf(campaignId, turnId, "story");
  if (!line) {
    if (change) {
      markTurnChangesReverted([change.id]);
      publishPersisted(campaignId, "turn_changed", { removed: change.id });
    }
    return;
  }
  if (!change) {
    recordTurnChange(campaignId, turnId, "story", { line });
    return;
  }
  if (line !== change.payload.line) {
    updateTurnChange(change.id, { ...change.payload, line });
    publishPersisted(campaignId, "turn_changed", { change: { ...viewOf(change), line } });
  }
}

// Whether the turn still holds rows a revert would write.
export function turnHasKeptRows(turnId: string): boolean {
  return Boolean(getDatabase().prepare(`SELECT 1 FROM turn_rows WHERE turn_id = ? AND reverted_at IS NULL LIMIT 1`).get(turnId));
}

// The rows a revert has just put back, that a later turn kept too ("Undo
// anyway" wrote over them): what that turn kept of them no longer stands,
// and taken back it would bring back what this revert took away, as the
// token of a creature the revert sent off. They are let go; a later turn
// left with no row of the fight stops offering its revert there, and the
// rest say what they still hold.
export function supersedeLaterRows(campaignId: string, turnId: string, written: ReadonlyArray<{ table: string; rowId: string }>) {
  const db = getDatabase();
  const later = db.prepare(
    `SELECT DISTINCT turn_id FROM turn_rows WHERE campaign_id = ? AND tbl = ? AND row_id = ? AND turn_id != ? AND reverted_at IS NULL
       AND rowid > (SELECT MIN(rowid) FROM turn_rows WHERE turn_id = ? AND tbl = ? AND row_id = ?)`,
  );
  const drop = db.prepare(`UPDATE turn_rows SET reverted_at = ? WHERE turn_id = ? AND tbl = ? AND row_id = ? AND reverted_at IS NULL`);
  const turns = new Set<string>();
  const at = nowIso();
  db.transaction(() => {
    for (const { table, rowId } of written) {
      for (const row of later.all(campaignId, table, rowId, turnId, turnId, table, rowId) as Array<{ turn_id: string }>) {
        drop.run(at, row.turn_id, table, rowId);
        turns.add(row.turn_id);
      }
    }
  })();
  for (const other of turns) {
    tellStoryLine(campaignId, other);
    const change = liveTurnChangeOf(campaignId, other, "fight");
    if (!change) {
      continue;
    }
    if (Object.keys(turnCounts(other)).length) {
      tellFightLine(campaignId, other);
    } else {
      markTurnChangesReverted([change.id]);
      publishPersisted(campaignId, "turn_changed", { removed: change.id });
    }
  }
}

onTurnWorkDone(turnDone);

// A turn opened in case it had something to take back that had nothing
// (src/lib/dm/fight-events.ts asEventTurn): what it kept goes, and its sheet
// changes are nobody's turn again, as they were before it was opened. The
// turn goes too: nothing else names it (a roll is parked under the turn it is
// handed, never the one running), and left, every End Turn of a fight with a
// plan would leave an empty turn that pushes real ones out of the revert's
// reach and stands as "the latest turn" a retry asks for.
export function dissolveTurn(campaignId: string, turnId: string) {
  const db = getDatabase();
  const had = db.prepare(`SELECT 1 FROM turn_changes WHERE turn_id = ? LIMIT 1`).get(turnId);
  db.transaction(() => {
    db.prepare(`DELETE FROM turn_rows WHERE turn_id = ?`).run(turnId);
    db.prepare(`DELETE FROM turn_changes WHERE turn_id = ?`).run(turnId);
    unfileTurnAudit(turnId);
    forgetTurnClockMoves(campaignId, turnId);
    db.prepare(`DELETE FROM dm_turns WHERE id = ? AND campaign_id = ?`).run(turnId, campaignId);
  })();
  if (had) {
    publishPersisted(campaignId, "turn_changed", { reverted: turnId });
  }
}

export function listKeptRows(turnId: string): KeptRow[] {
  const rows = getDatabase()
    .prepare(`SELECT tbl, row_id, before_json, after_json, sealed FROM turn_rows WHERE turn_id = ? AND reverted_at IS NULL ORDER BY rowid ASC`)
    .all(turnId) as Array<{ tbl: string; row_id: string; before_json: string | null; after_json: string | null; sealed: number }>;
  return rows.flatMap((row) => {
    if (!tableNames().has(row.tbl)) {
      return [];
    }
    const before = row.before_json === null ? null : parseJson<Row | null>(row.before_json, null);
    const after = row.sealed ? (row.after_json === null ? null : parseJson<Row | null>(row.after_json, null)) : undefined;
    return [{ table: row.tbl, rowId: row.row_id, before, after }];
  });
}

// How many rows of each table the campaign's live turns kept, for the event
// log's line (counts only: a creature the GM keeps off the board is never
// named there).
export function keptCounts(campaignId: string): Map<string, Partial<Record<KeptTable, number>>> {
  const rows = getDatabase()
    .prepare(`SELECT turn_id, tbl, COUNT(*) AS n FROM turn_rows WHERE campaign_id = ? AND reverted_at IS NULL AND ${VISIBLE} GROUP BY turn_id, tbl`)
    .all(campaignId) as Array<{ turn_id: string; tbl: KeptTable; n: number }>;
  const counts = new Map<string, Partial<Record<KeptTable, number>>>();
  for (const row of rows.filter((entry) => isFightTable(entry.tbl))) {
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
  const key = primaryKey(table);
  const columns = Object.keys(values).filter((column) => known.has(column) && !key.includes(column));
  if (!columns.length || !tableNames().has(table)) {
    return;
  }
  const where = whereKey(table, rowId);
  const stamp = known.has("updated_at") && !columns.includes("updated_at") ? ", updated_at = ?" : "";
  getDatabase()
    .prepare(`UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(", ")}${stamp} WHERE ${where.sql}`)
    .run(...columns.map((column) => values[column] as never), ...(stamp ? [nowIso()] : []), ...(where.params as never[]));
}

// A row the turn took away, back as it was.
export function insertRow(table: KeptTable, row: Row) {
  if (!tableNames().has(table)) {
    return;
  }
  const known = columnsOf(table);
  const columns = Object.keys(row).filter((column) => known.has(column));
  getDatabase()
    .prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...columns.map((column) => row[column] as never));
}

export function deleteRow(table: KeptTable, rowId: string) {
  if (!tableNames().has(table)) {
    return;
  }
  const where = whereKey(table, rowId);
  getDatabase().prepare(`DELETE FROM ${table} WHERE ${where.sql}`).run(...(where.params as never[]));
}
