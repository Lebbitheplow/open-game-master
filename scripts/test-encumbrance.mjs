// The optional Variant: Encumbrance rule: what a pack weighs, which items
// nothing can weigh, and where the two thresholds bite.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  carriedWeight,
  carryMultiplier,
  coinWeightLb,
  COINS_PER_POUND,
  encumbranceCovers,
  encumbranceFor,
  lineWeightLb,
  loadLines,
  sortLoadLines,
} = await import("../src/lib/srd/encumbrance.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a stamped weight is multiplied by the count", () => {
  assert.equal(lineWeightLb({ name: "Torch", qty: 5, weight: 1 }), 5);
  assert.equal(lineWeightLb({ name: "Greatsword", qty: 1, weight: 6 }), 6);
});

test("armor falls back to the SRD table the content pack lacks", () => {
  // Open5e ships every armor row blank, so nothing stamps these.
  assert.equal(lineWeightLb({ name: "Plate", qty: 1 }), 65);
  assert.equal(lineWeightLb({ name: "+1 Chain Mail", qty: 1 }), 55);
  assert.equal(lineWeightLb({ name: "Shield", qty: 1 }), 6);
});

test("an unweighable item reads as unknown, never as zero", () => {
  assert.equal(lineWeightLb({ name: "A Strange Idol", qty: 1 }), null);
  assert.equal(lineWeightLb({ name: "A Strange Idol", qty: 1, weight: 0 }), null);
  // A stamped 0 is "the source did not say", so the SRD gear table answers
  // where it can (src/lib/srd/adventuring-gear.ts).
  assert.equal(lineWeightLb({ name: "Torch", qty: 1, weight: 0 }), 1);
});

test("ammunition is weighed per round however the line is written", () => {
  // 20 arrows weigh a pound whether the count is in the name or the qty.
  assert.equal(lineWeightLb({ name: "Arrows (20)", qty: 1 }), 1);
  assert.equal(lineWeightLb({ name: "Arrows", qty: 20 }), 1);
  // And it tracks the count down as the quiver empties, rather than
  // multiplying a bundle weight by the rounds left.
  assert.equal(lineWeightLb({ name: "Arrows (7)", qty: 1 }), 0.35);
});

test("unweighed items are counted, not guessed at", () => {
  const pack = [
    { name: "Torch", qty: 2, weight: 1 },
    { name: "A Strange Idol", qty: 1 },
    { name: "An Older Idol", qty: 1 },
  ];
  assert.deepEqual(carriedWeight(pack), { pounds: 2, unweighed: 2 });
});

test("coins weigh 50 to the pound", () => {
  assert.equal(COINS_PER_POUND, 50);
  assert.equal(carriedWeight([], 500).pounds, 10);
});

test("an ordinary pack encumbers nobody", () => {
  const load = encumbranceFor({
    strength: 14,
    equipment: [
      { name: "Longsword", qty: 1, weight: 3 },
      { name: "Leather", qty: 1 },
      { name: "Arrows (20)", qty: 1 },
    ],
  });
  assert.equal(load.tier, "unencumbered");
  assert.equal(load.speedPenalty, 0);
  assert.equal(load.disadvantage, false);
  assert.equal(load.note, null);
  assert.equal(load.encumberedAtLb, 70);
  assert.equal(load.capacityLb, 210);
});

test("past 5x Strength costs 10 feet and nothing else", () => {
  const load = encumbranceFor({
    strength: 10,
    equipment: [{ name: "Loot", qty: 1, weight: 60 }],
  });
  assert.equal(load.tier, "encumbered");
  assert.equal(load.speedPenalty, 10);
  assert.equal(load.disadvantage, false);
  assert.match(load.note, /encumbered/);
});

test("past 10x Strength costs 20 feet and every physical roll", () => {
  const load = encumbranceFor({
    strength: 10,
    equipment: [{ name: "Loot", qty: 1, weight: 120 }],
  });
  assert.equal(load.tier, "heavily_encumbered");
  assert.equal(load.speedPenalty, 20);
  assert.equal(load.disadvantage, true);
  assert.equal(load.overCapacity, false);
  assert.match(load.note, /heavily encumbered/);
});

test("the exact threshold is not over it", () => {
  // "More than 5 times your Strength score" - 50 lb on a 10 STR is fine.
  const load = encumbranceFor({
    strength: 10,
    equipment: [{ name: "Loot", qty: 1, weight: 50 }],
  });
  assert.equal(load.tier, "unencumbered");
});

test("past the hard ceiling is flagged as well as penalized", () => {
  const load = encumbranceFor({
    strength: 10,
    equipment: [{ name: "An Anvil", qty: 1, weight: 200 }],
  });
  assert.equal(load.overCapacity, true);
  assert.equal(load.tier, "heavily_encumbered");
});

test("only the tiny and the large carry differently", () => {
  assert.equal(carryMultiplier("medium"), 1);
  // Small creatures carry as much as Medium ones; only Tiny halves.
  assert.equal(carryMultiplier("Small"), 1);
  assert.equal(carryMultiplier("Tiny"), 0.5);
  assert.equal(carryMultiplier("Large"), 2);
  assert.equal(carryMultiplier(undefined), 1);
});

test("the load weighs on the body, not the mind", () => {
  assert.equal(encumbranceCovers("str"), true);
  assert.equal(encumbranceCovers("dex"), true);
  assert.equal(encumbranceCovers("con"), true);
  assert.equal(encumbranceCovers("int"), false);
  assert.equal(encumbranceCovers("cha"), false);
  assert.equal(encumbranceCovers(null), false);
});

// ---- the Carried breakdown (issue #206) ----

// The lines and the purse add up to the total the tile shows, whatever the
// pack holds; a line nothing can weigh is counted once in `unweighed`.
function reconciles(equipment, coins) {
  const { pounds, unweighed } = carriedWeight(equipment, coins);
  const lines = loadLines(equipment);
  const known = lines.filter((line) => line.totalLb !== null);
  const sum = Math.round((known.reduce((total, line) => total + line.totalLb, 0) + coinWeightLb(coins)) * 100) / 100;
  assert.equal(sum, pounds, "known lines plus coins are the Carried figure");
  assert.equal(lines.length - known.length, unweighed, "unknown lines are the + count");
  return lines;
}

test("ten darts weigh 2.5 lb and a changed count changes the line", () => {
  const [ten] = reconciles([{ name: "Dart", qty: 10, weight: 0.25 }], 0);
  assert.deepEqual([ten.qty, ten.eachLb, ten.totalLb, ten.source], [10, 0.25, 2.5, "item"]);
  const [four] = reconciles([{ name: "Dart", qty: 4, weight: 0.25 }], 0);
  assert.equal(four.totalLb, 1);
  // With no stamped weight the SRD weapon table weighs a dart the same.
  const [bare] = reconciles([{ name: "Dart", qty: 10 }], 0);
  assert.deepEqual([bare.eachLb, bare.totalLb, bare.source], [0.25, 2.5, "weapon"]);
});

test("an ammunition count in the name is weighed once, per round", () => {
  const [named] = reconciles([{ name: "Arrows (20)", qty: 1 }], 0);
  assert.deepEqual([named.qty, named.eachLb, named.totalLb, named.source], [20, 0.05, 1, "ammunition"]);
  const [counted] = reconciles([{ name: "Crossbow bolts", qty: 12 }], 0);
  assert.deepEqual([counted.qty, counted.totalLb], [12, 0.9]);
});

test("every line is listed, worn or packed, known or not, and reconciles", () => {
  const pack = [
    { name: "Chain Mail", qty: 1, equipped: true },
    { name: "Longsword", qty: 1, weight: 3, equipped: true },
    { name: "Rope, hempen (50 feet)", qty: 1, weight: 10 },
    { name: "A Strange Idol", qty: 1 },
    { name: "Arrows (20)", qty: 1 },
    { name: "Mysterious Box", qty: 2, weight: 0 },
  ];
  const lines = reconciles(pack, 137);
  assert.deepEqual(lines.map((line) => line.index), [0, 1, 2, 3, 4, 5]);
  assert.equal(lines[0].source, "armor");
  assert.equal(lines[3].totalLb, null);
  assert.equal(lines[5].eachLb, null);
  assert.equal(lines[5].qty, 2);
  // 137 gold coins: 2.74 lb, the figure the breakdown prints.
  assert.equal(coinWeightLb(137), 2.74);
  assert.deepEqual(carriedWeight(pack, 137), { pounds: 55 + 3 + 10 + 1 + 2.74, unweighed: 2 });
});

test("sorting by line total or weight each, both ways, unknowns last", () => {
  const lines = loadLines([
    { name: "Dart", qty: 10, weight: 0.25 },
    { name: "A Strange Idol", qty: 1 },
    { name: "Greatsword", qty: 1, weight: 6 },
    { name: "Torch", qty: 5, weight: 1 },
    { name: "Mysterious Box", qty: 1 },
  ]);
  const names = (sorted) => sorted.map((line) => line.name);
  assert.deepEqual(names(sortLoadLines(lines, "total", "desc")), ["Greatsword", "Torch", "Dart", "A Strange Idol", "Mysterious Box"]);
  assert.deepEqual(names(sortLoadLines(lines, "total", "asc")), ["Dart", "Torch", "Greatsword", "A Strange Idol", "Mysterious Box"]);
  assert.deepEqual(names(sortLoadLines(lines, "each", "desc")), ["Greatsword", "Torch", "Dart", "A Strange Idol", "Mysterious Box"]);
  assert.deepEqual(names(sortLoadLines(lines, "each", "asc")), ["Dart", "Torch", "Greatsword", "A Strange Idol", "Mysterious Box"]);
  // A tie keeps the sheet's order.
  const tied = loadLines([
    { name: "Torch", qty: 1, weight: 1 },
    { name: "Hammer", qty: 1, weight: 1 },
  ]);
  assert.deepEqual(names(sortLoadLines(tied, "total", "desc")), ["Torch", "Hammer"]);
  assert.deepEqual(names(sortLoadLines(tied, "total", "asc")), ["Torch", "Hammer"]);
});

test("a stated weight of zero is not weightless, so it is not counted as 0 lb", () => {
  const [line] = loadLines([{ name: "A Strange Idol", qty: 3, weight: 0 }]);
  assert.equal(line.totalLb, null);
});

// Issue #1038: tack is on the animal, so its rider does not carry it.
test("a saddle on the mount weighs nothing for its rider; packed, it weighs what it weighs", () => {
  const plate = { name: "Plate", qty: 1, equipped: true };
  const on = loadLines([plate, { name: "Saddle, Military", qty: 1 }, { name: "Saddlebags", qty: 1, equipped: true }]);
  assert.deepEqual(on.map((line) => [line.name, line.eachLb, line.totalLb, line.onMount ?? false]), [
    ["Plate", 65, 65, false],
    ["Saddle, Military", 30, 0, true],
    ["Saddlebags", 8, 0, true],
  ]);
  assert.equal(carriedWeight([plate, { name: "Saddle, Military", qty: 1 }]).pounds, 65);
  // Packed by the player: dead weight.
  assert.equal(carriedWeight([plate, { name: "Saddle, Military", qty: 1, equipped: false }]).pounds, 95);
  // Only what the animal wears: feed is carried, worn armor still weighs.
  assert.equal(carriedWeight([{ name: "Feed (per day)", qty: 2 }]).pounds, 20);
  // The tier follows: Strength 10 is encumbered past 50 lb.
  const rider = (saddle) => encumbranceFor({ strength: 10, equipment: [{ name: "Chain Shirt", qty: 1, equipped: true }, { name: "Longsword", qty: 1, equipped: true }, saddle] });
  assert.equal(rider({ name: "Saddle, Exotic", qty: 1 }).tier, "unencumbered");
  assert.equal(rider({ name: "Saddle, Exotic", qty: 1, equipped: false }).tier, "encumbered");
});

console.log(`encumbrance: ${passed} tests passed`);
