// Pure math of the paladin auras that reach other creatures
// (src/lib/dm/divine-auras-logic.ts): the reach ladder, the one aura of a
// kind that counts, and Aura of Hate's creature types and floor.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { auraReachFeet, bestAuraOffer, auraCoversType, auraDamageAmount } = await import("../src/lib/dm/divine-auras-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("the reach steps with the paladin's level", () => {
  const sentinel = [[7, 10], [18, 30]];
  assert.equal(auraReachFeet(sentinel, 7), 10);
  assert.equal(auraReachFeet(sentinel, 17), 10);
  assert.equal(auraReachFeet(sentinel, 18), 30);
  assert.equal(auraReachFeet([[7, 5], [18, 10]], 20), 10);
  assert.equal(auraReachFeet(15, 3), 15);
});

test("two paladins' auras of a kind do not stack: the largest counts", () => {
  const best = bestAuraOffer([{ bonus: 3, note: "a" }, { bonus: 5, note: "b" }, { bonus: 4, note: "c" }], 0);
  assert.deepEqual(best, { bonus: 5, note: "b" });
  assert.equal(bestAuraOffer([], 0), null);
});

test("a creature's own bonus of the kind is not doubled: the aura raises it only to the larger", () => {
  // A Watchers paladin (+3 of their own) beside another (+6): 3 more, not 6.
  assert.deepEqual(bestAuraOffer([{ bonus: 6, note: "x" }], 3), { bonus: 3, note: "x" });
  // Beside a paladin of the same bonus or lower: nothing more.
  assert.equal(bestAuraOffer([{ bonus: 3, note: "x" }], 3), null);
  assert.equal(bestAuraOffer([{ bonus: 2, note: "x" }], 3), null);
});

test("Aura of Hate covers its types only, and adds at least +1", () => {
  assert.equal(auraCoversType(["fiend", "undead"], "undead"), true);
  assert.equal(auraCoversType(["fiend", "undead"], "fiend"), true);
  assert.equal(auraCoversType(["fiend", "undead"], "humanoid"), false);
  assert.equal(auraDamageAmount(5), 5);
  assert.equal(auraDamageAmount(-1), 1);
  assert.equal(auraDamageAmount(undefined), 1);
});

console.log(`test-divine-auras-logic: ${passed} tests passed`);
