// Radiance of the Dawn reaches every hostile creature within 30 feet, seen or
// not, while Charm Animals and Plants takes only the beasts the cleric can see:
// a Fog Cloud hides one from the second and not from the first. Nature's Wrath
// takes a creature the paladin can see, so not the one in the fog.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";
import { board } from "./lib/enforce-zones.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-channel-table-sight");
// A wizard to cast the fog, two clerics side by side, a goblin in the fog and one in the open.
const { world, sheets: [wizard, light, nature, ancients], enemies: [fogged, open] } = await board(
  [
    caster("wizard", "int", ["Fog Cloud"]),
    caster("cleric", "wis", [], [], 9, { subclass: "Light Domain" }),
    caster("cleric", "wis", [], [], 9, { subclass: "Nature Domain" }),
    caster("paladin", "cha", [], [], 9, { subclass: "Oath of the Ancients" }),
  ],
  { 0: { x: 2, y: 8 }, 1: { x: 9, y: 4 }, 2: { x: 9, y: 3 }, 3: { x: 10, y: 3 }, e0: { x: 12, y: 4 }, e1: { x: 9, y: 6 } },
  { count: 2 },
);
const kit = await combatKit(world);
const hp = (id) => world.enemies().find((entry) => entry.id === id).currentHp;
const fog = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Fog Cloud", level: 1, atX: 14, atY: 4 });
assert.equal(fog.ok, true, fog.error);

await test("Radiance of the Dawn burns the goblin inside the fog as well as the one in the open.", async () => {
  kit.giveTurn(light.id);
  const before = [hp(fogged.id), hp(open.id)];
  world.dice(5, 5, 2, 2);
  const out = await world.invoke("use_resource", { characterId: light.id, resource: "Channel Divinity", variant: "radiance of the dawn" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(hp(fogged.id) < before[0], "the fogged goblin is burned");
  assert.ok(hp(open.id) < before[1], "the goblin in the open is burned");
});

await test("Charm Animals and Plants takes only the beast the cleric can see.", async () => {
  for (const id of [fogged.id, open.id]) kit.setEnemy(id, { stats: { ...world.enemies().find((entry) => entry.id === id).stats, type: "beast" } });
  kit.giveTurn(nature.id);
  world.dice(2, 2);
  const out = await world.invoke("use_resource", { characterId: nature.id, resource: "Charm Animals and Plants" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const conditions = (id) => world.enemies().find((entry) => entry.id === id).conditions;
  assert.ok(conditions(open.id).includes("charmed"));
  assert.equal(conditions(fogged.id).includes("charmed"), false);
});

await test("Nature's Wrath is refused on the goblin in the fog, 10 feet off but unseen, and spends nothing.", async () => {
  kit.giveTurn(ancients.id);
  const before = world.sheet(ancients.id).resources.channel_divinity.used;
  world.dice(2);
  const out = await world.invoke("use_resource", { characterId: ancients.id, resource: "Channel Divinity", variant: "nature's wrath", targetEnemyId: fogged.id });
  world.clearDice();
  assert.equal(out.ok, false);
  assert.match(String(out.error), /cannot see/);
  assert.equal(world.sheet(ancients.id).resources.channel_divinity.used, before);
  assert.equal(world.enemies().find((entry) => entry.id === fogged.id).conditions.includes("restrained"), false);
});

finish();
