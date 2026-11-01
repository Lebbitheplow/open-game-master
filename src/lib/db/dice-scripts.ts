import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { registerScriptedDice, type RollFrame } from "@/lib/dice";
import {
  diceScriptSchema,
  forcesWholeD20,
  matchForced,
  seededFace,
  seedState,
  usedFace,
  withUsed,
  type DiceScript,
  type ForcedFace,
  type RollPurpose,
  type UsedFace,
} from "@/lib/dice-script-logic";
import { currentDmJob, currentTurnId } from "@/lib/dm/job-control";
import { currentUsageScope } from "@/lib/usage/scope";
import { isPlaytest, normalizeCampaignKind } from "@/lib/workshop/kind";

// A test table's dice script (issue 685; the rules are
// src/lib/dice-script-logic.ts): stored per table, and read by the server's
// own dice through the hook src/lib/dice.ts lets this module register.
//
// Only a test table (campaigns.kind 'playtest') can hold one, and the hook
// asks the rolling table's kind before anything else, so a live table's dice
// stay honest by construction: a row written there by hand would never be
// read. The row goes with its table (ON DELETE CASCADE).

export type DiceScriptState = DiceScript & {
  // The faces spent so far, newest last.
  used: UsedFace[];
  // How many dice the seed has rolled since it was set.
  seededRolls: number;
};

type ScriptRow = {
  seed: number | null;
  seed_state: number | null;
  seeded_rolls: number;
  queue_json: string;
  used_json: string;
};

declare global {
  // campaign id -> is a test table. Kept on globalThis like the other
  // per-process registries, so every bundle that rolls shares one.
  var __odmTestTables: Map<string, boolean> | undefined;
  // dm_turns id -> its campaign.
  var __odmTurnTables: Map<string, string> | undefined;
}

// Test tables come and go with every test; a bound keeps the memory flat on
// a server that has run thousands of them.
const REMEMBERED = 2000;

function remember<V>(map: Map<string, V>, key: string, value: V): V {
  if (map.size >= REMEMBERED) {
    map.clear();
  }
  map.set(key, value);
  return value;
}

// Whether a table is a test table. A campaign's kind is fixed when it is
// made (createCampaign), so the answer is kept: after its first die a live
// table pays one Map lookup per die for this feature, and no query.
export function isTestTable(campaignId: string): boolean {
  const known = (globalThis.__odmTestTables ??= new Map());
  const kept = known.get(campaignId);
  if (kept !== undefined) {
    return kept;
  }
  const row = getDatabase().prepare(`SELECT kind FROM campaigns WHERE id = ?`).get(campaignId) as
    | { kind: string | null }
    | undefined;
  // No row yet is no answer: nothing is kept for an id that may still be made.
  return row ? remember(known, campaignId, isPlaytest({ kind: normalizeCampaignKind(row.kind) })) : false;
}

// A deleted table's answer is let go (deleteCampaign).
export function forgetDiceTable(campaignId: string): void {
  globalThis.__odmTestTables?.delete(campaignId);
}

function tableOfTurn(turnId: string): string | null {
  const known = (globalThis.__odmTurnTables ??= new Map());
  const kept = known.get(turnId);
  if (kept !== undefined) {
    return kept;
  }
  const row = getDatabase().prepare(`SELECT campaign_id FROM dm_turns WHERE id = ?`).get(turnId) as
    | { campaign_id: string }
    | undefined;
  return row ? remember(known, turnId, row.campaign_id) : null;
}

// The table a die is rolled for: the turn the work belongs to (every AI
// turn, console call and parked roll answered at the table runs in one,
// src/lib/dm/job-control.ts), else the queue job running it, else the
// request's campaign (requireMember's usage scope). A die none of them
// names (a character built in the library) belongs to no table.
function rollingTable(): string | null {
  const turnId = currentTurnId();
  const byTurn = turnId ? tableOfTurn(turnId) : null;
  return byTurn ?? currentDmJob()?.campaignId ?? currentUsageScope().campaignId ?? null;
}

function readRow(campaignId: string): ScriptRow | null {
  const row = getDatabase()
    .prepare(`SELECT seed, seed_state, seeded_rolls, queue_json, used_json FROM dice_scripts WHERE campaign_id = ?`)
    .get(campaignId) as ScriptRow | undefined;
  return row ?? null;
}

function queueOf(raw: string): ForcedFace[] {
  const parsed = diceScriptSchema.shape.queue.safeParse(parseJson<unknown>(raw, []));
  return parsed.success ? parsed.data : [];
}

function usedOf(raw: string): UsedFace[] {
  const parsed = parseJson<unknown>(raw, []);
  return Array.isArray(parsed) ? (parsed as UsedFace[]) : [];
}

export function getDiceScript(campaignId: string): DiceScriptState | null {
  const row = readRow(campaignId);
  if (!row) {
    return null;
  }
  return { seed: row.seed, queue: queueOf(row.queue_json), used: usedOf(row.used_json), seededRolls: row.seeded_rolls };
}

// Stores a test table's script; false at any other table (or for a script
// the schema refuses), which keeps nothing. The same seed set again carries
// its sequence on, so editing the forced faces mid-fight does not replay
// the dice already rolled; a new seed starts its own sequence. What was
// spent stays listed.
export function setDiceScript(campaignId: string, script: DiceScript): boolean {
  if (!isTestTable(campaignId)) {
    return false;
  }
  const parsed = diceScriptSchema.safeParse(script);
  if (!parsed.success) {
    return false;
  }
  const { seed, queue } = parsed.data;
  const before = readRow(campaignId);
  const sameSeed = before !== null && before.seed === seed;
  getDatabase()
    .prepare(
      `INSERT INTO dice_scripts (campaign_id, seed, seed_state, seeded_rolls, queue_json, used_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id) DO UPDATE SET
         seed = excluded.seed,
         seed_state = excluded.seed_state,
         seeded_rolls = excluded.seeded_rolls,
         queue_json = excluded.queue_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      campaignId,
      seed,
      sameSeed ? before.seed_state : seed === null ? null : seedState(seed),
      sameSeed ? before.seeded_rolls : 0,
      JSON.stringify(queue),
      before?.used_json ?? "[]",
      nowIso(),
    );
  return true;
}

// Back to ordinary dice: the seed, the forced faces and the list of spent
// ones all go.
export function clearDiceScript(campaignId: string): void {
  getDatabase().prepare(`DELETE FROM dice_scripts WHERE campaign_id = ?`).run(campaignId);
}

// The hook (src/lib/dice.ts defaultRng): the face this die must show, or
// null to roll it honestly.
function scriptedDie(sides: number, frame: RollFrame): number | null {
  // The other d20s of a roll whose d20 was forced show the same face, so
  // the forced face is the one the roll keeps.
  if (frame.forcedD20 !== null && sides === 20) {
    return frame.forcedD20;
  }
  try {
    const campaignId = rollingTable();
    if (!campaignId || !isTestTable(campaignId)) {
      return null;
    }
    const row = readRow(campaignId);
    if (!row) {
      return null;
    }
    const db = getDatabase();
    const purpose: RollPurpose = { ...(frame.purpose ?? {}), sides };
    const queue = queueOf(row.queue_json);
    const at = matchForced(queue, purpose);
    if (at >= 0) {
      const forced = queue[at];
      const used = withUsed(usedOf(row.used_json), usedFace(forced, purpose, nowIso()));
      db.prepare(`UPDATE dice_scripts SET queue_json = ?, used_json = ?, updated_at = ? WHERE campaign_id = ?`).run(
        JSON.stringify(queue.filter((_, index) => index !== at)),
        JSON.stringify(used),
        nowIso(),
        campaignId,
      );
      if (forcesWholeD20(forced.kind)) {
        frame.forcedD20 = forced.face;
      }
      return forced.face;
    }
    if (row.seed === null) {
      return null;
    }
    const next = seededFace(row.seed_state ?? seedState(row.seed), sides);
    db.prepare(`UPDATE dice_scripts SET seed_state = ?, seeded_rolls = seeded_rolls + 1 WHERE campaign_id = ?`).run(
      next.state,
      campaignId,
    );
    return next.face;
  } catch (error) {
    // A script that cannot be read never stops a roll: the die is rolled
    // honestly instead.
    console.error("[dice-script] the test table's dice script could not be read", error);
    return null;
  }
}

registerScriptedDice(scriptedDie);
