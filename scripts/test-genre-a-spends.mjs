// The cyberpunk, dark fantasy and horror counters a spend or a reaction now
// plays (src/lib/srd/authored-effects-genre-a.ts SPENDS, conditions in
// genre-a-conditions.ts), each through the GM's own tools. Fails without the
// rows: before them every one moved its counter and handed the text back as
// guidance (scripts/lib/sweep-spends-known.mjs GUIDANCE_ONLY).
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
const react = (scene, feature, args = {}) => t.world.invoke("use_reaction", { characterId: scene.holder.id, feature, ...args });
const conditionsOf = (id) => t.world.sheet(id).conditions.map((entry) => entry.toLowerCase());

await test("Static Shield: a bonus action, +2 AC", async () => {
  const scene = await t.stage({ classId: "esper", level: 1 });
  const before = t.srd.effectiveAcFor(t.world.sheet(scene.holder.id));
  must(await spend(scene, "cyberpunk_static_shield"), "Static Shield");
  assert.equal(t.srd.effectiveAcFor(t.world.sheet(scene.holder.id)) - before, 2);
  assert.equal(t.budget().bonusUsed, true);
});
await test("Adrenal Override: one additional action this turn", async () => {
  const scene = await t.stage({ classId: "street_samurai", level: 2 });
  must(await spend(scene, "cyberpunk_adrenal_override"), "Adrenal Override");
  assert.equal(t.budget().grantedActions, 1, JSON.stringify(t.budget()));
});
await test("Root Access: a construct that fails its INT save obeys; a goblin is refused, nothing spent", async () => {
  const scene = await t.stage({ classId: "netrunner", level: 18 });
  const refused = await spend(scene, "cyberpunk_root_access", { targetEnemyId: scene.near.id });
  assert.equal(refused.ok, false);
  assert.equal(t.world.sheet(scene.holder.id).resources.cyberpunk_root_access.used, 0);
  t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, type: "construct" } });
  t.world.dice(1);
  must(await spend(scene, "cyberpunk_root_access", { targetEnemyId: scene.near.id }), "Root Access");
  t.world.clearDice();
  assert.ok(t.kit.enemy(scene.near.id).conditions.some((entry) => /charmed/i.test(entry)), JSON.stringify(t.kit.enemy(scene.near.id).conditions));
});
await test("The Unhosted Word: an undead that fails its CHA save is banished; a goblin is refused", async () => {
  const scene = await t.stage({ classId: "exorcist", level: 20 });
  assert.equal((await spend(scene, "horror_the_unhosted_word", { targetEnemyId: scene.near.id })).ok, false);
  t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, type: "undead" } });
  t.world.dice(1);
  must(await spend(scene, "horror_the_unhosted_word", { targetEnemyId: scene.near.id }), "The Unhosted Word");
  t.world.clearDice();
  assert.ok(t.kit.enemy(scene.near.id).conditions.some((entry) => /banished/i.test(entry)));
});
await test("Deathless Champion: for a minute the grave knight cannot drop below 1", async () => {
  const scene = await t.stage({ classId: "grave_knight", level: 20 });
  must(await spend(scene, "dark_fantasy_deathless_champion"), "Deathless Champion");
  t.world.patch(scene.holder.id, { currentHp: 3, tempHp: 0 });
  await t.clubs(scene, scene.holder, 16, 4);
  assert.equal(t.hp(scene.holder.id), 1);
  await t.clubs(scene, scene.holder, 16, 4);
  assert.equal(t.hp(scene.holder.id), 1);
});
await test("One Against the Night: the slayer's strikes pass resistance to nonmagical weapons", async () => {
  const scene = await t.stage({ classId: "slayer", level: 17 });
  const loss = async () => {
    const before = t.foeHp(scene.near.id);
    must(await t.kit.swing(scene.holder.id, scene.near.id, [15, 4, 3, 3, 3]), "the swing");
    t.kit.giveTurn(scene.holder.id);
    return before - t.foeHp(scene.near.id);
  };
  const plain = await loss();
  t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } });
  // Silvered Strikes already makes the slayer's strikes magical: set it aside
  // so the spend is what passes the resistance.
  t.world.patch(scene.holder.id, { features: t.world.sheet(scene.holder.id).features.filter((entry) => entry.name !== "Silvered Strikes") });
  const resisted = await loss();
  assert.ok(resisted < plain, "the control: the resistance halves a plain strike");
  must(await spend(scene, "horror_one_against_the_night"), "One Against the Night");
  assert.equal(await loss(), plain);
});
await test("Pain Tolerance: the hit's damage is halved", async () => {
  const scene = await t.stage({ classId: "survivor", level: 7 });
  await t.clubs(scene, scene.holder, 16, 4);
  assert.equal(t.hp(scene.holder.id), 94);
  must(await react(scene, "Pain Tolerance"), "Pain Tolerance");
  assert.equal(t.hp(scene.holder.id), 97);
  assert.equal((await spend(scene, "horror_pain_tolerance")).ok, false, "use_resource has no hit to answer");
});
await test("Blood Ward: the hit's damage is resisted, and the type stays resisted until the next turn", async () => {
  const scene = await t.stage({ classId: "apostate", level: 9 });
  await t.clubs(scene, scene.holder, 16, 4);
  must(await react(scene, "Blood Ward"), "Blood Ward");
  assert.equal(t.hp(scene.holder.id), 97);
  assert.ok(conditionsOf(scene.holder.id).some((entry) => entry.startsWith("blood ward (")), JSON.stringify(conditionsOf(scene.holder.id)));
});
await test("Bullet Time answers a ranged attack only", async () => {
  const scene = await t.stage({ classId: "street_samurai", level: 13 });
  await t.clubs(scene, scene.holder, 16, 4);
  assert.equal((await react(scene, "Bullet Time")).ok, false, "a scimitar is no ranged attack");
  const stats = t.kit.enemy(scene.near.id).stats;
  t.kit.setEnemy(scene.near.id, { stats: { ...stats, attacks: [...stats.attacks, { name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing", mode: "ranged", range: { normal: 80, long: 320 } }] } });
  t.kit.place(scene.near.id, 5, 11);
  t.foesTurn(scene);
  t.kit.freshRound();
  t.world.clearDice();
  t.world.dice(11, 4);
  must(await t.world.invoke("enemy_attack", { enemyId: scene.near.id, targetCharacterId: scene.holder.id, attack: "Shortbow" }), "the shortbow");
  t.world.clearDice();
  const hurt = t.hp(scene.holder.id);
  must(await react(scene, "Bullet Time"), "Bullet Time");
  assert.ok(t.hp(scene.holder.id) > hurt, "11 + 4 hits AC 13 (Subdermal Plating) and misses 13 + 3: the hit points come back");
});
await test("Indomitable Firmware rerolls the failed save", async () => {
  const scene = await t.stage({ classId: "street_samurai", level: 9 });
  t.world.clearDice();
  t.world.dice(2);
  must(await t.world.invoke("request_roll", { characterId: scene.holder.id, kind: "saving_throw", ability: "wis", dc: 15, reason: "a probe" }), "the save");
  t.world.clearDice();
  t.world.dice(19);
  const out = must(await spend(scene, "cyberpunk_indomitable_firmware"), "Indomitable Firmware");
  t.world.clearDice();
  assert.match(JSON.stringify(out.result), /reroll/i);
  assert.equal(t.world.sheet(scene.holder.id).resources.cyberpunk_indomitable_firmware.used, 1);
});
await test("Overwatch: the attack that hit an ally is rolled again at disadvantage", async () => {
  const scene = await t.stage({ classId: "netrunner", level: 6 });
  await t.clubs(scene, scene.ally, 16, 4);
  t.world.clearDice();
  t.world.dice(2, 2);
  must(await react(scene, "Overwatch", { targetCharacterId: scene.ally.id }), "Overwatch");
  t.world.clearDice();
  assert.equal(t.hp(scene.ally.id), 20, "the reroll at disadvantage misses, and the ally's hit points come back");
});
// Two catalogs name a feature The Rite Completed (the dirgesinger's and the
// apostate's): the lookup is keyed by the class as well as the name
// (class-resources.ts matchResource's catalog), so each sheet spends its own.
await test("The Rite Completed by name spends the holder's own class's counter", async () => {
  assert.equal(t.resources.matchResource("The Rite Completed", ["apostate"])?.id, "horror_the_rite_completed");
  assert.equal(t.resources.matchResource("The Rite Completed", ["dirgesinger"])?.id, "dark_fantasy_the_rite_completed");
  const scene = await t.stage({ classId: "apostate", level: 14 });
  const out = await spend(scene, "The Rite Completed");
  assert.ok(!/dirgesinger|sing a fallen ally/i.test(JSON.stringify(out)), `the apostate's call by name reached the dirgesinger's counter: ${JSON.stringify(out).slice(0, 200)}`);
  if (out.ok) assert.equal(t.world.sheet(scene.holder.id).resources.horror_the_rite_completed.used, 1);
});
t.close();
console.log(`test-genre-a-spends: ${passed} passed`);
