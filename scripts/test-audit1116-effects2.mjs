// What common spells do after the roll and when they end: the 2026-11-16
// audit's effects lens, its follow-up (findings Y12 on; Y01 to Y11 are in
// scripts/test-audit1116-effects.mjs). Each test is the rule as SRD 5.1
// prints it, read off the engine's own state.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-audit1116-effects2");

// ---- Y12: Mage Armor touches a creature who isn't wearing armor ----

// SRD 5.1, Mage Armor: "You touch a willing creature who isn't wearing
// armor". Cast on the fighter in chain mail, the slot was spent and the spell
// did nothing; it is refused before anything is spent.
await test("Y12: Mage Armor on a creature wearing armor is refused and spends no slot", async () => {
  const { world, sheets: [mage, tank] } = await table([
    caster("wizard", "int", ["Mage Armor"], [], 5),
    { ...FIGHTER, equipment: [{ name: "Chain Mail", qty: 1, equipped: true }] },
  ]);
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Mage Armor", level: 1, targetCharacterIds: [tank.id] });
  assert.equal(cast.refused, "rules", cast.error ?? "it was cast");
  assert.match(cast.error, /armor/i);
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, 0, "nothing spent");
  assert.ok(!world.sheet(tank.id).conditions.includes("mage armor"));
});

closeTables();
finish();
