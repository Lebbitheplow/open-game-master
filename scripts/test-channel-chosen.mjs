// Order's Demand, Champion Challenge, Conquering Presence and Dreadful Aspect
// take "each creature of your choice" within reach. They took every foe in reach; a call now names the
// ones chosen in targetEnemyIds (every one when it names none), and the Hand's
// card aims at one creature and adds the others.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-channel-chosen");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { directCardCalls } = await import("../src/lib/dm/intent-logic.ts");
const { useResourceToolDefs } = await import("../src/lib/dm/resource-tool-defs.ts").then((mod) => ({ useResourceToolDefs: Object.values(mod).find(Array.isArray) }));

const hero = (classId, subclass) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level: 9, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const order = hero("cleric", "Order Domain");
const crown = hero("paladin", "Oath of the Crown");
const oathbreaker = hero("paladin", "Oathbreaker");
const conquest = hero("paladin", "Oath of Conquest");
const light = hero("cleric", "Light Domain");
const everyone = [order, crown, oathbreaker, conquest, light];

// Two foes beside the hero and one out of 30 feet.
async function stage(who) {
  await kit.endFight();
  await kit.fight(3, { heroFaces: Object.fromEntries(everyone.map((entry) => [entry.id, entry.id === who.id ? 19 : 1])) });
  const foes = world.enemies();
  foes.forEach((foe) => kit.setEnemy(foe.id, { maxHp: 300, currentHp: 300 }));
  everyone.forEach((entry, at) => kit.place(entry.id, at, 0));
  kit.place(who.id, 5, 5);
  kit.place(foes[0].id, 5, 6);
  kit.place(foes[1].id, 6, 6);
  kit.place(foes[2].id, 19, 19);
  kit.giveTurn(who.id);
  for (const entry of everyone) {
    const { resources } = world.sheet(entry.id);
    world.patch(entry.id, { conditions: [], conditionMeta: {}, resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } });
  }
  return world.enemies();
}
const used = (who) => world.sheet(who.id).resources.channel_divinity.used;
const has = (id, condition) => world.enemies().find((entry) => entry.id === id).conditions.includes(condition);
const channel = async (who, variant, faces, more = {}) => {
  world.dice(...faces);
  const out = await world.invoke("use_resource", { characterId: who.id, resource: "Channel Divinity", variant, ...more });
  world.clearDice();
  return out;
};

for (const [who, variant, condition] of [
  [order, "order's demand", "charmed"],
  [crown, "champion challenge", "champion challenge"],
  [oathbreaker, "dreadful aspect", "frightened"],
  [conquest, "conquering presence", "frightened"],
]) {
  await test(`${variant}: only the creature chosen saves and suffers, though the other in reach would fail too.`, async () => {
    const [near, beside] = await stage(who);
    const out = await channel(who, variant, [2, 2], { targetEnemyIds: [near.id] });
    assert.equal(out.ok, true, out.error);
    assert.ok(has(near.id, condition), "the chosen one");
    assert.equal(has(beside.id, condition), false, "the one not chosen");
    assert.equal(used(who), 1);
  });

  await test(`${variant}: naming none still takes every creature in reach.`, async () => {
    const [near, beside, far] = await stage(who);
    const out = await channel(who, variant, [2, 2]);
    assert.equal(out.ok, true, out.error);
    assert.ok(has(near.id, condition) && has(beside.id, condition));
    assert.equal(has(far.id, condition), false);
  });

  await test(`${variant}: a creature out of reach is refused by name, and nothing is spent.`, async () => {
    const [near, , far] = await stage(who);
    const out = await channel(who, variant, [2, 2], { targetEnemyIds: [near.id, far.id] });
    assert.equal(out.ok, false);
    assert.match(String(out.error), new RegExp(far.id));
    assert.match(String(out.error), /Nothing was spent/);
    assert.equal(used(who), 0);
    assert.equal(has(near.id, condition), false);
  });
}

await test("Radiance of the Dawn takes every hostile creature in reach, so a chosen few is refused and nothing is spent.", async () => {
  const [near] = await stage(light);
  const out = await channel(light, "radiance of the dawn", [5, 5, 2, 2], { targetEnemyIds: [near.id] });
  assert.equal(out.ok, false);
  assert.match(String(out.error), /every creature in reach/);
  assert.equal(used(light), 0);
});

await test("The Hand's card aims at one creature and adds the others, and its call names them all.", async () => {
  for (const [who, name, condition] of [
    [order, "Order's Demand", "charmed"],
    [crown, "Champion Challenge", "champion challenge"],
    [oathbreaker, "Dreadful Aspect", "frightened"],
    [conquest, "Conquering Presence", "frightened"],
  ]) {
    const [near, beside, far] = await stage(who);
    const [card] = deriveHand(world.sheet(who.id), FRESH_TURN, {}).filter((entry) => entry.name === name);
    assert.ok(card, name);
    assert.equal(card.target, "enemy", name);
    assert.equal(card.shares?.unit, "creature", name);
    assert.equal(card.shares?.stack, false, name);
    const intent = {
      ...card.intent,
      targetKind: "enemy",
      targetId: near.id,
      targetName: "Goblin 1",
      shares: [{ id: near.id, name: "Goblin 1", count: 1 }, { id: far.id, name: "Goblin 3", count: 1 }],
    };
    const calls = directCardCalls(intent, who.id, { inFight: true });
    assert.equal(calls?.length, 1, name);
    assert.deepEqual(calls[0].args.targetEnemyIds, [near.id, far.id], name);
    // Goblin 3 stands beyond 30 feet: the call is refused whole.
    const refused = await world.invoke(calls[0].name, calls[0].args);
    assert.equal(refused.ok, false, name);
    // The refusal kept the turn: the Hand's own call for the one beside, as it
    // comes, lands on it alone.
    const kept = directCardCalls({ ...intent, targetId: beside.id, targetName: "Goblin 2", shares: [{ id: beside.id, name: "Goblin 2", count: 1 }] }, who.id, { inFight: true });
    world.dice(2, 2);
    const out = await world.invoke(kept[0].name, kept[0].args);
    world.clearDice();
    assert.equal(out.ok, true, `${name}: ${out.error}`);
    assert.ok(has(beside.id, condition), name);
    assert.equal(has(near.id, condition), false, name);
    assert.equal(used(who), 1, name);
  }
});

await test("The Hand's two-creature call, sent as it comes, takes those two and not the third in reach.", async () => {
  const [near, beside] = await stage(oathbreaker);
  const third = world.enemies()[2];
  kit.place(third.id, 4, 6);
  const [card] = deriveHand(world.sheet(oathbreaker.id), FRESH_TURN, {}).filter((entry) => entry.name === "Dreadful Aspect");
  const calls = directCardCalls(
    { ...card.intent, targetKind: "enemy", targetId: near.id, shares: [{ id: near.id, name: "Goblin 1", count: 1 }, { id: beside.id, name: "Goblin 2", count: 1 }] },
    oathbreaker.id,
    { inFight: true },
  );
  world.dice(2, 2, 2);
  const out = await world.invoke(calls[0].name, calls[0].args);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(has(near.id, "frightened") && has(beside.id, "frightened"));
  assert.equal(has(third.id, "frightened"), false, "the third, in reach but not chosen");
});

await test("A lone targetEnemyId names the one chosen, for a caller that sees only that argument.", async () => {
  const [near, beside] = await stage(order);
  const out = await channel(order, "order's demand", [2, 2], { targetEnemyId: near.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(has(near.id, "charmed"));
  assert.equal(has(beside.id, "charmed"), false);
});

await test("A creature may be chosen by its name on the board, as targetEnemyId takes it.", async () => {
  const [near, beside] = await stage(crown);
  const out = await channel(crown, "champion challenge", [2, 2], { targetEnemyIds: [near.displayName] });
  assert.equal(out.ok, true, out.error);
  assert.ok(has(near.id, "champion challenge"));
  assert.equal(has(beside.id, "champion challenge"), false);
});

await test("Abjure Enemy is aimed at one creature, so a list is refused and nothing is spent.", async () => {
  const vengeance = hero("paladin", "Oath of Vengeance");
  everyone.push(vengeance);
  const [near, beside] = await stage(vengeance);
  const out = await channel(vengeance, "abjure enemy", [2], { targetEnemyId: near.id, targetEnemyIds: [beside.id] });
  assert.equal(out.ok, false);
  assert.match(String(out.error), /not targetEnemyIds/);
  assert.equal(used(vengeance), 0);
});

await test("The player's sentence names every creature chosen.", async () => {
  const { composeSentence } = await import("../src/lib/battlemap/hand-play.ts");
  const [card] = deriveHand(world.sheet(order.id), FRESH_TURN, {}).filter((entry) => entry.name === "Order's Demand");
  const aim = { id: "g1", name: "Goblin 1", kind: "enemy" };
  const sentence = composeSentence(card, aim, [], { shares: [{ id: "g2", name: "Goblin 2", count: 1 }] });
  assert.match(sentence, /Goblin 1/);
  assert.match(sentence, /Goblin 2/);
});

await test("A card aimed at one creature with none added takes that one alone, not every foe in reach.", async () => {
  const [near, beside] = await stage(order);
  const [card] = deriveHand(world.sheet(order.id), FRESH_TURN, {}).filter((entry) => entry.name === "Order's Demand");
  const calls = directCardCalls({ ...card.intent, targetKind: "enemy", targetId: near.id, shares: [{ id: near.id, name: "Goblin 1", count: 1 }] }, order.id, { inFight: true });
  assert.deepEqual(calls[0].args.targetEnemyIds, [near.id]);
  world.dice(2, 2);
  const out = await world.invoke(calls[0].name, calls[0].args);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(has(near.id, "charmed"));
  assert.equal(has(beside.id, "charmed"), false);
});

await test("use_resource offers targetEnemyIds as a list of enemyIds in the full set, and the compact set leaves it off.", async () => {
  const { compactTool } = await import("../src/lib/dm/tool-profiles.ts");
  const defs = useResourceToolDefs ?? [];
  const def = defs.find((entry) => entry.function?.name === "use_resource");
  assert.ok(def, "the use_resource definition");
  assert.equal(def.function.parameters.properties.targetEnemyIds.type, "array");
  assert.equal(def.function.parameters.properties.targetEnemyIds.items.type, "string");
  const compact = compactTool(def);
  assert.equal(compact.function.parameters.properties.targetEnemyIds, undefined, "a 16K window has no room for it");
  assert.ok(compact.function.parameters.properties.targetEnemyId, "the rest of the tool is untouched");
});

finish();
