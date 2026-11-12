import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { ChatMessage } from "@/lib/model-client";
import type { Advantage, RollResult } from "@/lib/dice";
import type { RollKind, RollVisibility } from "@/lib/db/rolls";
import type { ContextTrace } from "@/lib/dm/context-budget";
import { parkReasonFor, type ParkReason } from "@/lib/dice/held-rolls";
import type { ThrownRoll } from "@/lib/dm/after-roll-logic";
import type { AfterRollId, WatchPower } from "@/lib/dm/after-roll-table";
import type { RollTag } from "@/lib/dice-script-logic";
import { writeTurnQuality } from "@/lib/db/turn-ledger";
import { currentTurnId, releaseStandIn, standInFor } from "@/lib/dm/job-control";
import type { GuardReport } from "@/lib/narrator-quality";

// A DM narration turn persisted as a state machine so it can park while a
// player rolls physical dice and resume later (across restarts).

export type DmTurnStatus = "running" | "awaiting_rolls" | "done" | "failed";

// Who is driving the turn. A human turn exists only so the engine has
// somewhere to hang rolls and per-turn bookkeeping, and is never handed to
// the model. It holds no conversation, except at a test fight, where each
// call the person makes is kept on it for the author's turn trace
// (src/lib/dm/invoke.ts, issue 685).
export type DmTurnActor = "ai" | "human_dm";

export type DmTurn = {
  id: string;
  campaignId: string;
  status: DmTurnStatus;
  actor: DmTurnActor;
  callIndex: number;
  conversation: ChatMessage[];
  narrationParts: string[];
  rollIds: string[];
  // Player-to-DM whispers this turn consumed; marked answered in finalize()
  // so a failed turn leaves them pending for the next one to retry.
  playerWhisperIds: string[];
  // Character ids that actually received a send_whisper this turn. finalize()
  // marks a player's pending whisper answered only when its sender is here, so
  // a turn that never replied cannot silently consume the message.
  answeredWhisperCharacterIds: string[];
  // PCs whose combat turn was adjudicated this DM turn; the initiative
  // pointer only advances past a PC on this list (or with a landed roll).
  resolvedCharacterIds: string[];
  imageArgs: { prompt: string; reason?: string } | null;
  locationId: string | null;
  mutationCount: number;
  encounterCount: number;
  // What this turn's prompt cost, block by block (src/lib/dm/context-budget.ts).
  contextTrace: ContextTrace | null;
  createdAt: string;
  updatedAt: string;
  // When the lead reverted the turn (markDmTurnReverted). Absent on a turn
  // that stands.
  revertedAt?: string;
  // What the narration guard did, set on the turn in hand just before it
  // ends (src/lib/dm/turn.ts) and written to its turn_quality row (issue
  // #460). Not a column of dm_turns: a turn read back carries none, and its
  // quality row keeps the outcome already stored.
  guard?: GuardReport;
};

type TurnRow = {
  id: string;
  campaign_id: string;
  status: DmTurnStatus;
  actor: DmTurnActor | null;
  call_index: number;
  conversation_json: string;
  narration_parts_json: string;
  roll_ids_json: string;
  player_whisper_ids_json: string;
  answered_whisper_character_ids_json: string | null;
  resolved_character_ids_json: string | null;
  image_args_json: string | null;
  location_id: string | null;
  mutation_count: number;
  encounter_count: number;
  context_trace_json: string | null;
  created_at: string;
  updated_at: string;
  reverted_at?: string | null;
};

function mapTurn(row: TurnRow): DmTurn {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    status: row.status,
    actor: row.actor === "human_dm" ? "human_dm" : "ai",
    callIndex: row.call_index,
    conversation: parseJson<ChatMessage[]>(row.conversation_json, []),
    narrationParts: parseJson<string[]>(row.narration_parts_json, []),
    rollIds: parseJson<string[]>(row.roll_ids_json, []),
    playerWhisperIds: parseJson<string[]>(row.player_whisper_ids_json, []),
    answeredWhisperCharacterIds: parseJson<string[]>(
      row.answered_whisper_character_ids_json,
      [],
    ),
    resolvedCharacterIds: parseJson<string[]>(row.resolved_character_ids_json, []),
    imageArgs: parseJson<DmTurn["imageArgs"]>(row.image_args_json, null),
    locationId: row.location_id ?? null,
    mutationCount: row.mutation_count,
    encounterCount: row.encounter_count ?? 0,
    contextTrace: parseJson<ContextTrace | null>(row.context_trace_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.reverted_at ? { revertedAt: row.reverted_at } : {}),
  };
}

// The lead reverted the turn (src/app/api/campaigns/[campaignId]/audit/
// revert-turn): the turn trace reads it as taken back, and the stand-in
// turns opened inside it with it, whose rolls were its own. Its own column,
// never written by saveDmTurn, so a turn still in hand cannot write it away.
export function markDmTurnReverted(turnId: string) {
  getDatabase().prepare(`UPDATE dm_turns SET reverted_at = ? WHERE id = ? OR owner_turn_id = ?`).run(nowIso(), turnId, turnId);
}

export function createDmTurn(
  campaignId: string,
  conversation: ChatMessage[],
  actor: DmTurnActor = "ai",
): DmTurn {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO dm_turns (id, campaign_id, status, actor, call_index, conversation_json, created_at, updated_at)
        VALUES (?, ?, 'running', ?, 0, ?, ?, ?)
      `,
    )
    .run(id, campaignId, actor, JSON.stringify(conversation), now, now);
  const turn = getDmTurn(id);
  if (!turn) {
    throw new Error("Failed to create GM turn.");
  }
  return turn;
}

// A person's turn the engine opens for the rolls it makes on its own (a
// zone's save, a hold's damage as the pointer starts a turn, an opportunity
// strike), and closes once that work is done. Opened inside another turn,
// the sheet changes it records are that turn's, so reverting the turn that
// moved the pointer takes them back too (issue #622).
export function openStandInTurn(campaignId: string): DmTurn {
  const turn = createDmTurn(campaignId, [], "human_dm");
  standInFor(turn.id);
  // Which turn it stands in for, kept on its row so that turn's revert can
  // mark it (markDmTurnReverted).
  const owner = currentTurnId();
  if (owner) {
    getDatabase().prepare(`UPDATE dm_turns SET owner_turn_id = ? WHERE id = ?`).run(owner, turn.id);
  }
  return turn;
}

export function closeStandInTurn(turn: DmTurn) {
  releaseStandIn(turn.id);
  turn.status = "done";
  saveDmTurn(turn);
}

export function getDmTurn(turnId: string): DmTurn | null {
  const row = getDatabase().prepare(`SELECT * FROM dm_turns WHERE id = ?`).get(turnId) as
    | TurnRow
    | undefined;
  return row ? mapTurn(row) : null;
}

export function saveDmTurn(turn: DmTurn) {
  const saved = getDatabase()
    .prepare(
      `
        UPDATE dm_turns SET
          status = ?, call_index = ?, conversation_json = ?,
          narration_parts_json = ?, roll_ids_json = ?, player_whisper_ids_json = ?, answered_whisper_character_ids_json = ?, resolved_character_ids_json = ?, image_args_json = ?,
          location_id = ?, mutation_count = ?, encounter_count = ?, context_trace_json = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(
      turn.status,
      turn.callIndex,
      JSON.stringify(turn.conversation),
      JSON.stringify(turn.narrationParts),
      JSON.stringify(turn.rollIds),
      JSON.stringify(turn.playerWhisperIds),
      JSON.stringify(turn.answeredWhisperCharacterIds),
      JSON.stringify(turn.resolvedCharacterIds),
      turn.imageArgs ? JSON.stringify(turn.imageArgs) : null,
      turn.locationId,
      turn.mutationCount,
      turn.encounterCount,
      turn.contextTrace ? JSON.stringify(turn.contextTrace) : null,
      nowIso(),
      turn.id,
    );
  // A turn that ended (done or failed) gets its narrator quality row
  // (issue #460); a person's turn and a turn still running do not, and nor
  // does a row a rewind deleted while the turn in hand was still ending.
  if (saved.changes > 0) {
    writeTurnQuality(turn);
  }
}

// Turns stuck in `running` are stale after a crash/restart; fail them so a
// new turn can start. `awaiting_rolls` turns are durable by design. Each one
// swept ends here, so its narrator quality row is written here too.
export function failStaleRunningTurns(campaignId: string, olderThanMinutes = 10) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const db = getDatabase();
  const stale = db
    .prepare(`SELECT id FROM dm_turns WHERE campaign_id = ? AND status = 'running' AND updated_at < ?`)
    .all(campaignId, cutoff) as Array<{ id: string }>;
  db.prepare(
    `UPDATE dm_turns SET status = 'failed', updated_at = ? WHERE campaign_id = ? AND status = 'running' AND updated_at < ?`,
  ).run(nowIso(), campaignId, cutoff);
  for (const { id } of stale) {
    const turn = getDmTurn(id);
    if (turn) {
      writeTurnQuality(turn);
    }
  }
}

// The campaign's newest turn. A halted turn is only retryable while it is
// still the latest one; once the story moved on, replaying its conversation
// would narrate into a scene that no longer matches.
export function getLatestDmTurnId(campaignId: string): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT id FROM dm_turns WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(campaignId) as { id: string } | undefined;
  return row?.id ?? null;
}

// The campaign's last `limit` turns, oldest first: what the admin's report
// bundle times and records (src/lib/report-bundle-server.ts).
export function listRecentDmTurns(campaignId: string, limit: number): DmTurn[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM dm_turns WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(campaignId, Math.max(1, Math.floor(limit))) as TurnRow[];
  return rows.reverse().map(mapTurn);
}

// Atomically take ownership of a failed turn for a retry. better-sqlite3 is
// synchronous, so the conditional UPDATE is the whole race guard: two players
// hitting Retry at the same moment, only one gets changes > 0 and the loser
// is told the turn is already running.
export function claimFailedDmTurn(turnId: string): DmTurn | null {
  const result = getDatabase()
    .prepare(
      `UPDATE dm_turns SET status = 'running', updated_at = ? WHERE id = ? AND status = 'failed'`,
    )
    .run(nowIso(), turnId);
  return result.changes > 0 ? getDmTurn(turnId) : null;
}

export function getAwaitingTurn(campaignId: string): DmTurn | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM dm_turns WHERE campaign_id = ? AND status = 'awaiting_rolls' ORDER BY created_at DESC LIMIT 1`,
    )
    .get(campaignId) as TurnRow | undefined;
  return row ? mapTurn(row) : null;
}

// Whether the campaign's newest AI turn is one the storyteller parked on
// physical dice: what the status line said while the process that parked it
// was up (src/lib/dm/status.ts reads this when it has no status of its own).
// Only AI turns count, because a person's adjudications (an opportunity
// strike, a zone, the console) open turns of their own mid-play without
// touching the status line. Of those, only one that asked the model
// (call_index above 0) is the storyteller's: a monster pass a person
// delegates, or an agent program's turn, never owned the line. An older
// parked turn the table walked past, with a new action instead of the roll,
// is not the newest and reads idle, as it did then.
export function latestTurnParkedByAi(campaignId: string): boolean {
  const row = newestAiTurn(campaignId);
  return row?.status === "awaiting_rolls" && row.call_index > 0;
}

// The campaign's newest AI turn: the one a parked roll may still finish
// after a restart. A person's turns opened since (an opportunity strike, a
// zone, the console) do not move the story past it; a newer AI turn did.
export function getLatestAiTurnId(campaignId: string): string | null {
  return newestAiTurn(campaignId)?.id ?? null;
}

function newestAiTurn(campaignId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, status, call_index FROM dm_turns WHERE campaign_id = ? AND actor = 'ai' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(campaignId) as { id: string; status: DmTurnStatus; call_index: number } | undefined;
}

// The AI turns a process was running when it stopped. After a restart no
// process owns them (src/lib/dm/restart-recovery.ts).
export function listRunningAiTurns(): DmTurn[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM dm_turns WHERE actor = 'ai' AND status = 'running' ORDER BY created_at, rowid`)
    .all() as TurnRow[];
  return rows.map(mapTurn);
}

// AI turns parked on physical dice whose every roll is already in: the
// resume the last roll queued lived in memory, and a restart took it.
export function listOrphanedParkedTurns(): Array<{ id: string; campaignId: string }> {
  return getDatabase()
    .prepare(
      `SELECT t.id AS id, t.campaign_id AS campaignId FROM dm_turns t
        WHERE t.actor = 'ai' AND t.status = 'awaiting_rolls'
          AND NOT EXISTS (SELECT 1 FROM pending_rolls p WHERE p.turn_id = t.id AND p.status = 'pending')
        ORDER BY t.created_at, t.rowid`,
    )
    .all() as Array<{ id: string; campaignId: string }>;
}

// ---- pending physical rolls ----

export type PendingRollStatus = "pending" | "submitted" | "fallback";

// Adjudication context a parked pc_attack to-hit roll carries: when the d20
// is submitted the server compares it to targetAc and, on a hit, parks the
// matching damage roll (src/lib/dm/pc-attack.ts).
export type PendingAttack = {
  // Touch of Death's necrotic, chosen on the hit (after-roll.ts).
  touchOfDeath?: number;
  // Another character's choice on the hit (Violent Attraction's 1d10),
  // paid for when the hit stands (attack-swing.ts).
  helperHits?: Array<{ by: string; use: AfterRollId }>;
  // Destructive Wrath, chosen on the hit (after-roll.ts): its lightning and
  // thunder dice are dealt at their maximum.
  destructiveWrath?: boolean;
  // A Valor bard's Bardic Inspiration die on this hit's damage, chosen on
  // the hit (after-roll.ts, ar-wbf-bard-dice.ts).
  combatInspiration?: boolean;
  attacker: string;
  weapon: string;
  targetEnemyId: string;
  targetAc: number;
  damageExpression: string;
  critDamageExpression: string;
  damageType?: string;
  // Condition-derived: any hit is a critical hit (paralyzed target, etc).
  autoCrit?: boolean;
  // Improved/Superior Critical: the natural roll that crits, when below 20.
  critRange?: number;
  // Great Weapon Fighting: reroll damage dice at or below this value.
  rerollBelow?: number;
  // Savage Attacker: the player rolls the weapon's dice twice and keeps the
  // better total (its once-a-turn mark was spent when the roll was parked).
  savageAttacker?: boolean;
  // What the damage stage needs to resolve the blow the way the digital
  // path does (src/lib/dm/damage-parts.ts): whether it counts as magical
  // against "nonmagical attacks" resistance, the dice that ride it under a
  // type of their own, how many trailing weapon dice a critical adds, and
  // (on the parked damage roll) whether the hit was a critical. A roll
  // parked before these were stored has none and resolves under the
  // weapon's type alone, as it always did.
  magical?: boolean;
  riders?: Array<{ dice: string; type: string; flat?: number }>;
  critExtraDice?: number;
  crit?: boolean;
  // The attack was sent with endTurn ("and end the turn"): once the last of
  // its rolls lands, the turn ends, as on the server's dice
  // (pending-roll-land.ts carryEndTurn).
  endTurn?: boolean;
};

export type PendingCarry = {
  mote?: { bardId: string; die: string; sides: number };
  // The before-the-roll features already used on this roll (Cosmic Omen,
  // Restore Balance; the before-roll route), each once.
  before?: Array<"cosmic_omen" | "restore_balance">;
  // The tool an ability check is made with (request_roll's `tool`), which
  // the roll's kind and detail do not say.
  tool?: string;
  // The call this roll stopped (src/lib/dm/held-call.ts), run again from the
  // start when the roll lands, and what that run answered.
  call?: HeldRollCall;
  answer?: string;
};

// A roll a held call already has, for its next run: the player's, as it
// landed. `raw`: faces entered at the table, before what the roll site adds
// to the dice it throws itself (a floor under the d20). `landing`: how it
// landed, so the run that records it says whose dice they were: dice rolled
// at the table are marked physical and are not thrown again on the stage.
export type DecidedRoll = {
  characterId: string;
  kind: RollKind;
  outcome: RollResult;
  raw: boolean;
  landing?: { physical: boolean; source: "digital" | "physical" };
};

// A tool call held for a player's roll. `tape`: the faces its first run drew
// by chance, [sides, face], drawn again by the next run so a die nobody saw
// comes out the same.
export type HeldRollCall = {
  name: string;
  rawArguments: string;
  toolCallId: string | null;
  decided: DecidedRoll[];
  tape: Array<[number, number]>;
  // The roll site threw the dice itself and parked them for the player's
  // choice: what lands is the site's own roll, already whole.
  siteThrew?: boolean;
};

export type PendingRoll = {
  id: string;
  campaignId: string;
  turnId: string;
  toolCallId: string | null;
  userId: string;
  characterId: string | null;
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  reason: string;
  // Damage rolls only: enemy the server applies the result to on resolve.
  targetEnemyId: string | null;
  // What a roll tool's parked roll carries to its landing, as its digital
  // throw would have used it then: the mote riding the inspiration die it
  // spent (authored-mote.ts). A pc_attack's rides its attack record instead.
  carry: PendingCarry | null;
  // pc_attack to-hit rolls only: how to adjudicate the submitted d20.
  attack: PendingAttack | null;
  // Server summary of what the resolved roll already did; the resumed turn
  // surfaces it to the model so it narrates the real outcome.
  combatNote: string | null;
  // Why the roll waits: real dice the player throws and types, or a held
  // roll the server throws when the player releases it. Null on a roll
  // parked before the reason was recorded.
  parkedFor: ParkReason | null;
  // A stop before another creature's roll (src/lib/dm/foresight.ts).
  watch: WatchStop | null;
  // The dice already thrown, waiting on the player's after-the-roll choice
  // (src/lib/dm/after-roll-logic.ts). Null until then.
  thrown: ThrownRoll | null;
  // Who may read the roll once it lands; the DM's screen, kept while the
  // roll waits.
  visibility: RollVisibility;
  status: PendingRollStatus;
  rollId: string | null;
  createdAt: string;
};

type PendingRow = {
  parked_for?: string | null;
  thrown_json?: string | null;
  carry_json?: string | null;
  watch_json?: string | null;
  id: string;
  campaign_id: string;
  turn_id: string;
  tool_call_id: string | null;
  user_id: string;
  character_id: string | null;
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  reason: string;
  target_enemy_id: string | null;
  attack_json: string | null;
  combat_note: string | null;
  visibility?: RollVisibility | null;
  status: PendingRollStatus;
  roll_id: string | null;
  created_at: string;
};

function mapPending(row: PendingRow): PendingRoll {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    turnId: row.turn_id,
    toolCallId: row.tool_call_id,
    userId: row.user_id,
    characterId: row.character_id,
    kind: row.kind,
    detail: row.detail,
    expression: row.expression,
    advantage: row.advantage,
    dc: row.dc,
    reason: row.reason,
    targetEnemyId: row.target_enemy_id ?? null,
    carry: parseJson<PendingCarry | null>(row.carry_json ?? null, null),
    attack: parseJson<PendingAttack | null>(row.attack_json, null),
    combatNote: row.combat_note ?? null,
    parkedFor:
      row.parked_for === "real_dice" || row.parked_for === "held" || row.parked_for === "after_roll" || row.parked_for === "foretold" || row.parked_for === "watch" ? row.parked_for : null,
    thrown: parseJson<ThrownRoll | null>(row.thrown_json ?? null, null),
    watch: parseJson<WatchStop | null>(row.watch_json ?? null, null),
    visibility: row.visibility ?? "public",
    status: row.status,
    rollId: row.roll_id,
    createdAt: row.created_at,
  };
}

// pending_rolls.parked_for is added here, on first use, rather than in the
// boot migration: a database opened by an older build gains the column the
// first time a roll is parked, and every row written before reads as null.
const parkColumnReady = new WeakSet<object>();

// Exported for a run that may be rolled back (src/lib/dm/held-call.ts): the
// columns are added before it opens, so a rollback never takes them away
// while this module believes they are there.
export function ensurePendingColumns() {
  ensureParkColumn();
}

function ensureParkColumn() {
  const db = getDatabase();
  if (parkColumnReady.has(db)) {
    return;
  }
  // The turn journal builds pending_rolls' triggers again after each ALTER
  // (turn-journal.ts installTurnJournal wraps exec), so a turn's picture of
  // a row holds these columns too.
  const columns = db.prepare(`PRAGMA table_info(pending_rolls)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "parked_for")) {
    db.exec(`ALTER TABLE pending_rolls ADD COLUMN parked_for TEXT`);
  }
  if (!columns.some((column) => column.name === "thrown_json")) {
    db.exec(`ALTER TABLE pending_rolls ADD COLUMN thrown_json TEXT`);
  }
  if (!columns.some((column) => column.name === "carry_json")) {
    db.exec(`ALTER TABLE pending_rolls ADD COLUMN carry_json TEXT`);
  }
  if (!columns.some((column) => column.name === "watch_json")) {
    db.exec(`ALTER TABLE pending_rolls ADD COLUMN watch_json TEXT`);
  }
  parkColumnReady.add(db);
}

// What the table's dice policy and the player's own preferences say about a
// roll parked for them now.
export function dicePreferencesOf(campaignId: string, userId: string) {
  const db = getDatabase();
  const campaign = db
    .prepare(`SELECT game_settings_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { game_settings_json: string | null } | undefined;
  const settings = parseJson<{ dicePolicy?: string }>(campaign?.game_settings_json ?? null, {});
  const member = db
    .prepare(
      `SELECT use_real_dice, hold_rolls FROM campaign_members WHERE campaign_id = ? AND user_id = ?`,
    )
    .get(campaignId, userId) as { use_real_dice: number; hold_rolls: number } | undefined;
  return {
    dicePolicy: settings.dicePolicy ?? "digital_only",
    member: member
      ? { useRealDice: Boolean(member.use_real_dice), holdRolls: Boolean(member.hold_rolls) }
      : null,
  };
}

// The calls a watch stop holds back, what the first is about to roll, and what
// the watcher chose. Null face: let it roll.
// `tape`: the faces the call drew by chance before a stop inside it
// (src/lib/dm/held-call.ts), drawn again when it runs.
export type HeldCall = { id?: string; name: string; rawArguments: string; tape?: Array<[number, number]> };
// Which feature the stop is for: Portent's number before the roll, or a
// watch row of src/lib/dm/after-roll-table.ts (Chronal Shift, Flash of
// Genius, Favored by the Gods, Convergent Future, Bend Luck) decided now and
// taken once the roll goes the wrong way (src/lib/dm/chronal-shift.ts). A
// stop stored before there were two is Portent's. Slayer's Counter and the
// Cloud Rune act at the stop itself (answeredAtStop), arming nothing on the
// dice.
export type { WatchPower } from "@/lib/dm/after-roll-table";
export { answeredAtStop } from "@/lib/dm/after-roll-table";
// One creature's roll the stop may answer: its tag on the dice, and the way
// it must go for a Chronal Shift to take it ("success" a foe's, "failure" an
// ally's).
export type WatchRoll = { tag: RollTag; reverse: "success" | "failure" };
// Whose roll: a creature by name, and the rolls of theirs the call may make
// (a spell at a creature is the caster's attack or the creature's save,
// whichever d20 comes first). An area holds one choice per creature in it.
// `ref`: the creature a Cloud Rune stop's choice turns the attack onto.
export type WatchChoice = { name: string; rolls: WatchRoll[]; ref?: string };
export type WatchStop = {
  calls: HeldCall[];
  tag: RollTag;
  // Other rolls the number may land on instead, whichever d20 comes first: a
  // spell at a creature is the caster's attack or the creature's save.
  also?: RollTag[];
  line: string;
  face: number | null;
  deadline: string;
  // A resumed turn has begun running the calls: if they are still here after a
  // restart, the process died among them, and they do not run twice.
  taken?: boolean;
  power?: WatchPower;
  choices?: WatchChoice[];
  // The choice the watcher picked; with one choice there is nothing to pick.
  chosen?: number | null;
  // The watcher said to use it if the roll goes wrong: a Chronal Shift rolls
  // it again, Flash of Genius and Favored by the Gods add to a failed save.
  shift?: boolean;
  // The hit a Cloud Rune stop holds (cloud-rune.ts): who attacked whom, and
  // which swing of the call it was.
  hit?: { attackerId: string; struckId: string; swing: number };
};

// The choice a stop's answer stands on: the one picked, or the only one.
export function watchChoiceOf(watch: Pick<WatchStop, "choices" | "chosen">): WatchChoice | null {
  const choices = watch.choices ?? [];
  const index = typeof watch.chosen === "number" ? watch.chosen : choices.length === 1 ? 0 : -1;
  return index >= 0 && index < choices.length ? choices[index] : null;
}

// What a Chronal Shift answers on this choice, in the card's words: "if it
// succeeds" for a foe's save, "if it fails" or "if it misses" for an ally's.
export function shiftWhen(choice: WatchChoice): string {
  const reverses = new Set(choice.rolls.map((roll) => roll.reverse));
  if (reverses.size > 1) {
    return "if it goes against you";
  }
  if (reverses.has("success")) {
    return choice.rolls.every((roll) => roll.tag.kind === "attack") ? "if it hits" : "if it succeeds";
  }
  return choice.rolls.every((roll) => roll.tag.kind === "attack") ? "if it misses" : "if it fails";
}

export function setPendingWatch(id: string, watch: WatchStop): PendingRoll | null {
  ensureParkColumn();
  const result = getDatabase().prepare(`UPDATE pending_rolls SET watch_json = ? WHERE id = ? AND status = 'pending'`).run(JSON.stringify(watch), id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}

// The watcher's answer closes the stop: no roll is written against it, and the
// resumed turn runs what it held (src/lib/dm/turn.ts).
export function resolvePendingWatch(id: string, face: number | null, answer: { chosen?: number | null; shift?: boolean } = {}): PendingRoll | null {
  const pending = getPendingRoll(id);
  if (!pending?.watch) {
    return null;
  }
  const result = getDatabase()
    .prepare(`UPDATE pending_rolls SET status = 'fallback', watch_json = ? WHERE id = ? AND status = 'pending'`)
    .run(JSON.stringify({ ...pending.watch, face, ...(answer.chosen !== undefined ? { chosen: answer.chosen } : {}), ...(answer.shift ? { shift: true } : {}) }), id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}

// Every stop still open, whatever the table: a restart lets them go.
export function listOpenWatchStops(): PendingRoll[] {
  ensureParkColumn();
  const rows = getDatabase().prepare(`SELECT * FROM pending_rolls WHERE status = 'pending' AND parked_for = 'watch'`).all() as PendingRow[];
  return rows.map(mapPending);
}

// The held calls are the resumed turn's now, once. A stop already taken comes
// back marked, for its turn to answer what never ran.
export function takeHeldCalls(id: string): WatchStop | null {
  const pending = getPendingRoll(id);
  if (!pending?.watch?.calls.length) {
    return null;
  }
  if (!pending.watch.taken) {
    getDatabase().prepare(`UPDATE pending_rolls SET watch_json = ? WHERE id = ?`).run(JSON.stringify({ ...pending.watch, taken: true }), id);
  }
  return pending.watch;
}

export function dropHeldCalls(id: string) {
  const pending = getPendingRoll(id);
  if (pending?.watch) {
    getDatabase().prepare(`UPDATE pending_rolls SET watch_json = ? WHERE id = ?`).run(JSON.stringify({ ...pending.watch, calls: [] }), id);
  }
}

// The numbers a stop of this turn has chosen and its calls have yet to use: not
// paid for yet, so not free to spend again.
export function foretoldPromised(turnId: string, characterId: string): number[] {
  return listPendingForTurn(turnId)
    .filter((entry) => entry.characterId === characterId && entry.status !== "pending" && entry.watch?.calls.length && entry.watch.face !== null)
    .map((entry) => entry.watch?.face as number);
}

export function createPendingRoll(input: {
  campaignId: string;
  turnId: string;
  toolCallId: string | null;
  userId: string;
  characterId: string | null;
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  reason: string;
  targetEnemyId?: string | null;
  carry?: PendingCarry | null;
  attack?: PendingAttack | null;
  // Left out by every caller today: the reason is read from the table's dice
  // policy and the player's preferences as the roll is parked.
  parkedFor?: ParkReason;
  thrown?: ThrownRoll;
  visibility?: RollVisibility;
}): PendingRoll {
  const id = crypto.randomUUID();
  ensureParkColumn();
  const preferences = dicePreferencesOf(input.campaignId, input.userId);
  // A roll parked for somebody with neither preference (a test, a caller
  // that parks by its own rule) is a held roll: the server throws it.
  const parkedFor =
    input.parkedFor ?? parkReasonFor(preferences.dicePolicy, preferences.member) ?? "held";
  getDatabase()
    .prepare(
      `
        INSERT INTO pending_rolls (
          id, campaign_id, turn_id, tool_call_id, user_id, character_id, kind,
          detail, expression, advantage, dc, reason, target_enemy_id, carry_json, attack_json, parked_for,
          thrown_json, visibility, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.turnId,
      input.toolCallId,
      input.userId,
      input.characterId,
      input.kind,
      input.detail,
      input.expression,
      input.advantage,
      input.dc,
      input.reason,
      input.targetEnemyId ?? null,
      input.carry && Object.keys(input.carry).length ? JSON.stringify(input.carry) : null,
      input.attack ? JSON.stringify(input.attack) : null,
      parkedFor,
      input.thrown ? JSON.stringify(input.thrown) : null,
      input.visibility ?? "public",
      nowIso(),
    );
  const pending = getPendingRoll(id);
  if (!pending) {
    throw new Error("Failed to create pending roll.");
  }
  return pending;
}

// Client-facing projection: the adjudication context (enemy AC) and the
// model-facing combat note never ride events or snapshots to players.
export function publicPendingRoll(pending: PendingRoll): Omit<PendingRoll, "attack" | "combatNote"> {
  const rest: Partial<PendingRoll> = { ...pending };
  delete rest.attack;
  delete rest.combatNote;
  // A stop's held calls are the model's own words, and may name what the table
  // has not seen: the card reads its line and its time.
  // The creatures to pick from are ones the table can see (foresight.ts
  // reads only those), so their names and the shift's words ride too.
  if (pending.watch) {
    const { line, deadline, power, choices } = pending.watch;
    rest.watch = {
      line,
      deadline,
      ...(power ? { power } : {}),
      ...(choices?.length ? { choices: choices.map((choice) => ({ name: choice.name, when: shiftWhen(choice) })) } : {}),
    } as unknown as WatchStop;
  }
  return rest as Omit<PendingRoll, "attack" | "combatNote">;
}

export function getPendingRoll(id: string): PendingRoll | null {
  const row = getDatabase().prepare(`SELECT * FROM pending_rolls WHERE id = ?`).get(id) as
    | PendingRow
    | undefined;
  return row ? mapPending(row) : null;
}

export function listPendingForTurn(turnId: string): PendingRoll[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM pending_rolls WHERE turn_id = ? ORDER BY created_at ASC`)
    .all(turnId) as PendingRow[];
  return rows.map(mapPending);
}

export function listOpenPendingRolls(campaignId: string): PendingRoll[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM pending_rolls WHERE campaign_id = ? AND status = 'pending' ORDER BY created_at ASC`,
    )
    .all(campaignId) as PendingRow[];
  return rows.map(mapPending);
}

// Every roll at any table still waiting on its player's after-the-roll
// choice, for the timers a restart lost (src/lib/dm/after-roll-timer.ts).
// By its thrown dice, not its park reason: a roll entered with real dice
// waits on the same card, still parked for real dice.
export function listOpenAfterRolls(): PendingRoll[] {
  // Read at boot, before anything else may have added the column.
  ensureParkColumn();
  const rows = getDatabase()
    .prepare(`SELECT * FROM pending_rolls WHERE status = 'pending' AND thrown_json IS NOT NULL ORDER BY created_at ASC`)
    .all() as PendingRow[];
  return rows.map(mapPending);
}

export function setPendingCombatNote(id: string, note: string) {
  getDatabase()
    .prepare(`UPDATE pending_rolls SET combat_note = ? WHERE id = ?`)
    .run(note.slice(0, 500), id);
}

// What a parked roll carries, written while it is still open (the
// before-roll route's used features). Null once resolved.
export function setPendingCarry(id: string, carry: PendingCarry): PendingRoll | null {
  const result = getDatabase()
    .prepare(`UPDATE pending_rolls SET carry_json = ? WHERE id = ? AND status = 'pending'`)
    .run(Object.keys(carry).length ? JSON.stringify(carry) : null, id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}

// A parked roll the player spent Inspiration on takes its new d20 term while
// it is still open (src/lib/dm/pending-inspiration.ts). Null once resolved.
export function setPendingAdvantage(id: string, expression: string, advantage: Advantage): PendingRoll | null {
  const result = getDatabase()
    .prepare(`UPDATE pending_rolls SET expression = ?, advantage = ? WHERE id = ? AND status = 'pending'`)
    .run(expression, advantage, id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}

// The dice as they stand while the player decides. Only a roll still waiting
// takes it, so a choice racing the roll's landing changes nothing.
export function setPendingThrown(id: string, thrown: ThrownRoll): PendingRoll | null {
  // A roll parked by an older build reaches here with no column to write.
  ensureParkColumn();
  const result = getDatabase()
    .prepare(`UPDATE pending_rolls SET thrown_json = ? WHERE id = ? AND status = 'pending'`)
    .run(JSON.stringify(thrown), id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}

// The attack's record as it now stands: the attacks queued behind the roll,
// then what they did once it landed (pc-attack-parts.ts runQueuedParts).
export function setPendingAttack(id: string, attack: PendingAttack): PendingRoll | null {
  const result = getDatabase().prepare(`UPDATE pending_rolls SET attack_json = ? WHERE id = ?`).run(JSON.stringify(attack), id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}

// A card taken off the table with nothing rolled against it, as a watch stop
// closes: a to-hit roll whose dice were never entered when the lead skipped
// its turn (src/lib/dm/pending-roll-land.ts keepRollsLeftBehind).
export function withdrawPendingRoll(id: string): PendingRoll | null {
  const result = getDatabase().prepare(`UPDATE pending_rolls SET status = 'fallback' WHERE id = ? AND status = 'pending'`).run(id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}

export function resolvePendingRoll(
  id: string,
  status: "submitted" | "fallback",
  rollId: string,
): PendingRoll | null {
  const result = getDatabase()
    .prepare(`UPDATE pending_rolls SET status = ?, roll_id = ? WHERE id = ? AND status = 'pending'`)
    .run(status, rollId, id);
  return result.changes > 0 ? getPendingRoll(id) : null;
}
