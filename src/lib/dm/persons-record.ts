import { allocateSeq, campaignSeats, type Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, listHiddenRefIds } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies, type EnemyStatus } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { hasHumanDm } from "@/lib/dm/viewer";
import { getRoll } from "@/lib/db/rolls";
import { listAuditForTurn } from "@/lib/db/sheet-audit";
import { listSheets } from "@/lib/db/sheets";
import { publishEphemeral, publishWithSeq } from "@/lib/events";
import { holdNarrationSlot, tableNoteSeq, takeNarrationSlot } from "@/lib/dm/narration-slot";
import { heroChanges, personsRecord, type FoeChange, type RollWords } from "@/lib/dm/persons-record-logic";
import { rollerName } from "@/lib/roll-labels";

// The chronicle's record of a person's adjudication (issue 713;
// src/lib/dm/persons-record-logic.ts says why): taken before the call runs,
// written once it has. The call holds the narration slot meanwhile, so a
// table note it posts (a death, a companion leaving) lands below the rolls
// that caused it, as it lands below an AI turn's narration (issue 668).
// Only where a person holds the GM's seat: the script suites and a lead's
// deploy at a table the AI runs reach the engine as a person too, and the
// AI's own narration is that table's record.
export type RecordStart = {
  turnId: string;
  rolls: number;
  audit: Set<string>;
  encounterId: string | null;
  foes: Map<string, EnemyStatus>;
  slot: boolean;
};

export function startPersonsRecord(campaign: Campaign, turn: DmTurn): RecordStart | null {
  if (!hasHumanDm(campaignSeats(campaign))) {
    return null;
  }
  const encounter = getActiveEncounter(campaign.id);
  return {
    turnId: turn.id,
    rolls: turn.rollIds.length,
    audit: new Set(listAuditForTurn(campaign.id, turn.id).map((entry) => entry.id)),
    encounterId: encounter?.id ?? null,
    foes: new Map(encounter ? listEnemies(encounter.id).map((enemy) => [enemy.id, enemy.status]) : []),
    slot: holdNarrationSlot(campaign.id, turn.id),
  };
}

// The foes the call felled or put to flight. One the GM keeps off the board
// is never named (the tracker's "someone unseen").
function foeChanges(start: RecordStart): FoeChange[] {
  if (!start.encounterId) {
    return [];
  }
  const map = getBattleMapForEncounter(start.encounterId);
  const hidden = new Set(map ? listHiddenRefIds(map.id) : []);
  const changes: FoeChange[] = [];
  for (const enemy of listEnemies(start.encounterId)) {
    if (start.foes.get(enemy.id) === "alive" && enemy.status !== "alive" && !hidden.has(enemy.id)) {
      changes.push({ name: enemy.displayName, status: enemy.status });
    }
  }
  return changes;
}

// `rollIds` are the call's rolls the turn does not list (a player's dice
// entered for a parked roll); `changes` false leaves the sentence to a path
// that posts its own (the server playing the enemies says each blow).
export function postPersonsRecord(
  campaign: Campaign,
  turn: DmTurn,
  start: RecordStart | null,
  options: { rollIds?: readonly string[]; changes?: boolean } = {},
): void {
  if (!start) {
    return;
  }
  const claimed = start.slot ? takeNarrationSlot(campaign.id, start.turnId).seq : null;
  const sheets = new Map(listSheets(campaign.id).map((sheet) => [sheet.id, sheet]));
  // A note reaches every seat, so it carries only the rolls every seat is
  // sent (a blind one without its number, and its words never hold a
  // total). One behind the screen or for one player stays where it was,
  // with the seats that may read it (src/lib/table-delivery.ts): its id or
  // its label would tell the rest it exists.
  const rolls: RollWords[] = [];
  for (const id of new Set([...turn.rollIds.slice(start.rolls), ...(options.rollIds ?? [])])) {
    const roll = getRoll(id);
    if (roll && (roll.visibility === "public" || roll.visibility === "blind")) {
      const sheetName = roll.characterId ? sheets.get(roll.characterId)?.name : undefined;
      const who = rollerName(roll, sheetName) ?? (roll.requestedBy === "dm" ? "The GM" : "A player");
      rolls.push({ id: roll.id, kind: roll.kind, detail: roll.detail, who });
    }
  }
  const fresh = options.changes === false ? [] : listAuditForTurn(campaign.id, start.turnId).filter((entry) => !start.audit.has(entry.id));
  const record = personsRecord(rolls, heroChanges(fresh, sheets), options.changes === false ? [] : foeChanges(start));
  if (!record) {
    if (claimed !== null) {
      // A note took the slot and nothing fills it: the draft bubble lets it go.
      publishEphemeral(campaign.id, "dm_draft_seq", { seq: null });
    }
    return;
  }
  // Into the slot the call's notes claimed, else below whatever narration
  // is on screen now, as any table note goes (narration-slot.ts).
  const seq = claimed ?? tableNoteSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph: record.glyph,
    content: record.content,
    rollIds: record.rollIds,
  });
  // A claimed seq is older than the notes already sent: the event goes out
  // under a new one, or a stream that has seen those would drop it.
  publishWithSeq(campaign.id, claimed === null ? seq : allocateSeq(campaign.id), "message_added", { message });
  if (claimed !== null) {
    publishEphemeral(campaign.id, "dm_draft_seq", { seq: null });
  }
}
