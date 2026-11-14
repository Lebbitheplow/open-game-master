// The genre counters that give spell slots back (src/lib/dm/genre-a-slots.ts):
// The Net Remembers and Nanite Reserve on a short rest, Overmind by its own
// spend (refused with nothing spent when no slot is spent), Unfinished Ritual
// as the blow takes the apostate below half, The Debt Comes Due as the last
// slot is paid. Fails without them: each counter moved and no slot came back.
import assert from "node:assert/strict";
import { openClauseRig, must } from "./lib/sweep-clauses-genre-a.mjs";

const t = await openClauseRig();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const sheet = (id) => t.world.sheet(id);
const slots = (id) => sheet(id).spellcasting?.slots ?? {};
// The rig's heroes are made without spell slots: each holder is given a full
// table of them, all spent.
const giveSlots = (id, used = (slot) => slot.max) => {
  const table = { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 } };
  t.world.patch(id, { spellcasting: { ability: "cha", slots: Object.fromEntries(Object.entries(table).map(([level, slot]) => [level, { ...slot, used: used(slot, level) }])), prepared: [], known: [], cantrips: [] } });
};
const spentLevels = (id) => Object.entries(slots(id)).reduce((sum, [level, slot]) => sum + Number(level) * slot.used, 0);

await test("The Net Remembers: a short rest gives back 4 slot levels, once", async () => {
  const scene = await t.stage({ classId: "netrunner", level: 20 });
  giveSlots(scene.holder.id);
  const before = spentLevels(scene.holder.id);
  must(await t.world.invoke("end_encounter", { outcome: "truce" }), "the truce");
  must(await t.world.invoke("take_rest", { kind: "short", characterIds: [scene.holder.id] }), "the rest");
  assert.equal(before - spentLevels(scene.holder.id), 4);
  assert.equal(sheet(scene.holder.id).resources.cyberpunk_the_net_remembers.used, 1);
});
await test("Overmind: the spend gives back CHA-mod slot levels; refused with nothing spent when no slot is spent", async () => {
  const scene = await t.stage({ classId: "esper", level: 20 });
  giveSlots(scene.holder.id, () => 0);
  const refused = await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "cyberpunk_overmind" });
  assert.equal(refused.ok, false, JSON.stringify(refused).slice(0, 200));
  assert.equal(sheet(scene.holder.id).resources.cyberpunk_overmind.used, 0);
  giveSlots(scene.holder.id);
  const before = spentLevels(scene.holder.id);
  must(await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "cyberpunk_overmind" }), "Overmind");
  const cha = t.srd.computeSheetDerived(sheet(scene.holder.id)).abilityMods.cha;
  assert.ok(before - spentLevels(scene.holder.id) > 0 && before - spentLevels(scene.holder.id) <= Math.max(1, cha));
  assert.equal(sheet(scene.holder.id).resources.cyberpunk_overmind.used, 1);
});
await test("Unfinished Ritual: the blow that takes the apostate below half gives slots back, once", async () => {
  const scene = await t.stage({ classId: "apostate", level: 20 });
  giveSlots(scene.holder.id);
  const max = sheet(scene.holder.id).maxHp;
  t.world.patch(scene.holder.id, { currentHp: Math.ceil(max / 2) + 2, tempHp: 0 });
  const before = spentLevels(scene.holder.id);
  must(await t.world.invoke("apply_damage", { characterId: scene.holder.id, amount: 6, type: "slashing", reason: "a probe" }), "the blow");
  assert.ok(spentLevels(scene.holder.id) < before, "slots came back");
  assert.equal(sheet(scene.holder.id).resources.horror_unfinished_ritual.used, 1);
  assert.equal((await t.world.invoke("use_resource", { characterId: scene.holder.id, resource: "horror_unfinished_ritual" })).ok, false, "no call spends it");
});
await test("The Debt Comes Due: the last slot, paid, comes straight back", async () => {
  const scene = await t.stage({ classId: "occultist", level: 20 });
  giveSlots(scene.holder.id, (slot, level) => (level === "1" ? slot.max - 1 : slot.max));
  // No spell named: the slot alone is spent, through the same guard.
  const out = await t.world.invoke("use_spell_slot", { characterId: scene.holder.id, level: 1 });
  assert.ok(out.ok !== false, JSON.stringify(out).slice(0, 300));
  assert.equal(slots(scene.holder.id)["1"].used, slots(scene.holder.id)["1"].max - 1, "the slot came back");
  assert.equal(sheet(scene.holder.id).resources.horror_the_debt_comes_due.used, 1);
});
t.close();
console.log(`test-genre-a-slots: ${passed} passed`);
