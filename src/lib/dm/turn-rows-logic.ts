import type { KeptRow, KeptTable, Row } from "@/lib/db/turn-rows";

// How "Revert this turn" puts back the fight and board rows a turn wrote
// (issue 685; src/lib/db/turn-rows.ts keeps them). Pure, so the suites read
// the rules without a table.
//
//   - A row the turn changed goes back to what it was; one it made goes
//     away (a creature it brought in, a token it laid down, an effect it
//     started); one it took away comes back.
//   - A row changed again since the turn (by a later turn, a player's End
//     Turn, the GM's own controls) is asked about first, as a later sheet
//     change is, and goes back on yes.
//   - A fight the turn began goes away with it, while it is still on. A fight
//     that has ended (in the turn or since) stays ended, and what was done in
//     it stays: reopening one would bring back a fight its loot, experience
//     and summary have already closed.
//   - Of the fight's own row only the turn's working parts go back: the
//     order, the round and whose turn it is, the action, reactions and
//     legendary actions spent, the targets and declared intents. Its
//     standing (on or ended) and its summary are not a turn's to undo.

// The fight row's columns a revert writes back.
export const FIGHT_COLUMNS = [
  "round",
  "turn_index",
  "order_ready",
  "order_json",
  "waiting_seq",
  "turn_budget_json",
  "surprised_ids_json",
  "reactions_used_json",
  "ammo_spent_json",
  "legendary_json",
  "targets_json",
  "intents_json",
  "sides_json",
] as const;

// Columns never written back: who the row is and when it was made.
const FIXED: Record<KeptTable, readonly string[]> = {
  encounters: [],
  encounter_enemies: ["id", "encounter_id", "campaign_id", "created_at", "updated_at"],
  battle_maps: ["id", "encounter_id", "campaign_id", "created_at", "updated_at"],
  battle_tokens: ["id", "map_id", "campaign_id", "updated_at"],
  active_effects: ["id", "campaign_id", "created_at"],
  dropped_items: ["id", "campaign_id", "created_at"],
};

export function restoredColumns(table: KeptTable, row: Row): string[] {
  if (table === "encounters") {
    return FIGHT_COLUMNS.filter((column) => column in row);
  }
  return Object.keys(row).filter((column) => !FIXED[table].includes(column));
}

function pick(row: Row, columns: readonly string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

// Whether a row reads otherwise than the turn left it, in the columns a
// revert writes.
export function changedSince(table: KeptTable, after: Row | null, now: Row | null): boolean {
  if (!after || !now) {
    return after !== now;
  }
  const columns = restoredColumns(table, after);
  return JSON.stringify(pick(after, columns)) !== JSON.stringify(pick(now, columns));
}

// What the revert reads of each fight the rows belong to.
export type FightState = { active: boolean; begunInTurn: boolean; endedInTurn: boolean };

export type RowState = KeptRow & {
  now: Row | null;
  // The fight the row belongs to, or null (an effect, an item dropped off
  // every board).
  encounterId: string | null;
};

export type RowPlan = {
  // Fights the turn began, still on: they go, with all they hold.
  dropFights: string[];
  deletes: Array<{ table: KeptTable; rowId: string }>;
  inserts: Array<{ table: KeptTable; row: Row }>;
  updates: Array<{ table: KeptTable; rowId: string; values: Row }>;
  // Boards whose ground goes back: nobody may be left inside it.
  grounds: string[];
  warnings: string[];
};

const LABELS: Record<KeptTable, (row: Row) => string> = {
  encounters: () => "the fight's order of turns",
  encounter_enemies: (row) => (typeof row.display_name === "string" && row.display_name ? row.display_name : "a creature"),
  battle_maps: () => "the board",
  battle_tokens: (row) => `${typeof row.name === "string" && row.name ? row.name : "a"} token`,
  active_effects: (row) => (typeof row.name === "string" && row.name ? `the effect ${row.name}` : "an effect"),
  dropped_items: () => "an item on the ground",
};

function listWords(names: string[]): string {
  const shown = names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export function planRowsRevert(rows: readonly RowState[], fights: ReadonlyMap<string, FightState>): RowPlan {
  const plan: RowPlan = { dropFights: [], deletes: [], inserts: [], updates: [], grounds: [], warnings: [] };
  const changed: string[] = [];
  const told = new Set<string>();
  for (const row of rows) {
    const fight = row.encounterId ? fights.get(row.encounterId) : undefined;
    if (row.encounterId && fight?.begunInTurn) {
      if (fight.active && !plan.dropFights.includes(row.encounterId)) {
        plan.dropFights.push(row.encounterId);
        plan.warnings.push("This turn began the fight: reverting it takes the fight away, as if it never began.");
      }
      continue;
    }
    if (row.encounterId && (!fight || !fight.active)) {
      if (!told.has(row.encounterId)) {
        told.add(row.encounterId);
        plan.warnings.push(
          fight?.endedInTurn
            ? "This turn ended the fight: it stays ended, and what was done in it stays."
            : "The fight this turn changed has ended since: what the turn did in it stays.",
        );
      }
      continue;
    }
    if (row.after !== undefined && changedSince(row.table, row.after, row.now)) {
      changed.push(LABELS[row.table](row.now ?? row.before ?? {}));
    }
    if (!row.before) {
      if (row.now) {
        plan.deletes.push({ table: row.table, rowId: row.rowId });
      }
      continue;
    }
    if (!row.now) {
      plan.inserts.push({ table: row.table, row: row.before });
      continue;
    }
    const columns = restoredColumns(row.table, row.before);
    plan.updates.push({ table: row.table, rowId: row.rowId, values: pick(row.before, columns) });
    if (row.table === "battle_maps" && row.before.terrain !== row.now.terrain) {
      plan.grounds.push(row.rowId);
    }
  }
  if (changed.length) {
    plan.warnings.push(
      `Since this turn, ${listWords([...new Set(changed)])} changed again; reverting puts ${changed.length === 1 ? "it" : "them"} back as this turn found ${changed.length === 1 ? "it" : "them"}.`,
    );
  }
  return plan;
}

// The event log's line for a turn's fight changes: counts only, so a
// creature the GM keeps off the board is never named.
export function fightLine(counts: Partial<Record<KeptTable, number>>): string {
  const many = (count: number | undefined, one: string, more: string) => (count ? `${count} ${count === 1 ? one : more}` : "");
  const parts = [
    many(counts.encounter_enemies, "creature", "creatures"),
    many(counts.battle_tokens, "token", "tokens"),
    counts.encounters ? "the order of turns" : "",
    counts.battle_maps ? "the board" : "",
    many(counts.active_effects, "effect", "effects"),
    many(counts.dropped_items, "dropped item", "dropped items"),
  ].filter(Boolean);
  return parts.length ? `The fight changes: ${listWords(parts)}.` : "The fight changes.";
}
