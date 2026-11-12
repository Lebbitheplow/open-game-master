// A tool call held for a player's roll.
//
// Every place a player's character throws a d20 inside a tool call goes
// through src/lib/dm/character-roll.ts rollCharacterD20, and that may need
// the player before the call can go on: a seat on physical dice rolls its own
// d20, a player holding Lucky or Bardic Inspiration decides once the dice are
// seen, a wizard holding Portent may put a number on their own roll. The call
// cannot simply pause there, half done. So every tool call the engine runs
// for the GM (src/lib/dm/invoke-dispatch.ts for the console and connected
// agents, src/lib/dm/turn.ts for the AI's turn) runs inside runHeld: one
// database transaction, its events held back. A roll that must wait rolls
// the whole call back, parks one roll card that remembers the call, and the
// call answers that it waits. When the roll lands (pending-roll-land.ts), the
// call is run again from the start with that roll in hand, and the faces its
// first run drew by chance drawn again, so it goes the way it went until the
// roll and then on with the player's dice. A second player's roll in the
// same call parks again in the same way.
//
// Before this, every check tool rolled its own d20 and only request_roll knew
// to wait: a model that answered a player with group_check, social_check or
// a shove got the seat's dice thrown by the server (issue #896), and a luck
// point was never offered on a save a spell forced. A new tool that throws a
// character's d20 through rollCharacterD20 waits as these do, with nothing
// more to write.

import { getDatabase, nowIso } from "@/lib/db/core";
import { holdDeliveries, publishPersisted, publishWithSeq } from "@/lib/events";
import {
  createPendingRoll,
  ensurePendingColumns,
  getDmTurn,
  getPendingRoll,
  publicPendingRoll,
  saveDmTurn,
  type DecidedRoll,
  type DmTurn,
  type HeldRollCall,
  type PendingRoll,
  type WatchChoice,
  type WatchPower,
  type WatchStop,
} from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getRoll, insertRoll, type RollKind, type RollVisibility, type StoredRoll } from "@/lib/db/rolls";
import type { Advantage, RollResult } from "@/lib/dice";
import type { ThrownRoll } from "@/lib/dm/after-roll-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { DiceTapeCursor, nextDecided } from "@/lib/dm/held-call-logic";
import { settleAfterCall } from "@/lib/dm/ar-ws-after-call";
import type { RollTag } from "@/lib/dice-script-logic";

// What a roll that must wait asks for: the card it parks.
export type HeldPark = {
  sheet: { id: string; userId: string; name: string };
  kind: RollKind;
  detail: string;
  expression: string;
  advantage: Advantage;
  dc: number | null;
  reason: string;
  visibility: RollVisibility;
  parkedFor: "real_dice" | "held" | "after_roll" | "foretold";
  // The dice already thrown, for the after-the-roll card.
  thrown?: ThrownRoll;
  // What the call answers while it waits.
  note: string;
};

type Trial = {
  campaignId: string;
  // The turn the call is made on: a dice card rolled inside it is that
  // turn's (heldCallTurn below).
  turn: DmTurn;
  // The dice the run has thrown, any kind, any source: a stop for a watcher
  // comes only before the first, so nothing thrown is thrown again.
  dice: number;
  // The run has had its look for a watcher (or its stop was answered).
  watched: boolean;
  watchStop: string | null;
  watchTag?: RollTag;
  watchTapeAt?: number;
  watchers?: boolean;
  // A stop made after a die (stopAfterThrow): opens its own card once the
  // run is rolled back.
  reopen?: (held: HeldCallSpecShape) => string | null;
  decided: DecidedRoll[];
  used: Set<number>;
  // The decided rolls taken and not yet on record, and the roll each one's
  // record became: the card a decided roll answers is linked to that roll
  // (runHeldAgain), not to whichever roll of the character came first.
  taken: Array<{ at: number; characterId: string; kind: RollKind }>;
  recorded: Map<number, string>;
  feed: DiceTapeCursor;
  drawn: Array<[number, number]>;
  park: (HeldPark & { tapeAt: number }) | null;
};

declare global {
  var __odmHeldTrial: Trial | null | undefined;
  var __odmRollRecorded: ((roll: { id: string; characterId: string | null; kind: RollKind }) => void) | undefined;
  // foresight.ts watchStopForRoll, registered there: the stop for the d20 a
  // call is about to throw, or null.
  var __odmWatchStop: ((campaign: Campaign, turn: DmTurn, call: HeldCallSpecShape, tag: RollTag, open?: boolean) => string | null) | undefined;
  // Tables whose next held call is a watch stop's, already answered.
  var __odmWatchAnswered: Map<string, Array<[number, number]>> | undefined;
  var __odmAnyoneWatching: ((campaignId: string) => boolean) | undefined;
  // foresight.ts openStopFor, registered there: a watch stop's card for one
  // watcher, holding these calls. Its id.
  var __odmOpenStop: ((campaign: Campaign, turnId: string, calls: readonly HeldCallSpecShape[], found: OpenedStop, line: string) => string) | undefined;
}

// What a stop asks of its watcher (foresight.ts openStopFor).
export type OpenedStop = { watcher: CharacterSheet; power: WatchPower; choices: WatchChoice[]; hit?: WatchStop["hit"] };

type HeldCallSpecShape = { id?: string; name: string; rawArguments: string; tape?: Array<[number, number]> };

// Thrown to unwind the call to runHeld. Caught there; a handler that catches
// it anyway still parks, since the park is read off the trial.
class HeldRollParked extends Error {}

const ROLLBACK = Symbol("held-call rollback");

// The calls that parked, so the caller tells them from a finished one.
const PARKED = new WeakSet<object>();

export function isHeldPark(result: unknown): boolean {
  return typeof result === "object" && result !== null && PARKED.has(result);
}

// Whether a held call is running: a roll may wait only inside one.
export function inHeldCall(): boolean {
  return Boolean(globalThis.__odmHeldTrial);
}

// The turn a held call is running on, for a site deep in the call that
// cards its own dice and was handed no turn (resource-tools.ts rollHealing):
// the card joins that turn's, so the chronicle shows it with the rest.
export function heldCallTurn(): DmTurn | null {
  return globalThis.__odmHeldTrial?.turn ?? null;
}

// The roll this character's run already has, of this kind, if any.
export function takeDecided(characterId: string, kind: RollKind): DecidedRoll | null {
  const trial = globalThis.__odmHeldTrial;
  if (!trial) {
    return null;
  }
  const at = nextDecided(trial.decided, trial.used, characterId, kind);
  if (at < 0) {
    return null;
  }
  trial.used.add(at);
  trial.taken.push({ at, characterId, kind });
  return trial.decided[at];
}

// A roll went on record (db/rolls.ts insertRoll calls this through
// globalThis.__odmRollRecorded, as the db layer cannot import this module):
// the first decided roll taken for that character and kind and not yet on
// record is the one it records. A roll the server throws before the decided
// one is taken (an elixir's effect die ahead of the drinker's temporary hit
// points) is never mistaken for it.
function noteRollRecorded(roll: { id: string; characterId: string | null; kind: RollKind }) {
  const trial = globalThis.__odmHeldTrial;
  if (!trial || !roll.characterId) {
    return;
  }
  const index = trial.taken.findIndex((entry) => entry.characterId === roll.characterId && entry.kind === roll.kind);
  if (index < 0) {
    return;
  }
  const [entry] = trial.taken.splice(index, 1);
  trial.recorded.set(entry.at, roll.id);
}
globalThis.__odmRollRecorded = noteRollRecorded;

// How many faces the run has drawn by chance so far: a park after its own
// throw keeps only the faces before it, since the next run is handed that
// roll whole.
export function tapeMark(): number {
  return globalThis.__odmHeldTrial?.drawn.length ?? 0;
}

// Parks the call on this roll. Never returns.
export function parkHeldCall(park: HeldPark, tapeAt = tapeMark()): never {
  const trial = globalThis.__odmHeldTrial;
  if (!trial) {
    throw new Error("parkHeldCall outside a held call");
  }
  trial.park ??= { ...park, tapeAt };
  throw new HeldRollParked(park.note);
}

// A stop made inside the call after its dice have begun: a hit held before
// its damage is rolled (the Cloud Rune, cloud-rune.ts), where a stop before
// the call's first d20 would come before anyone knows it hits. The faces
// drawn so far go on the stop's tape, so the answered call throws them again
// the same and reaches the same hit. Only inside a held call, and not once a
// player's roll has landed in it: the stop keeps the tape, not their dice.
// Nor under a Portent number or a Chronal Shift armed on the call: the face
// they put on a d20 is no chance draw, so the tape would not carry it.
export function canStopAfterThrow(): boolean {
  const trial = globalThis.__odmHeldTrial;
  if (!trial || trial.decided.length || trial.park || trial.watchStop || !globalThis.__odmOpenStop) {
    return false;
  }
  const armed = armedNow(trial.campaignId);
  return !armed.faces && !armed.shifts;
}

// Stops the call here for `stop.watcher` (canStopAfterThrow first). Never returns.
export function stopAfterThrow(campaign: Campaign, turn: DmTurn, stop: OpenedStop, line: string): never {
  const trial = globalThis.__odmHeldTrial;
  if (!trial || !canStopAfterThrow()) {
    throw new Error("stopAfterThrow where no stop can be made");
  }
  trial.watched = true;
  trial.watchStop = stop.watcher.id;
  trial.watchTapeAt = trial.drawn.length;
  trial.reopen = (held) => globalThis.__odmOpenStop?.(campaign, turn.id, [held], stop, line) ?? null;
  throw new HeldRollParked("waiting on a watcher");
}

export type HeldCallSpec = { name: string; rawArguments: string; toolCallId: string | null };

// What a held call already has when it runs again.
// `recorded` is filled by the run: the roll each decided roll became, by its
// place in `decided`.
type Previous = Pick<HeldRollCall, "decided" | "tape"> & { recorded?: Map<number, string> };

type Armed = { used: boolean; note?: string | null } & Record<string, unknown>;

// Portent's number and a Chronal Shift are armed on the dice around a call
// (foresight.ts, chronal-shift.ts) and marked used in memory: a run rolled
// back gives them back.
function armedNow(campaignId: string) {
  const faces = globalThis.__odmArmedFaces?.get(campaignId) as Armed | undefined;
  const shifts = globalThis.__odmArmedShifts?.get(campaignId) as Armed | undefined;
  return { faces: faces ? { ...faces } : undefined, shifts: shifts ? { ...shifts } : undefined };
}

function rearm(campaignId: string, armed: ReturnType<typeof armedNow>) {
  if (armed.faces) {
    globalThis.__odmArmedFaces?.set(campaignId, armed.faces as never);
  } else {
    globalThis.__odmArmedFaces?.delete(campaignId);
  }
  if (armed.shifts) {
    globalThis.__odmArmedShifts?.set(campaignId, armed.shifts as never);
  } else {
    globalThis.__odmArmedShifts?.delete(campaignId);
  }
}

// Runs one tool call so a roll inside it may wait on its player. A call
// inside another held call is part of it: the outer one is what waits.
export function runHeld<T>(campaign: Campaign, turn: DmTurn, call: HeldCallSpec, run: () => T, previous?: Previous): T | ToolResult {
  if (globalThis.__odmHeldTrial) {
    return run();
  }
  ensurePendingColumns();
  const answeredTape = globalThis.__odmWatchAnswered?.get(campaign.id);
  const answered = answeredTape !== undefined;
  globalThis.__odmWatchAnswered?.delete(campaign.id);
  const trial: Trial = {
    campaignId: campaign.id,
    turn,
    dice: 0,
    watched: answered,
    watchStop: null,
    decided: [...(previous?.decided ?? [])],
    used: new Set(),
    taken: [],
    recorded: previous?.recorded ?? new Map(),
    feed: new DiceTapeCursor(previous?.tape ?? answeredTape ?? []),
    drawn: [],
    park: null,
  };
  const rollIds = turn.rollIds.length;
  const armed = armedNow(campaign.id);
  const deliveries = holdDeliveries();
  let result: T | undefined;
  let rolledBack = false;
  // A handler that fails keeps what it did before it failed, as it always
  // has: only a park takes the run back.
  let failed: { error: unknown } | null = null;
  globalThis.__odmHeldTrial = trial;
  globalThis.__odmDiceTape = {
    taped: (sides) => trial.feed.next(sides),
    drawn: (sides, face) => {
      trial.drawn.push([sides, face]);
    },
    // A stop may come before any d20 of the call: a die thrown before it is
    // on the tape, and the answered call throws it again the same.
    before: (sides, frame) => {
      trial.dice += 1;
      if (trial.watched || sides !== 20 || !frame.purpose || trial.decided.length) {
        return;
      }
      trial.watchers ??= globalThis.__odmAnyoneWatching?.(campaign.id) ?? false;
      if (!trial.watchers) {
        trial.watched = true;
        return;
      }
      const stop = globalThis.__odmWatchStop?.(campaign, turn, { ...(call.toolCallId ? { id: call.toolCallId } : {}), name: call.name, rawArguments: call.rawArguments }, frame.purpose, false) ?? null;
      if (stop) {
        trial.watched = true;
        trial.watchStop = stop;
        trial.watchTag = frame.purpose;
        trial.watchTapeAt = trial.drawn.length;
        throw new HeldRollParked("waiting on a watcher");
      }
    },
  };
  try {
    getDatabase().transaction(() => {
      try {
        // And what the call left for its end (ar-ws-after-call.ts).
        result = settleAfterCall(trial, run());
      } catch (error) {
        if (!(error instanceof HeldRollParked) || (!trial.park && !trial.watchStop)) {
          failed = { error };
          return;
        }
      }
      if (trial.park || trial.watchStop) {
        throw ROLLBACK;
      }
    })();
  } catch (error) {
    if (error !== ROLLBACK) {
      deliveries.release(false);
      throw error;
    }
    rolledBack = true;
  } finally {
    globalThis.__odmHeldTrial = null;
    globalThis.__odmDiceTape = null;
  }
  if (failed) {
    deliveries.release(true);
    throw (failed as { error: unknown }).error;
  }
  if (!rolledBack || (!trial.park && !trial.watchStop)) {
    deliveries.release(true);
    return result as T;
  }
  // The watch's card was opened inside the run and rolled back with it:
  // what the stop told the table is dropped, and it is opened again now.
  deliveries.release(false);
  // An async handler's rejection is the park itself, not an error.
  if (result && typeof (result as { catch?: unknown }).catch === "function") {
    void (result as unknown as Promise<unknown>).catch(() => {});
  }
  turn.rollIds.length = rollIds;
  rearm(campaign.id, armed);
  if (!trial.park) {
    return parkWatch(campaign, turn, call, trial);
  }
  return parkCard(campaign, turn, call, trial, trial.park);
}

// The watcher's stop, opened again outside the rolled-back run: no die was
// thrown before it, so the call runs fresh once it is answered.
const WATCHED = new WeakMap<object, string>();

export function watchStopOf(result: unknown): string | null {
  return typeof result === "object" && result !== null ? (WATCHED.get(result) ?? null) : null;
}

function parkWatch(campaign: Campaign, turn: DmTurn, call: HeldCallSpec, trial: Trial): ToolResult {
  const tag = trial.watchTag;
  const tape = trial.drawn.slice(0, trial.watchTapeAt ?? 0);
  const held = { ...(call.toolCallId ? { id: call.toolCallId } : {}), name: call.name, rawArguments: call.rawArguments, ...(tape.length ? { tape } : {}) };
  const stop = trial.reopen ? trial.reopen(held) : tag ? (globalThis.__odmWatchStop?.(campaign, turn, held, tag) ?? null) : null;
  const answer: ToolResult = { ok: true, parked: true, note: "Waiting on a player watching for Portent before the roll." };
  PARKED.add(answer);
  if (stop) {
    WATCHED.set(answer, stop);
  }
  return answer;
}

// The next held call at this table is the one a watch stop held, answered:
// it does not stop again for the roll its stop was for (turn.ts runHeldCalls,
// foresight-release.ts for a person's turn).
export function markWatchAnswered(campaignId: string, tape: Array<[number, number]> = []) {
  (globalThis.__odmWatchAnswered ??= new Map()).set(campaignId, tape);
}

function parkCard(campaign: Campaign, turn: DmTurn, call: HeldCallSpec, trial: Trial, park: HeldPark & { tapeAt: number }): ToolResult {
  const held: HeldRollCall = {
    name: call.name,
    rawArguments: call.rawArguments,
    toolCallId: call.toolCallId,
    decided: trial.decided,
    tape: trial.drawn.slice(0, park.tapeAt),
    ...(park.thrown ? { siteThrew: true } : {}),
  };
  const pending = createPendingRoll({
    campaignId: campaign.id,
    turnId: turn.id,
    toolCallId: call.toolCallId,
    userId: park.sheet.userId,
    characterId: park.sheet.id,
    kind: park.kind,
    detail: park.detail.slice(0, 200),
    expression: park.expression,
    advantage: park.advantage,
    dc: park.dc,
    reason: park.reason.slice(0, 200),
    visibility: park.visibility,
    parkedFor: park.parkedFor,
    ...(park.thrown ? { thrown: park.thrown } : {}),
    carry: { call: held },
  });
  publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
  if (park.thrown?.deadline) {
    // Loaded late: the timer lands the roll, and the landing imports this.
    void import("@/lib/dm/after-roll-timer").then(({ armAfterRollKeep }) => armAfterRollKeep(pending.id, park.thrown?.deadline));
  }
  const answer: ToolResult = { ok: true, parked: true, note: park.note };
  PARKED.add(answer);
  return answer;
}

// Who runs a held call again: the dispatcher, registered by
// src/lib/dm/invoke-dispatch.ts so this module needs nothing of it.
export type HeldRunner = (campaign: Campaign, turn: DmTurn, call: HeldCallSpec) => ToolResult;

declare global {
  var __odmHeldRunner: HeldRunner | undefined;
  // Calls the server makes itself, under a name no GM tool has (the
  // enemy-turn backstop, backstop-calls.ts): run again by their own runner.
  var __odmNamedHeldRunners: Map<string, HeldRunner> | undefined;
}

export function registerHeldRunner(runner: HeldRunner) {
  globalThis.__odmHeldRunner = runner;
}

export function registerNamedHeldRunner(name: string, runner: HeldRunner) {
  (globalThis.__odmNamedHeldRunners ??= new Map()).set(name, runner);
}

function runnerFor(name: string): HeldRunner | undefined {
  return globalThis.__odmNamedHeldRunners?.get(name) ?? globalThis.__odmHeldRunner;
}

// A held roll has landed: the call runs again with it, and what it answered
// is kept for the turn to hand on (turn.ts resumeDmTurn). The roll the run
// recorded for the player is the card's; with none (the call was refused
// this time) the player's dice are recorded as they landed.
//
// A call may wait again, on its next roll: a second creature's healing, a
// second player's check. The dice just entered then stay with the call
// (`decided`), and the run that finishes records them with the rest.
// `waits` says so, and no roll is recorded here: recorded here as well, the
// roll was on record twice, once as it landed and once by the run that
// finished.
export function runHeldAgain(
  campaign: Campaign,
  pending: PendingRoll,
  outcome: RollResult,
  landing: { status: "submitted" | "fallback"; physical: boolean; source: "digital" | "physical" },
): { roll: StoredRoll | null; answer: ToolResult | null; waits?: boolean } {
  const call = pending.carry?.call;
  const turn = getDmTurn(pending.turnId);
  const runner = call ? runnerFor(call.name) : undefined;
  if (!call || !turn || !runner || !pending.characterId) {
    return { roll: null, answer: null };
  }
  const since = nowIso();
  const decided: DecidedRoll = {
    characterId: pending.characterId,
    kind: pending.kind,
    outcome,
    raw: !call.siteThrew,
    landing: { physical: landing.physical, source: landing.source },
  };
  const spec = { name: call.name, rawArguments: call.rawArguments, toolCallId: call.toolCallId };
  let answer: ToolResult;
  const previous: Previous = { decided: [...call.decided, decided], tape: call.tape, recorded: new Map() };
  try {
    answer = runHeld(campaign, turn, spec, () => runner(campaign, turn, spec), previous) as ToolResult;
  } catch (error) {
    console.error(`[held-call] ${call.name} threw when its roll landed:`, error);
    answer = { error: `${call.name} failed on the server once the roll landed, so nothing came of it.`, retry: true };
  }
  saveDmTurn(turn);
  const waits = isHeldPark(answer);
  // The run records this character's rolls of this kind in the order it asked
  // for them: this card's is the one after those the call's earlier cards
  // were for.
  const earlier = call.decided.filter((entry) => entry.characterId === pending.characterId && entry.kind === pending.kind).length;
  // The roll this card's own dice became, when the run put them on record
  // through insertRoll; else, by order, the run's rolls of this character and
  // kind after those the call's earlier cards were for.
  const own = waits ? undefined : previous.recorded?.get(call.decided.length);
  const found = waits
    ? undefined
    : own
      ? { id: own }
      : (getDatabase()
        .prepare(`SELECT id FROM rolls WHERE campaign_id = ? AND character_id = ? AND roll_kind = ? AND created_at >= ? ORDER BY rowid ASC LIMIT 1 OFFSET ?`)
        .get(campaign.id, pending.characterId, pending.kind, since, earlier) as { id: string } | undefined);
  let roll: StoredRoll | null = found ? getRoll(found.id) : null;
  const recorded = Boolean(roll);
  if (!roll && !waits) {
    roll = insertRoll({
      campaignId: campaign.id,
      characterId: pending.characterId,
      requestedBy: "player",
      kind: pending.kind,
      detail: landing.physical ? `${pending.detail || pending.kind} (physical)`.trim() : pending.detail,
      advantage: pending.advantage,
      dc: pending.dc,
      result: outcome,
      attacker: null,
      visibility: pending.visibility,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, pendingRollId: pending.id, source: landing.source });
  }
  const told = waits ? null : answer;
  getDatabase()
    .prepare(`UPDATE pending_rolls SET roll_id = ?, carry_json = ? WHERE id = ?`)
    .run(roll?.id ?? null, JSON.stringify({ ...pending.carry, ...(told ? { answer: JSON.stringify(told) } : {}) }), pending.id);
  // The roll the run recorded was sent as any roll of the call's is, with no
  // word of the card it answers, and a call that waits again sends no roll
  // yet: the table is told the card is done. Without this it stayed up,
  // asking for dice already entered, until the page was loaded again.
  const answered = recorded || waits ? getPendingRoll(pending.id) : null;
  if (answered && answered.status !== "pending") {
    publishPersisted(campaign.id, "roll_pending", { pendingRoll: publicPendingRoll(answered) });
  }
  return { roll, answer: told, ...(waits ? { waits } : {}) };
}

// Takes the card off the table before its call runs again, so nothing in
// the run sees it waiting. False when it was already landed.
export function claimHeldPending(pendingId: string, status: "submitted" | "fallback"): boolean {
  const result = getDatabase().prepare(`UPDATE pending_rolls SET status = ? WHERE id = ? AND status = 'pending'`).run(status, pendingId);
  return result.changes > 0;
}

export function clearWatchAnswered(campaignId: string) {
  globalThis.__odmWatchAnswered?.delete(campaignId);
}

// A call a watch stop held, run now that the watcher has answered, held in
// turn so a roll inside it may still wait on its player.
export function runHeldCallNow(campaign: Campaign, turn: DmTurn, call: HeldCallSpec): ToolResult | null {
  const runner = runnerFor(call.name);
  return runner ? (runHeld(campaign, turn, call, () => runner(campaign, turn, call)) as ToolResult) : null;
}
