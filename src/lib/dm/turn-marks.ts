import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { keepRow } from "@/lib/db/turn-rows";
import { recordTurnChange } from "@/lib/db/turn-changes";

// Once-a-turn marks the database keeps, so a restart remembers them
// (LC-RST-01). They were module-level Maps: Grim Harvest's turn, Keeper of
// Souls' round, Form of the Beast's bite, the hoards a turn had paid. A fresh
// server healed a necromancer twice in one turn, and paid the same
// roll_treasure sent again a second time.
//
// What must go through here: any "once a turn", "once a round" or "this
// call already paid" mark a feature or tool keeps outside the turn budget
// (action-budget.ts oncePerTurn holds the turn owner's own). A new
// module-level store under src/lib/dm fails
// scripts/test-enforce-sweep-lifecycle-restart.mjs until it is classed.

// ---- in a fight: the encounter's own row (encounters.turn_marks_json) ----
//
// {key: stamp}: the mark holds while the stamp the caller reads now is the one
// written (a turn's key, a round). On the fight's row, so it ends with the
// fight and the turn's revert takes it back (turn-rows-logic.ts FIGHT_COLUMNS).

// Enough for every holder's marks in a fight; the oldest go first.
const MAX_MARKS = 64;

function marksOf(encounterId: string): Record<string, string> {
  const row = getDatabase().prepare(`SELECT turn_marks_json FROM encounters WHERE id = ?`).get(encounterId) as
    | { turn_marks_json: string | null }
    | undefined;
  return parseJson<Record<string, string>>(row?.turn_marks_json ?? "{}", {});
}

// Whether `key` was marked with this very stamp.
export function fightMarked(encounterId: string, key: string, stamp: string): boolean {
  return marksOf(encounterId)[key] === stamp;
}

export function markFight(encounterId: string, key: string, stamp: string) {
  const marks = marksOf(encounterId);
  delete marks[key];
  marks[key] = stamp;
  const kept = Object.entries(marks).slice(-MAX_MARKS);
  keepRow("encounters", encounterId);
  getDatabase()
    .prepare(`UPDATE encounters SET turn_marks_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(Object.fromEntries(kept)), nowIso(), encounterId);
}

// ---- in a GM turn: what one call paid (turn_changes, kind "ledger") ----
//
// The same call twice in one turn is the model sending it again (a retry, a
// batch that repeated a line): it is answered with what the first one paid.
// Kept with the turn, so its revert takes the ledger back with the payout.

export function turnLedger(campaignId: string, turnId: string, key: string): Record<string, unknown> | null {
  const row = getDatabase()
    .prepare(
      `SELECT payload_json FROM turn_changes WHERE campaign_id = ? AND turn_id = ? AND kind = 'ledger' AND reverted_at IS NULL
         AND json_extract(payload_json, '$.key') = ? ORDER BY rowid DESC LIMIT 1`,
    )
    .get(campaignId, turnId, key) as { payload_json: string } | undefined;
  const payload = parseJson<{ result?: Record<string, unknown> } | null>(row?.payload_json ?? "", null);
  return payload?.result ?? null;
}

export function writeTurnLedger(campaignId: string, turnId: string, key: string, result: Record<string, unknown>) {
  recordTurnChange(campaignId, turnId, "ledger", { key, result, line: "" });
}
