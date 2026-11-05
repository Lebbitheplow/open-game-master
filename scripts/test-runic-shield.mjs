// Runic Shield spent its use and changed nothing, from a card in the Hand on the
// holder's own turn. It now answers a hit on an ally within 60 feet: the attacker
// rolls the d20 again and must use the new roll, high or low.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-runic-shield");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { tilesApart } = await import("../src/lib/dm/board-reach.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");

const hero = (classId, subclass, level = 20) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const knight = hero("fighter", "Rune Knight");
const ally = hero("rogue", "Thief", 1);

const COUNTER = "sub_runic_shield";
const used = () => world.sheet(knight.id).resources[COUNTER].used;

async function stage(holder = knight) {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [holder.id]: 3 } });
  const [enemy, other] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(other.id, 6, 8);
  kit.place(holder.id, 5, 5);
  kit.place(ally.id, 5, 7);
  kit.place(enemy.id, 5, 8);
  kit.freshRound();
  world.patch(ally.id, { currentHp: 50, maxHp: 100, ac: 12, conditions: [], conditionMeta: {} });
  const resources = world.sheet(holder.id).resources;
  world.patch(holder.id, {
    currentHp: 50,
    conditions: [],
    conditionMeta: {},
    ...(resources[COUNTER] ? { resources: { ...resources, [COUNTER]: { ...resources[COUNTER], used: 0 } } } : {}),
  });
  return enemy;
}
// A club at +4, 1d6+2: a 16 on the die is a 20, through AC 12, for 6.
const strike = async (enemy, target, faces = [16, 4], extra = {}) => {
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id, ...extra });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const shield = async (faces, target = ally, holder = knight) => {
  world.dice(...faces);
  const out = await world.invoke("use_reaction", { characterId: holder.id, feature: "Runic Shield", ...(target ? { targetCharacterId: target.id } : {}) });
  world.clearDice();
  return out;
};
const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
const offered = (who = knight) =>
  reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets()).filter((card) => card.name === "Runic Shield");
const reactionKept = () => !world.encounter().reactionsUsed.includes(knight.id);

await test("The card comes when an ally is hit, aimed at that ally, and not on the holder's own turn.", async () => {
  const enemy = await stage();
  assert.equal(deriveHand(world.sheet(knight.id), FRESH_TURN, {}).some((card) => card.name === "Runic Shield"), false, "no card on the holder's own turn");
  assert.equal(offered().length, 0, "no hit, no card");
  await strike(enemy, ally);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  const cards = offered();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].target, "ally");
  assert.equal(cards[0].answers?.characterId, ally.id);
  assert.equal(cards[0].rules, "The attacker rolls the d20 again and must use the new roll.");
});

await test("A hit on the holder offers no card, and the reaction refuses it with nothing spent.", async () => {
  const enemy = await stage();
  kit.place(enemy.id, 5, 6);
  await strike(enemy, knight);
  assert.equal(world.sheet(knight.id).currentHp, 44);
  assert.equal(offered().length, 0);
  for (const target of [null, knight]) {
    const out = await shield([2], target);
    assert.equal(out.ok, false, JSON.stringify(out));
    assert.match(out.error, /another creature/);
  }
  assert.equal(used(), 0);
  assert.equal(world.sheet(knight.id).currentHp, 44);
  assert.ok(reactionKept());
});

await test("An ally beyond 60 feet is refused: nothing spent, the reaction kept, the hit standing. Exactly 60 feet reaches.", async () => {
  const enemy = await stage();
  // On open ground and on the board (20 by 15): the knight must see the ally too.
  kit.openField();
  kit.place(knight.id, 1, 5);
  kit.place(ally.id, 14, 5);
  kit.place(enemy.id, 14, 6);
  await strike(enemy, ally);
  const out = await shield([2]);
  assert.match(out.error, /beyond 60 feet/);
  assert.equal(used(), 0);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  assert.ok(reactionKept());
  kit.place(ally.id, 13, 5);
  const reached = await shield([2]);
  assert.equal(reached.ok, true, reached.error);
});

await test("The card is dealt for an ally at exactly 60 feet on the board, and not beyond.", async () => {
  const enemy = await stage();
  await strike(enemy, ally);
  const card = (feet) => reactionCards(world.sheet(knight.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets(), "you", feet).filter((entry) => entry.name === "Runic Shield");
  const apart = () => ({ [ally.id]: tilesApart(kit.token(knight.id), kit.token(ally.id)) * 5 });
  kit.place(ally.id, 5, 17);
  assert.equal(apart()[ally.id], 60);
  assert.equal(card(apart()).length, 1);
  kit.place(ally.id, 5, 18);
  assert.equal(apart()[ally.id], 65);
  assert.equal(card(apart()).length, 0);
});

await test("A reroll that misses gives the hit points back, spends one use and the reaction, and answers the hit.", async () => {
  const enemy = await stage();
  await strike(enemy, ally);
  const out = await shield([2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 50);
  assert.equal(used(), 1);
  assert.equal(reactionKept(), false);
  assert.match(out.result.applied, /6 against AC 12 misses/);
  assert.equal(offered().length, 0, "the hit is answered");
});

await test("A reroll that hits stands: one use spent, the card gone, and the same hit cannot be answered again.", async () => {
  const enemy = await stage();
  await strike(enemy, ally);
  const out = await shield([15]);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /19 against AC 12 still hits/);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  assert.equal(used(), 1);
  assert.equal(offered().length, 0, "the hit is answered");
  // The reaction back, the hit is still answered: it refuses and spends nothing.
  encounters.saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  const again = await shield([2]);
  assert.equal(again.ok, false, JSON.stringify(again));
  assert.equal(used(), 1);
  assert.equal(world.sheet(ally.id).currentHp, 44);
});

await test("The new roll is the roll on record: a later reaction reads it, not the first.", async () => {
  // Cutting Words reads the roll on record: 13 less a 6 misses AC 12, where the first 20 less a 6 would hit.
  const bard = hero("bard", "College of Lore");
  const enemy = await stage();
  kit.place(bard.id, 5, 6);
  await strike(enemy, ally);
  const out = await shield([9]);
  assert.match(out.result.applied, /13 against AC 12 still hits/);
  world.dice(6);
  const words = await world.invoke("use_reaction", { characterId: bard.id, feature: "Cutting Words", targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(words.ok, true, words.error);
  assert.equal(world.sheet(ally.id).currentHp, 50, "the words turn the rerolled 13 into a miss");
});

await test("A critical another reaction already cut, then rolled away: the ally never ends up worse off.", async () => {
  // The club's 1d6+2 on a 20 with 4s: 10 as a critical, 6 as the plain blow.
  const rogue = world.addHero({
    user: world.owner, class: "rogue", level: 5, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    features: [{ name: "Uncanny Dodge", source: "class" }],
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
  let enemy = await stage();
  kit.place(rogue.id, 5, 6);
  world.patch(rogue.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  await strike(enemy, rogue, [20, 4, 4]);
  assert.equal(world.sheet(rogue.id).currentHp, 40);
  const dodged = await world.invoke("use_reaction", { characterId: rogue.id, feature: "Uncanny Dodge" });
  assert.equal(dodged.ok, true, dodged.error);
  assert.equal(world.sheet(rogue.id).currentHp, 45);
  let out = await shield([15], rogue);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.applied, /no longer a critical/i);
  assert.equal(world.sheet(rogue.id).currentHp, 47, "the dodge halves the plain 6 as it halved the critical");

  const bard = hero("bard", "College of Lore");
  enemy = await stage();
  kit.place(bard.id, 5, 6);
  await strike(enemy, ally, [20, 4, 4]);
  world.dice(6);
  const words = await world.invoke("use_reaction", { characterId: bard.id, feature: "Cutting Words", targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(words.ok, true, words.error);
  assert.equal(world.sheet(ally.id).currentHp, 46);
  out = await shield([15]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 50, "the plain 6 less the 6 the words took");
});

await test("A natural 1 on the reroll misses whatever the total, and a natural 20 hits whatever the AC.", async () => {
  let enemy = await stage();
  world.patch(ally.id, { ac: 3 });
  await strike(enemy, ally);
  let out = await shield([1]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 50, "5 beats AC 3, and a natural 1 misses");

  enemy = await stage();
  world.patch(ally.id, { ac: 30 });
  await strike(enemy, ally, [20, 4, 4]);
  const hurt = world.sheet(ally.id).currentHp;
  assert.ok(hurt < 50);
  out = await shield([20]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, hurt, "a natural 20 stands");
});

await test("An attack with advantage is rolled again on one die and uses it: the other high die does not save the hit.", async () => {
  const enemy = await stage();
  await strike(enemy, ally, [18, 16, 4], { advantage: "advantage" });
  assert.equal(world.sheet(ally.id).currentHp, 44);
  const out = await shield([2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 50);
});

await test("A natural 20 rolled away lands as an ordinary hit, and a natural 20 gained makes the hit a critical.", async () => {
  let enemy = await stage();
  await strike(enemy, ally, [20, 4, 4]);
  assert.equal(world.sheet(ally.id).currentHp, 40, "4 + 4 + 2, a critical");
  let out = await shield([15]);
  assert.match(out.result.applied, /still hits/);
  assert.match(out.result.applied, /no longer a critical/i);
  assert.equal(world.sheet(ally.id).currentHp, 44, "the critical's die comes back");

  // The club's 4 + 2 stands, and the critical's die is rolled now: a 5, for 11.
  enemy = await stage();
  await strike(enemy, ally);
  out = await shield([20, 5]);
  assert.match(out.result.applied, /becomes a critical: 5 more damage/);
  assert.equal(world.sheet(ally.id).currentHp, 39);
});

// Two goblins in one GM turn leave two open hits on the ally, of 6 and of 3.
async function twoHits() {
  await stage();
  const [first, second] = world.enemies();
  // Both have had their place in the order this round, so the AI may play them.
  const order = world.encounter().order;
  const goblins = order.filter((entry) => entry.kind === "enemy");
  encounters.saveEncounter({ ...world.encounter(), order: [...goblins, ...order.filter((entry) => entry.kind !== "enemy")], turnIndex: goblins.length, turnBudget: null });
  const ai = { kind: "ai", turnId: createDmTurn(world.campaignId, [], "ai").id };
  for (const [enemy, faces] of [[first, [16, 4]], [second, [16, 1]]]) {
    world.dice(...faces);
    const out = await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: enemy.id, targetCharacterId: ally.id } });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  }
  assert.equal(world.sheet(ally.id).currentHp, 41);
}

await test("Two open hits on the ally: one card each, and unnamed the reaction answers the heavier.", async () => {
  await twoHits();
  assert.equal(offered().length, 2, "one card a hit");
  const out = await shield([2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 47, "the blow of 6 comes back, the 3 stands");
  assert.equal(used(), 1);
  assert.equal(offered().length, 1, "the other hit is still open");
});

await test("A card answers the hit it names, and that hit names the ally when the call does not.", async () => {
  await twoHits();
  const light = hits().find((hit) => hit.damage === 3);
  world.dice(2);
  const out = await world.invoke("use_reaction", { characterId: knight.id, feature: "Runic Shield", hit: light.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 44, "the blow of 3 comes back, the 6 stands");
});

await test("A downed ally: a ranged natural 20 rolled away is one death-save failure, and a melee blow beside them stays two.", async () => {
  const down = () => world.patch(ally.id, { currentHp: 0, deathSaves: { successes: 0, failures: 0, stable: false }, conditions: ["unconscious", "prone"], conditionMeta: {} });
  const failures = () => world.sheet(ally.id).deathSaves.failures;

  let enemy = await stage();
  const stats = enemy.stats;
  kit.setEnemy(enemy.id, { stats: { ...stats, attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.place(enemy.id, 5, 12);
  down();
  await strike(enemy, ally, [20, 3, 4, 4]);
  assert.equal(failures(), 2);
  let out = await shield([15]);
  assert.match(out.result.applied, /still hits/);
  assert.equal(failures(), 1, "a 15 at range is no critical");

  enemy = await stage();
  down();
  await strike(enemy, ally, [20, 3, 4, 4]);
  assert.equal(failures(), 2);
  out = await shield([15]);
  assert.match(out.result.applied, /still hits/);
  assert.equal(failures(), 2, "a melee blow beside them is a critical whatever the die");
  world.patch(ally.id, { deathSaves: { successes: 0, failures: 0, stable: false } });
});

await test("With its uses spent there is no card, and the reaction refuses with nothing changed.", async () => {
  const enemy = await stage();
  const resources = world.sheet(knight.id).resources;
  world.patch(knight.id, { resources: { ...resources, [COUNTER]: { ...resources[COUNTER], used: resources[COUNTER].max } } });
  await strike(enemy, ally);
  assert.equal(offered().length, 0);
  const out = await shield([2]);
  assert.match(out.error, /nothing left/);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  assert.ok(reactionKept());
});

await test("A knight below 7th level has no Runic Shield: no card, and the reaction refuses.", async () => {
  const young = hero("fighter", "Rune Knight", 6);
  const enemy = await stage(young);
  await strike(enemy, ally);
  assert.equal(offered(young).length, 0);
  const out = await shield([2], ally, young);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(world.sheet(ally.id).currentHp, 44);
});

await test("use_resource refuses it and says to use the reaction.", async () => {
  await stage();
  const out = await world.invoke("use_resource", { characterId: knight.id, resource: "Runic Shield" });
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.match(out.error, /use_reaction/);
  assert.equal(used(), 0);
});

world.close();
finish();
