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
  publicPendingRoll,
  saveDmTurn,
  type DecidedRoll,
  type DmTurn,
  type HeldRollCall,
  type PendingRoll,
} from "@/lib/db/dm-turns";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getRoll, insertRoll, type RollKind, type RollVisibility, type StoredRoll } from "@/lib/db/rolls";
import type { Advantage, RollResult } from "@/lib/dice";
import type { ThrownRoll } from "@/lib/dm/after-roll-logic";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { DiceTapeCursor, nextDecided } from "@/lib/dm/held-call-logic";
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
  // The dice the run has thrown, any kind, any source: a stop for a watcher
  // comes only before the first, so nothing thrown is thrown again.
  dice: number;
  // The run has had its look for a watcher (or its stop was answered).
  watched: boolean;
  watchStop: string | null;
  watchTag?: RollTag;
  watchTapeAt?: number;
  watchers?: boolean;
  decided: DecidedRoll[];
  used: Set<number>;
  feed: DiceTapeCursor;
  drawn: Array<[number, number]>;
  park: (HeldPark & { tapeAt: number }) | null;
};

declare global {
  var __odmHeldTrial: Trial | null | undefined;
  // foresight.ts watchStopForRoll, registered there: the stop for the d20 a
  // call is about to throw, or null.
  var __odmWatchStop: ((campaign: Campaign, turn: DmTurn, call: HeldCallSpecShape, tag: RollTag, open?: boolean) => string | null) | undefined;
  // Tables whose next held call is a watch stop's, already answered.
  var __odmWatchAnswered: Map<string, Array<[number, number]>> | undefined;
  var __odmAnyoneWatching: ((campaignId: string) => boolean) | undefined;
}

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
  return trial.decided[at];
}

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

export type HeldCallSpec = { name: string; rawArguments: string; toolCallId: string | null };

// What a held call already has when it runs again.
type Previous = Pick<HeldRollCall, "decided" | "tape">;

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
    dice: 0,
    watched: answered,
    watchStop: null,
    decided: [...(previous?.decided ?? [])],
    used: new Set(),
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
        result = run();
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
  const stop = tag ? (globalThis.__odmWatchStop?.(campaign, turn, held, tag) ?? null) : null;
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
}

export function registerHeldRunner(runner: HeldRunner) {
  globalThis.__odmHeldRunner = runner;
}

// A held roll has landed: the call runs again with it, and what it answered
// is kept for the turn to hand on (turn.ts resumeDmTurn). The roll the run
// recorded for the player is the card's; with none (the call was refused
// this time) the player's dice are recorded as they landed.
export function runHeldAgain(
  campaign: Campaign,
  pending: PendingRoll,
  outcome: RollResult,
  landing: { status: "submitted" | "fallback"; physical: boolean; source: "digital" | "physical" },
): { roll: StoredRoll | null; answer: ToolResult | null } {
  const call = pending.carry?.call;
  const turn = getDmTurn(pending.turnId);
  const runner = globalThis.__odmHeldRunner;
  if (!call || !turn || !runner || !pending.characterId) {
    return { roll: null, answer: null };
  }
  const since = nowIso();
  const decided: DecidedRoll = { characterId: pending.characterId, kind: pending.kind, outcome, raw: !call.siteThrew };
  const spec = { name: call.name, rawArguments: call.rawArguments, toolCallId: call.toolCallId };
  let answer: ToolResult;
  try {
    answer = runHeld(campaign, turn, spec, () => runner(campaign, turn, spec), { decided: [...call.decided, decided], tape: call.tape }) as ToolResult;
  } catch (error) {
    console.error(`[held-call] ${call.name} threw when its roll landed:`, error);
    answer = { error: `${call.name} failed on the server once the roll landed, so nothing came of it.`, retry: true };
  }
  saveDmTurn(turn);
  const found = getDatabase()
    .prepare(`SELECT id FROM rolls WHERE campaign_id = ? AND character_id = ? AND roll_kind = ? AND created_at >= ? ORDER BY rowid ASC LIMIT 1`)
    .get(campaign.id, pending.characterId, pending.kind, since) as { id: string } | undefined;
  let roll: StoredRoll | null = found ? getRoll(found.id) : null;
  if (!roll) {
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
  const told = isHeldPark(answer) ? null : answer;
  getDatabase()
    .prepare(`UPDATE pending_rolls SET roll_id = ?, carry_json = ? WHERE id = ?`)
    .run(roll?.id ?? null, JSON.stringify({ ...pending.carry, ...(told ? { answer: JSON.stringify(told) } : {}) }), pending.id);
  return { roll, answer: told };
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
  const runner = globalThis.__odmHeldRunner;
  return runner ? (runHeld(campaign, turn, call, () => runner(campaign, turn, call)) as ToolResult) : null;
}
