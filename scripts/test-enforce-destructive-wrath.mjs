// Destructive Wrath (Tempest Domain 2): "When you roll lightning or thunder
// damage, you can use your Channel Divinity to deal maximum damage, instead of
// rolling" (src/lib/dm/destructive-wrath.ts).
//
// Before this the card in the Hand spent the use and changed nothing. Now the
// use is held on the sheet and the next lightning or thunder damage uses it.
import assert from "node:assert/strict";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-destructive-wrath");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");

const hero = world.addHero(caster("cleric", "wis", ["Shatter", "Burning Hands"], ["Shocking Grasp"], 5, { maxHp: 44 }));
const SPELLCASTING = world.sheet(hero.id).spellcasting;
const ally = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED });
const OPTION = { features: [{ name: "Channel Divinity: Destructive Wrath", description: "" }], resources: { channel_divinity: { max: 2, used: 0 } } };

async function stage(patch = OPTION) {
  await kit.endFight();
  world.patch(hero.id, { currentHp: 44, tempHp: 0, conditions: [], conditionMeta: {}, spellcasting: SPELLCASTING, ...patch });
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [ally.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 10, saveMods: { str: -9, dex: -9, con: -9, int: -9, wis: -9, cha: -9 } });
  kit.place(hero.id, 5, 5);
  kit.place(ally.id, 2, 2);
  kit.place(enemy.id, 5, 6);
  return enemy;
}
const hold = () => world.invoke("use_resource", { characterId: hero.id, resource: "Channel Divinity", variant: "destructive wrath" });
const holds = () => world.sheet(hero.id).conditions.includes("destructive wrath");
const used = () => world.sheet(hero.id).resources.channel_divinity.used;
const lost = (enemy) => 400 - kit.enemy(enemy.id).currentHp;

await test("The card holds it, the use is spent, and a second is refused with nothing spent.", async () => {
  await stage();
  const first = await hold();
  assert.equal(first.ok, true, first.error);
  assert.equal(used(), 1);
  assert.equal(holds(), true);
  const second = await hold();
  assert.equal(second.ok, false);
  assert.equal(used(), 1);
});

await test("The card is in the Hand until it is held.", async () => {
  await stage();
  const names = () => deriveHand(world.sheet(hero.id), FRESH_TURN, {}).map((card) => card.name);
  assert.ok(names().includes("Destructive Wrath"), names().join(", "));
  await hold();
  assert.ok(!names().includes("Destructive Wrath"));
});

await test("A sheet without the option is refused, with nothing spent.", async () => {
  await stage({ features: [], resources: { channel_divinity: { max: 2, used: 0 } } });
  const out = await hold();
  assert.equal(out.ok, false);
  assert.equal(used(), 0);
  assert.equal(holds(), false);
});

await test("An area spell of its type deals its dice's maximum and ends the hold. Without it the dice are rolled.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(2);
  const out = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Shatter", level: 2, enemyIds: [enemy.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(enemy), 24, "Shatter's 3d8 at their maximum");
  assert.match(JSON.stringify(out), /Destructive Wrath: maximum/);
  assert.equal(holds(), false);
  const plain = await stage();
  world.dice(1, 1, 1, 1);
  const rolled = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Shatter", level: 2, enemyIds: [plain.id] });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  assert.ok(lost(plain) < 24, `rolled ${lost(plain)}`);
});

await test("cast_at_enemy reaches it too.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(2);
  const out = await world.invoke("cast_at_enemy", { characterId: hero.id, targetEnemyId: enemy.id, spell: "Shatter", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(enemy), 24);
  assert.equal(holds(), false);
});

await test("Another type's spell leaves the hold in place.", async () => {
  const enemy = await stage();
  await hold();
  const out = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Burning Hands", level: 1, enemyIds: [enemy.id] });
  assert.equal(out.ok, true, out.error);
  assert.equal(holds(), true);
  assert.doesNotMatch(JSON.stringify(out), /Destructive Wrath/);
});

await test("An attack spell of its type deals its maximum on a hit, and a miss keeps the hold.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(2);
  const missed = await world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Shocking Grasp", damage: "1d8" });
  world.clearDice();
  assert.equal(missed.ok, true, missed.error);
  assert.equal(lost(enemy), 0);
  assert.equal(holds(), true, "no damage was rolled");
  const again = await stage();
  await hold();
  world.dice(18);
  const hit = await world.invoke("pc_attack", { characterId: hero.id, enemyId: again.id, targetEnemyId: again.id, spell: "Shocking Grasp", damage: "1d8" });
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  assert.equal(lost(again), 16, "Shocking Grasp at 5th level is 2d8, at its maximum");
  assert.equal(holds(), false);
});

await test("A critical's doubled dice are at their maximum too.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(20);
  const out = await world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Shocking Grasp", damage: "1d8" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(enemy), 32, "2d8 doubled is 4d8, at its maximum");
});

await test("A rest ends the hold.", async () => {
  await stage();
  await hold();
  await kit.endFight();
  const out = await world.invoke("take_rest", { kind: "short", reason: "breath" });
  assert.equal(out.ok, true, out.error);
  assert.equal(holds(), false);
});

world.close();
finish();
