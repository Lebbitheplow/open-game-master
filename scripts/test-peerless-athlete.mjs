// Peerless Athlete (TCoE, Oath of Glory) while its mark lasts: "you can
// carry, push, drag, and lift twice as much weight as normal, and the
// distance of your long and high jumps increases by 10 feet". The capacity
// every door weighs by and the jump reach the board view and the jump door
// share both read it, and the 10 feet ride after the Strength reach, so a
// standing start halves Strength, never the 10.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { authoredCarryFactor, authoredJumpFeet } = await import("../src/lib/srd/carry-jump-effects.ts");
const { encumbranceFor } = await import("../src/lib/srd/encumbrance.ts");
const { jumpReach } = await import("../src/lib/dm/jump-reach.ts");
const { capacityProblem, liftLimits } = await import("../src/lib/dm/load-rules.ts");
const { planLongJump } = await import("../src/lib/srd/jump.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function paladin(conditions = []) {
  return {
    id: "glory",
    name: "Aster",
    class: "paladin",
    level: 3,
    classes: [{ id: "paladin", level: 3, subclass: "Oath of Glory" }],
    subclass: "Oath of Glory",
    race: "human",
    gold: 0,
    abilities: { str: 15, dex: 10, con: 12, int: 10, wis: 10, cha: 14 },
    features: [{ name: "Channel Divinity: Peerless Athlete", classId: "paladin" }],
    feats: [],
    conditions,
    equipment: [],
  };
}

const plain = paladin();
const athlete = paladin(["peerless athlete"]);

test("the mark doubles what the paladin carries; without it nothing changes", () => {
  assert.equal(authoredCarryFactor(plain), 1);
  assert.equal(authoredCarryFactor(athlete), 2);
  assert.equal(liftLimits(plain).capacityLb, 225);
  assert.deepEqual(liftLimits(athlete), { capacityLb: 450, liftLb: 900 });
});

// Totem Warrior, Aspect of the Beast: "Bear. ... your carrying capacity
// (including maximum load and maximum lift) is doubled". The lift alone was
// doubled, and the pack was still refused at the undoubled load.
test("the Bear doubles the load a totem warrior is refused at, and the lift", () => {
  const barbarian = (features) => ({
    id: "totem",
    name: "Bruna",
    class: "barbarian",
    level: 6,
    classes: [{ id: "barbarian", level: 6, subclass: "Path of the Totem Warrior" }],
    subclass: "Path of the Totem Warrior",
    race: "human",
    gold: 0,
    abilities: { str: 15, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
    features,
    feats: [],
    conditions: [],
    equipment: [],
  });
  const bear = barbarian([{ name: "Aspect of the Beast (Bear)", classId: "barbarian" }]);
  const eagle = barbarian([{ name: "Aspect of the Beast (Eagle)", classId: "barbarian" }]);
  const stone = [{ name: "Stone", qty: 1, weight: 300 }];
  assert.equal(authoredCarryFactor(bear), 2);
  assert.equal(authoredCarryFactor(eagle), 1);
  assert.deepEqual(liftLimits(bear), { capacityLb: 450, liftLb: 900 });
  assert.equal(capacityProblem(bear, stone, "the stone"), null, "300 lb is within the Bear's 450");
  assert.match(capacityProblem(eagle, stone, "the stone")?.error ?? "", /can carry 225 lb/);
  assert.match(capacityProblem(bear, [{ name: "Boulder", qty: 1, weight: 500 }], "the boulder")?.error ?? "", /can carry 450 lb/);
});

test("the encumbrance tiers and the over-capacity line grow with the factor", () => {
  const pack = [{ name: "Stone", qty: 1, weight: 300 }];
  const without = encumbranceFor({ strength: 15, equipment: pack });
  const withMark = encumbranceFor({ strength: 15, equipment: pack, carryFactor: authoredCarryFactor(athlete) });
  assert.equal(without.overCapacity, true);
  assert.equal(withMark.overCapacity, false);
  assert.equal(withMark.capacityLb, 450);
  assert.equal(withMark.heavilyEncumberedAtLb, 300);
});

test("long and high jumps go 10 feet farther, after the Strength reach", () => {
  assert.equal(authoredJumpFeet(plain), 0);
  assert.equal(authoredJumpFeet(athlete), 10);
  const running = jumpReach(athlete, true);
  assert.equal(running.longFeet, 15 + 10);
  assert.equal(running.highFeet, 3 + 2 + 10);
  // A standing start halves the Strength part, not the 10.
  const standing = jumpReach(athlete, false);
  assert.equal(standing.longFeet, 7 + 10);
  assert.equal(standing.highFeet, 2 + 10);
  assert.equal(jumpReach(plain, true).longFeet, 15);
});

test("the jump door's plan accepts exactly the reach the view shows", () => {
  const reach = jumpReach(athlete, true);
  const board = { terrain: ".".repeat(12), width: 12, height: 1, occupied: new Set(), from: { x: 0, y: 0 }, runningStart: true, budgetTiles: 12, name: "Aster" };
  const plan = (x) => planLongJump({ ...board, to: { x, y: 0 }, strength: reach.strength, extraFeet: reach.extraFeet });
  assert.equal(plan(5).ok, true, "25 feet is within reach");
  assert.equal(plan(6).ok, false, "30 feet is past it");
});

console.log(`test-peerless-athlete: ${passed} passed`);
