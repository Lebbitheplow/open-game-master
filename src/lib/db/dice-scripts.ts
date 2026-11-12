import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { registerRolledHook, registerScriptedDice, rollExpression, type RollFrame, type RollResult } from "@/lib/dice";
import { OMEN_SIDES, withOmenDie, withoutEdge, type BeforeRollPower, type Omen } from "@/lib/dm/before-roll-logic";
import {
  describeUsed,
  diceScriptSchema,
  forcedFaceSchema,
  forcesWholeD20,
  giveBackFaces,
  matchForced,
  rewindSeed,
  seededFace,
  seedState,
  usedFace,
  withUsed,
  type DiceScript,
  type ForcedFace,
  type RollPurpose,
  type RollTag,
  type SeedRun,
  type SpentFace,
  type UsedFace,
} from "@/lib/dice-script-logic";
import { liveTurnChangeOf, recordTurnChange, updateTurnChange, type TurnChange } from "@/lib/db/turn-changes";
import { currentDmJob, currentTurnId } from "@/lib/dm/job-control";
import { textKey } from "@/lib/language/text-logic";
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

// What a die spent of the script is kept under the turn rolling it, so
// "Revert this turn" gives it back (issue 685). Never in the way of the
// roll: a record that cannot be written leaves the face as it fell.
function noteSpent(campaignId: string, record: (turnId: string) => void) {
  const turnId = currentTurnId();
  if (!turnId) {
    return;
  }
  try {
    record(turnId);
  } catch (error) {
    console.error("[dice-script] what the die spent could not be kept for a revert", error);
  }
}

// One row per turn for the seed: where the turn found it, and where it has
// left it so far.
function noteSeedRun(campaignId: string, turnId: string, run: SeedRun) {
  const kept = liveTurnChangeOf(campaignId, turnId, "dice_seed");
  const before = kept ? seedRunOf(kept.payload) : null;
  if (kept && before && before.seed === run.seed) {
    updateTurnChange(kept.id, { ...kept.payload, to: run.to });
    return;
  }
  recordTurnChange(campaignId, turnId, "dice_seed", { ...run, line: "" });
}

function seedRunOf(payload: Record<string, unknown>): SeedRun | null {
  const point = (value: unknown) => {
    const raw = value as { state?: unknown; rolls?: unknown } | null;
    return raw && typeof raw.state === "number" && typeof raw.rolls === "number" ? { state: raw.state, rolls: raw.rolls } : null;
  };
  const from = point(payload.from);
  const to = point(payload.to);
  return typeof payload.seed === "number" && from && to ? { seed: payload.seed, from, to } : null;
}

function spentFaceOf(payload: Record<string, unknown>): SpentFace | null {
  const forced = forcedFaceSchema.safeParse(payload.forced);
  const used = payload.used as UsedFace | null;
  return forced.success && typeof payload.position === "number" && used && typeof used === "object"
    ? { forced: forced.data, position: payload.position, used }
    : null;
}

// What the lead is told before a revert gives the dice back.
export function diceGiveBackWarnings(campaignId: string, changes: readonly TurnChange[]): string[] {
  const row = readRow(campaignId);
  if (!row) {
    return changes.length ? ["The test's dice script was cleared since this turn; the dice it spent are not given back."] : [];
  }
  const current = { seed: row.seed, state: row.seed_state, rolls: row.seeded_rolls };
  return changes.some((change) => {
    const run = change.kind === "dice_seed" ? seedRunOf(change.payload) : null;
    return run !== null && rewindSeed(current, run) === null;
  })
    ? ["The dice script's seed has rolled on since this turn (or was set again); it carries on from where it is, so a replay will not roll the same seeded dice."]
    : [];
}

// "Revert this turn": the forced faces back in the queue where they stood,
// and the seed back where the turn found it when nothing has rolled since.
export function giveBackDice(campaignId: string, changes: readonly TurnChange[]) {
  const row = readRow(campaignId);
  if (!row) {
    return;
  }
  const faces = changes.flatMap((change) => {
    const face = change.kind === "dice_face" ? spentFaceOf(change.payload) : null;
    return face ? [face] : [];
  });
  const back = giveBackFaces(queueOf(row.queue_json), usedOf(row.used_json), faces);
  let seed = { state: row.seed_state, rolls: row.seeded_rolls };
  for (const change of [...changes].reverse()) {
    const run = change.kind === "dice_seed" ? seedRunOf(change.payload) : null;
    const rewound = run ? rewindSeed({ seed: row.seed, ...seed }, run) : null;
    if (rewound) {
      seed = rewound;
    }
  }
  getDatabase()
    .prepare(`UPDATE dice_scripts SET queue_json = ?, used_json = ?, seed_state = ?, seeded_rolls = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(JSON.stringify(back.queue), JSON.stringify(back.used), seed.state, seed.rolls, nowIso(), campaignId);
}

// A number Portent foretold, armed on the d20 of the one roll it answers while
// the held call runs (src/lib/dm/foresight.ts). The one exception to the honest
// dice of a live table, and it is the rules': the player rolled it at dawn.
// `tags`: the rolls it may land on, the first d20 to match taking it (a spell
// at a creature is either the caster's attack or the creature's save).
type ArmedFace = { face: number; tags: readonly RollTag[]; used: boolean };
declare global {
  var __odmArmedFaces: Map<string, ArmedFace> | undefined;
}

export function armForetold(campaignId: string, armed: { face: number; tags: readonly RollTag[] }) {
  (globalThis.__odmArmedFaces ??= new Map()).set(campaignId, { ...armed, used: false });
}

// Whether a d20 took it.
export function disarmForetold(campaignId: string): boolean {
  const armed = globalThis.__odmArmedFaces?.get(campaignId);
  globalThis.__odmArmedFaces?.delete(campaignId);
  return armed?.used ?? false;
}

// Whether a roll's purpose is one of the rolls an armed answer may land on.
function fitsTags(tags: readonly RollTag[], purpose: RollTag): boolean {
  const names = [purpose.who ?? []].flat().map(textKey);
  return tags.some((tag) => purpose.roller === tag.roller && purpose.kind === tag.kind && [tag.who ?? []].flat().map(textKey).some((name) => names.includes(name)));
}

function takeArmedFace(campaignId: string | null, sides: number, purpose: RollTag | null): number | null {
  const armed = campaignId ? globalThis.__odmArmedFaces?.get(campaignId) : undefined;
  if (!armed || armed.used || sides !== 20 || !purpose || !fitsTags(armed.tags, purpose)) {
    return null;
  }
  armed.used = true;
  return armed.face;
}

// Cosmic Omen's d6 or Restore Balance's one d20, set at a watch stop before
// the roll it answers and taken by the first roll whose d20 fits its tags
// (src/lib/dm/foresight.ts runWithForetold). Applied however the roll turns
// out, as the features are chosen before it. `took`: the roll before and
// after, once one did; Restore Balance takes only a roll that threw more than
// one d20 (it had an edge to cancel), and the first fitting roll ends the
// wait either way.
type ArmedBefore = { power: BeforeRollPower; omen: Omen | null; tags: readonly RollTag[]; seen: boolean; took: { before: number; after: number; who: string } | null };
declare global {
  var __odmArmedBefore: Map<string, ArmedBefore> | undefined;
}

export function armBeforeRoll(campaignId: string, armed: { power: BeforeRollPower; omen: Omen | null; tags: readonly RollTag[] }) {
  (globalThis.__odmArmedBefore ??= new Map()).set(campaignId, { ...armed, seen: false, took: null });
}

export function disarmBeforeRoll(campaignId: string): { before: number; after: number; who: string } | null {
  const armed = globalThis.__odmArmedBefore?.get(campaignId);
  globalThis.__odmArmedBefore?.delete(campaignId);
  return armed?.took ?? null;
}

function takeArmedBefore(result: RollResult, purpose: RollTag): RollResult {
  const campaignId = globalThis.__odmArmedBefore?.size ? rollingTable() : null;
  const armed = campaignId ? globalThis.__odmArmedBefore?.get(campaignId) : undefined;
  const lead = result.terms[0];
  if (!armed || armed.seen || !lead || lead.kind !== "dice" || lead.sides !== 20 || !fitsTags(armed.tags, purpose)) {
    return result;
  }
  armed.seen = true;
  const after = armed.power === "restore_balance" ? withoutEdge(result) : withOmenDie(result, rollExpression(`1d${OMEN_SIDES}`).total, armed.omen ?? "weal");
  if (!after) {
    return result;
  }
  armed.took = { before: result.total, after: after.total, who: [purpose.who ?? []].flat().join(" and ") || "the roller" };
  return after;
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
    const foretold = globalThis.__odmArmedFaces?.size ? takeArmedFace(campaignId, sides, frame.purpose) : null;
    if (foretold !== null) {
      frame.forcedD20 = foretold;
      return foretold;
    }
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
      const spent = usedFace(forced, purpose, nowIso());
      const used = withUsed(usedOf(row.used_json), spent);
      db.prepare(`UPDATE dice_scripts SET queue_json = ?, used_json = ?, updated_at = ? WHERE campaign_id = ?`).run(
        JSON.stringify(queue.filter((_, index) => index !== at)),
        JSON.stringify(used),
        nowIso(),
        campaignId,
      );
      if (forcesWholeD20(forced.kind)) {
        frame.forcedD20 = forced.face;
      }
      noteSpent(campaignId, (turnId) =>
        recordTurnChange(campaignId, turnId, "dice_face", { forced, position: at, used: spent, line: `Forced die: ${describeUsed(spent)}` }),
      );
      return forced.face;
    }
    if (row.seed === null) {
      return null;
    }
    const from = { state: row.seed_state ?? seedState(row.seed), rolls: row.seeded_rolls };
    const next = seededFace(from.state, sides);
    db.prepare(`UPDATE dice_scripts SET seed_state = ?, seeded_rolls = seeded_rolls + 1 WHERE campaign_id = ?`).run(
      next.state,
      campaignId,
    );
    const seed = row.seed;
    noteSpent(campaignId, (turnId) => noteSeedRun(campaignId, turnId, { seed, from, to: { state: next.state, rolls: from.rolls + 1 } }));
    return next.face;
  } catch (error) {
    // A script that cannot be read never stops a roll: the die is rolled
    // honestly instead.
    console.error("[dice-script] the test table's dice script could not be read", error);
    return null;
  }
}

registerScriptedDice(scriptedDie);
registerRolledHook(takeArmedBefore);
