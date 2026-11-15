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

// ---- N02: a short leg in extreme cold or heat ----
// The weather rule the engine plays (src/lib/srd/hazards.ts): exposed to
// extreme cold, a creature makes a DC 10 Constitution save "at the end of
// each hour"; extreme heat the same, DC 5 rising by 1 an hour. A leg of
// travel under four hours rolled none, so two 3-hour legs through a frigid
// pass cost nothing.

const { getDatabase } = await import("../src/lib/db/core.ts");
const savesOf = (id) =>
  getDatabase()
    .prepare(`SELECT dc FROM rolls WHERE character_id = ? AND roll_kind = 'saving_throw' ORDER BY created_at, rowid`)
    .all(id)
    .map((row) => row.dc);
const { getClock, setClockInstant } = await import("../src/lib/db/clock.ts");
// Six in the morning of the next day, so no leg crosses a dawn's new sky.
const morning = () => setClockInstant(world.campaignId, (Math.floor(getClock(world.campaignId).instant / 1440) + 1) * 1440 + 6 * 60);

await test("N02: three hours on the road in frigid air are three DC 10 Constitution saves", async () => {
  const walker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  morning();
  await world.invoke("set_weather", { sky: "clear", temperature: "frigid", wind: "calm" });
  world.clearDice();
  world.dice(1, 1, 1);
  const out = await world.invoke("travel", { hours: 3, pace: "normal", characterIds: [walker.id] });
  const left = world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(savesOf(walker.id), [10, 10, 10]);
  assert.equal(left, 0);
  assert.equal(sheet(walker.id).exhaustion, 3);
  await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
});

// ---- N03: extreme heat's DC goes on rising; the book's DCs are not the GM's ----
// The engine's weather rule: in extreme heat "the DC is 5 for the first hour
// and increases by 1 for each additional hour"; extreme cold is DC 10 each
// hour. Each call and each travel leg began again at DC 5, and a `dc` the
// model sent replaced either.

await test("N03: two 2-hour spells of extreme heat in a row save at DC 5, 6, 7 and 8", async () => {
  const trekker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  morning();
  world.clearDice();
  world.dice(20, 20, 20, 20);
  await world.invoke("apply_hazard", { type: "extreme_heat", hours: 2, characterIds: [trekker.id] });
  await world.invoke("apply_hazard", { type: "extreme_heat", hours: 2, characterIds: [trekker.id] });
  assert.equal(world.clearDice(), 0);
  assert.deepEqual(savesOf(trekker.id), [5, 6, 7, 8]);
});

// Four hours in the shade between: a break of an hour or more. (The clock
// moved by less than the next stretch could be that stretch itself, which
// apply_hazard does not move the clock for, so it goes on.)
await test("N03: a break of an hour or more out of the heat starts its DC at 5 again", async () => {
  const trekker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  morning();
  world.clearDice();
  world.dice(20, 20, 20, 20);
  await world.invoke("apply_hazard", { type: "extreme_heat", hours: 2, characterIds: [trekker.id] });
  setClockInstant(world.campaignId, getClock(world.campaignId).instant + 240);
  await world.invoke("apply_hazard", { type: "extreme_heat", hours: 2, characterIds: [trekker.id] });
  assert.equal(world.clearDice(), 0);
  assert.deepEqual(savesOf(trekker.id), [5, 6, 5, 6]);
});

await test("N03: two 2-hour legs on the road in the heat go on from the first leg's DC", async () => {
  const walker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  morning();
  await world.invoke("set_weather", { sky: "clear", temperature: "hot", wind: "calm" });
  world.clearDice();
  world.dice(20, 20, 20, 20);
  for (const leg of [1, 2]) {
    const out = await world.invoke("travel", { hours: 2, pace: "normal", characterIds: [walker.id] });
    assert.equal(out.ok, true, `leg ${leg}: ${out.error}`);
  }
  assert.equal(world.clearDice(), 0);
  assert.deepEqual(savesOf(walker.id), [5, 6, 7, 8]);
  await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
});

await test("N03: a DC sent with extreme cold or heat is not the book's and is not used", async () => {
  const trekker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  morning();
  world.clearDice();
  world.dice(20, 20);
  await world.invoke("apply_hazard", { type: "extreme_cold", hours: 1, dc: 25, characterIds: [trekker.id] });
  await world.invoke("apply_hazard", { type: "extreme_heat", hours: 1, dc: 2, characterIds: [trekker.id] });
  assert.equal(world.clearDice(), 0);
  assert.deepEqual(savesOf(trekker.id), [10, 5]);
  assert.equal(sheet(trekker.id).exhaustion ?? 0, 0);
});

// ---- N04: frigid water ----
// The weather rules' Frigid Water, beside the extreme cold and heat the
// engine plays: "A creature can be immersed in frigid water for a number of
// minutes equal to its Constitution score before suffering any ill effects.
// Each additional minute spent in frigid water requires the creature to
// succeed on a DC 10 Constitution saving throw or gain one level of
// exhaustion. Creatures with resistance or immunity to cold damage
// automatically succeed on the saving throw." apply_hazard had no such
// hazard: the GM's only door was a generic one with its own numbers, which
// lays no exhaustion.

await test("N04: frigid water is free for Constitution-score minutes, then a DC 10 Constitution save each further minute", async () => {
  const swimmer = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40, abilities: { con: 12 } });
  world.clearDice();
  // CON 12 (+1): 12 minutes free, then minutes 13, 14 and 15. A 9 (10)
  // makes it, a 1 (2) does not.
  world.dice(9, 1, 1);
  const out = await world.invoke("apply_hazard", { type: "frigid_water", minutes: 15, characterIds: [swimmer.id] });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 0);
  assert.deepEqual(savesOf(swimmer.id), [10, 10, 10]);
  assert.equal(sheet(swimmer.id).exhaustion, 2);
});

await test("N04: within the Constitution score's minutes, or resisting cold, frigid water rolls nothing", async () => {
  const swimmer = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40, abilities: { con: 12 } });
  // Resistance to cold for the hour, as a Potion of Resistance leaves it.
  const hardy = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  world.patch(hardy.id, { conditions: ["protection from energy (cold)"], conditionMeta: {} });
  world.clearDice();
  await world.invoke("apply_hazard", { type: "frigid_water", minutes: 12, characterIds: [swimmer.id] });
  const resisted = await world.invoke("apply_hazard", { type: "frigid_water", minutes: 30, characterIds: [hardy.id] });
  assert.equal(resisted.ok, true, resisted.error);
  assert.deepEqual(savesOf(swimmer.id), []);
  assert.deepEqual(savesOf(hardy.id), []);
  assert.equal(sheet(hardy.id).exhaustion ?? 0, 0);
});

world.close();
finish();
