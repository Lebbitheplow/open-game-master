// Three features chosen after the d20, on the card a roll waits on
// (src/lib/dm/after-roll-logic.ts):
//
//   Guided Strike (War Domain, Oath of Conquest): +10 to the attack, for a use
//   of Channel Divinity. Offered only where the 10 turns the miss.
//   Master Duelist (Swashbuckler 17): a missed attack is rolled again with
//   advantage, and the new roll stands.
//   Favored by the Gods (Divine Soul 1): 2d4 on a missed attack or a failed
//   save. Offered only where 8 could turn it.
//
// Before this all three were cards in the Hand: played after the miss they spent
// the use and changed nothing, since the attack had already landed.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-after-roll-riders");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getRoll } = await import("../src/lib/db/rolls.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");

// A fifth-level fighter: +6 to hit with the longsword. The goblin's AC is 15.
const hero = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 10 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const ally = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
const feature = (name) => ({ name, description: "" });
const SPELLS = { ability: "str", slots: {}, known: [], prepared: [], cantrips: ["Shocking Grasp"] };
const GUIDED = { features: [feature("Channel Divinity: Guided Strike")], resources: { channel_divinity: { max: 2, used: 0 } } };
const DUELIST = { features: [feature("Master Duelist")], resources: { sub_master_duelist: { max: 1, used: 0 } } };
const FAVORED = { features: [feature("Favored by the Gods")], resources: { sub_favored_by_the_gods: { max: 1, used: 0 } } };

async function stage(patch, ac = 15) {
  await kit.endFight();
  world.patch(hero.id, { currentHp: 44, tempHp: 0, conditions: [], feats: [], ...patch });
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [ally.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac });
  kit.place(hero.id, 5, 5);
  kit.place(ally.id, 2, 2);
  kit.place(enemy.id, 5, 6);
  return enemy;
}
const open = () => listOpenPendingRolls(world.campaignId);
const offered = () => (open()[0]?.thrown?.options ?? []).map((option) => option.id);
const choose = (id, body) => {
  world.signIn({ id: world.sheet(hero.id).userId });
  return call(route, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
async function spend(pending, use, ...faces) {
  world.dice(...faces);
  const out = await choose(pending.id, { use });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
}
const usedOf = (id) => world.sheet(hero.id).resources[id].used;
const landed = (pending) => getRoll(getPendingRoll(pending.id).rollId);

await test("Guided Strike: a miss the 10 turns waits, and spending it adds 10, spends a use and lands the hit.", async () => {
  const enemy = await stage(GUIDED);
  await kit.swing(hero.id, enemy.id, [5]);
  assert.deepEqual(offered(), ["guided_strike"]);
  assert.equal(usedOf("channel_divinity"), 0, "nothing is spent until they choose");
  const [pending] = open();
  await spend(pending, "guided_strike", 4);
  assert.equal(landed(pending).total, 21);
  assert.equal(usedOf("channel_divinity"), 1);
  assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7);
});

await test("Guided Strike waits for nothing on a natural 1, a miss by more than 10, or with no Channel Divinity left.", async () => {
  const nat1 = await stage(GUIDED);
  await kit.swing(hero.id, nat1.id, [1]);
  assert.equal(open().length, 0, "a natural 1 misses whatever is added");
  const armored = await stage(GUIDED, 30);
  await kit.swing(hero.id, armored.id, [5]);
  assert.equal(open().length, 0, "11 + 10 never reaches AC 30");
  const spent = await stage({ ...GUIDED, resources: { channel_divinity: { max: 2, used: 2 } } });
  await kit.swing(hero.id, spent.id, [5]);
  assert.equal(open().length, 0, "no use left");
  assert.equal(usedOf("channel_divinity"), 2);
});

await test("Master Duelist: the attack is rolled again with advantage, even on a natural 1, and the new roll stands.", async () => {
  const enemy = await stage(DUELIST);
  await kit.swing(hero.id, enemy.id, [1]);
  assert.deepEqual(offered(), ["master_duelist"]);
  const [pending] = open();
  await spend(pending, "master_duelist", 4, 18, 5);
  assert.equal(landed(pending).total, 24, "the higher of the two, plus 6");
  assert.equal(usedOf("sub_master_duelist"), 1);
  assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
});

await test("Master Duelist: a reroll that still misses lands as a miss, and asks nothing more.", async () => {
  const enemy = await stage(DUELIST);
  await kit.swing(hero.id, enemy.id, [5]);
  const [pending] = open();
  await spend(pending, "master_duelist", 2, 3);
  assert.equal(open().length, 0);
  assert.equal(landed(pending).total, 9);
  assert.match(getPendingRoll(pending.id).combatNote, /MISS/);
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
});

await test("Master Duelist: disadvantage on the attack cancels the advantage, so one d20 is thrown.", async () => {
  const enemy = await stage(DUELIST);
  await kit.swing(hero.id, enemy.id, [3, 5], { advantage: "disadvantage" });
  const [pending] = open();
  assert.equal(pending.advantage, "disadvantage");
  await spend(pending, "master_duelist", 2);
  assert.equal(landed(pending).total, 8, "the one fresh die stands");
  assert.match(getPendingRoll(pending.id).combatNote, /MISS/);
});

await test("Master Duelist: an elf with Elven Accuracy throws three d20s on the advantage it gives a Dexterity attack.", async () => {
  const plain = { abilities: world.sheet(hero.id).abilities, equipment: world.sheet(hero.id).equipment };
  const enemy = await stage({ ...DUELIST, feats: ["Elven Accuracy"], abilities: { ...plain.abilities, dex: 18 }, equipment: [{ name: "Rapier", qty: 1, equipped: true }] });
  try {
    // +7 with the rapier: 3 + 7 misses AC 15.
    await kit.swing(hero.id, enemy.id, [3], { weapon: "Rapier" });
    const [pending] = open();
    assert.deepEqual(offered(), ["master_duelist"]);
    await spend(pending, "master_duelist", 2, 3, 19);
    assert.equal(landed(pending).breakdown.terms[0].dice.length, 3, "the third d20 is Elven Accuracy's");
    assert.equal(landed(pending).total, 26);
    assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
  } finally {
    world.patch(hero.id, plain);
  }
});

await test("Favored by the Gods on an attack: 2d4 is added and can turn the miss.", async () => {
  const enemy = await stage(FAVORED);
  await kit.swing(hero.id, enemy.id, [5]);
  assert.deepEqual(offered(), ["favored_by_the_gods"]);
  const [pending] = open();
  await spend(pending, "favored_by_the_gods", 2, 3, 4);
  assert.equal(landed(pending).total, 16);
  assert.equal(usedOf("sub_favored_by_the_gods"), 1);
  assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
});

await test("Favored by the Gods waits on a miss 8 can turn, and not on a natural 1 or a miss by more.", async () => {
  const nat1 = await stage(FAVORED);
  await kit.swing(hero.id, nat1.id, [1]);
  assert.equal(open().length, 0);
  // 2 + 6 + 8 reaches AC 15: the edge.
  const edge = await stage(FAVORED);
  await kit.swing(hero.id, edge.id, [2]);
  assert.deepEqual(offered(), ["favored_by_the_gods"]);
  await choose(open()[0].id, { keep: true });
  const armored = await stage(FAVORED, 17);
  await kit.swing(hero.id, armored.id, [2]);
  assert.equal(open().length, 0, "8 + 8 never reaches AC 17");
  assert.equal(usedOf("sub_favored_by_the_gods"), 0);
});

await test("Favored by the Gods on a failed save: it waits and adds 2d4, and a check does not offer it.", async () => {
  await kit.endFight();
  world.patch(hero.id, { conditions: [], feats: [], ...FAVORED });
  const roll = (kind) => world.invoke("request_roll", { characterId: hero.id, kind, ability: "wis", dc: 15, reason: "the gate" });
  world.dice(9);
  await roll("saving_throw");
  world.clearDice();
  assert.deepEqual(offered(), ["favored_by_the_gods"]);
  const [pending] = open();
  const before = pending.thrown.outcome.total;
  await spend(pending, "favored_by_the_gods", 4, 4);
  assert.equal(landed(pending).total, before + 8);
  assert.equal(usedOf("sub_favored_by_the_gods"), 1);
  world.patch(hero.id, FAVORED);
  world.dice(9);
  await roll("ability_check");
  world.clearDice();
  assert.equal(open().length, 0, "the feature names saves and attacks");
});

await test("An attack spell waits too: a missed one takes Master Duelist, and the new roll can hit.", async () => {
  const enemy = await stage({ features: [feature("Master Duelist"), feature("Favored by the Gods")], resources: { sub_master_duelist: { max: 1, used: 0 }, sub_favored_by_the_gods: { max: 1, used: 0 } }, spellcasting: SPELLS });
  world.dice(5);
  const cast = await world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Shocking Grasp", damage: "1d8" });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  const ids = offered();
  assert.ok(ids.includes("master_duelist"), ids.join(", "));
  const [pending] = open();
  await spend(pending, "master_duelist", 19, 18, 4, 4);
  assert.equal(usedOf("sub_master_duelist"), 1);
  assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
  world.patch(hero.id, { spellcasting: null });
});

// WAVE1 R10: "A pool spent only through a named option or another tool
// (... Favored by the Gods ...) refuses a bare use_resource spend with a
// pointer to the right call, spending nothing." A bare spend had no roll on
// record to change, so it burned the use for nothing; Master Duelist is the
// same shape (the gap sweep's SPENT_FOR_NOTHING).
await test("None of the three is a card in the Hand, and a bare use_resource of one is refused with nothing spent: the roll's own card spends it.", async () => {
  await kit.endFight();
  world.patch(hero.id, {
    features: [feature("Channel Divinity: Guided Strike"), feature("Master Duelist"), feature("Favored by the Gods")],
    resources: { channel_divinity: { max: 2, used: 0 }, sub_master_duelist: { max: 1, used: 0 }, sub_favored_by_the_gods: { max: 1, used: 0 } },
  });
  const names = deriveHand(world.sheet(hero.id), FRESH_TURN, {}).map((card) => card.name);
  for (const name of ["Guided Strike", "Master Duelist", "Favored by the Gods"]) {
    assert.ok(!names.includes(name), name);
  }
  for (const [resource, id] of [["Master Duelist", "sub_master_duelist"], ["Favored by the Gods", "sub_favored_by_the_gods"]]) {
    const out = await world.invoke("use_resource", { characterId: hero.id, resource });
    assert.notEqual(out.ok, true, resource);
    assert.equal(usedOf(id), 0, resource);
  }
});

world.close();
finish();
