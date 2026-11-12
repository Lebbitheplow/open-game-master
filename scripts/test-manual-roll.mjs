// Physical-dice entry: expressionDice face listing and manual scoring via
// rollExpressionWithDice (keep rules, modifiers, crit detection, bounds).
import assert from "node:assert/strict";
import {
  entryDice,
  entryRerollNotes,
  entryRerolls,
  expressionDice,
  rollEnteredDice,
  rollExpressionWithDice,
} from "../src/lib/dice.ts";
import { trayExpressionProblem } from "../src/lib/dice/tray-rules.ts";
import { EMPTY_TRAY_POOL, TRAY_DICE_PER_KIND, trayAddDie, trayPoolExpression } from "../src/lib/dice/tray-pool.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("expressionDice lists faces in roll order", () => {
  assert.deepEqual(expressionDice("1d20+5"), [20]);
  assert.deepEqual(expressionDice("2d20kh1+3"), [20, 20]);
  assert.deepEqual(expressionDice("2d6+1d4+2"), [6, 6, 4]);
});

test("manual scoring applies modifiers", () => {
  const result = rollExpressionWithDice("1d20+5", [13]);
  assert.equal(result.total, 18);
  assert.equal(result.natural, 13);
});

test("advantage keeps the highest entered die", () => {
  const result = rollExpressionWithDice("2d20kh1+2", [8, 17]);
  assert.equal(result.total, 19);
  assert.equal(result.natural, 17);
});

test("disadvantage keeps the lowest entered die", () => {
  const result = rollExpressionWithDice("2d20kl1", [8, 17]);
  assert.equal(result.total, 8);
});

test("crit detection works on entered dice", () => {
  assert.equal(rollExpressionWithDice("1d20+4", [20]).crit, "nat20");
  assert.equal(rollExpressionWithDice("2d20kl1+4", [1, 15]).crit, "nat1");
});

test("damage expressions sum all dice", () => {
  assert.equal(rollExpressionWithDice("2d6+3", [4, 5]).total, 12);
});

test("out-of-range and miscounted values are rejected", () => {
  assert.throws(() => rollExpressionWithDice("1d20", [21]));
  assert.throws(() => rollExpressionWithDice("1d20", [0]));
  assert.throws(() => rollExpressionWithDice("1d20", [10, 4]));
  assert.throws(() => rollExpressionWithDice("2d6", [3]));
  assert.throws(() => rollExpressionWithDice("1d6", [2.5]));
});

test("the dice tray rolls dice, with a bonus a sheet could hold", () => {
  assert.equal(trayExpressionProblem("1d20+5"), null);
  assert.equal(trayExpressionProblem("2d20kh1-1"), null);
  assert.equal(trayExpressionProblem("8d6"), null);
  assert.equal(trayExpressionProblem("1d20+30"), null);
  assert.ok(trayExpressionProblem("20"));
  assert.ok(trayExpressionProblem("5+5"));
  assert.ok(trayExpressionProblem("1d20+31"));
  assert.ok(trayExpressionProblem("1d20-31"));
  assert.ok(trayExpressionProblem("1d1+19"));
  assert.ok(trayExpressionProblem("drop table"));
});

test("the tray's tapped dice read as one expression it will roll", () => {
  assert.equal(trayPoolExpression(EMPTY_TRAY_POOL), "");
  assert.equal(trayPoolExpression({ dice: {}, bonus: 4 }), "", "a bonus alone is not a roll");
  let pool = trayAddDie(EMPTY_TRAY_POOL, 6);
  pool = trayAddDie(pool, 20);
  pool = trayAddDie(pool, 6);
  assert.equal(trayPoolExpression(pool), "1d20+2d6");
  assert.equal(trayPoolExpression({ ...pool, bonus: 3 }), "1d20+2d6+3");
  assert.equal(trayPoolExpression({ ...pool, bonus: -2 }), "1d20+2d6-2");
  assert.equal(trayPoolExpression({ dice: { 100: 1 }, bonus: 99 }), "1d100+30", "the bonus stays inside the tray's limit");
  for (let tap = 0; tap < 30; tap += 1) pool = trayAddDie(pool, 4);
  assert.equal(pool.dice[4], TRAY_DICE_PER_KIND);
  for (const bonus of [-30, -1, 0, 7, 30]) {
    assert.equal(trayExpressionProblem(trayPoolExpression({ ...pool, bonus })), null, `bonus ${bonus}`);
  }
});

// Real dice enter one face per die: a reroll the expression carries (Halfling
// Lucky's "r1") is made with the die in hand, and the face kept is entered.
// A face left to the server (null) takes the expression's rerolls and Great
// Weapon Fighting's, as the server's own throw does.
test("entered dice: one face per die, typed faces final, server faces rerolled", () => {
  assert.deepEqual(entryDice("1d20r1+5"), [20]);
  assert.deepEqual(entryDice("2d20kh1r1+3+1d4"), [20, 20, 4]);
  assert.deepEqual(entryDice("2d6+3"), [6, 6]);
  assert.equal(rollEnteredDice("1d20r1+5", [12]).total, 17);
  // A 1 the player kept after Lucky's reroll is a 1, not rolled again.
  const kept = rollEnteredDice("1d20r1+5", [1]);
  assert.equal(kept.total, 6);
  assert.equal(kept.crit, "nat1");
  assert.throws(() => rollEnteredDice("1d20r1+5", [7, 3]), /Too many/);
  assert.throws(() => rollEnteredDice("2d6", [4]), /Not enough/);
  assert.throws(() => rollEnteredDice("1d20", [21]), /Die 1 must be/);
  const faces = [1, 5, 2, 6];
  const before = globalThis.__odmScriptedDie;
  globalThis.__odmScriptedDie = () => faces.shift() ?? 3;
  try {
    // Server faces: Lucky rerolls its 1 to a 5.
    assert.equal(rollEnteredDice("1d20r1", [null]).total, 5);
    // Great Weapon Fighting rerolls the server's 2 to a 6; the typed 1 stays.
    assert.equal(rollEnteredDice("2d6+3", [null, 1], { rerollBelow: 2 }).total, 6 + 1 + 3);
  } finally {
    globalThis.__odmScriptedDie = before;
  }
});

test("entered dice: the card says the reroll a die owes, and which faces may take it", () => {
  assert.deepEqual(entryRerollNotes("1d20r1+5"), ["A d20 that shows a 1: roll it again, once, and enter the new number."]);
  assert.deepEqual(entryRerollNotes("2d20kl1r1-1"), ["A d20 that shows a 1: roll one of them again, once, and enter the new number."]);
  assert.deepEqual(entryRerollNotes("1d20+5"), []);
  assert.deepEqual(entryRerolls("2d20kh1r1+1d4"), [
    { at: 1, term: 0, once: true },
    { at: 1, term: 0, once: true },
    { at: 0, term: 1, once: false },
  ]);
});

console.log(`${passed} manual-roll tests passed`);
