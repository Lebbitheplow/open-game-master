// The counters the gap sweep found broken outright (scripts/test-enforce-sweep-
// spends-*.mjs), each held here on the path a table plays it:
//
//   - Defensive Field: the Armorer's counter matched a feature nobody holds,
//     so the Guardian's temporary hit points could never be spent;
//   - Psionic Recovery is held in scripts/test-authored-spend-cards.mjs (the
//     die comes back).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-counter-repairs");
const world = await openWorld({ campaign: { maxPlayers: 40 } });
const kit = await combatKit(world);

const abilities = { str: 16, dex: 14, con: 14, int: 16, wis: 12, cha: 10 };
const hero = (klass, subclass, level, extra = {}) =>
  world.addHero({ user: world.owner, class: klass, subclass, level, abilities, maxHp: 60, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }], ...extra });

await test("An Armorer holds Defensive Field's uses, and in Guardian armor a bonus action gives temporary hit points equal to the artificer level.", async () => {
  // SRD-style text (src/lib/srd/subclasses.json, Armor Model): "Defensive Field
  // (a bonus action gives you temporary hit points equal to your artificer
  // level, a proficiency-bonus number of times per long rest)".
  const armorer = hero("artificer", "Armorer", 5);
  assert.ok(world.sheet(armorer.id).resources.sub_defensive_field, `no Defensive Field counter: ${Object.keys(world.sheet(armorer.id).resources).join(", ")}`);
  assert.equal(world.sheet(armorer.id).resources.sub_defensive_field.max, 3, "a proficiency-bonus number of uses");
  const chosen = await world.invoke("use_resource", { characterId: armorer.id, resource: "Armor Model", variant: "Guardian" });
  assert.equal(chosen.ok, true, chosen.error);
  await kit.fight(1, { heroFaces: { [armorer.id]: 19 } });
  kit.giveTurn(armorer.id);
  const out = await world.invoke("use_resource", { characterId: armorer.id, resource: "Defensive Field" });
  assert.equal(out.ok, true, out.error);
  const sheet = world.sheet(armorer.id);
  assert.equal(sheet.tempHp, 5);
  assert.equal(sheet.resources.sub_defensive_field.used, 1);
  await kit.endFight();
});

await test("An Infiltrator's Defensive Field is refused with nothing spent: it belongs to the Guardian armor.", async () => {
  const armorer = hero("artificer", "Armorer", 5);
  await world.invoke("use_resource", { characterId: armorer.id, resource: "Armor Model", variant: "Infiltrator" });
  const out = await world.invoke("use_resource", { characterId: armorer.id, resource: "Defensive Field" });
  assert.notEqual(out.ok, true);
  assert.equal(world.sheet(armorer.id).resources.sub_defensive_field.used, 0);
});

finish();
