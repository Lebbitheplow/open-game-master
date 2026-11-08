// Two features that answer being dropped to 0 hit points, held by the damage
// path as Undying Sentinel is (src/lib/dm/pc-damage.ts):
//
//   Strength of the Grave (Shadow Magic 1): a Charisma save against 5 + the
//   damage taken leaves the sorcerer at 1 instead; not against radiant damage
//   or a critical hit, and only a success spends the use.
//   Blazing Revival (Circle of Wildfire 14): while the wildfire spirit is out,
//   the spirit falls in the druid's place and they come back at half their
//   hit point maximum.
//
// Before this both were cards the Hand offered: played after the drop they
// were refused, the hero being at 0, and played before it they spent the use
// for nothing.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-zero-hp-holds");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");

const hurt = (id, amount, extra = {}) => world.invoke("apply_damage", { characterId: id, amount, type: "slashing", ...extra });

// ---- Strength of the Grave ----

const sorcerer = world.addHero({
  class: "sorcerer", subclass: "Shadow Magic", level: 5, maxHp: 40, proficiencies: TRAINED,
  abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 16 },
  portrait: { url: "/uploads/test.png" },
});
const grave = () => world.sheet(sorcerer.id).resources.sub_strength_of_the_grave;
const graveAt = (currentHp, used = 0) =>
  world.patch(sorcerer.id, { currentHp, deathSaves: null, conditions: [], conditionMeta: {}, resources: { ...world.sheet(sorcerer.id).resources, sub_strength_of_the_grave: { max: 1, used } } });

await test("A Shadow sorcerer holds the one use from 1st level.", () => {
  assert.deepEqual(grave(), { max: 1, used: 0 });
});

await test("A saved Charisma throw against 5 + the damage leaves them at 1 hit point and spends the use.", async () => {
  graveAt(5);
  // 10 damage: DC 15. A 20 and +3 make it.
  world.dice(20);
  const out = await hurt(sorcerer.id, 10);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.match(String(out.result?.strengthOfTheGrave ?? out.strengthOfTheGrave), /DC 15/);
  assert.equal(world.sheet(sorcerer.id).currentHp, 1);
  assert.equal(world.sheet(sorcerer.id).deathSaves, null);
  assert.equal(grave().used, 1);
});

await test("A failed throw lets them fall, and only a success spends the use.", async () => {
  graveAt(5);
  world.dice(1);
  await hurt(sorcerer.id, 10);
  world.clearDice();
  assert.equal(world.sheet(sorcerer.id).currentHp, 0);
  assert.equal(grave().used, 0);
});

await test("Radiant damage and a critical hit go past it, with no throw and the use kept.", async () => {
  graveAt(5);
  world.dice(20);
  await hurt(sorcerer.id, 10, { type: "radiant" });
  assert.equal(world.sheet(sorcerer.id).currentHp, 0, "radiant");
  assert.equal(grave().used, 0);
  graveAt(5);
  await hurt(sorcerer.id, 10, { crit: true });
  world.clearDice();
  assert.equal(world.sheet(sorcerer.id).currentHp, 0, "a critical hit");
  assert.equal(grave().used, 0);
});

await test("Killed outright, nothing holds and the use stays.", async () => {
  graveAt(5);
  world.dice(20);
  await hurt(sorcerer.id, 60);
  world.clearDice();
  assert.equal(world.sheet(sorcerer.id).currentHp, 0);
  assert.equal(grave().used, 0);
});

await test("With the use spent, the sorcerer falls.", async () => {
  graveAt(5, 1);
  world.dice(20);
  await hurt(sorcerer.id, 10);
  world.clearDice();
  assert.equal(world.sheet(sorcerer.id).currentHp, 0);
});

// ---- Blazing Revival ----

const druid = world.addHero({
  class: "druid", subclass: "Circle of Wildfire", level: 14, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
  portrait: { url: "/uploads/test.png" },
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: [] },
});
const revival = () => world.sheet(druid.id).resources.sub_blazing_revival;
const druidAt = (currentHp, { used = 0, spirit = true } = {}) =>
  world.patch(druid.id, {
    currentHp, deathSaves: null,
    conditions: spirit ? ["wildfire spirit"] : [], conditionMeta: {},
    resources: { ...world.sheet(druid.id).resources, sub_blazing_revival: { max: 1, used } },
  });

await test("A Wildfire druid of 14th level holds the one use.", () => {
  assert.deepEqual(revival(), { max: 1, used: 0 });
});

await test("With the spirit out, a drop brings the druid back at half their hit points, the spirit gone.", async () => {
  druidAt(5);
  const out = await hurt(druid.id, 30);
  assert.equal(out.ok, true, out.error);
  const sheet = world.sheet(druid.id);
  assert.equal(sheet.currentHp, 50);
  assert.equal(sheet.deathSaves, null);
  assert.ok(!sheet.conditions.includes("unconscious"), "on their feet");
  assert.ok(!sheet.conditions.includes("wildfire spirit"), "the spirit fell in their place");
  assert.equal(revival().used, 1);
});

await test("With no spirit out, the druid falls and the use stays.", async () => {
  druidAt(5, { spirit: false });
  await hurt(druid.id, 30);
  assert.equal(world.sheet(druid.id).currentHp, 0);
  assert.equal(revival().used, 0);
});

await test("Killed outright, the spirit stays and so does the use.", async () => {
  druidAt(5);
  await hurt(druid.id, 120);
  assert.equal(world.sheet(druid.id).currentHp, 0);
  assert.ok(world.sheet(druid.id).conditions.includes("wildfire spirit"));
  assert.equal(revival().used, 0);
});

await test("A Shield that turns the blow into a miss gives back the use, the spirit and the hit points.", async () => {
  await kit.fight(1, { heroFaces: { [druid.id]: 3 } });
  const [enemy] = world.enemies();
  druidAt(6);
  kit.freshRound();
  // 10 + 4 to hit: through AC 12, not through the 17 Shield makes it.
  world.dice(10, 6);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: druid.id });
  world.clearDice();
  assert.equal(world.sheet(druid.id).currentHp, 50, "revived by the blow");
  assert.equal(revival().used, 1);
  const out = await world.invoke("use_reaction", { characterId: druid.id, feature: "Shield" });
  assert.equal(out.ok, true, out.error);
  const sheet = world.sheet(druid.id);
  assert.equal(sheet.currentHp, 6);
  assert.equal(revival().used, 0);
  assert.ok(sheet.conditions.includes("wildfire spirit"), "the spirit is back");
  await kit.endFight();
});

await test("Neither is a card in the Hand: the server spends them.", () => {
  graveAt(30);
  druidAt(80);
  assert.equal(deriveHand(world.sheet(sorcerer.id), FRESH_TURN, {}).some((card) => card.name === "Strength of the Grave"), false);
  assert.equal(deriveHand(world.sheet(druid.id), FRESH_TURN, {}).some((card) => card.name === "Blazing Revival"), false);
});

world.close();
finish();
