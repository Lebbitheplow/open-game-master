// The horror classes' features the fifth genre-a round built
// (src/lib/srd/authored-effects-genre-a-horror.ts and the readers it names):
// the controls the clause ledger's probes do not stage. Each case fails
// without its mechanism: the feature was a line of the GM's prompt.
import assert from "node:assert/strict";
import { openClauseRig, must } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
const { horrorCheckRider } = await import("../src/lib/srd/genre-a-horror-holds.ts");
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

t.close();
console.log(`test-genre-a-horror: ${passed} passed`);
