import type { SqliteDatabase } from "@/lib/db/driver";
import { currentTurnId } from "@/lib/dm/job-control";

// Every write a GM turn makes to the table's state is kept with the turn, by
// the database itself, so "Revert this turn" takes back exactly what the turn
// did and nothing else (issue 685; the lifecycle sweep,
// scripts/test-enforce-sweep-lifecycle-revert.mjs).
//
// Before, each writer had to remember to keep its rows (turn-rows.ts keepRow)
// or to write its sheet through the audit (src/lib/dm/audited-patch.ts), and
// the ones that forgot left residue a revert could not reach: a Dodge kept
// after its action came back, a Bless gone from heroes whose caster still held
// it, a pet called up by a reverted turn, the floor still in initiative after
// the fight it named was taken away, a disease, an NPC, a quest. Now a
// connection-local trigger on every state table writes the row as the turn
// found it into turn_rows on the turn's first write to it (INSERT OR IGNORE:
// the first image wins), whatever code path wrote it. A new writer cannot
// bypass it; a new TABLE must be classed below, or
// scripts/test-turn-journal.mjs fails naming it.
//
// The triggers are TEMP: they live in this connection, beside the SQL
// function they call (odm_turn(): the turn the running work belongs to,
// src/lib/dm/job-control.ts currentTurnId), so the file never carries a
// trigger another program opening it could not run.
//
// What a revert does with the rows is src/lib/dm/turn-rows-logic.ts; when a
// turn's work is done turn-rows.ts reads each row once more as the turn left
// it, and lets go of the rows the turn left as it found them.

// A record of play: a revert adds to it and never takes from it.
export const RECORD_TABLES: Readonly<Record<string, string>> = {
  dm_turns: "the turns themselves",
  sheet_audit: "the sheet history (a revert writes its own undo rows)",
  turn_rows: "this journal",
  turn_changes: "what the event log offers to revert",
  clock_moves: "the clock's own log of a turn's time",
  campaign_events: "the event stream",
  campaign_messages: "the transcript: what was said stays said",
  messages: "the transcript of a solo chat",
  chats: "a solo chat",
  rolls: "the dice rolled",
  model_calls: "the storyteller's calls",
  usage_events: "token usage",
  turn_corrections: "the corrections ledger",
  turn_quality: "how a turn was scored",
  agent_activity: "an agent's log",
  notifications: "notices already sent",
  voice_transcript: "what was said aloud",
  content_reports: "a player's report",
  ruling_disputes: "a player's dispute of a ruling",
  chapter_snapshots: "the chapter rewind's own pictures",
  side_messages: "players' side chat",
};

// Put back by another part of the revert, which knows more than a row
// image does (src/app/api/campaigns/[campaignId]/audit/revert-turn/route.ts).
export const OWN_REVERT_TABLES: Readonly<Record<string, string>> = {
  dice_scripts: "the test dice the turn spent are given back in queue order (dice-scripts.ts giveBackDice)",
  last_hits: "the turn's hits and the answers to them are forgotten (last-hit.ts forgetTurnHits, forgetTurnAnswers)",
  item_cast_credits: "the turn's item casts are forgotten (item-cast-credits.ts forgetTurnItemCasts)",
  fight_events: "a fired event is armed again (fight-event-undo.ts takeBackFightEvent)",
  encounter_templates: "a prepared fight's cue is given back with the fight it began (turn-revert.ts)",
};

// Not the table's play, or never a turn's to write: accounts, libraries,
// uploads, settings, schedules, indexes rebuilt from other rows, a chapter
// (taken back whole by the chapter rewind, from its own snapshot).
export const OUTSIDE_TABLES: Readonly<Record<string, string>> = {
  account_invites: "accounts",
  app_settings: "the server's settings",
  sessions: "sign-ins",
  friends: "accounts",
  user_blocks: "accounts",
  homebrew_entries: "the homebrew library",
  private_homebrew: "the homebrew library",
  library_characters: "a player's library",
  library_personalities: "a player's library",
  library_rulesets: "the ruleset library",
  characters: "a solo chat's characters",
  pdf_imports: "an adventure import in the workshop",
  pdf_import_pages: "an adventure import in the workshop",
  creation_rolls: "character creation, before any campaign",
  media_files: "uploads",
  scheduled_sessions: "the calendar of sessions",
  session_rsvps: "the calendar of sessions",
  player_webhooks: "a player's agent hook-up",
  player_webhook_stops: "a player's agent hook-up",
  player_webhook_deliveries: "a player's agent hook-up",
  player_webhook_writes: "a player's agent hook-up",
  agent_grants: "a player's agent hook-up",
  world_paint_jobs: "art queued for a world",
  world_pack_drafts: "the world pack editor",
  world_forge: "the WorldForge editor",
  rule_chunks: "the rules search index, rebuilt from the rules",
  scene_chunks: "the transcript search index, rebuilt from the transcript",
  campaign_workshops: "which workshops a campaign reads",
  private_sources: "which books a campaign reads",
  content_origins: "where imported content came from",
  test_fight_runs: "a test fight's own bookkeeping",
  side_threads: "players' side chat",
  side_thread_members: "players' side chat",
  pregen_claims: "a player claiming a ready-made hero",
  npc_merge_dismissals: "the GM's answer to a merge suggestion",
  ask_briefs: "a player's question to the GM",
  campaign_asks: "a player's question to the GM",
  chapters: "a chapter's close is taken back by the chapter rewind, from its snapshot",
};

// Columns no row image keeps, and whose writes alone keep nothing: the
// campaign's sequence counter moves on every message and roll. (What a
// revert keeps but leaves to an owner, the clock: turn-rows-logic.ts
// OWNED_COLUMNS.)
export const UNKEPT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  campaigns: ["next_seq", "updated_at", "created_at"],
};

const isClassed = (table: string) => table in RECORD_TABLES || table in OWN_REVERT_TABLES || table in OUTSIDE_TABLES;

// The tables a turn's writes are journaled from: every table not classed
// above (sqlite's own and full-text shadows aside).
export function journaledTables(all: readonly string[]): string[] {
  return all.filter((table) => !table.startsWith("sqlite_") && !/_fts(_|$)|_vec|vec_/.test(table) && !isClassed(table));
}

type Column = { name: string; type: string; pk: number };

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

// The row as JSON text: json_object takes at most 63 pairs a call on some
// builds, so wide rows (a sheet) are built in groups. BLOB columns (search
// vectors) are left out: they are rebuilt from the text, and JSON holds no
// blob.
function imageOf(alias: string, columns: readonly Column[]): string {
  const kept = columns.filter((column) => !/BLOB/i.test(column.type));
  const pairs = (group: readonly Column[], path: boolean) =>
    group.map((column) => `'${path ? "$." : ""}${column.name}', ${alias}.${quote(column.name)}`).join(", ");
  let expr = `json_object(${pairs(kept.slice(0, 50), false)})`;
  for (let start = 50; start < kept.length; start += 50) {
    expr = `json_insert(${expr}, ${pairs(kept.slice(start, start + 50), true)})`;
  }
  return expr;
}

// The row's key as turn_rows stores it (turn-rows.ts keyOf): its one key
// column as text, or its key columns as a JSON array.
function keyOf(alias: string, key: readonly Column[]): string {
  return key.length === 1 ? `CAST(${alias}.${quote(key[0].name)} AS TEXT)` : `json_array(${key.map((column) => `${alias}.${quote(column.name)}`).join(", ")})`;
}

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// The first image wins. Not by INSERT OR IGNORE: inside a trigger SQLite
// swaps a body's conflict policy for the firing statement's, so under an
// INSERT OR REPLACE a later write would have replaced the turn's first
// picture of the row. Nothing conflicts when nothing is there to.
//
// Names inside the body are left unqualified (older SQLite builds, the one
// in node:sqlite among them, refuse a schema name on a trigger's INSERT):
// no temp table shares a name, so they resolve to the file's own.
function keep(table: string, rowId: string, image: string): string {
  return `INSERT INTO turn_rows (campaign_id, turn_id, tbl, row_id, before_json, created_at)
    SELECT d.campaign_id, d.id, '${table}', ${rowId}, ${image}, ${NOW} FROM dm_turns d WHERE d.id = odm_turn()
      AND NOT EXISTS (SELECT 1 FROM turn_rows k WHERE k.turn_id = d.id AND k.tbl = '${table}' AND k.row_id = ${rowId});`;
}

function triggersFor(table: string, columns: readonly Column[]): string[] {
  const key = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
  if (!key.length) {
    return [];
  }
  const unkept = UNKEPT_COLUMNS[table] ?? [];
  const imaged = columns.filter((column) => !unkept.includes(column.name));
  const name = (kind: string) => quote(`odm_tj_${kind}_${table}`);
  const on = `ON main.${quote(table)}`;
  const turn = `odm_turn() IS NOT NULL`;
  const keyed = (alias: string) => key.map((column) => ` AND ${alias}.${quote(column.name)} IS NOT NULL`).join("");
  // Only a write that names a kept column: allocating the campaign's next
  // sequence number is no change of the table's state.
  const of = unkept.length ? ` OF ${imaged.map((column) => quote(column.name)).join(", ")}` : "";
  // An integer key the database hands out is not known before the insert.
  const autoKey = key.length === 1 && /INT/i.test(key[0].type);
  const where = key.map((column) => `o.${quote(column.name)} IS NEW.${quote(column.name)}`).join(" AND ");
  // Before an insert, so an INSERT OR REPLACE (or an upsert) of a row that
  // was there keeps the row it replaced, not "the turn made it".
  const inserted = autoKey
    ? `CREATE TEMP TRIGGER ${name("i")} AFTER INSERT ${on} WHEN ${turn}${keyed("NEW")} BEGIN ${keep(table, keyOf("NEW", key), "NULL")} END;`
    : `CREATE TEMP TRIGGER ${name("i")} BEFORE INSERT ${on} WHEN ${turn}${keyed("NEW")} BEGIN ${keep(
        table,
        keyOf("NEW", key),
        `(SELECT ${imageOf("o", imaged)} FROM ${quote(table)} o WHERE ${where})`,
      )} END;`;
  return [
    `CREATE TEMP TRIGGER ${name("u")} BEFORE UPDATE${of} ${on} WHEN ${turn}${keyed("OLD")} BEGIN ${keep(table, keyOf("OLD", key), imageOf("OLD", imaged))} END;`,
    `CREATE TEMP TRIGGER ${name("d")} BEFORE DELETE ${on} WHEN ${turn}${keyed("OLD")} BEGIN ${keep(table, keyOf("OLD", key), imageOf("OLD", imaged))} END;`,
    inserted,
  ];
}

const installed = new WeakSet<object>();

// A table's triggers, built from its columns as they are now: the row image
// names each column, so a trigger made before a column was added would keep
// a picture without it.
function tableStatements(db: SqliteDatabase, table: string): string[] {
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Column[];
  const statements = ["u", "d", "i"].map((kind) => `DROP TRIGGER IF EXISTS temp.${quote(`odm_tj_${kind}_${table}`)};`);
  return [...statements, ...triggersFor(table, columns)];
}

// The tables a statement changes the shape of: ALTER TABLE's own and the
// name it renames one to, and a table it creates.
const SHAPED = /\bALTER\s+TABLE\s+(?:main\.)?["`[]?(\w+)["`\]]?|\bRENAME\s+TO\s+["`[]?(\w+)["`\]]?|\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:main\.)?["`[]?(\w+)["`\]]?/gi;

export function shapedTables(sql: string): string[] {
  return [...new Set([...sql.matchAll(SHAPED)].map((match) => match[1] ?? match[2] ?? match[3]))];
}

// Called once the schema is in place (core.ts getDatabase).
//
// The triggers name every column of their table, and SQLite checks every
// trigger on a table when one of its columns is dropped or renamed, so a
// trigger made before the change refuses it ("no such column: OLD.kind")
// or, after an added column, keeps a picture without it. Every schema change
// arrives through exec (driver.ts), so exec is wrapped here: the triggers of
// each table a statement reshapes are dropped before it runs and built again
// from the columns it leaves, whether it ran or failed.
export function installTurnJournal(db: SqliteDatabase) {
  if (installed.has(db)) {
    return;
  }
  installed.add(db);
  db.defineFunction("odm_turn", () => currentTurnId());
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((row) => row.name);
  db.exec(journaledTables(tables).flatMap((table) => tableStatements(db, table)).join("\n"));
  const exec = db.exec.bind(db);
  db.exec = (sql: string) => {
    const shaped = journaledTables(shapedTables(sql));
    if (!shaped.length) {
      exec(sql);
      return;
    }
    exec(shaped.flatMap((table) => ["u", "d", "i"].map((kind) => `DROP TRIGGER IF EXISTS temp.${quote(`odm_tj_${kind}_${table}`)};`)).join("\n"));
    try {
      exec(sql);
    } finally {
      exec(shaped.flatMap((table) => tableStatements(db, table)).join("\n"));
    }
  };
}
