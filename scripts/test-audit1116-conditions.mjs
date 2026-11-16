// GM rules audit 2026-11-16, conditions lens (D01 and on): the SRD 5.1
// conditions with all their effects, ended at the right time on every door,
// and dropping to 0 hit points. Each test failed on main before its fix.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-audit1116-conditions");
const encounters = await import("../src/lib/db/encounters.ts");
void openWorld;

const prone = (conditions) => conditions.some((entry) => entry.trim().toLowerCase() === "prone");

// D01. SRD 5.1, Unconscious: "The creature drops whatever it's holding and
// falls prone." Only the drop to 0 hit points wrote the prone; Sleep, a
// drow's poison or Eyebite wrote the unconscious alone, so a goblin woken by
// a blow stood at once (no half its speed to get up, no advantage for the
// next sword, no disadvantage on its own swing) and a hero shaken awake walked
// off at full speed.
await test("D01: a creature put to sleep falls prone, and stays prone when it wakes", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Sleep"], [], 5)]);
  encounters.patchEnemyHp(foe.id, 6, "alive");
  world.dice(8, 8, 8, 8, 8);
  const cast = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Sleep", level: 1 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(enemyOf(world, foe.id).conditions.includes("unconscious"), JSON.stringify(cast.result));
  assert.ok(prone(enemyOf(world, foe.id).conditions), `the sleeper is not prone: ${enemyOf(world, foe.id).conditions}`);
  const hit = await world.invoke("damage_enemy", { enemyId: foe.id, amount: 1 });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(enemyOf(world, foe.id).conditions.includes("unconscious"), false);
  assert.ok(prone(enemyOf(world, foe.id).conditions), "the woken creature stood up for free");
});

await test("D01: the same through set_condition, on a creature and on a hero", async () => {
  const { world, sheets: [hero], enemies: [foe] } = await table([FIGHTER]);
  const laid = await world.invoke("set_condition", { enemyId: foe.id, condition: "unconscious", reason: "a sleeping draught", rounds: 10 });
  assert.equal(laid.ok, true, laid.error);
  assert.ok(prone(enemyOf(world, foe.id).conditions), `the sleeper is not prone: ${enemyOf(world, foe.id).conditions}`);
  const dart = await world.invoke("set_condition", { characterId: hero.id, condition: "unconscious", reason: "a drow's dart", rounds: 100 });
  assert.equal(dart.ok, true, dart.error);
  assert.ok(prone(world.sheet(hero.id).conditions), `the sleeping hero is not prone: ${world.sheet(hero.id).conditions}`);
  const woken = await world.invoke("clear_condition", { characterId: hero.id, condition: "unconscious", reason: "shaken awake" });
  assert.equal(woken.ok, true, woken.error);
  assert.ok(prone(world.sheet(hero.id).conditions), "the hero shaken awake is on their feet already");
});

closeTables();
finish();
