// The dark fantasy classes' features the engine now plays as their text says
// (src/lib/dm/genre-a-dark-fantasy-*.ts, src/lib/srd/genre-a-dark-fantasy-*.ts).
// Each case fails without its mechanism: before it, the spend moved its counter
// and handed back its guidance, or the passive was a line of the GM's prompt.
import assert from "node:assert/strict";
import { openClauseRig, must } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const spend = (scene, resource, args = {}) => t.world.invoke("use_resource", { characterId: scene.holder.id, resource, ...args });
const sheet = (id) => t.world.sheet(id);
const conditions = (id) => sheet(id).conditions.map((entry) => entry.toLowerCase());
const swing = (scene, target, faces = [15, 4, 3, 3, 3, 3]) => t.kit.swing(scene.holder.id, target.id, faces);

await test("Hunter's Brand: an invisible creature is refused with nothing spent, and the brand ends when its creature dies", async () => {
  const scene = await t.stage({ classId: "witch_hunter", level: 1 });
  t.kit.setEnemy(scene.near.id, { conditions: ["invisible"] });
  const unseen = await spend(scene, "Hunter's Brand", { targetEnemyId: scene.near.id });
  assert.equal(unseen.ok, false, JSON.stringify(unseen).slice(0, 200));
  assert.equal(t.budget().bonusUsed ?? false, false, "the bonus action is kept");
  t.kit.setEnemy(scene.near.id, { conditions: [], currentHp: 1 });
  must(await spend(scene, "Hunter's Brand", { targetEnemyId: scene.near.id }), "the brand");
  assert.ok(conditions(scene.holder.id).includes("hunter's brand"));
  must(await swing(scene, scene.near), "the killing swing");
  assert.ok(!conditions(scene.holder.id).includes("hunter's brand"), "the brand is gone with its creature");
});

await test("Twin Brand: a second creature takes a second brand, the first stays, and both carry 1d8 radiant", async () => {
  const scene = await t.stage({ classId: "witch_hunter", level: 11 });
  t.kit.place(scene.far.id, 4, 6);
  must(await spend(scene, "Hunter's Brand", { targetEnemyId: scene.near.id }), "the first brand");
  t.kit.giveTurn(scene.holder.id);
  must(await spend(scene, "Hunter's Brand", { targetEnemyId: scene.far.id }), "the second brand");
  const meta = sheet(scene.holder.id).conditionMeta;
  assert.equal(meta["hunter's brand (1d8)"]?.quarry, scene.near.id);
  assert.equal(meta["second brand (1d8)"]?.quarry, scene.far.id);
  t.kit.giveTurn(scene.holder.id);
  const hit = must(await swing(scene, scene.far), "the swing at the second");
  assert.match(String(hit.result.damage?.expression ?? JSON.stringify(hit.result)), /1d8.*1d8|2d8/, "the weapon's d8 and the brand's d8");
});

t.close();
console.log(`test-genre-a-dark-fantasy: ${passed} passed`);
