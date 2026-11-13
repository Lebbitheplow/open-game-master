// The steampunk classes' features wired in the genre-b completeness pass
// (cc1113, ids GB01 and on): each case fails without its mechanism, and the
// clause ledger (scripts/clauses/genre-steampunk.json) points here for the
// clauses it holds.
//
// Dice forced; every check reads what landed on a creature, a sheet, the
// board or the turn's budget.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const { meetEnemyPart } = await load("lib/dm/enemy-defenses.ts");

const { test, finish } = suite("test-genre-gb-steampunk");
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
const foe = (enemy) => kit.enemy(enemy.id);

// ---- GB01: Universal Solvent, Heart of the Storm ----

await run("Universal Solvent: an alchemist's acid spell halves on a creature immune to acid, a weapon's acid does not get through, and without the feature none does", async () => {
  const row = feature("alchemist", "Universal Solvent", 14);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  kit.setEnemy(near.id, { stats: { immune: "acid, poison", resist: "" } });
  const meet = (type, spell) => meetEnemyPart(world.campaignId, foe(near), 20, type, { spell }).amount;
  const { on, off } = await rig.both(hero, row, () => meet("acid", true));
  assert.equal(on, 10, `20 acid from a spell dealt ${on} to an acid-immune creature with Universal Solvent`);
  assert.equal(off, 0, `without it the same acid dealt ${off}`);
  assert.equal(meet("acid", false), 0, "an acid blow that is no formula got through the immunity");
  assert.equal(meet("poison", true), 0, "the poison immunity was softened too");
});

await run("Heart of the Storm: a channeler's lightning spell deals full damage through resistance and half through immunity, and the channeler gains no resistance of the Storm Sorcery feature", async () => {
  const row = feature("aether_channeler", "Heart of the Storm", 14);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const meet = (type) => meetEnemyPart(world.campaignId, foe(near), 20, type, { spell: true }).amount;
  kit.setEnemy(near.id, { stats: { resist: "lightning, fire", immune: "" } });
  const resisted = await rig.both(hero, row, () => meet("lightning"));
  assert.deepEqual([resisted.on, resisted.off], [20, 10], `a lightning-resistant creature took ${resisted.on} with Heart of the Storm and ${resisted.off} without it`);
  assert.equal(meet("fire"), 10, "the fire resistance was ignored too");
  kit.setEnemy(near.id, { stats: { resist: "", immune: "lightning" } });
  const immune = await rig.both(hero, row, () => meet("lightning"));
  assert.deepEqual([immune.on, immune.off], [10, 0], `a lightning-immune creature took ${immune.on} with Heart of the Storm and ${immune.off} without it`);
  // A creature both resistant and immune: the immunity becomes the resistance the art then does not ignore.
  kit.setEnemy(near.id, { stats: { resist: "lightning", immune: "lightning" } });
  assert.equal(meet("lightning"), 10, "a resistant and immune creature took full damage");
  // End to end: Shocking Grasp on the immune creature, through pc_attack.
  world.patch(hero.id, { spellcasting: { ...(world.sheet(hero.id).spellcasting ?? {}), ability: "int", cantrips: ["Shocking Grasp"] } });
  kit.setEnemy(near.id, { stats: { resist: "", immune: "lightning" } });
  rig.myTurn(hero);
  const out = await kit.swing(hero.id, near.id, [15, 8, 8, 8, 8, 8, 8], { spell: "Shocking Grasp" });
  assert.ok(out.ok, `Shocking Grasp: ${out.error}`);
  // Its 3d8 on 8s is 24, halved by the immunity read as resistance (Dynamo Spark's rider meets the same).
  assert.equal(out.result.damageApplied, 12, `Shocking Grasp's 24 dealt ${out.result.damageApplied} to the lightning-immune creature (${out.result.damageNote})`);
  // The feature gives the channeler no resistance (Grounded Stance's lightning is its own).
  const lightning = await rig.both(hero, row, () => rig.damageLost(hero, "lightning"));
  assert.equal(lightning.on, lightning.off, `lightning took ${lightning.on} with Heart of the Storm and ${lightning.off} without it`);
  assert.equal(await rig.damageLost(hero, "thunder"), 20, "the channeler resisted thunder");
});

rig.world.close();
finish();
