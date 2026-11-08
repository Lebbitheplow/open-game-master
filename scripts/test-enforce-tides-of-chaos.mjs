// Tides of Chaos (Wild Magic sorcerer, 1st level): "you can manipulate the
// forces of chance and chaos to gain advantage on one attack roll, ability
// check, or saving throw" (subclasses.json). Its card used to spend the use
// and leave nothing behind, so the next attack was a straight roll. Played
// now, it leaves a one-shot carrier for the kind of roll the player picked
// (attack, check or save, the way Drunkard's Luck does), and the first roll
// of that kind takes the advantage and spends it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-tides-of-chaos");
const world = await openWorld();
const kit = await combatKit(world);

const sorcerer = world.addHero({
  class: "sorcerer", subclass: "Wild Magic", level: 3, abilities: { dex: 14, con: 14, cha: 16 },
  maxHp: 60, proficiencies: TRAINED, equipment: [{ name: "Dagger", qty: 1, equipped: true }],
});
const ally = world.addHero({ class: "fighter", level: 3, abilities: { str: 16 }, proficiencies: TRAINED });

async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [sorcerer.id]: 19, [ally.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300 });
  kit.place(sorcerer.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const resources = world.sheet(sorcerer.id).resources;
  world.patch(sorcerer.id, { conditions: [], conditionMeta: {}, resources: { ...resources, sub_tides_of_chaos: { ...resources.sub_tides_of_chaos, used: 0 } } });
  kit.giveTurn(sorcerer.id);
  return enemy;
}

const tides = (variant) =>
  world.invoke("use_resource", { characterId: sorcerer.id, resource: "Tides of Chaos", ...(variant ? { variant } : {}) });
const usedOf = () => world.sheet(sorcerer.id).resources.sub_tides_of_chaos?.used ?? 0;
const carriers = () => world.sheet(sorcerer.id).conditions.filter((entry) => /tides of chaos/i.test(entry));

async function save(faces) {
  world.dice(...faces);
  const out = await world.invoke("request_roll", { characterId: sorcerer.id, kind: "saving_throw", ability: "con", dc: 30 });
  const unused = world.clearDice();
  assert.equal(out.ok, true, out.error);
  return { out, thrown: faces.length - unused };
}

await test("played for an attack: the next attack rolls two d20s and keeps the higher, and the one after is a straight roll", async () => {
  const enemy = await stage();
  const out = await tides("attack");
  assert.equal(out.ok, true, out.error);
  assert.equal(usedOf(), 1, "the one use is spent");
  assert.equal(carriers().length, 1, "the advantage waits on the sheet");
  const first = await kit.swing(sorcerer.id, enemy.id, [4, 15, 3, 3, 3], { weapon: "Dagger" });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.toHit.advantage, "advantage");
  assert.deepEqual(d20Faces(first.toHit), [4, 15]);
  assert.equal(first.toHit.breakdown.natural, 15);
  assert.deepEqual(carriers(), [], "the attack spent it");
  kit.freshTurn();
  const second = await kit.swing(sorcerer.id, enemy.id, [4, 15, 3, 3, 3], { weapon: "Dagger" });
  assert.equal(second.ok, true, second.error);
  assert.equal(d20Faces(second.toHit).length, 1, "one roll, not every roll");
});

await test("played with no kind of roll named, it asks which and spends nothing", async () => {
  await stage();
  const out = await tides();
  assert.equal(out.ok, false);
  assert.match(String(out.error), /attack.*check.*save/i, out.error);
  assert.equal(usedOf(), 0);
  assert.deepEqual(carriers(), []);
});

await test("played for a save: the next saving throw has advantage and spends it, and an attack in between leaves it", async () => {
  const enemy = await stage();
  assert.equal((await tides("save")).ok, true);
  const swing = await kit.swing(sorcerer.id, enemy.id, [4, 15, 3, 3, 3], { weapon: "Dagger" });
  assert.equal(d20Faces(swing.toHit).length, 1, "an attack is not what it was played for");
  assert.equal(carriers().length, 1);
  const first = await save([4, 17]);
  assert.equal(first.thrown, 2, "two d20s");
  assert.equal(first.out.result.total, 17 + 2, "the higher kept, +2 Constitution");
  assert.deepEqual(carriers(), []);
  const second = await save([4, 17]);
  assert.equal(second.thrown, 1, "the next save is a straight roll");
});

await test("played for a check: the next ability check has advantage and spends it", async () => {
  await stage();
  assert.equal((await tides("check")).ok, true);
  world.dice(3, 16);
  const out = await world.invoke("request_roll", { characterId: sorcerer.id, kind: "ability_check", ability: "dex", skill: "acrobatics", dc: 30 });
  const unused = world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(unused, 0, "two d20s");
  assert.deepEqual(carriers(), []);
});

await test("a second use before a long rest (or a surge) is refused, and nothing is laid", async () => {
  await stage();
  assert.equal((await tides("attack")).ok, true);
  world.patch(sorcerer.id, { conditions: [], conditionMeta: {} });
  const again = await tides("attack");
  assert.equal(again.ok, false, "one use");
  assert.deepEqual(carriers(), []);
});

await finish();
