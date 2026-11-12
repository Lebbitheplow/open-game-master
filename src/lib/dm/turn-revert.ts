import type { Campaign } from "@/lib/db/campaigns";
import { effectsUpdate } from "@/lib/db/active-effects";
import { getBattleMap, listTokens, placeToken } from "@/lib/db/battle-maps";
import { getDatabase } from "@/lib/db/core";
import { diceGiveBackWarnings, giveBackDice } from "@/lib/db/dice-scripts";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { setTemplateCued } from "@/lib/db/encounter-templates";
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

// The part of "Revert this turn" that is not a sheet's audit or the clock
// (issue 685; src/lib/db/turn-changes.ts lists what a turn keeps): the fight
// and the board as the turn found them, every other row the turn wrote
// (src/lib/db/turn-journal.ts), the creatures it called up, the prepared
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
        const board = readRow("battle_maps", mapId);
        // A board gone since (with a fight a revert took away) holds nothing
        // to put back: its id stands in for a fight that is over, so its
        // rows are left. Read as no fight, a token was put back onto a board
        // that no longer exists, and the database refused it halfway through.
        boards.set(mapId, board ? text(board.encounter_id) : mapId);
      }
      return boards.get(mapId) ?? null;
    }
    default:
      return null;
  }
}

// The creatures and tokens the table cannot see, for a question asked of a
// seat that does not see them either.
function hiddenRefs(campaignId: string): Set<string> {
  const rows = getDatabase().prepare(`SELECT id, ref_id FROM battle_tokens WHERE campaign_id = ? AND hidden = 1`).all(campaignId) as Array<{
    id: string;
    ref_id: string;
  }>;
  return new Set(rows.flatMap((row) => [row.id, row.ref_id]));
}

function rowsPlan(turnId: string, hidden?: ReadonlySet<string>): { plan: RowPlan; rows: RowState[] } | null {
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
  const turn = getDatabase().prepare(`SELECT campaign_id FROM dm_turns WHERE id = ?`).get(turnId) as { campaign_id: string } | undefined;
  for (const id of new Set(rows.flatMap((row) => (row.encounterId ? [row.encounterId] : [])))) {
    const own = rows.find((row) => row.table === "encounters" && row.rowId === id);
    const now = readRow("encounters", id);
    // Another fight on now, which a fight this turn ended cannot be opened
    // again beside.
    const other = turn ? getActiveEncounter(turn.campaign_id) : null;
    // Another fight on now, unless it is one this turn began (it goes).
    const otherBegunHere = rows.some((row) => row.table === "encounters" && row.rowId === other?.id && !row.before);
    fights.set(id, {
      active: now?.status === "active",
      begunInTurn: Boolean(own && !own.before),
      endedInTurn: own?.before?.status === "active" && (own.after ?? now)?.status === "ended",
      blocked: Boolean(other && other.id !== id && !otherBegunHere),
      scene: typeof (own?.before ?? now)?.kind === "string" && (own?.before ?? now)?.kind !== "fight",
    });
  }
  return { plan: planRowsRevert(rows, fights, hidden), rows };
}

// The kept rows the revert wrote: put back, taken away, brought back, or
// gone with a fight the turn began. Rows of a fight that has ended since are
// left as they are, and so is what a later turn kept of them.
function writtenRows({ plan, rows }: { plan: RowPlan; rows: RowState[] }): RowState[] {
  const key = (table: string, rowId: string) => `${table}:${rowId}`;
  const touched = new Set([...plan.updates, ...plan.deletes, ...plan.settled].map((entry) => key(entry.table, entry.rowId)));
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

// A row of another table the turn made, taken away: alone, so a row a later
// turn made beside it that still points at it (the database refuses that
// delete) keeps it, rather than the whole revert failing.
function deleteOther(table: string, rowId: string) {
  try {
    getDatabase().transaction(() => deleteRow(table, rowId))();
  } catch (error) {
    console.warn(`[turn-revert] kept ${table} ${rowId}: a later row still needs it`, error);
  }
}

function applyRows(campaign: Campaign, plan: RowPlan) {
  const db = getDatabase();
  const effects = (entry: { table: string }) => entry.table === "active_effects";
  const fightRow = (entry: { table: string }) => isFightTable(entry.table) && !effects(entry);
  // Effects as rows alone: what an effect did to a hero's maximum and hit
  // points in the turn is the sheet audit's to put back (active-effects.ts
  // audits it there), and a creature's is its own row's below. Moved again
  // here, a hero given Aid and then hit came back 5 hit points over.
  db.transaction(() => {
    plan.deletes.filter(effects).forEach((entry) => deleteRow(entry.table, entry.rowId));
    plan.inserts.filter(effects).forEach((entry) => insertRow(entry.table, entry.row));
    plan.updates.filter(effects).forEach((entry) => writeRow(entry.table, entry.rowId, entry.values));
  })();
  db.transaction(() => {
    plan.dropFights.forEach((id) => deleteRow("encounters", id));
    plan.deletes.filter(fightRow).forEach((entry) => deleteRow(entry.table, entry.rowId));
    plan.inserts.filter(fightRow).forEach((entry) => insertRow(entry.table, entry.row));
    plan.updates.filter(fightRow).forEach((entry) => writeRow(entry.table, entry.rowId, entry.values));
    plan.grounds.forEach(restand);
  })();
  // The rest of what the turn wrote (turn-journal.ts): the columns it
  // changed back as it found them, the rows it made gone, newest first so a
  // row goes before the one it points at. What it took away came back first
  // (bringBackTakenRows), before the sheets.
  const other = (entry: { table: string }) => !isFightTable(entry.table);
  db.transaction(() => {
    plan.updates.filter(other).forEach((entry) => writeRow(entry.table, entry.rowId, entry.values));
  })();
  [...plan.deletes.filter(other)].reverse().forEach((entry) => deleteOther(entry.table, entry.rowId));
  for (const entry of plan.updates.filter((update) => update.table === "character_sheets")) {
    const sheet = getSheetById(entry.rowId);
    if (sheet) {
      publishPersisted(campaign.id, "sheet_updated", { sheet });
    }
  }
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
  // Each row alone, a row that points at one not back yet (a sheet kept on
  // its first write, before the bot user its cascade took) tried again once
  // the rest are in.
  const db = getDatabase();
  let pending = taken;
  while (pending.length) {
    const failed: Array<{ entry: (typeof taken)[number]; error: unknown }> = [];
    for (const entry of pending) {
      try {
        db.transaction(() => insertRow(entry.table, entry.row))();
      } catch (error) {
        failed.push({ entry, error });
      }
    }
    if (failed.length === pending.length) {
      throw failed[0].error;
    }
    pending = failed.map((miss) => miss.entry);
  }
  for (const entry of taken) {
    const sheet = entry.table === "character_sheets" ? getSheetById(text(entry.row.id) ?? "") : null;
    if (sheet) {
      publishPersisted(campaign.id, "sheet_updated", { sheet });
    }
  }
}

// Why the turn cannot be reverted, or null (src/lib/dm/turn-rows-logic.ts
// planRowsRevert: a fight it ended, with another on since).
export function turnRevertRefusal(turnId: string): string | null {
  return rowsPlan(turnId)?.plan.refusal ?? null;
}

// `seesSecrets`: whether the person asking sees what the GM keeps off the
// board (campaign-api.ts seesStorytellerSecrets); a party lead at an AI
// table is told of a hidden creature without its name.
export function turnChangeWarnings(campaign: Campaign, turnId: string, changes: readonly TurnChange[], seesSecrets = true): string[] {
  const dice = changes.filter((change) => change.kind === "dice_face" || change.kind === "dice_seed");
  return [
    ...(rowsPlan(turnId, seesSecrets ? undefined : hiddenRefs(campaign.id))?.plan.warnings ?? []),
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
  const dropsFight = changes.some((change) => change.kind === "cue") && Boolean(rowsPlan(turnId)?.plan.dropFights.length);
  for (const change of [...changes].reverse()) {
    if (change.kind === "cue") {
      // The prepared fight the turn ran is the lead's cue again once the
      // fight it began goes (a fight that has ended since stays, and so does
      // its cue's use).
      const templateId = text(change.payload.templateId);
      if (templateId && dropsFight) {
        setTemplateCued(templateId, true);
      }
    } else if (change.kind === "fight_event") {
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
  return changes.length || (rows ? 1 : 0);
}
