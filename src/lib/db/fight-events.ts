import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { normalizeFightEvents, type FightEvent } from "@/lib/dm/fight-event-logic";
import { readBoardStamp, type BoardStamp } from "@/lib/dm/fight-ground-logic";

// A prepared fight's events, armed on the fight it started
// (src/lib/dm/fight-events.ts runs them).
//
// Rows of their own, one per event, rather than a field of the encounter
// row: the pointer and the handlers read the encounter, change it in memory
// and save it whole (saveEncounter), so a fired flag kept in it would be lost
// to the next save of a copy read before it. A row here is claimed with one
// UPDATE that only an unfired row matches, so an event fires once even when
// two calls finish at the same moment. The rows go with the fight
// (afterTheFight disarms them) and with the encounter or the campaign
// (cascade). Older servers ignore the table, so it needs no schema revision.

export type ArmedFightEvent = {
  id: string;
  encounterId: string;
  templateName: string;
  position: number;
  event: FightEvent;
  // The enemy each roster slot became when the fight was deployed. Fixed
  // then, because a name is not: reinforcements of the same kind renumber
  // the ones already there ("Goblin" becomes "Goblin 1").
  slots: Record<number, string>;
  // The party's entry tile the plan set, for reinforcements that come in
  // where the party did.
  entry: { x: number; y: number } | null;
  // The board a change of ground was fitted to when the fight was deployed
  // on its prepared map, or null (no change of ground was kept). Kept in
  // event_json beside the event, which the reader ignores, so the table
  // needs no new column.
  board: BoardStamp | null;
  firedAt: string | null;
  // What the table was told when it fired.
  lines: string[];
};

type Row = {
  id: string;
  encounter_id: string;
  template_name: string;
  position: number;
  event_json: string;
  slots_json: string;
  entry_json: string;
  fired_at: string | null;
  lines_json: string;
};

function mapRow(row: Row): ArmedFightEvent | null {
  const raw = parseJson<unknown>(row.event_json, null);
  const [event] = normalizeFightEvents([raw]);
  if (!event) {
    return null;
  }
  return {
    id: row.id,
    encounterId: row.encounter_id,
    templateName: row.template_name,
    position: row.position,
    event,
    slots: parseJson<Record<number, string>>(row.slots_json, {}),
    entry: parseJson<{ x: number; y: number } | null>(row.entry_json, null),
    board: readBoardStamp((raw as { board?: unknown } | null)?.board),
    firedAt: row.fired_at,
    lines: parseJson<string[]>(row.lines_json, []),
  };
}

export function armFightEvents(input: {
  campaignId: string;
  encounterId: string;
  templateName: string;
  events: FightEvent[];
  slots: Record<number, string>;
  entry: { x: number; y: number } | null;
  board: BoardStamp | null;
}) {
  const db = getDatabase();
  const insert = db.prepare(
    `INSERT INTO fight_events
       (id, campaign_id, encounter_id, template_name, position, event_json, slots_json, entry_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = nowIso();
  db.transaction(() => {
    input.events.forEach((event, position) => {
      insert.run(
        crypto.randomUUID(),
        input.campaignId,
        input.encounterId,
        input.templateName,
        position,
        JSON.stringify(input.board ? { ...event, board: input.board } : event),
        JSON.stringify(input.slots),
        JSON.stringify(input.entry),
        now,
      );
    });
  })();
}

export function listFightEvents(encounterId: string): ArmedFightEvent[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM fight_events WHERE encounter_id = ? ORDER BY position ASC, rowid ASC`)
    .all(encounterId) as Row[];
  return rows.map(mapRow).filter((row): row is ArmedFightEvent => row !== null);
}

// Whether the campaign has an event still waiting on this fight: one
// indexed read, the whole cost of the check every engine call makes.
export function hasArmedFightEvents(encounterId: string): boolean {
  return Boolean(
    getDatabase().prepare(`SELECT 1 FROM fight_events WHERE encounter_id = ? AND fired_at IS NULL LIMIT 1`).get(encounterId),
  );
}

// True for the one caller that fires it.
export function claimFightEvent(id: string): boolean {
  return (
    getDatabase().prepare(`UPDATE fight_events SET fired_at = ? WHERE id = ? AND fired_at IS NULL`).run(nowIso(), id)
      .changes === 1
  );
}

export function recordFightEventLines(id: string, lines: string[]) {
  getDatabase().prepare(`UPDATE fight_events SET lines_json = ? WHERE id = ?`).run(JSON.stringify(lines), id);
}

// "Revert this turn" took back what the event did (src/lib/dm/
// fight-event-undo.ts): it waits for its moment again. False when the row is
// gone (the fight ended and disarmed it).
export function rearmFightEvent(id: string): boolean {
  return (
    getDatabase().prepare(`UPDATE fight_events SET fired_at = NULL, lines_json = '[]' WHERE id = ?`).run(id).changes === 1
  );
}

export function getFightEvent(id: string): ArmedFightEvent | null {
  const row = getDatabase().prepare(`SELECT * FROM fight_events WHERE id = ?`).get(id) as Row | undefined;
  return row ? mapRow(row) : null;
}

// The fight is over: nothing it planned can happen any more.
export function disarmFightEvents(encounterId: string) {
  getDatabase().prepare(`DELETE FROM fight_events WHERE encounter_id = ?`).run(encounterId);
}
