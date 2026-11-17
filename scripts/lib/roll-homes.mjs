// Where a roll's card lives, read from the database (issue #915).
//
// The chronicle draws a roll's card from one of two places: the turn the roll
// was made in (dm_turns.roll_ids_json, which an AI turn's message and a
// person's record are both written from), or a line a site posted for it
// (campaign_messages.roll_ids_json). A roll in neither is stored and thrown
// on the dice stage and never shown again. A roll on a turn twice, or on two
// turns, is drawn twice.
//
// A line written from a turn (src/lib/dm/persons-record.ts) lists that turn's
// rolls again, so a roll on one turn has its home whatever lines repeat it.

const { getDatabase } = await import("../../src/lib/db/core.ts");
const { listEventsSince } = await import("../../src/lib/events.ts");

// The highest rowid of the rolls table: a mark to read the rolls a call
// stored after it.
export function rollMark() {
  return getDatabase().prepare(`SELECT COALESCE(MAX(rowid), 0) AS at FROM rolls`).get().at;
}

// The rolls of a table stored after a mark, oldest first.
export function rollsAfter(campaignId, mark) {
  return getDatabase()
    .prepare(`SELECT rowid AS at, id, character_id AS characterId, requested_by AS requestedBy, roll_kind AS kind, detail, visibility, attacker_json AS attackerJson FROM rolls WHERE campaign_id = ? AND rowid > ? ORDER BY rowid ASC`)
    .all(campaignId, mark)
    .map((row) => ({ ...row, attacker: row.attackerJson ? JSON.parse(row.attackerJson) : null }));
}

// Every place a roll is listed: a turn once for each time it lists it.
export function rollHomes(rollId) {
  const db = getDatabase();
  const turns = db.prepare(`SELECT dm_turns.id AS id FROM dm_turns, json_each(dm_turns.roll_ids_json) AS listed WHERE listed.value = ?`).all(rollId).map((row) => row.id);
  const lines = db
    .prepare(`SELECT m.id AS id FROM campaign_messages m, json_each(m.roll_ids_json) AS listed WHERE m.roll_ids_json IS NOT NULL AND listed.value = ?`)
    .all(rollId)
    .map((row) => row.id);
  return { turns, lines };
}

// What is wrong with a roll's home, or null: it is on one turn once, or on
// no turn and on one line.
export function homeProblem(rollId) {
  const { turns, lines } = rollHomes(rollId);
  if (turns.length === 1 || (turns.length === 0 && lines.length === 1)) {
    return null;
  }
  if (turns.length > 1) {
    return `listed ${turns.length} times on a turn`;
  }
  return lines.length ? `on ${lines.length} lines and no turn` : "on no turn and no line";
}

export const lastSeq = (campaignId) => listEventsSince(campaignId, 0, 100000).at(-1)?.seq ?? 0;

// What the table was told of a roll since `seq`: `source` says whether the
// stage throws a die for it.
export function announced(campaignId, seq, rollId) {
  return listEventsSince(campaignId, seq, 100000).filter((event) => event.type === "roll_result" && event.payload?.roll?.id === rollId).map((event) => event.payload);
}
