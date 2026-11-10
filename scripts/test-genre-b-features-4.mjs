// The mystery, post-apocalyptic and steampunk classes' features, fourth suite
// (WAVE2 D5): areas on the board (src/lib/dm/genre-b-zones.ts, rows in
// src/lib/battlemap/zones-genre-b.ts) and the features the later passes
// built. Each case fails without its mechanism; the clause ledgers
// (scripts/clauses/genre-*.json) point here for the clauses they hold.
//
// Dice forced; every check reads hit points, a condition, a counter or the
// d20s a roll threw.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { dice, clearDice, diceLog } from "./lib/enforce-world.mjs";

const SRC = new URL("../src/", import.meta.url);
const { zonesAfterMove, zoneTurnStart } = await import(new URL("lib/dm/zone-triggers.ts", SRC).href);
const { getCampaignById } = await import(new URL("lib/db/campaigns.ts", SRC).href);

const { test, finish } = suite("test-genre-b-features-4");
const rig = await clausesRig();
const { world, kit, ally } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};
const lost = (enemy) => 300 - kit.enemy(enemy.id).currentHp;
const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;
const campaign = () => getCampaignById(world.campaignId);
const spendAt = async (hero, resource, faces = [], extra = {}) => {
  clearDice();
  dice(...faces);
  const out = await world.invoke("use_resource", { characterId: hero.id, resource, reason: "test", ...extra });
  clearDice();
  return out;
};
const typed = (enemy, type) => kit.setEnemy(enemy.id, { stats: { ...kit.enemy(enemy.id).stats, type } });
// A creature's turn starting, its dice forced.
function turnStarts(enemy, faces) {
  clearDice();
  dice(...faces);
  const lines = zoneTurnStart(campaign(), world.encounter(), [enemy.id]);
  clearDice();
  return lines;
}
// The d20s an enemy's club on the ally threw.
async function clubD20s(enemy) {
  kit.handOnEnemies();
  kit.freshRound();
  clearDice();
  diceLog();
  dice(16, 16, 4);
  rig.must(await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ally.id }), "enemy_attack");
  const d20s = diceLog().filter((die) => die.sides === 20).length;
  clearDice();
  return d20s;
}

// ---- areas ----

await run("Gear Swarm: gears thrown within 30 ft deal 2d6 slashing to a creature entering the cube; one farther off is refused, nothing spent", async () => {
  const hero = rig.holder(feature("machinist", "Gear Swarm", 7));
  const { near, far } = await rig.fight(hero);
  const refused = await spendAt(hero, "Gear Swarm", [], { targetEnemyId: far.id });
  assert.ok(!refused.ok, "gears thrown 65 feet were laid");
  assert.equal(used(hero, "steampunk_gear_swarm"), 0, "the refused throw spent its use");
  rig.must(await spendAt(hero, "Gear Swarm", [], { targetEnemyId: near.id }), "use_resource Gear Swarm");
  kit.place(far.id, 9, 2);
  clearDice();
  dice(4, 4);
  zonesAfterMove(campaign(), world.encounter().id, { kind: "enemy", refId: far.id }, { x: 9, y: 2 }, [{ x: 8, y: 2 }, { x: 7, y: 2 }]);
  clearDice();
  assert.equal(lost(far), 8, `the creature walking into the gears lost ${lost(far)}`);
});

await run("Dissolving Mist: a creature starting its turn in the fog saves (CON) or takes 3d6 acid, half on a success", async () => {
  const hero = rig.holder(feature("alchemist", "Dissolving Mist", 10));
  const { near } = await rig.fight(hero);
  rig.must(await spendAt(hero, "Dissolving Mist", [], { targetEnemyId: near.id }), "use_resource Dissolving Mist");
  turnStarts(near, [1, 3, 3, 3]);
  assert.equal(lost(near), 9, `the failed save lost ${lost(near)}`);
  kit.setEnemy(near.id, { currentHp: 300 });
  turnStarts(near, [20, 4, 4, 4]);
  assert.equal(lost(near), 6, `the made save lost ${lost(near)}`);
});

await run("Dawnlight: an undead within the 30-ft light attacks an ally at disadvantage, a humanoid does not", async () => {
  const hero = rig.holder(feature("waste_preacher", "Dawnlight", 1));
  const { near } = await rig.fight(hero);
  typed(near, "undead");
  rig.must(await spendAt(hero, "Dawnlight"), "use_resource Dawnlight");
  assert.equal(await clubD20s(near), 2, "the undead's attack on the ally threw one d20");
  typed(near, "humanoid");
  assert.equal(await clubD20s(near), 1, "a humanoid's attack was at disadvantage");
});

await run("The Last Dawn Rises: a hostile undead starting its turn in the Dawnlight takes 2d8 radiant, a humanoid nothing", async () => {
  const hero = rig.holder(feature("waste_preacher", "The Last Dawn Rises", 14));
  const { near, far } = await rig.fight(hero);
  typed(near, "undead");
  kit.place(far.id, 8, 2);
  rig.must(await spendAt(hero, "Dawnlight"), "use_resource Dawnlight");
  turnStarts(near, [5, 5]);
  assert.equal(lost(near), 10, `the undead lost ${lost(near)}`);
  turnStarts(far, [5, 5]);
  assert.equal(lost(far), 0, `the humanoid lost ${lost(far)}`);
});

// ---- draughts, hit dice, a step through the storm ----

await run("Emergency Draught: the drinker regains 2d4 + INT as a bonus action, two a long rest", async () => {
  const hero = rig.holder(feature("alchemist", "Emergency Draught", 5));
  await rig.fight(hero);
  world.patch(ally.id, { currentHp: 50 });
  rig.must(await spendAt(hero, "Emergency Draught", [2, 2], { targetCharacterId: ally.id }), "use_resource Emergency Draught");
  assert.equal(world.sheet(ally.id).currentHp, 57, `the ally drank to ${world.sheet(ally.id).currentHp}`);
  assert.equal(world.sheet(hero.id).resources.steampunk_emergency_draught?.max, 2, "the alchemist brews other than two");
  assert.equal(rig.budget().bonusUsed, true, "the draught cost no bonus action");
});

await run("Philosopher's Draught: the draught also ends poisoned and gives an hour of poison immunity", async () => {
  const hero = rig.holder(feature("alchemist", "Philosopher's Draught", 13));
  await rig.fight(hero);
  world.patch(ally.id, { currentHp: 50, conditions: ["poisoned"] });
  rig.must(await spendAt(hero, "Emergency Draught", [2, 2], { targetCharacterId: ally.id }), "use_resource Emergency Draught");
  const after = world.sheet(ally.id);
  assert.ok(!after.conditions.includes("poisoned"), `the ally still holds ${JSON.stringify(after.conditions)}`);
  assert.equal(await rig.damageLost(ally, "poison"), 0, "poison still hurt the ally after the draught");
});

await run("Regenerative Strain: a hit die spent as a bonus action heals; with none left it is refused, nothing spent", async () => {
  const hero = rig.holder(feature("aberrant", "Regenerative Strain", 7));
  await rig.fight(hero);
  world.patch(hero.id, { currentHp: 40 });
  const before = world.sheet(hero.id).hitDice.spent;
  rig.must(await spendAt(hero, "Regenerative Strain", [5]), "use_resource Regenerative Strain");
  const sheet = world.sheet(hero.id);
  assert.equal(sheet.hitDice.spent, before + 1, "no hit die was spent");
  assert.equal(sheet.currentHp, 48, `the aberrant healed to ${sheet.currentHp} (a 5 and CON +3)`);
  world.patch(hero.id, { hitDice: { ...sheet.hitDice, spent: sheet.hitDice.total }, resources: { ...sheet.resources, post_apocalyptic_regenerative_strain: { ...sheet.resources.post_apocalyptic_regenerative_strain, used: 0 } } });
  rig.myTurn(hero);
  const refused = await spendAt(hero, "Regenerative Strain", [5]);
  assert.ok(!refused.ok, "a spend with no hit die left went through");
  assert.equal(world.sheet(hero.id).resources.post_apocalyptic_regenerative_strain.used, 0, "the refused spend spent its use");
});

await run("Storm Step: a bonus action that moves the channeler 30 ft as a teleport", async () => {
  const hero = rig.holder(feature("aether_channeler", "Storm Step", 11));
  await rig.fight(hero);
  const out = rig.must(await spendAt(hero, "Storm Step"), "use_resource Storm Step");
  assert.match(String(out.teleport ?? ""), /30 feet/, `the step said ${JSON.stringify(out)}`);
  assert.equal(rig.budget().bonusUsed, true, "the step cost no bonus action");
});

world.close();
finish();
