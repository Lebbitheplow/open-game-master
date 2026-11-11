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

await test("Dirge of Sorrow: the enemy named saves on Wisdom or takes 1d4 off its next attack; Dirge of Ruin takes three and their saves too", async () => {
  const scene = await t.stage({ classId: "dirgesinger", level: 1 });
  const bare = await spend(scene, "Dirge of Sorrow");
  assert.equal(bare.ok, false, "no enemy named");
  t.world.dice(1);
  must(await spend(scene, "Dirge of Sorrow", { targetEnemyId: scene.near.id }), "Dirge of Sorrow");
  t.world.clearDice();
  assert.ok(t.kit.enemy(scene.near.id).conditions.includes("dirge of sorrow"));
  assert.equal(t.budget().actionUsed, true);
  const two = await spend(scene, "Dirge of Sorrow", { targetEnemyIds: [scene.near.id, scene.far.id] });
  assert.equal(two.ok, false, "a level 1 dirge takes one enemy");
  const ruin = await t.stage({ classId: "dirgesinger", level: 13 });
  t.kit.place(ruin.far.id, 7, 5);
  t.world.dice(1, 1);
  must(await spend(ruin, "Dirge of Sorrow", { targetEnemyIds: [ruin.near.id, ruin.far.id] }), "Dirge of Ruin");
  t.world.clearDice();
  assert.ok(t.kit.enemy(ruin.far.id).conditions.includes("dirge of ruin"));
  const { conditionRollRiders } = await import("../src/lib/srd/condition-effects.ts");
  assert.match(conditionRollRiders(["dirge of ruin"], "save").diceSuffix, /-1d4/);
  assert.match(conditionRollRiders(["dirge of sorrow"], "attack").diceSuffix, /-1d4/);
});

await test("Purging Flame: refused with no brand; declared, the next hit on the branded creature carries 2d10 radiant and spends it", async () => {
  const scene = await t.stage({ classId: "witch_hunter", level: 7 });
  const bare = await spend(scene, "dark_fantasy_purging_flame");
  assert.equal(bare.ok, false);
  assert.equal(sheet(scene.holder.id).resources.dark_fantasy_purging_flame.used, 0);
  must(await spend(scene, "Hunter's Brand", { targetEnemyId: scene.near.id }), "the brand");
  must(await spend(scene, "dark_fantasy_purging_flame"), "Purging Flame");
  const hit = must(await swing(scene, scene.near, [15, 4, 3, 3, 3, 3, 3, 3]), "the swing");
  assert.match(JSON.stringify(hit.result), /2d10/);
  assert.ok(!conditions(scene.holder.id).includes("purging flame"), "spent by the hit");
});

await test("Judgment Shot: the next ranged hit on the branded creature is a critical hit", async () => {
  const scene = await t.stage({ classId: "witch_hunter", level: 13 }, { lane: true, extra: { equipment: [{ name: "Shortbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] } });
  must(await spend(scene, "Hunter's Brand", { targetEnemyId: scene.far.id }), "the brand");
  must(await spend(scene, "dark_fantasy_judgment_shot"), "Judgment Shot");
  const shot = must(await t.kit.swing(scene.holder.id, scene.far.id, [15, 4, 4, 3, 3, 3, 3]), "the shot");
  assert.equal(shot.result.crit, true, JSON.stringify(shot.result).slice(0, 300));
  assert.ok(!conditions(scene.holder.id).includes("judgment shot"));
});

await test("Lance the Wound: after a melee hit 2d8 necrotic and no healing until the doctor's next turn; Virulent Strain 4d8 and half beside it", async () => {
  const { regainBlockedBy } = await import("../src/lib/dm/vitals-logic.ts");
  const scene = await t.stage({ classId: "plague_doctor", level: 5 });
  const early = await spend(scene, "dark_fantasy_lance_the_wound", { targetEnemyId: scene.near.id });
  assert.equal(early.ok, false, "no hit yet");
  must(await swing(scene, scene.near), "the hit");
  const before = t.foeHp(scene.near.id);
  t.world.dice(3, 3);
  must(await spend(scene, "dark_fantasy_lance_the_wound", { targetEnemyId: scene.near.id }), "Lance the Wound");
  t.world.clearDice();
  assert.equal(before - t.foeHp(scene.near.id), 6);
  assert.equal(regainBlockedBy(t.kit.enemy(scene.near.id)), "lanced wound");
  const strain = await t.stage({ classId: "plague_doctor", level: 11 });
  t.kit.place(strain.far.id, 6, 6);
  must(await swing(strain, strain.near), "the hit");
  const far = t.foeHp(strain.far.id);
  t.world.dice(3, 3, 3, 3);
  must(await spend(strain, "dark_fantasy_lance_the_wound", { targetEnemyId: strain.near.id }), "Lance the Wound");
  t.world.clearDice();
  assert.equal(far - t.foeHp(strain.far.id), 6, "half of 12 to the creature beside it");
});

await test("Threnody: an enemy within 30 feet that hears and fails deals half damage with its next blow, and only that one; a deafened one is left out", async () => {
  const scene = await t.stage({ classId: "dirgesinger", level: 6 });
  t.kit.setEnemy(scene.far.id, { conditions: ["deafened"] });
  t.kit.place(scene.far.id, 7, 5);
  t.world.dice(1, 1);
  must(await spend(scene, "dark_fantasy_threnody"), "Threnody");
  t.world.clearDice();
  assert.ok(t.kit.enemy(scene.near.id).conditions.includes("threnody"));
  assert.ok(!t.kit.enemy(scene.far.id).conditions.includes("threnody"), "the deafened foe cannot hear");
  assert.equal((await t.clubs(scene, scene.holder, 16, 4)).totalDamage, 3, "a club for 6, halved");
  assert.equal((await t.clubs(scene, scene.holder, 16, 4)).totalDamage, 6, "the next blow is whole");
});

await test("Song That Ends: a creature below 50 hit points that fails drops to 0; one at 50 or more is refused with nothing spent", async () => {
  const scene = await t.stage({ classId: "dirgesinger", level: 17 });
  const strong = await spend(scene, "dark_fantasy_song_that_ends", { targetEnemyId: scene.near.id });
  assert.equal(strong.ok, false, "the staged foe has 300 hit points");
  assert.equal(sheet(scene.holder.id).resources.dark_fantasy_song_that_ends.used, 0);
  t.kit.setEnemy(scene.near.id, { currentHp: 40 });
  t.world.dice(1);
  must(await spend(scene, "dark_fantasy_song_that_ends", { targetEnemyId: scene.near.id }), "Song That Ends");
  t.world.clearDice();
  assert.equal(t.foeHp(scene.near.id), 0);
});

await test("Voice of the Veil: Threnody reaches a deafened enemy", async () => {
  const scene = await t.stage({ classId: "dirgesinger", level: 18 });
  t.kit.setEnemy(scene.near.id, { conditions: ["deafened"] });
  t.world.dice(1, 1);
  must(await spend(scene, "dark_fantasy_threnody"), "Threnody");
  t.world.clearDice();
  assert.ok(t.kit.enemy(scene.near.id).conditions.includes("threnody"));
});

await test("The Flame That Judges: each enemy within 30 feet that fails its Wisdom save is branded, its hits carrying the brand's die, and its death ends its brand", async () => {
  const scene = await t.stage({ classId: "witch_hunter", level: 15 });
  t.kit.place(scene.far.id, 9, 5);
  t.world.dice(1, 1);
  must(await spend(scene, "dark_fantasy_the_flame_that_judges"), "The Flame That Judges");
  t.world.clearDice();
  const meta = sheet(scene.holder.id).conditionMeta;
  const judged = Object.entries(meta).filter(([name]) => name.startsWith("judged ("));
  assert.equal(judged.length, 2, JSON.stringify(Object.keys(meta)));
  t.kit.setEnemy(scene.near.id, { currentHp: 1 });
  t.kit.giveTurn(scene.holder.id);
  must(await swing(scene, scene.near), "the killing swing");
  assert.equal(Object.keys(sheet(scene.holder.id).conditionMeta).filter((name) => name.startsWith("judged (")).length, 1);
});

await test("Triage: a stabilized patient waits a minute and wakes with the d4's hit points; Last Rites stabilizes with no check and wards", async () => {
  const { wakeStable } = await import("../src/lib/dm/death.ts");
  const scene = await t.stage({ classId: "plague_doctor", level: 6 });
  t.world.dice(15, 3);
  const out = must(await t.world.invoke("stabilize", { characterId: scene.fallen.id, healerId: scene.holder.id }), "stabilizing");
  t.world.clearDice();
  assert.match(JSON.stringify(out.result), /1 minute/);
  const meta = sheet(scene.fallen.id).conditionMeta;
  assert.equal(meta.unconscious?.rounds, 10);
  assert.ok(conditions(scene.fallen.id).includes("triaged (3)"), JSON.stringify(conditions(scene.fallen.id)));
  wakeStable(t.world.campaign(), scene.fallen.id);
  assert.equal(sheet(scene.fallen.id).currentHp, 3);
  const singer = await t.stage({ classId: "dirgesinger", level: 3 });
  t.world.dice(1);
  const sung = must(await t.world.invoke("stabilize", { characterId: singer.fallen.id, healerId: singer.holder.id }), "Last Rites");
  t.world.clearDice();
  assert.equal(sheet(singer.fallen.id).deathSaves.stable, true, JSON.stringify(sung.result).slice(0, 200));
  assert.ok(conditions(singer.fallen.id).includes("warded by last rites"));
});

await test("Rose Thorn Oath: a pact-blade hit heals the knight their Charisma modifier, once a turn", async () => {
  const scene = await t.stage({ classId: "grave_knight", level: 5 }, { hp: 50 });
  must(await spend(scene, "Deathly Pact Blade"), "Deathly Pact Blade");
  must(await swing(scene, scene.near), "the first hit");
  assert.equal(sheet(scene.holder.id).currentHp, 52);
  must(await swing(scene, scene.near), "the second hit, the same turn");
  assert.equal(sheet(scene.holder.id).currentHp, 52, "once a turn");
});

await test("The Last Rose: an ally within 30 feet who would drop to 0 stays at 1, and the knight's next hit is a critical hit", async () => {
  const scene = await t.stage({ classId: "grave_knight", level: 15 });
  must(await t.world.invoke("apply_damage", { characterId: scene.ally.id, amount: 25, type: "slashing" }), "the blow");
  assert.equal(sheet(scene.ally.id).currentHp, 1);
  assert.equal(sheet(scene.holder.id).resources.dark_fantasy_the_last_rose.used, 1);
  const hit = must(await swing(scene, scene.near, [15, 4, 4, 3, 3, 3, 3]), "the swing");
  assert.equal(hit.result.crit, true, JSON.stringify(hit.result).slice(0, 200));
  assert.ok(!conditions(scene.holder.id).includes("the last rose"));
});

await test("The Flock Remembers: at 0 hit points the doctor is stable and may be carried 60 feet", async () => {
  const { featureTeleportFeet } = await import("../src/lib/dm/feature-teleport.ts");
  const scene = await t.stage({ classId: "plague_doctor", level: 15 });
  must(await t.world.invoke("apply_damage", { characterId: scene.holder.id, amount: 120, type: "slashing" }), "the blow");
  const after = sheet(scene.holder.id);
  assert.equal(after.currentHp, 0);
  assert.equal(after.deathSaves?.stable, true);
  assert.equal(featureTeleportFeet(scene.holder.id, "The Flock Remembers"), 60);
  const bare = await spend(scene, "dark_fantasy_the_flock_remembers");
  assert.equal(bare.ok, false, "no call spends it");
});

t.close();
console.log(`test-genre-a-dark-fantasy: ${passed} passed`);
