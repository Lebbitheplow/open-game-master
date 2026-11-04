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

await kit.endFight();
world.close();
finish();
