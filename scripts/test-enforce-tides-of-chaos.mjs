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
  spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: ["Shield", "Mage Armor"], cantrips: ["Fire Bolt"] },
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

// "Any time before you regain the use of this feature, the DM can have you
// roll on the Wild Magic Surge table immediately after you cast a sorcerer
// spell of 1st level or higher. You then regain the use." The GM had no way
// to give the use back: update_sheet refuses counters, and no tool restored it.
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const surge = () => world.invoke("use_resource", { characterId: sorcerer.id, resource: "Wild Magic Surge" });
const cast = async (spell, level) => {
  kit.freshTurn();
  const out = await world.invoke("use_spell_slot", { characterId: sorcerer.id, spell, ...(level ? { level } : {}) });
  assert.equal(out.ok, true, out.error);
  return out;
};
const chance = () => world.sheet(sorcerer.id).conditions.includes("surge chance");

await test("after a sorcerer spell of 1st level or higher the GM's Wild Magic Surge gives a spent Tides of Chaos back, once, with no card in the player's Hand", async () => {
  await stage();
  world.patch(sorcerer.id, { spellcasting: { ...world.sheet(sorcerer.id).spellcasting, slots: { 1: { max: 4, used: 0 } } } });
  assert.equal((await tides("attack")).ok, true);
  assert.equal(usedOf(), 1);
  const early = await surge();
  assert.equal(early.ok, false, "a surge with no spell cast gave the use back");
  assert.match(String(early.error), /right after a sorcerer spell/);
  assert.equal(usedOf(), 1);
  const shield = await cast("Mage Armor", 1);
  assert.match(String(shield.result.wildMagicSurge), /Wild Magic Surge/, "the GM is not told the surge may give the use back");
  assert.ok(chance(), "the casting left no chance for the surge");
  assert.equal(deriveHand(world.sheet(sorcerer.id), FRESH_TURN, {}).some((card) => card.name === "Wild Magic Surge"), false, "the GM's call is a card in the player's Hand");
  const back = await surge();
  assert.equal(back.ok, true, back.error);
  assert.equal(usedOf(), 0, "the use came back");
  assert.equal(chance(), false, "the chance is spent with it");
  assert.equal((await surge()).ok, false, "one casting gives one use back");
});

// "After casting a sorcerer spell of 1st level or higher, the GM may have you
// roll a d20; on a 1 you roll on the wild magic table" (Wild Magic Surge,
// src/lib/srd/subclasses.json): the GM's call is open after every such
// casting, whether Tides of Chaos is spent or not. This test held that no
// chance was left while Tides still had its use, from when the surge was only
// the way to give that use back and rolled nothing
// (src/lib/dm/ar-ws-wild-surge.ts).
await test("a casting leaves the surge's chance while Tides of Chaos still has its use, and the surge then rolls the sorcerer's d20", async () => {
  await stage();
  world.patch(sorcerer.id, { spellcasting: { ...world.sheet(sorcerer.id).spellcasting, slots: { 1: { max: 4, used: 0 } } } });
  const out = await cast("Mage Armor", 1);
  assert.match(String(out.result.wildMagicSurge), /roll a d20/);
  assert.equal(chance(), true);
  world.dice(7);
  const rolled = await surge();
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  assert.deepEqual([rolled.result.d20, rolled.result.surge ?? null, chance(), usedOf()], [7, null, false, 0], "[the d20, a surge, the chance left, Tides of Chaos spent]");
});

await finish();
