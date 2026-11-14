// The genre capstones a spend now plays (src/lib/srd/authored-effects-genre-a-capstones.ts,
// src/lib/dm/genre-a-casts.ts): Psychic Flight flies, Singularity casts with
// no slot at two targets far apart, Apocrypha and Seventh Seal pay for their
// own spell, The Grave Chorus twins a dirge, Beyond the Veil sees the unseen
// for the party, Rite of Repulsion turns the undead in reach and no one else.
// Fails without them: each moved its counter and handed back its guidance.
import assert from "node:assert/strict";
import { openClauseRig, must } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
const { authoredSpeeds } = await import("../src/lib/srd/authored-effects.ts");
const { genreFreeCast } = await import("../src/lib/dm/genre-a-casts.ts");
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const spend = (scene, resource, args = {}) => t.world.invoke("use_resource", { characterId: scene.holder.id, resource, ...args });
const sheet = (id) => t.world.sheet(id);
const has = (conditions, name) => conditions.some((entry) => entry.toLowerCase().startsWith(name));
// Every slot spent, so only the capstone can pay.
const spentSlots = (id, spells) =>
  t.world.patch(id, { spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 4 }, 2: { max: 3, used: 3 }, 3: { max: 3, used: 3 } }, prepared: spells, known: spells, cantrips: [] } });

await test("Psychic Flight: a 30-foot flying speed once spent", async () => {
  const scene = await t.stage({ classId: "esper", level: 11 });
  assert.equal(authoredSpeeds(sheet(scene.holder.id), 30).fly, undefined);
  must(await spend(scene, "cyberpunk_psychic_flight"), "Psychic Flight");
  assert.equal(authoredSpeeds(sheet(scene.holder.id), 30).fly, 30);
  assert.equal(sheet(scene.holder.id).resources.cyberpunk_psychic_flight.used, 1);
});

await test("Storm of Blades: one more attack in the Attack action for a minute", async () => {
  const scene = await t.stage({ classId: "street_samurai", level: 20 });
  const { attacksAllowedFor } = await import("../src/lib/dm/turn-budget.ts");
  const before = attacksAllowedFor(sheet(scene.holder.id));
  must(await spend(scene, "cyberpunk_storm_of_blades"), "Storm of Blades");
  assert.equal(attacksAllowedFor(sheet(scene.holder.id)), before + 1);
});

await test("Singularity: the next spell of 5th level or lower costs no slot and strikes a second target 25 feet from the first", async () => {
  const scene = await t.stage({ classId: "esper", level: 20 });
  t.kit.place(scene.far.id, 10, 5);
  t.world.patch(scene.holder.id, { equipment: [...sheet(scene.holder.id).equipment, { name: "Component Pouch", qty: 1, equipped: true }] });
  spentSlots(scene.holder.id, ["Hideous Laughter"]);
  const unpaid = await t.world.invoke("cast_at_enemy", { characterId: scene.holder.id, targetEnemyId: scene.near.id, spell: "Hideous Laughter", dryRun: true });
  must(await spend(scene, "cyberpunk_singularity"), "Singularity");
  assert.ok(has(sheet(scene.holder.id).conditions, "singularity"));
  const out = await t.world.invoke("cast_at_enemy", { characterId: scene.holder.id, targetEnemyId: scene.near.id, secondTargetEnemyId: scene.far.id, spell: "Hideous Laughter" });
  assert.notEqual(out.ok, false, JSON.stringify(out).slice(0, 300));
  const second = out.result?.secondTarget;
  assert.ok(second && second.ok !== false && !second.error, JSON.stringify(second ?? out).slice(0, 300));
  assert.equal(sheet(scene.holder.id).spellcasting.slots["1"].used, 4, "no slot spent");
  assert.ok(!has(sheet(scene.holder.id).conditions, "singularity"), "the mark is spent by the cast");
  assert.ok(unpaid.ok === false || unpaid.error, "with every slot spent and no mark, the cast is not paid");
});

await test("Apocrypha and Seventh Seal pay for a spell of their own level only, while the use is left", () => {
  const holder = { name: "Holder", conditions: [], resources: { horror_apocrypha: { max: 1, used: 0 }, horror_seventh_seal: { max: 1, used: 1 } } };
  assert.equal(genreFreeCast(holder, { name: "Eyebite", level: 6 }, undefined)?.row.counter, "horror_apocrypha");
  assert.equal(genreFreeCast(holder, { name: "Eyebite", level: 6 }, 7), null, "cast at a higher level");
  assert.equal(genreFreeCast(holder, { name: "Finger of Death", level: 7 }, undefined), null, "the use is spent");
  assert.equal(genreFreeCast(holder, { name: "Fireball", level: 3 }, undefined), null);
});

await test("The Grave Chorus: for a minute a dirge may take a second target", async () => {
  const scene = await t.stage({ classId: "dirgesinger", level: 11 });
  must(await spend(scene, "dark_fantasy_the_grave_chorus"), "The Grave Chorus");
  const { authoredTwinSpell } = await import("../src/lib/srd/authored-effects-more.ts");
  assert.ok(authoredTwinSpell(sheet(scene.holder.id), { name: "Guiding Bolt", school: "evocation", level: 1 })?.anywhere);
});

await test("Beyond the Veil: the parapsychologist and the allies in reach see the unseen", async () => {
  const scene = await t.stage({ classId: "parapsychologist", level: 20 });
  must(await spend(scene, "horror_beyond_the_veil"), "Beyond the Veil");
  assert.ok(has(sheet(scene.holder.id).conditions, "beyond the veil"));
  assert.ok(has(sheet(scene.ally.id).conditions, "beyond the veil"));
});

await test("Rite of Repulsion: an undead in reach that fails is turned; with none in reach nothing is spent", async () => {
  const scene = await t.stage({ classId: "exorcist", level: 1 });
  const none = await spend(scene, "horror_rite_of_repulsion");
  assert.equal(none.ok, false, JSON.stringify(none).slice(0, 200));
  assert.equal(sheet(scene.holder.id).resources.horror_rite_of_repulsion.used, 0);
  t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, type: "undead" } });
  t.world.dice(1);
  must(await spend(scene, "horror_rite_of_repulsion"), "Rite of Repulsion");
  t.world.clearDice();
  assert.ok(t.kit.enemy(scene.near.id).conditions.some((entry) => /turned/i.test(entry)), JSON.stringify(t.kit.enemy(scene.near.id).conditions));
  assert.ok(!t.kit.enemy(scene.far.id).conditions.some((entry) => /turned/i.test(entry)), "the far foe is no undead and out of reach");
});

t.close();
console.log(`test-genre-a-capstones: ${passed} passed`);
