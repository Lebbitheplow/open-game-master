// Glorious Defense (Oath of Glory 15): "a reaction adds your Charisma modifier to
// the AC of yourself or an ally within 10 feet, and a resulting miss lets you
// attack the attacker". It was never offered when a hit came, and its card spent
// a use and left the hit standing.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-glorious-defense");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");

const paladin = world.addHero({
  class: "paladin", subclass: "Oath of Glory", level: 15, maxHp: 100, ac: 12, acOverride: true,
  abilities: { str: 16, cha: 16 }, proficiencies: TRAINED,
  portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const friend = world.addHero({
  class: "fighter", level: 5, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" },
});
const rogue = world.addHero({
  class: "paladin", subclass: "Oath of Glory", level: 20, maxHp: 100, ac: 12, acOverride: true, abilities: { dex: 16, cha: 16 }, proficiencies: TRAINED,
  classes: [{ id: "paladin", subclass: "Oath of Glory", level: 15 }, { id: "rogue", subclass: "", level: 5 }],
  portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Rapier", qty: 1, equipped: true }],
});
const uses = () => world.sheet(paladin.id).resources.sub_glorious_defense;

async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [paladin.id]: 3, [friend.id]: 2, [rogue.id]: 1 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(paladin.id, 5, 5);
  kit.place(friend.id, 4, 5);
  kit.place(rogue.id, 12, 12);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  for (const hero of [paladin, friend]) world.patch(hero.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  const sheet = world.sheet(paladin.id);
  world.patch(paladin.id, { resources: { ...sheet.resources, sub_glorious_defense: { ...uses(), used: 0 } } });
  return enemy;
}
// A club at +4, so a face of 10 is a 14: through AC 12, not through 15.
const swing = async (enemy, target, faces) => {
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const defend = async (extra = {}, faces = [15, 4, 4, 4]) => {
  world.dice(...faces);
  const out = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Glorious Defense", ...extra });
  world.clearDice();
  return out;
};
const hit = (over = {}) => ({ id: "h1", characterId: paladin.id, hit: true, hits: 1, source: "attack", ranged: false, attacker: "Goblin", attackerId: "g1", attack: "Club", type: "bludgeoning", damage: 5, answered: [], ...over });
const offered = (open) =>
  reactionCards(world.sheet(paladin.id), { ...FRESH_TURN, myTurn: false }, [open], [{ id: friend.id, name: "Friend" }]).filter((card) => card.name === "Glorious Defense");

await test("It is offered on a hit on the paladin or an ally, and is no card on the paladin's own turn.", async () => {
  await stage();
  assert.equal(offered(hit()).length, 1);
  assert.equal(offered(hit({ characterId: friend.id })).length, 1);
  assert.equal(deriveHand(world.sheet(paladin.id), FRESH_TURN, {}).some((card) => card.name === "Glorious Defense"), false);
});

// The card went to an ally beyond 10 feet, and the engine refused it. The
// board's distances (PlayerMapView.feet) keep it in the reach.
await test("An ally beyond 10 feet gets no card when the board says so, and the view carries the distance.", async () => {
  await stage();
  const near = (feet) =>
    reactionCards(world.sheet(paladin.id), { ...FRESH_TURN, myTurn: false }, [hit({ characterId: friend.id })], [{ id: friend.id, name: "Friend" }], "you", feet).filter((card) => card.name === "Glorious Defense");
  assert.equal(near({ [friend.id]: 10 }).length, 1, "within 10 feet");
  assert.equal(near({ [friend.id]: 15 }).length, 0, "beyond 10 feet");
  assert.equal(near(undefined).length, 1, "no board: the engine judges");
  const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
  kit.place(friend.id, 5, 8);
  const view = buildPlayerMapView(world.campaignId, world.sheet(paladin.id).userId);
  assert.equal(view.feet?.[friend.id], 15);
});

// Warding Maneuver covers "a creature you can see within 5 feet of you":
// its ally card needs the same reach.
await test("Warding Maneuver's ally card keeps to its 5 feet.", async () => {
  const cavalier = world.addHero({ class: "fighter", subclass: "Cavalier", level: 7, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" } });
  const warding = (feet) =>
    reactionCards(world.sheet(cavalier.id), { ...FRESH_TURN, myTurn: false }, [hit({ characterId: friend.id })], [{ id: friend.id, name: "Friend" }], "you", feet).filter((card) => card.name === "Warding Maneuver");
  assert.equal(warding({ [friend.id]: 5 }).length, 1, "within 5 feet");
  assert.equal(warding({ [friend.id]: 10 }).length, 0, "beyond 5 feet");
});

await test("No use left, no card.", async () => {
  await stage();
  world.patch(paladin.id, { resources: { ...world.sheet(paladin.id).resources, sub_glorious_defense: { ...uses(), used: uses().max } } });
  assert.equal(offered(hit()).length, 0);
});

await test("A hit the bonus beats becomes a miss, the hit points come back, and the paladin strikes the attacker.", async () => {
  const enemy = await stage();
  await swing(enemy, paladin, [10, 4]);
  assert.ok(world.sheet(paladin.id).currentHp < 50);
  const out = await defend();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(paladin.id).currentHp, 50);
  assert.equal(uses().used, 1);
  assert.equal(out.result.attack.target, enemy.displayName);
  assert.equal(world.sheet(paladin.id).conditions.includes("readied"), false);
});

await test("On the paladin's own turn the attack costs nothing of the turn.", async () => {
  const enemy = await stage();
  kit.giveTurn(paladin.id);
  await swing(enemy, paladin, [10, 4]);
  const out = await defend();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.attack.target, enemy.displayName);
  const budget = world.encounter().turnBudget;
  assert.ok(!budget || (budget.attacksMade === 0 && budget.actionUsed === false), JSON.stringify(budget));
});

await test("Sneak Attack stays once a turn through the attack on the holder's own turn.", async () => {
  const enemy = await stage();
  kit.place(rogue.id, 6, 6);
  kit.giveTurn(rogue.id);
  const first = await kit.swing(rogue.id, enemy.id, [15, 4, 4, 4, 4, 4]);
  assert.match(JSON.stringify(first.result), /Sneak Attack/);
  await swing(enemy, rogue, [10, 4]);
  world.dice(15, 4, 4, 4, 4, 4);
  const out = await world.invoke("use_reaction", { characterId: rogue.id, feature: "Glorious Defense" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.attack.target, enemy.displayName);
  assert.match(JSON.stringify(out.result.attack), /Sneak Attack already used this turn/);
  assert.match(JSON.stringify(out.result.attack), /made as a reaction/);
});

await test("A readied action survives the attack.", async () => {
  const enemy = await stage();
  const sheet = world.sheet(paladin.id);
  world.patch(paladin.id, {
    conditions: [...sheet.conditions, "readied"],
    conditionMeta: { ...sheet.conditionMeta, readied: { untilTurnOf: paladin.id, holds: "move", trigger: "when the goblin moves" } },
  });
  await swing(enemy, paladin, [10, 4]);
  const out = await defend();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.attack.target, enemy.displayName);
  assert.equal(world.sheet(paladin.id).conditions.includes("readied"), true);
});

await test("A hit the bonus does not beat still lands: the use is spent and no attack follows.", async () => {
  const enemy = await stage();
  await swing(enemy, paladin, [12, 4]);
  const hurt = world.sheet(paladin.id).currentHp;
  const out = await defend();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(paladin.id).currentHp, hurt);
  assert.equal(uses().used, 1);
  assert.equal(out.result.attack, undefined);
});

await test("It covers an ally within 10 feet, and refuses one beyond, spending nothing.", async () => {
  const enemy = await stage();
  await swing(enemy, friend, [10, 4]);
  const out = await defend({ targetCharacterId: friend.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(friend.id).currentHp, 50);
  assert.equal(uses().used, 1);

  const again = await stage();
  // The attacker beside the ally: walking there would draw the opportunity
  // attack that spends the paladin's reaction.
  kit.place(friend.id, 5, 12);
  kit.place(again.id, 5, 13);
  await swing(again, friend, [10, 4]);
  const far = await defend({ targetCharacterId: friend.id });
  assert.equal(far.ok, false);
  assert.match(far.error, /beyond 10 feet/);
  assert.equal(uses().used, 0);
});

await test("An attacker out of reach keeps the miss, and the attack is reported as not made.", async () => {
  const enemy = await stage();
  await swing(enemy, paladin, [10, 4]);
  kit.place(enemy.id, 5, 12);
  const out = await defend();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(paladin.id).currentHp, 50);
  assert.match(String(out.result.attack), /^No attack/);
});

world.close();
finish();
