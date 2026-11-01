import { getDatabase, parseJson } from "@/lib/db/core";
import { turnKey, type OrderEntry } from "@/lib/db/encounters";
import { liveTurnChangeOf, recordTurnChange, updateTurnChange } from "@/lib/db/turn-changes";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { currentTurnId } from "@/lib/dm/job-control";

// The action economy a GM turn spent, kept so "Revert this turn" gives it
// back (issue 685): the acting creature's action, bonus action and attacks
// (the encounter's turnBudget) and the reactions spent this round. Before,
// a reverted turn gave back the slot a card spent and the hit points it took,
// but the action stayed spent, so the card resolved again, or the swing
// played again, was refused: "has already used their action this turn".
//
// The fight row is saved whole (encounters.ts saveEncounter), so the stored
// budget is read just before the turn's first save that changes it (the
// budget as the turn found it), and what each later save of the turn writes
// is kept beside it (as the turn left it), so the revert can tell what the
// turn spent from what a later turn spent. One per turn and fight.

type FightRow = {
  campaign_id: string;
  round: number;
  turn_index: number;
  order_json: string;
  turn_budget_json: string | null;
  reactions_used_json: string | null;
};

export type SpentBudget = {
  encounterId: string;
  // The turn of the fight it was spent on ("round:owner", encounters.ts
  // turnKey), and the round, for the reactions.
  turnKey: string;
  round: number;
  // As the turn found them, and as it left them.
  turnBudget: TurnBudget | null;
  reactionsUsed: string[];
  after: { turnBudget: TurnBudget | null; reactionsUsed: string[] };
};

function keyOf(row: FightRow): string {
  return turnKey({ round: row.round, order: parseJson<OrderEntry[]>(row.order_json, []), turnIndex: row.turn_index });
}

// Called by saveEncounter before it writes, with what it is about to write.
export function keepSpentBudget(encounterId: string, next: { turnBudget: TurnBudget | null; reactionsUsed: string[] }) {
  const turnId = currentTurnId();
  if (!turnId) {
    return;
  }
  const row = getDatabase()
    .prepare(`SELECT campaign_id, round, turn_index, order_json, turn_budget_json, reactions_used_json FROM encounters WHERE id = ?`)
    .get(encounterId) as FightRow | undefined;
  if (!row) {
    return;
  }
  const budget = parseJson<TurnBudget | null>(row.turn_budget_json ?? "null", null);
  const reactions = parseJson<string[]>(row.reactions_used_json ?? "[]", []);
  if (JSON.stringify(budget) === JSON.stringify(next.turnBudget) && JSON.stringify(reactions) === JSON.stringify(next.reactionsUsed)) {
    return;
  }
  const after = { turnBudget: next.turnBudget, reactionsUsed: next.reactionsUsed };
  const kept = liveTurnChangeOf(row.campaign_id, turnId, "budget");
  if (kept && kept.payload.encounterId === encounterId) {
    updateTurnChange(kept.id, { ...kept.payload, after });
    return;
  }
  const spent: SpentBudget = { encounterId, turnKey: keyOf(row), round: row.round, turnBudget: budget, reactionsUsed: reactions, after };
  recordTurnChange(row.campaign_id, turnId, "budget", { ...spent, line: "" });
}
