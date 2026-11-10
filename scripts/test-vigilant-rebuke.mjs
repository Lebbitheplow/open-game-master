// Vigilant Rebuke (Oath of the Watchers 15) answers a successful Intelligence,
// Wisdom or Charisma save, and its card came up whenever an attack hit the
// paladin, a trigger it does not have. The engine's saves keep who forced them
// (src/lib/dm/last-save.ts), and the reaction answers only a save on record:
// SRD 5.1, Reactions, "an instant response to a trigger of some kind". It was
// once taken on the call's word with any creature named and no save at all.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-vigilant-rebuke");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const { FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");

const paladin = world.addHero({
  class: "paladin", subclass: "Oath of the Watchers", level: 15, maxHp: 100, abilities: { cha: 16 }, proficiencies: TRAINED,
  portrait: { url: "/uploads/test.png" },
});
const friend = world.addHero({ class: "fighter", level: 5, maxHp: 100, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" } });
await kit.fight(1, { heroFaces: { [paladin.id]: 3, [friend.id]: 2 } });
const [enemy] = world.enemies();
kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
kit.place(paladin.id, 5, 5);
kit.place(enemy.id, 5, 6);

await test("A hit on the paladin offers no card.", () => {
  const hit = { id: "h1", characterId: paladin.id, hit: true, hits: 1, source: "attack", ranged: false, attacker: "Goblin", attackerId: enemy.id, attack: "Club", type: "bludgeoning", damage: 5, answered: [] };
  const cards = reactionCards(world.sheet(paladin.id), { ...FRESH_TURN, myTurn: false }, [hit], []);
  assert.equal(cards.some((card) => card.name === "Vigilant Rebuke"), false);
});

await test("With no save on record it is refused, and spends nothing.", async () => {
  const out = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Vigilant Rebuke" });
  assert.equal(out.ok, false);
  assert.equal(out.refused, "rules");
  assert.match(out.error, /none on record/);
  assert.equal(world.encounter().reactionsUsed.includes(paladin.id), false);
});

await test("An open hit on the paladin does not stand in for the creature named.", async () => {
  kit.freshRound();
  world.dice(19, 4);
  assert.equal((await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: paladin.id })).ok, true);
  world.clearDice();
  const before = world.enemies()[0].currentHp;
  const out = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Vigilant Rebuke" });
  assert.equal(out.ok, false);
  assert.match(out.error, /none on record/);
  assert.equal(world.enemies()[0].currentHp, before);
  assert.equal(world.encounter().reactionsUsed.includes(paladin.id), false);
});

await test("Naming a creature does not stand in for a save it forced.", async () => {
  const before = world.enemies()[0].currentHp;
  world.dice(4, 4);
  const out = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Vigilant Rebuke", targetEnemyId: enemy.id });
  world.clearDice();
  assert.equal(out.ok, false, "with no save on record the creature named was struck");
  assert.equal(world.enemies()[0].currentHp, before);
  assert.equal(world.encounter().reactionsUsed.includes(paladin.id), false);
});

// Nothing kept who forced a save, so Vigilant Rebuke had no card at all and
// its call named a creature on trust. The engine's saves now keep their
// forcer for the turn (src/lib/dm/last-save.ts).
const party = [{ id: friend.id, name: "Friend" }];
const forceSave = async (target, ability, face) => {
  kit.freshRound();
  world.dice(face, 1);
  const out = await world.invoke("cast_at_player", { characterId: target.id, casterEnemyId: enemy.id, saveAbility: ability, dc: 12, damage: "1d4" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const reactionBack = () => kit.saveEncounter({ ...world.encounter(), reactionsUsed: [] });
// The view sends every open trigger (failed saves too); these are the saves made.
const savesNow = () => (activePublicEncounter(world.campaignId)?.lastSaves ?? []).filter((save) => (save.kind ?? "save") === "save" && save.success !== false && ["int", "wis", "cha"].includes(save.ability));
const rebukeCards = (feet) => reactionCards(world.sheet(paladin.id), { ...FRESH_TURN, myTurn: false }, [], party, "you", feet, savesNow()).filter((card) => card.name === "Vigilant Rebuke");

await test("A failed save, or a Dexterity one, offers nothing.", async () => {
  kit.freshRound();
  reactionBack();
  kit.place(friend.id, 6, 5);
  await forceSave(friend, "wis", 2);
  await forceSave(friend, "dex", 19);
  assert.equal(savesNow().length, 0);
  assert.equal(rebukeCards().length, 0);
});

await test("An ally's Wisdom save made against a creature offers the card, aimed at that creature, within 30 feet.", async () => {
  await forceSave(friend, "wis", 19);
  assert.equal(savesNow().length, 1);
  const [card] = rebukeCards({ [friend.id]: 10 });
  assert.ok(card, "the card");
  assert.equal(card.answers.attackerId, enemy.id);
  assert.equal(card.target, "enemy");
  assert.equal(rebukeCards({ [friend.id]: 35 }).length, 0, "beyond 30 feet");
});

await test("The call needs no name with a save on record, deals the damage to its forcer, and answers it once.", async () => {
  const before = world.enemies()[0].currentHp;
  world.dice(4, 4);
  const out = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Vigilant Rebuke" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(before - world.enemies()[0].currentHp, 11);
  assert.equal(savesNow().length, 0);
  assert.equal(rebukeCards().length, 0);
});

await test("With saves on record, a creature that forced none of them is refused.", async () => {
  kit.freshRound();
  reactionBack();
  await forceSave(paladin, "cha", 19);
  const out = await world.invoke("use_reaction", { characterId: paladin.id, feature: "Vigilant Rebuke", targetEnemyId: "nobody" });
  assert.equal(out.ok, false);
  assert.equal(world.encounter().reactionsUsed.includes(paladin.id), false);
});

world.close();
finish();
