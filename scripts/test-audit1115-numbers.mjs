// Numbers the SRD fixes and the engine got wrong or left to the GM (rules
// audit 2026-11-15, the numbers lens, findings N01 on). Each test names its
// finding and the rule it holds the engine to; every die is forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-audit1115-numbers");
const world = await openWorld();
const sheet = (id) => world.sheet(id);

// ---- N01: Potion of Poison ----
// SRD 5.1, Potion of Poison: "you take 3d6 poison damage, and you must
// succeed on a DC 13 Constitution saving throw or be poisoned. At the start
// of each of your turns while you are poisoned in this way, you take 3d6
// poison damage. At the end of each of your turns, you can repeat the saving
// throw. On a successful save, the poison damage you take on your subsequent
// turns decreases by 1d6. The poison ends when the damage decreases to 0."

const drinker = world.addHero({ class: "fighter", level: 5, maxHp: 200 });
const drinkPoison = async (faces) => {
  world.patch(drinker.id, { currentHp: 200, conditions: [], conditionMeta: {}, equipment: [{ name: "Potion of Poison", qty: 1 }] });
  world.clearDice();
  world.dice(...faces);
  const out = await world.invoke("use_item", { characterId: drinker.id, item: "Potion of Poison" });
  const left = world.clearDice();
  assert.equal(out.ok, true, out.error);
  return { out, left, lost: 200 - sheet(drinker.id).currentHp };
};

await test("N01: a failed save against a Potion of Poison deals 3d6 at each turn's start, each later save takes 1d6 off, and it ends at none", async () => {
  // 3d6 on drinking (6), the DC 13 save failed (1); then 3d6 (9) and a save
  // made, 2d6 (8) and a save made, 1d6 (5) and a save made: the poison ends.
  const { left, lost } = await drinkPoison([2, 2, 2, 1, 3, 3, 3, 20, 4, 4, 20, 5, 20]);
  assert.equal(left, 0, "the engine did not roll the poison's turns");
  assert.equal(lost, 6 + 9 + 8 + 5);
});

await test("N01: a failed repeat save keeps the poison's dice where they were", async () => {
  // 6 on drinking, failed; 3d6 (9) failed again, 3d6 (9) made, 2d6 (8) made,
  // 1d6 (5) made.
  const { left, lost } = await drinkPoison([2, 2, 2, 1, 3, 3, 3, 1, 3, 3, 3, 20, 4, 4, 20, 5, 20]);
  assert.equal(left, 0);
  assert.equal(lost, 6 + 9 + 9 + 8 + 5);
});

await test("N01: a made save on drinking is the 3d6 and nothing more", async () => {
  const { left, lost } = await drinkPoison([2, 2, 2, 20]);
  assert.equal(left, 0);
  assert.equal(lost, 6);
  assert.equal(sheet(drinker.id).conditions.includes("poisoned"), false);
});

world.close();
finish();
