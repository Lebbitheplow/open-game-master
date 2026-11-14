// Exploration as the engine holds it: the march, what the party notices on
// the way, the light they carry, and the weather they walk through.
//
// SRD 5.1, Travel Pace: past 8 hours a character makes a Constitution save
// at the end of each extra hour, DC 10 + 1 for each hour past 8, and gains a
// level of exhaustion on each failure. A fast pace is -5 to passive
// Perception. Vision and Light: dim light gives disadvantage on Perception
// that relies on sight (-5 passive); darkvision sees darkness as dim light.
// Conditions: an unconscious creature is unaware of its surroundings.
// Adventuring Gear: a torch burns for 1 hour, a lantern 6 hours on a flask
// of oil. The weather rules the SRD's Gamemastering section carries: in
// extreme heat a Constitution save each hour, DC 5 rising by 1 an hour, at
// disadvantage in medium or heavy armor; in extreme cold DC 10 each hour.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-exploration");
const world = await openWorld();
const { getDatabase } = await import("../src/lib/db/core.ts");

const profs = (extra = {}) => ({
  saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [], ...extra,
});
const savesOf = (id) =>
  getDatabase()
    .prepare(`SELECT dc FROM rolls WHERE character_id = ? AND roll_kind = 'saving_throw' ORDER BY created_at, rowid`)
    .all(id)
    .map((row) => row.dc);

// A clear, mild sky, so the weather adds nothing a case did not ask for.
await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });

await test("A 12-hour march is four forced-march hours: four Constitution saves at DC 11, 12, 13 and 14, each failure a level of exhaustion.", async () => {
  const walker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  // Set out at six in the morning: a march that crossed a dawn would roll a
  // new sky, and a cold one adds its own saves to the count.
  const { getClock: clockNow, setClockInstant: setInstant } = await import("../src/lib/db/clock.ts");
  setInstant(world.campaignId, (Math.floor(clockNow(world.campaignId).instant / 1440) + 1) * 1440 + 6 * 60);
  await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
  world.dice(1, 1, 1, 1);
  // A leg of four hours or more rolls a new sky too (src/lib/dm/sky.ts), and
  // a frigid or hot one adds an exposure save for every hour on the road.
  // Its rolls come from Math.random: 0.5 keeps the clear sky with no drift.
  const random = Math.random;
  Math.random = () => 0.5;
  let out;
  try {
    out = await world.invoke("travel", { hours: 12, pace: "normal", characterIds: [walker.id] });
  } finally {
    Math.random = random;
  }
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(savesOf(walker.id), [11, 12, 13, 14]);
  assert.equal(world.sheet(walker.id).exhaustion, 4);
});

// A march that named no one at the table found out only on its forced
// hours, after the clock, the world, the sky and the water had moved, and
// the retry it asked for moved them all again. Within 8 hours it walked on
// with nobody.
await test("A march naming nobody at the table is refused before anything moves: the clock, the water and the pace stay as they were.", async () => {
  const { getClock: clockNow } = await import("../src/lib/db/clock.ts");
  const before = clockNow(world.campaignId);
  for (const hours of [2, 12]) {
    const out = await world.invoke("travel", { hours, pace: "fast", water: "none", characterIds: ["nobody-at-this-table"] });
    assert.equal(out.ok, false, `${hours} hours: ${JSON.stringify(out.result ?? {})}`);
    assert.match(out.error, /names nobody at this table.*Nothing moved/, `${hours} hours`);
    assert.deepEqual(clockNow(world.campaignId), before, `${hours} hours moved the clock`);
  }
});

// ---- riding aboard (SRD 5.1, Mounts and Vehicles) ----

const clear = () => world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
// The next day at this hour and minute, under a clear sky.
const nextDayAt = async (hour, minute = 0) => {
  const { getClock: clockNow, setClockInstant: setInstant } = await import("../src/lib/db/clock.ts");
  setInstant(world.campaignId, (Math.floor(clockNow(world.campaignId).instant / 1440) + 1) * 1440 + hour * 60 + minute);
  await clear();
};
// A leg of four hours or more, or a dawn, rolls a new sky from Math.random:
// 0.5 keeps the clear one with no drift.
const steadySky = async (run) => {
  const random = Math.random;
  Math.random = () => 0.5;
  try {
    return await run();
  } finally {
    Math.random = random;
  }
};

// The report against 0.35.0: a long rest ending at 21:01, eight hours on
// foot through the night, a quarter hour at an inn, then a wagon, whose first
// hour rolled "CON save vs forced march, hour 9, DC 11": riders aboard were
// counted as marching it.
await test("Riders aboard a wagon are not marching: a wagon boarded after eight hours on foot rolls no forced-march save, keeps its pace's miles, and says why.", async () => {
  const { getClock: clockNow } = await import("../src/lib/db/clock.ts");
  const { forcedMarchSpan } = await import("../src/lib/srd/travel.ts");
  const rider = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  await nextDayAt(13, 1);
  const { walked, wagon, onFoot } = await steadySky(async () => {
    const rest = await world.invoke("take_rest", { kind: "long", characterIds: [rider.id] });
    assert.equal(rest.ok, true, rest.error);
    const walked = await world.invoke("travel", { hours: 8, pace: "normal", characterIds: [rider.id] });
    await world.invoke("pass_time", { amount: 15, unit: "minutes" });
    // The same three hours on foot are the ninth to the eleventh.
    const day = clockNow(world.campaignId);
    const onFoot = forcedMarchSpan(day.marched.filter((leg) => leg.ids.includes(rider.id)), day.instant + 180, 3, day.longRests?.[rider.id]);
    const wagon = await world.invoke("travel", { hours: 3, pace: "normal", aboard: "wagon", characterIds: [rider.id] });
    return { walked, wagon, onFoot };
  });
  assert.equal(walked.result.forcedMarch, false, JSON.stringify(walked.result));
  assert.deepEqual(onFoot, { from: 1, to: 3 }, "walked, the leg would be no forced march");
  assert.equal(wagon.ok, true, wagon.error);
  assert.equal(wagon.result.forcedMarch, false, JSON.stringify(wagon.result));
  assert.equal(wagon.result.aboard, "wagon");
  assert.equal(wagon.result.miles, 9, "a wagon chooses a pace as normal");
  assert.match(wagon.result.note, /not marching/);
  assert.deepEqual(savesOf(rider.id), []);
  assert.equal(world.sheet(rider.id).exhaustion ?? 0, 0);
});

await test("Hours ridden aboard add nothing to the day's march and are no halt in it: six hours walked, nine ridden and four walked are two forced-march hours, DC 11 and 12.", async () => {
  const { getClock: clockNow } = await import("../src/lib/db/clock.ts");
  const walker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  await nextDayAt(6);
  const last = await steadySky(async () => {
    await world.invoke("travel", { hours: 6, pace: "normal", characterIds: [walker.id] });
    await world.invoke("travel", { hours: 9, pace: "normal", aboard: "carriage", characterIds: [walker.id] });
    world.dice(1, 1);
    try {
      return await world.invoke("travel", { hours: 4, pace: "normal", characterIds: [walker.id] });
    } finally {
      world.clearDice();
    }
  });
  assert.equal(last.ok, true, last.error);
  assert.equal(last.result.forcedMarch, true, JSON.stringify(last.result));
  assert.deepEqual(savesOf(walker.id), [11, 12]);
  assert.equal(world.sheet(walker.id).exhaustion, 2);
  // The clock keeps the ride as a carried leg (src/lib/dm/march-state.ts).
  assert.deepEqual(clockNow(world.campaignId).marched.filter((leg) => leg.ids.includes(walker.id)).map((leg) => leg.carried === true), [false, true, false]);
});

await test("A ship makes her own speed whatever the pace or the ground, with no fast-pace penalty and no forced march: ten hours aboard a sailing ship are 20 miles and no save.", async () => {
  const { getClock: clockNow } = await import("../src/lib/db/clock.ts");
  const sailor = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  await nextDayAt(6);
  const out = await steadySky(() => world.invoke("travel", { hours: 10, pace: "fast", terrain: "difficult", aboard: "sailing ship", characterIds: [sailor.id] }));
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.miles, 20, JSON.stringify(out.result));
  assert.equal(out.result.passivePerceptionMod, 0, "a vessel takes no fast-pace penalty");
  assert.equal(out.result.forcedMarch, false);
  assert.deepEqual(savesOf(sailor.id), []);
  // No slow-pace stealth either: the pace the clock keeps is a normal one's.
  assert.equal(clockNow(world.campaignId).travelPace, "normal");
  const leg = await steadySky(() => world.invoke("travel", { miles: 9, aboard: "galley", characterIds: [sailor.id] }));
  assert.equal(leg.result.hours, 3, "9 miles at a galley's 4 mph take 3 hours");
});

await test("A journey of days aboard a crewed ship sails on through the night, the rest taken aboard; a rowboat puts in at dusk as walkers camp.", async () => {
  const { getClock: clockNow } = await import("../src/lib/db/clock.ts");
  const sailor = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  await nextDayAt(6);
  const start = clockNow(world.campaignId).instant;
  const voyage = await steadySky(() => world.invoke("travel", { days: 2, aboard: "sailing ship", characterIds: [sailor.id] }));
  assert.equal(voyage.ok, true, voyage.error);
  assert.deepEqual(voyage.result.legs.map((leg) => leg.hours), [16, 16], JSON.stringify(voyage.result));
  assert.equal(voyage.result.legs[0].miles, 32);
  assert.equal(voyage.result.nights[0].sailedOn, 16, JSON.stringify(voyage.result.nights));
  assert.equal(clockNow(world.campaignId).instant - start, 40 * 60, "16 hours, the night's 8, and 16 more");
  assert.deepEqual(savesOf(sailor.id), []);
  const rower = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  await nextDayAt(6);
  const from = clockNow(world.campaignId).instant;
  const crossing = await steadySky(() => world.invoke("travel", { days: 2, aboard: "rowboat", characterIds: [rower.id] }));
  assert.equal(crossing.ok, true, crossing.error);
  assert.deepEqual(crossing.result.legs.map((leg) => leg.miles), [12, 12], JSON.stringify(crossing.result));
  assert.equal(clockNow(world.campaignId).instant - from, 32 * 60, "8 hours, the camp's 16, and 8 more");
});

// Passive Perception exactly 15: WIS 16 (+3) and proficiency (+2).
const lookout = world.addHero({ user: world.owner, class: "ranger", level: 1, race: "human", abilities: { wis: 16 }, proficiencies: profs({ skills: ["perception"] }) });
// The clock set to an hour of the next day, so a case reads the light it
// means to.
const { getClock, setClockInstant } = await import("../src/lib/db/clock.ts");
const at = async (hour) => {
  const day = Math.floor(getClock(world.campaignId).instant / 1440) + 1;
  setClockInstant(world.campaignId, day * 1440 + hour * 60);
  // A new day would roll a new sky; the case wants a clear one.
  await world.invoke("set_weather", { sky: "clear", temperature: "mild", wind: "calm" });
};
let lastNotice = "";
const notice = async (dc = 15) => {
  const out = await world.invoke("check_notice", { dc, characterIds: [lookout.id] });
  assert.equal(out.ok, true, out.error);
  lastNotice = JSON.stringify(out.result.applied ?? []);
  return out.result.noticedBy.includes(world.sheet(lookout.id).name);
};

await test("A fast travel pace is -5 to passive Perception until the party stops: a passive 15 misses a DC 15 thing at a fast pace and catches it at a normal one.", async () => {
  await at(9);
  await world.invoke("travel", { hours: 1, pace: "normal", characterIds: [lookout.id] });
  assert.equal(await notice(), true);
  await world.invoke("travel", { hours: 1, pace: "fast", characterIds: [lookout.id] });
  assert.equal(await notice(), false);
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
  assert.equal(await notice(), true);
});

await test("Off the board, night is darkness: a character without darkvision or a light sees nothing, a torch gives back full sight, and darkvision sees the dark as dim light (-5).", async () => {
  await at(23);
  assert.equal(await notice(5), false, `in the dark: ${lastNotice}`);
  world.patch(lookout.id, { equipment: [{ name: "Torch", qty: 1 }] });
  assert.equal(await notice(), true, `with a torch: ${lastNotice}`);
  world.patch(lookout.id, { equipment: [], features: [{ name: "Darkvision", source: "race" }] });
  assert.equal(await notice(10), true, `with darkvision: ${lastNotice}`);
  assert.equal(await notice(15), false, `with darkvision: ${lastNotice}`);
  world.patch(lookout.id, { features: [] });
  await at(12);
  assert.equal(await notice(), true, `at noon: ${lastNotice}`);
});

await test("An unconscious character notices nothing, however high their passive Perception.", async () => {
  const sleeper = world.addHero({ user: world.owner, class: "ranger", level: 5, abilities: { wis: 20 }, proficiencies: profs({ skills: ["perception"] }) });
  world.patch(sleeper.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0, stable: true, dead: false } });
  const out = await world.invoke("check_notice", { dc: 10, characterIds: [sleeper.id] });
  assert.deepEqual(out.result.noticedBy, []);
  assert.deepEqual(out.result.missedBy, [world.sheet(sleeper.id).name]);
  assert.ok((out.result.applied ?? []).includes(`${world.sheet(sleeper.id).name}: unconscious: unaware of their surroundings`), `the result does not say why: ${JSON.stringify(out.result)}`);
});

// A hero killed by six levels of exhaustion (a frigid march, issue #570's
// flaky ADV-06) missed a DC 5 thing with no applied line, and the note said
// their passive Perception was under DC 5.
await test("A dead character notices nothing, and the result says so instead of blaming a passive score that was never compared.", async () => {
  const fallen = world.addHero({ user: world.owner, class: "ranger", level: 5, abilities: { wis: 20 }, proficiencies: profs({ skills: ["perception"] }) });
  world.patch(fallen.id, { currentHp: 0, exhaustion: 6, deathSaves: { successes: 0, failures: 0, stable: false, dead: true } });
  const name = world.sheet(fallen.id).name;
  const out = await world.invoke("check_notice", { dc: 5, characterIds: [fallen.id] });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(out.result.missedBy, [name]);
  assert.ok((out.result.applied ?? []).includes(`${name}: dead: notices nothing`), `the result does not say why: ${JSON.stringify(out.result)}`);
  assert.doesNotMatch(out.result.note, /under DC/, `the note blames the passive score: ${out.result.note}`);
  // Beside someone who was scored, the note names both reasons.
  const mixed = await world.invoke("check_notice", { dc: 30, characterIds: [fallen.id, lookout.id] });
  assert.match(mixed.result.note, /applied says why some cannot notice it, and every other passive perception is under DC 30/, mixed.result.note);
});

await test("Three hours of extreme heat are three Constitution saves at DC 5, 6 and 7, at disadvantage in medium armor, each failure a level of exhaustion.", async () => {
  const trekker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40, equipment: [{ name: "Scale Mail", qty: 1 }] });
  world.diceLog();
  world.dice(1, 1, 1, 1, 1, 1);
  const out = await world.invoke("apply_hazard", { type: "extreme_heat", hours: 3, characterIds: [trekker.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(savesOf(trekker.id), [5, 6, 7]);
  assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 6, "each save rolled at disadvantage");
  assert.equal(world.sheet(trekker.id).exhaustion, 3);
});

await test("Two hours of extreme cold are two Constitution saves at DC 10; cold weather gear shrugs them off.", async () => {
  const trekker = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40 });
  world.dice(1, 1);
  await world.invoke("apply_hazard", { type: "extreme_cold", hours: 2, characterIds: [trekker.id] });
  world.clearDice();
  assert.deepEqual(savesOf(trekker.id), [10, 10]);
  const bundled = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40, equipment: [{ name: "Cold Weather Gear", qty: 1 }] });
  await world.invoke("apply_hazard", { type: "extreme_cold", hours: 2, characterIds: [bundled.id] });
  assert.deepEqual(savesOf(bundled.id), []);
  assert.equal(world.sheet(bundled.id).exhaustion ?? 0, 0);
});

// ---- light that burns down ----

const bearer = world.addHero({ user: world.owner, class: "fighter", level: 3, maxHp: 40, equipment: [{ name: "Torch", qty: 1 }, { name: "Rope", qty: 1 }] });

await test("A lit torch burns for an hour and is then used up: the pack loses the torch, and the next board gives no light.", async () => {
  const fight = await world.beginFight([{ monster: "goblin", count: 1 }]);
  const { getTokenByRef, getBattleMapForEncounter } = await import("../src/lib/db/battle-maps.ts");
  const token = () => getTokenByRef(getBattleMapForEncounter(fight.id).id, bearer.id);
  assert.ok(token().lightRadius > 0, "the torch was never lit");
  const moved = await world.invoke("pass_time", { amount: 61, unit: "minutes" });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(token().lightRadius, 0);
  assert.deepEqual(world.sheet(bearer.id).equipment.map((item) => item.name), ["Rope"]);
  await world.invoke("end_encounter", { outcome: "truce" });
  const { carriedLight } = await import("../src/lib/dm/light-timers.ts");
  assert.equal(carriedLight(world.sheet(bearer.id)).radius, 0);
});

await test("a lantern burns on its flask of oil: with none carried it gives no light", async () => {
  const { carriedLight } = await import("../src/lib/dm/light-timers.ts");
  assert.equal(carriedLight({ equipment: [{ name: "Hooded Lantern", qty: 1 }] }).radius, 0);
  assert.ok(carriedLight({ equipment: [{ name: "Hooded Lantern", qty: 1 }, { name: "Flask of Oil", qty: 2 }] }).radius > 0);
});

world.close();
finish();
