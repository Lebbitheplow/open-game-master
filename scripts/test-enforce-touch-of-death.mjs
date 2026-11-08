// Touch of Death (Death Domain 2): "when you hit a creature with a melee attack,
// you can use Channel Divinity to deal extra necrotic damage equal to 5 + twice
// your cleric level." It is the one choice on the after-the-roll card that
// waits on a hit (src/lib/dm/after-roll-logic.ts).
//
// Before this it was a card in the Hand: played after the hit it spent the use
// and dealt nothing, since the attack had already landed.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-touch-of-death");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");

// A third-level cleric: +5 to hit with the mace (1d6+3), and 11 necrotic.
const hero = world.addHero({
  class: "cleric", level: 3, maxHp: 44, abilities: { str: 16, dex: 10 }, proficiencies: TRAINED,
  equipment: [{ name: "Mace", qty: 1, equipped: true }, { name: "Longbow", qty: 1, equipped: true }, { name: "Arrow", qty: 20 }],
});
const GEAR = world.sheet(hero.id).equipment;
const ally = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED });
const TOUCH = {
  features: [{ name: "Channel Divinity: Touch of Death", description: "" }],
  resources: { channel_divinity: { max: 1, used: 0 } },
};

async function stage(patch = TOUCH, enemyPatch = {}) {
  await kit.endFight();
  world.patch(hero.id, { currentHp: 44, tempHp: 0, conditions: [], feats: [], ...patch });
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [ally.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 15, ...enemyPatch });
  kit.place(hero.id, 5, 5);
  kit.place(ally.id, 2, 2);
  kit.place(enemy.id, 5, 6);
  return enemy;
}
const open = () => listOpenPendingRolls(world.campaignId);
const offered = () => (open()[0]?.thrown?.options ?? []).map((option) => option.id);
const used = () => world.sheet(hero.id).resources.channel_divinity.used;
const choose = (id, body) => {
  world.signIn({ id: world.sheet(hero.id).userId });
  return call(route, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
async function spend(pending, ...faces) {
  world.dice(...faces);
  const out = await choose(pending.id, { use: "touch_of_death" });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
}

await test("A melee hit waits, nothing is spent until they choose, and spending it adds 5 + twice the level.", async () => {
  const enemy = await stage();
  await kit.swing(hero.id, enemy.id, [15], { weapon: "Mace" });
  assert.deepEqual(offered(), ["touch_of_death"]);
  assert.match(open()[0].thrown.options[0].label, /add 11 necrotic/);
  assert.equal(used(), 0);
  assert.equal(kit.enemy(enemy.id).currentHp, 400, "the hit has not landed yet");
  const [pending] = open();
  await spend(pending, 4);
  assert.equal(used(), 1);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + 3 + 11));
  assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
  assert.match(getPendingRoll(pending.id).combatNote, /Touch of Death/);
});

await test("Keeping the roll lands the hit without it, and spends nothing.", async () => {
  const enemy = await stage();
  await kit.swing(hero.id, enemy.id, [15], { weapon: "Mace" });
  const [pending] = open();
  world.dice(4);
  const out = await choose(pending.id, { keep: true });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(used(), 0);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7);
});

await test("A critical doubles the dice and not the necrotic.", async () => {
  const enemy = await stage();
  await kit.swing(hero.id, enemy.id, [20], { weapon: "Mace" });
  const [pending] = open();
  await spend(pending, 4, 2);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + 2 + 3 + 11));
});

await test("The necrotic meets its own type: resistance to it halves that part alone, and immunity stops it.", async () => {
  const resistant = await stage(TOUCH, { stats: { resist: "necrotic" } });
  await kit.swing(hero.id, resistant.id, [15], { weapon: "Mace" });
  await spend(open()[0], 4);
  assert.equal(kit.enemy(resistant.id).currentHp, 400 - (7 + 5));
  const immune = await stage(TOUCH, { stats: { immune: "necrotic" } });
  await kit.swing(hero.id, immune.id, [15], { weapon: "Mace" });
  await spend(open()[0], 4);
  assert.equal(kit.enemy(immune.id).currentHp, 400 - 7);
});

await test("Nothing waits on a miss, a ranged hit or with no Channel Divinity left.", async () => {
  const missed = await stage();
  await kit.swing(hero.id, missed.id, [3], { weapon: "Mace" });
  assert.equal(open().length, 0, "it needs a hit");
  const far = await stage();
  kit.place(far.id, 5, 9);
  await kit.swing(hero.id, far.id, [15, 3], { weapon: "Longbow" });
  assert.equal(open().length, 0, "it needs a melee attack");
  assert.equal(used(), 0);
  const spent = await stage({ ...TOUCH, resources: { channel_divinity: { max: 1, used: 1 } } });
  await kit.swing(hero.id, spent.id, [15, 3], { weapon: "Mace" });
  assert.equal(open().length, 0, "no use left");
});

await test("A melee attack spell waits and takes it. A ranged one cast from beside the creature does not.", async () => {
  const SPELLS = { ability: "str", slots: { 1: { max: 2, used: 0 } }, known: [], prepared: ["Inflict Wounds"], cantrips: ["Fire Bolt"] };
  const enemy = await stage({ ...TOUCH, spellcasting: SPELLS, equipment: [] });
  world.dice(15);
  const cast = await world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Inflict Wounds", level: 1, damage: "3d10" });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.deepEqual(offered(), ["touch_of_death"]);
  await spend(open()[0], 5, 5, 5);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - (15 + 11));
  const beside = await stage({ ...TOUCH, spellcasting: SPELLS, equipment: [] });
  world.dice(15, 5);
  const bolt = await world.invoke("pc_attack", { characterId: hero.id, enemyId: beside.id, targetEnemyId: beside.id, spell: "Fire Bolt", damage: "1d10" });
  world.clearDice();
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(open().length, 0);
  world.patch(hero.id, { spellcasting: null, equipment: GEAR });
});

await test("A monk's Touch of Death, a different feature, opens nothing.", async () => {
  const enemy = await stage({ features: [{ name: "Touch of Death", description: "" }], resources: { channel_divinity: { max: 1, used: 0 } } });
  await kit.swing(hero.id, enemy.id, [15, 3], { weapon: "Mace" });
  assert.equal(open().length, 0);
});

await test("It is not a card in the Hand, and use_resource still takes it for a roll that cannot wait.", async () => {
  await kit.endFight();
  world.patch(hero.id, TOUCH);
  const names = deriveHand(world.sheet(hero.id), FRESH_TURN, {}).map((card) => card.name);
  assert.ok(!names.includes("Touch of Death"), names.join(", "));
  const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Channel Divinity", variant: "touch of death" });
  assert.equal(out.ok, true, out.error);
  assert.equal(used(), 1);
});

world.close();
finish();
