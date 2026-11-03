// The Intelligence, Wisdom and Charisma saves characters made this turn
// against a creature that forced them, for the reaction that answers one:
// Vigilant Rebuke (Oath of the Watchers 15), "whenever you or a creature you
// can see within 30 feet of you succeeds on an Intelligence, a Wisdom, or a
// Charisma saving throw, you can use your reaction to deal 2d8 + your
// Charisma modifier force damage to the creature that forced the saving
// throw". Nothing kept who forced a save, so the reaction had no card and its
// call named a creature on trust.
//
// One row per campaign holds the saves of the turn under way; a save from an
// earlier turn, or another fight, is gone the moment it is read. The engine's
// own saves are recorded (forced-save.ts rollCharacterSave, given the
// creature that forced them); a save a player rolled at the GM's request
// carries no forcer, and the GM's call names the creature for it.
import { randomUUID } from "node:crypto";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getActiveEncounter, turnKey } from "@/lib/db/encounters";

const db = () => getDatabase();

export type SaveAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type LastSave = {
  id: string;
  characterId: string;
  ability: SaveAbility;
  forcer: { id: string; name: string };
  encounterId: string;
  turn: string;
  at: string;
};

// The saves Vigilant Rebuke answers.
const MENTAL: ReadonlySet<SaveAbility> = new Set(["int", "wis", "cha"]);

function readRow(campaignId: string): LastSave[] {
  const row = db().prepare(`SELECT payload_json FROM last_saves WHERE campaign_id = ?`).get(campaignId) as { payload_json: string } | undefined;
  const parsed = row ? parseJson<LastSave[] | null>(row.payload_json, null) : null;
  return Array.isArray(parsed) ? parsed : [];
}

function writeRow(campaignId: string, saves: LastSave[]) {
  db()
    .prepare(
      `INSERT INTO last_saves (campaign_id, payload_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT (campaign_id) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
    )
    .run(campaignId, JSON.stringify(saves), nowIso());
}

// The saves still open: this fight, this turn.
export function openSaves(campaignId: string): LastSave[] {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return [];
  }
  const key = turnKey(encounter);
  return readRow(campaignId).filter((save) => save.encounterId === encounter.id && save.turn === key);
}

// A successful save in a fight, kept when it is one Vigilant Rebuke answers
// and a creature forced it.
export function recordSave(campaignId: string, characterId: string, ability: SaveAbility, forcer: { id: string; name: string } | null) {
  if (!forcer || !MENTAL.has(ability)) {
    return;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return;
  }
  const save: LastSave = { id: randomUUID(), characterId, ability, forcer, encounterId: encounter.id, turn: turnKey(encounter), at: nowIso() };
  writeRow(campaignId, [...openSaves(campaignId), save].slice(-16));
}

// A save answered: one reaction per save, and its card goes.
export function answerSave(campaignId: string, id: string) {
  writeRow(campaignId, openSaves(campaignId).filter((save) => save.id !== id));
}
