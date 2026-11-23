import type { SqliteDatabase } from "./driver.ts";

// The turns still open when a turn began to keep which roll cards it has
// answered (dm_turns.answered_pending_ids_json, issue #915), filed once by
// the migration that adds the column (src/lib/db/core.ts).
//
// Until then a card's roll joined its turn's cards as the turn handed it to
// the model, so "on the turn" was the mark that the card had been answered.
// A card's roll now joins as it lands (src/lib/dm/pending-roll-land.ts), and
// the turn keeps the mark itself. A turn that was waiting on dice across the
// upgrade is read the old way one last time:
//
// - a card whose roll is on its turn was answered, and is marked so. Left
//   unmarked, the turn's next resume handed the model a second answer to the
//   same call;
// - a card whose roll had landed and waited for the turn to resume is on no
//   turn, and the turn no longer adds it then: it joins now, after the rolls
//   the turn already lists.
//
// A card that held its whole call (src/lib/dm/held-call.ts) is left as it
// is, unmarked: its answer is the call's own, which the turn reads off its
// conversation, and its dice are where the call's run put them (the turn, a
// line of their own, or neither for a call refused as they landed).
//
// It reads rows the old way, so it is right once only: the migration runs
// it in one transaction with the column's ALTER, and never again. Takes the
// handle rather than opening one, since the migration runs while the
// database is still being opened.
export function fileAnsweredRollCards(db: SqliteDatabase) {
  const columns = db.prepare(`PRAGMA table_info(pending_rolls)`).all() as Array<{ name: string }>;
  // The column a held call rides is added on first use (dm-turns.ts
  // ensurePendingColumns): a database without it has never held a call.
  const held = columns.some((column) => column.name === "carry_json") ? `json_extract(p.carry_json, '$.call') IS NOT NULL` : `0`;
  const cards = db
    .prepare(
      `
        SELECT p.id AS id, p.turn_id AS turnId, p.roll_id AS rollId, ${held} AS held, t.roll_ids_json AS onTurn
        FROM pending_rolls p JOIN dm_turns t ON t.id = p.turn_id
        WHERE p.roll_id IS NOT NULL AND t.status != 'done'
        ORDER BY p.created_at ASC, p.rowid ASC
      `,
    )
    .all() as Array<{ id: string; turnId: string; rollId: string; held: number; onTurn: string }>;
  const turns = new Map<string, { rollIds: string[]; answered: string[] }>();
  for (const card of cards) {
    let turn = turns.get(card.turnId);
    if (!turn) {
      let rollIds: unknown = [];
      try {
        rollIds = JSON.parse(card.onTurn);
      } catch {
        rollIds = [];
      }
      turn = { rollIds: Array.isArray(rollIds) ? rollIds.map(String) : [], answered: [] };
      turns.set(card.turnId, turn);
    }
    if (card.held) {
      continue;
    }
    if (turn.rollIds.includes(card.rollId)) {
      turn.answered.push(card.id);
    } else {
      turn.rollIds.push(card.rollId);
    }
  }
  const write = db.prepare(`UPDATE dm_turns SET roll_ids_json = ?, answered_pending_ids_json = ? WHERE id = ?`);
  for (const [turnId, turn] of turns) {
    write.run(JSON.stringify(turn.rollIds), JSON.stringify(turn.answered), turnId);
  }
}
