// What the lifecycle sweep suites share (scripts/test-enforce-sweep-lifecycle-*.mjs):
// a picture of the whole database a test can diff, "Revert this turn" as the
// event log calls it, and a fresh copy of one module, which is what a server
// restart leaves of the state that module keeps in its own scope.
//
// Import scripts/lib/enforce-world.mjs before this file.
const { getDatabase } = await import("../../src/lib/db/core.ts");

// Tables that are a record of what happened, not the state of the table: a
// revert adds to them and never takes from them, so they are left out of a
// "nothing is left behind" comparison. Everything else is state.
export const LOG_TABLES = new Set([
  "dm_turns",
  "sheet_audit",
  "turn_rows",
  "turn_changes",
  "clock_moves",
  "campaign_events",
  "events",
  "messages",
  "campaign_messages",
  "rolls",
  "dice_rolls",
  "llm_calls",
  "usage",
  "corrections",
  "ai_corrections",
  "sqlite_sequence",
  // The lead signs in to press Revert.
  "sessions",
  "model_calls",
  "usage_events",
  "turn_corrections",
  "turn_quality",
  "agent_activity",
  "notifications",
]);

// Columns that move on every write and say nothing about the game.
export const CLOCK_COLUMNS = new Set(["updated_at", "last_activity_at", "seq", "next_seq", "last_seq", "version", "revision"]);

let tableList = null;
export function tables() {
  tableList ??= getDatabase()
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((row) => row.name)
    .filter((name) => !/_fts|_vec|vec_|embedding/i.test(name));
  return tableList;
}

const keyCache = new Map();
function keyColumns(table) {
  if (!keyCache.has(table)) {
    const columns = getDatabase().prepare(`PRAGMA table_info(${table})`).all();
    const pk = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    keyCache.set(table, pk.length ? pk : ["rowid"]);
  }
  return keyCache.get(table);
}

// Every row of every table, as text a test can compare.
export function snapshot({ only = null } = {}) {
  const db = getDatabase();
  const shot = new Map();
  for (const table of only ?? tables()) {
    const key = keyColumns(table);
    let rows;
    try {
      rows = db.prepare(`SELECT ${key[0] === "rowid" ? "rowid AS rowid, " : ""}* FROM ${table}`).all();
    } catch {
      continue;
    }
    const byKey = new Map();
    for (const row of rows) {
      byKey.set(key.map((column) => String(row[column])).join("|"), row);
    }
    shot.set(table, byKey);
  }
  return shot;
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  }
  return value;
}

// A JSON column compared as a value: key order is not a difference.
function parsed(value) {
  if (typeof value === "string" && /^[[{]/.test(value)) {
    try {
      return sortDeep(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return value;
}

function leafDiffs(before, after, path, out, limit = 12) {
  if (out.length >= limit) {
    return;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return;
  }
  const bothObjects = before && after && typeof before === "object" && typeof after === "object" && Array.isArray(before) === Array.isArray(after);
  if (!bothObjects) {
    out.push(`${path}: ${JSON.stringify(before)?.slice(0, 90)} -> ${JSON.stringify(after)?.slice(0, 90)}`);
    return;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    leafDiffs(before[key], after[key], `${path}.${key}`, out, limit);
  }
}

// What differs between two snapshots, as lines "table[key].column.path: a -> b".
// `ignore(table, column, path)` drops a difference that is not the game's.
export function diff(before, after, { ignoreTables = LOG_TABLES, ignore = () => false } = {}) {
  const lines = [];
  for (const table of new Set([...before.keys(), ...after.keys()])) {
    if (ignoreTables.has(table)) {
      continue;
    }
    const a = before.get(table) ?? new Map();
    const b = after.get(table) ?? new Map();
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const rowA = a.get(key);
      const rowB = b.get(key);
      if (!rowA) {
        lines.push(`${table}[+row]`);
        continue;
      }
      if (!rowB) {
        lines.push(`${table}[-row]`);
        continue;
      }
      for (const column of Object.keys(rowA)) {
        if (CLOCK_COLUMNS.has(column) || rowA[column] === rowB[column]) {
          continue;
        }
        const leaves = [];
        leafDiffs(parsed(rowA[column]), parsed(rowB[column]), `${table}.${column}`, leaves);
        for (const leaf of leaves) {
          const dot = leaf.indexOf(":");
          if (!ignore(table, column, leaf.slice(0, dot))) {
            lines.push(leaf);
          }
        }
      }
    }
  }
  return lines;
}

// "Revert this turn" as the event log's button calls it, confirmed.
export async function revertTurn(world, turnId) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/audit/revert-turn");
  try {
    const response = await handler.POST(
      new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, confirm: true }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    return { status: response.status, json: await response.json().catch(() => ({})) };
  } catch (error) {
    return { status: "threw", json: { error: String(error?.stack ?? error).slice(0, 400) } };
  }
}

// A second copy of one module, loaded now: what a restarted server holds of
// the state that module keeps in its own scope (nothing), beside the same
// database. Everything the module imports is shared with the running copy.
let restarts = 0;
export function restarted(relativeToSrc) {
  restarts += 1;
  return import(new URL(`../../src/${relativeToSrc}?restart=${restarts}`, import.meta.url).href);
}
