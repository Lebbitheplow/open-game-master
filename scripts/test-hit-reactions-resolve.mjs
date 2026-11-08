// Four reactions that answer a hit spent their use and changed nothing: Warding
// Flare, Entropic Ward and Illusory Self left the hit standing, and Wrath of the
// Storm dealt no damage. Each now does what it says, from a card the hit offers.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-hit-reactions-resolve");
const world = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");

const hero = (classId, subclass) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level: 20, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });

async function stage(who) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [who.id]: 3 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(who.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  world.patch(who.id, { currentHp: 50, conditions: [], conditionMeta: {} });
  return enemy;
}
// A club at +4, 1d6+2: a 16 on the die is a 20, through AC 12, for 6.
const strike = async (enemy, target, faces = [16, 4]) => {
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
};
const react = async (who, feature, faces) => {
  world.dice(...faces);
  const out = await world.invoke("use_reaction", { characterId: who.id, feature });
  world.clearDice();
  return out;
};
const offered = (who, name) =>
  reactionCards(world.sheet(who.id), { ...FRESH_TURN, myTurn: false }, activePublicEncounter(world.campaignId)?.lastHits ?? [], world.sheets()).filter((card) => card.name === name);
const onOwnTurn = (who, name) => deriveHand(world.sheet(who.id), FRESH_TURN, {}).some((card) => card.name === name);
// The board's distances from the holder to each hero, as PlayerMapView.feet
// measures them for the Hand (view.ts): tilesApart on the stored tokens.
const { tilesApart } = await import("../src/lib/dm/board-reach.ts");
const feetFrom = (who) => {
  const me = kit.token(who.id);
  return Object.fromEntries(world.sheets().filter((sheet) => sheet.id !== who.id && kit.token(sheet.id)).map((sheet) => [sheet.id, tilesApart(me, kit.token(sheet.id)) * 5]));
};
const used = (who, id) => world.sheet(who.id).resources[id].used;

for (const [name, classId, subclass, counter] of [
  ["Warding Flare", "cleric", "Light Domain", "sub_warding_flare"],
  ["Entropic Ward", "warlock", "The Great Old One", "sub_entropic_ward"],
]) {
  const who = hero(classId, subclass);
  await test(`${name}: offered on the hit, no card on the holder's turn; a low reroll turns the hit into a miss.`, async () => {
    const enemy = await stage(who);
    assert.equal(onOwnTurn(who, name), false);
    assert.equal(offered(who, name).length, 0);
    await strike(enemy, who);
    assert.equal(world.sheet(who.id).currentHp, 44);
    assert.equal(offered(who, name).length, 1);
    const out = await react(who, name, [2]);
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(who.id).currentHp, 50);
    assert.equal(used(who, counter), 1);
    assert.equal(offered(who, name).length, 0, "the hit is answered");
  });
  await test(`${name}: a high reroll keeps the lower roll, and a hit that still beats AC stands.`, async () => {
    const enemy = await stage(who);
    world.patch(who.id, { resources: { ...world.sheet(who.id).resources, [counter]: { ...world.sheet(who.id).resources[counter], used: 0 } } });
    await strike(enemy, who);
    const out = await react(who, name, [18]);
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(who.id).currentHp, 44);
    assert.equal(used(who, counter), 1);
  });
}

await test("Warding Flare covers an ally within 30 feet with Improved Flare, and answers the ally's hit, not the cleric's.", async () => {
  const cleric = hero("cleric", "Light Domain");
  const ally = hero("fighter", "Champion");
  const enemy = await stage(cleric);
  kit.place(ally.id, 4, 5);
  world.patch(ally.id, { currentHp: 50 });
  kit.freshRound();
  await strike(enemy, ally);
  assert.equal(world.sheet(ally.id).currentHp, 44);
  assert.equal(offered(cleric, "Warding Flare").length, 1);
  const out = await world.invoke("use_reaction", { characterId: cleric.id, feature: "Warding Flare", targetCharacterId: ally.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp >= 44, true);
  assert.equal(world.sheet(cleric.id).currentHp, 50);
  await stage(cleric);
  kit.place(ally.id, 5, 25);
  world.patch(cleric.id, { resources: { ...world.sheet(cleric.id).resources, sub_warding_flare: { ...world.sheet(cleric.id).resources.sub_warding_flare, used: 0 } } });
  const far = await world.invoke("use_reaction", { characterId: cleric.id, feature: "Warding Flare", targetCharacterId: ally.id });
  assert.match(far.error, /beyond 30 feet/);
});

await test("Before Improved Flare, Warding Flare offers nothing for an ally and refuses one.", async () => {
  const young = world.addHero({ user: world.owner, class: "cleric", subclass: "Light Domain", level: 5, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED, abilities: { wis: 16 }, portrait: { url: "/uploads/test.png" } });
  const ally = hero("fighter", "Champion");
  const enemy = await stage(young);
  kit.place(ally.id, 4, 5);
  kit.freshRound();
  await strike(enemy, ally);
  assert.equal(offered(young, "Warding Flare").length, 0);
  const out = await world.invoke("use_reaction", { characterId: young.id, feature: "Warding Flare", targetCharacterId: ally.id });
  assert.match(out.error, /improved flare/i);
  assert.equal(used(young, "sub_warding_flare"), 0);
});

await test("Entropic Ward's miss gives the warlock's next attack on that creature advantage, and the attack spends it.", async () => {
  const who = world.addHero({
    user: world.owner, class: "warlock", subclass: "The Great Old One", level: 20, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  });
  const enemy = await stage(who);
  await strike(enemy, who);
  const out = await react(who, "Entropic Ward", [2]);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.next, /advantage/);
  assert.ok(world.sheet(who.id).conditions.includes("entropic ward"), JSON.stringify(world.sheet(who.id).conditions));
  kit.giveTurn(who.id);
  world.dice(3, 17, 5);
  const swing = await world.invoke("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.match(JSON.stringify(swing.result), /Entropic Ward: advantage/);
  assert.equal(world.sheet(who.id).conditions.includes("entropic ward"), false, "the attack spends it");
});

await test("A natural 20 the reroll turns into a lower roll that still hits lands as an ordinary hit (Warding Flare, Shadowy Dodge).", async () => {
  for (const [name, classId, subclass] of [["Warding Flare", "cleric", "Light Domain"], ["Shadowy Dodge", "ranger", "Gloom Stalker"]]) {
    const who = hero(classId, subclass);
    const enemy = await stage(who);
    // The club's 1d6+2, doubled dice on a 20: 4 + 5 + 2 = 11; the plain blow 4 + 2 = 6.
    await strike(enemy, who, [20, 4, 5]);
    assert.equal(world.sheet(who.id).currentHp, 39, name);
    const out = await react(who, name, [15]);
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(who.id).currentHp, 44, `${name}: ${out.result?.applied}`);
    assert.match(out.result.applied, /no longer a critical/);
  }
});

await test("Protection's reroll treats a natural 20 the same way, and answers the hit.", async () => {
  const guard = world.addHero({
    user: world.owner, class: "fighter", subclass: "Champion", level: 5, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16 }, portrait: { url: "/uploads/test.png" },
    equipment: [{ name: "Shield", qty: 1, equipped: true }, { name: "Longsword", qty: 1, equipped: true }],
  });
  world.patch(guard.id, { features: [...world.sheet(guard.id).features, { name: "Fighting Style: Protection", source: "class", level: 1 }] });
  const ally = hero("fighter", "Champion");
  const enemy = await stage(ally);
  kit.place(guard.id, 4, 5);
  kit.freshRound();
  await strike(enemy, ally, [20, 4, 5]);
  assert.equal(world.sheet(ally.id).currentHp, 39);
  world.dice(15);
  const out = await world.invoke("use_reaction", { characterId: guard.id, feature: "Protection", targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).currentHp, 44, out.result?.applied);
});

await test("Wrath of the Storm spends a held Destructive Wrath: its 2d8 at their maximum.", async () => {
  const cleric = hero("cleric", "Tempest Domain");
  world.patch(cleric.id, { conditions: ["destructive wrath"], resources: { ...world.sheet(cleric.id).resources, sub_wrath_of_the_storm: { max: 3, used: 0 } } });
  const enemy = await stage(cleric);
  world.patch(cleric.id, { conditions: ["destructive wrath"] });
  kit.setEnemy(enemy.id, { stats: { immune: "" } });
  await strike(enemy, cleric);
  const out = await react(cleric, "Wrath of the Storm", [2]);
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.destructiveWrath, /maximum/);
  assert.equal(world.enemies()[0].currentHp, 284);
  assert.ok(!world.sheet(cleric.id).conditions.includes("destructive wrath"));
});

await test("Wrath of the Storm deals thunder to a creature immune to lightning, and the type named when one is.", async () => {
  const cleric = hero("cleric", "Tempest Domain");
  world.patch(cleric.id, { resources: { ...world.sheet(cleric.id).resources, sub_wrath_of_the_storm: { max: 3, used: 0 } } });
  let enemy = await stage(cleric);
  kit.setEnemy(enemy.id, { stats: { immune: "lightning" } });
  await strike(enemy, cleric);
  let out = await react(cleric, "Wrath of the Storm", [4, 4, 2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.type, "thunder");
  assert.equal(world.enemies()[0].currentHp, 292);
  enemy = await stage(cleric);
  kit.setEnemy(enemy.id, { stats: { immune: "lightning" } });
  await strike(enemy, cleric);
  out = await react(cleric, "Wrath of the Storm lightning", [4, 4, 2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.type, "lightning");
  assert.equal(world.enemies()[0].currentHp, 300);
});

await test("Warding Flare's card for an ally beyond 30 feet is not dealt, and one within it is open.", async () => {
  const cleric = hero("cleric", "Light Domain");
  const ally = hero("fighter", "Champion");
  const enemy = await stage(cleric);
  kit.place(ally.id, 4, 5);
  world.patch(ally.id, { currentHp: 50 });
  kit.freshRound();
  await strike(enemy, ally);
  const feet = () => feetFrom(cleric);
  const flare = () =>
    reactionCards(world.sheet(cleric.id), { ...FRESH_TURN, myTurn: false }, activePublicEncounter(world.campaignId)?.lastHits ?? [], world.sheets(), "you", feet()).filter((card) => card.name === "Warding Flare");
  assert.equal(flare()[0]?.disabled, null);
  kit.place(ally.id, 5, 25);
  assert.ok((feet()?.[ally.id] ?? 0) > 30, JSON.stringify(feet()));
  assert.equal(flare().length, 0);
});

await test("Illusory Self: offered on the hit, and the hit misses with no exhaustion.", async () => {
  const who = hero("wizard", "School of Illusion");
  const enemy = await stage(who);
  assert.equal(onOwnTurn(who, "Illusory Self"), false);
  await strike(enemy, who);
  const [card] = offered(who, "Illusory Self");
  assert.equal(card.rules, "The hit becomes a miss.");
  const out = await react(who, "Illusory Self", []);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(who.id).currentHp, 50);
  assert.equal(world.sheet(who.id).exhaustion ?? 0, 0);
  assert.doesNotMatch(out.result.applied, /exhaustion/);
  assert.equal(used(who, "sub_illusory_self"), 1);
});

await test("Convergent Future, the other reaction of its kind, still costs its exhaustion.", async () => {
  const who = hero("wizard", "Chronurgy Magic");
  const enemy = await stage(who);
  await strike(enemy, who);
  const out = await world.invoke("use_reaction", { characterId: who.id, feature: "Convergent Future" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(who.id).exhaustion, 1);
  assert.match(out.result.applied, /exhaustion/);
});

const tempest = hero("cleric", "Tempest Domain");
await test("Wrath of the Storm: a failed save takes 2d8 lightning, a made one half; a spent use is no card.", async () => {
  let enemy = await stage(tempest);
  assert.equal(onOwnTurn(tempest, "Wrath of the Storm"), false);
  await strike(enemy, tempest);
  assert.equal(offered(tempest, "Wrath of the Storm").length, 1);
  let out = await react(tempest, "Wrath of the Storm", [4, 4, 2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.enemies()[0].currentHp, 292);
  assert.equal(used(tempest, "sub_wrath_of_the_storm"), 1);

  enemy = await stage(tempest);
  await strike(enemy, tempest);
  out = await react(tempest, "Wrath of the Storm", [4, 4, 19]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.enemies()[0].currentHp, 296);
});

await test("Wrath of the Storm answers a hit once, and no card comes for a ranged hit.", async () => {
  const cleric = hero("cleric", "Tempest Domain");
  world.patch(cleric.id, { resources: { ...world.sheet(cleric.id).resources, sub_wrath_of_the_storm: { max: 3, used: 0 } } });
  const enemy = await stage(cleric);
  await strike(enemy, cleric);
  const out = await react(cleric, "Wrath of the Storm", [4, 4, 2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(offered(cleric, "Wrath of the Storm").length, 0);
  const ranged = reactionCards(world.sheet(cleric.id), { ...FRESH_TURN, myTurn: false }, [{ id: "r1", characterId: cleric.id, hit: true, hits: 1, source: "attack", ranged: true, attacker: "Goblin", attackerId: enemy.id, attack: "Shortbow", type: "piercing", damage: 4, answered: [] }], world.sheets());
  assert.equal(ranged.some((card) => card.name === "Wrath of the Storm"), false);
});

await test("Wrath of the Storm needs a melee hit on the cleric, and spends nothing without one.", async () => {
  const fresh = hero("cleric", "Tempest Domain");
  await stage(fresh);
  const out = await react(fresh, "Wrath of the Storm", [4, 4, 2]);
  assert.equal(out.ok, false);
  assert.equal(used(fresh, "sub_wrath_of_the_storm"), 0);
});

await test("use_resource refuses each, and says to use the reaction.", async () => {
  const who = hero("cleric", "Light Domain");
  await stage(who);
  const out = await world.invoke("use_resource", { characterId: who.id, resource: "Warding Flare" });
  assert.equal(out.ok, false);
  assert.match(out.error, /use_reaction/);
});

world.close();
finish();
