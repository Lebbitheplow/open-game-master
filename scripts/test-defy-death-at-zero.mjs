// Defy Death (The Undying, warlock 6): "when you succeed on a death saving
// throw ... you can regain hit points equal to 1d8 + your Constitution
// modifier". The warlock is at 0 hit points when that save succeeds, and the
// use was refused there as unconscious (src/lib/srd/class-resources.ts
// atZeroHp, read by src/lib/dm/resource-tools.ts computeUseResource).
import "./lib/enforce-world.mjs";
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

import { combatKit } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-defy-death-at-zero");
const world = await openWorld();
const kit = await combatKit(world);
const { rollDeathSave } = await import("../src/lib/dm/death.ts");

await test("Defy Death is used at 0 hit points and heals 1d8 + Constitution, costing no action", async () => {
  const warlock = world.addHero({ class: "warlock", subclass: "The Undying", level: 6, maxHp: 40, abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 16 } });
  // The death save is made at its own door, in a fight: its success is the
  // record Defy Death answers (src/lib/srd/trigger-table.ts sub_defy_death).
  await kit.fight(1, { heroFaces: { [warlock.id]: 19 } });
  kit.giveTurn(warlock.id);
  world.patch(warlock.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const early = await world.invoke("use_resource", { characterId: warlock.id, resource: "Defy Death" });
  assert.equal(early.ok, false, "with no death save succeeded, the use answers nothing");
  world.clearDice();
  world.dice(15);
  assert.match(String(rollDeathSave(world.campaign(), warlock.id)), /success/);
  world.clearDice();
  world.dice(5);
  const out = await world.invoke("use_resource", { characterId: warlock.id, resource: "Defy Death" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(warlock.id).currentHp, 5 + 2, "1d8 (5) + Constitution (+2)");
});

await test("Another feature at 0 hit points is still refused as unconscious", async () => {
  const fighter = world.addHero({ class: "fighter", level: 4, maxHp: 40 });
  world.patch(fighter.id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  const out = await world.invoke("use_resource", { characterId: fighter.id, resource: "Second Wind" });
  assert.equal(out.ok, false, "Second Wind at 0 hit points");
});

world.close();
finish();
