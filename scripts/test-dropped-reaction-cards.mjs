// A reaction that acts on the hit itself is taken as the hit lands, so the engine
// asks it as the holder stood before it (reaction-kinds.ts). The Hand asked it as
// they stand now, and a holder that very hit dropped found Uncanny Dodge, Parry,
// Shield and the like shut, though the same call worked from the GM's seat. The
// card now asks the engine's own table. One that follows the damage stays shut, as
// does any card for a holder already down when the hit landed.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-dropped-reaction-cards");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { intentRefusal } = await import("../src/lib/dm/intent-check.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");

const hero = (extra) =>
  world.addHero({
    user: world.owner, level: 20, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 },
    portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    ...extra,
  });
const slots = { 1: { max: 4, used: 0 } };
const rogue = hero({ class: "rogue", subclass: "Thief" });
const monk = hero({ class: "monk", subclass: "Open Hand" });
const master = hero({ class: "fighter", subclass: "Battle Master" });
world.patch(master.id, {
  features: [...world.sheet(master.id).features, { name: "Maneuver: Parry", source: "class" }],
  resources: { ...world.sheet(master.id).resources, sub_superiority_dice: { max: 6, used: 0 } },
});
const wizard = hero({ class: "wizard", spellcasting: { ability: "int", slots, prepared: ["Shield"], known: [], cantrips: [] } });
const warlock = hero({ class: "warlock", spellcasting: { ability: "cha", slots, prepared: [], known: ["Hellish Rebuke"], cantrips: [] } });
const light = hero({ class: "cleric", subclass: "Light Domain" });
const stalker = hero({ class: "ranger", subclass: "Gloom Stalker" });
const friend = hero({ class: "fighter", subclass: "Champion" });

async function stage(who, hp = 8) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [who.id]: 3, [friend.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(who.id, 5, 5);
  kit.place(friend.id, 4, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  world.patch(who.id, { currentHp: hp, conditions: [], conditionMeta: {}, deathSaves: null });
  world.patch(friend.id, { currentHp: 50, conditions: [], conditionMeta: {}, deathSaves: null });
  return enemy;
}
// A club at +4, 1d6+2. A natural 20 of 4 + 3 + 2 = 9 drops a holder at 8; 14 to
// hit, against AC 12, is one Shield's +5 would turn aside.
const strike = async (enemy, target, faces = [20, 4, 3]) => {
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const hits = () => activePublicEncounter(world.campaignId)?.lastHits ?? [];
const cardOf = (who, name, list = hits()) =>
  reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, list, world.sheets()).find((card) => card.name === name);

const OPEN = [
  { name: "Uncanny Dodge", who: rogue, faces: [20, 4, 3] },
  { name: "Parry", who: master, faces: [20, 4, 3] },
  { name: "Shield", who: wizard, hp: 6, faces: [10, 4] },
  { name: "Warding Flare", who: light, faces: [20, 4, 3] },
  // By what it does to the hit, not by a name on the engine's list.
  { name: "Shadowy Dodge", who: stalker, faces: [20, 4, 3] },
];
for (const { name, who, hp, faces } of OPEN) {
  await test(`${name} is open to a holder the hit just dropped, and the engine takes it.`, async () => {
    const enemy = await stage(who, hp);
    await strike(enemy, who, faces);
    assert.equal(world.sheet(who.id).currentHp, 0, "the hit drops them");
    const card = cardOf(who, name);
    assert.ok(card, `${name} is offered`);
    assert.equal(card.disabled, null, card.disabled);
    // The route the player's card takes, then the call the GM makes.
    assert.equal(intentRefusal(getCampaignById(world.campaignId), world.sheet(who.id), card.intent), null);
    const out = await world.invoke("use_reaction", { characterId: who.id, feature: name });
    assert.equal(out.ok, true, out.error);
    assert.ok(world.encounter().reactionsUsed.includes(who.id), `${name} spends the reaction`);
  });
}

await test("Parry spends its one die on a holder the blow dropped, and none with no die left.", async () => {
  const fresh = { ...world.sheet(master.id).resources, sub_superiority_dice: { max: 6, used: 0 } };
  let enemy = await stage(master);
  world.patch(master.id, { resources: fresh });
  await strike(enemy, master);
  const out = await world.invoke("use_reaction", { characterId: master.id, feature: "Parry" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(master.id).resources.sub_superiority_dice.used, 1);
  enemy = await stage(master);
  world.patch(master.id, { resources: { ...fresh, sub_superiority_dice: { max: 6, used: 6 } } });
  await strike(enemy, master);
  const none = await world.invoke("use_reaction", { characterId: master.id, feature: "Parry" });
  assert.equal(none.ok, false);
  assert.match(none.error, /Superiority Dice/);
  assert.equal(world.sheet(master.id).currentHp, 0);
});

await test("Hellish Rebuke follows the damage: shut to a holder the hit dropped, and refused by the engine.", async () => {
  const enemy = await stage(warlock);
  await strike(enemy, warlock);
  assert.equal(world.sheet(warlock.id).currentHp, 0);
  const card = cardOf(warlock, "Hellish Rebuke");
  assert.ok(card, "the card is shown, with its reason");
  assert.match(card.disabled, /at 0 HP/);
  assert.match(intentRefusal(getCampaignById(world.campaignId), world.sheet(warlock.id), card.intent) ?? "", /follows the damage/);
  const out = await world.invoke("use_reaction", { characterId: warlock.id, feature: "Hellish Rebuke", targetEnemyId: world.enemies()[0].id });
  assert.equal(out.ok, false);
});

await test("Deflect Missiles and Slow Fall, read from the hit that dropped the monk, are open.", async () => {
  const enemy = await stage(monk);
  await strike(enemy, monk);
  assert.equal(world.sheet(monk.id).currentHp, 0);
  const [blow] = hits();
  const deflect = cardOf(monk, "Deflect Missiles", [{ ...blow, ranged: true }]);
  assert.ok(deflect, "Deflect Missiles is offered");
  assert.equal(deflect.disabled, null, deflect.disabled);
  assert.equal(intentRefusal(getCampaignById(world.campaignId), world.sheet(monk.id), deflect.intent), null);
  const fall = cardOf(monk, "Slow Fall", [{ ...blow, source: "fall" }]);
  assert.ok(fall, "Slow Fall is offered");
  assert.equal(fall.disabled, null, fall.disabled);
});

await test("A holder already down when the hit landed has no reaction to take.", async () => {
  const enemy = await stage(rogue, 0);
  world.patch(rogue.id, { conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0 } });
  await strike(enemy, rogue, [16, 16, 4, 3]);
  const card = cardOf(rogue, "Uncanny Dodge");
  assert.ok(card);
  assert.match(card.disabled, /at 0 HP/);
  const out = await world.invoke("use_reaction", { characterId: rogue.id, feature: "Uncanny Dodge" });
  assert.equal(out.ok, false);
});

await test("A holder who is down has no card for a hit on someone else.", async () => {
  const enemy = await stage(light);
  await strike(enemy, friend, [16, 4]);
  world.patch(light.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0 } });
  const cards = reactionCards(world.sheet(light.id), { ...FRESH_TURN, myTurn: false }, hits(), world.sheets());
  assert.ok(cards.length > 0, "a card is dealt, shut");
  for (const card of cards) {
    assert.ok(card.disabled, `${card.name} is shut`);
    assert.ok(intentRefusal(getCampaignById(world.campaignId), world.sheet(light.id), card.intent), `${card.name} is refused`);
  }
});

await test("A standing holder's card is open as before.", async () => {
  const enemy = await stage(rogue, 50);
  await strike(enemy, rogue, [16, 4]);
  assert.equal(cardOf(rogue, "Uncanny Dodge").disabled, null);
});

world.close();
finish();
