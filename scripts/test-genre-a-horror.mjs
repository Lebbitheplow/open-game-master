// The horror classes' features the fifth genre-a round built
// (src/lib/srd/authored-effects-genre-a-horror.ts and the readers it names):
// the controls the clause ledger's probes do not stage. Each case fails
// without its mechanism: the feature was a line of the GM's prompt.
import assert from "node:assert/strict";
import { openClauseRig, must } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
const { horrorCheckRider, horrorMagicalAgainst } = await import("../src/lib/srd/genre-a-horror-holds.ts");
const { soleSurvivorResistances, soleSurvivorSpeed } = await import("../src/lib/dm/genre-a-horror-party.ts");
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const sheet = (id) => t.world.sheet(id);
const spend = (scene, resource, args = {}) => t.world.invoke("use_resource", { characterId: scene.holder.id, resource, ...args });

await test("Forbidden Lore doubles proficiency on Arcana and Religion, not on History", () => {
  t.fresh();
  const hero = sheet(t.hero("occultist", 1).id);
  assert.equal(horrorCheckRider(hero, "arcana", "int").expertise, true);
  assert.equal(horrorCheckRider(hero, "religion", "int").expertise, true);
  assert.equal(horrorCheckRider(hero, "history", "int").expertise, false);
});

await test("Desperate Strength adds 2 to STR and DEX checks below half hit points only", () => {
  t.fresh();
  const hero = sheet(t.hero("survivor", 11).id);
  assert.equal(horrorCheckRider({ ...hero, currentHp: 40 }, null, "str").bonus, 2);
  assert.equal(horrorCheckRider({ ...hero, currentHp: 40 }, "acrobatics", "dex").bonus, 2);
  assert.equal(horrorCheckRider({ ...hero, currentHp: 40 }, null, "int").bonus, 0, "an INT check");
  assert.equal(horrorCheckRider({ ...hero, currentHp: 60 }, null, "str").bonus, 0, "above half");
});

await test("Quarry without Extinction moves its one mark; with it the second creature takes its own", async () => {
  const scene = await t.stage({ classId: "slayer", level: 20 });
  t.kit.place(scene.far.id, 4, 6);
  must(await spend(scene, "Quarry", { targetEnemyId: scene.near.id }), "the first mark");
  t.kit.giveTurn(scene.holder.id);
  must(await spend(scene, "Quarry", { targetEnemyId: scene.far.id }), "the second mark");
  const marks = sheet(scene.holder.id).conditions.filter((entry) => entry.toLowerCase().startsWith("quarry"));
  assert.equal(marks.length, 2, `two marks at 20th level: ${marks}`);
  const level7 = await t.stage({ classId: "slayer", level: 7 });
  t.kit.place(level7.far.id, 4, 6);
  must(await spend(level7, "Quarry", { targetEnemyId: level7.near.id }), "the first mark at 7th");
  t.kit.giveTurn(level7.holder.id);
  must(await spend(level7, "Quarry", { targetEnemyId: level7.far.id }), "the second mark at 7th");
  const one = sheet(level7.holder.id);
  assert.deepEqual(one.conditions.filter((entry) => entry.toLowerCase().startsWith("quarry")), ["quarry"]);
  assert.equal(one.conditionMeta.quarry.quarry, level7.far.id, "the mark moved");
});

await test("Consecrated Tools: magical against fiends and undead, not against a construct", () => {
  t.fresh();
  const hero = sheet(t.hero("exorcist", 1).id);
  assert.equal(horrorMagicalAgainst(hero, "undead"), true);
  assert.equal(horrorMagicalAgainst(hero, "fiend (demon)"), true);
  assert.equal(horrorMagicalAgainst(hero, "construct"), false);
});

await test("Sole Survivor: no resistance while an ally stands; every type and double speed once the last one drops", async () => {
  const scene = await t.stage({ classId: "survivor", level: 15 });
  const holder = () => sheet(scene.holder.id);
  assert.equal(soleSurvivorResistances(t.world.campaignId, holder()), "", "the hurt ally is still up");
  assert.equal(soleSurvivorSpeed(t.world.campaignId, holder(), 30), 30);
  must(await t.world.invoke("apply_damage", { characterId: scene.holder.id, amount: 10, type: "fire" }), "the control damage");
  assert.equal(t.hp(scene.holder.id), 90, "full damage while an ally stands");
  t.world.patch(scene.ally.id, { currentHp: 0, conditions: ["unconscious", "prone"] });
  assert.equal(soleSurvivorSpeed(t.world.campaignId, holder(), 30), 60);
  must(await t.world.invoke("apply_damage", { characterId: scene.holder.id, amount: 10, type: "fire" }), "the damage");
  assert.equal(t.hp(scene.holder.id), 85, "half once the holder is the last one conscious");
});

await test("Their Power, Your Hands: the next stigmata of 5th level or lower costs no slot and deals its maximum", async () => {
  const slotsGone = (id) => t.world.patch(id, { spellcasting: { ability: "cha", slots: { 1: { max: 4, used: 4 }, 2: { max: 3, used: 3 }, 3: { max: 3, used: 3 }, 4: { max: 3, used: 3 } }, prepared: ["Inflict Wounds", "Blight"], known: ["Inflict Wounds", "Blight"], cantrips: [] } });
  const marked = (id) => sheet(id).conditions.some((entry) => entry.toLowerCase().startsWith("their power"));
  // A spell attack (pc_attack): Inflict Wounds, 3d10 at most 30.
  let scene = await t.stage({ classId: "apostate", level: 20 });
  slotsGone(scene.holder.id);
  const unpaid = await t.kit.swing(scene.holder.id, scene.near.id, [15, 1, 1, 1], { spell: "Inflict Wounds" });
  assert.ok(unpaid.ok === false || unpaid.error, "with every slot spent and no mark, the cast is not paid");
  t.kit.giveTurn(scene.holder.id);
  must(await spend(scene, "horror_their_power_your_hands"), "Their Power, Your Hands");
  let before = t.foeHp(scene.near.id);
  must(await t.kit.swing(scene.holder.id, scene.near.id, [15, 1, 1, 1], { spell: "Inflict Wounds" }), "Inflict Wounds");
  assert.equal(before - t.foeHp(scene.near.id), 30, "Inflict Wounds at its maximum");
  assert.equal(sheet(scene.holder.id).spellcasting.slots["1"].used, 4, "no slot spent");
  assert.ok(!marked(scene.holder.id), "the cast clears the mark");
  // A save spell (cast_at_enemy): Blight, 8d8 at most 64 on a failed save.
  scene = await t.stage({ classId: "apostate", level: 20 });
  slotsGone(scene.holder.id);
  must(await spend(scene, "horror_their_power_your_hands"), "Their Power, Your Hands");
  before = t.foeHp(scene.near.id);
  t.world.dice(1, 1, 1, 1, 1, 1, 1, 1, 1);
  const out = await t.world.invoke("cast_at_enemy", { characterId: scene.holder.id, targetEnemyId: scene.near.id, spell: "Blight" });
  t.world.clearDice();
  assert.notEqual(out.ok, false, JSON.stringify(out).slice(0, 300));
  assert.equal(before - t.foeHp(scene.near.id), 64, "Blight at its maximum");
  assert.ok(!marked(scene.holder.id), "the cast clears the mark");
});

t.close();
console.log(`test-genre-a-horror: ${passed} passed`);
