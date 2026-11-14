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

await test("Field Surgeon: the stabilized ally's wait is ten rounds on the stable clock, not 1d4 hours", async () => {
  const scene = await t.stage({ classId: "trauma_doc", level: 5 });
  t.world.clearDice();
  t.world.dice(15);
  must(await t.world.invoke("stabilize", { characterId: scene.fallen.id, healerId: scene.holder.id }), "stabilizing");
  t.world.clearDice();
  const meta = t.world.sheet(scene.fallen.id).conditionMeta?.unconscious;
  assert.equal(meta?.rounds, 10, JSON.stringify(meta));
  assert.equal(meta?.source, "stable");
});

await test("Daemon Swarm: one Blight strikes three creatures for one slot; without the mark a second target is refused", async () => {
  t.fresh();
  const hero = t.hero("netrunner", 14, { equipment: [], spellcasting: { ability: "int", slots: { 4: { max: 2, used: 0 } }, known: ["Blight"], prepared: ["Blight"], cantrips: [] } });
  await t.kit.fight(3, { heroFaces: { [hero.id]: 19 } });
  const foes = t.world.enemies();
  t.kit.place(hero.id, 5, 5);
  foes.forEach((foe, index) => t.kit.place(foe.id, 7 + index * 2, 5));
  t.kit.giveTurn(hero.id);
  const cast = (target, more = {}) => t.world.invoke("cast_at_enemy", { characterId: hero.id, spell: "Blight", level: 4, targetEnemyId: target.id, ...more });
  assert.equal((await cast(foes[0], { secondTargetEnemyId: foes[1].id })).ok, false, "a second target with no mark");
  must(await t.world.invoke("use_resource", { characterId: hero.id, resource: "Daemon Swarm" }), "Daemon Swarm");
  must(await cast(foes[0], { secondTargetEnemyId: foes[1].id }), "Blight at two");
  must(await cast(foes[2]), "Blight at the third");
  assert.equal(t.world.sheet(hero.id).spellcasting.slots["4"].used, 1, "slots spent for the three");
  assert.ok(foes.every((foe) => t.foeHp(foe.id) < 300 || t.kit.enemy(foe.id).currentHp < t.kit.enemy(foe.id).maxHp), "each of the three took the Blight");
});

t.close();
console.log(`test-genre-a-cyberpunk: ${passed} passed`);
