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

// ---- GB02: the walk (Rigging Runner, Master of the High Wire, Juggernaut Frame, Hold the Line) ----

const at = (id) => [kit.token(id).x, kit.token(id).y];
// The holder walks three squares east over ground of one kind; what the walk
// cost, in squares of movement.
async function walkOver(hero, ch) {
  // Three whole columns of it, so no way round is shorter.
  const { getActiveBattleMap: board } = await load("lib/battlemap/view.ts");
  const { height } = board(world.campaignId);
  kit.openField(Array.from({ length: height }, (_, y) => [6, 7, 8].map((x) => [x, y, ch])).flat());
  rig.myTurn(hero);
  kit.place(hero.id, 5, 2);
  // The player's own walk (the move route's door), on their turn.
  const { walkCharacter } = await load("lib/dm/token-rules.ts");
  const { getActiveBattleMap } = await load("lib/battlemap/view.ts");
  const out = walkCharacter(world.campaign(), world.encounter(), getActiveBattleMap(world.campaignId), world.sheet(hero.id), kit.token(hero.id), { x: 8, y: 2 }, {});
  if (out?.error) throw new Error(`walk: ${out.error}`);
  assert.deepEqual(at(hero.id), [8, 2], "the walk did not arrive");
  return kit.token(hero.id).movedThisRound;
}

await run("Rigging Runner: an aeronaut climbs at a foot a foot, where without it a climb costs double", async () => {
  const row = feature("aeronaut", "Rigging Runner", 2);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  kit.place(near.id, 12, 8);
  const { on, off } = await rig.both(hero, row, () => walkOver(hero, "^"));
  assert.deepEqual([on, off], [3, 6], `three climb squares cost ${on} with Rigging Runner and ${off} without it`);
});

await run("Master of the High Wire: difficult ground costs an aeronaut nothing extra", async () => {
  const row = feature("aeronaut", "Master of the High Wire", 18);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  kit.place(near.id, 12, 8);
  const { on, off } = await rig.both(hero, row, () => walkOver(hero, ","));
  assert.deepEqual([on, off], [3, 6], `three difficult squares cost ${on} with the feature and ${off} without it`);
});

await run("Juggernaut Frame: an armored steam knight crosses difficult ground at no extra cost and an unarmored one does not; a slowed knight keeps their speed", async () => {
  const row = feature("steam_knight", "Juggernaut Frame", 14);
  const hero = rig.holder(row, { gear: "armor" });
  const { near } = await rig.fight(hero);
  kit.place(near.id, 12, 8);
  const { on, off } = await rig.both(hero, row, () => walkOver(hero, ","));
  assert.deepEqual([on, off], [3, 6], `three difficult squares cost ${on} with the frame and ${off} without it`);
  world.patch(hero.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  assert.equal(await walkOver(hero, ","), 6, "an unarmored knight crossed difficult ground at no extra cost");
  const { pcMoveBudget, getActiveBattleMap } = await load("lib/battlemap/view.ts");
  const speed = () => pcMoveBudget(world.campaignId, world.encounter(), getActiveBattleMap(world.campaignId), world.sheet(hero.id), kit.token(hero.id)).speed;
  const whole = speed();
  world.patch(hero.id, { conditions: ["slowed"], exhaustion: 2 });
  const slowed = await rig.both(hero, row, async () => speed());
  assert.equal(slowed.on, whole, `a slowed, exhausted knight moves ${slowed.on} of ${whole} feet with the frame`);
  assert.ok(slowed.off < whole, "without the frame the knight was not slowed");
});

await run("Hold the Line: a creature fighting the knight pays double for the squares within their reach, two squares deep with a reach weapon", async () => {
  const row = feature("steam_knight", "Hold the Line", 3);
  const hero = rig.holder(row, { gear: "armor" });
  const { near } = await rig.fight(hero);
  kit.place(rig.ally.id, 1, 9);
  const walk = async (to) => {
    kit.handOnEnemies();
    kit.freshRound();
    kit.openField();
    kit.place(near.id, 10, 2);
    const out = await world.invoke("move_token", { token: near.id, x: to, y: 2 });
    if (!out.ok) throw new Error(`move_token: ${out.error}`);
    return kit.token(near.id).movedThisRound;
  };
  const { on, off } = await rig.both(hero, row, () => walk(6));
  assert.deepEqual([on, off], [5, 4], `four squares to the knight's side cost the creature ${on} with Hold the Line and ${off} without it`);
  assert.equal(await walk(7), 3, "with a longsword the square two away was held");
  world.patch(hero.id, { equipment: [{ name: "Glaive", qty: 1, equipped: true }, { name: "Chain Shirt", qty: 1, equipped: true }] });
  assert.equal(await walk(7), 4, "with a glaive the square two away was not held");
});

rig.world.close();
finish();
