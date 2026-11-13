// The genre classes' "when you drop to 0 HP, drop to 1 instead" counters
// (src/lib/dm/genre-drop-holds.ts), held at the drop as Relentless Endurance
// is, and refused as a bare use_resource spend (WAVE1 R10). Fails without the
// hold: before it each was a card on the holder's own turn that spent the use
// with nothing to answer, and the survivor fell at 0 with it unspent.
import assert from "node:assert/strict";
import { openClauseRig, mod } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const used = (id, counter) => t.world.sheet(id).resources[counter]?.used;

async function dropped(classId, level, hp = 3, target = "holder") {
  const scene = await t.stage({ classId, level });
  const victim = target === "holder" ? scene.holder : scene.ally;
  t.world.patch(victim.id, { currentHp: hp, tempHp: 0 });
  await t.clubs(scene, victim, 16, 4);
  return { scene, victim };
}

await test("Won't Die Here keeps the survivor at 1, once, then they fall", async () => {
  const { scene } = await dropped("survivor", 1);
  assert.equal(t.hp(scene.holder.id), 1);
  assert.equal(used(scene.holder.id, "horror_won_t_die_here"), 1);
  await t.clubs(scene, scene.holder, 16, 4);
  assert.equal(t.hp(scene.holder.id), 0, "the second drop of the day falls");
});
await test("Won't Die Here is refused as a bare spend, nothing spent", async () => {
  const scene = await t.stage({ classId: "survivor", level: 1 });
  const out = await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "horror_won_t_die_here" });
  assert.equal(out.ok, false);
  assert.equal(used(scene.holder.id, "horror_won_t_die_here"), 0);
});
await test("The One Who Lives: twice a day, each use restoring five times the Constitution modifier", async () => {
  const { scene } = await dropped("survivor", 20);
  const want = 1 + 5 * mod("con");
  assert.equal(t.hp(scene.holder.id), want);
  t.world.patch(scene.holder.id, { currentHp: 3 });
  await t.clubs(scene, scene.holder, 16, 4);
  assert.equal(t.hp(scene.holder.id), want, "the second use");
  t.world.patch(scene.holder.id, { currentHp: 3 });
  await t.clubs(scene, scene.holder, 16, 4);
  assert.equal(t.hp(scene.holder.id), 0, "a third drop falls");
});
await test("Deathless Vigor: 1 hit point and temporary hit points equal to the level", async () => {
  const { scene } = await dropped("grave_knight", 10);
  assert.equal(t.hp(scene.holder.id), 1);
  assert.equal(t.world.sheet(scene.holder.id).tempHp, 10);
});
await test("Martyr's Endurance with Sainted Scars: temporary hit points, and a short rest gives it back", async () => {
  const { scene } = await dropped("penitent", 17);
  assert.equal(t.hp(scene.holder.id), 1);
  assert.equal(t.world.sheet(scene.holder.id).tempHp, 17);
  await t.world.invoke("end_encounter", { outcome: "truce" });
  await t.world.invoke("take_rest", { kind: "short", characterIds: [scene.holder.id] });
  assert.equal(used(scene.holder.id, "dark_fantasy_martyr_s_endurance"), 0);
});
await test("One More Dawn holds an ally within 30 feet, and not one farther off", async () => {
  const near = await dropped("trauma_doc", 15, 3, "ally");
  assert.equal(t.hp(near.victim.id), 1);
  assert.equal(used(near.scene.holder.id, "cyberpunk_one_more_dawn"), 1);
  const scene = await t.stage({ classId: "trauma_doc", level: 15 });
  t.kit.place(scene.ally.id, 5, 14);
  t.kit.place(scene.near.id, 5, 13);
  t.world.patch(scene.ally.id, { currentHp: 3 });
  await t.clubs(scene, scene.ally, 16, 4);
  assert.equal(t.hp(scene.ally.id), 0, "an ally 45 feet away falls");
  assert.equal(used(scene.holder.id, "cyberpunk_one_more_dawn"), 0);
});
await test("Final Benediction: the ally drops instead to five times the exorcist's Wisdom modifier", async () => {
  const { victim } = await dropped("exorcist", 18, 3, "ally");
  assert.equal(t.hp(victim.id), 5 * mod("wis"));
});
t.close();
console.log(`test-genre-drop-holds: ${passed} passed`);
