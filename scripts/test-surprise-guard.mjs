// Who cannot be surprised (src/lib/dm/surprise-guard.ts), the one rule both
// surprise doors read: start_encounter's side named surprised and an ambush's
// Stealth against passive Perception. Fails without the guard: before it each
// door asked only for the Alert feat, so Hypervigilant ("You cannot be
// surprised while conscious") was surprised with the rest of the party.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { cannotBeSurprised } = await import("../src/lib/dm/surprise-guard.ts");

const sheet = (classId, features, extra = {}) => ({
  name: "Holder",
  class: classId,
  level: 15,
  classes: [{ id: classId, level: 15 }],
  features: features.map((name) => ({ name, classId, source: "class" })),
  feats: [],
  conditions: [],
  currentHp: 30,
  maxHp: 30,
  ...extra,
});
const goblin = { slug: "goblin", stats: { type: "humanoid" } };
const skeleton = { slug: "skeleton", stats: { type: "undead" } };
const cultist = { slug: "cultist", stats: { type: "humanoid" } };

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

test("Hypervigilant: never surprised while conscious, by anyone", () => {
  assert.equal(cannotBeSurprised(sheet("survivor", ["Hypervigilant"]), [goblin]), true);
  assert.equal(cannotBeSurprised(sheet("survivor", ["Hypervigilant"], { currentHp: 0 }), [goblin]), false);
});
test("Unblinking Study: not surprised by undead; a goblin among them still catches the occultist", () => {
  assert.equal(cannotBeSurprised(sheet("occultist", ["Unblinking Study"]), [skeleton]), true);
  assert.equal(cannotBeSurprised(sheet("occultist", ["Unblinking Study"]), [skeleton, goblin]), false);
  assert.equal(cannotBeSurprised(sheet("occultist", ["Unblinking Study"]), [goblin]), false);
});
test("Hunted Instincts: cultists, by the monster they are, not their type", () => {
  assert.equal(cannotBeSurprised(sheet("apostate", ["Hunted Instincts"]), [cultist]), true);
  assert.equal(cannotBeSurprised(sheet("apostate", ["Hunted Instincts"]), [goblin]), false);
});
test("the feature belongs to its class: a fighter holding the name is not the survivor", () => {
  assert.equal(cannotBeSurprised(sheet("fighter", ["Hypervigilant"]), [goblin]), false);
});
test("Alert still answers through the same guard", () => {
  assert.equal(cannotBeSurprised(sheet("fighter", [], { feats: ["Alert"] }), [goblin]), true);
  assert.equal(cannotBeSurprised(sheet("fighter", []), [goblin]), false);
});
console.log(`test-surprise-guard: ${passed} passed`);
