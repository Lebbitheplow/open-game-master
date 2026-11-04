// A worn item's bonus to unarmed strikes (a workshop pair of wraps) leaves the
// strike an unarmed strike, which a monk's bonus strike and Flurry of Blows ask
// for, and Stunning Strike still rides it. Written through the homebrew route,
// carried on a sheet at the table, and swung through pc_attack.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-worn-unarmed-monk");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const world = await openWorld();
const kit = await combatKit(world);

const monk = world.addHero({
  user: world.owner, class: "monk", level: 6, abilities: { str: 10, dex: 16, wis: 14 }, proficiencies: TRAINED, maxHp: 60,
});
const homebrew = await world.route("homebrew");
world.signIn(world.owner);
const made = await homebrew.POST(new Request("http://test/", {
  method: "POST",
  body: JSON.stringify({
    kind: "item",
    name: "Tested Wraps",
    data: { itemKind: "magic_item", requiresAttunement: true, effects: [{ kind: "weapon_rider", weapons: ["unarmed strike"], attack: 3, damage: 3 }] },
  }),
}));
assert.equal(made.status, 201);
world.patch(monk.id, { equipment: [{ name: "Tested Wraps", qty: 1, equipped: true, attuned: true }] });

async function stage(who = monk) {
  await kit.endFight();
  world.patch(who.id, { conditions: [], conditionMeta: {}, resources: {} });
  await kit.fight(1, { heroFaces: { [who.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(who.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(who.id);
  world.patch(who.id, { resources: { ...world.sheet(who.id).resources, ki: { max: who.level ?? 6, used: 0 } } });
  return enemy;
}
// 10 + 3 (Dexterity) + 3 (proficiency) + 3 (wraps), and 4 + 3 + 3.
const assertWrapped = (out, label) => {
  assert.equal(out.ok, true, `${label}: ${out.error}`);
  assert.equal(out.toHit?.total, 19, `${label} to hit`);
  assert.equal(out.damage?.total, 10, `${label} damage`);
};
const fist = (enemy, args = {}, who = monk) => kit.swing(who.id, enemy.id, [10, 4], { weapon: "unarmed strike", ...args });

await test("The bonus strike of Martial Arts follows an Attack action made in wraps, and carries their bonus.", async () => {
  const enemy = await stage();
  assertWrapped(await fist(enemy), "the Attack action");
  assertWrapped(await fist(enemy, { bonusAttack: "martial arts" }), "the bonus strike");
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("Flurry of Blows gives its two strikes in wraps, each with their bonus.", async () => {
  const enemy = await stage();
  assertWrapped(await fist(enemy), "the first attack");
  assertWrapped(await fist(enemy), "Extra Attack");
  const flurry = await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant: "flurry of blows" });
  assert.equal(flurry.ok, true, flurry.error);
  assertWrapped(await fist(enemy), "the flurry's first");
  assertWrapped(await fist(enemy), "the flurry's second");
});

await test("Stunning Strike rides a strike made in wraps.", async () => {
  const enemy = await stage();
  const strike = await kit.swing(monk.id, enemy.id, [10, 4, 1], { weapon: "unarmed strike", stunningStrike: true });
  assertWrapped(strike, "the stunning strike");
  assert.equal(world.sheet(monk.id).resources.ki.used, 1, "the ki was not spent");
  assert.equal(kit.enemy(enemy.id).conditions.includes("stunned"), true, "the strike did not stun");
});

await test("The Hand's Unarmed strike card shows the wraps' bonus, as the strike will roll it.", async () => {
  await stage();
  const card = deriveHand(world.sheet(monk.id), FRESH_TURN, {}).find((entry) => entry.intent?.weapon === "Unarmed strike" && entry.intent?.card === "attack");
  assert.ok(card, "no Unarmed strike card");
  assert.equal(card.roll, "+9 to hit");
  assert.equal(card.dice, "1d6+6 bludgeoning");
});

const openHand = world.addHero({
  user: world.owner, class: "monk", subclass: "Way of the Open Hand", level: 17, abilities: { str: 10, dex: 16, wis: 14 }, proficiencies: TRAINED, maxHp: 60,
  equipment: [{ name: "Tested Wraps", qty: 1, equipped: true, attuned: true }],
});

await test("Open Hand Technique rides a flurry's strike made in wraps.", async () => {
  const enemy = await stage(openHand);
  for (let swing = 0; swing < 2; swing += 1) {
    assert.equal((await fist(enemy, {}, openHand)).ok, true);
  }
  const flurry = await world.invoke("use_resource", { characterId: openHand.id, resource: "Ki", variant: "flurry of blows" });
  assert.equal(flurry.ok, true, flurry.error);
  const strike = await kit.swing(openHand.id, enemy.id, [10, 4, 1], { weapon: "unarmed strike", openHand: "prone" });
  assert.equal(strike.ok, true, strike.error);
  assert.equal(kit.enemy(enemy.id).conditions.includes("prone"), true, "the failed save did not knock it prone");
});

await test("Quivering Palm sets its vibrations on a hit made in wraps.", async () => {
  const enemy = await stage(openHand);
  const hit = await fist(enemy, {}, openHand);
  assert.equal(hit.result.hit, true, hit.error);
  const used = world.sheet(openHand.id).resources.ki.used;
  const set = await world.invoke("use_resource", { characterId: openHand.id, resource: "Quivering Palm", targetEnemyId: enemy.id });
  assert.equal(set.ok, true, set.error);
  assert.equal(world.sheet(openHand.id).resources.ki.used, used + 3, "3 ki");
});

const plated = world.addHero({
  class: "monk", level: 6, abilities: { str: 10, dex: 16, wis: 14 }, proficiencies: TRAINED, maxHp: 60,
  equipment: [{ name: "Demon Armor", qty: 1, equipped: true, attuned: true }],
});

await test("A monk in Demon Armor has the gauntlets and not Martial Arts, which asks for no armor (SRD 5.1).", async () => {
  const enemy = await stage(plated);
  const strike = await kit.swing(plated.id, enemy.id, [10, 5], { weapon: "unarmed strike" });
  assert.equal(strike.ok, true, strike.error);
  // 10 + 0 (Strength, no Dexterity) + 3 (proficiency) + 1, and 5 + 0 + 1.
  assert.equal(strike.toHit?.total, 14);
  assert.equal(strike.damage?.total, 6);
  assert.equal(strike.result.damageType, "slashing");
  const bonus = await kit.swing(plated.id, enemy.id, [10, 5], { weapon: "unarmed strike", bonusAttack: "martial arts" });
  assert.equal(bonus.ok, false, "the bonus strike was allowed in plate");
});

await kit.endFight();
world.close();
finish();
