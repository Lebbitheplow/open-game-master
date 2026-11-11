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
// A save a player rolled at the GM's request is put to the foe whose turn it
// is (recordRequestedSave); on a character's own turn it has no forcer.
import { randomUUID } from "node:crypto";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getActiveEncounter, listEnemies, orderEntryId, turnKey, type Encounter, type OrderEntry } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getSheetById } from "@/lib/db/sheets";
import { textKey } from "@/lib/language/text-logic";

const db = () => getDatabase();

export type SaveAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";
type Ref = { id: string; name: string };

// The last five are read off the running turn, never written here
// (reaction-triggers.ts triggerRecords).
export type TriggerKind =
  | "save"
  | "death"
  | "turn_end"
  | "cast"
  | "pet_damage"
  | "steadied"
  | "echo_destroyed"
  | "inspired_success"
  | "moved_near"
  | "turn_start"
  | "weapon_hit"
  | "surge"
  | "wind_step"
  | "rage_entered"
  | "heal_roll"
  | "teleport";

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
  // The DC it was rolled against, for what tells this save's own conditions
  // from older ones (ar-ws-deflection-mark.ts beforeFailedSave).
  dc?: number;
  // What the save resisted ("charmed", "frightened"), when the engine knew.
  against?: string;
  // Damage the forcer dealt through the save (a spell's, with `spell`), or to
  // the pet. `spared`: how much of it a successful save would have spared,
  // where the door that dealt it knew (save-turned.ts gives it back).
  damage?: { amount: number; type: string; spell?: boolean; spared?: number };
  petName?: string;
  // A death: the creature's type ("humanoid", "beast"), and who struck it.
  creatureType?: string;
  killerId?: string | null;
  // A death: the square the creature stood on as it died, where a board held
  // it (its token goes with it; Master of Hexes measures from there).
  square?: { x: number; y: number };
  // A cast: the spell, its level, and who it was aimed at.
  spell?: string;
  level?: number;
  targets?: string[];
  // A turn's end: whether an enemy's (or a character's) turn it was. A cast:
  // whether an enemy cast it (false for a character's own casting).
  enemy?: boolean;
  // How it came about: a steadying's "death save", "spare the dying",
  // "medicine" or "kit"; an inspired success's roll ("attack", "save", "check").
  how?: string;
  // A move near a character: how far the mover stood from them before the
  // move and at its nearest along the way, in feet.
  fromFeet?: number;
  feet?: number;
  // A healing spell's dice (kind heal_roll, ar-ws-empowered-healing.ts): the
  // roll's own row, and the hit points the healed creature had before it.
  rollId?: string;
  hpBefore?: number;
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
// The entry the pointer is on: who is up, asking nothing of whether it is
// anyone's own turn (held-turn.ts ownTurnOf asks that).
function upNow(encounter: Encounter): OrderEntry | null {
  return encounter.order[encounter.turnIndex] ?? null;
}

export function actedThisTurn(encounter: Encounter): boolean {
  const current = upNow(encounter);
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

// When the turn now running began: the moment the pointer left the one before
// it (a turn's end is kept under the ending turn's key). Null before any turn
// of this fight has ended. Arcane Deflection reads it to tell a save failed
// this turn from an older one on the roll record (ar-ws-deflection.ts).
export function turnBeganAt(campaignId: string): string | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  return readRow(campaignId).filter((record) => record.encounterId === encounter.id && kindOf(record) === "turn_end").at(-1)?.at ?? null;
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
export function recordSave(campaignId: string, characterId: string, ability: SaveAbility, forcer: Ref | null, success = true, against?: string, dc?: number) {
  if (!forcer) {
    return;
  }
  append(campaignId, { kind: "save", characterId, ability, forcer, success, ...(against ? { against } : {}), ...(dc !== undefined ? { dc } : {}) });
}

// A save the GM asked a player to roll (request_roll, invoke-roll.ts), made
// or failed: request_roll names no creature, so in a fight the save is put to
// the creature whose turn it is when that is a foe's (its spell or its
// ability forced it). On a character's own turn there is no forcer to name,
// and the save is kept by nobody, as one with no forcer always was.
export function recordRequestedSave(campaignId: string, characterId: string, ability: string | undefined, success: boolean) {
  const encounter = getActiveEncounter(campaignId);
  const current = encounter && (encounter.kind ?? "fight") === "fight" ? upNow(encounter) : null;
  const key = textKey(ability ?? "").slice(0, 3) as SaveAbility;
  if (!encounter || !current || current.kind === "pc" || !["str", "dex", "con", "int", "wis", "cha"].includes(key)) {
    return;
  }
  const id = orderEntryId(current);
  const enemy = listEnemies(encounter.id).find((entry) => entry.id === id);
  if (!enemy) {
    return;
  }
  recordSave(campaignId, characterId, key, { id: enemy.id, name: enemy.displayName }, success);
}

// The damage the creature that forced a save dealt through it (cast-at-player.ts),
// put on that save: Hellish Rebuke answers "being damaged by a creature", and a
// spell's failed save leaves no hit record.
export function noteSaveDamage(campaignId: string, characterId: string, forcerId: string, amount: number, type: string, spell = false, spared?: number) {
  if (amount <= 0) {
    return;
  }
  const rows = readRow(campaignId);
  const open = new Set(openSaves(campaignId).map((record) => record.id));
  const at = rows.map((record, index) => ({ record, index })).reverse().find(({ record }) => open.has(record.id) && record.characterId === characterId && record.forcer.id === forcerId)?.index;
  if (at === undefined) {
    return;
  }
  const sparedNow = spared === undefined ? rows[at].damage?.spared : (rows[at].damage?.spared ?? 0) + Math.max(0, spared);
  rows[at] = { ...rows[at], damage: { amount: (rows[at].damage?.amount ?? 0) + amount, type: type || rows[at].damage?.type || "", ...(spell || rows[at].damage?.spell ? { spell: true } : {}), ...(sparedNow !== undefined ? { spared: sparedNow } : {}) } };
  writeRow(campaignId, rows);
}

// A failed save made a success after it landed (save-turned.ts): the record
// says so, and holds nothing more to give back.
export function markSaveTurned(campaignId: string, id: string) {
  const rows = readRow(campaignId);
  writeRow(campaignId, rows.map((record) => (record.id === id ? { ...record, success: true, ...(record.damage ? { damage: { ...record.damage, spared: 0 } } : {}) } : record)));
}

// The kinds written to the record, each where it happens. A feature that
// answers one of these reads it through src/lib/srd/trigger-table.ts; a new
// event a reaction waits for is a kind here and a writer at the one door
// where the engine makes it happen, never a check of the call's word.
//   death             a creature died (enemy-damage.ts); `killerId` struck the blow
//   turn_end          a turn ended (recordTurnEnd)
//   cast              `forcer` cast `spell` at `characterId` (cast-at-player.ts
//                     for an enemy's, recordCast for a character's)
//   pet_damage        `characterId`'s pet took `damage` (pet-tools.ts)
//   steadied          `characterId` was steadied by `forcer` (recordSteadied)
//   echo_destroyed    `characterId`'s echo was destroyed by `forcer` (authored-reactions.ts)
//   inspired_success  `characterId` made a roll succeed with `forcer`'s
//                     Bardic Inspiration die (after-roll.ts)
//   moved_near        `forcer` moved to within `feet` of `characterId` from
//                     `fromFeet` (map-tools.ts move_token, recordMovesNear)
//   heal_roll         `forcer` rolled a spell's healing dice for `characterId`
//                     (heal-spell.ts; ar-ws-empowered-healing.ts)
//   teleport          `forcer` teleported from `square` (map-tools.ts
//                     handleTeleportToken, feature-move.ts): an enemy, with `enemy`
export type RecordedKind = "death" | "turn_end" | "cast" | "pet_damage" | "steadied" | "echo_destroyed" | "inspired_success" | "moved_near" | "heal_roll" | "teleport";
export function recordTrigger(
  campaignId: string,
  record: { kind: RecordedKind; characterId?: string; forcer: Ref } & Partial<Pick<LastSave, "damage" | "petName" | "creatureType" | "killerId" | "square" | "spell" | "level" | "targets" | "enemy" | "how" | "fromFeet" | "feet" | "rollId" | "hpBefore">>,
  turn?: string,
): LastSave | null {
  return append(campaignId, { ability: "con", characterId: "", ...record }, turn);
}

// A record out of a fight, where no turn keeps one: the newest of its kind
// stands until it is answered or another of the kind is written. Only what a
// feature answers out of a fight is written here (a healing roll Empowered
// Healing rolls again, ar-ws-empowered-healing.ts); every reader of the
// fight's records reads one encounter's, so these are seen by none of them.
// A fight's first record clears it (append keeps that encounter's alone).
export const CALM = "";
// The kinds kept out of a fight (reaction-triggers.ts triggerRefusal asks these).
export const CALM_KINDS: readonly string[] = ["heal_roll"];

export function recordCalmTrigger(
  campaignId: string,
  record: { kind: RecordedKind; characterId?: string; forcer: Ref } & Partial<Pick<LastSave, "damage" | "spell" | "rollId" | "hpBefore">>,
): LastSave | null {
  if (getActiveEncounter(campaignId) || !CALM_KINDS.includes(record.kind)) {
    return null;
  }
  const kept = readRow(campaignId).filter((entry) => entry.encounterId === CALM && kindOf(entry) !== record.kind);
  const made: LastSave = { ability: "con", characterId: "", ...record, id: randomUUID(), encounterId: CALM, turn: CALM, at: nowIso() };
  writeRow(campaignId, [...kept, made].slice(-KEPT));
  return made;
}

// The open record of this kind out of a fight, or null (and null in one).
export function calmTrigger(campaignId: string, kind: RecordedKind): LastSave | null {
  if (getActiveEncounter(campaignId)) {
    return null;
  }
  return readRow(campaignId).filter((entry) => entry.encounterId === CALM && kindOf(entry) === kind && !(entry.answered ?? []).length).at(-1) ?? null;
}

// A character's spell at the characters it targets (cast-buff.ts, heal): one
// record per target, so a reaction the target takes (Voice of Authority)
// answers the casting that named them. A spell of no slot level is a cantrip
// (level 0). Written only in a fight, as every record is.
export function recordCast(campaignId: string, caster: Ref, spell: string, level: number, targetIds: readonly string[]) {
  const targets = [...new Set(targetIds.filter(Boolean))];
  for (const id of targets) {
    recordTrigger(campaignId, { kind: "cast", characterId: id, forcer: caster, spell, level, targets, enemy: false });
  }
}

// A creature's teleport, with the square it left: what answers a teleport
// (Magic-User's Nemesis) puts it back there. Every door a token teleports
// through writes it (map-tools.ts handleTeleportToken, feature-move.ts).
// Written only in a fight, as every record is.
export function recordTeleport(campaignId: string, mover: Ref, from: { x: number; y: number }, enemy: boolean) {
  recordTrigger(campaignId, { kind: "teleport", forcer: mover, square: from, enemy });
}

// A roll a Bardic Inspiration die made succeed (forced-save.ts settleHeldDie,
// the after-roll card's spend): `characterId` the roller, `forcer` the bard
// whose die it was, `how` the roll ("attack", "save", "check"). With no bard
// on the die (one given before the source was kept) nothing is written.
export function recordInspiredSuccess(campaignId: string, roller: Ref, bardId: string | null, how: string) {
  const bard = bardId ? getSheetById(bardId) : null;
  if (!bard || bard.id === roller.id) {
    return;
  }
  recordTrigger(campaignId, { kind: "inspired_success", characterId: roller.id, forcer: { id: bard.id, name: bard.name }, how });
}

// A dying creature steadied: their own death save succeeding (`by` is
// themselves, `how` "death save"), or another stabilizing them (stabilize.ts,
// `how` "spare the dying", "medicine" or "kit"). Defy Death answers it.
export function recordSteadied(campaignId: string, characterId: string, by: Ref, how: string) {
  recordTrigger(campaignId, { kind: "steadied", characterId, forcer: by, how });
}

// A turn ending, as the pointer leaves it: kept under the ending turn's key,
// so it opens once the pointer has moved on.
export function recordTurnEnd(campaignId: string, encounter: Pick<Encounter, "round">, ending: OrderEntry, name: string) {
  const turn = turnKey({ round: encounter.round, order: [ending], turnIndex: 0 });
  recordTrigger(campaignId, { kind: "turn_end", forcer: { id: orderEntryId(ending), name }, enemy: ending.kind !== "pc" }, turn);
}

// The turns of the enemies a pass held the floor for, ended as the hold
// releases (encounter-tools.ts handOnEnemyTurns): the pointer walked past
// them, so no move of it ends their turns, and a reaction to a creature
// ending its turn near (the Stone Rune, Skirmisher) had no record of one.
// In order of play, so the last of them is the turn's end left open.
export function recordEnemyTurnEnds(campaignId: string, encounter: Pick<Encounter, "id" | "round" | "order">, enemyIds: readonly string[]) {
  const alive = new Map(listEnemies(encounter.id).filter((enemy) => enemy.status === "alive").map((enemy) => [enemy.id, enemy.displayName]));
  for (const entry of encounter.order) {
    const id = orderEntryId(entry);
    if (entry.kind !== "pc" && enemyIds.includes(id) && alive.has(id)) {
      recordTurnEnd(campaignId, encounter, entry, alive.get(id)!);
    }
  }
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
