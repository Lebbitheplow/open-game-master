// The cyberpunk classes' rules the fifth genre-a round builds
// (src/lib/srd/authored-effects-genre-a-cyberpunk.ts and the
// src/lib/dm/genre-a-cyberpunk-*.ts modules), each played through the GM's
// tools. Each case fails without its mechanism.
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
const outOfFight = async () => must(await t.world.invoke("end_encounter", { outcome: "truce" }), "the truce");
const featureNames = (id) => t.world.sheet(id).features.map((feature) => feature.name);

await test("Combat Wetware: the pick is made out of a fight, kept on the sheet, and only the option chosen holds", async () => {
  const scene = await t.stage({ classId: "street_samurai", level: 1 });
  assert.equal((await spend(scene, "Combat Wetware", { variant: "Smartlink" })).ok, false, "a pick made in a fight");
  await outOfFight();
  assert.equal((await spend(scene, "Combat Wetware")).ok, false, "a pick with no option named");
  must(await spend(scene, "Combat Wetware", { variant: "Dermal Weave" }), "the pick");
  assert.ok(featureNames(scene.holder.id).includes("Combat Wetware (Dermal Weave)"), featureNames(scene.holder.id).join(", "));
  const sheet = t.world.sheet(scene.holder.id);
  const bare = t.srd.deriveAc({ ...sheet, equipment: [{ name: "Leather", qty: 1, equipped: true }] });
  const held = t.authored.heldAuthored(sheet).find((entry) => entry.feature === "Combat Wetware");
  assert.equal(held?.choice, "dermal weave");
  // The same sheet with the plating unpicked: one point less.
  const unpicked = { ...sheet, features: sheet.features.map((feature) => (feature.name.startsWith("Combat Wetware") ? { ...feature, name: "Combat Wetware" } : feature)), equipment: [{ name: "Leather", qty: 1, equipped: true }] };
  assert.equal(bare - t.srd.deriveAc(unpicked), 1, "Dermal Weave's +1 AC in leather");
  // "Daemon Cache (2 programs)" is a feature of its own, never read as a pick.
  const netrunner = t.hero("netrunner", 11);
  const rows = t.authored.heldAuthored(t.world.sheet(netrunner.id)).filter((entry) => entry.feature === "Daemon Cache");
  assert.ok(rows.length <= 1, `Daemon Cache's row is held ${rows.length} times`);
});

await test("Psi Font: each short rest gives one 1st-level slot back, the second as the first", async () => {
  t.fresh();
  const hero = t.hero("esper", 2, { spellcasting: { ability: "cha", slots: { 1: { max: 3, used: 3 } }, known: [], prepared: [], cantrips: [] } });
  for (const want of [2, 1]) {
    must(await t.world.invoke("take_rest", { kind: "short", characterIds: [hero.id] }), "a short rest");
    assert.equal(t.world.sheet(hero.id).spellcasting.slots["1"].used, want);
  }
  assert.equal((await t.world.invoke("use_resource", { characterId: hero.id, resource: "cyberpunk_psi_font" })).ok, false, "a bare spend of a counter the rest spends");
});

t.close();
console.log(`test-genre-a-cyberpunk: ${passed} passed`);
