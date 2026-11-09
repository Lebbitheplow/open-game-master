// A spell of two damage types deals both at a single target, as it does in an
// area. Only aoe_damage read `secondType`: a save spell through cast_at_enemy
// landed its whole sum as the first type, an attack through pc_attack did the
// same, and the prose reader dropped the second dice of "X damage plus Y
// damage". Each type meets its own resistance (SRD 5.1, Damage Resistance and
// Vulnerability), and a save halves each.
//
// Every check reads an enemy's hit points; dice are forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, field, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";

const { createHomebrew } = await import("../src/lib/db/homebrew.ts");
const { openCastOf, withOpenCast } = await import("../src/lib/dm/cast-rules.ts");
const { baseDamageExpression } = await import("../src/lib/srd/spell-scaling.ts");

const { test, finish } = suite("test-enforce-two-type-spells");

const SAVE_TEXT = "The target must make a Dexterity saving throw, taking 3d6 fire damage and 2d8 cold damage on a failed save, or half as much on a successful one.";
const ATTACK_TEXT = "Make a ranged spell attack against the target. On a hit, the target takes 3d6 fire damage plus 2d8 cold damage.";
const DICE = { damageType: "fire", secondType: "cold", dice: { base: "3d6+2d8", baseLevel: 3 } };
const SAVE_MECH = { resolution: "save", save: "dex", halfOnSave: true, ...DICE };
const ATTACK_MECH = { resolution: "attack", attack: "ranged", ...DICE };

async function brewed(spell, mech, desc, { stats = { resist: "fire" }, extra = {}, count = 1 } = {}) {
  const { world, sheets: [wizard], enemies } = await table([caster("wizard", "int", [spell], [], 9, extra)], count, stats);
  createHomebrew(world.owner.id, {
    kind: "spell",
    name: spell,
    data: { desc, level: 3, classes: ["wizard"], school: "evocation", castingTime: "1 action", range: "60 feet", mech },
  });
  return { world, wizard, enemies };
}

function lost(world, enemy, act) {
  const before = enemyOf(world, enemy.id).currentHp;
  return act().then((out) => {
    assert.equal(out.ok, true, out.error);
    assert.equal(world.clearDice(), 0, "every forced die was rolled");
    return { out, lost: before - enemyOf(world, enemy.id).currentHp };
  });
}

const castAt = (world, wizard, enemy, spell, faces, args = {}) =>
  lost(world, enemy, () => {
    world.dice(...faces);
    return world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: enemy.id, spell, level: 3, saveAbility: "dex", ...args });
  });

const attackAt = (world, wizard, enemy, spell, faces) =>
  lost(world, enemy, () => {
    world.dice(...faces);
    return world.invoke("pc_attack", { characterId: wizard.id, attacker: wizard.name, targetEnemyId: enemy.id, spell, level: 3 });
  });

// ---- a save spell at one creature ----

await test("A failed save: fire resistance halves only the fire of 3d6 fire and 2d8 cold.", async () => {
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Lash", SAVE_MECH, SAVE_TEXT);
  const { out, lost: taken } = await castAt(world, wizard, goblin, "Twin Lash", [1, 6, 6, 6, 8, 8]);
  assert.equal(taken, 9 + 16);
  assert.equal(out.result.secondType, "cold");
  assert.match(String(out.result.damageByType), /9 fire.*16 cold/);
});

await test("A made save halves each type on its own, and then the resistance halves the fire again.", async () => {
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Lash", SAVE_MECH, SAVE_TEXT);
  const { lost: taken } = await castAt(world, wizard, goblin, "Twin Lash", [20, 6, 6, 6, 8, 8]);
  assert.equal(taken, 4 + 8);
});

await test("Resistance to the second type halves only the second.", async () => {
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Lash", SAVE_MECH, SAVE_TEXT, { stats: { resist: "cold" } });
  const { lost: taken } = await castAt(world, wizard, goblin, "Twin Lash", [1, 6, 6, 6, 8, 8]);
  assert.equal(taken, 18 + 8);
});

await test("A creature that resists neither takes the whole roll, as one wound.", async () => {
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Lash", SAVE_MECH, SAVE_TEXT, { stats: { resist: "" } });
  const { lost: taken } = await castAt(world, wizard, goblin, "Twin Lash", [1, 6, 6, 6, 8, 8]);
  assert.equal(taken, 34);
});

const adeptOf = (element) => ({ feats: ["Elemental Adept"], features: [{ name: `Elemental Adept: ${element}`, source: "story" }] });

await test("Elemental Adept of the first type sets aside only that type's resistance and floors only its dice.", async () => {
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Lash", SAVE_MECH, SAVE_TEXT, { stats: { resist: "fire, cold" }, extra: adeptOf("fire") });
  // Fire: 1, 1, 1 count as 2 each (6) and the resistance is set aside. Cold:
  // 1 and 1 stay 2, halved to 1.
  const { lost: taken } = await castAt(world, wizard, goblin, "Twin Lash", [1, 1, 1, 1, 1, 1]);
  assert.equal(taken, 6 + 1);
});

await test("Elemental Adept of the second type sets aside only that type's resistance and floors only its dice.", async () => {
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Lash", SAVE_MECH, SAVE_TEXT, { stats: { resist: "fire, cold" }, extra: adeptOf("cold") });
  // Fire: 1, 1, 1 stay 3, halved to 1. Cold: 1 and 1 count as 2 each (4), with
  // the resistance set aside.
  const { out, lost: taken } = await castAt(world, wizard, goblin, "Twin Lash", [1, 1, 1, 1, 1, 1]);
  assert.equal(taken, 1 + 4);
  assert.match(out.result.elementalAdept, /cold ignores resistance/);
});

// ---- one area, one roll, a call per creature ----

await test("A later creature of one area casting takes the same split of the casting's one roll.", async () => {
  const { world, wizard, enemies: [first, second] } = await brewed("Twin Burst", { ...SAVE_MECH, area: true, areaFeet: 20 }, SAVE_TEXT, { count: 2 });
  await layMap(world, field(45), { [wizard.id]: { x: 2, y: 2 }, [first.id]: { x: 8, y: 2 }, [second.id]: { x: 10, y: 2 } });
  const args = { characterId: wizard.id, spell: "Twin Burst", level: 3, saveAbility: "dex" };
  world.dice(1, 6, 6, 6, 8, 8);
  const one = await world.invokeAsIs("cast_at_enemy", { ...args, targetEnemyId: first.id });
  world.clearDice();
  // The later call's own damage dice, were it to roll any, would be all 1s.
  world.dice(1, 1, 1, 1, 1, 1);
  const two = await world.invokeAsIs("cast_at_enemy", { ...args, targetEnemyId: second.id });
  world.clearDice();
  assert.equal(one.ok, true, one.error);
  assert.equal(two.ok, true, two.error);
  assert.equal(enemyOf(world, first.id).currentHp, 90 - (9 + 16));
  assert.equal(enemyOf(world, second.id).currentHp, 90 - (9 + 16), "the fire is still the 18 and the cold the 16");
  assert.equal(world.sheet(wizard.id).spellcasting.slots["3"].used, 1, "one casting, one slot");
});

await test("A two-type casting an item paid for keeps both the item's name and the split.", () => {
  const budget = { oncePerTurn: [] };
  const open = { spell: "Twin Burst", slotLevel: 3, left: 5, roll: 34, rollSecond: 16 };
  assert.deepEqual(openCastOf(withOpenCast(budget, open), "Twin Burst"), { ...open, spell: "twin burst" });
  const paid = { ...open, item: "Ring" };
  assert.deepEqual(openCastOf(withOpenCast(budget, paid), "Twin Burst"), { ...paid, spell: "twin burst" });
  const plain = { spell: "Fireball", slotLevel: 3, left: 5, roll: 30 };
  assert.deepEqual(openCastOf(withOpenCast(budget, plain), "Fireball"), { ...plain, spell: "fireball" });
});

// ---- a spell attack ----

await test("A spell attack that hits: fire resistance halves only the fire.", async () => {
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Bolt", ATTACK_MECH, ATTACK_TEXT);
  const { lost: taken } = await attackAt(world, wizard, goblin, "Twin Bolt", [18, 6, 6, 6, 8, 8]);
  assert.equal(taken, 9 + 16);
});

await test("A critical hit doubles both types' dice, and each still meets its own resistance.", async () => {
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Bolt", ATTACK_MECH, ATTACK_TEXT);
  // Six fire dice of 5 (30, halved) and four cold dice of 5 (20).
  const { lost: taken } = await attackAt(world, wizard, goblin, "Twin Bolt", [20, ...new Array(10).fill(5)]);
  assert.equal(taken, 15 + 20);
});

// ---- a creature's spell at a character ----

// A tiefling resists fire; the creature's block lists Flame Strike (4d6 fire
// and 4d6 radiant).
const atHero = () => table([{ ...FIGHTER, race: "tiefling", maxHp: 200, currentHp: 200 }], 1, { spells: ["Flame Strike"] });

await test("A creature's area spell: a character's fire resistance halves only the fire.", async () => {
  const { world, sheets: [hero], enemies: [foe] } = await atHero();
  world.dice(6, 6, 6, 6, 6, 6, 6, 6, 1);
  const out = await world.invokeAsIs("aoe_damage", { casterEnemyId: foe.id, spell: "Flame Strike", characterIds: [hero.id], saveAbility: "dex", dc: 14 });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 0);
  assert.equal(world.sheet(hero.id).currentHp, 200 - (12 + 24));
});

await test("The same spell at one character: only the fire is halved, on a failed save and on a made one.", async () => {
  const failed = await atHero();
  const [hero] = failed.sheets;
  failed.world.dice(1, 6, 6, 6, 6, 6, 6, 6, 6);
  const hit = await failed.world.invokeAsIs("cast_at_player", { characterId: hero.id, casterEnemyId: failed.enemies[0].id, spell: "Flame Strike", saveAbility: "dex", dc: 14 });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(failed.world.clearDice(), 0);
  assert.equal(failed.world.sheet(hero.id).currentHp, 200 - (12 + 24));

  const made = await atHero();
  made.world.dice(20, 6, 6, 6, 6, 6, 6, 6, 6);
  const halved = await made.world.invokeAsIs("cast_at_player", { characterId: made.sheets[0].id, casterEnemyId: made.enemies[0].id, spell: "Flame Strike", saveAbility: "dex", dc: 14 });
  assert.equal(halved.ok, true, halved.error);
  // Half of each (12 and 12), and the resistance halves the fire again.
  assert.equal(made.world.sheet(made.sheets[0].id).currentHp, 200 - (6 + 12));
});

// ---- the reader ----

await test('The reader adds dice joined by "plus", as it adds those joined by "and".', async () => {
  assert.equal(baseDamageExpression("takes 5d6 bludgeoning damage plus 5d6 cold damage, or half."), "5d6+5d6");
  assert.equal(baseDamageExpression("takes 2d8 bludgeoning damage and 4d6 cold damage."), "2d8+4d6");
  assert.equal(baseDamageExpression("takes 10d6 + 40 force damage."), "10d6+40");
  // A choice of types, and dice in a later sentence, are not added.
  assert.equal(baseDamageExpression("takes 3d8 radiant damage or 3d8 necrotic damage."), "3d8");
  assert.equal(baseDamageExpression("takes 1d6 fire damage. Later it takes 2d6 fire damage."), "1d6");
});

await test('A spell read from prose alone rolls and lands both of "X damage plus Y damage".', async () => {
  const prose = { resolution: "attack", attack: "ranged", damageType: "fire", secondType: "cold" };
  const { world, wizard, enemies: [goblin] } = await brewed("Twin Bolt", prose, ATTACK_TEXT);
  const { lost: taken } = await attackAt(world, wizard, goblin, "Twin Bolt", [18, 6, 6, 6, 8, 8]);
  assert.equal(taken, 9 + 16);
});

closeTables();
finish();
