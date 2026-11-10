// The genre classes' counters the engine spends itself
// (src/lib/srd/genre-a-counter-terms.ts): Autodoc Implant heals the trauma
// doc below half at the start of their turn and takes a round of its five
// each time, none left none given; The Body Is a Prayer heals the penitent
// while below half and conscious. Fails without the turn_heal rows and the
// counter they spend.
import assert from "node:assert/strict";
import { openClauseRig } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
const turns = await import(new URL("../src/lib/dm/authored-turns.ts", import.meta.url).href);
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const startTurn = (id) => {
  t.world.clearDice();
  t.world.dice(3);
  turns.authoredTurnStart(t.world.campaign(), t.world.encounter(), [id]);
  t.world.clearDice();
};
const WIS = 3;

await test("Autodoc Implant: below half, WIS hit points at the turn's start, one round spent; none left, none given", async () => {
  const scene = await t.stage({ classId: "trauma_doc", level: 15 }, { hp: 40 });
  startTurn(scene.holder.id);
  assert.equal(t.hp(scene.holder.id), 40 + WIS);
  assert.equal(t.world.sheet(scene.holder.id).resources.cyberpunk_autodoc_implant.used, 1);
  const pool = t.world.sheet(scene.holder.id).resources.cyberpunk_autodoc_implant;
  t.world.patch(scene.holder.id, { resources: { ...t.world.sheet(scene.holder.id).resources, cyberpunk_autodoc_implant: { ...pool, used: pool.max } } });
  startTurn(scene.holder.id);
  assert.equal(t.hp(scene.holder.id), 40 + WIS);
});
await test("Autodoc Implant gives nothing at or above half", async () => {
  const scene = await t.stage({ classId: "trauma_doc", level: 15 }, { hp: 60 });
  startTurn(scene.holder.id);
  assert.equal(t.hp(scene.holder.id), 60);
  assert.equal(t.world.sheet(scene.holder.id).resources.cyberpunk_autodoc_implant.used, 0);
});
await test("The Body Is a Prayer heals below half, not at 0 hit points", async () => {
  const scene = await t.stage({ classId: "penitent", level: 18 }, { hp: 40 });
  startTurn(scene.holder.id);
  assert.equal(t.hp(scene.holder.id), 40 + WIS);
  t.world.patch(scene.holder.id, { currentHp: 0, conditions: ["unconscious", "prone"] });
  startTurn(scene.holder.id);
  assert.equal(t.hp(scene.holder.id), 0);
});
t.close();
console.log(`test-genre-a-counters: ${passed} passed`);
