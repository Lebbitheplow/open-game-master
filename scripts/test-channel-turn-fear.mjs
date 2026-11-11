// Six Channel Divinity options spent the use and changed nothing: three turnings
// (Turn the Faithless, Abjure the Extraplanar, Arcane Abjuration) and three that
// frighten (Conquering Presence, Dreadful Aspect, Abjure Enemy). Each now rolls
// its save and lays what the failure does, and a refusal spends nothing.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-channel-turn-fear");
const world = await openWorld({ campaign: { maxPlayers: 12 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const { enemySpeedTiles } = await import("../src/lib/dm/enemy-speed.ts");

const hero = (classId, subclass) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level: 9, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const ancients = hero("paladin", "Oath of the Ancients");
const watchers = hero("paladin", "Oath of the Watchers");
const arcana = hero("cleric", "Arcana Domain");
const conquest = hero("paladin", "Oath of Conquest");
const oathbreaker = hero("paladin", "Oathbreaker");
const vengeance = hero("paladin", "Oath of Vengeance");
const everyone = [ancients, watchers, arcana, conquest, oathbreaker, vengeance];

// Two foes beside the hero and one out of 30 feet, of the types given.
async function stage(who, types = ["fiend", "beast", "fiend"]) {
  await kit.endFight();
  await kit.fight(3, { heroFaces: Object.fromEntries(everyone.map((entry) => [entry.id, entry.id === who.id ? 19 : 1])) });
  const foes = world.enemies();
  foes.forEach((foe, at) => kit.setEnemy(foe.id, { maxHp: 300, currentHp: 300, stats: { ...foe.stats, type: types[at], speed: "30 ft." } }));
  everyone.forEach((entry, at) => kit.place(entry.id, at, 0));
  kit.place(who.id, 5, 5);
  kit.place(foes[0].id, 5, 6);
  kit.place(foes[1].id, 6, 6);
  kit.place(foes[2].id, 19, 19);
  kit.giveTurn(who.id);
  const { resources } = world.sheet(who.id);
  world.patch(who.id, { conditions: [], conditionMeta: {}, resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } });
  return world.enemies();
}
const used = (who) => world.sheet(who.id).resources.channel_divinity.used;
const foe = (id) => world.enemies().find((entry) => entry.id === id);
const channel = async (who, variant, faces, more = {}) => {
  world.dice(...faces);
  const out = await world.invoke("use_resource", { characterId: who.id, resource: "Channel Divinity", variant, ...more });
  world.clearDice();
  return out;
};

await test("Turn the Faithless turns the fiend in reach, leaves the beast, and says the disguise drops.", async () => {
  const [fiend, beast, far] = await stage(ancients);
  const out = await channel(ancients, "turn the faithless", [2]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(fiend.id).conditions.includes("turned"));
  assert.equal(foe(beast.id).conditions.includes("turned"), false);
  assert.equal(foe(far.id).conditions.includes("turned"), false, "out of 30 feet");
  assert.match(out.result.also, /disguise/);
  assert.equal(used(ancients), 1);
});

await test("A save made leaves the creature unturned, and the use is still spent.", async () => {
  const [fiend] = await stage(ancients);
  const out = await channel(ancients, "turn the faithless", [20]);
  assert.equal(out.ok, true, out.error);
  assert.equal(foe(fiend.id).conditions.includes("turned"), false);
  assert.equal(used(ancients), 1);
});

await test("With nothing of its types in reach Abjure the Extraplanar is refused and spends nothing.", async () => {
  await stage(watchers, ["beast", "humanoid", "fiend"]);
  const out = await channel(watchers, "abjure the extraplanar", [2]);
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules");
  assert.equal(used(watchers), 0);
});

await test("Abjure the Extraplanar turns an aberration.", async () => {
  const [aberration] = await stage(watchers, ["aberration", "beast", "beast"]);
  const out = await channel(watchers, "abjure the extraplanar", [2]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(aberration.id).conditions.includes("turned"));
});

await test("Arcane Abjuration takes one creature, named, and leaves the other fiend alone.", async () => {
  const [one, , other] = await stage(arcana, ["fiend", "beast", "fiend"]);
  kit.place(other.id, 4, 6);
  const none = await channel(arcana, "arcane abjuration", [2]);
  assert.equal(none.ok, false, "no creature named");
  assert.equal(none.retry, true);
  assert.equal(used(arcana), 0);
  const out = await channel(arcana, "arcane abjuration", [2], { targetEnemyId: one.id });
  assert.equal(out.ok, true, out.error);
  // From 5th level a creature that fails and whose challenge rating is at or
  // under the cleric's limit "is banished for a minute instead" of turned
  // (src/lib/dm/feature-spends.ts): the staged fiend is CR 1/4.
  assert.deepEqual(foe(one.id).conditions.filter((entry) => ["turned", "banished"].includes(entry)), ["banished"], JSON.stringify(out.result));
  assert.equal(foe(one.id).conditionMeta.banished.rounds, 10);
  assert.equal(foe(other.id).conditions.some((entry) => ["turned", "banished"].includes(entry)), false);
  assert.match(out.result.turnUndead.join(" "), /banished for a minute/);
});

await test("Conquering Presence frightens everyone in reach, with a save each turn.", async () => {
  const [a, b, far] = await stage(conquest, ["beast", "humanoid", "beast"]);
  const out = await channel(conquest, "conquering presence", [2, 2]);
  assert.equal(out.ok, true, out.error);
  for (const entry of [a, b]) {
    assert.ok(foe(entry.id).conditions.includes("frightened"));
    assert.equal(foe(entry.id).conditionMeta.frightened.saveEnds.ability, "wis");
  }
  assert.equal(foe(far.id).conditions.includes("frightened"), false);
  assert.equal(used(conquest), 1);
});

await test("Dreadful Aspect frightens for a minute, saved against only far from the paladin; a save made lands nothing.", async () => {
  const [a, b] = await stage(oathbreaker, ["beast", "humanoid", "beast"]);
  const out = await channel(oathbreaker, "dreadful aspect", [2, 20]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(a.id).conditions.includes("frightened"));
  assert.deepEqual(foe(a.id).conditionMeta.frightened.saveEnds, { ability: "wis", dc: 15, beyondFeet: 30 });
  assert.match(out.result.applied.join(" "), /more than 30 feet away/);
  assert.equal(foe(b.id).conditions.includes("frightened"), false);
});

await test("A creature frightened by Dreadful Aspect saves again only at the end of a turn it ends more than 30 feet away.", async () => {
  const [a] = await stage(oathbreaker, ["beast", "humanoid", "beast"]);
  const out = await channel(oathbreaker, "dreadful aspect", [2, 2]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(a.id).conditions.includes("frightened"));
  const { endTurnSaves } = await import("../src/lib/dm/condition-tick.ts");
  // Still beside the paladin: no save, however high the die.
  world.dice(20);
  endTurnSaves(world.campaign(), world.encounter(), [a.id]);
  world.clearDice();
  assert.ok(foe(a.id).conditions.includes("frightened"), "no save within 30 feet");
  // Fled 35 feet: the save comes, and a 20 ends it.
  kit.place(a.id, 5, 12);
  world.dice(20);
  endTurnSaves(world.campaign(), world.encounter(), [a.id]);
  world.clearDice();
  assert.equal(foe(a.id).conditions.includes("frightened"), false, "a save far away ends it");
});

await test("A creature immune to fear is said to be, and is not frightened.", async () => {
  const [a] = await stage(oathbreaker, ["undead", "humanoid", "beast"]);
  kit.setEnemy(a.id, { stats: { ...a.stats, conditionImmune: "frightened" } });
  const out = await channel(oathbreaker, "dreadful aspect", [2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(foe(a.id).conditions.includes("frightened"), false);
  assert.match(out.result.applied.join(" "), /cannot be frightened/);
});

await test("Abjure Enemy: a failure frightens and stops the creature, and damage ends it.", async () => {
  const [a, b] = await stage(vengeance, ["beast", "humanoid", "beast"]);
  const out = await channel(vengeance, "abjure enemy", [2], { targetEnemyId: a.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(a.id).conditions.includes("frightened"));
  assert.equal(enemySpeedTiles(foe(a.id)), 0);
  assert.equal(foe(b.id).conditions.includes("frightened"), false);
  const hurt = await world.invoke("damage_enemy", { enemyId: a.id, amount: 3, type: "fire" });
  assert.equal(hurt.ok, true, hurt.error);
  assert.equal(foe(a.id).conditions.includes("frightened"), false);
  assert.equal(enemySpeedTiles(foe(a.id)), 6);
});

await test("Abjure Enemy: a success halves the speed and does not frighten.", async () => {
  const [a] = await stage(vengeance, ["beast", "humanoid", "beast"]);
  const out = await channel(vengeance, "abjure enemy", [20], { targetEnemyId: a.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(foe(a.id).conditions.includes("frightened"), false);
  assert.equal(enemySpeedTiles(foe(a.id)), 3);
});

await test("Abjure Enemy: beyond 60 feet is refused; a fiend saves at a disadvantage.", async () => {
  const [a, , far] = await stage(vengeance, ["fiend", "beast", "beast"]);
  const beyond = await channel(vengeance, "abjure enemy", [2], { targetEnemyId: far.id });
  assert.equal(beyond.ok, false);
  assert.equal(beyond.refused, "rules");
  assert.equal(used(vengeance), 0);
  const out = await channel(vengeance, "abjure enemy", [20, 2], { targetEnemyId: a.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(a.id).conditions.includes("frightened"), "the lower die stands");
});

await test("An option the sheet does not hold is refused and spends nothing.", async () => {
  await stage(oathbreaker);
  const out = await channel(oathbreaker, "turn the faithless", [2]);
  assert.equal(out.ok, false);
  assert.match(out.error, /does not hold/);
  assert.equal(used(oathbreaker), 0);
});

await test("The cards play these: the aimed and chosen ones ask for a creature, the others for none.", async () => {
  for (const [who, name, target] of [[ancients, "Turn the Faithless", "none"], [watchers, "Abjure the Extraplanar", "none"], [arcana, "Arcane Abjuration", "enemy"], [conquest, "Conquering Presence", "enemy"], [oathbreaker, "Dreadful Aspect", "enemy"], [vengeance, "Abjure Enemy", "enemy"]]) {
    const [first] = await stage(who, ["fiend", "fiend", "beast"]);
    const card = deriveHand(world.sheet(who.id), FRESH_TURN, {}).find((entry) => entry.name === name);
    assert.ok(card, name);
    assert.equal(card.cost, "action", name);
    assert.equal(card.target, target, name);
    const intent = { ...card.intent, ...(target === "enemy" ? { targetId: first.id, targetKind: "enemy" } : {}) };
    const call = directCardCall(intent, who.id, { inFight: true });
    world.dice(2, 2, 2);
    const out = await world.invoke(call.name, call.args);
    world.clearDice();
    assert.equal(out.ok, true, `${name}: ${out.error}`);
    assert.equal(used(who), 1, name);
    // Banished is what Arcane Abjuration does to a creature under its limit.
    assert.ok(foe(first.id).conditions.some((entry) => ["turned", "frightened", "banished"].includes(entry)), name);
  }
});

await test("A second source's fear stays: Abjure Enemy's damage ends only its own, and the other caster's holds.", async () => {
  const [a] = await stage(vengeance, ["beast", "humanoid", "beast"]);
  kit.setEnemy(a.id, { conditions: ["frightened"], conditionMeta: { frightened: { source: conquest.id, spell: "Fear", rounds: 10 } } });
  const out = await channel(vengeance, "abjure enemy", [2], { targetEnemyId: a.id });
  assert.equal(out.ok, true, out.error);
  const hurt = await world.invoke("damage_enemy", { enemyId: a.id, amount: 3, type: "fire" });
  assert.equal(hurt.ok, true, hurt.error);
  assert.ok(foe(a.id).conditions.includes("frightened"), "the other caster's fear holds");
  assert.equal(foe(a.id).conditions.includes("abjured still"), false);
});

await test("A condition the save spends stays spent, on a fear and on a turning.", async () => {
  const carrier = { conditions: ["unsettled (d6)"], conditionMeta: { "unsettled (d6)": { source: conquest.id, rounds: 10 } } };
  const [a] = await stage(oathbreaker, ["beast", "humanoid", "beast"]);
  kit.setEnemy(a.id, carrier);
  await channel(oathbreaker, "dreadful aspect", [2, 2, 2]);
  assert.deepEqual(foe(a.id).conditions, ["frightened"]);
  const [b] = await stage(ancients, ["fiend", "beast", "beast"]);
  kit.setEnemy(b.id, carrier);
  await channel(ancients, "turn the faithless", [2, 2, 2]);
  assert.deepEqual(foe(b.id).conditions, ["turned"]);
});

await test("Magic Resistance gives its advantage on a turning, as on a fear.", async () => {
  const [a] = await stage(ancients, ["fiend", "beast", "beast"]);
  kit.setEnemy(a.id, { stats: { ...foe(a.id).stats, traits: ["Magic Resistance. The creature has advantage on saving throws against spells and other magical effects."] } });
  const out = await channel(ancients, "turn the faithless", [2, 20]);
  assert.equal(out.ok, true, out.error);
  assert.equal(foe(a.id).conditions.includes("turned"), false, "the higher die stands");
});

await test("A creature on the party's side under Dominate is not frightened by the area; Abjure Enemy names no one's self.", async () => {
  const [a, b] = await stage(conquest, ["beast", "humanoid", "beast"]);
  kit.setEnemy(a.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: conquest.id, spell: "Dominate Monster", rounds: 10 } } });
  const out = await channel(conquest, "conquering presence", [2, 2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(foe(a.id).conditions.includes("frightened"), false);
  assert.ok(foe(b.id).conditions.includes("frightened"));
  await stage(vengeance);
  const self = await channel(vengeance, "abjure enemy", [2], { targetEnemyId: vengeance.id });
  assert.equal(self.ok, false);
  assert.equal(used(vengeance), 0);
});

await test("A turned companion is frightened by the area.", async () => {
  const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
  await kit.endFight();
  const joined = await world.invoke("add_companion", { gender: "Unknown", name: "Aldric", class: "fighter", race: "human", level: 5, personality: "Grim.", kind: "guest" });
  const turned = joined.result.characterId;
  await stage(oathbreaker, ["beast", "humanoid", "beast"]);
  moveToSide(world.campaign(), turned, "foe", { quiet: true });
  kit.place(turned, 4, 5);
  world.patch(turned, { conditions: [], conditionMeta: {} });
  const out = await channel(oathbreaker, "dreadful aspect", [2, 2, 2]);
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(turned).conditions.includes("frightened"));
});

await test("Abjure Enemy is no spell: Dispel Magic has nothing of it to end.", async () => {
  const [a] = await stage(vengeance, ["beast", "humanoid", "beast"]);
  await channel(vengeance, "abjure enemy", [2], { targetEnemyId: a.id });
  assert.equal(foe(a.id).conditionMeta.frightened.spell, undefined);
  assert.equal(foe(a.id).conditionMeta["abjured still"].spell, undefined);
});

await test("A caster on the foes' side frightens the party, not itself or its own side.", async () => {
  const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
  const [a] = await stage(oathbreaker, ["beast", "humanoid", "beast"]);
  moveToSide(world.campaign(), oathbreaker.id, "foe", { quiet: true });
  kit.place(conquest.id, 4, 5);
  world.patch(conquest.id, { conditions: [], conditionMeta: {} });
  // A low die for every hero in reach: another die would be random.
  const out = await channel(oathbreaker, "dreadful aspect", Array(12).fill(2));
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(oathbreaker.id).conditions.includes("frightened"), false);
  assert.equal(foe(a.id).conditions.includes("frightened"), false);
  assert.ok(world.sheet(conquest.id).conditions.includes("frightened"));
  moveToSide(world.campaign(), oathbreaker.id, "party", { quiet: true });
});

await test("Behind a wall, or down at 0, a creature is out of reach, and the use stays.", async () => {
  await stage(oathbreaker, ["beast", "humanoid", "beast"]);
  kit.openField(Array.from({ length: 20 }, (_, x) => [x, 5, "#"]));
  everyone.forEach((entry, at) => kit.place(entry.id, at, 0));
  kit.place(oathbreaker.id, 5, 3);
  for (const [at, enemy] of world.enemies().entries()) kit.place(enemy.id, 5 + at, 7);
  const out = await channel(oathbreaker, "dreadful aspect", [2, 2, 2]);
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules");
  assert.equal(used(oathbreaker), 0);
});

world.close();
finish();
