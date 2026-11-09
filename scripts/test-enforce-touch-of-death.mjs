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
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getRoll } = await import("../src/lib/db/rolls.ts");
const { keepAfterRollWhenDue } = await import("../src/lib/dm/after-roll-timer.ts");
const { subscribe } = await import("../src/lib/events.ts");

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
  // Inescapable Destruction (Death Domain 6): the cleric's necrotic ignores resistance.
  const ignored = await stage({ ...TOUCH, features: [...TOUCH.features, { name: "Inescapable Destruction", description: "" }] }, { stats: { resist: "necrotic" } });
  await kit.swing(hero.id, ignored.id, [15], { weapon: "Mace" });
  await spend(open()[0], 4);
  assert.equal(kit.enemy(ignored.id).currentHp, 400 - (7 + 11));
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

await test("Real dice: a hit entered at the table waits, and the necrotic rides the damage the player rolls.", async () => {
  const enemy = await stage();
  setMemberRealDice(world.campaignId, world.sheet(hero.id).userId, true);
  try {
    await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, weapon: "Mace" });
    const toHit = open().find((entry) => entry.kind === "attack");
    assert.equal(toHit.parkedFor, "real_dice");
    world.signIn({ id: world.sheet(hero.id).userId });
    const entered = await call(submitRoute, "POST", { dice: [15] }, { campaignId: world.campaignId, pendingRollId: toHit.id });
    assert.equal(entered.status, 200, JSON.stringify(entered.json));
    assert.deepEqual(getPendingRoll(toHit.id).thrown.options.map((option) => option.id), ["touch_of_death"]);
    assert.equal(used(), 0);
    const chose = await choose(toHit.id, { use: "touch_of_death" });
    assert.equal(chose.status, 200, JSON.stringify(chose.json));
    assert.match(getRoll(getPendingRoll(toHit.id).rollId).detail, /\(physical\)/, "no die was thrown for them: the roll is still theirs");
    assert.equal(used(), 1);
    const damage = open().find((entry) => entry.kind === "damage");
    assert.ok(damage, "the hit asks the player for damage");
    assert.match(damage.expression, /\+11/);
    const rolled = await call(submitRoute, "POST", { dice: [4] }, { campaignId: world.campaignId, pendingRollId: damage.id });
    assert.equal(rolled.status, 200, JSON.stringify(rolled.json));
    assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + 3 + 11));
  } finally {
    setMemberRealDice(world.campaignId, world.sheet(hero.id).userId, false);
  }
});

await test("Its time running out lands the hit without it, and spends nothing.", async () => {
  // Someone else at the table, so the wait runs on the clock (after-roll-timer.ts).
  const online = subscribe(world.campaignId, () => {}, world.sheet(ally.id).userId);
  try {
    const enemy = await stage();
    await kit.swing(hero.id, enemy.id, [15], { weapon: "Mace" });
    const [pending] = open();
    assert.ok(pending.thrown.deadline);
    world.dice(4);
    assert.equal(await keepAfterRollWhenDue(pending.id, new Date(pending.thrown.deadline).getTime() + 1), true);
    world.clearDice();
    assert.equal(used(), 0);
    assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7);
  } finally {
    online();
  }
});

await test("A Parry that turns the hit as it lands spends nothing: the use is paid by the hit.", async () => {
  const PARRY = "Reaction: Parry. The captain adds 2 to its AC against one melee attack that would hit it. To do so, the captain must see the attacker and be wielding a melee weapon.";
  const enemy = await stage(TOUCH, { stats: { traits: [PARRY] } });
  // 10 + 5 meets AC 15 as it stands; the Parry's +2 turns it.
  await kit.swing(hero.id, enemy.id, [10], { weapon: "Mace" });
  const [pending] = open();
  assert.deepEqual(offered(), ["touch_of_death"]);
  await spend(pending);
  assert.match(getPendingRoll(pending.id).combatNote, /MISS/);
  assert.equal(used(), 0, "the Channel Divinity was spent on a hit that never landed");
  assert.equal(kit.enemy(enemy.id).currentHp, 400);
});

await test("An ally's War God's Blessing is offered on a miss only; the hit it makes then offers Touch of Death, even after the roller kept the miss.", async () => {
  const BLESSING = { features: [{ name: "Channel Divinity: War God's Blessing", description: "" }], resources: { channel_divinity: { max: 1, used: 0 } } };
  world.patch(ally.id, BLESSING);
  // The ally's player is at the table: a helper who is away is not waited on.
  const online = subscribe(world.campaignId, () => {}, world.sheet(ally.id).userId);
  try {
    const hit = await stage();
    await kit.swing(hero.id, hit.id, [15], { weapon: "Mace" });
    assert.deepEqual(offered(), ["touch_of_death"], "a hit offers the ally nothing");
    await spend(open()[0], 4);
    assert.equal(kit.enemy(hit.id).currentHp, 400 - (4 + 3 + 11));
    world.patch(ally.id, BLESSING);
    const enemy = await stage();
    await kit.swing(hero.id, enemy.id, [5], { weapon: "Mace" });
    const [pending] = open();
    assert.deepEqual(offered(), ["war_gods_blessing"], "a miss offers no Touch of Death");
    const kept = await choose(pending.id, { keep: true });
    assert.equal(kept.status, 200, JSON.stringify(kept.json));
    assert.equal(getPendingRoll(pending.id).status, "pending", "the roll waits on the ally");
    world.signIn({ id: world.sheet(ally.id).userId });
    const blessed = await call(route, "POST", { use: "war_gods_blessing", by: ally.id }, { campaignId: world.campaignId, pendingRollId: pending.id });
    assert.equal(blessed.status, 200, JSON.stringify(blessed.json));
    assert.deepEqual(offered(), ["touch_of_death"], "the hit the blessing made is the roller's to answer");
    await spend(pending, 4);
    assert.equal(used(), 1);
    assert.equal(world.sheet(ally.id).resources.channel_divinity.used, 1);
    assert.equal(kit.enemy(enemy.id).currentHp, 400 - (4 + 3 + 11));
    assert.equal(open().length, 0, "nothing is left waiting");
  } finally {
    online();
    world.patch(ally.id, { features: [], resources: {} });
  }
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
