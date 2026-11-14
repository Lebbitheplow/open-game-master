// Mummy rot, SRD 5.1 Mummy, Rotting Fist: "If the target is a creature, it
// must succeed on a DC 12 Constitution saving throw or be cursed with mummy
// rot. The cursed target can't regain hit points, and its hit point maximum
// decreases by 10 (3d6) for every 24 hours that elapse. If the curse reduces
// the target's hit point maximum to 0, the target dies, and its body turns
// to dust. The curse lasts until removed by the remove curse spell or other
// magic."
//
// It was a line of text for the GM: no curse on the sheet, healing as ever,
// and a maximum that never fell. src/lib/dm/mummy-rot.ts, read back from the
// database.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-mummy-rot");
const world = await openWorld();
const kit = await combatKit(world);
const { readAttackText } = await import("../src/lib/bestiary/attack-text.ts");
const { SRD_CREATURES } = await import("../src/lib/srd/srd-creatures.ts");

const ROT = "cursed (mummy rot)";
const FIST = "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) bludgeoning damage plus 10 (3d6) necrotic damage. If the target is a creature, it must succeed on a DC 12 Constitution saving throw or be cursed with mummy rot. The cursed target can't regain hit points, and its hit point maximum decreases by 10 (3d6) for every 24 hours that elapse. If the curse reduces the target's hit point maximum to 0, the target dies, and its body turns to dust. The curse lasts until removed by the remove curse spell or other magic.";

test("The Rotting Fist's line is read as the curse it lays, not left to the GM", () => {
  const read = readAttackText(FIST);
  assert.equal(read.onHit?.save, "con");
  assert.equal(read.onHit?.dc, 12);
  assert.equal(read.onHit?.condition, ROT);
  assert.equal((read.onHit?.manual ?? []).length, 0, JSON.stringify(read.onHit?.manual));
  // The bundled SRD block carries it too (scripts/generate-srd-creatures.mjs).
  for (const name of ["Mummy", "Mummy Lord"]) {
    const fist = SRD_CREATURES.find((creature) => creature.name === name)?.attacks.find((attack) => attack.name === "Rotting Fist");
    assert.equal(fist?.onHit?.condition, ROT, name);
  }
});

const hero = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { con: 10 }, proficiencies: TRAINED });
const cleric = world.addHero({
  class: "cleric", level: 9, maxHp: 60, abilities: { wis: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 3: { max: 3, used: 0 } }, prepared: ["Cure Wounds", "Remove Curse"], known: [], cantrips: [] },
});

async function cursed() {
  await kit.endFight();
  world.patch(hero.id, { currentHp: 44, maxHp: 44, conditions: [], conditionMeta: {}, deathSaves: null });
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [cleric.id]: 18 } });
  const [mummy] = world.enemies();
  const fist = { name: "Rotting Fist", toHit: 5, damage: "1d6", type: "bludgeoning", onHit: { save: "con", dc: 12, condition: ROT } };
  kit.setEnemy(mummy.id, { maxHp: 100, stats: { ...DUMMY, attacks: [fist] } });
  kit.place(hero.id, 5, 5);
  kit.place(cleric.id, 5, 7);
  kit.place(mummy.id, 6, 5);
  kit.freshRound();
  // The swing (18), its d6 (4), the hero's CON save (2): cursed.
  world.dice(18, 4, 2);
  const out = await world.invoke("enemy_attack", { enemyId: mummy.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  // Ended as the table ends it: the kit's own end wipes every condition.
  assert.equal((await world.invoke("end_encounter", { outcome: "enemies_fled" })).ok, true);
  return world.sheet(hero.id);
}

await test("A failed save lays the curse, and a cursed hero regains no hit points: not from a spell, a rest or a hit die", async () => {
  const sheet = await cursed();
  assert.ok(sheet.conditions.includes(ROT), JSON.stringify(sheet.conditions));
  assert.equal(sheet.currentHp, 40);
  const healed = await world.invoke("heal", { characterId: hero.id, amount: 10, reason: "a potion" });
  assert.equal(world.sheet(hero.id).currentHp, 40, JSON.stringify(healed));
  await world.invoke("take_rest", { kind: "long" });
  assert.equal(world.sheet(hero.id).currentHp, 40, "a long rest healed the cursed hero");
  assert.ok(world.sheet(hero.id).conditions.includes(ROT), "a long rest lifted the curse");
  world.patch(hero.id, { currentHp: 10 });
  const spent = await world.invoke("take_rest", { kind: "short", spend: [{ characterId: hero.id, dice: 2 }] });
  assert.equal(spent.ok, true, spent.error);
  assert.equal(world.sheet(hero.id).currentHp, 10, JSON.stringify(spent.result?.results));
});

await test("The maximum falls 3d6 for every 24 hours that pass, and comes back when Remove Curse lifts the curse", async () => {
  await cursed();
  // 23 hours: no day has passed yet.
  await world.invoke("pass_time", { amount: 23, unit: "hours" });
  assert.equal(world.sheet(hero.id).maxHp, 44);
  world.dice(4, 4, 4);
  await world.invoke("pass_time", { amount: 1, unit: "hours" });
  world.clearDice();
  assert.equal(world.sheet(hero.id).maxHp, 32);
  assert.equal(world.sheet(hero.id).currentHp, 32);
  // Two more days in one stretch: two drops.
  world.dice(1, 1, 1, 2, 2, 2);
  await world.invoke("pass_time", { amount: 48, unit: "hours" });
  world.clearDice();
  assert.equal(world.sheet(hero.id).maxHp, 23);
  const lifted = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Remove Curse", targetCharacterIds: [hero.id], level: 3 });
  assert.equal(lifted.ok, true, lifted.error);
  const after = world.sheet(hero.id);
  assert.deepEqual([after.conditions.includes(ROT), after.maxHp, after.currentHp], [false, 44, 23]);
  // Healing works again.
  await world.invoke("heal", { characterId: hero.id, amount: 5, reason: "a potion" });
  assert.equal(world.sheet(hero.id).currentHp, 28);
});

await test("A curse that brings the maximum to 0 kills", async () => {
  await cursed();
  world.patch(hero.id, { maxHp: 10, currentHp: 10 });
  world.dice(6, 6, 6);
  await world.invoke("pass_time", { amount: 24, unit: "hours" });
  world.clearDice();
  const dead = world.sheet(hero.id);
  assert.equal(dead.deathSaves?.dead, true, JSON.stringify(dead.deathSaves));
  assert.equal(dead.currentHp, 0);
});

await test("A feature's healing goes through the same door: a mummy-rotted necromancer gains nothing from Grim Harvest", async () => {
  // Grim Harvest, the Hexblade's Curse, a death's heal, Survivor, Blessed
  // Healer and Spirit Projection wrote hit points straight and skipped what
  // bars regaining them (src/lib/dm/regain.ts).
  const { caster } = await import("./lib/enforce-spell-kit.mjs");
  const hooks = await import("../src/lib/dm/authored-hooks.ts");
  await kit.endFight();
  const mage = world.addHero({ ...caster("wizard", "int", ["Ray of Sickness"], [], 9), maxHp: 60, subclass: "School of Necromancy" });
  await kit.fight(1);
  const [foe] = world.enemies();
  const harvest = () => hooks.authoredOnKill(world.campaign(), world.encounter(), foe, mage.id, false, { level: 1, school: "necromancy" });
  world.patch(mage.id, { currentHp: 10, conditions: [ROT], conditionMeta: { [ROT]: { source: "mummy" } } });
  const cursed = harvest();
  assert.equal(world.sheet(mage.id).currentHp, 10, JSON.stringify(cursed));
  assert.ok(!cursed.some((line) => /regains/.test(line)), JSON.stringify(cursed));
  // The same kill on a clean necromancer next turn heals three times the level.
  await kit.endFight();
  await kit.fight(1);
  const [next] = world.enemies();
  world.patch(mage.id, { currentHp: 10, conditions: [], conditionMeta: {} });
  hooks.authoredOnKill(world.campaign(), world.encounter(), next, mage.id, false, { level: 1, school: "necromancy" });
  assert.equal(world.sheet(mage.id).currentHp, 13);
});

world.close();
finish();
