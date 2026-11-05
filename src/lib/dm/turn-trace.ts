import { getDatabase } from "@/lib/db/core";
import { getDmTurn } from "@/lib/db/dm-turns";
import { listNpcs } from "@/lib/db/npcs";
import { listSheets } from "@/lib/db/sheets";
import { isQuietTrace, traceTurn, type TurnTrace } from "@/lib/dm/turn-trace-logic";

// The test fight's turn trace, read from the table's stored turns (issue
// 685; src/lib/dm/turn-trace-logic.ts says what a trace holds). The route
// decides who may read it; this only reads.

export type TurnTracePage = {
  // Newest first.
  turns: TurnTrace[];
  // The id to ask with for the turns before these, or null at the first.
  before: string | null;
};

// Every id a call can name at this table, as the table calls it: the
// heroes (a companion who came back answers to the sheets it held before),
// every enemy of every fight here, and the cast.
function namesAt(campaignId: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const sheet of listSheets(campaignId)) {
    for (const id of [sheet.id, ...(sheet.formerSheetIds ?? [])]) {
      names.set(id, sheet.name);
    }
  }
  const enemies = getDatabase()
    .prepare(`SELECT id, display_name FROM encounter_enemies WHERE campaign_id = ?`)
    .all(campaignId) as Array<{ id: string; display_name: string }>;
  for (const enemy of enemies) {
    names.set(enemy.id, enemy.display_name);
  }
  for (const npc of listNpcs(campaignId)) {
    names.set(npc.id, npc.name);
  }
  return names;
}

// How long each AI turn ran, as its quality row recorded where it ended
// (src/lib/db/turn-ledger.ts). A person's turn has none.
function durationsOf(turnIds: readonly string[]): Map<string, number> {
  if (!turnIds.length) {
    return new Map();
  }
  const rows = getDatabase()
    .prepare(`SELECT turn_id, duration_ms FROM turn_quality WHERE turn_id IN (${turnIds.map(() => "?").join(", ")})`)
    .all(...turnIds) as Array<{ turn_id: string; duration_ms: number | null }>;
  return new Map(rows.flatMap((row) => (typeof row.duration_ms === "number" ? [[row.turn_id, row.duration_ms] as const] : [])));
}

// The table's last `limit` turns before `before` (a turn id of this table),
// or its newest. Null when `before` is no turn of this table. A turn with
// nothing to show (a person's turn the engine closed with no call and no
// roll) is left out, so a page can hold fewer than `limit`.
export function turnTracePage(campaignId: string, limit: number, before: string | null): TurnTracePage | null {
  const db = getDatabase();
  let rows: Array<{ id: string }>;
  if (before) {
    const cursor = db
      .prepare(`SELECT created_at, rowid AS seq FROM dm_turns WHERE id = ? AND campaign_id = ?`)
      .get(before, campaignId) as { created_at: string; seq: number } | undefined;
    if (!cursor) {
      return null;
    }
    rows = db
      .prepare(
        `SELECT id FROM dm_turns WHERE campaign_id = ? AND (created_at < ? OR (created_at = ? AND rowid < ?))
          ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(campaignId, cursor.created_at, cursor.created_at, cursor.seq, limit + 1) as Array<{ id: string }>;
  } else {
    rows = db
      .prepare(`SELECT id FROM dm_turns WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(campaignId, limit + 1) as Array<{ id: string }>;
  }
  const page = rows.slice(0, limit);
  const names = namesAt(campaignId);
  const durations = durationsOf(page.map((row) => row.id));
  const turns = page.flatMap((row) => {
    const turn = getDmTurn(row.id);
    if (!turn) {
      return [];
    }
    const trace = traceTurn(turn, { names, durationMs: durations.get(turn.id) ?? null });
    return isQuietTrace(trace) ? [] : [trace];
  });
  return { turns, before: rows.length > limit ? page[page.length - 1].id : null };
}
