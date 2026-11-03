// Sentinel at Death's Door spent its use and left the critical standing, and
// its card sat in the Hand on the holder's own turn. A critical hit on the
// cleric or a creature within 30 feet now offers it, and it turns the blow into
// the normal hit it would have been, from the same dice.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-sentinel-deaths-door");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
const { handleEnemyAttack } = await import("../src/lib/dm/enemy-attack.ts");

const NAME = "Sentinel at Death's Door";
const COUNTER = "sub_sentinel_at_deaths_door";
const hero = (classId, subclass, level = 6) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const cleric = hero("cleric", "Grave Domain");
const ally = hero("fighter", "Champion");

async function stage(foes = 1) {
  await kit.endFight();
  await kit.fight(foes, { heroFaces: { [cleric.id]: 3 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(cleric.id, 5, 5);
  kit.place(ally.id, 5, 7);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  for (const who of [cleric, ally]) {
    world.patch(who.id, { currentHp: 50, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  world.patch(cleric.id, { resources: { ...world.sheet(cleric.id).resources, [COUNTER]: { ...world.sheet(cleric.id).resources[COUNTER], used: 0 } } });
  return enemy;
}
// A club at +4, 1d6+2: a natural 20 rolls 1d6+1d6+2, here 4 + 3 + 2 = 9; the
// same blow as a normal hit is 4 + 2 = 6.
const crit = async (enemy, target) => {
  world.dice(20, 4, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const plain = async (enemy, target) => {
  world.dice(16, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
// Attacks of one pass of the enemies, which leave each other's hits open.
const samePass = (attacks) => {
  const campaign = world.campaign();
  onPersonsTurn(campaign, (turn) => {
    for (const { enemy, target, faces } of attacks) {
      world.dice(...faces);
      const sheets = world.sheets();
      const out = handleEnemyAttack(campaign, turn, JSON.stringify({ enemyId: enemy.id, targetCharacterId: target.id }), sheets, new Map(sheets.map((entry) => [entry.id, entry])));
      world.clearDice();
      assert.equal(typeof out.error, "undefined", out.error);
    }
  });
};
const react = (target) => world.invoke("use_reaction", { characterId: cleric.id, feature: NAME, ...(target ? { targetCharacterId: target.id } : {}) });
const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
const offered = () => reactionCards(world.sheet(cleric.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets()).filter((card) => card.name === NAME);
const used = () => world.sheet(cleric.id).resources[COUNTER].used;

await test("No card on the holder's own turn, and none with no hit open.", async () => {
  await stage();
  assert.equal(deriveHand(world.sheet(cleric.id), FRESH_TURN, {}).some((card) => card.name === NAME), false);
  assert.equal(offered().length, 0);
});

await test("A normal hit offers no card and is refused with nothing spent.", async () => {
  const enemy = await stage();
  await plain(enemy, cleric);
  assert.equal(world.sheet(cleric.id).currentHp, 44);
  assert.equal(offered().length, 0);
  const out = await react();
  assert.equal(out.ok, false);
  assert.match(out.error, /critical hit/);
  assert.equal(used(), 0);
  assert.equal(world.encounter().reactionsUsed.includes(cleric.id), false);
});

await test("A critical on the cleric comes back to normal damage, once.", async () => {
  const enemy = await stage();
  await crit(enemy, cleric);
  assert.equal(world.sheet(cleric.id).currentHp, 41);
  const [card] = offered();
  assert.ok(card, "the critical offers the card");
  assert.equal(card.target, "none");
  const out = await react();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(cleric.id).currentHp, 44);
  assert.equal(used(), 1);
  assert.ok(world.encounter().reactionsUsed.includes(cleric.id));
  assert.equal(offered().length, 0, "the hit is answered");

  // Answered once: the hit is still open and the reaction back, and it is not
  // answered twice.
  encounters.saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  assert.equal(hits().find((hit) => hit.characterId === cleric.id)?.answered.length, 1, "the hit stays open, answered");
  const again = await react();
  assert.equal(again.ok, false);
  assert.match(again.error, /critical hit/);
  assert.equal(world.sheet(cleric.id).currentHp, 44);
  assert.equal(used(), 1);
});

await test("A multiattack: the card names the critical, not the heavier normal hit, and only that blow changes.", async () => {
  const enemy = await stage();
  kit.setEnemy(enemy.id, {
    stats: {
      attacks: [
        { name: "Scimitar", toHit: 4, damage: "1d6+2", type: "slashing" },
        { name: "Maul", toHit: 4, damage: "2d6+9", type: "bludgeoning" },
      ],
      routines: [[{ attack: "Scimitar", count: 1 }, { attack: "Maul", count: 1 }]],
    },
  });
  // The scimitar's natural 20: 4 + 3 + 2 = 9. The maul: 5 + 5 + 9 = 19.
  world.dice(20, 4, 3, 16, 5, 5);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: cleric.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(cleric.id).currentHp, 50 - 9 - 19);
  const [card] = offered();
  assert.match(card.rules, /critical Scimitar \(9\)/);
  const reacted = await react();
  assert.equal(reacted.ok, true, reacted.error);
  assert.equal(world.sheet(cleric.id).currentHp, 50 - 6 - 19);
});

await test("With a critical and a normal hit open, a card aimed at the normal hit is refused with nothing spent.", async () => {
  const enemy = await stage(2);
  const second = world.enemies()[1];
  kit.setEnemy(second.id, { maxHp: 300, currentHp: 300 });
  kit.place(second.id, 4, 5);
  samePass([
    { enemy, target: cleric, faces: [16, 4] },
    { enemy: second, target: cleric, faces: [20, 4, 3] },
  ]);
  assert.equal(world.sheet(cleric.id).currentHp, 50 - 6 - 9);
  const open = hits().filter((hit) => hit.characterId === cleric.id);
  assert.equal(open.length, 2, "both hits stay open");
  const normal = open[0];
  const refused = await world.invoke("use_reaction", { characterId: cleric.id, feature: NAME, hit: normal.id });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /critical hit/);
  assert.equal(used(), 0);
  assert.equal(offered().length, 1);
  const [card] = offered();
  assert.ok(card.answers.hitId && card.answers.hitId !== normal.id, "the card answers the critical");
  const out = await world.invoke("use_reaction", { characterId: cleric.id, feature: NAME, hit: card.answers.hitId });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(cleric.id).currentHp, 50 - 6 - 6);
});

await test("A blow of two types comes back part by part: a tiefling still halves only the fire.", async () => {
  const tiefling = world.addHero({
    user: world.owner, class: "fighter", race: "Tiefling", level: 6, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16 }, portrait: { url: "/uploads/test.png" },
  });
  const enemy = await stage();
  kit.place(tiefling.id, 4, 6);
  kit.setEnemy(enemy.id, { stats: { attacks: [{ name: "Bite", toHit: 4, damage: "1d6+1d6", type: "piercing/fire", riders: [{ dice: "1d6", type: "fire" }] }] } });
  kit.freshRound();
  world.patch(tiefling.id, { currentHp: 50 });
  // The critical: 4 + 3 piercing, 6 + 2 fire, which halves to 4: 11.
  world.dice(20, 4, 3, 6, 2);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tiefling.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(tiefling.id).currentHp, 50 - 7 - 4);
  const reacted = await react(tiefling);
  assert.equal(reacted.ok, true, reacted.error);
  // As a normal hit: 4 piercing, 6 fire, which halves to 3.
  assert.equal(world.sheet(tiefling.id).currentHp, 50 - 4 - 3);
});

await test("After another reaction cut the blow, the normal hit keeps the cut in proportion.", async () => {
  const rogue = hero("rogue", "Thief");
  const enemy = await stage();
  kit.place(rogue.id, 4, 6);
  kit.freshRound();
  world.patch(rogue.id, { currentHp: 50 });
  await crit(enemy, rogue);
  assert.equal(world.sheet(rogue.id).currentHp, 41);
  const dodged = await world.invoke("use_reaction", { characterId: rogue.id, feature: "Uncanny Dodge" });
  assert.equal(dodged.ok, true, dodged.error);
  const halved = 50 - world.sheet(rogue.id).currentHp;
  const out = await react(rogue);
  assert.equal(out.ok, true, out.error);
  assert.equal(50 - world.sheet(rogue.id).currentHp, Math.round((6 * halved) / 9));
});

await test("An enemy's critical opportunity attack is answered the same way.", async () => {
  const runner = world.addHero({ class: "fighter", level: 6, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED, abilities: { dex: 16 }, speed: 30, portrait: { url: "/uploads/test.png" } });
  await stage();
  kit.place(runner.id, 5, 7);
  kit.freshRound();
  world.patch(runner.id, { currentHp: 50 });
  kit.giveTurn(runner.id);
  world.dice(20, 4, 3);
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: runner.userId });
  const moved = await route.POST(new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 5, y: 10 }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
  world.signIn(world.owner);
  world.clearDice();
  assert.equal(moved.status, 200);
  assert.equal(world.sheet(runner.id).currentHp, 41, "struck as they left");
  assert.equal(offered().length, 1);
  const out = await react(runner);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(runner.id).currentHp, 44);
});

await test("A critical on an ally within 30 feet: the card aims at the ally, whose damage comes back.", async () => {
  const enemy = await stage();
  await crit(enemy, ally);
  assert.equal(world.sheet(ally.id).currentHp, 41);
  const [card] = offered();
  assert.ok(card);
  assert.equal(card.target, "ally");
  assert.equal(card.answers.characterId, ally.id);
  const out = await react(ally);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  assert.equal(world.sheet(cleric.id).currentHp, 50);
  assert.equal(used(), 1);
});

await test("An ally beyond 30 feet is refused with nothing spent.", async () => {
  const enemy = await stage();
  kit.place(ally.id, 5, 25);
  kit.place(enemy.id, 5, 24);
  kit.freshRound();
  await crit(enemy, ally);
  const out = await react(ally);
  assert.equal(out.ok, false);
  assert.match(out.error, /beyond 30 feet/);
  assert.equal(world.sheet(ally.id).currentHp, 41);
  assert.equal(used(), 0);
  assert.equal(world.encounter().reactionsUsed.includes(cleric.id), false);
});

await test("A critical that dropped them to 0 leaves them standing when the normal hit would not have.", async () => {
  const enemy = await stage();
  world.patch(ally.id, { currentHp: 8 });
  await crit(enemy, ally);
  assert.equal(world.sheet(ally.id).currentHp, 0);
  assert.ok(world.sheet(ally.id).conditions.includes("unconscious"));
  const out = await react(ally);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 2);
  assert.equal(world.sheet(ally.id).conditions.includes("unconscious"), false);
});

await test("A critical that dropped the cleric still offers their own card, and it stands them back up.", async () => {
  const enemy = await stage();
  world.patch(cleric.id, { currentHp: 8 });
  await crit(enemy, cleric);
  assert.equal(world.sheet(cleric.id).currentHp, 0);
  const [card] = offered();
  assert.ok(card, "the card is offered");
  assert.equal(card.disabled, null, card.disabled);
  const out = await react();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(cleric.id).currentHp, 2);
  assert.equal(used(), 1);
});

await test("A cleric already down when the critical landed has no reaction to take.", async () => {
  const enemy = await stage();
  world.patch(cleric.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0 } });
  kit.place(enemy.id, 5, 8);
  kit.freshRound();
  world.dice(16, 16, 4, 3);
  const struck = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: cleric.id });
  world.clearDice();
  assert.equal(struck.ok, true, struck.error);
  for (const card of offered()) assert.ok(card.disabled, "the card is shut");
  const out = await react();
  assert.equal(out.ok, false);
  assert.equal(used(), 0);
});

await test("An unconscious target's automatic critical: normal damage, one death-save failure, and they stay down.", async () => {
  const enemy = await stage();
  world.patch(ally.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0 } });
  kit.place(enemy.id, 5, 8);
  kit.freshRound();
  // At 0 and within 5 feet: advantage, and any hit is critical (SRD 5.1).
  world.dice(16, 16, 4, 3);
  const struck = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(struck.ok, true, struck.error);
  assert.equal(world.sheet(ally.id).deathSaves.failures, 2, "a critical deals two failures");
  assert.equal(offered().length, 1);
  const out = await react(ally);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).deathSaves.failures, 1, "the normal hit deals one");
  assert.equal(world.sheet(ally.id).currentHp, 0);
  assert.equal(used(), 1);
});

await test("Once the first critical no longer drops them, a later critical only for lying at 0 is no card and no second use.", async () => {
  const enemy = await stage(2);
  const second = world.enemies()[1];
  kit.setEnemy(second.id, { maxHp: 300, currentHp: 300 });
  kit.place(second.id, 4, 7);
  world.patch(ally.id, { currentHp: 8 });
  // A natural 20 drops them; the next blow finds them at 0, a critical for that.
  samePass([
    { enemy, target: ally, faces: [20, 4, 3] },
    { enemy: second, target: ally, faces: [16, 16, 4, 3] },
  ]);
  assert.equal(world.sheet(ally.id).deathSaves.failures, 2);
  const [first, later] = hits().filter((hit) => hit.characterId === ally.id);
  const out = await world.invoke("use_reaction", { characterId: cleric.id, feature: NAME, targetCharacterId: ally.id, hit: first.id });
  assert.equal(out.ok, true, out.error);
  // A normal 6 leaves them at 2, and the later blow lands on them standing as its normal 6.
  assert.equal(world.sheet(ally.id).currentHp, 0);
  assert.equal(world.sheet(ally.id).deathSaves?.failures ?? 0, 0);
  assert.equal(offered().length, 0);
  encounters.saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  const again = await world.invoke("use_reaction", { characterId: cleric.id, feature: NAME, targetCharacterId: ally.id, hit: later.id });
  assert.equal(again.ok, false);
  assert.match(again.error, /critical hit/);
  assert.equal(used(), 1);
});

await test("A natural 20 on a target already at 0 is answered the same way.", async () => {
  const enemy = await stage();
  world.patch(ally.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 1 } });
  kit.place(enemy.id, 5, 8);
  kit.freshRound();
  world.dice(20, 20, 4, 3);
  const struck = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(struck.ok, true, struck.error);
  assert.equal(world.sheet(ally.id).deathSaves.failures, 3);
  assert.equal(world.sheet(ally.id).deathSaves.dead, true);
  const out = await react(ally);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).deathSaves.failures, 2);
  assert.ok(!world.sheet(ally.id).deathSaves.dead);
});

await test("The last use spent: no card, and the reaction refuses.", async () => {
  const enemy = await stage();
  const state = world.sheet(cleric.id).resources[COUNTER];
  world.patch(cleric.id, { resources: { ...world.sheet(cleric.id).resources, [COUNTER]: { ...state, used: state.max } } });
  await crit(enemy, cleric);
  assert.equal(offered().length, 0);
  const out = await react();
  assert.equal(out.ok, false);
  assert.equal(world.sheet(cleric.id).currentHp, 41);
});

await test("A level before the feature: no card, and the reaction is refused.", async () => {
  const young = hero("cleric", "Grave Domain", 5);
  const enemy = await stage();
  kit.place(young.id, 4, 5);
  kit.freshRound();
  await crit(enemy, cleric);
  const cards = reactionCards(world.sheet(young.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets());
  assert.equal(cards.some((card) => card.name === NAME), false);
  const out = await world.invoke("use_reaction", { characterId: young.id, feature: NAME, targetCharacterId: cleric.id });
  assert.equal(out.ok, false);
  assert.equal(world.sheet(cleric.id).currentHp, 41);
});

await test("use_resource refuses it, and says to use the reaction.", async () => {
  await stage();
  const out = await world.invoke("use_resource", { characterId: cleric.id, resource: NAME });
  assert.equal(out.ok, false);
  assert.match(out.error, /use_reaction/);
  assert.equal(used(), 0);
});

world.close();
finish();
