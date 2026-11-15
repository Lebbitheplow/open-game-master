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

// ---- N05: the hunting trap ----
// SRD 5.1, Adventuring Gear, Hunting Trap: "A creature that steps on the
// plate must succeed on a DC 13 Dexterity saving throw or take 1d4 piercing
// damage and stop moving. Thereafter, until the creature breaks free of the
// trap, its movement is limited by the length of the chain ... A creature
// can use its action to make a DC 13 Strength check, freeing itself or
// another creature within its reach on a success. Each failed check deals 1
// piercing damage to the trapped creature." The engine knew no hunting
// trap: a GM springing one on the party typed the save, the damage and the
// escape DC itself.

await test("N05: a hunting trap is a DC 13 Dexterity save or 1d4 piercing and caught; each failed DC 13 Strength check to get free costs 1 piercing", async () => {
  const walker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  world.clearDice();
  // Dexterity 10: a 12 misses DC 13; 1d4 = 3.
  world.dice(12, 3);
  const sprung = await world.invoke("apply_hazard", { type: "trap", trap: "Hunting Trap", characterIds: [walker.id] });
  assert.equal(sprung.ok, true, sprung.error);
  assert.equal(world.clearDice(), 0);
  assert.equal(40 - sheet(walker.id).currentHp, 3);
  assert.ok(sheet(walker.id).conditions.includes("caught in a hunting trap"), JSON.stringify(sheet(walker.id).conditions));
  // Strength 10: a 12 fails DC 13 and the jaws bite for 1; a 13 frees them.
  world.dice(12);
  const strain = await world.invoke("take_action", { characterId: walker.id, action: "escape" });
  assert.equal(strain.ok, true, strain.error);
  assert.equal(strain.result.success, false);
  assert.equal(40 - sheet(walker.id).currentHp, 4);
  world.dice(13);
  const free = await world.invoke("take_action", { characterId: walker.id, action: "escape" });
  assert.equal(free.ok, true, free.error);
  assert.equal(free.result.success, true);
  assert.equal(world.clearDice(), 0);
  assert.equal(sheet(walker.id).conditions.includes("caught in a hunting trap"), false);
  assert.equal(40 - sheet(walker.id).currentHp, 4);
});

await test("N05: a made save against a hunting trap is no damage and no hold", async () => {
  const walker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  world.clearDice();
  world.dice(13);
  const sprung = await world.invoke("apply_hazard", { type: "trap", trap: "Hunting Trap", characterIds: [walker.id] });
  assert.equal(sprung.ok, true, sprung.error);
  assert.equal(world.clearDice(), 0);
  assert.equal(sheet(walker.id).currentHp, 40);
  assert.deepEqual(sheet(walker.id).conditions, []);
});

// ---- N06: a named trap's failed-save condition keeps the trap's own duration ----
// SRD 5.1, Traps, Poison Needle: "the target must succeed on a DC 15
// Constitution saving throw or be poisoned for 1 hour". Rolling Sphere: a
// failed save is 10d10 "and knocked prone"; prone ends when the creature
// stands up, never on a save. The failed save's condition went through
// cast_at_player, which held the hour to 100 rounds (10 minutes) and made
// prone a condition a Dexterity save at each turn's end shook off.

await test("N06: a Poison Needle's failed save is poisoned for the hour, not ten minutes", async () => {
  const picker = world.addHero({ user: world.owner, class: "rogue", level: 3, maxHp: 60 });
  morning();
  world.clearDice();
  // 2d10 poison (10), then the DC 15 Constitution save failed.
  world.dice(5, 5, 1);
  const out = await world.invoke("apply_hazard", { type: "trap", trap: "Poison Needle", characterIds: [picker.id] });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 0);
  assert.ok(sheet(picker.id).conditions.includes("poisoned"));
  const later = await world.invoke("pass_time", { amount: 30, unit: "minutes" });
  assert.equal(later.ok, true, later.error);
  assert.ok(sheet(picker.id).conditions.includes("poisoned"), "the needle's poison wore off within half an hour");
  await world.invoke("pass_time", { amount: 31, unit: "minutes" });
  assert.equal(sheet(picker.id).conditions.includes("poisoned"), false, "the needle's poison outlasted its hour");
});

await test("N06: a Rolling Sphere's prone is the kind a creature stands up from, not a save-ends condition", async () => {
  const runner = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 90 });
  world.clearDice();
  world.dice(1, ...new Array(10).fill(5));
  const out = await world.invoke("apply_hazard", { type: "trap", trap: "Rolling Sphere", characterIds: [runner.id] });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 0);
  assert.equal(90 - sheet(runner.id).currentHp, 50);
  assert.ok(sheet(runner.id).conditions.includes("prone"));
  assert.equal(sheet(runner.id).conditionMeta?.prone?.saveEnds, undefined, JSON.stringify(sheet(runner.id).conditionMeta));
});

// ---- N07: a Potion of Giant Strength's Strength carries and lifts ----
// SRD 5.1, Potion of Giant Strength: "your Strength score changes for 1
// hour". Lifting and Carrying: carrying capacity is the Strength score x 15,
// and a creature can push, drag or lift up to twice that (30 x Strength).
// The potion's score reached attacks and checks, but the carry and lift
// limits read only worn items, so a drinker with Strength 10 still lifted
// at most 300 pounds.

await test("N07: a Potion of Hill Giant Strength's Strength 21 lifts 630 pounds and carries 315", async () => {
  const strongman = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  world.patch(strongman.id, { equipment: [{ name: "Potion of Hill Giant Strength", qty: 1 }] });
  const drunk = await world.invoke("use_item", { characterId: strongman.id, item: "Potion of Hill Giant Strength" });
  assert.equal(drunk.ok, true, drunk.error);
  const out = await world.invoke("lift", { characterId: strongman.id, weightLb: 600, how: "lift" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.limitLb, 630);
  assert.equal(out.result.capacityLb, 315);
});

// ---- N08: days without food read the Constitution an item sets ----
// SRD 5.1, Food and Water: "A character can go without food for a number of
// days equal to 3 + his or her Constitution modifier (minimum 1)." Amulet of
// Health: "Your Constitution score is 19 while you wear this amulet." The
// count read the sheet's own score, so the amulet bought no extra day.

await test("N08: an Amulet of Health's Constitution 19 is seven days without food, not three", async () => {
  const { dayOfUpkeep } = await import("../src/lib/dm/supplies.ts");
  const wearer = {
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    equipment: [{ name: "Amulet of Health", qty: 1, equipped: true, attuned: true }, { name: "Waterskin", qty: 1 }],
    exhaustion: 0,
  };
  // The fourth day without food: past 3 + 0, within 3 + 4.
  const day = dayOfUpkeep(wearer, { food: 3, water: 0 });
  assert.equal(day.hunger.food, 4);
  assert.equal(day.exhaustion, 0);
});

// ---- N09: the Javelin of Lightning's power says what a save does ----
// SRD 5.1, Javelin of Lightning: "Each creature in the line excluding you
// and the target must make a DC 13 Dexterity saving throw, taking 4d6
// lightning damage on a failed save, and half as much damage on a
// successful one." The power use_item hands the GM read "DC 13 Dexterity
// save or 4d6 lightning", so a save was resolved as no damage.

await test("N09: the Javelin of Lightning's power tells the GM a made save still takes half", async () => {
  const thrower = world.addHero({ user: world.owner, class: "fighter", level: 5, maxHp: 44 });
  world.patch(thrower.id, { equipment: [{ name: "Javelin of Lightning", qty: 1 }] });
  const out = await world.invoke("use_item", { characterId: thrower.id, item: "Javelin of Lightning" });
  assert.equal(out.ok, true, out.error);
  const power = String(out.result.power ?? "");
  assert.match(power, /DC 13 Dexterity/);
  assert.match(power, /half/, power);
});

world.close();
finish();
