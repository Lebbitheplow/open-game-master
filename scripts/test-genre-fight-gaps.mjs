// The genre classes' features that come up in every fight and were still
// sentences in the GM's prompt after wave 2 (the clause ledgers,
// scripts/clauses/genre-*.json, point here for the clauses these hold).
// Each case fails without its mechanism.
//
// Dice forced; every check reads the d20s a roll threw, hit points or a
// condition.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { d20Faces } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-genre-fight-gaps");
const rig = await clausesRig();
const { world, kit } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};
const holds = (hero, name) => world.sheet(hero.id).conditions.some((entry) => entry.toLowerCase() === name);
// The advantage the enemy's attack on the hero was rolled with.
async function attackedWith(enemy, hero) {
  kit.handOnEnemies();
  kit.freshRound();
  const before = new Set(kit.lastRolls(60).map((roll) => roll.id));
  world.clearDice();
  world.dice(5, 5, 1);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return kit.lastRolls(60).find((roll) => roll.kind === "attack" && !before.has(roll.id))?.advantage ?? "none";
}

// ---- Death or Glory (road warrior 1) and Ride Eternal (20) ----

await run("Death or Glory: a road warrior attacks recklessly with advantage, on any melee attack, and attacks against them have advantage until their next turn", async () => {
  const hero = rig.holder(feature("road_warrior", "Death or Glory", 1));
  const { near } = await rig.fight(hero);
  const swing = await kit.swing(hero.id, near.id, [3, 15, 4], { weapon: "Longsword", reckless: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, "the reckless swing rolled one d20");
  assert.ok(holds(hero, "death or glory"), "the road warrior carries no reckless opening");
  assert.equal(await attackedWith(near, hero), "advantage", "the enemy's attack on the reckless road warrior had no advantage");
});

await run("Ride Eternal: Death or Glory still gives the road warrior advantage, and grants the enemy nothing", async () => {
  const hero = rig.holder(feature("road_warrior", "Ride Eternal", 20));
  const { near } = await rig.fight(hero);
  const swing = await kit.swing(hero.id, near.id, [3, 15, 4], { weapon: "Longsword", reckless: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, "the reckless swing rolled one d20");
  assert.notEqual(await attackedWith(near, hero), "advantage", "Ride Eternal's road warrior still opened an advantage to the enemy");
});

rig.world.close();
finish();
