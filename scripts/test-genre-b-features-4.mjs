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
const { regainBlockedBy } = await import(new URL("lib/dm/vitals-logic.ts", SRC).href);

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

// ---- the aberrant's limb ----

// A STR 10, CHA 20 aberrant: the limb's modifier is the +5 of CHA.
const charismatic = (hero) => world.patch(hero.id, { abilities: { ...world.sheet(hero.id).abilities, str: 10, dex: 10, cha: 20 } });

await run("Chimeric Limb: a natural weapon of 1d8 + CHA slashing that pc_attack swings", async () => {
  const hero = rig.holder(feature("aberrant", "Chimeric Limb", 1));
  charismatic(hero);
  const { near } = await rig.fight(hero);
  await rig.swing(hero, near, { weapon: "Chimeric Limb" });
  assert.equal(lost(near), 8, `the limb dealt ${lost(near)} (a 3 and CHA +5)`);
});

await run("Perfect Chimera: the limb deals 2d8, reaches 10 ft and is magical against a resistance to nonmagical slashing", async () => {
  const hero = rig.holder(feature("aberrant", "Perfect Chimera", 14));
  charismatic(hero);
  const { far } = await rig.fight(hero);
  kit.place(far.id, 7, 2);
  kit.setEnemy(far.id, { stats: { ...kit.enemy(far.id).stats, resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } });
  await rig.swing(hero, far, { weapon: "claw" });
  assert.equal(lost(far), 11, `the limb dealt ${lost(far)} at 10 feet (two 3s and CHA +5, unresisted)`);
});

// ---- weapons that count as magic ----

const NONMAGIC = "bludgeoning, piercing, and slashing from nonmagical attacks";
const resistsMundane = (enemy) => kit.setEnemy(enemy.id, { stats: { ...kit.enemy(enemy.id).stats, resist: NONMAGIC } });

await run("Junkyard Strikes: a simple weapon deals +1d6 and counts as magical against a resistance to nonmagical blows", async () => {
  const hero = rig.holder(feature("scavenger", "Junkyard Strikes", 11), { gear: "simple" });
  const { near } = await rig.fight(hero);
  resistsMundane(near);
  await rig.swing(hero, near, { weapon: "Club" });
  assert.equal(lost(near), 9, `the club dealt ${lost(near)} (a 3, STR +3 and the junkyard 3, unresisted)`);
});

await run("Masterwork Arsenal: a gadgeteer's weapon is +2 and magical, and a 19 is a critical hit", async () => {
  const hero = rig.holder(feature("gadgeteer", "Masterwork Arsenal", 15));
  const { near } = await rig.fight(hero);
  resistsMundane(near);
  const out = await kit.swing(hero.id, near.id, [19, 3, 3, 3, 3, 3, 3], { weapon: "Longsword" });
  rig.must(out.out, "pc_attack");
  const base = await rig.without(hero, { name: "Masterwork Arsenal" }, async () => {
    kit.setEnemy(near.id, { currentHp: 300 });
    rig.myTurn(hero);
    await kit.swing(hero.id, near.id, [19, 3, 3, 3, 3, 3, 3], { weapon: "Longsword" });
    return lost(near);
  });
  assert.ok(base < 10, `without the arsenal the 19 dealt ${base}`);
  rig.myTurn(hero);
  kit.setEnemy(near.id, { currentHp: 300 });
  await kit.swing(hero.id, near.id, [19, 3, 3, 3, 3, 3, 3], { weapon: "Longsword" });
  assert.equal(lost(near), 11, `the arsenal's 19 dealt ${lost(near)} (two 3s on the critical, STR +3, +2, unresisted)`);
});

// ---- an ally's attack ----

await run("Warlord of the Wastes: an ally within 30 ft who can see the road warrior gains +1 to attack rolls, not one who cannot", async () => {
  const hero = rig.holder(feature("road_warrior", "Warlord of the Wastes", 18));
  const { near } = await rig.fight(hero);
  const toHit = async () => {
    rig.myTurn(ally);
    const out = await kit.swing(ally.id, near.id, [10, 3, 3, 3, 3]);
    rig.must(out.out, "pc_attack");
    const roll = out.toHit;
    return roll?.result?.total ?? roll?.total;
  };
  const { on, off } = await rig.both(hero, { name: "Warlord of the Wastes" }, toHit);
  assert.equal(on - off, 1, `the ally's attack totalled ${on} with the warlord and ${off} without`);
  world.patch(hero.id, { conditions: ["invisible"] });
  assert.equal(await toHit(), off, "an ally who cannot see the road warrior still gained the +1");
});

// ---- blows sent back ----

await run("Toxic Blood: a creature that hits the aberrant with a bite takes 2d6 poison, one that clubs them nothing", async () => {
  const hero = rig.holder(feature("aberrant", "Toxic Blood", 9));
  const { near } = await rig.fight(hero);
  const struck = async (attack) => {
    kit.setEnemy(near.id, { currentHp: 300, stats: { ...kit.enemy(near.id).stats, attacks: [attack] } });
    kit.handOnEnemies();
    kit.freshRound();
    clearDice();
    dice(16, 4, 3, 3);
    rig.must(await world.invoke("enemy_attack", { enemyId: near.id, targetCharacterId: hero.id }), "enemy_attack");
    clearDice();
    return lost(near);
  };
  assert.equal(await struck({ name: "Bite", toHit: 4, damage: "1d6+2", type: "piercing" }), 6, "the bite sent back other than 2d6 poison");
  assert.equal(await struck({ name: "Club", toHit: 4, damage: "1d6+2", type: "bludgeoning" }), 0, "a club was answered as a bite");
});

await run("Tetanus Edge: an improvised weapon's hit leaves the creature unable to regain hit points until the scavenger's next turn; a longsword's does not", async () => {
  const hero = rig.holder(feature("scavenger", "Tetanus Edge", 7));
  const { near } = await rig.fight(hero);
  await rig.swing(hero, near, { weapon: "Longsword" });
  assert.equal(regainBlockedBy(kit.enemy(near.id)), null, "a longsword's hit blocked healing");
  rig.myTurn(hero);
  await rig.swing(hero, near, { weapon: "chair leg", improvised: true });
  const struck = kit.enemy(near.id);
  assert.equal(regainBlockedBy(struck), "tetanus", `the creature holds ${JSON.stringify(struck.conditions)}`);
  assert.equal(struck.conditionMeta.tetanus?.untilTurnOf, hero.id, "the wound does not end at the scavenger's next turn");
});

await run("Steamvent Burst: an adjacent creature that fails its DEX save takes 3d8 fire and is pushed 10 ft away", async () => {
  const hero = rig.holder(feature("machinist", "Steamvent Burst", 9));
  const { near } = await rig.fight(hero);
  rig.must(await spendAt(hero, "Steamvent Burst", [3, 3, 3, 1], { targetEnemyId: near.id }), "use_resource Steamvent Burst");
  assert.equal(lost(near), 9, `the vent dealt ${lost(near)}`);
  const at = kit.token(near.id);
  assert.deepEqual({ x: at.x, y: at.y }, { x: 8, y: 2 }, `the creature stands at (${at.x},${at.y})`);
});

world.close();
finish();
