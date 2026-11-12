// Faithful Summons (Circle of the Shepherd 14): "When you are reduced to 0
// hit points or incapacitated against your will, you gain the effects of
// conjure animals cast with a 9th-level slot: four beasts of your choice,
// each challenge rating 2 or lower, appear within 20 feet, protect you and
// attack your foes for an hour without concentration."
//
// It was a counter the GM spent by hand. Now the incapacity watch answers
// the fall whichever route laid it (damage, set_condition): four wolves,
// allies in the order, Mighty Summoner's hit points with them, the use spent.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { summonsOf } = await import("../src/lib/dm/summon-store.ts");
const { removeSummon } = await import("../src/lib/dm/summon-store.ts");

const { test, finish } = suite("test-enforce-faithful-summons");
const world = await openWorld({ campaign: { maxPlayers: 12 } });
const kit = await combatKit(world);
const COUNTER = "sub_faithful_summons";
// The watch answers once the write's own handler has finished.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const druid = world.addHero({
  class: "druid", subclass: "Circle of the Shepherd", level: 14, maxHp: 80, proficiencies: TRAINED,
  abilities: { str: 10, dex: 12, con: 14, int: 10, wis: 18, cha: 10 }, portrait: { url: "/uploads/test.png" },
});
const wolves = () => summonsOf(world.campaignId, druid.id, "Faithful Summons");

async function stage({ used = 0 } = {}) {
  for (const wolf of wolves()) {
    removeSummon(world.campaign(), wolf);
  }
  await kit.endFight();
  await kit.fight(1);
  const resources = world.sheet(druid.id).resources;
  world.patch(druid.id, { currentHp: 30, deathSaves: null, conditions: [], conditionMeta: {}, resources: { ...resources, [COUNTER]: { max: 1, used } } });
  await settled();
}

await test("A Shepherd druid of 14th level holds the one use.", async () => {
  assert.deepEqual(world.sheet(druid.id).resources[COUNTER], { max: 1, used: 0 });
});

await test("Dropped to 0 hit points, the druid's four wolves come: allies in the order, each with Mighty Summoner's hit points, and the use is spent.", async () => {
  await stage();
  const out = await world.invoke("apply_damage", { characterId: druid.id, amount: 40, type: "slashing" });
  assert.equal(out.ok, true, out.error);
  await settled();
  assert.equal(world.sheet(druid.id).currentHp, 0);
  const pack = wolves();
  assert.equal(pack.length, 4, JSON.stringify(pack.map((wolf) => wolf.name)));
  assert.ok(pack.every((wolf) => wolf.summon?.form === "Wolf" && wolf.summon?.concentration === false));
  // A wolf: 11 hit points from 2d8 + 2; Mighty Summoner adds 2 per Hit Die.
  assert.ok(pack.every((wolf) => wolf.maxHp === 15), JSON.stringify(pack.map((wolf) => wolf.maxHp)));
  const order = world.encounter().order.map((entry) => entry.characterId);
  assert.ok(pack.every((wolf) => order.includes(wolf.id)), "in the initiative order");
  assert.equal(world.sheet(druid.id).resources[COUNTER].used, 1);
});

await test("Stunned by a foe's effect while still standing, the druid's wolves come too.", async () => {
  await stage();
  const [enemy] = world.enemies();
  world.patch(druid.id, { conditions: ["stunned"], conditionMeta: { stunned: { source: enemy.id, rounds: 1 } } });
  await settled();
  assert.equal(wolves().length, 4);
  assert.equal(world.sheet(druid.id).resources[COUNTER].used, 1);
});

await test("An incapacitation of the druid's own doing, a spent use, or a fall that kills calls nothing.", async () => {
  await stage();
  world.patch(druid.id, { conditions: ["incapacitated"], conditionMeta: { incapacitated: { source: druid.id } } });
  await settled();
  assert.equal(wolves().length, 0, "by their own will");
  await stage({ used: 1 });
  await world.invoke("apply_damage", { characterId: druid.id, amount: 40, type: "slashing" });
  await settled();
  assert.equal(wolves().length, 0, "the use spent");
  await stage();
  await world.invoke("apply_damage", { characterId: druid.id, amount: 200, type: "slashing" });
  await settled();
  assert.equal(wolves().length, 0, "killed outright");
  assert.equal(world.sheet(druid.id).resources[COUNTER].used, 0);
});

world.close();
finish();
