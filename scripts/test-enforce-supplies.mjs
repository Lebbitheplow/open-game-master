// Food and water under the `supplies` variant rule, and nothing without it.
//
// SRD 5.1, Food and Water: a character needs a pound of food a day and can
// go without for 3 + Constitution modifier days (at least 1); each day
// beyond that costs a level of exhaustion, and a normal day of eating resets
// the count. A day without water costs a level of exhaustion. Exhaustion
// from going without is not removed until the character eats and drinks.
// ODM's decision: the rule is a variant, off by default, as ammunition is.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-supplies");
const RULES = {
  flanking: false, criticalFumbles: false, encumbrance: false, lingeringInjuries: false,
  powerfulCritical: false, criticalDamageMods: false, ammunition: false, restVariant: "standard",
};
const fed = await openWorld({ gameSettings: { variantRules: { ...RULES, supplies: true } } });
const loose = await openWorld({ gameSettings: { variantRules: RULES } });
const days = (world, amount) => world.invoke("pass_time", { amount, unit: "days" });
const qty = (world, id, name) => world.sheet(id).equipment.find((item) => item.name === name)?.qty ?? 0;

await test("with the variant off a day passes and nobody eats or tires", async () => {
  const hero = loose.addHero({ class: "fighter", level: 3, maxHp: 30, equipment: [{ name: "Rations (1 day)", qty: 2 }] });
  await days(loose, 5);
  assert.equal(qty(loose, hero.id, "Rations (1 day)"), 2);
  assert.equal(loose.sheet(hero.id).exhaustion ?? 0, 0);
});

const hungry = fed.addHero({ class: "fighter", level: 3, maxHp: 30, abilities: { con: 10 }, equipment: [{ name: "Rations (1 day)", qty: 1 }, { name: "Waterskin", qty: 1 }] });

await test("Under the supplies variant each dawn a character eats a ration from their pack.", async () => {
  await days(fed, 1);
  assert.equal(qty(fed, hungry.id, "Rations (1 day)"), 0);
  assert.equal(fed.sheet(hungry.id).exhaustion ?? 0, 0);
});

await test("Past 3 + CON modifier days without food a character gains a level of exhaustion each further day.", async () => {
  await days(fed, 3);
  assert.equal(fed.sheet(hungry.id).exhaustion ?? 0, 0, "three days without food are within a CON 10 character's limit");
  await days(fed, 1);
  assert.equal(fed.sheet(hungry.id).exhaustion, 1);
});

await test("A character going without food keeps their exhaustion through a long rest.", async () => {
  const rested = await fed.invoke("take_rest", { kind: "long" });
  assert.equal(rested.ok, true, rested.error);
  assert.ok((fed.sheet(hungry.id).exhaustion ?? 0) >= 1);
});

await test("A day with nothing to drink costs a level of exhaustion.", async () => {
  const dry = fed.addHero({ class: "fighter", level: 3, maxHp: 30, equipment: [{ name: "Rations (1 day)", qty: 5 }] });
  await days(fed, 1);
  assert.equal(fed.sheet(dry.id).exhaustion, 1);
});

// Food and water from the world (issue 793): a meal the story names, and a
// lifestyle that pays for them. A fresh table for each, so one hero's dawns
// are not another's.
const { getClock, setClock, setClockInstant } = await import("../src/lib/db/clock.ts");
const RATIONS = { name: "Rations (1 day)", qty: 1 };
const WATERSKIN = { name: "Waterskin", qty: 1 };
const DAY = 24 * 60;
const worlds = [];
async function table(variant = true, settings = {}) {
  const world = await openWorld({ gameSettings: { variantRules: { ...RULES, supplies: variant }, ...settings } });
  worlds.push(world);
  // A sheet is created without these two, so they are written after it.
  const hero = ({ exhaustion, deathSaves, ...overrides } = {}) => {
    const made = world.addHero({ class: "fighter", level: 3, maxHp: 30, abilities: { con: 10 }, ...overrides });
    if (exhaustion || deathSaves) {
      world.patch(made.id, { ...(exhaustion ? { exhaustion } : {}), ...(deathSaves ? { deathSaves } : {}) });
    }
    return made;
  };
  // Eleven at night on day ten, seven hours short of the next dawn but one
  // night's rest across it.
  setClockInstant(world.campaignId, 10 * DAY + 23 * 60);
  const clock = () => getClock(world.campaignId);
  const without = (id, hunger) => setClock(world.campaignId, { ...clock(), supplies: { ...clock().supplies, [id]: hunger } });
  return { world, hero, clock, without };
}

await test("With no meal and no waterskin, a character already exhausted takes two levels at the dawn, as the SRD has it.", async () => {
  const { world, hero, clock } = await table();
  const dry = hero({ exhaustion: 1, equipment: [] });
  await world.invoke("pass_time", { amount: 8, unit: "hours" });
  assert.equal(world.sheet(dry.id).exhaustion, 3);
  assert.equal(clock().supplies[dry.id].water, 1);
});

await test("A meal from the story costs no level and no ration at the dawn, and zeroes the counts.", async () => {
  const { world, hero, clock, without } = await table();
  const guest = hero({ equipment: [RATIONS] });
  without(guest.id, { food: 2, water: 1 });
  const out = await world.invoke("pass_time", { amount: 8, unit: "hours", meal: "the host's dinner and the well" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(guest.id).exhaustion ?? 0, 0);
  assert.equal(qty(world, guest.id, "Rations (1 day)"), 1);
  assert.deepEqual(clock().supplies[guest.id], { food: 0, water: 0 });
  assert.equal(clock().mealAtDawn, undefined, "the dawn used the meal up");
});

await test("A meal zeroes the counts at once and waits for the dawn when the time passed crosses none.", async () => {
  const { world, hero, clock, without } = await table();
  setClockInstant(world.campaignId, 10 * DAY + 18 * 60);
  const guest = hero({ equipment: [RATIONS] });
  without(guest.id, { food: 2, water: 1 });
  await world.invoke("pass_time", { amount: 1, unit: "hours", meal: "supper at the inn" });
  assert.deepEqual(clock().supplies[guest.id], { food: 0, water: 0 });
  assert.equal(clock().mealAtDawn, true);
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  assert.equal(qty(world, guest.id, "Rations (1 day)"), 1, "the dawn the meal waited for cost no ration");
  assert.equal(clock().mealAtDawn, undefined);
});

await test("A meal covers one dawn only, however many the time crosses.", async () => {
  const { world, hero, clock } = await table();
  const guest = hero({ equipment: [RATIONS] });
  await world.invoke("pass_time", { amount: 2, unit: "days", meal: "the host's dinner" });
  assert.equal(qty(world, guest.id, "Rations (1 day)"), 0, "the second dawn eats from the pack");
  assert.equal(world.sheet(guest.id).exhaustion, 1, "the second dawn has no water");
  assert.deepEqual(clock().supplies[guest.id], { food: 0, water: 1 });
  assert.equal(clock().mealAtDawn, undefined);
});

await test("A journey of days has its meal once: the first night's dawn, not one a day.", async () => {
  const { world, hero, clock } = await table();
  setClockInstant(world.campaignId, 10 * DAY + 8 * 60);
  // Constitution past any saving throw the road's weather can ask, so the
  // cold does not kill the hero before the second dawn.
  const guest = hero({ abilities: { con: 30 }, equipment: [{ ...RATIONS, qty: 5 }, WATERSKIN] });
  const out = await world.invoke("travel", { days: 3, meal: "breakfast at the host's table" });
  assert.equal(out.ok, true, out.error);
  assert.equal(qty(world, guest.id, "Rations (1 day)"), 4, "two dawns on the road, and the first was covered");
  assert.equal(clock().mealAtDawn, undefined);
});

await test("A long rest on a meal lifts a level; the same rest without one keeps it, as the SRD has it.", async () => {
  const fedAtTable = await table();
  const guest = fedAtTable.hero({ exhaustion: 1, equipment: [] });
  fedAtTable.without(guest.id, { food: 0, water: 1 });
  const rested = await fedAtTable.world.invoke("take_rest", { kind: "long", meal: "the host's dinner and the well" });
  assert.equal(rested.ok, true, rested.error);
  assert.equal(fedAtTable.world.sheet(guest.id).exhaustion ?? 0, 0);
  assert.deepEqual(fedAtTable.clock().supplies[guest.id], { food: 0, water: 0 });

  const unfed = await table();
  const dry = unfed.hero({ exhaustion: 1, equipment: [] });
  unfed.without(dry.id, { food: 0, water: 1 });
  await unfed.world.invoke("take_rest", { kind: "long" });
  assert.equal(unfed.world.sheet(dry.id).exhaustion, 3, "two for the dry dawn, and the rest lifts none");
  assert.equal(unfed.clock().supplies[dry.id].water, 2);
});

await test("A lifestyle of squalid or better feeds and waters at every dawn; wretched, none, and a purse that cannot pay do not.", async () => {
  const { world, hero, clock } = await table();
  const townie = hero({ gold: 50, equipment: [RATIONS] });
  const beggar = hero({ gold: 50, equipment: [RATIONS] });
  const roadman = hero({ gold: 50, equipment: [RATIONS] });
  const broke = hero({ gold: 0, equipment: [RATIONS] });
  await world.invoke("set_lifestyle", { characterIds: [townie.id, broke.id], lifestyle: "modest" });
  await world.invoke("set_lifestyle", { characterIds: [beggar.id], lifestyle: "wretched" });
  await world.invoke("pass_time", { amount: 2, unit: "days" });
  assert.equal(qty(world, townie.id, "Rations (1 day)"), 1);
  assert.equal(world.sheet(townie.id).exhaustion ?? 0, 0);
  assert.deepEqual(clock().supplies[townie.id], { food: 0, water: 0 });
  assert.equal(world.sheet(townie.id).gold, 48, "the two dawns are still paid for");
  for (const unkept of [beggar, roadman, broke]) {
    assert.equal(qty(world, unkept.id, "Rations (1 day)"), 0, "stays on supplies");
    assert.ok(world.sheet(unkept.id).exhaustion >= 1, "goes dry with no waterskin");
  }
});

await test("A lifestyle feeds only on the dawns it is paid for: a march of hours or the GM's clock crosses a dawn on the pack.", async () => {
  // A table a person runs, whose clock control is the GM's own.
  const { world, hero } = await table(true, { dmMode: "human" });
  setClockInstant(world.campaignId, 10 * DAY + 20 * 60);
  const townie = hero({ abilities: { con: 30 }, gold: 50, equipment: [{ ...RATIONS, qty: 3 }, WATERSKIN] });
  await world.invoke("set_lifestyle", { characterIds: [townie.id], lifestyle: "modest" });
  const marched = await world.invoke("travel", { hours: 12 });
  assert.equal(marched.ok, true, marched.error);
  assert.equal(world.sheet(townie.id).gold, 50, "the march paid no lifestyle");
  assert.equal(qty(world, townie.id, "Rations (1 day)"), 2, "the dawn on the road was fed free");
  const route = await world.route("campaigns/[campaignId]/dm/clock");
  world.signIn(world.owner);
  const moved = await route.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ do: "advance", amount: 1, unit: "days" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(moved.status, 200, await moved.clone().text());
  assert.equal(qty(world, townie.id, "Rations (1 day)"), 1, "the GM's clock fed them free");
});

await test("Work that keeps a character fed them: a profession's modest lifestyle with an empty purse costs no ration.", async () => {
  const { world, hero } = await table();
  setClockInstant(world.campaignId, 10 * DAY + 8 * 60);
  const smith = hero({ gold: 0, equipment: [{ ...RATIONS, qty: 3 }, WATERSKIN] });
  await world.invoke("set_lifestyle", { characterIds: [smith.id], lifestyle: "modest" });
  const out = await world.invoke("downtime", { days: 2, characterId: smith.id, activity: "profession" });
  assert.equal(out.ok, true, out.error);
  assert.equal(qty(world, smith.id, "Rations (1 day)"), 3, "the work kept them, and they ate from the pack");
});

await test("A long rest whose dawn a lifestyle pays for lifts a level from a character who went dry, as their ration and water at that dawn do.", async () => {
  const { world, hero, clock, without } = await table();
  const townie = hero({ exhaustion: 1, gold: 50, equipment: [] });
  without(townie.id, { food: 0, water: 1 });
  await world.invoke("set_lifestyle", { characterIds: [townie.id], lifestyle: "modest" });
  const rested = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rested.ok, true, rested.error);
  assert.deepEqual(clock().supplies[townie.id], { food: 0, water: 0 });
  assert.equal(world.sheet(townie.id).exhaustion ?? 0, 0, "fed and watered at the rest's dawn, and the rest lifted nothing");
});

await test("Scarce water stands against a meal and against a lifestyle: none still costs the level, half still asks the save.", async () => {
  const { world, hero, clock, without } = await table();
  const guest = hero({ equipment: [RATIONS, WATERSKIN] });
  const townie = hero({ gold: 50, equipment: [RATIONS, WATERSKIN] });
  await world.invoke("set_lifestyle", { characterIds: [townie.id], lifestyle: "modest" });
  without(guest.id, { food: 2, water: 1 });
  await world.invoke("pass_time", { amount: 8, unit: "hours", water: "none", meal: "a dry crust from a stranger" });
  assert.equal(world.sheet(guest.id).exhaustion, 1);
  assert.equal(world.sheet(townie.id).exhaustion, 1);
  assert.deepEqual(clock().supplies[guest.id], { food: 0, water: 2 }, "the food is eaten and the water is not there");
  assert.equal(qty(world, guest.id, "Rations (1 day)"), 1);

  const half = await table();
  const thirsty = half.hero({ equipment: [] });
  half.world.diceLog();
  half.world.dice(1);
  await half.world.invoke("pass_time", { amount: 8, unit: "hours", water: "half", meal: "the host's thin soup" });
  half.world.clearDice();
  assert.equal(half.world.sheet(thirsty.id).exhaustion, 1, "the failed DC 15 save on half water");
});

await test("With the variant off a meal writes nothing.", async () => {
  const { world, hero, clock } = await table(false);
  const guest = hero({ equipment: [RATIONS] });
  const out = await world.invoke("pass_time", { amount: 8, unit: "hours", meal: "the host's dinner" });
  assert.equal(out.ok, true, out.error);
  assert.equal(clock().supplies, undefined);
  assert.equal(clock().mealAtDawn, undefined);
  assert.equal(qty(world, guest.id, "Rations (1 day)"), 1);
});

await test("A meal shorter than 3 characters is refused on all three tools, and the clock does not move.", async () => {
  const { world, hero, clock } = await table();
  hero({ equipment: [] });
  const at = clock().instant;
  for (const [tool, args] of [
    ["pass_time", { amount: 8, unit: "hours" }],
    ["travel", { hours: 8 }],
    ["take_rest", { kind: "long" }],
  ]) {
    for (const meal of ["ab", "  a  "]) {
      const out = await world.invoke(tool, { ...args, meal });
      assert.equal(out.retry, true, `${tool} took ${JSON.stringify(meal)}: ${JSON.stringify(out)}`);
      assert.match(out.error, /at least 3 characters/);
      assert.equal(clock().instant, at, `${tool} moved the clock`);
      assert.equal(clock().mealAtDawn, undefined);
    }
  }
});

await test("The dead are not fed: a meal leaves their counts where they stopped.", async () => {
  const { world, hero, clock, without } = await table();
  const fallen = hero({ equipment: [], deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  without(fallen.id, { food: 2, water: 1 });
  hero({ equipment: [] });
  await world.invoke("pass_time", { amount: 1, unit: "hours", meal: "the host's dinner" });
  assert.deepEqual(clock().supplies[fallen.id], { food: 2, water: 1 });
});

await test("Reverting the turn takes the meal back with the time: the counts, and the dawn it covered.", async () => {
  const { world, hero, clock, without } = await table();
  setClockInstant(world.campaignId, 10 * DAY + 18 * 60);
  const guest = hero({ equipment: [RATIONS] });
  without(guest.id, { food: 2, water: 1 });
  const out = await world.invoke("pass_time", { amount: 1, unit: "hours", meal: "supper at the inn" });
  assert.equal(clock().mealAtDawn, true);
  const route = await world.route("campaigns/[campaignId]/audit/revert-turn");
  world.signIn(world.owner);
  const reverted = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnId: out.turnId }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(reverted.status, 200, await reverted.clone().text());
  assert.deepEqual(clock().supplies[guest.id], { food: 2, water: 1 });
  assert.equal(clock().mealAtDawn, undefined);
});

for (const world of worlds) {
  world.close();
}
fed.close();
loose.close();
finish();
