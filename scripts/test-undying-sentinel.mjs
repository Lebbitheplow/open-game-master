// Undying Sentinel (Oath of the Ancients 15): "once per long rest, drop to 1 hit
// point instead of 0". Nothing read its counter: the paladin fell with the use
// unspent, and the Hand's card cost an action to spend it for nothing.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-undying-sentinel");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");

const hero = world.addHero({
  class: "paladin", subclass: "Oath of the Ancients", level: 15, maxHp: 100, proficiencies: TRAINED,
  portrait: { url: "/uploads/test.png" },
});
const counter = () => world.sheet(hero.id).resources.sub_undying_sentinel;
const set = (currentHp, used = 0) =>
  world.patch(hero.id, { currentHp, deathSaves: null, conditions: [], conditionMeta: {}, resources: { ...world.sheet(hero.id).resources, sub_undying_sentinel: { max: 1, used } } });
const hurt = (amount) => world.invoke("apply_damage", { characterId: hero.id, amount, type: "slashing" });

await test("A level 15 paladin of the oath holds the one use, unprompted.", () => {
  assert.deepEqual(counter(), { max: 1, used: 0 });
});

await test("Damage that would drop the paladin leaves them at 1 hit point and spends the use.", async () => {
  set(5);
  const out = await hurt(30);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).currentHp, 1);
  assert.equal(counter().used, 1);
  assert.equal(world.sheet(hero.id).deathSaves, null);
});

await test("With the use spent, the paladin falls.", async () => {
  set(5, 1);
  await hurt(30);
  assert.equal(world.sheet(hero.id).currentHp, 0);
});

await test("Damage that would not drop the paladin leaves the use alone.", async () => {
  set(50);
  await hurt(10);
  assert.equal(world.sheet(hero.id).currentHp, 40);
  assert.equal(counter().used, 0);
});

await test("Killed outright, it does not hold, and the use stays.", async () => {
  set(5);
  await hurt(120);
  assert.equal(world.sheet(hero.id).currentHp, 0);
  assert.equal(counter().used, 0);
});

// A hold returned before the concentration save, so a concentrating hero
// held at 1 hit point kept the spell with no save at all.
await test("Held at 1 hit point, the paladin still makes the concentration save.", async () => {
  set(5);
  world.patch(hero.id, { concentratingOn: "Bless" });
  world.dice(1);
  const out = await hurt(30);
  world.clearDice();
  assert.equal(world.sheet(hero.id).currentHp, 1);
  assert.equal(out.result.concentration?.held, false, JSON.stringify(out));
  assert.equal(world.sheet(hero.id).concentratingOn, null);
});

await test("Death Ward's hold makes the concentration save too.", async () => {
  set(5, 1);
  world.patch(hero.id, { concentratingOn: "Bless", conditions: ["death ward"], conditionMeta: {} });
  world.dice(1);
  const out = await hurt(30);
  world.clearDice();
  assert.equal(out.result.deathWard, true);
  assert.equal(world.sheet(hero.id).currentHp, 1);
  assert.equal(world.sheet(hero.id).concentratingOn, null);
});

await test("An enemy's hit is held the same way.", async () => {
  set(1);
  await kit.fight(1, { heroFaces: { [hero.id]: 19 } });
  const [enemy] = world.enemies();
  kit.freshRound();
  world.dice(19, 6);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).currentHp, 1);
  assert.equal(counter().used, 1);
  await kit.endFight();
});

await test("A Shield that turns the blow into a miss gives the use back with the hit points.", async () => {
  const warded = world.addHero({
    class: "paladin", subclass: "Oath of the Ancients", level: 15, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    portrait: { url: "/uploads/test.png" },
    spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: [] },
  });
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [warded.id]: 3 } });
  const [enemy] = world.enemies();
  world.patch(warded.id, { currentHp: 6 });
  kit.freshRound();
  // 10 + 4 to hit: through AC 12, not through the 17 Shield makes it.
  world.dice(10, 6);
  await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: warded.id });
  world.clearDice();
  assert.equal(world.sheet(warded.id).currentHp, 1);
  assert.equal(world.sheet(warded.id).resources.sub_undying_sentinel.used, 1);
  const out = await world.invoke("use_reaction", { characterId: warded.id, feature: "Shield" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(warded.id).currentHp, 6);
  assert.equal(world.sheet(warded.id).resources.sub_undying_sentinel.used, 0);
  await kit.endFight();
});

await test("It is no card in the Hand, and a level below it holds nothing.", async () => {
  set(50);
  assert.equal(deriveHand(world.sheet(hero.id), FRESH_TURN, {}).some((card) => card.name === "Undying Sentinel"), false);
  const young = world.addHero({ class: "paladin", subclass: "Oath of the Ancients", level: 14, maxHp: 100 });
  world.patch(young.id, { currentHp: 5 });
  await world.invoke("apply_damage", { characterId: young.id, amount: 30, type: "slashing" });
  assert.equal(world.sheet(young.id).currentHp, 0);
});

world.close();
finish();
