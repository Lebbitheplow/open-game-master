// A worn item's bonus to unarmed strikes (a workshop pair of wraps) leaves the
// strike an unarmed strike, which a monk's bonus strike and Flurry of Blows ask
// for, and Stunning Strike still rides it. Written through the homebrew route,
// carried on a sheet at the table, and swung through pc_attack.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-worn-unarmed-monk");
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

async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [monk.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(monk.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(monk.id);
  world.patch(monk.id, { resources: { ...world.sheet(monk.id).resources, ki: { max: 6, used: 0 } } });
  return enemy;
}
// 10 + 3 (Dexterity) + 3 (proficiency) + 3 (wraps), and 4 + 3 + 3.
const assertWrapped = (out, label) => {
  assert.equal(out.ok, true, `${label}: ${out.error}`);
  assert.equal(out.toHit?.total, 19, `${label} to hit`);
  assert.equal(out.damage?.total, 10, `${label} damage`);
};
const fist = (enemy, args = {}) => kit.swing(monk.id, enemy.id, [10, 4], { weapon: "unarmed strike", ...args });

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

// An Open Hand monk in the same wraps: Open Hand Technique rides a flurry
// strike and Quivering Palm an unarmed hit, each made in them.
const palm = world.addHero({
  user: world.owner, class: "monk", subclass: "Way of the Open Hand", level: 17, abilities: { str: 10, dex: 16, wis: 16 }, proficiencies: TRAINED, maxHp: 120,
});
world.patch(palm.id, { equipment: [{ name: "Tested Wraps", qty: 1, equipped: true, attuned: true }] });
async function stagePalm() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [palm.id]: 19, [monk.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(palm.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(palm.id);
  world.patch(palm.id, { resources: { ...world.sheet(palm.id).resources, ki: { max: 17, used: 0 } } });
  return enemy;
}
// 10 + 3 (Dexterity) + 6 (proficiency) + 3 (wraps).
const PALM_HIT = 10 + 3 + 6 + 3;

await test("Open Hand Technique knocks a creature prone off a flurry strike made in wraps, which carries their bonus.", async () => {
  const enemy = await stagePalm();
  for (const label of ["the first attack", "Extra Attack"]) {
    const out = await kit.swing(palm.id, enemy.id, [10, 4], { weapon: "unarmed strike" });
    assert.equal(out.toHit?.total, PALM_HIT, label);
  }
  const flurry = await world.invoke("use_resource", { characterId: palm.id, resource: "Ki", variant: "flurry of blows" });
  assert.equal(flurry.ok, true, flurry.error);
  const strike = await kit.swing(palm.id, enemy.id, [10, 4, 1], { weapon: "unarmed strike", openHand: "prone" });
  assert.equal(strike.ok, true, strike.error);
  assert.equal(strike.toHit?.total, PALM_HIT, "the flurry strike lost the wraps' bonus");
  assert.equal(strike.damage?.total, 4 + 3 + 3);
  assert.ok(kit.enemy(enemy.id).conditions.some((entry) => /prone/i.test(entry)), "the flurry hit did not knock it prone");
});

await test("Quivering Palm sets its vibrations off an unarmed hit made in wraps.", async () => {
  const enemy = await stagePalm();
  const hit = await kit.swing(palm.id, enemy.id, [10, 4], { weapon: "unarmed strike" });
  assert.equal(hit.result.hit, true, hit.error);
  assert.equal(hit.toHit?.total, PALM_HIT);
  const set = await world.invoke("use_resource", { characterId: palm.id, resource: "Quivering Palm", targetEnemyId: enemy.id });
  assert.equal(set.ok, true, set.error);
  assert.equal(world.sheet(palm.id).resources.ki.used, 3, "3 ki");
});

await test("The wraps ride the monk's stat block as a turncoat and as a companion's rated block, as they ride the monk's own swing.", async () => {
  const { sheetEnemyStats } = await import("../src/lib/dm/sheet-foe-stats.ts");
  const { sheetStatBlock } = await import("../src/lib/dm/companion-statblock.ts");
  const sheet = world.sheet(monk.id);
  const turncoat = sheetEnemyStats(sheet).attacks[0];
  assert.equal(turncoat.toHit, 3 + 3 + 3, `the turncoat's strike (${JSON.stringify(turncoat)})`);
  assert.match(turncoat.damage, /\+6$/, "the turncoat's strike lost the wraps' damage");
  const rated = sheetStatBlock(sheet).stats.attacks[0];
  assert.equal(rated.toHit, 3 + 3 + 3, `the companion's rated strike (${JSON.stringify(rated)})`);
});

await kit.endFight();
world.close();
finish();
