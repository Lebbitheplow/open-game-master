import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { redactRoll, rollAccessFor, type ViewerCaps } from "@/lib/dm/viewer";
import type { Advantage, RollResult } from "@/lib/dice";
import type { RollParts, RollSaid } from "@/lib/roll-parts";
import { rollSentence } from "@/lib/roll-words";

export type RollKind =
  | "skill_check"
  | "saving_throw"
  | "ability_check"
  | "attack"
  | "damage"
  | "initiative"
  | "custom";

// Who may see a roll's result. 'public' is every roll the app has ever
// made and stays the default; the rest exist for a human DM who wants a
// screen (src/lib/dm/viewer.ts decides who sees what).
export const ROLL_VISIBILITIES = ["public", "dm", "blind", "self"] as const;
// "secret" is the server's own, never chosen at the table: a roll that is a
// storyteller secret (issue 503: a pact's recruiting, a player's secret
// action), read by the storyteller and by the player whose character it is
// for, never by the lead of an AI table (src/lib/dm/viewer.ts rollAccessFor).
// revealRoll turns it public when the secret comes out.
export type RollVisibility = (typeof ROLL_VISIBILITIES)[number] | "secret";

// Who made an attack or damage roll, named as they were when it was rolled.
// A character's bound creature has no id of its own (it lives on its owner's
// sheet), so a pet's id is its owner's sheet id. characterId cannot say this:
// it is the PC the roll concerns, the target of an enemy's attack.
// A roll nobody at the table made names its source, a "hazard" with no id,
// as a hit's record does (src/lib/dm/last-hit.ts): unnamed, it read as the
// roll of the character it landed on. `hazard` says what the source is, so
// no reader works that out from its name: a fall, the GM's own dice for
// harm nothing names, a trap, an item, the effect of a spell or feature, or
// a hazard by the words the GM gave it. Every source is built in
// src/lib/roll-sources.ts.
export type HazardKind = "fall" | "gm" | "trap" | "item" | "effect" | "named";
export type RollSource = { kind: "hazard"; id: null; name: string; hazard: HazardKind };
export type RollAttacker = { kind: "sheet" | "enemy" | "pet"; id: string; name: string } | RollSource;

// The kind and roller of a roll whose kind is only known as it runs (a roll
// card's own dice, the roll tools): an attack or damage roll takes
// `otherwise` when nobody else is named, and the other kinds may name nobody.
export function kindAndRoller(
  kind: RollKind,
  attacker: RollAttacker | null,
  otherwise: RollAttacker,
): { kind: "attack" | "damage"; attacker: RollAttacker } | { kind: Exclude<RollKind, "attack" | "damage">; attacker: RollAttacker | null } {
  return kind === "attack" || kind === "damage" ? { kind, attacker: attacker ?? otherwise } : { kind, attacker };
}

export type StoredRoll = {
  id: string;
  campaignId: string;
  characterId: string | null;
  requestedBy: "dm" | "player";
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  total: number;
  success: boolean | null;
  breakdown: RollResult;
  visibility: RollVisibility;
  messageId: string | null;
  // Damage rolls only: the enemy the server itself landed this roll's total
  // on, set together with `applied` (the damage_enemy double-apply guard).
  targetEnemyId: string | null;
  // The server landed this roll's total on `targetEnemyId`: set with it,
  // and by nothing else (markRollApplied, landRoll). Which rolls an AI GM
  // asked for, and which of those have paid for a number it sent, are the
  // turn's own lists (src/lib/db/dm-turns.ts askedRollIds, paidRollIds), not
  // this. A row stored before those lists may hold a stamp with no target,
  // from when a roll was stamped spent here; nothing reads one.
  applied: boolean;
  // Attack and damage rolls: who rolled, or the source of a roll nobody made
  // (a fall). Null for other kinds of roll, and for rolls stored before it
  // was recorded.
  attacker: RollAttacker | null;
  // What a rule reads back from this roll (src/lib/roll-parts.ts, the only
  // module that reads it or the sentence). Null for a roll stored before its
  // parts were: that one is read by its words.
  parts: RollParts | null;
  createdAt: string;
};

type RollRow = {
  id: string;
  campaign_id: string;
  character_id: string | null;
  requested_by: "dm" | "player";
  roll_kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  total: number;
  success: number | null;
  breakdown_json: string;
  visibility: RollVisibility | null;
  message_id: string | null;
  target_enemy_id: string | null;
  applied: number;
  attacker_json: string | null;
  parts_json: string | null;
  created_at: string;
};

function mapRoll(row: RollRow): StoredRoll {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    characterId: row.character_id,
    requestedBy: row.requested_by,
    kind: row.roll_kind,
    detail: row.detail,
    expression: row.expression,
    advantage: row.advantage,
    dc: row.dc,
    total: row.total,
    success: row.success === null ? null : Boolean(row.success),
    breakdown: parseJson(row.breakdown_json, {
      expression: row.expression,
      total: row.total,
      terms: [],
    } as RollResult),
    visibility: row.visibility ?? "public",
    messageId: row.message_id,
    targetEnemyId: row.target_enemy_id ?? null,
    applied: Boolean(row.applied),
    attacker: parseJson<RollAttacker | null>(row.attacker_json ?? "null", null),
    parts: row.parts_json === null ? null : parseJson<RollParts>(row.parts_json, {}),
    createdAt: row.created_at,
  };
}

// Stamp a damage roll as landed by the server on a specific enemy. The
// damage_enemy double-apply guard, the after-fight card, the evidence Ask
// reads (src/lib/dm/ask.ts) and the swarm's die taken back
// (authored-spend-more.ts swarmDieBack) read these. Only for a blow the
// server lands itself as its dice resolve, here and in landRoll below: no
// other function writes the stamp.
export function markRollApplied(rollId: string, targetEnemyId: string) {
  getDatabase()
    .prepare(`UPDATE rolls SET applied = 1, target_enemy_id = ? WHERE id = ?`)
    .run(targetEnemyId, rollId);
}

// Lands a damage roll with its stamp already on. The blow that ends a fight
// is counted into the after-fight card inside `land`, so a stamp put on
// afterwards left every killing blow off its wielder's line (issue 91: 0
// dealt, 1 slain). A blow the engine refuses gives the stamp back.
export function landRoll<T extends object>(rollId: string, targetEnemyId: string, land: () => T): T {
  markRollApplied(rollId, targetEnemyId);
  const result = land();
  if ("error" in result) {
    getDatabase().prepare(`UPDATE rolls SET applied = 0, target_enemy_id = NULL WHERE id = ?`).run(rollId);
  }
  return result;
}

// An attack or damage roll must say who made it, or name its source.
export type RollInsert = {
  campaignId: string;
  characterId?: string | null;
  requestedBy: "dm" | "player";
  advantage?: Advantage;
  dc?: number | null;
  result: RollResult;
  visibility?: RollVisibility;
  messageId?: string | null;
  // `detail`, the sentence the roll's site wrote, or `parts` that make its
  // words (src/lib/roll-words.ts): one of the two, always. `parts` is also
  // what a rule may read back from this roll: said here, as a field, and
  // never left for a reader to find in `detail` (src/lib/roll-parts.ts).
  // Null only for the dice of a roll card dealt before cards kept their
  // parts (dm-turns.ts PendingRoll): that roll is stored without them.
} & RollSaid & (
  | { kind: "attack" | "damage"; attacker: RollAttacker }
  | { kind: Exclude<RollKind, "attack" | "damage">; attacker?: RollAttacker | null }
);

export function insertRoll(input: RollInsert): StoredRoll {
  const id = crypto.randomUUID();
  const success =
    input.dc === undefined || input.dc === null ? null : input.result.total >= input.dc ? 1 : 0;

  getDatabase()
    .prepare(
      `
        INSERT INTO rolls (
          id, campaign_id, character_id, requested_by, roll_kind, detail,
          expression, advantage, dc, total, success, breakdown_json,
          visibility, message_id, attacker_json, parts_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.characterId ?? null,
      input.requestedBy,
      input.kind,
      rollSentence(input),
      input.result.expression,
      input.advantage ?? "none",
      input.dc ?? null,
      input.result.total,
      success,
      JSON.stringify(input.result),
      input.visibility ?? "public",
      input.messageId ?? null,
      input.attacker ? JSON.stringify(input.attacker) : null,
      // A roll stored from now on has its parts, '{}' where it names none,
      // so it is read by its fields and never by its words.
      input.parts === null ? null : JSON.stringify(input.parts ?? {}),
      nowIso(),
    );
  // A held call keeps which roll its decided dice became (held-call.ts).
  globalThis.__odmRollRecorded?.({ id, characterId: input.characterId ?? null, kind: input.kind });

  const roll = getRoll(id);
  if (!roll) {
    throw new Error("Failed to insert roll.");
  }
  return roll;
}

export function getRoll(rollId: string): StoredRoll | null {
  const row = getDatabase().prepare(`SELECT * FROM rolls WHERE id = ?`).get(rollId) as
    | RollRow
    | undefined;
  return row ? mapRoll(row) : null;
}

// The first of these rolls that was stored after this one, or null: where a
// roll that joins a list late belongs in it. The line a person's turn posts
// lists the turn's rolls, and with them a roll its call made on a short turn
// of its own (src/lib/dm/persons-record.ts), which goes among them in the
// order the dice were thrown.
export function firstStoredAfter(rollId: string, among: readonly string[]): string | null {
  const rows = getDatabase()
    .prepare(`SELECT id FROM rolls WHERE rowid > (SELECT rowid FROM rolls WHERE id = ?) AND id IN (SELECT value FROM json_each(?))`)
    .all(rollId, JSON.stringify(among)) as Array<{ id: string }>;
  const later = new Set(rows.map((row) => row.id));
  return among.find((id) => later.has(id)) ?? null;
}

// A character's own latest attack roll, or null: what a fight's guess at the
// weapon in hand reads (src/lib/dm/held-default.ts), through the roll's
// parts (src/lib/roll-parts.ts rollWeaponRow). Their own by who made it:
// `character_id` is also the target of a creature's attack and the owner of
// a pet's, and the latest of those named no weapon of theirs, so the guess
// forgot the one they had swung. A roll stored before rolls said who made
// them is taken as theirs, as it was.
export function lastAttackRoll(campaignId: string, characterId: string): StoredRoll | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM rolls WHERE campaign_id = ? AND character_id = ? AND roll_kind = 'attack'
         AND (attacker_json IS NULL OR (json_extract(attacker_json, '$.kind') = 'sheet' AND json_extract(attacker_json, '$.id') = character_id))
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(campaignId, characterId) as RollRow | undefined;
  return row ? mapRoll(row) : null;
}

// Whether a creature has made an attack roll at this character. An enemy's
// id is its fight's own, so its rolls are this fight's: what an undead left
// without a command answers (src/lib/dm/undead-command.ts).
export function attackedBy(campaignId: string, characterId: string, attackerId: string): boolean {
  const row = getDatabase()
    .prepare(`SELECT 1 FROM rolls WHERE campaign_id = ? AND character_id = ? AND roll_kind = 'attack' AND json_extract(attacker_json, '$.id') = ? LIMIT 1`)
    .get(campaignId, characterId, attackerId);
  return Boolean(row);
}

// Every roll since a moment, oldest first: the span of one fight.
export function listRollsSince(campaignId: string, sinceIso: string): StoredRoll[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM rolls WHERE campaign_id = ? AND created_at >= ? ORDER BY created_at ASC, rowid ASC`)
    .all(campaignId, sinceIso) as RollRow[];
  return rows.map(mapRoll);
}

export function listRecentRolls(campaignId: string, limit = 20): StoredRoll[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT * FROM (
          SELECT r.*, r.rowid AS row_order FROM rolls r
          WHERE r.campaign_id = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?
        ) ORDER BY created_at ASC, row_order ASC
      `,
    )
    .all(campaignId, limit) as RollRow[];
  return rows.map(mapRoll);
}

// The latest of a campaign's recent rolls that fits, or null. The list above
// comes oldest first, so its first match is the oldest: a rule that answers
// "the save last failed" or "their last check" asks here.
export function latestRoll(campaignId: string, among: number, fits: (roll: StoredRoll) => boolean): StoredRoll | null {
  return listRecentRolls(campaignId, among).findLast(fits) ?? null;
}

// The recent rolls one seat may see. A hidden roll is dropped outright and a
// blind one keeps its label and loses its number, so the table still knows
// the dice were thrown (src/lib/dm/viewer.ts explains why).
export function listRollsVisibleTo(
  campaignId: string,
  caps: Pick<ViewerCaps, "adjudicates" | "steersStory"> & Partial<Pick<ViewerCaps, "storytellerSecrets">>,
  ownedCharacterIds: string[],
  limit = 20,
): Array<StoredRoll | ReturnType<typeof redactRoll<StoredRoll>>> {
  const out: Array<StoredRoll | ReturnType<typeof redactRoll<StoredRoll>>> = [];
  for (const roll of listRecentRolls(campaignId, limit)) {
    const access = rollAccessFor(roll, caps, ownedCharacterIds);
    if (access === "hidden") {
      continue;
    }
    out.push(access === "full" ? roll : redactRoll(roll));
  }
  return out;
}

// A hidden roll comes out (issue 503: a pact's plan goes, or a secret action
// is caught): it turns public, and the caller publishes it to the table.
export function revealRollRow(rollId: string): StoredRoll | null {
  getDatabase().prepare(`UPDATE rolls SET visibility = 'public' WHERE id = ?`).run(rollId);
  return getRoll(rollId);
}
