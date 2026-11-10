import type { KeptRow, KeptTable, Row } from "@/lib/db/turn-rows";

// The fight's and the board's own tables, whose rows a revert writes back
// field by field under the fight's rules below. A row of any other table
// (src/lib/db/turn-journal.ts keeps every one a turn writes: a sheet, the
// campaign's floor and scene, an NPC, a quest, a timeline entry) comes back
// if the turn took it away, goes if the turn made it, and otherwise has the
// columns the turn changed written back as the turn found them, and no
// other column: what a later turn changed in another column stands.
export const FIGHT_TABLES = ["encounters", "encounter_enemies", "battle_maps", "battle_tokens", "active_effects", "dropped_items"] as const;
export type FightTable = (typeof FIGHT_TABLES)[number];

export function isFightTable(table: string): table is FightTable {
  return (FIGHT_TABLES as readonly string[]).includes(table);
}

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
//     legendary actions spent, the targets and declared intents, who it
//     goes on without. Its
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
  // Who the fight goes on without (issue 740): an arrival the turn made goes
  // back with the slot and token it was given, or they stayed off the list
  // with neither, and their next initiative roll brought no token.
  "away_ids_json",
  // The once-a-turn marks the turn spent (turn-marks.ts).
  "turn_marks_json",
] as const;

// Columns a row image of another table keeps but no revert writes back:
// when a row was made and last written, and the ones their owner puts back
// (the clock: src/lib/db/clock.ts rewindTurnClock, which knows whether time
// moved since). turn-journal.ts leaves the campaign's sequence counter out
// of the image altogether.
const STAMPS = ["created_at", "updated_at"];
export const OWNED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  campaigns: ["clock_json", "next_seq"],
};

// Columns never written back: who the row is and when it was made.
const FIXED: Record<FightTable, readonly string[]> = {
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
  if (isFightTable(table)) {
    return Object.keys(row).filter((column) => !FIXED[table].includes(column));
  }
  const owned = OWNED_COLUMNS[table] ?? [];
  return Object.keys(row).filter((column) => !STAMPS.includes(column) && !owned.includes(column));
}

function pick(row: Row, columns: readonly string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The columns of a row of another table the turn changed: what its revert
// writes back.
export function turnColumns(table: KeptTable, before: Row, after: Row): string[] {
  return restoredColumns(table, before).filter((column) => !same(before[column], after[column]));
}

// Whether a kept row ends the turn as the turn found it (nothing to take
// back: turn-rows.ts lets it go when the turn's work is done). The columns
// an owner puts back count: a campaign row whose clock alone moved is still
// what the clock's rewind reads.
export function unchangedByTurn(table: KeptTable, before: Row | null, after: Row | null): boolean {
  if (!before || !after) {
    return before === after;
  }
  if (isFightTable(table)) {
    return !changedSince(table, before, after);
  }
  return Object.keys(before).every((column) => STAMPS.includes(column) || column === "next_seq" || same(before[column], after[column]));
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

// What the revert reads of each fight the rows belong to. `blocked`: a
// fight this turn ended cannot be opened again, because another fight is on
// now (one the turn did not begin). `scene`: the row is an exploration
// scene, not a fight (one a fight the turn began closed is opened again with
// the fight's going).
export type FightState = { active: boolean; begunInTurn: boolean; endedInTurn: boolean; blocked?: boolean; scene?: boolean };

export type RowState = KeptRow & {
  now: Row | null;
  // The fight the row belongs to, or null (an effect, an item dropped off
  // every board).
  encounterId: string | null;
};

export type RowPlan = {
  // Fights the turn began, still on: they go, with all they hold.
  dropFights: string[];
  // Rows the turn made that are gone already (a creature it brought in,
  // slain since, its token taken off): nothing to write, but a later turn's
  // copy of them no longer stands either (turn-rows.ts supersedeLaterRows).
  settled: Array<{ table: KeptTable; rowId: string }>;
  deletes: Array<{ table: KeptTable; rowId: string }>;
  inserts: Array<{ table: KeptTable; row: Row }>;
  updates: Array<{ table: KeptTable; rowId: string; values: Row }>;
  // Boards whose ground goes back: nobody may be left inside it.
  grounds: string[];
  warnings: string[];
  // Why the turn cannot be reverted at all, said to the lead; nothing is
  // written.
  refusal: string | null;
};

// `hidden`: ids of the creatures and tokens kept off the board from the
// person asking (a party lead at an AI table), who is told of them without
// their names, as the event log counts them.
const LABELS: Record<FightTable, (row: Row, hidden: ReadonlySet<string>) => string> = {
  encounters: () => "the fight's order of turns",
  encounter_enemies: (row, hidden) =>
    typeof row.display_name === "string" && row.display_name && !hidden.has(String(row.id)) ? row.display_name : "a creature",
  battle_maps: () => "the board",
  // "Goblin 2's token", which read "Goblin 2 token" in the revert's question.
  battle_tokens: (row, hidden) =>
    typeof row.name === "string" && row.name && !row.hidden && !hidden.has(String(row.id)) && !hidden.has(String(row.ref_id))
      ? `${row.name}'s token`
      : "a token",
  active_effects: (row) => (typeof row.name === "string" && row.name ? `the effect ${row.name}` : "an effect"),
  dropped_items: () => "an item on the ground",
};

function listWords(names: string[]): string {
  const shown = names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

// A scene's own row: the place's exploration that a fight breaking out
// closes (encounters.ts createEncounter), apart from the fights.
function isScene(row: RowState): boolean {
  return row.table === "encounters" && typeof row.before?.kind === "string" && row.before.kind !== "fight";
}

// The scene columns a revert writes back when the fight that closed it goes.
const SCENE_COLUMNS = ["status", "outcome", "ended_instant"] as const;

// And a fight's, when the turn that ended it is reverted: it is on again, as
// the blow before the last found it.
const ENDED_COLUMNS = [...SCENE_COLUMNS, "summary", "summary_json"] as const;

// A row of another table, as the event log and the revert's question name it.
const WORDS: Readonly<Record<string, readonly [string, string]>> = {
  character_sheets: ["character sheet", "character sheets"],
  campaigns: ["the scene", "the scene"],
  npcs: ["NPC", "NPCs"],
  relationships: ["bond", "bonds"],
  quests: ["quest", "quests"],
  character_events: ["timeline entry", "timeline entries"],
  locations: ["place", "places"],
  overworld_maps: ["the map", "the map"],
  shops: ["shop", "shops"],
  dm_whispers: ["whisper", "whispers"],
  campaign_notes: ["note", "notes"],
  world_facts: ["fact of the world", "facts of the world"],
  factions: ["faction", "factions"],
  lore_entries: ["lore entry", "lore entries"],
  pending_rolls: ["roll asked for", "rolls asked for"],
  users: ["companion", "companions"],
  campaign_members: ["seat", "seats"],
};

function wordFor(table: string, count: number): string {
  const [one, more] = WORDS[table] ?? ["record", "records"];
  if (one.startsWith("the ")) {
    return one;
  }
  return `${count} ${count === 1 ? one : more}`;
}

export function planRowsRevert(
  rows: readonly RowState[],
  fights: ReadonlyMap<string, FightState>,
  hidden: ReadonlySet<string> = new Set(),
): RowPlan {
  const plan: RowPlan = { dropFights: [], settled: [], deletes: [], inserts: [], updates: [], grounds: [], warnings: [], refusal: null };
  const changed: string[] = [];
  const told = new Set<string>();
  // A fight the turn began goes whole, whether it is still on or the turn
  // ended it too.
  const goes = (fight: FightState | undefined) => Boolean(fight?.begunInTurn && (fight.active || fight.endedInTurn));
  // A fight the turn ended is opened again (WAVE1 maintainer decision on
  // LC-REV-13: "a turn that ended a fight reopens it, or refuses with a
  // sentence saying why it cannot"): every row the turn kept of it goes back,
  // its standing too. Left ended, the revert took back what the blow paid the
  // heroes and left the foe dead, the fight over and the action spent.
  const reopens = (fight: FightState | undefined) => Boolean(fight && fight.endedInTurn && !fight.begunInTurn && !fight.active && !fight.scene);
  for (const fight of fights.values()) {
    if (reopens(fight) && fight.blocked) {
      plan.refusal =
        "This turn ended a fight, and another fight has begun since: the first cannot be opened again beside it. Revert the turns since, newest first, or end the fight that is on, and try again.";
      return plan;
    }
  }
  // A fight the turn began on an exploration map closed that scene; with the
  // fight gone the scene is open again, its board with it, as the turn found
  // them. Left closed, the revert left the table with no board at all.
  const dropping = [...fights.values()].some(goes);
  const reopened = new Set(
    dropping
      ? rows.filter((row) => isScene(row) && row.before?.status === "active" && row.now?.status === "ended").map((row) => row.rowId)
      : [],
  );
  const others = new Map<string, number>();
  for (const row of rows) {
    if (!isFightTable(row.table)) {
      if (row.before && !row.now) {
        plan.inserts.push({ table: row.table, row: row.before });
      } else if (!row.before && row.now) {
        plan.deletes.push({ table: row.table, rowId: row.rowId });
      } else if (row.before && row.now) {
        const columns = turnColumns(row.table, row.before, row.after ?? row.now);
        if (columns.length) {
          plan.updates.push({ table: row.table, rowId: row.rowId, values: pick(row.before, columns) });
          // A sheet's own fields are asked about by the sheet audit
          // (sheet-undo.ts undoConflictWarnings).
          if (row.after && row.table !== "character_sheets" && JSON.stringify(pick(row.after, columns)) !== JSON.stringify(pick(row.now, columns))) {
            others.set(row.table, (others.get(row.table) ?? 0) + 1);
          }
        }
      }
      continue;
    }
    const fight = row.encounterId ? fights.get(row.encounterId) : undefined;
    if (row.encounterId && goes(fight)) {
      if (!plan.dropFights.includes(row.encounterId)) {
        plan.dropFights.push(row.encounterId);
        plan.warnings.push("This turn began the fight: reverting it takes the fight away, as if it never began.");
      }
      // An item has no tie to the board it lies on that a fight's delete
      // follows (dropped_items.map_id): it is put back on its own, or it
      // outlived the fight on a board that no longer exists.
      if (row.table !== "dropped_items") {
        continue;
      }
    } else if (row.encounterId && reopened.has(row.encounterId)) {
      if (row.table === "encounters" && row.before) {
        plan.updates.push({ table: row.table, rowId: row.rowId, values: pick(row.before, [...restoredColumns(row.table, row.before), ...SCENE_COLUMNS]) });
        continue;
      }
    } else if (row.encounterId && reopens(fight)) {
      if (!told.has(row.encounterId)) {
        told.add(row.encounterId);
        plan.warnings.push("This turn ended the fight: reverting it opens the fight again, as the turn found it.");
      }
      if (row.table === "encounters" && row.before && row.now) {
        plan.updates.push({
          table: row.table,
          rowId: row.rowId,
          values: pick(row.before, [...restoredColumns(row.table, row.before), ...ENDED_COLUMNS.filter((column) => column in row.before!)]),
        });
        continue;
      }
    } else if (row.encounterId && (!fight || !fight.active)) {
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
      changed.push(LABELS[row.table](row.now ?? row.before ?? {}, hidden));
    }
    if (!row.before) {
      if (row.now) {
        plan.deletes.push({ table: row.table, rowId: row.rowId });
      } else {
        plan.settled.push({ table: row.table, rowId: row.rowId });
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
  for (const [table, count] of others) {
    changed.push(wordFor(table, count));
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
export function fightLine(counts: Partial<Record<string, number>>): string {
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

// The event log's line for what a turn changed outside the fight (the
// scene, an NPC, a quest, a pet on a sheet no audit row names): counts by
// table, in plain words. Empty when there is nothing to tell.
export function storyLine(counts: Partial<Record<string, number>>): string {
  const parts = Object.entries(counts).flatMap(([table, count]) => (count && !isFightTable(table) ? [wordFor(table, count)] : []));
  return parts.length ? `The story changes: ${listWords([...new Set(parts)])}.` : "";
}
