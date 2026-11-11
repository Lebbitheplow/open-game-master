// The last attack against each character, kept so a reaction can answer it.
//
// An enemy's attack is rolled and its damage applied in one call
// (src/lib/dm/enemy-attack.ts), so Shield, Uncanny Dodge, Deflect
// Missiles, Cutting Words and Protection, which the rules resolve against
// that attack, arrive after the damage has landed. Before this the tool text
// told the model to "heal the difference" or "narrate accordingly", and the
// sheet kept the full blow while the story said the attack missed.
//
// The record holds what re-resolving needs: every swing's roll (its d20
// faces, the total, the AC it met), the damage each hit rolled and its type,
// whether the attack was ranged, who made it, and the character as they
// stood before the first swing (hit points, temporary hit points, a beast
// form's pool, the death track, conditions, Relentless Endurance, Undying
// Sentinel, and the
// concentration the hit may have broken with the effects that went with
// it). src/lib/dm/reaction-refund.ts turns a corrected outcome back into
// state from it.
//
// Every hit still open on a character is kept, one row per character per
// campaign holding them in the order they landed: two enemies hitting the
// same hero in one AI reply (or one pass of the enemies) leave two hits, and
// a reaction answers the one its player picks (issue 685). A row written
// before that holds a single record and reads as a list of one. A hit
// answers a reaction only while it is fresh: in a fight, until an attack on
// anyone in a later GM turn or the first thing the next turn's creature does
// (freshLastHit); out of one, the last ten minutes. The table is made with
// the schema (src/lib/db/core.ts), so deleting a campaign can clear its rows.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { sheetSpellAuthors } from "@/lib/dm/spell-authors";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { latestSeq } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, orderEntryId, turnKey, type Encounter, type OrderEntry } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { currentTurnId, owningTurnOf } from "@/lib/dm/job-control";
import type { RollResult, Advantage } from "@/lib/dice";
import { listRecentRolls, type RollAttacker } from "@/lib/db/rolls";
import { spellMechanicsFor } from "@/lib/content";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { wardOf } from "@/lib/dm/arcane-ward";
import { actedThisTurn, recordTurnEnd } from "@/lib/dm/last-save";
import type { BlowFlags } from "@/lib/dm/pc-damage";

export type SwingRecord = {
  // The attack this swing was, when a multiattack swings several (a
  // scimitar then a dagger); absent reads the record's own.
  attack?: string;
  // The attack roll's total and the d20 faces it was made of.
  total: number;
  faces: number[];
  natural: number | null;
  advantage: Advantage;
  // The Armor Class it was compared against.
  vsAc: number;
  hit: boolean;
  crit: boolean;
  // Damage sent to the damage path on a hit, 0 on a miss, with the type it
  // was sent under (resistance applies there to that type) and whether the
  // swing was ranged. Absent type and ranged read the record's own.
  raw: number;
  type?: string;
  // A blow of several types, part by part as sent (enemy-hit.ts blowByType).
  parts?: Array<{ amount: number; type: string }>;
  ranged?: boolean;
  // A critical that came only from the target lying unconscious at 0 within
  // 5 ft (SRD 5.1): the blow as an ordinary hit, from the same dice
  // (encounter-logic.ts ordinaryOfCritical), for a reaction that leaves the
  // target standing when it landed (reaction-refund.ts). Absent on a natural
  // 20, which is critical whatever the target.
  ordinary?: { raw: number; parts?: Array<{ amount: number; type: string }> };
  // A critical the natural 20 alone made: the blow without its critical
  // dice, from the same roll (encounter-logic.ts ordinaryOfCritical). A
  // reaction that rolls the attack again and keeps a lower d20 that still
  // hits lands this instead (plainOfReroll). Absent on any other swing and on
  // records written before it.
  // `from` is the critical's damage as it landed, so what a reaction has since
  // taken off the blow comes off this too.
  plain?: { raw: number; parts?: Array<{ amount: number; type: string }>; from?: number };
  // Any critical's blow as a normal hit, from the same dice, for the reaction
  // that turns it into one (Sentinel at Death's Door). `from` is the critical's
  // raw as it landed: a reaction that cut the blow first cuts this in proportion.
  // Absent where the dice do not line up (ordinaryOfCritical) and on older records.
  normal?: { raw: number; type?: string; parts?: Array<{ amount: number; type: string }>; from: number };
  // What reactions took off the blow, in the order taken (cutBlow). A reaction
  // that turns the blow into another one (Sentinel at Death's Door's normal
  // hit, a reroll's plain one, the ordinary blow a standing target takes)
  // takes the same off that one (carryCuts): a halving halves it and a flat
  // cut takes the same amount, as the rules take each off whatever the attack
  // deals. Absent on a blow nothing cut and on older records.
  cuts?: BlowCut[];
  // The advantage the swing would have had against the target standing, when
  // it lay at 0 and that changed the roll (SRD 5.1, Unconscious: attack rolls
  // against it have advantage). A reaction that leaves them standing when it
  // landed reads the hit again with it (hit-replay-logic.ts hitsWith): the
  // blow went back to ordinary damage and kept the advantage it had only
  // because they were down.
  standingAdvantage?: Advantage;
  // A hit that was no critical, kept so a reaction that rolls the attack
  // again and comes up 20 (Runic Shield) can make it one: the damage roll as
  // it fell (its expression and dice), the critical damage variants in play,
  // the attack (for its typed parts), and what shrank the blow as it landed
  // (`scale`, the damage dealt over the damage rolled). Absent on a critical,
  // on attacks that keep none (only an enemy's enemy_attack does) and on
  // older records, which keep the hit as it was.
  critical?: CriticalRecipe;
  // What the blow was made of, as the damage path read it (a magic weapon, a
  // feature its resistance did not hold against), so a replay meets the same
  // clauses (pc-damage.ts blowDefenses).
  flags?: BlowFlags;
  // Resistance a reaction gave against this blow (Absorb Elements' type).
  resists?: string[];
  // The concentration save this swing's damage asked, when the character was
  // concentrating as it landed: the save's total (null when none was rolled,
  // as for a drop to 0, which ends it outright) and whether concentration
  // ended with it. SRD 5.1: a separate save for each source of damage, so a
  // reaction judges the one blow that broke it, not the whole attack.
  concentration?: { save: number | null; broke: boolean };
};

export type CriticalRecipe = {
  expression: string;
  terms: RollResult["terms"];
  powerful?: boolean;
  doubleFlat?: boolean;
  attack: string;
  scale: number;
  from: number;
};

// A flat amount off the blow (Cutting Words, Deflect Missiles, Parry), or half
// of it rounded down (Uncanny Dodge, a resistance) or up (the half an ally
// keeps of a split blow).
export type BlowCut = number | "half" | "half_up";

function cutOf(raw: number, cut: BlowCut): number {
  return cut === "half" ? Math.floor(raw / 2) : cut === "half_up" ? Math.ceil(raw / 2) : Math.max(0, raw - cut);
}

// The swing with a reaction's cut taken off its damage, the cut kept with it.
export function cutBlow(swing: SwingRecord, cut: BlowCut): SwingRecord {
  return { ...swing, raw: cutOf(swing.raw, cut), cuts: [...(swing.cuts ?? []), cut] };
}

// Another figure of the same blow (its normal, plain or ordinary damage, as
// rolled) with the swing's cuts taken off it in their order. `from` is the
// blow's own damage before any cut. Null when the cuts on record do not lead
// from `from` to the damage the swing holds (a record written before they were
// kept, or a cut no reaction recorded): the caller keeps its own reading.
export function carryCuts(swing: SwingRecord, figure: number, from: number): number | null {
  const cuts = swing.cuts ?? [];
  return cuts.reduce(cutOf, from) === swing.raw ? cuts.reduce(cutOf, figure) : null;
}

export type HolderSnapshot = {
  kind: "sheet" | "enemy";
  id: string;
  conditions: string[];
  meta: Record<string, unknown>;
};

export type VitalsSnapshot = {
  currentHp: number;
  tempHp: number;
  wildShape: CharacterSheet["wildShape"];
  conditions: string[];
  conditionMeta: CharacterSheet["conditionMeta"];
  deathSaves: CharacterSheet["deathSaves"] | null;
  relentless: { max: number; used: number } | null;
  // Relentless Rage's uses since the last rest, which raise its DC: given
  // back with the drop that spent one. Absent on records written before it.
  relentlessRage?: number | null;
  // Undying Sentinel's uses spent, for the same refund.
  undyingSentinel?: number | null;
  // Blazing Revival's and Strength of the Grave's, likewise (pc-damage.ts).
  blazingRevival?: number | null;
  strengthOfTheGrave?: number | null;
  // An abjurer's Arcane Ward's hit points, which take a blow first; null
  // with no ward raised. Absent on records written before it.
  ward?: number | null;
  concentratingOn: string | null;
  // The conditions the concentration spell held on every creature, so a
  // hit that is undone can put back what breaking it took away.
  held: { spell: string; names: string[]; holders: HolderSnapshot[] } | null;
};

export type LastHit = {
  // The hit's own id, which a reaction names to answer it (hitIdOf). Absent
  // on records written before a character could hold several.
  id?: string;
  characterId: string;
  encounterId: string | null;
  // The turn it landed in (turnKey), "" out of a fight.
  turn: string;
  // Whether it landed in the enemies' turns before the character up next
  // (enemiesTakingTurns): the pointer already names that character, so the
  // turn key alone does not change when their turn begins. Absent on
  // records written before it, read as false.
  enemyTurns?: boolean;
  // Set once the next turn's creature has ended its turn
  // (closeHitsAtTurnEnd): the moment to answer it has gone by.
  closed?: true;
  // The GM turn that rolled it (src/lib/dm/job-control.ts currentTurnId):
  // one AI reply, or one call from the console. Absent out of any turn and
  // on records written before it.
  dmTurn?: string;
  // The record as it stood before a later GM turn's reaction rewrote it (its
  // swings, its answers), one entry a turn, so reverting that turn puts the
  // hit back (forgetTurnAnswers). Absent until a reaction answers it.
  undo?: Array<{ turnId: string; was: LastHit }>;
  // Who made it: an enemy, a character fighting on the other side (a
  // turncoat's pc_attack, issue 503), or a hazard, which is nobody.
  attacker: { kind: "enemy" | "sheet" | "hazard"; id: string | null; name: string };
  attack: string;
  type: string;
  ranged: boolean;
  // What made the damage: an attack (with swings), a fall, or a spell's
  // missiles that hit without a roll (Magic Missile, which Shield answers:
  // SRD 5.1, "when you are hit by an attack or targeted by the magic missile
  // spell").
  // "effect": damage from no attack and no fall (a spell's save, a hazard,
  // harm the GM applies by name), kept so a reaction to damage taken answers
  // it (openEffect). Only a reader that asks for it by source, or for any
  // damage, takes one: it is nobody's attack.
  source: "attack" | "fall" | "missile" | "effect";
  swings: SwingRecord[];
  before: VitalsSnapshot;
  // Where the hit left them. `track` and `ward` are absent on records
  // written before they were kept.
  after: { currentHp: number; tempHp: number; beastHp: number | null; track?: CharacterSheet["deathSaves"] | null; ward?: number | null };
  // The campaign's sequence number (allocateSeq) as the attack began and as
  // it was recorded: the sheet changes between them are the hit's own, and
  // those after it until the next hit began are the gap a reaction's replay
  // carries, in their order (reaction-refund.ts). Absent on records written
  // before it, which are read by their times.
  seqs?: { open: number; close: number };
  // The reactions already answered with it, so one cannot be taken twice.
  answered: string[];
  // When the attack began (the first swing) and when it was recorded.
  startedAt: string;
  at: string;
};

// Who rolls the recorded attack again (Protection and its kin): the enemy
// that made it; a hazard is nobody.
export function rerollAttacker(record: LastHit): RollAttacker | null {
  const id = attackerFoeId(record);
  return id && (record.attacker.kind === "enemy" || record.attacker.kind === "sheet")
    ? { kind: record.attacker.kind, id, name: record.attacker.name }
    : null;
}

// The creature that made the recorded attack, by combatant id (an enemy row
// or a character's sheet), for the reactions that answer it; null for a
// hazard. Read it through resolveTargetFoe (sheet-foe.ts).
export function attackerFoeId(record: Pick<LastHit, "attacker"> | null | undefined): string | null {
  const attacker = record?.attacker;
  return attacker && (attacker.kind === "enemy" || attacker.kind === "sheet") && attacker.id ? attacker.id : null;
}

// A swing rolled again (Warding Flare, Shadowy Dodge, Protection) whose kept
// d20 still hits: a critical the natural 20 alone made is no longer one when
// the d20 kept is not a 20, and the blow lands without its critical dice (SRD
// 5.1, Critical Hits: "If the d20 roll for an attack is a 20"). A record
// written before the plain blow was kept stays as it was. A reaction that has
// already cut the blow (Uncanny Dodge, Cutting Words) cuts the plain blow the
// same way (carryCuts); a record that kept no cuts takes the amount it lost.
export function plainOfReroll(swing: SwingRecord, kept: number): SwingRecord {
  if (!swing.crit || kept === 20 || !swing.plain) {
    return swing;
  }
  const { plain, ...rest } = swing;
  const from = plain.from ?? swing.raw;
  const raw = carryCuts(swing, plain.raw, from) ?? Math.max(0, plain.raw - Math.max(0, from - swing.raw));
  const next: SwingRecord = { ...rest, crit: false, raw };
  delete next.parts;
  return plain.parts ? { ...next, parts: plain.parts } : next;
}

// The hit swing a one-attack reaction answers (Uncanny Dodge, Deflect
// Missiles, Cutting Words, Protection): the heaviest one, the first of
// equals (a multiattack is several attacks; the reaction takes one). -1 when
// none hit. The reaction prompt (src/lib/db/encounter-view.ts) names this
// same swing and its damage.
export function heaviestHit(swings: SwingRecord[], which: (swing: SwingRecord) => boolean = () => true): number {
  let best = -1;
  swings.forEach((swing, index) => {
    if (swing.hit && which(swing) && (best < 0 || swing.raw > swings[best].raw)) {
      best = index;
    }
  });
  return best;
}

// An answer on a hit, keyed by the reaction and the one who took it, so a
// second holder of the same feature (two Rune Knights, two Lore bards) can
// answer the hit as well, and neither the same hit twice. A key written
// before holders were kept is the bare reaction, and answers for everyone.
export function answerKey(label: string, holderId: string): string {
  return `${label}@${holderId}`;
}

// The reaction an answer key names, without its holder.
export function answerLabel(key: string): string {
  const at = key.lastIndexOf("@");
  return at > 0 ? key.slice(0, at) : key;
}

// Whether the hit holds this answer: the key itself, or the bare reaction an
// older record kept.
export function answeredBy(record: Pick<LastHit, "answered">, key: string): boolean {
  return record.answered.includes(key) || record.answered.includes(answerLabel(key));
}

// Whether a swing is a critical that can become a normal hit: its normal
// figure is on record, and it is not a critical only for the target lying at 0
// when a reaction has since left them standing as it landed, which the replay
// already deals as ordinary (reaction-refund.ts).
export function critTurnsNormal(record: Pick<LastHit, "before">, swing: SwingRecord): boolean {
  const standing = record.before.currentHp > 0 || Boolean(record.before.wildShape);
  return swing.hit && swing.crit && Boolean(swing.normal) && !(swing.ordinary && standing);
}

const db = getDatabase;

// A hit's id: its own, or for a record written before hits carried one, the
// moment it was recorded, which no other hit on that character shares.
export function hitIdOf(record: Pick<LastHit, "id" | "at">): string {
  return record.id ?? record.at;
}

// The hits a row holds, oldest first: a list, or a single record from
// before a character could hold several.
function hitsIn(payload: string): LastHit[] {
  const parsed = parseJson<LastHit | LastHit[] | null>(payload, null);
  return Array.isArray(parsed) ? parsed.filter(Boolean) : parsed ? [parsed] : [];
}

function readHits(campaignId: string, characterId: string): LastHit[] {
  const row = db()
    .prepare(`SELECT payload_json FROM last_hits WHERE campaign_id = ? AND character_id = ?`)
    .get(campaignId, characterId) as { payload_json: string } | undefined;
  return row ? hitsIn(row.payload_json) : [];
}

// The newest hit kept on a character, open or not.
export function readLastHit(campaignId: string, characterId: string): LastHit | null {
  return readHits(campaignId, characterId).at(-1) ?? null;
}

// The row's created_at is its newest hit's, so attackedSince can skip rows
// with nothing later than the hit it asks about.
function saveHits(campaignId: string, characterId: string, hits: LastHit[]) {
  const newest = hits.reduce((latest, record) => (record.at > latest ? record.at : latest), "");
  db()
    .prepare(
      `INSERT INTO last_hits (campaign_id, character_id, payload_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (campaign_id, character_id)
       DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
    )
    .run(campaignId, characterId, JSON.stringify(hits), newest);
}

const FRESH_MS = 10 * 60 * 1000;
// More hits than one pass of enemies deals to one character is never open at
// once; the oldest go first past it.
const MAX_KEPT = 16;

// Whether a kept hit stays in the row beside a newer one: not closed, in the
// same fight (or both out of any fight, within the ten minutes).
function stillKept(record: LastHit, next: LastHit): boolean {
  if (record.closed || record.encounterId !== next.encounterId) {
    return false;
  }
  return next.encounterId !== null || Date.parse(next.at) - Date.parse(record.at) <= FRESH_MS;
}

// Writes a hit: a new one joins the character's open hits, and one already
// kept (a reaction answered it, a turn's end closed it) is replaced in place.
export function writeLastHit(campaignId: string, record: LastHit) {
  const id = hitIdOf(record);
  const hits = readHits(campaignId, record.characterId);
  const at = hits.findIndex((entry) => hitIdOf(entry) === id);
  const next =
    at >= 0
      ? hits.map((entry, index) => (index === at ? withUndo(entry, record) : entry))
      : [...hits.filter((entry) => stillKept(entry, record)), record].slice(-MAX_KEPT);
  saveHits(campaignId, record.characterId, next);
}

// A hit rewritten by a GM turn other than the one that made it keeps what it
// was, once for that turn: "Revert this turn" puts it back, answers and all.
// A hit its own turn rewrites needs none (forgetTurnHits drops it whole).
function withUndo(was: LastHit, next: LastHit): LastHit {
  const turnId = rollingTurn().dmTurn;
  const undo = was.undo ?? [];
  if (!turnId || turnId === was.dmTurn || undo.some((entry) => entry.turnId === turnId)) {
    return { ...next, ...(undo.length ? { undo } : {}) };
  }
  const plain: LastHit = { ...was };
  delete plain.undo;
  return { ...next, undo: [...undo, { turnId, was: plain }] };
}

// What a reverted GM turn's reactions did to the hits they answered, taken
// back: each hit as it stood before that turn rewrote it, with the answers
// it held then (a later turn's on top of it go with it).
export function forgetTurnAnswers(campaignId: string, turnId: string) {
  const rows = db()
    .prepare(`SELECT character_id, payload_json FROM last_hits WHERE campaign_id = ?`)
    .all(campaignId) as Array<{ character_id: string; payload_json: string }>;
  for (const row of rows) {
    const hits = hitsIn(row.payload_json);
    let changed = false;
    const next = hits.map((record) => {
      const at = record.undo?.findIndex((entry) => entry.turnId === turnId) ?? -1;
      if (at < 0) return record;
      changed = true;
      const earlier = record.undo!.slice(0, at);
      return { ...record.undo![at].was, ...(earlier.length ? { undo: earlier } : {}) };
    });
    if (changed) saveHits(campaignId, row.character_id, next);
  }
}

// Whether the enemies a pass walked past are taking their turns: held for
// (src/lib/dm/enemies-due.ts), or handed to the model's own end_turn to play
// in its reply. The pointer already rests on the character up next.
function enemiesTakingTurns(encounter: Pick<Encounter, "legendary">): boolean {
  return Boolean(encounter.legendary.due?.length || encounter.legendary.handoff);
}

// The GM turn the work running now is filed under, if any.
function rollingTurn(): { dmTurn?: string } {
  const turnId = currentTurnId();
  return turnId ? { dmTurn: owningTurnOf(turnId) } : {};
}

// Whether an attack on anyone (this character too) was recorded after this
// one, in a later go. The attacks one GM turn rolls (the AI's whole reply,
// every enemy in it, or the monsters a person's "Play the rest" plays) land
// before any player sees the first: closed by the next of them, a hit on the
// first hero in the pass was never answerable, and only the last hero hit
// was offered Shield or Uncanny Dodge (issue 685). A hit with no GM turn
// (out of any) is closed by any later one, as the one record it once was
// was replaced by it.
function attackedSince(campaignId: string, record: LastHit): boolean {
  const id = hitIdOf(record);
  const later = db()
    .prepare(`SELECT payload_json FROM last_hits WHERE campaign_id = ? AND created_at > ?`)
    .all(campaignId, record.at) as Array<{ payload_json: string }>;
  return later.some((row) =>
    hitsIn(row.payload_json).some(
      // Damage from no attack (openEffect) is nobody's next attack: it closes nothing.
      (other) => hitIdOf(other) !== id && other.source !== "effect" && other.at > record.at && (!record.dmTurn || other.dmTurn !== record.dmTurn),
    ),
  );
}

// The record a reaction may still answer, or null: the same encounter, and
// in a fight the moment after it. SRD 5.1: a reaction is taken right after
// its trigger, and a creature's reaction comes back at the start of its
// turn. The pointer rests on the character up next while the enemies before
// them take their turns, so a hit then stayed answerable through the other
// enemies' attacks and that character's whole turn after them: late, and
// once their turn began, a second reaction in a round. So it closes at the
// next attack on anyone in a later go (attackedSince: the attacks of one AI
// reply leave each other open), or once the next turn's creature does its first
// thing (an attack, a cast, an action card, a step, ending the turn). The
// enemies' turns ending closes nothing: the player hit has the time until
// somebody acts to read the hit and answer it, at an AI table after the
// reply that told it, at a person's table after the GM hands the turn on.
// Out of a fight, the last ten minutes.
function isFresh(campaignId: string, record: LastHit, encounter: Encounter | null): boolean {
  if ((encounter?.id ?? null) !== record.encounterId) {
    return false;
  }
  if (encounter) {
    if (record.closed || attackedSince(campaignId, record)) {
      return false;
    }
    const sameTurn = turnKey(encounter) === record.turn && Boolean(record.enemyTurns) === enemiesTakingTurns(encounter);
    // A later turn's enemies close it only by attacking (above).
    if (sameTurn || enemiesTakingTurns(encounter)) {
      return true;
    }
    return !actedThisTurn(encounter);
  }
  return Date.now() - Date.parse(record.at) <= FRESH_MS;
}

// Whether a hit of the enemies' pass before the character whose turn it is
// is still open to a reaction: one that landed while the pointer already
// named them and the enemies took their turns (src/lib/dm/held-turn.ts).
export function passHitsOpen(campaignId: string, encounter: Encounter): boolean {
  const key = turnKey(encounter);
  const rows = db().prepare(`SELECT character_id FROM last_hits WHERE campaign_id = ?`).all(campaignId) as Array<{ character_id: string }>;
  return rows.some((row) => openHits(campaignId, row.character_id).some((record) => record.enemyTurns && record.turn === key));
}

// Whether a reaction the character takes now belongs before their turn
// (src/lib/dm/held-turn.ts): the pointer names them, their turn has begun,
// and a hit of the enemies' pass before it is still open.
export function lateFor(campaignId: string, encounter: Encounter, id: string): boolean {
  const current = encounter.order[encounter.turnIndex];
  return (
    current?.kind === "pc" &&
    current.characterId === id &&
    encounter.legendary.turnStart !== id &&
    !encounter.legendary.due?.length &&
    !encounter.legendary.handoff &&
    passHitsOpen(campaignId, encounter)
  );
}

// Whether the character already answered that pass after their turn began:
// one reaction for it, though their turn has given theirs back. The engine
// refuses a second (reaction-tools.ts), and the Hand reads it as spent
// (encounter-view.ts), so it offers none.
export function reactedLate(campaignId: string, encounter: Encounter, id: string): boolean {
  const late = encounter.legendary.lateReacted;
  return Boolean(late && late.turn === turnKey(encounter) && late.ids.includes(id) && lateFor(campaignId, encounter, id));
}

// Every hit on the character a reaction may still answer, oldest first.
export function openHits(campaignId: string, characterId: string): LastHit[] {
  const hits = readHits(campaignId, characterId);
  if (!hits.length) {
    return [];
  }
  const encounter = getActiveEncounter(campaignId);
  return hits.filter((record) => isFresh(campaignId, record, encounter));
}

// The hit a use_reaction call answers, named by its player: its id
// (hitIdOf), or the creature that made it (an enemy's id, or a sheet's for a
// character fighting on the other side). Held for the whole call
// (src/lib/dm/reaction-tools.ts handleUseReaction), so every lookup in it,
// the reaction gate's and a use_resource counter's included, answers that
// same hit; a lookup about another character than the one it names goes on
// as if nothing were named.
const aims = new AsyncLocalStorage<string>();

export function withHitAim<T>(aim: string | null | undefined, run: () => T): T {
  return aims.run(aim?.trim() ?? "", run);
}

// The hit an aim names among a character's open hits: every one it matches
// (an attacker may have made several), or null when it names none of them.
function aimedAmong(open: LastHit[], aim: string): LastHit[] | null {
  if (!aim) {
    return null;
  }
  const matched = open.filter((record) => hitIdOf(record) === aim || (record.attacker.id !== null && record.attacker.id === aim));
  return matched.length ? matched : null;
}

// Which of several open hits a reaction answers when its player named none:
// the latest (as the one record a character once held was), the earliest
// (Shield, whose +5 then covers every hit after it too), or the one that
// weighs most to it (Uncanny Dodge halves the heaviest blow).
export type HitPreference = "latest" | "earliest" | ((record: LastHit) => number);

function preferred(records: LastHit[], prefer: HitPreference): LastHit | null {
  if (!records.length) {
    return null;
  }
  if (prefer === "latest") {
    return records[records.length - 1];
  }
  if (prefer === "earliest") {
    return records[0];
  }
  // Ties go to the later hit.
  return records.reduce((best, record) => (prefer(record) >= prefer(best) ? record : best));
}

// The hit a reaction answers, or null: among the character's open hits that
// `which` takes (all of them by default), the one the call is aimed at
// (withHitAim), else the one `prefer` picks. An aim naming one of this
// character's hits that `which` refuses answers nothing: the reaction does
// not fit the hit its player picked, and another is not taken in its place.
export function freshLastHit(
  campaignId: string,
  characterId: string,
  which?: (record: LastHit) => boolean,
  prefer: HitPreference = "latest",
): LastHit | null {
  const open = openHits(campaignId, characterId);
  const aimed = aimedAmong(open, aims.getStore() ?? "");
  // Asked for with no test of its own, "the last hit" is an attack or a fall,
  // never an effect's damage (which a reader names by its source).
  const fits = which ?? ((record: LastHit) => record.source !== "effect");
  return preferred((aimed ?? open).filter(fits), prefer);
}

// The open hit an aim names on one character, or on anyone in the campaign,
// for a use_reaction call to check before anything is spent: null when it
// names none.
export function openHitAimed(campaignId: string, aim: string, characterId?: string): LastHit | null {
  const rows = characterId
    ? [{ character_id: characterId }]
    : (db().prepare(`SELECT character_id FROM last_hits WHERE campaign_id = ?`).all(campaignId) as Array<{ character_id: string }>);
  for (const row of rows) {
    const found = aimedAmong(openHits(campaignId, row.character_id), aim.trim());
    if (found) {
      return found[found.length - 1];
    }
  }
  return null;
}

// The heaviest hit swing a record holds, for HitPreference: the blow a
// one-attack reaction answers in it (heaviestHit).
export function heaviestRaw(record: LastHit, which: (swing: SwingRecord) => boolean = () => true): number {
  const index = heaviestHit(record.swings, which);
  return index >= 0 ? record.swings[index].raw : -1;
}

// A creature's turn is ending (src/lib/dm/encounter-tools.ts advancePointer):
// every hit still open in the fight closes, except one that landed in that
// creature's own turn, which the creature after it may still let pass.
// Ending the turn is the last thing the next turn's creature can do first.
// It is also the trigger the reactions to a turn's end, and to the next
// turn's start, answer: kept with the others a hit record does not hold
// (last-save.ts).
export function closeHitsAtTurnEnd(campaignId: string, encounter: Pick<Encounter, "id" | "round">, ending: OrderEntry) {
  const endingKey = turnKey({ round: encounter.round, order: [ending], turnIndex: 0 });
  const endingId = orderEntryId(ending);
  const name = ending.kind === "pc" ? (getSheetById(endingId)?.name ?? "a character") : (listEnemies(encounter.id).find((enemy) => enemy.id === endingId)?.displayName ?? "a creature");
  recordTurnEnd(campaignId, encounter, ending, name);
  const rows = db()
    .prepare(`SELECT character_id, payload_json FROM last_hits WHERE campaign_id = ?`)
    .all(campaignId) as Array<{ character_id: string; payload_json: string }>;
  for (const row of rows) {
    const hits = hitsIn(row.payload_json);
    let changed = false;
    const next = hits.map((record) => {
      if (record.closed || record.encounterId !== encounter.id || (record.turn === endingKey && !record.enemyTurns)) {
        return record;
      }
      changed = true;
      return { ...record, closed: true as const };
    });
    if (changed) {
      saveHits(campaignId, row.character_id, next);
    }
  }
}

// "Revert this turn" (src/app/api/campaigns/[campaignId]/audit/revert-turn)
// takes the turn's blows back: their hits go too, as if never landed. Left,
// they stayed open, so a Shield after the revert "turned" a blow whose
// damage the revert had already given back and healed the hero on top of
// it, and they still closed the hits of the turns before them.
export function forgetTurnHits(campaignId: string, turnId: string) {
  const rows = db()
    .prepare(`SELECT character_id, payload_json FROM last_hits WHERE campaign_id = ?`)
    .all(campaignId) as Array<{ character_id: string; payload_json: string }>;
  for (const row of rows) {
    const hits = hitsIn(row.payload_json);
    const kept = hits.filter((record) => record.dmTurn !== turnId);
    if (kept.length === hits.length) {
      continue;
    }
    if (kept.length) {
      saveHits(campaignId, row.character_id, kept);
    } else {
      db().prepare(`DELETE FROM last_hits WHERE campaign_id = ? AND character_id = ?`).run(campaignId, row.character_id);
    }
  }
}

function concentrationHeld(
  campaignId: string,
  sheet: CharacterSheet,
): VitalsSnapshot["held"] {
  const spell = sheet.concentratingOn;
  if (!spell) {
    return null;
  }
  const resolved = spellMechanicsFor({ spell, userIds: sheetSpellAuthors(sheet) });
  const names = [
    resolved?.mech.buff?.condition,
    ...(resolved?.mech.buff?.variants ?? []),
    resolved?.mech.condition?.name,
  ]
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase());
  if (!names.length) {
    return { spell, names, holders: [] };
  }
  const holders: HolderSnapshot[] = [];
  for (const other of listSheets(campaignId)) {
    if (other.conditions.some((entry) => names.includes(entry.toLowerCase()))) {
      holders.push({ kind: "sheet", id: other.id, conditions: other.conditions, meta: other.conditionMeta });
    }
  }
  const encounter = getActiveEncounter(campaignId);
  for (const enemy of encounter ? listEnemies(encounter.id) : []) {
    if (enemy.conditions.some((entry) => names.includes(entry.toLowerCase()))) {
      holders.push({ kind: "enemy", id: enemy.id, conditions: enemy.conditions, meta: enemy.conditionMeta });
    }
  }
  return { spell, names, holders };
}

// The Arcane Ward's hit points as a blow meets them, null with none raised.
export function wardHpOf(sheet: CharacterSheet): number | null {
  const ward = wardOf(sheet);
  return ward?.raised ? ward.hp : null;
}

export function snapshotVitals(campaignId: string, sheet: CharacterSheet): VitalsSnapshot {
  const relentless = sheet.resources?.relentless_endurance ?? null;
  return {
    currentHp: sheet.currentHp,
    tempHp: sheet.tempHp,
    wildShape: sheet.wildShape ?? null,
    conditions: [...sheet.conditions],
    conditionMeta: { ...sheet.conditionMeta },
    deathSaves: sheet.deathSaves ?? null,
    relentless: relentless ? { max: relentless.max, used: relentless.used } : null,
    relentlessRage: sheet.resources?.relentless_rage?.used ?? null,
    undyingSentinel: sheet.resources?.sub_undying_sentinel?.used ?? null,
    blazingRevival: sheet.resources?.sub_blazing_revival?.used ?? null,
    strengthOfTheGrave: sheet.resources?.sub_strength_of_the_grave?.used ?? null,
    ward: wardHpOf(sheet),
    concentratingOn: sheet.concentratingOn ?? null,
    held: concentrationHeld(campaignId, sheet),
  };
}

// A new hit's id: short, since the model reads it in GAME STATE and sends
// it back, and unique among the few hits open at once.
function newHitId(): string {
  return `h${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

// The d20 faces of an attack roll, as the dice engine stored them.
export function d20FacesOf(outcome: RollResult): number[] {
  const term = outcome.terms.find((entry) => entry.kind === "dice" && entry.sides === 20);
  return term && term.kind === "dice" ? term.dice.map((die) => die.value) : [];
}

// Opened before an attack's first swing and closed after its last, by the
// code that rolled it (enemy-attack.ts, opportunity.ts):
//
//   const hitLog = openLastHit(campaign.id, target.id);
//   hitLog.swing(hitOutcome, vsAc, { hit, crit, raw, advantage });
//   hitLog.close({ attacker, attack, type, ranged });
export function openLastHit(campaignId: string, characterId: string) {
  const sheet = getSheetById(characterId);
  const before = sheet ? snapshotVitals(campaignId, sheet) : null;
  const startedAt = nowIso();
  const openSeq = latestSeq(campaignId);
  const swings: SwingRecord[] = [];
  // The concentration each swing found, and when the swing before it ended,
  // so a swing's own concentration save is read off the rolls since then.
  let concentrating = before?.concentratingOn ?? null;
  let since = startedAt;
  // The save this swing's damage asked of a concentrating character, and
  // whether concentration survived it (SwingRecord.concentration).
  const concentrationOf = (hit: boolean, raw: number): SwingRecord["concentration"] => {
    const now = getSheetById(characterId);
    const was = concentrating;
    const from = since;
    concentrating = now?.concentratingOn ?? null;
    since = nowIso();
    if (!was || !hit || raw <= 0 || !now) {
      return undefined;
    }
    // Oldest first: the last is this swing's save.
    const save = listRecentRolls(campaignId, 40)
      .filter(
        (roll) =>
          roll.characterId === characterId &&
          roll.kind === "saving_throw" &&
          roll.detail.startsWith("CON save to keep concentration") &&
          roll.createdAt >= from,
      )
      .at(-1);
    return { save: save ? save.total : null, broke: !now.concentratingOn };
  };
  return {
    swing(
      outcome: RollResult,
      vsAc: number,
      result: {
        hit: boolean;
        crit: boolean;
        raw: number;
        advantage: Advantage;
        type?: string;
        parts?: Array<{ amount: number; type: string }>;
        ranged?: boolean;
        attack?: string;
        ordinary?: SwingRecord["ordinary"];
        plain?: SwingRecord["plain"];
        normal?: SwingRecord["normal"];
        standingAdvantage?: Advantage;
        critical?: CriticalRecipe;
        flags?: BlowFlags;
      },
    ) {
      const concentration = concentrationOf(result.hit, result.raw);
      const flags = Object.fromEntries(Object.entries(result.flags ?? {}).filter(([, value]) => value !== undefined && value !== false && !(Array.isArray(value) && !value.length)));
      swings.push({
        ...(result.attack !== undefined ? { attack: result.attack } : {}),
        total: outcome.total,
        faces: d20FacesOf(outcome),
        natural: outcome.natural ?? null,
        advantage: result.advantage,
        vsAc,
        hit: result.hit,
        crit: result.crit,
        raw: result.hit ? Math.max(0, result.raw) : 0,
        ...(result.type !== undefined ? { type: result.type } : {}),
        ...(result.hit && result.parts?.length ? { parts: result.parts } : {}),
        ...(result.ranged !== undefined ? { ranged: result.ranged } : {}),
        ...(result.hit && result.ordinary ? { ordinary: result.ordinary } : {}),
        ...(result.hit && result.crit && result.plain ? { plain: { ...result.plain, from: Math.max(0, result.raw) } } : {}),
        ...(result.hit && result.crit && result.normal ? { normal: result.normal } : {}),
        ...(result.hit && result.standingAdvantage && result.standingAdvantage !== result.advantage ? { standingAdvantage: result.standingAdvantage } : {}),
        ...(result.hit && !result.crit && result.critical ? { critical: result.critical } : {}),
        ...(result.hit && Object.keys(flags).length ? { flags: flags as BlowFlags } : {}),
        ...(concentration ? { concentration } : {}),
      });
    },
    close(what: {
      attacker: LastHit["attacker"];
      attack: string;
      type: string;
      ranged: boolean;
      source?: LastHit["source"];
    }) {
      const now = getSheetById(characterId);
      if (!before || !now) {
        return;
      }
      const encounter = getActiveEncounter(campaignId);
      writeLastHit(campaignId, {
        id: newHitId(),
        characterId,
        encounterId: encounter?.id ?? null,
        turn: encounter ? turnKey(encounter) : "",
        ...(encounter && enemiesTakingTurns(encounter) ? { enemyTurns: true } : {}),
        ...rollingTurn(),
        attacker: what.attacker,
        attack: what.attack,
        type: what.type,
        ranged: what.ranged,
        source: what.source ?? "attack",
        swings,
        before,
        after: afterOf(now),
        answered: [],
        startedAt,
        at: nowIso(),
        seqs: { open: openSeq, close: latestSeq(campaignId) },
      });
    },
  };
}

// Where a hit left the character.
function afterOf(now: CharacterSheet): LastHit["after"] {
  return {
    currentHp: now.currentHp,
    tempHp: now.tempHp,
    beastHp: now.wildShape?.beastHp ?? null,
    track: now.deathSaves ?? null,
    ward: wardHpOf(now),
  };
}

// A fall, kept the same way so Slow Fall and Feather Fall can answer it:
// one "swing" that always hits for the rolled falling damage.
export function recordFall(
  campaignId: string,
  characterId: string,
  before: VitalsSnapshot,
  raw: number,
  startedAt: string,
  openSeq?: number,
) {
  const now = getSheetById(characterId);
  if (!now) {
    return;
  }
  const encounter = getActiveEncounter(campaignId);
  writeLastHit(campaignId, {
    id: newHitId(),
    characterId,
    encounterId: encounter?.id ?? null,
    turn: encounter ? turnKey(encounter) : "",
    ...(encounter && enemiesTakingTurns(encounter) ? { enemyTurns: true } : {}),
    ...rollingTurn(),
    attacker: { kind: "hazard", id: null, name: "the fall" },
    attack: "falling",
    type: "bludgeoning",
    ranged: false,
    source: "fall",
    swings: [{ total: 0, faces: [], natural: null, advantage: "none", vsAc: 0, hit: true, crit: false, raw }],
    before,
    after: afterOf(now),
    answered: [],
    startedAt,
    at: nowIso(),
    ...(openSeq !== undefined ? { seqs: { open: openSeq, close: latestSeq(campaignId) } } : {}),
  });
}

// Damage that came from no attack and no fall, kept the way a fall is so a
// reaction to damage taken can answer it (Deflect Energy, Stone's Endurance,
// Absorb Elements, Bastion of Law): one "swing" that always hits for the
// damage as dealt, of its type, made by nobody. Opened before the damage
// lands and closed after, by the door that deals it: apply_damage called on
// its own (mutations.ts) and a spell's save damage (cast-at-player.ts). A
// door inside an attack's own record must not open one: the attack keeps it.
export function openEffect(campaignId: string, characterId: string) {
  const sheet = getSheetById(characterId);
  const before = sheet ? snapshotVitals(campaignId, sheet) : null;
  const startedAt = nowIso();
  const openSeq = latestSeq(campaignId);
  return {
    close(what: { raw: number; type: string; name: string }) {
      const now = getSheetById(characterId);
      if (!before || !now || what.raw <= 0) {
        return;
      }
      const encounter = getActiveEncounter(campaignId);
      writeLastHit(campaignId, {
        id: newHitId(),
        characterId,
        encounterId: encounter?.id ?? null,
        turn: encounter ? turnKey(encounter) : "",
        ...(encounter && enemiesTakingTurns(encounter) ? { enemyTurns: true } : {}),
        ...rollingTurn(),
        attacker: { kind: "hazard", id: null, name: what.name },
        attack: "damage",
        type: what.type,
        ranged: false,
        source: "effect",
        swings: [{ total: 0, faces: [], natural: null, advantage: "none", vsAc: 0, hit: true, crit: false, raw: what.raw, type: what.type }],
        before,
        after: afterOf(now),
        answered: [],
        startedAt,
        at: nowIso(),
        seqs: { open: openSeq, close: latestSeq(campaignId) },
      });
    },
  };
}

// Opened before a fall's damage lands and closed after, by the falling
// hazard (src/lib/dm/hazard-tools.ts).
export function openFall(campaignId: string, characterId: string) {
  const sheet = getSheetById(characterId);
  const before = sheet ? snapshotVitals(campaignId, sheet) : null;
  const startedAt = nowIso();
  const openSeq = latestSeq(campaignId);
  return {
    close(raw: number) {
      if (before) {
        recordFall(campaignId, characterId, before, raw, startedAt, openSeq);
      }
    },
  };
}
