import type { Campaign } from "@/lib/db/campaigns";
import { effectsFollowingMaxHp, effectsUpdate } from "@/lib/db/active-effects";
import { getBattleMap, listTokens, placeToken } from "@/lib/db/battle-maps";
import { getDatabase } from "@/lib/db/core";
import { diceGiveBackWarnings, giveBackDice } from "@/lib/db/dice-scripts";
import { listEnemies } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { markTurnChangesReverted, type TurnChange } from "@/lib/db/turn-changes";
import { deleteRow, insertRow, listKeptRows, markRowsReverted, readRow, supersedeLaterRows, writeRow, type KeptRow, type Row } from "@/lib/db/turn-rows";
import { restandOn } from "@/lib/battlemap/ground-change";
import { footprintLookup } from "@/lib/battlemap/view";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { takeBackFightEvent } from "@/lib/dm/fight-event-undo";
import { cardRevertWarnings, takeBackCardResolution } from "@/lib/dm/resolve-card";
import { removeSummon } from "@/lib/dm/summon-store";
import { isFightTable, planRowsRevert, type FightState, type RowPlan, type RowState } from "@/lib/dm/turn-rows-logic";
import { publishEphemeral, publishPersisted } from "@/lib/events";

// The part of "Revert this turn" that is not a sheet or the clock (issue
// 685; src/lib/db/turn-changes.ts lists what a turn keeps): the fight and the
// board as the turn found them, the creatures it called up, the prepared
// fight's events it fired, the test dice it spent, the cards the GM resolved
// in it. The route (audit/revert-turn) asks for the warnings first and then
// takes them back, after the sheets.

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

// The fight each kept row belongs to: a token and an item through the board
// they lie on.
function fightOf(row: KeptRow, now: Row | null, boards: Map<string, string | null>): string | null {
  const seen = now ?? row.before ?? {};
  switch (row.table) {
    case "encounters":
      return row.rowId;
    case "encounter_enemies":
    case "battle_maps":
      return text(seen.encounter_id);
    case "battle_tokens":
    case "dropped_items": {
      const mapId = text(seen.map_id);
      if (!mapId) {
        return null;
      }
      if (!boards.has(mapId)) {
        boards.set(mapId, text(readRow("battle_maps", mapId)?.encounter_id));
      }
      return boards.get(mapId) ?? null;
    }
    default:
      return null;
  }
}

function rowsPlan(turnId: string): { plan: RowPlan; rows: RowState[] } | null {
  const kept = listKeptRows(turnId);
  if (!kept.length) {
    return null;
  }
  const boards = new Map<string, string | null>();
  for (const row of kept) {
    if (row.table === "battle_maps") {
      boards.set(row.rowId, text((row.before ?? readRow("battle_maps", row.rowId) ?? {}).encounter_id));
    }
  }
  const rows: RowState[] = kept.map((row) => {
    const now = readRow(row.table, row.rowId);
    return { ...row, now, encounterId: fightOf(row, now, boards) };
  });
  const fights = new Map<string, FightState>();
  for (const id of new Set(rows.flatMap((row) => (row.encounterId ? [row.encounterId] : [])))) {
    const own = rows.find((row) => row.table === "encounters" && row.rowId === id);
    const now = readRow("encounters", id);
    fights.set(id, {
      active: now?.status === "active",
      begunInTurn: Boolean(own && !own.before),
      endedInTurn: own?.before?.status === "active" && (own.after ?? now)?.status === "ended",
    });
  }
  return { plan: planRowsRevert(rows, fights), rows };
}

// The kept rows the revert wrote: put back, taken away, brought back, or
// gone with a fight the turn began. Rows of a fight that has ended since are
// left as they are, and so is what a later turn kept of them.
function writtenRows({ plan, rows }: { plan: RowPlan; rows: RowState[] }): RowState[] {
  const key = (table: string, rowId: string) => `${table}:${rowId}`;
  const touched = new Set([...plan.updates, ...plan.deletes].map((entry) => key(entry.table, entry.rowId)));
  const brought = new Set(plan.inserts.map((entry) => entry.row));
  return rows.filter(
    (row) =>
      touched.has(key(row.table, row.rowId)) ||
      (row.before !== null && brought.has(row.before)) ||
      (row.encounterId !== null && plan.dropFights.includes(row.encounterId)),
  );
}

// Whoever stands where the ground came back as wall is set on the nearest
// open square, as a change of ground does (ground-change.ts).
function restand(mapId: string) {
  const map = getBattleMap(mapId);
  if (!map) {
    return;
  }
  const footprint = footprintLookup(new Map(listEnemies(map.encounterId).map((enemy) => [enemy.id, enemy])));
  const moves = restandOn(
    map.terrain,
    map.width,
    map.height,
    listTokens(mapId).map((token) => ({ id: token.id, x: token.x, y: token.y, footprint: footprint(token) })),
  );
  if (!("error" in moves)) {
    for (const move of moves) {
      placeToken(move.id, move.x, move.y);
    }
  }
}

function applyRows(campaign: Campaign, plan: RowPlan) {
  const db = getDatabase();
  const effects = (entry: { table: string }) => entry.table === "active_effects";
  // Effects first, through the rule that moves a hero's maximum with them;
  // the creatures' rows after, as the turn found them, maximum and all.
  effectsFollowingMaxHp(campaign.id, () =>
    db.transaction(() => {
      plan.deletes.filter(effects).forEach((entry) => deleteRow(entry.table, entry.rowId));
      plan.inserts.filter(effects).forEach((entry) => insertRow(entry.table, entry.row));
      plan.updates.filter(effects).forEach((entry) => writeRow(entry.table, entry.rowId, entry.values));
    })(),
  );
  db.transaction(() => {
    plan.dropFights.forEach((id) => deleteRow("encounters", id));
    plan.deletes.filter((entry) => !effects(entry)).forEach((entry) => deleteRow(entry.table, entry.rowId));
    plan.inserts.filter((entry) => !effects(entry)).forEach((entry) => insertRow(entry.table, entry.row));
    plan.updates.filter((entry) => !effects(entry)).forEach((entry) => writeRow(entry.table, entry.rowId, entry.values));
    plan.grounds.forEach(restand);
  })();
  publishEncounter(campaign.id);
  publishEphemeral(campaign.id, "battle_map_updated", {});
  if ([...plan.deletes, ...plan.inserts, ...plan.updates].some(effects)) {
    publishPersisted(campaign.id, "effects_updated", effectsUpdate(campaign.id));
  }
}

// What the turn took away whole (a summoned creature sent away: its bot
// user, its sheet), back before the sheets are put back, so the sheet audit's
// own revert lands on the sheet again: the hit points the blow that sent it
// away took come back with it.
export function bringBackTakenRows(campaign: Campaign, turnId: string) {
  const plan = rowsPlan(turnId)?.plan;
  const taken = plan?.inserts.filter((entry) => !isFightTable(entry.table)) ?? [];
  if (!taken.length) {
    return;
  }
  getDatabase().transaction(() => taken.forEach((entry) => insertRow(entry.table, entry.row)))();
  for (const entry of taken) {
    const sheet = entry.table === "character_sheets" ? getSheetById(text(entry.row.id) ?? "") : null;
    if (sheet) {
      publishPersisted(campaign.id, "sheet_updated", { sheet });
    }
  }
}

export function turnChangeWarnings(campaign: Campaign, turnId: string, changes: readonly TurnChange[]): string[] {
  const dice = changes.filter((change) => change.kind === "dice_face" || change.kind === "dice_seed");
  return [
    ...(rowsPlan(turnId)?.plan.warnings ?? []),
    ...changes.flatMap((change) => (change.kind === "card" ? cardRevertWarnings(change) : [])),
    ...(dice.length ? diceGiveBackWarnings(campaign.id, dice) : []),
  ];
}

// Newest first, as the sheets go back; the fight's rows last, so they land
// as the turn found them whatever the steps before wrote. Returns how many
// changes were taken back.
export function takeBackTurnChanges(campaign: Campaign, turnId: string, changes: readonly TurnChange[]): number {
  const dice = changes.filter((change) => change.kind === "dice_face" || change.kind === "dice_seed");
  if (dice.length) {
    giveBackDice(campaign.id, dice);
  }
  for (const change of [...changes].reverse()) {
    if (change.kind === "fight_event") {
      takeBackFightEvent(campaign, change);
    } else if (change.kind === "card") {
      takeBackCardResolution(change);
    } else if (change.kind === "summon") {
      const sheet = getSheetById(text(change.payload.sheetId) ?? "");
      if (sheet) {
        removeSummon(campaign, { id: sheet.id, userId: sheet.userId, name: sheet.name });
      }
    }
  }
  const rows = rowsPlan(turnId);
  if (rows) {
    applyRows(campaign, rows.plan);
    markRowsReverted(turnId);
    supersedeLaterRows(campaign.id, turnId, writtenRows(rows));
  }
  markTurnChangesReverted(changes.map((change) => change.id));
  return changes.length;
}
