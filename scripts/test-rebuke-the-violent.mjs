// Rebuke the Violent (Oath of Redemption 3): "a reaction deals the same damage
// back to an attacker who wounded someone near you, halved on a Wisdom save". Its
// card sat in the Hand on the paladin's own turn, spent the reaction and nothing
// else, and dealt no damage.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-rebuke-the-violent");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");

const paladin = world.addHero({
  class: "paladin", subclass: "Oath of Redemption", level: 5, maxHp: 100, ac: 12, acOverride: true,
  abilities: { cha: 16 }, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" },
});
const friend = world.addHero({
  class: "fighter", level: 5, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" },
});
const channel = () => world.sheet(paladin.id).resources.channel_divinity;

async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [paladin.id]: 3, [friend.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(paladin.id, 5, 5);
  kit.place(friend.id, 7, 5);
  kit.place(enemy.id, 8, 5);
  kit.freshRound();
  const sheet = world.sheet(paladin.id);
  world.patch(paladin.id, { resources: { ...sheet.resources, channel_divinity: { ...sheet.resources.channel_divinity, used: 0 } } });
  return enemy;
}
// A club at +4 against AC 12: an 18 hits, for 1d6+2 with the 4 on the die.
const strike = async (enemy, target) => {
  world.dice(18, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const rebuke = async (face, extra = { targetCharacterId: friend.id }) => {
  world.dice(face);
  const out = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Rebuke the Violent", ...extra });
  world.clearDice();
  return out;
};
const enemyHp = (enemy) => world.enemies().find((entry) => entry.id === enemy.id).currentHp;
const hit = (over = {}) => ({ id: "h1", characterId: friend.id, hit: true, hits: 1, source: "attack", ranged: false, attacker: "Goblin", attackerId: "g1", attack: "Club", type: "bludgeoning", damage: 6, answered: [], ...over });
const offered = (open) =>
  reactionCards(world.sheet(paladin.id), { ...FRESH_TURN, myTurn: false }, [open], [{ id: friend.id, name: "Friend" }]).filter((card) => card.name === "Rebuke the Violent");

await test("It is offered on a hit on an ally, not on the paladin, and is no card on their own turn.", async () => {
  await stage();
  assert.equal(offered(hit()).length, 1);
  assert.equal(offered(hit({ characterId: paladin.id })).length, 0);
  assert.equal(deriveHand(world.sheet(paladin.id), FRESH_TURN, {}).some((card) => card.name === "Rebuke the Violent"), false);
});

await test("No card when the board puts the attacker beyond 30 feet, wherever the ally is.", async () => {
  await stage();
  const at = (feet) =>
    reactionCards(world.sheet(paladin.id), { ...FRESH_TURN, myTurn: false }, [hit()], [{ id: friend.id, name: "Friend" }], "you", feet).filter((card) => card.name === "Rebuke the Violent");
  assert.equal(at({ g1: 35, [friend.id]: 10 }).length, 0);
  assert.equal(at({ g1: 30, [friend.id]: 60 }).length, 1);
});

await test("With Channel Divinity spent there is no card, and the reaction is refused.", async () => {
  const enemy = await stage();
  world.patch(paladin.id, { resources: { ...world.sheet(paladin.id).resources, channel_divinity: { ...channel(), used: channel().max } } });
  assert.equal(offered(hit()).length, 0);
  await strike(enemy, friend);
  assert.equal((await rebuke(2)).ok, false);
});

await test("A failed save takes the same damage, and it spends Channel Divinity and the reaction.", async () => {
  const enemy = await stage();
  await strike(enemy, friend);
  const before = enemyHp(enemy);
  const out = await rebuke(2);
  assert.equal(out.ok, true, out.error);
  assert.equal(before - enemyHp(enemy), 6);
  assert.equal(channel().used, 1);
  assert.ok(world.encounter().reactionsUsed.includes(paladin.id));
});

await test("Once answered, the hit offers no card and cannot be rebuked again.", async () => {
  const enemy = await stage();
  world.patch(paladin.id, { resources: { ...world.sheet(paladin.id).resources, channel_divinity: { max: 2, used: 0 } } });
  await strike(enemy, friend);
  assert.equal((await rebuke(2)).ok, true);
  const open = hit({ answered: ["rebuke the violent"] });
  assert.equal(offered(open).length, 0);
  const record = (await import("../src/lib/dm/last-hit.ts")).openHits(world.campaignId, friend.id)[0];
  assert.ok(record.answered.some((entry) => /rebuke the violent/i.test(entry)), JSON.stringify(record.answered));
});

await test("A creature named answers for its own hit, and another is not burned in its place.", async () => {
  await stage();
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [paladin.id]: 3, [friend.id]: 2 } });
  const [first, second] = world.enemies();
  for (const enemy of [first, second]) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(paladin.id, 5, 5);
  kit.place(friend.id, 7, 5);
  kit.place(first.id, 8, 5);
  kit.place(second.id, 8, 6);
  kit.freshRound();
  world.dice(18, 1);
  const one = await world.invoke("enemy_attack", { enemyId: first.id, targetCharacterId: friend.id });
  assert.equal(one.ok, true, one.error);
  world.dice(18, 6);
  const two = await world.invoke("enemy_attack", { enemyId: second.id, targetCharacterId: friend.id });
  assert.equal(two.ok, true, two.error);
  world.clearDice();
  // The later hit is the open one, so the first creature has nothing to answer for.
  const refused = await rebuke(2, { targetCharacterId: friend.id, targetEnemyId: first.id });
  assert.equal(refused.ok, false);
  assert.equal(enemyHp(first), 300);
  assert.equal(enemyHp(second), 300);
  assert.equal(channel().used, 0);
  const out = await rebuke(2, { targetCharacterId: friend.id, targetEnemyId: second.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyHp(second), 292);
});

await test("A made save takes half.", async () => {
  const enemy = await stage();
  await strike(enemy, friend);
  const before = enemyHp(enemy);
  assert.equal((await rebuke(19)).ok, true);
  assert.equal(before - enemyHp(enemy), 3);
});

await test("It refuses the paladin's own hit, no hit at all, and a creature out of range, spending nothing.", async () => {
  const enemy = await stage();
  await strike(enemy, paladin);
  assert.equal((await rebuke(2, {})).ok, false, "no ally");
  assert.equal((await rebuke(2, { targetCharacterId: paladin.id })).ok, false, "themselves");
  assert.equal((await rebuke(2)).ok, false, "the ally was not hit");
  assert.equal(channel().used, 0);

  // The reach is the attacker's: "an attacker within 30 feet of you".
  const far = await stage();
  await strike(far, friend);
  kit.place(far.id, 5, 25);
  assert.match((await rebuke(2)).error, /beyond 30 feet/);
  assert.equal(channel().used, 0);
});

// The ally once had to be within 30 feet too, which the feature never asks.
await test("An ally struck beyond 30 feet is answered when the attacker is within it.", async () => {
  const enemy = await stage();
  kit.place(friend.id, 5, 12);
  kit.place(enemy.id, 5, 11);
  await strike(enemy, friend);
  const before = enemyHp(enemy);
  const out = await rebuke(2);
  assert.equal(out.ok, true, out.error);
  assert.equal(before - enemyHp(enemy), 6);
});

// "Radiant damage equal to the damage it just dealt": a blow the ally resisted
// dealt half its dice, and the rolled amount went back whole.
await test("It sends back the damage the ally took, not the dice the hit rolled.", async () => {
  const brute = world.addHero({
    class: "barbarian", level: 5, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" },
  });
  const enemy = await stage();
  kit.place(brute.id, 7, 6);
  world.patch(brute.id, { conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } } });
  await strike(enemy, brute);
  assert.equal(world.sheet(brute.id).currentHp, 97, "the rage halves the club's 6");
  const before = enemyHp(enemy);
  const out = await rebuke(2, { targetCharacterId: brute.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(before - enemyHp(enemy), 3);
});

await test("use_resource sends it to the reaction, spending nothing.", async () => {
  await stage();
  const out = await world.invoke("use_resource", { characterId: paladin.id, resource: "Channel Divinity", variant: "Rebuke the Violent" });
  assert.equal(out.ok, false);
  assert.match(out.error, /use_reaction/);
  assert.equal(channel().used, 0);
});

world.close();
finish();
