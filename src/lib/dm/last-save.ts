// The triggers of the turn under way that no hit record holds, kept for the
// reactions that answer them: a save made or failed and the creature that
// forced it (Vigilant Rebuke), damage a creature dealt through a save (Hellish
// Rebuke), a creature dying, a turn ending and with it the next one starting,
// a creature casting a spell at a character, damage to a pet. The table of
// what answers which is src/lib/srd/trigger-table.ts.
//
// A hit on a character is last-hit.ts's record; everything else a reaction
// answers is one of these, written by the engine where the event happens. A
// reaction asks reaction-triggers.ts, which reads both: it is offered when and
// only when its trigger is open, and refused with nothing spent when not.
// Before this only a successful mental save was kept, and every other trigger
// was taken on the word of the call: a reaction to damage, to a death or to
// another creature's hit was spent in a fight where nothing had happened.
//
// One row per campaign (the last_saves table, named for the first record it
// held) holds the events of the fight; one is open in the turn it happened, and
// a turn's end stays open into the next turn until its creature does anything.
// A save a player rolled at the GM's request carries no forcer, and the GM's
// call names the creature for it.
import { randomUUID } from "node:crypto";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getActiveEncounter, orderEntryId, turnKey, type Encounter, type OrderEntry } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";

const db = () => getDatabase();

export type SaveAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";
type Ref = { id: string; name: string };

// The last four are read off the running turn, never written here
// (reaction-triggers.ts triggerRecords).
export type TriggerKind = "save" | "death" | "turn_end" | "cast" | "pet_damage" | "turn_start" | "weapon_hit" | "surge" | "wind_step";

// One trigger. `characterId` is the character it befell (who saved, whose pet
// was hurt, who surged); `forcer` the creature that did it (forced the save,
// cast, died, ended its turn). Records written before `kind` are saves made.
export type LastSave = {
  id: string;
  kind?: TriggerKind;
  characterId: string;
  ability: SaveAbility;
  forcer: Ref;
  // A save's outcome; absent on records written before failures were kept.
  success?: boolean;
  // What the save resisted ("charmed", "frightened"), when the engine knew.
  against?: string;
  // Damage the forcer dealt through the save (a spell's, with `spell`), or to the pet.
  damage?: { amount: number; type: string; spell?: boolean };
  petName?: string;
  // A death: the creature's type ("humanoid", "beast"), and who struck it.
  creatureType?: string;
  killerId?: string | null;
  // A cast: the spell, its level, and who it was aimed at.
  spell?: string;
  level?: number;
  targets?: string[];
  // A turn's end: whether an enemy's (or a character's) turn it was.
  enemy?: boolean;
  // The reactions that answered it, by answer key (last-hit.ts answerKey).
  answered?: string[];
  encounterId: string;
  turn: string;
  at: string;
};

// The saves Vigilant Rebuke answers.
export const MENTAL: ReadonlySet<SaveAbility> = new Set(["int", "wis", "cha"]);
const KEPT = 32;

export const kindOf = (record: LastSave): TriggerKind => record.kind ?? "save";
export const savedIt = (record: LastSave): boolean => kindOf(record) === "save" && record.success !== false;

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

// Whether the creature whose turn it is has done anything with it yet: an
// attack, a cast, an action card, or a step on the board. A turn's end stays
// open to a reaction until then (last-hit.ts reads the same for a hit).
export function actedThisTurn(encounter: Encounter): boolean {
  const current = encounter.order[encounter.turnIndex];
  if (!current) {
    return false;
  }
  const id = orderEntryId(current);
  const budget = encounter.turnBudget;
  if (
    budget &&
    budget.ownerId === id &&
    budget.round === encounter.round &&
    (budget.actionUsed || budget.bonusUsed || budget.attacksMade > 0 || budget.dashed || budget.disengaged)
  ) {
    return true;
  }
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, id) : null;
  return Boolean(token && token.movedThisRound > 0);
}

// Every trigger still open in this fight, oldest first. A turn's end is open
// only while it is the last one, the pointer has moved past it, and the
// creature now up has not acted.
export function openTriggers(campaignId: string): LastSave[] {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return [];
  }
  const key = turnKey(encounter);
  const rows = readRow(campaignId).filter((record) => record.encounterId === encounter.id);
  const lastEnd = rows.filter((record) => kindOf(record) === "turn_end").at(-1);
  const endOpen = Boolean(lastEnd && lastEnd.turn !== key && !actedThisTurn(encounter));
  return rows.filter((record) => (kindOf(record) === "turn_end" ? record === lastEnd && endOpen : record.turn === key));
}

// The saves still open (made or failed), this fight, this turn.
export function openSaves(campaignId: string): LastSave[] {
  return openTriggers(campaignId).filter((record) => kindOf(record) === "save");
}

function append(campaignId: string, record: Omit<LastSave, "id" | "encounterId" | "turn" | "at">, turn?: string): LastSave | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  const kept = readRow(campaignId).filter((entry) => entry.encounterId === encounter.id);
  const made: LastSave = { ...record, id: randomUUID(), encounterId: encounter.id, turn: turn ?? turnKey(encounter), at: nowIso() };
  writeRow(campaignId, [...kept, made].slice(-KEPT));
  return made;
}

// A save in a fight forced by a creature (forced-save.ts rollCharacterSave),
// made or failed. One with no forcer answers nothing and is not kept.
export function recordSave(campaignId: string, characterId: string, ability: SaveAbility, forcer: Ref | null, success = true, against?: string) {
  if (!forcer) {
    return;
  }
  append(campaignId, { kind: "save", characterId, ability, forcer, success, ...(against ? { against } : {}) });
}

// The damage the creature that forced a save dealt through it (cast-at-player.ts),
// put on that save: Hellish Rebuke answers "being damaged by a creature", and a
// spell's failed save leaves no hit record.
export function noteSaveDamage(campaignId: string, characterId: string, forcerId: string, amount: number, type: string, spell = false) {
  if (amount <= 0) {
    return;
  }
  const rows = readRow(campaignId);
  const open = new Set(openSaves(campaignId).map((record) => record.id));
  const at = rows.map((record, index) => ({ record, index })).reverse().find(({ record }) => open.has(record.id) && record.characterId === characterId && record.forcer.id === forcerId)?.index;
  if (at === undefined) {
    return;
  }
  rows[at] = { ...rows[at], damage: { amount: (rows[at].damage?.amount ?? 0) + amount, type: type || rows[at].damage?.type || "", ...(spell || rows[at].damage?.spell ? { spell: true } : {}) } };
  writeRow(campaignId, rows);
}

// A trigger other than a save, written where it happens: a death
// (enemy-damage.ts), a turn's end (last-hit.ts closeHitsAtTurnEnd), a cast, a
// pet's damage (pet-tools.ts), an Action Surge (resource-turn.ts).
export function recordTrigger(campaignId: string, record: { kind: "death" | "turn_end" | "cast" | "pet_damage"; characterId?: string; forcer: Ref } & Partial<Pick<LastSave, "damage" | "petName" | "creatureType" | "killerId" | "spell" | "level" | "targets" | "enemy">>, turn?: string): LastSave | null {
  return append(campaignId, { ability: "con", characterId: "", ...record }, turn);
}

// A turn ending, as the pointer leaves it: kept under the ending turn's key,
// so it opens once the pointer has moved on.
export function recordTurnEnd(campaignId: string, encounter: Pick<Encounter, "round">, ending: OrderEntry, name: string) {
  const turn = turnKey({ round: encounter.round, order: [ending], turnIndex: 0 });
  recordTrigger(campaignId, { kind: "turn_end", forcer: { id: orderEntryId(ending), name }, enemy: ending.kind !== "pc" }, turn);
}

// A trigger answered: a save by one reaction and its card goes; another kind
// keeps who answered it, so each holder answers it once.
export function answerSave(campaignId: string, id: string, key?: string) {
  const rows = readRow(campaignId);
  const next = rows.flatMap((record) => {
    if (record.id !== id) return [record];
    if (kindOf(record) === "save" && !key) return [];
    return [{ ...record, answered: [...(record.answered ?? []), key ?? "answered"] }];
  });
  writeRow(campaignId, next);
}
