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

await test("Grave Grip: each creature named within 15 feet saves on Strength or is restrained until the knight's next turn", async () => {
  const scene = await t.stage({ classId: "grave_knight", level: 6 });
  t.kit.place(scene.far.id, 6, 6);
  t.world.dice(1, 1);
  must(await spend(scene, "dark_fantasy_grave_grip"), "Grave Grip");
  t.world.clearDice();
  for (const foe of [scene.near, scene.far]) {
    const held = t.kit.enemy(foe.id);
    assert.ok(held.conditions.includes("restrained"), `${foe.id}: ${JSON.stringify(held.conditions)}`);
    assert.equal(held.conditionMeta.restrained?.untilTurnOf ?? held.conditionMeta.restrained?.instances?.[0]?.untilTurnOf, scene.holder.id, JSON.stringify(held.conditionMeta));
  }
  assert.equal(t.budget().actionUsed, true, "the action");
});

await test("Voice Like Embers: 3d6 fire and deafened for a minute on a failed Constitution save, both foes in 15 feet", async () => {
  const scene = await t.stage({ classId: "penitent", level: 7 });
  t.kit.place(scene.far.id, 7, 5);
  const before = [t.foeHp(scene.near.id), t.foeHp(scene.far.id)];
  t.world.dice(3, 3, 3, 1, 1);
  must(await spend(scene, "dark_fantasy_voice_like_embers"), "Voice Like Embers");
  t.world.clearDice();
  assert.deepEqual([before[0] - t.foeHp(scene.near.id), before[1] - t.foeHp(scene.far.id)], [9, 9]);
  assert.ok(t.kit.enemy(scene.far.id).conditions.includes("deafened"));
});

await test("Murder of Crows: enemies within 20 feet that fail are blinded until a Constitution save ends it; the foe 70 feet off is untouched", async () => {
  const scene = await t.stage({ classId: "plague_doctor", level: 7 });
  t.world.dice(1, 1);
  must(await spend(scene, "dark_fantasy_murder_of_crows"), "Murder of Crows");
  t.world.clearDice();
  const near = t.kit.enemy(scene.near.id);
  assert.ok(near.conditions.includes("blinded"));
  assert.match(JSON.stringify(near.conditionMeta.blinded), /saveEnds/);
  assert.ok(!t.kit.enemy(scene.far.id).conditions.includes("blinded"));
});

await test("Immolate the Sin: for a minute a hit carries 2d8 fire and fire does nothing to the penitent", async () => {
  const scene = await t.stage({ classId: "penitent", level: 15 });
  must(await spend(scene, "dark_fantasy_immolate_the_sin"), "Immolate the Sin");
  assert.ok(conditions(scene.holder.id).includes("immolate the sin"));
  const hit = must(await swing(scene, scene.near, [15, 4, 3, 3, 3, 3, 3]), "the swing");
  assert.match(JSON.stringify(hit.result), /2d8/);
  must(await t.world.invoke("apply_damage", { characterId: scene.holder.id, amount: 10, type: "fire" }), "the fire");
  assert.equal(sheet(scene.holder.id).currentHp, 100);
});

await test("Sepulchral Aura and Numb to the Lash: a weapon blow loses 1 beside the knight and the penitent's Wisdom modifier, never below 1", async () => {
  const knight = await t.stage({ classId: "grave_knight", level: 1 });
  assert.equal((await t.clubs(knight, knight.holder, 16, 4)).totalDamage, 5, "a club for 6 beside the knight");
  assert.equal((await t.clubs(knight, knight.ally, 16, 4)).totalDamage, 5, "the same club on the ally beside the knight");
  const penitent = await t.stage({ classId: "penitent", level: 14 });
  assert.equal((await t.clubs(penitent, penitent.holder, 16, 4)).totalDamage, 3, "a club for 6 on a Wisdom of 16");
  assert.equal((await t.clubs(penitent, penitent.holder, 16, 1)).totalDamage, 1, "a club for 3 still deals 1");
});

t.close();
console.log(`test-genre-a-dark-fantasy: ${passed} passed`);
