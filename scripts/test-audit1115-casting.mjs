// The casting rules the 2026-11-15 audit found the engine getting wrong
// (casting lens, findings S01 on). Each test is the rule as SRD 5.1 prints
// it, read off the engine's own state: a refusal, a sheet, the dice rolled.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { freshTurn } from "./lib/enforce-spells.mjs";
import { caster, closeTables, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-audit1115-casting");

// ---- S01: a running spell's bonus action is not a spell cast ----

// SRD 5.1, Casting Time, Bonus Action: "You can't cast another spell during
// the same turn, except for a cantrip with a casting time of 1 action." Heat
// Metal's later bonus action (and Flaming Sphere's ram, Gust of Wind's blast)
// is the spell already cast doing its work again, not a casting, so it bars
// nothing and nothing bars it.
async function heatMetalDruid() {
  const { world, sheets: [druid], enemies: [goblin, second] } = await table([caster("druid", "wis", ["Heat Metal", "Thunderwave", "Healing Word"])], 2);
  world.dice(4, 4, 20);
  const cast = await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal", level: 2 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  await freshTurn(world);
  return { world, druid, goblin, second };
}

await test("S01: Heat Metal's bonus action again leaves the action free for a levelled spell (Thunderwave)", async () => {
  const { world, druid, goblin, second } = await heatMetalDruid();
  world.dice(4, 4, 20);
  const again = await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal" });
  world.clearDice();
  assert.equal(again.ok, true, again.error);
  assert.ok(again.result.repeat, "the second call is the running spell, not a new casting");
  world.dice(4, 4, 1);
  const wave = await world.invokeAsIs("aoe_damage", { casterCharacterId: druid.id, spell: "Thunderwave", enemyIds: [second.id], level: 1 });
  world.clearDice();
  assert.equal(wave.ok, true, wave.error);
});

await test("S01: a levelled spell cast with the action leaves Heat Metal's bonus action free that turn", async () => {
  const { world, druid, goblin, second } = await heatMetalDruid();
  world.dice(4, 4, 1);
  const wave = await world.invokeAsIs("aoe_damage", { casterCharacterId: druid.id, spell: "Thunderwave", enemyIds: [second.id], level: 1 });
  world.clearDice();
  assert.equal(wave.ok, true, wave.error);
  world.dice(4, 4, 20);
  const again = await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal" });
  world.clearDice();
  assert.equal(again.ok, true, again.error);
});

await test("S01: a spell cast with the bonus action (Healing Word) still bars a levelled action spell that turn", async () => {
  const { world, druid, second } = await heatMetalDruid();
  world.dice(4);
  const word = await world.invokeAsIs("heal", { casterId: druid.id, characterId: druid.id, spell: "Healing Word", level: 1 });
  world.clearDice();
  assert.equal(word.ok, true, word.error);
  world.dice(4, 4, 1);
  const wave = await world.invokeAsIs("aoe_damage", { casterCharacterId: druid.id, spell: "Thunderwave", enemyIds: [second.id], level: 1 });
  world.clearDice();
  assert.equal(wave.refused, "rules", JSON.stringify(wave));
});

closeTables();
finish();
