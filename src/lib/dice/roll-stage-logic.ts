// The order rolls take on screen (issue 843): the roll toast and the 3D dice
// tray show one roll at a time, in the order the server rolled them, and a
// backlog is cut between actions, never inside one.
//
// The server publishes an attack's to-hit and its damage within the same tool
// call, so a seat hears them in one burst, often in one render. The toast used
// to jump straight to the newest roll (the damage, while the d20 was still in
// the air), and the tray kept only the newest three throws, which cut the
// to-hit off the front of an Extra Attack. Now every roll waits its turn on one
// stage: a thrown roll is shown when its dice land, an unthrown one (3D dice
// off, real dice, reduced motion, a hidden tab) gets a short beat of its own.
// Pure logic; src/app/campaigns/[campaignId]/DiceOverlay.tsx drives it.

import type { RollAttacker, RollKind, RollVisibility } from "@/lib/db/rolls";

// The fields of a stored roll (src/lib/db/rolls.ts) the stage reads. A roll a
// seat may not see arrives redacted (src/lib/dm/viewer.ts): no total, hidden.
export type StageRoll = {
  id: string;
  kind: RollKind;
  visibility: RollVisibility;
  total: number | null;
  attacker: Pick<RollAttacker, "kind" | "id"> | null;
  hidden?: boolean;
};

export type StageEntry<R extends StageRoll = StageRoll> = {
  seq: number;
  roll: R;
  source: string;
  // When the seat heard it (performance.now()).
  at: number;
  // The seq of the roll that opened its action: an attack, its damage and its
  // on-hit dice share one.
  group: number;
  // The dice to throw, or null when this roll is shown without a throw.
  notations: string[] | null;
};

// The most throws kept waiting. An Extra Attack (two to-hits, two damages)
// fits whole; a third swing's burst drops the oldest swing, not half of one.
export const DICE_QUEUE_MAX = 4;

// An action that waited this long before its first roll could play is old
// news: the chip in chat already shows it, and replaying it after the fight
// has moved on is what left dice tumbling "through fights and after them"
// (issue 668). Counted from when the action arrived, so an action that has
// started always plays to its end.
export const DICE_STALE_MS = 8_000;

// Rolls of one action arrive together: the server publishes them inside one
// tool call. A roll heard later than this after the last one starts its own.
export const ACTION_GAP_MS = 2_000;

// How long an unthrown roll holds the toast before the next roll may replace
// it. Long enough to read "Attack · 1d20+5 = 17 · Success"; the last one
// stays for the toast's own time.
export const TOAST_STEP_MS = 1_400;

// The rolls the stream keeps for the stage. A burst bigger than this in one
// render loses its oldest rolls before the stage hears them; three swings,
// each with its damage and an on-hit die, fit.
export const STAGE_HEARD_MAX = 12;

// The action left open by the last roll heard, which a following damage or
// on-hit roll of the same attacker joins.
export type OpenAction = { group: number; actor: string | null; lastAt: number } | null;

export function actorOf(roll: Pick<StageRoll, "attacker">): string | null {
  return roll.attacker ? `${roll.attacker.kind}:${roll.attacker.id}` : null;
}

// Which action a roll heard at `at` belongs to. An attack always opens a new
// one (the second swing of an Extra Attack is its own action). A roll that is
// not an attack joins the open action when it came in the same burst and is
// the same attacker's, or names no attacker (a Mirror Image decoy's d20).
export function placeRoll(
  open: OpenAction,
  roll: Pick<StageRoll, "kind" | "attacker">,
  seq: number,
  at: number,
): { group: number; open: OpenAction } {
  const actor = actorOf(roll);
  if (open && roll.kind !== "attack" && at - open.lastAt <= ACTION_GAP_MS && (actor === null || actor === open.actor)) {
    return { group: open.group, open: { ...open, lastAt: at } };
  }
  return { group: seq, open: roll.kind === "attack" ? { group: seq, actor, lastAt: at } : null };
}

// Whether this seat shows the roll in the toast: a public roll, or one the
// server sent this seat the number of (the roller, the GM). A blind roll's
// number is nobody's here.
export function toastShows(roll: Pick<StageRoll, "visibility" | "total">): boolean {
  return roll.visibility === "public" || typeof roll.total === "number";
}

// A revealed roll (src/lib/dm/roll-card.ts revealRolls) is published again for
// every seat. It is news only to a seat that did not already hold its number;
// the roller and the GM saw it land the first time.
export function revealIsNews(held: Pick<StageRoll, "total" | "hidden"> | undefined): boolean {
  return !held || held.hidden === true || typeof held.total !== "number";
}

// The rolls still worth showing, oldest first. `playing` is the action on
// stage now: it is never cut, so a to-hit that has landed is always followed
// by its damage. Any other action goes whole once it is stale, and while more
// throws wait than the cap the oldest waiting action goes whole. The newest
// action is always kept, stale or not: the toast ends on the latest roll, as
// it did when it simply showed the newest.
export function trimStage<E extends Pick<StageEntry, "group" | "at" | "notations">>(
  queue: readonly E[],
  now: number,
  playing: number | null,
  max: number = DICE_QUEUE_MAX,
  staleMs: number = DICE_STALE_MS,
): E[] {
  const arrived = new Map<number, number>();
  for (const entry of queue) {
    arrived.set(entry.group, Math.min(arrived.get(entry.group) ?? entry.at, entry.at));
  }
  const newest = queue.at(-1)?.group ?? null;
  let kept = queue.filter(
    (entry) => entry.group === playing || entry.group === newest || now - (arrived.get(entry.group) ?? now) < staleMs,
  );
  const throws = (list: readonly E[]) => list.filter((entry) => entry.notations).length;
  while (throws(kept) > max) {
    const waiting = [...new Set(kept.filter((entry) => entry.group !== playing).map((entry) => entry.group))];
    if (waiting.length <= 1) break;
    kept = kept.filter((entry) => entry.group !== waiting[0]);
  }
  return kept;
}

// How long a roll holds the stage after it is shown, before the next one: a
// landed throw stays a beat (shorter when others wait, so a burst does not
// stretch into the next turn; the next throw's flight keeps the toast up). An
// unthrown roll always holds a readable beat, even with nothing waiting yet:
// a damage roll heard a few milliseconds after its to-hit, in the next render,
// would otherwise replace it at once.
export function holdAfterShown(thrown: boolean, waiting: number): number {
  if (thrown) return waiting > 0 ? 300 : 1_200;
  return TOAST_STEP_MS;
}
