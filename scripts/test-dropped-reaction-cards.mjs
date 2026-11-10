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
const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
const { handleEnemyAttack } = await import("../src/lib/dm/enemy-attack.ts");

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
const hexblade = hero({ class: "warlock", subclass: "The Hexblade" });
const runeKnight = hero({ class: "fighter", subclass: "Rune Knight" });
const echoKnight = hero({ class: "fighter", subclass: "Echo Knight" });
const cavalier = hero({ class: "fighter", subclass: "Cavalier" });

async function stage(who, hp = 8, foes = 1) {
  await kit.endFight();
  await kit.fight(foes, { heroFaces: { [who.id]: 3, [friend.id]: 2 } });
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

await test("Armor of Hexes turns the cursed creature's hit aside: a card for a warlock that hit dropped, and none against another attacker.", async () => {
  const enemy = await stage(hexblade);
  const curse = (quarry) => world.patch(hexblade.id, { currentHp: 8, conditions: ["hexblade's curse"], conditionMeta: { "hexblade's curse": { quarry } } });
  curse(enemy.id);
  await strike(enemy, hexblade);
  assert.equal(world.sheet(hexblade.id).currentHp, 0);
  const card = cardOf(hexblade, "Armor of Hexes");
  assert.ok(card, "Armor of Hexes is offered");
  assert.equal(card.disabled, null, card.disabled);
  assert.equal(intentRefusal(getCampaignById(world.campaignId), world.sheet(hexblade.id), card.intent), null);
  world.dice(5);
  const out = await world.invoke("use_reaction", { characterId: hexblade.id, feature: "Armor of Hexes" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hexblade.id).currentHp, 8, "a 5 on the d6 turns the hit into a miss");

  const other = await stage(hexblade, 50);
  curse("someone-else");
  await strike(other, hexblade, [16, 4]);
  assert.equal(cardOf(hexblade, "Armor of Hexes"), undefined, "no card against a creature the curse does not name");
});

await test("A fallen Rune Knight or Echo Knight is refused for an ally's hit for being down, not for following damage.", async () => {
  const enemy = await stage(friend, 50);
  for (const who of [runeKnight, echoKnight]) {
    // The Echo Knight's echo is still marked out as they fall, so the card is
    // dealt and the bar that holds is their being down.
    const echo = who === echoKnight ? ["echo manifested"] : [];
    world.patch(who.id, { currentHp: 0, conditions: ["unconscious", "prone", ...echo], conditionMeta: {}, deathSaves: { successes: 0, failures: 0, stable: false } });
  }
  await strike(enemy, friend, [16, 4]);
  for (const [who, name] of [[runeKnight, "Runic Shield"], [echoKnight, "Shadow Martyr"]]) {
    const card = cardOf(who, name);
    assert.ok(card, `${name} is dealt, shut`);
    assert.match(card.disabled, /at 0 HP/);
    const refused = intentRefusal(getCampaignById(world.campaignId), world.sheet(who.id), { ...card.intent, targetKind: "ally", targetId: friend.id }) ?? "";
    assert.match(refused, /at 0 HP/);
    assert.doesNotMatch(refused, /follows the damage/);
    world.dice(2);
    const out = await world.invoke("use_reaction", { characterId: who.id, feature: name, targetCharacterId: friend.id });
    world.clearDice();
    assert.equal(out.ok, false);
    assert.doesNotMatch(out.error, /follows the damage/);
  }
  assert.equal(world.sheet(friend.id).currentHp, 44);
});

await test("Warding Maneuver for an ally is refused through use_resource to a fighter the last hit dropped, with nothing spent.", async () => {
  await stage(cavalier, 8, 2);
  const [first, second] = world.enemies();
  kit.place(second.id, 4, 6);
  const fresh = { ...world.sheet(cavalier.id).resources, sub_warding_maneuver: { ...world.sheet(cavalier.id).resources.sub_warding_maneuver, used: 0 } };
  world.patch(cavalier.id, { resources: fresh });
  // One pass of the enemies: the first drops the fighter, the second hits the friend beside them.
  const campaign = world.campaign();
  onPersonsTurn(campaign, (turn) => {
    for (const [enemy, target, faces] of [[first, cavalier, [20, 4, 3]], [second, friend, [16, 4]]]) {
      world.dice(...faces);
      const sheets = world.sheets();
      const out = handleEnemyAttack(campaign, turn, JSON.stringify({ enemyId: enemy.id, targetCharacterId: target.id }), sheets, new Map(sheets.map((entry) => [entry.id, entry])));
      world.clearDice();
      assert.equal(typeof out.error, "undefined", out.error);
    }
  });
  assert.equal(world.sheet(cavalier.id).currentHp, 0, "the hit drops the fighter");
  assert.equal(world.sheet(friend.id).currentHp, 44);
  world.dice(8);
  const out = await world.invoke("use_resource", { characterId: cavalier.id, resource: "Warding Maneuver", targetCharacterId: friend.id });
  world.clearDice();
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.match(out.error, /at 0 HP/);
  assert.equal(world.sheet(cavalier.id).resources.sub_warding_maneuver.used, 0);
  assert.equal(world.sheet(friend.id).currentHp, 44);
});

await test("Deflect Missiles, played by a monk a ranged hit dropped, takes the blow down.", async () => {
  const enemy = await stage(monk);
  kit.setEnemy(enemy.id, { stats: { ...enemy.stats, attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing" }] } });
  kit.place(enemy.id, 5, 9);
  await strike(enemy, monk);
  assert.equal(world.sheet(monk.id).currentHp, 0);
  const card = cardOf(monk, "Deflect Missiles");
  assert.ok(card, "Deflect Missiles is offered");
  assert.equal(card.disabled, null, card.disabled);
  world.dice(5);
  const out = await world.invoke("use_reaction", { characterId: monk.id, feature: "Deflect Missiles" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(monk.id).currentHp, 8, "1d10 + DEX + monk level takes all 9 off");
});

await test("A condition that stops reactions, put on by the blow that dropped them, is read as they stood, as the engine reads it.", async () => {
  const enemy = await stage(rogue);
  await strike(enemy, rogue);
  assert.equal(world.sheet(rogue.id).currentHp, 0);
  world.patch(rogue.id, { conditions: [...world.sheet(rogue.id).conditions, "slowed"] });
  const card = cardOf(rogue, "Uncanny Dodge");
  assert.equal(card.disabled, null, card.disabled);
  const out = await world.invoke("use_reaction", { characterId: rogue.id, feature: "Uncanny Dodge" });
  assert.equal(out.ok, true, out.error);
});

await test("Unaimed, a dropped holder's reaction answers the hit that dropped them, not a heavier one that found them down.", async () => {
  await stage(rogue, 8, 2);
  const [first, second] = world.enemies();
  kit.place(second.id, 4, 6);
  const campaign = world.campaign();
  onPersonsTurn(campaign, (turn) => {
    // The first drops the rogue (9 of 8); the second, beside them at 0, is a
    // critical on a 15: 6 + 6 + 2 = 14.
    for (const [enemy, faces] of [[first, [20, 4, 3]], [second, [15, 2, 6, 6]]]) {
      world.dice(...faces);
      const sheets = world.sheets();
      const out = handleEnemyAttack(campaign, turn, JSON.stringify({ enemyId: enemy.id, targetCharacterId: rogue.id }), sheets, new Map(sheets.map((entry) => [entry.id, entry])));
      world.clearDice();
      assert.equal(typeof out.error, "undefined", out.error);
    }
  });
  const out = await world.invoke("use_reaction", { characterId: rogue.id, feature: "Uncanny Dodge" });
  assert.equal(out.ok, true, out.error);
  const open = hits().filter((hit) => hit.characterId === rogue.id);
  assert.deepEqual(open.find((hit) => hit.attackerId === first.id)?.answered, ["uncanny dodge"], "the hit that dropped them is answered");
  assert.deepEqual(open.find((hit) => hit.attackerId === second.id)?.answered, [], "the later hit is not");
});

await test("A standing holder's card is open as before.", async () => {
  const enemy = await stage(rogue, 50);
  await strike(enemy, rogue, [16, 4]);
  assert.equal(cardOf(rogue, "Uncanny Dodge").disabled, null);
});

world.close();
finish();
