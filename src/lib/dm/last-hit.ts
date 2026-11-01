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
// form's pool, the death track, conditions, Relentless Endurance, and the
// concentration the hit may have broken with the effects that went with
// it). src/lib/dm/reaction-refund.ts turns a corrected outcome back into
// state from it.
//
// One record per character per campaign, replaced by the next attack. It
// answers a reaction only while it is fresh: in a fight, until the next
// attack on anyone or the first thing the next turn's creature does
// (freshLastHit); out of one, the last ten minutes. The table is made with the schema (src/lib/db/core.ts), so
// deleting a campaign can clear its rows.

import { sheetSpellAuthors } from "@/lib/dm/spell-authors";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getActiveEncounter, listEnemies, orderEntryId, turnKey, type Encounter, type OrderEntry } from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import type { RollResult, Advantage } from "@/lib/dice";
import type { RollAttacker } from "@/lib/db/rolls";
import { spellMechanicsFor } from "@/lib/content";
import type { CharacterSheet } from "@/lib/schemas/sheet";

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
};

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
  concentratingOn: string | null;
  // The conditions the concentration spell held on every creature, so a
  // hit that is undone can put back what breaking it took away.
  held: { spell: string; names: string[]; holders: HolderSnapshot[] } | null;
};

export type LastHit = {
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
  // Who made it: an enemy, a character fighting on the other side (a
  // turncoat's pc_attack, issue 503), or a hazard, which is nobody.
  attacker: { kind: "enemy" | "sheet" | "hazard"; id: string | null; name: string };
  attack: string;
  type: string;
  ranged: boolean;
  // What made the damage: an attack (with swings) or a fall.
  source: "attack" | "fall";
  swings: SwingRecord[];
  before: VitalsSnapshot;
  after: { currentHp: number; tempHp: number; beastHp: number | null };
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

const db = getDatabase;

export function writeLastHit(campaignId: string, record: LastHit) {
  db()
    .prepare(
      `INSERT INTO last_hits (campaign_id, character_id, payload_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (campaign_id, character_id)
       DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
    )
    .run(campaignId, record.characterId, JSON.stringify(record), record.at);
}

export function readLastHit(campaignId: string, characterId: string): LastHit | null {
  const row = db()
    .prepare(`SELECT payload_json FROM last_hits WHERE campaign_id = ? AND character_id = ?`)
    .get(campaignId, characterId) as { payload_json: string } | undefined;
  return row ? parseJson<LastHit | null>(row.payload_json, null) : null;
}

const FRESH_MS = 10 * 60 * 1000;

// Whether the enemies a pass walked past are taking their turns: held for
// (src/lib/dm/enemies-due.ts), or handed to the model's own end_turn to play
// in its reply. The pointer already rests on the character up next.
function enemiesTakingTurns(encounter: Pick<Encounter, "legendary">): boolean {
  return Boolean(encounter.legendary.due?.length || encounter.legendary.handoff);
}

// Whether an attack on somebody else was recorded after this one.
function attackedSince(campaignId: string, record: LastHit): boolean {
  return Boolean(
    db()
      .prepare(`SELECT 1 FROM last_hits WHERE campaign_id = ? AND character_id != ? AND created_at > ? LIMIT 1`)
      .get(campaignId, record.characterId, record.at),
  );
}

// Whether the creature whose turn it is has done anything with it yet: an
// attack, a cast, an action card (anything its action economy records), or
// a step on the board.
function actedThisTurn(encounter: Encounter): boolean {
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

// The record a reaction may still answer, or null: the same encounter, and
// in a fight the moment after it. SRD 5.1: a reaction is taken right after
// its trigger, and a creature's reaction comes back at the start of its
// turn. The pointer rests on the character up next while the enemies before
// them take their turns, so a hit then stayed answerable through the other
// enemies' attacks and that character's whole turn after them: late, and
// once their turn began, a second reaction in a round. So it closes at the
// next attack on anyone, or once the next turn's creature does its first
// thing (an attack, a cast, an action card, a step, ending the turn). The
// enemies' turns ending closes nothing: the player hit has the time until
// somebody acts to read the hit and answer it, at an AI table after the
// reply that told it, at a person's table after the GM hands the turn on.
// Out of a fight, the last ten minutes.
export function freshLastHit(campaignId: string, characterId: string): LastHit | null {
  const record = readLastHit(campaignId, characterId);
  if (!record) {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  if ((encounter?.id ?? null) !== record.encounterId) {
    return null;
  }
  if (encounter) {
    if (record.closed || attackedSince(campaignId, record)) {
      return null;
    }
    const sameTurn = turnKey(encounter) === record.turn && Boolean(record.enemyTurns) === enemiesTakingTurns(encounter);
    // A later turn's enemies close it only by attacking (above).
    if (sameTurn || enemiesTakingTurns(encounter)) {
      return record;
    }
    return actedThisTurn(encounter) ? null : record;
  }
  return Date.now() - Date.parse(record.at) <= FRESH_MS ? record : null;
}

// A creature's turn is ending (src/lib/dm/encounter-tools.ts advancePointer):
// every hit still open in the fight closes, except one that landed in that
// creature's own turn, which the creature after it may still let pass.
// Ending the turn is the last thing the next turn's creature can do first.
export function closeHitsAtTurnEnd(campaignId: string, encounter: Pick<Encounter, "id" | "round">, ending: OrderEntry) {
  const endingKey = turnKey({ round: encounter.round, order: [ending], turnIndex: 0 });
  const rows = db().prepare(`SELECT payload_json FROM last_hits WHERE campaign_id = ?`).all(campaignId) as Array<{ payload_json: string }>;
  for (const row of rows) {
    const record = parseJson<LastHit | null>(row.payload_json, null);
    if (!record || record.closed || record.encounterId !== encounter.id) {
      continue;
    }
    if (record.turn === endingKey && !record.enemyTurns) {
      continue;
    }
    writeLastHit(campaignId, { ...record, closed: true });
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
    concentratingOn: sheet.concentratingOn ?? null,
    held: concentrationHeld(campaignId, sheet),
  };
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
  const swings: SwingRecord[] = [];
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
      },
    ) {
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
        characterId,
        encounterId: encounter?.id ?? null,
        turn: encounter ? turnKey(encounter) : "",
        ...(encounter && enemiesTakingTurns(encounter) ? { enemyTurns: true } : {}),
        attacker: what.attacker,
        attack: what.attack,
        type: what.type,
        ranged: what.ranged,
        source: what.source ?? "attack",
        swings,
        before,
        after: {
          currentHp: now.currentHp,
          tempHp: now.tempHp,
          beastHp: now.wildShape?.beastHp ?? null,
        },
        answered: [],
        startedAt,
        at: nowIso(),
      });
    },
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
) {
  const now = getSheetById(characterId);
  if (!now) {
    return;
  }
  const encounter = getActiveEncounter(campaignId);
  writeLastHit(campaignId, {
    characterId,
    encounterId: encounter?.id ?? null,
    turn: encounter ? turnKey(encounter) : "",
    ...(encounter && enemiesTakingTurns(encounter) ? { enemyTurns: true } : {}),
    attacker: { kind: "hazard", id: null, name: "the fall" },
    attack: "falling",
    type: "bludgeoning",
    ranged: false,
    source: "fall",
    swings: [{ total: 0, faces: [], natural: null, advantage: "none", vsAc: 0, hit: true, crit: false, raw }],
    before,
    after: { currentHp: now.currentHp, tempHp: now.tempHp, beastHp: now.wildShape?.beastHp ?? null },
    answered: [],
    startedAt,
    at: nowIso(),
  });
}

// Opened before a fall's damage lands and closed after, by the falling
// hazard (src/lib/dm/hazard-tools.ts).
export function openFall(campaignId: string, characterId: string) {
  const sheet = getSheetById(characterId);
  const before = sheet ? snapshotVitals(campaignId, sheet) : null;
  const startedAt = nowIso();
  return {
    close(raw: number) {
      if (before) {
        recordFall(campaignId, characterId, before, raw, startedAt);
      }
    },
  };
}
