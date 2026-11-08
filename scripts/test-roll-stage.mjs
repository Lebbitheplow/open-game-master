// The roll stage (issue 843): the toast and the 3D dice show one roll at a
// time in the order the server rolled them, and a backlog is cut between
// actions, never inside one. Run via: npm test
import assert from "node:assert/strict";
import {
  ACTION_GAP_MS,
  DICE_QUEUE_MAX,
  DICE_STALE_MS,
  STAGE_HEARD_MAX,
  TOAST_STEP_MS,
  holdAfterShown,
  placeRoll,
  revealIsNews,
  toastShows,
  trimStage,
} from "../src/lib/dice/roll-stage-logic.ts";
import { DICE_ROLL_DEADLINE_MS } from "../src/lib/dice/dice-box-lifecycle.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const hero = { kind: "sheet", id: "h1", name: "Sera" };
const ogre = { kind: "enemy", id: "e1", name: "Ogre" };
const roll = (id, kind, attacker = hero, extra = {}) => ({ id, kind, visibility: "public", total: 10, attacker, ...extra });

// What a seat hears in one burst, placed the way the overlay places it: each
// roll joins or opens an action, and every entry throws one die. Seqs keep
// rising across bursts, as the server's do.
let lastSeq = 100;
function hear(rolls, at = 0, open = null) {
  const entries = [];
  rolls.forEach((entry, index) => {
    const seq = (lastSeq += 1);
    const placed = placeRoll(open, entry, seq, at);
    open = placed.open;
    entries.push({ seq, roll: entry, source: "digital", at, group: placed.group, notations: [`1d20@${index + 1}`] });
  });
  return { entries, open };
}

// The stage played out: trim, take the first, mark its action playing, and
// so on, as DiceOverlay's pump does. The ids in the order they are shown.
function play(queue, now = 0) {
  const shown = [];
  let playing = null;
  let waiting = trimStage(queue, now, playing);
  while (waiting.length) {
    const next = waiting.shift();
    playing = next.group;
    shown.push(next.roll.id);
    waiting = trimStage(waiting, now, playing);
  }
  return shown;
}

test("an Extra Attack plays whole, each to-hit before its damage", () => {
  const { entries } = hear([roll("hit1", "attack"), roll("dmg1", "damage"), roll("hit2", "attack"), roll("dmg2", "damage")]);
  assert.deepEqual(play(entries), ["hit1", "dmg1", "hit2", "dmg2"]);
});

test("a three-swing burst drops the oldest swing whole, never a to-hit alone", () => {
  const { entries } = hear([
    roll("hit1", "attack", ogre),
    roll("dmg1", "damage", ogre),
    roll("hit2", "attack", ogre),
    roll("dmg2", "damage", ogre),
    roll("hit3", "attack", ogre),
    roll("dmg3", "damage", ogre),
  ]);
  const shown = play(entries);
  assert.deepEqual(shown, ["hit2", "dmg2", "hit3", "dmg3"]);
  assert.ok(shown.length <= DICE_QUEUE_MAX);
});

test("an action on stage is never cut, however late its damage or long the backlog", () => {
  const { entries } = hear([roll("hit1", "attack"), roll("dmg1", "damage"), roll("rider1", "damage")]);
  const [first, ...rest] = entries;
  const later = hear([roll("hit2", "attack", ogre), roll("dmg2", "damage", ogre), roll("hit3", "attack", ogre), roll("dmg3", "damage", ogre)], 1_000).entries;
  const kept = trimStage([...rest, ...later], DICE_STALE_MS + 500, first.group);
  assert.deepEqual(kept.slice(0, 2).map((entry) => entry.roll.id), ["dmg1", "rider1"], "the to-hit's own damage stays");
});

test("an action that waited past the stale window goes whole", () => {
  const old = hear([roll("hit1", "attack"), roll("dmg1", "damage")], 0).entries;
  const fresh = hear([roll("save", "saving_throw", null)], DICE_STALE_MS).entries;
  const kept = trimStage([...old, ...fresh], DICE_STALE_MS + 1, null);
  assert.deepEqual(kept.map((entry) => entry.roll.id), ["save"]);
});

test("when everything waiting is stale, the newest action still shows", () => {
  const old = hear([roll("hit1", "attack"), roll("dmg1", "damage")], 0).entries;
  const newer = hear([roll("hit2", "attack", ogre), roll("dmg2", "damage", ogre)], 10).entries;
  const kept = trimStage([...old, ...newer], DICE_STALE_MS * 3, null);
  assert.deepEqual(kept.map((entry) => entry.roll.id), ["hit2", "dmg2"]);
  const saves = hear(Array.from({ length: 10 }, (_, index) => roll(`save${index}`, "saving_throw", null)), 0).entries;
  const unthrown = saves.map((entry) => ({ ...entry, notations: null }));
  assert.deepEqual(
    trimStage(unthrown, DICE_STALE_MS + 1, null).map((entry) => entry.roll.id),
    ["save9"],
    "dice off: the toast ends on the latest roll",
  );
});

test("staleness counts from the action's arrival, so a started action's tail is not old news", () => {
  // The second swing arrived with the first and waits behind it: it is due
  // at about seven seconds and must still play.
  const { entries } = hear([roll("hit1", "attack"), roll("dmg1", "damage"), roll("hit2", "attack"), roll("dmg2", "damage")]);
  const kept = trimStage(entries.slice(2), DICE_STALE_MS - 500, entries[0].group);
  assert.deepEqual(kept.map((entry) => entry.roll.id), ["hit2", "dmg2"]);
  const tail = trimStage(entries.slice(3), DICE_STALE_MS + 2_000, entries[2].group);
  assert.deepEqual(tail.map((entry) => entry.roll.id), ["dmg2"], "dmg2 plays once hit2 has started");
});

test("rolls that are not thrown never count toward the throw cap", () => {
  const { entries } = hear(Array.from({ length: 8 }, (_, index) => roll(`save${index}`, "saving_throw", null)));
  const unthrown = entries.map((entry) => ({ ...entry, notations: null }));
  assert.equal(trimStage(unthrown, 0, null).length, 8);
});

test("an attack opens an action its damage and on-hit dice join", () => {
  let placed = placeRoll(null, roll("hit", "attack"), 1, 0);
  assert.equal(placed.group, 1);
  placed = placeRoll(placed.open, roll("dmg", "damage"), 2, 10);
  assert.equal(placed.group, 1, "its damage joins");
  placed = placeRoll(placed.open, roll("decoy", "ability_check", null), 3, 20);
  assert.equal(placed.group, 1, "a roll naming no attacker in the same burst joins");
  placed = placeRoll(placed.open, roll("hit2", "attack"), 4, 30);
  assert.equal(placed.group, 4, "the next swing is its own action");
  const other = placeRoll(placed.open, roll("ogre-dmg", "damage", ogre), 5, 40);
  assert.equal(other.group, 5, "another attacker's damage is not this swing's");
  assert.equal(other.open, null);
  const late = placeRoll(placed.open, roll("late", "damage"), 6, 30 + ACTION_GAP_MS + 1);
  assert.equal(late.group, 6, "a roll heard well after the burst starts its own");
});

test("a roll that is not an attack opens nothing", () => {
  const save = placeRoll(null, roll("save", "saving_throw", null), 1, 0);
  assert.equal(save.open, null);
  assert.equal(placeRoll(save.open, roll("dmg", "damage"), 2, 1).group, 2);
});

test("the toast shows public rolls and rolls this seat holds the number of", () => {
  assert.equal(toastShows({ visibility: "public", total: 7 }), true);
  assert.equal(toastShows({ visibility: "secret", total: 7 }), true);
  assert.equal(toastShows({ visibility: "blind", total: null }), false);
});

test("a revealed roll is news only to a seat that did not hold its number", () => {
  assert.equal(revealIsNews(undefined), true);
  assert.equal(revealIsNews({ total: null, hidden: true }), true);
  assert.equal(revealIsNews({ total: 14 }), false);
});

test("a shown roll holds the stage: a landed throw a beat, an unthrown roll a readable beat", () => {
  assert.ok(holdAfterShown(true, 1) < holdAfterShown(true, 0));
  assert.ok(holdAfterShown(true, 0) >= 1_000);
  assert.equal(holdAfterShown(false, 2), TOAST_STEP_MS);
  // Nothing waits yet, but the damage may be one render behind its to-hit.
  assert.equal(holdAfterShown(false, 0), TOAST_STEP_MS);
  assert.ok(TOAST_STEP_MS >= 1_000, "long enough to read a toast");
});

test("the stream keeps a three-swing burst with its on-hit dice whole", () => {
  assert.ok(STAGE_HEARD_MAX >= 9);
});

test("the stale window sits under the stuck-throw deadline", () => {
  assert.ok(DICE_STALE_MS < DICE_ROLL_DEADLINE_MS);
});

console.log(`${passed} roll stage tests passed`);
