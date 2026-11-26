import type { SqliteDatabase } from "./driver.ts";
import type { ChatMessage } from "@/lib/model-client";

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
// is here: its dice are where the call's run put them (the turn, a line of
// their own, or neither for a call refused as they landed), and its mark is
// filed by fileAnsweredHeldCards below.
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

// The held cards of the turns still open when a turn began to list those it
// has answered too (issue #1073), filed once (src/lib/db/core.ts, under an
// app_settings marker).
//
// Until then a card that held its whole call (src/lib/dm/held-call.ts) was
// on no list: the turn took it for answered when its conversation held a tool
// answer of the call's id. The turn now reads its list alone
// (src/lib/dm/turn.ts answerLandedCards), so a turn open across the upgrade
// is read the old way one last time, and a held card it had answered is
// marked. Left unmarked, the turn's next resume or retry handed the model a
// second answer to the same call.
//
// The old reading is kept as it was, by the call's id alone. Where a backend
// gave two calls of one turn the same id it could take a held call for
// answered when it was not; such a turn was already wrong before the
// upgrade, and is left as it was rather than guessed at.
//
// Right once only, like the filing above: after it a held card that has
// landed and not been answered may share its call's id with an earlier
// answer, and a second filing would mark it.
export function fileAnsweredHeldCards(db: SqliteDatabase) {
  const columns = db.prepare(`PRAGMA table_info(pending_rolls)`).all() as Array<{ name: string }>;
  // Added on first use (dm-turns.ts ensurePendingColumns): a database
  // without it has never held a call.
  if (!columns.some((column) => column.name === "carry_json")) {
    return;
  }
  const cards = db
    .prepare(
      `
        SELECT p.id AS id, p.turn_id AS turnId, p.tool_call_id AS toolCallId, t.conversation_json AS conversation, t.answered_pending_ids_json AS answered
        FROM pending_rolls p JOIN dm_turns t ON t.id = p.turn_id
        WHERE t.status != 'done' AND p.status != 'pending' AND p.tool_call_id IS NOT NULL
          AND CASE WHEN json_valid(p.carry_json) THEN json_extract(p.carry_json, '$.call') IS NOT NULL AND json_extract(p.carry_json, '$.answer') IS NOT NULL ELSE 0 END
        ORDER BY p.created_at ASC, p.rowid ASC
      `,
    )
    .all() as Array<{ id: string; turnId: string; toolCallId: string; conversation: string; answered: string | null }>;
  const list = (json: string | null): unknown[] => {
    try {
      const parsed: unknown = JSON.parse(json ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const turns = new Map<string, { answeredCalls: Set<string | undefined>; answered: string[]; filed: boolean }>();
  for (const card of cards) {
    let turn = turns.get(card.turnId);
    if (!turn) {
      const messages = list(card.conversation) as Array<ChatMessage | null>;
      turn = {
        answeredCalls: new Set(messages.filter((message) => message?.role === "tool").map((message) => message?.tool_call_id)),
        answered: list(card.answered).map(String),
        filed: false,
      };
      turns.set(card.turnId, turn);
    }
    if (turn.answeredCalls.has(card.toolCallId) && !turn.answered.includes(card.id)) {
      turn.answered.push(card.id);
      turn.filed = true;
    }
  }
  const write = db.prepare(`UPDATE dm_turns SET answered_pending_ids_json = ? WHERE id = ?`);
  for (const [turnId, turn] of turns) {
    if (turn.filed) {
      write.run(JSON.stringify(turn.answered), turnId);
    }
  }
}
