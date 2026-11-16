// The attacks audit of 2026-11-16 (G01 onward): one attack from the d20 to
// the hit points lost, on every door that makes one. Each test failed on
// main before its fix.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-audit1116-attacks");
const { weaponAttackProfile } = await import("../src/lib/dm/attack-logic.ts");
const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");

const LEVEL = 5;
const PB = proficiencyBonus(LEVEL);
const world = await openWorld();
const kit = await gearKit(world);
const anchor = world.addHero({ class: "fighter", level: LEVEL });
const hero = world.addHero({ class: "fighter", level: LEVEL });

// A new fight against a fresh dummy, so no test inherits what the last one
// left on it (a net's restraint, a kill that ended the fight).
async function freshArena() {
  await kit.endFight();
  await kit.arena({ first: anchor.id });
  kit.stand(hero.id, 1);
  return kit.dummy();
}
await freshArena();

function arm({ str = 10, dex = 10, weapons = ["simple", "martial"], equipment = [], race = "human", ...rest }) {
  return world.patch(hero.id, {
    race,
    abilities: { str, dex, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencies: profs({ weapons }),
    equipment,
    ...rest,
  });
}

// ---- G01: a net is a ranged weapon, thrown with Dexterity ----

await test("G01: a net is thrown with Dexterity, as a ranged weapon is, not with Strength", async () => {
  // SRD 5.1, Weapon Properties, Thrown: "If the weapon is a melee weapon, you
  // use the same ability modifier for that attack roll and damage roll that
  // you would use for a melee attack with the weapon." The net is a ranged
  // weapon, so it is a ranged attack's Dexterity.
  const net = SRD_WEAPONS.find((weapon) => weapon.name === "Net");
  const derived = { abilityMods: { str: 3, dex: 0 }, proficiencyBonus: PB };
  const profile = weaponAttackProfile(derived, ["martial"], { displayName: "Net", srd: net, unarmed: false });
  assert.equal(profile.ability, "dex");
  assert.equal(profile.toHit, 0 + PB);
  arm({ str: 16, dex: 10, equipment: [{ name: "Net", qty: 3 }] });
  kit.stand(hero.id, 1);
  // Thrown from 5 feet: the target is a hostile within 5 feet, so two d20s
  // and the lower is kept.
  const swing = await kit.swing(hero.id, { weapon: "Net" }, 10, 15);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.rolled, 10 + abilityMod(10) + PB, "the net rolled with Strength");
  // A dart is finesse: the better of the two, as before.
  arm({ str: 16, dex: 12, equipment: [{ name: "Dart", qty: 3 }] });
  kit.stand(hero.id, 2);
  const dart = await kit.swing(hero.id, { weapon: "Dart" }, 10, 2);
  assert.equal(dart.result.rolled, 10 + abilityMod(16) + PB);
  kit.stand(hero.id, 1);
});

// ---- G02: a critical hit gives Undead Fortitude no save ----

const { getDatabase } = await import("../src/lib/db/core.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const UNDEAD_FORTITUDE = "Undead Fortitude: If damage reduces the zombie to 0 hit points, it must make a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, the zombie drops to 1 hit point instead.";

// The dummy's block, with what a test adds to it.
function dress(patch) {
  const row = kit.dummy();
  getDatabase().prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?").run(JSON.stringify({ ...row.stats, ...patch }), row.id);
}

await test("G02: a critical hit with a weapon of one damage type drops a zombie with no Undead Fortitude save", async () => {
  // SRD 5.1, Zombie: "unless the damage is radiant or from a critical hit".
  // A blow of two types (a Branding Smite's radiant) already skipped it; a
  // plain longsword's critical offered the save, and a 20 kept it up.
  await freshArena();
  arm({ str: 16, equipment: [{ name: "Longsword", qty: 1 }] });
  dress({ traits: [UNDEAD_FORTITUDE] });
  const zombie = kit.dummy();
  encounters.patchEnemyHp(zombie.id, 5, "alive");
  // A natural 20, the doubled d8, and a 20 for a save that must not be rolled.
  const swing = await kit.swing(hero.id, { weapon: "Longsword" }, 20, 6, 6, 20);
  assert.deepEqual(swing.damageDice, [8, 8]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.crit, true);
  assert.equal(swing.result.undeadFortitude, undefined, `a save was offered: ${swing.result.undeadFortitude}`);
  assert.equal(swing.result.dead, true, JSON.stringify(swing.result));
  assert.equal(swing.unused, 1, "the save's die is never rolled");
});

// ---- G03: cover counts on an opportunity attack ----

const maps = await import("../src/lib/db/battle-maps.ts");
const { resolvePcOpportunityAttacks, resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const place = (refId, x, y) => {
  const map = kit.board();
  maps.placeToken(maps.getTokenByRef(map.id, refId).id, x, y);
};

await test("G03: a glaive's opportunity attack past an ally meets the half cover the ally gives, as the turn's swing does", async () => {
  // SRD 5.1, Cover: "A target has half cover if an obstacle blocks at least
  // half of its body. The obstacle might be ... a creature, whether that
  // creature is an enemy or a friend." The turn's pc_attack counted the ally
  // in the line; the reaction's swing read the bare AC.
  const goblin = await freshArena();
  // The ally in the line carries only a bow, so it makes no opportunity
  // attack of its own.
  world.patch(anchor.id, { equipment: [{ name: "Shortbow", qty: 1 }] });
  arm({ str: 16, equipment: [{ name: "Glaive", qty: 1 }] });
  place(goblin.id, 3, 0);
  place(anchor.id, 2, 0);
  place(hero.id, 1, 0);
  // The turn's swing at 10 feet: 5 + 3 + 3 = 11 misses AC 10 + 2.
  const turn = await kit.swing(hero.id, { weapon: "Glaive" }, 5, 4);
  assert.equal(turn.ok, true, turn.error);
  assert.equal(turn.result.hit, false, "the turn's swing ignored the ally's half cover");
  // The goblin walks away east, out of the glaive's reach: the same 11.
  world.clearDice();
  world.dice(5, 4);
  const before = kit.dummy().currentHp;
  resolvePcOpportunityAttacks(world.campaign(), goblin.id, { x: 3, y: 0 }, { x: 5, y: 0 }, [{ x: 4, y: 0 }, { x: 5, y: 0 }]);
  world.clearDice();
  assert.equal(kit.dummy().currentHp, before, "the opportunity attack hit through the ally's half cover");
});

await test("G03: a creature's 10-foot opportunity attack past another hero meets that hero's half cover", async () => {
  const ogre = await freshArena();
  // A reach of 10 feet, as a giant's or a glaive-armed creature's.
  dress({ attacks: [{ name: "Glaive", toHit: 5, damage: "1d10+3", type: "slashing", mode: "melee", reach: 10 }], traits: [] });
  world.patch(anchor.id, { equipment: [{ name: "Shortbow", qty: 1 }], ac: 12, acOverride: true });
  world.patch(hero.id, { ac: 12, acOverride: true, currentHp: 30, tempHp: 0 });
  place(ogre.id, 3, 0);
  place(anchor.id, 2, 0);
  place(hero.id, 1, 0);
  // The hero walks west, out of the reach. 8 + 5 = 13 hits AC 12, not 14.
  world.clearDice();
  world.dice(8, 6);
  const out = resolveOpportunityAttacks(world.campaign(), hero.id, { x: 1, y: 0 }, { x: 0, y: 0 }, false, [{ x: 0, y: 0 }]);
  world.clearDice();
  assert.ok(out.notes.some((note) => /opportunity attack/i.test(note)), `no opportunity attack was made: ${JSON.stringify(out.notes)}`);
  assert.equal(world.sheet(hero.id).currentHp, 30, `the swing hit through the other hero's half cover: ${out.notes.join(" ")}`);
});

// ---- G04: a creature's blow of two types at another creature ----

const { enemiesStrikeWalker } = await import("../src/lib/dm/opportunity-sides.ts");
// A hell hound's bite (SRD 5.1): "7 (1d8 + 3) piercing damage plus 7 (2d6)
// fire damage", with a d6 for the d8 to keep the dice apart.
const HOUND_BITE = { name: "Bite", toHit: 5, damage: "1d6+2+2d6", type: "piercing", riders: [{ dice: "2d6", type: "fire" }], mode: "melee", reach: 5 };

// Two goblins on a bare floor: the first fights for the party (Dominate
// Person), with a hell hound's bite; the second resists fire.
async function houndAndGoblin() {
  await kit.endFight();
  await world.beginFight([{ monster: "goblin", count: 2 }], { heroFaces: { [anchor.id]: 20, [hero.id]: 3 }, enemyFace: 1 });
  const map = kit.board();
  maps.setBattleMapTerrain(map.id, ".".repeat(map.width * map.height));
  const [hound, goblin] = world.enemies();
  const setStats = (id, patch) => {
    const row = world.enemies().find((enemy) => enemy.id === id);
    getDatabase().prepare("UPDATE encounter_enemies SET ac = 10, max_hp = 100, current_hp = 100, stat_json = ? WHERE id = ?").run(JSON.stringify({ ...row.stats, ac: 10, resist: "", immune: "", vulnerable: "", traits: [], ...patch }), id);
  };
  setStats(hound.id, { attacks: [HOUND_BITE] });
  setStats(goblin.id, { resist: "fire" });
  encounters.patchEnemyConditions(hound.id, ["charmed"], { charmed: { spell: "Dominate Person", source: hero.id } });
  place(anchor.id, 0, 9);
  place(hero.id, 1, 9);
  place(hound.id, 5, 5);
  place(goblin.id, 6, 5);
  return { hound, goblin };
}
const hpOf = (id) => world.enemies().find((enemy) => enemy.id === id).currentHp;

await test("G04: a dominated creature's two-type bite meets a creature's fire resistance part by part (enemy_attack)", async () => {
  // SRD 5.1, Damage Resistance: each damage type of a blow meets its own
  // resistance. At a character the bite already split; at a creature it
  // landed untyped, so the fire went through whole.
  const { hound, goblin } = await houndAndGoblin();
  world.clearDice();
  // A hit, the d6 of 4 (+2 = 6 piercing), the 2d6 of 6s (12 fire, halved to 6).
  world.dice(15, 4, 6, 6);
  const out = await world.invoke("enemy_attack", { enemyId: hound.id, targetCharacterId: goblin.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(100 - hpOf(goblin.id), 6 + 6, JSON.stringify(out.result));
});

await test("G04: the same bite as an opportunity attack at a creature walking away meets the resistance too, and a blow of 0 deals 0", async () => {
  const { goblin } = await houndAndGoblin();
  world.clearDice();
  world.dice(15, 4, 6, 6);
  enemiesStrikeWalker(world.campaignId, goblin.id, [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], 1);
  world.clearDice();
  assert.equal(100 - hpOf(goblin.id), 6 + 6, "the fire was not halved");
  // A penalty bringing the blow to nothing deals nothing (SRD 5.1 has no
  // floor of 1, and pc_attack deals 0), where this door dealt 1.
  const { hound: weak, goblin: walker } = await houndAndGoblin();
  const row = world.enemies().find((enemy) => enemy.id === weak.id);
  getDatabase().prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?").run(JSON.stringify({ ...row.stats, attacks: [{ name: "Slap", toHit: 5, damage: "1d4-3", type: "bludgeoning", mode: "melee", reach: 5 }] }), weak.id);
  world.dice(15, 1);
  const notes = enemiesStrikeWalker(world.campaignId, walker.id, [{ x: 6, y: 5 }, { x: 7, y: 5 }], 1);
  world.clearDice();
  assert.ok(notes.length, "no opportunity attack was made");
  assert.equal(hpOf(walker.id), 100, `a blow of 0 took hit points: ${notes.join(" ")}`);
});

await test("G05: a creature's two-type bite at a pet walking off with its owner meets the pet's immunity part by part", async () => {
  // enemy_attack at a pet already split the blow (pet-strike.ts); the
  // opportunity attack at a pet landed it as one type.
  const { strikePetsOnWalk } = await import("../src/lib/dm/opportunity-pets.ts");
  const goblin = await freshArena();
  dress({ attacks: [HOUND_BITE], traits: [] });
  const EMBER = { name: "Ember", kind: "familiar", form: "imp", hp: 30, maxHp: 30, ac: 10, speed: 20, attacks: [], notes: "", immune: "fire" };
  world.patch(hero.id, { pets: [EMBER] });
  place(goblin.id, 5, 5);
  place(hero.id, 6, 5);
  world.clearDice();
  // A hit, the d6 of 4 (+2 = 6 piercing, halved by an imp's resistance to
  // nonmagical piercing: 3), the 2d6 of 6s (12 fire, none to an imp).
  world.dice(15, 4, 6, 6);
  const notes = strikePetsOnWalk(world.campaign(), hero.id, [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }]);
  world.clearDice();
  const ember = world.sheet(hero.id).pets.find((pet) => pet.name === "Ember");
  world.patch(hero.id, { pets: [] });
  assert.ok(notes.length, "no opportunity attack was made at the pet");
  assert.equal(ember.hp, 30 - 3, `the bite met the imp's defences as one type: ${notes.join(" ")}`);
});

// ---- G06: no opportunity attack through total cover ----

// A wall down the whole of column x.
function wallAt(x) {
  const map = kit.board();
  const tiles = new Array(map.width * map.height).fill(".");
  for (let y = 0; y < map.height; y += 1) {
    tiles[y * map.width + x] = "#";
  }
  maps.setBattleMapTerrain(map.id, tiles.join(""));
}

await test("G06: a glaive makes no opportunity attack through a wall at a goblin 10 feet off, as the turn's swing cannot", async () => {
  // SRD 5.1, Cover: "A target with total cover can't be targeted directly by
  // an attack or a spell." pc_attack refuses a reach weapon through the wall
  // square between; the reaction's swing measured the distance alone.
  const goblin = await freshArena();
  world.patch(anchor.id, { equipment: [{ name: "Shortbow", qty: 1 }] });
  arm({ str: 16, equipment: [{ name: "Glaive", qty: 1 }] });
  place(anchor.id, 9, 9);
  place(goblin.id, 3, 0);
  place(hero.id, 1, 0);
  wallAt(2);
  const turn = await kit.swing(hero.id, { weapon: "Glaive" }, 15, 4);
  assert.equal(turn.ok, false, "the turn's swing went through the wall");
  world.clearDice();
  world.dice(15, 4);
  const before = kit.dummy().currentHp;
  const notes = resolvePcOpportunityAttacks(world.campaign(), goblin.id, { x: 3, y: 0 }, { x: 5, y: 0 }, [{ x: 4, y: 0 }, { x: 5, y: 0 }]);
  world.clearDice();
  assert.equal(kit.dummy().currentHp, before, `the opportunity attack struck through the wall: ${JSON.stringify(notes)}`);
});

await test("G06: a creature's 10-foot reach makes no opportunity attack through a wall at a hero walking away", async () => {
  const ogre = await freshArena();
  dress({ attacks: [{ name: "Glaive", toHit: 5, damage: "1d10+3", type: "slashing", mode: "melee", reach: 10 }], traits: [] });
  world.patch(anchor.id, { equipment: [{ name: "Shortbow", qty: 1 }] });
  world.patch(hero.id, { ac: 12, acOverride: true, currentHp: 30, tempHp: 0 });
  place(anchor.id, 9, 9);
  place(ogre.id, 3, 0);
  place(hero.id, 1, 0);
  wallAt(2);
  world.clearDice();
  world.dice(15, 6);
  const out = resolveOpportunityAttacks(world.campaign(), hero.id, { x: 1, y: 0 }, { x: 0, y: 0 }, false, [{ x: 0, y: 0 }]);
  world.clearDice();
  assert.equal(world.sheet(hero.id).currentHp, 30, `the swing struck through the wall: ${out.notes.join(" ")}`);
});

// ---- G07: a pact weapon is proficient on an opportunity attack ----

await test("G07: a Pact of the Blade warlock's opportunity attack with the pact weapon adds the proficiency the turn's swing adds", async () => {
  // SRD 5.1, Pact of the Blade: "You are proficient with it while you wield
  // it." pc_attack counted it; the reaction's swing read only the sheet's
  // weapon training (simple weapons, for a warlock).
  const { optionFeatureName } = await import("../src/lib/srd/options.ts");
  const goblin = await freshArena();
  world.patch(anchor.id, { equipment: [{ name: "Shortbow", qty: 1 }] });
  const plain = world.sheet(hero.id).features.filter((feature) => !/pact/i.test(feature.name));
  arm({ str: 16, weapons: ["simple"], equipment: [{ name: "Longsword", qty: 1 }], features: [...plain, { name: optionFeatureName("pact_boon", "Pact of the Blade"), source: "class" }] });
  place(anchor.id, 9, 9);
  place(goblin.id, 3, 0);
  place(hero.id, 2, 0);
  // The turn's swing: 5 + 3 + 3 = 11 hits AC 10.
  const turn = await kit.swing(hero.id, { weapon: "Longsword" }, 5, 4);
  assert.equal(turn.result.rolled, 5 + abilityMod(16) + PB, "the turn's swing left out the pact weapon's proficiency");
  // The goblin walks away: the same 5 must hit too (8 without the bonus misses).
  world.clearDice();
  world.dice(5, 4);
  const before = kit.dummy().currentHp;
  const notes = resolvePcOpportunityAttacks(world.campaign(), goblin.id, { x: 3, y: 0 }, { x: 5, y: 0 }, [{ x: 4, y: 0 }, { x: 5, y: 0 }]);
  world.clearDice();
  assert.equal(before - kit.dummy().currentHp, 4 + abilityMod(16), `the opportunity attack left out the proficiency: ${JSON.stringify(notes)}`);
  world.patch(hero.id, { features: plain });
});

// ---- G08: a beast form strikes with its own attack on an opportunity ----

await test("G08: a druid in wolf form makes its opportunity attack with the wolf's bite, prone rider and all, not the scimitar merged into the form", async () => {
  // SRD 5.1, Wild Shape: "Your game statistics are replaced by the
  // statistics of the beast ... you can't ... wield ... equipment that merged
  // into the form." pc_attack swings the form's natural attacks; the
  // reaction's swing reached for the sheet's carried weapon.
  const goblin = await freshArena();
  world.patch(anchor.id, { equipment: [{ name: "Shortbow", qty: 1 }] });
  arm({ str: 8, dex: 10, equipment: [{ name: "Scimitar", qty: 1 }], wildShape: { form: "Wolf", beastHp: 11, beastMaxHp: 11, beastAc: 13 } });
  place(anchor.id, 9, 9);
  place(goblin.id, 3, 0);
  place(hero.id, 2, 0);
  // A hit (15 + 4), the bite's 2d4 of 3s (+2 = 8), and the goblin's
  // Strength save of 1 against the prone.
  world.clearDice();
  world.dice(15, 3, 3, 1);
  const before = kit.dummy().currentHp;
  const notes = resolvePcOpportunityAttacks(world.campaign(), goblin.id, { x: 3, y: 0 }, { x: 5, y: 0 }, [{ x: 4, y: 0 }, { x: 5, y: 0 }]);
  world.clearDice();
  world.patch(hero.id, { wildShape: null });
  assert.equal(before - kit.dummy().currentHp, 3 + 3 + 2, `the wolf did not bite: ${JSON.stringify(notes)}`);
  assert.ok(kit.dummy().conditions.includes("prone"), `the bite's rider never landed: ${JSON.stringify(notes)}`);
});

// ---- G09: a silvered weapon is silvered on an opportunity attack ----

await test("G09: a silvered sword's opportunity attack passes a lycanthrope's resistance, as the turn's swing does", async () => {
  // SRD 5.1, Werewolf: "Damage Immunities bludgeoning, piercing, and
  // slashing from nonmagical attacks not made with silvered weapons", and
  // Silvered Weapons. pc_attack carries the blade's material to the
  // resistance; the reaction's swing dropped it.
  const goblin = await freshArena();
  dress({ resist: "bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered" });
  world.patch(anchor.id, { equipment: [{ name: "Shortbow", qty: 1 }] });
  arm({ str: 16, equipment: [{ name: "Silvered Longsword", srdName: "Longsword", qty: 1, tags: ["silvered"] }] });
  place(anchor.id, 9, 9);
  place(goblin.id, 3, 0);
  place(hero.id, 2, 0);
  let before = kit.dummy().currentHp;
  const turn = await kit.swing(hero.id, { weapon: "Silvered Longsword" }, 15, 4);
  assert.equal(turn.ok, true, turn.error);
  assert.equal(before - kit.dummy().currentHp, 4 + abilityMod(16), "the turn's swing was resisted");
  world.clearDice();
  world.dice(15, 4);
  before = kit.dummy().currentHp;
  const notes = resolvePcOpportunityAttacks(world.campaign(), goblin.id, { x: 3, y: 0 }, { x: 5, y: 0 }, [{ x: 4, y: 0 }, { x: 5, y: 0 }]);
  world.clearDice();
  assert.equal(before - kit.dummy().currentHp, 4 + abilityMod(16), `the silvered blade was resisted on the opportunity attack: ${JSON.stringify(notes)}`);
});

// ---- G11: an enemy caster's Shield on every door ----

// SRD 5.1, Shield: "Reaction, which you take when you are hit by an attack or
// targeted by the magic missile spell ... Until the start of your next turn,
// you have a +5 bonus to AC, including against the triggering attack, and you
// take no damage from magic missile." The SRD mage, archmage and lich prepare
// it. pc_attack and a character's opportunity attack already met it
// (enemy-reactions.ts tryParry); a hero's Magic Missile, a pet's attack and a
// creature's attack at another creature did not.
const SHIELD_CASTER = { dc: 14, ability: "int", casterLevel: 9, spells: [{ name: "Shield", level: 1 }], slots: { 1: 4 } };
const reacted = (id) => world.encounter().reactionsUsed.includes(id);
const firstSlotsSpent = (id) => world.encounter().legendary.abilities?.[id]?.slots?.["1"] ?? 0;
const caster = world.addHero({
  class: "wizard", level: LEVEL, abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Magic Missile"], known: [], cantrips: [] },
});

await test("G11: a hero's Magic Missile at a mage who can cast Shield does nothing: the mage spends its reaction and a 1st-level slot, and the Shield is up", async () => {
  const mage = await freshArena();
  dress({ spellcasting: SHIELD_CASTER, traits: [] });
  kit.stand(caster.id, 3);
  world.clearDice();
  world.dice(3, 3, 3);
  const out = await kit.onTurnOf(caster.id, () => world.invoke("cast_at_enemy", { characterId: caster.id, targetEnemyId: mage.id, spell: "Magic Missile", level: 1 }));
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.dummy().currentHp, mage.currentHp, `Magic Missile struck through Shield: ${JSON.stringify(out.result)}`);
  assert.equal(reacted(mage.id), true, "the mage's reaction was not spent");
  assert.equal(firstSlotsSpent(mage.id), 1, "no 1st-level slot was spent");
  assert.ok(kit.dummy().conditions.includes("shielded"), "the Shield is not up");
  assert.equal(world.sheet(caster.id).spellcasting.slots[1].used, 1, "the wizard's slot was not spent");
});

await test("G11: a Magic Missile at a mage whose Shield is already up does nothing, with no second slot spent", async () => {
  const mage = await freshArena();
  dress({ spellcasting: SHIELD_CASTER, traits: [] });
  encounters.patchEnemyConditions(mage.id, ["shielded"], { shielded: { untilTurnOf: mage.id, spell: "Shield", source: mage.id } });
  encounters.saveEncounter({ ...world.encounter(), reactionsUsed: [mage.id] });
  kit.stand(caster.id, 3);
  world.patch(caster.id, { spellcasting: { ...world.sheet(caster.id).spellcasting, slots: { 1: { max: 4, used: 0 } } } });
  world.clearDice();
  world.dice(3, 3, 3);
  const out = await kit.onTurnOf(caster.id, () => world.invoke("cast_at_enemy", { characterId: caster.id, targetEnemyId: mage.id, spell: "Magic Missile", level: 1 }));
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.dummy().currentHp, mage.currentHp, `Magic Missile struck a shielded mage: ${JSON.stringify(out.result)}`);
  assert.equal(firstSlotsSpent(mage.id), 0);
});

await test("G11: a pet's bite that +5 AC turns into a miss meets the mage's Shield", async () => {
  const mage = await freshArena();
  dress({ spellcasting: SHIELD_CASTER, traits: [] });
  const FANG = { name: "Fang", kind: "other", form: "wolf", hp: 11, maxHp: 11, ac: 13, speed: 40, attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing" }], notes: "" };
  world.patch(hero.id, { pets: [FANG] });
  world.clearDice();
  // 8 + 4 = 12 hits AC 10 and misses 15.
  world.dice(8, 3, 3);
  const out = await kit.onTurnOf(hero.id, () => world.invoke("pet_attack", { characterId: hero.id, targetEnemyId: mage.id }));
  world.clearDice();
  world.patch(hero.id, { pets: [] });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.hit, false, `the bite went through the Shield: ${JSON.stringify(out.result)}`);
  assert.equal(kit.dummy().currentHp, mage.currentHp);
  assert.equal(reacted(mage.id), true);
});

await test("G11: a dominated creature's blow at a mage, on its turn or as it walks away, meets the mage's Shield", async () => {
  let { hound, goblin } = await houndAndGoblin();
  let row = world.enemies().find((enemy) => enemy.id === goblin.id);
  getDatabase().prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?").run(JSON.stringify({ ...row.stats, spellcasting: SHIELD_CASTER }), goblin.id);
  world.clearDice();
  // 8 + 5 = 13 hits AC 10 and misses 15.
  world.dice(8, 4, 6, 6);
  const out = await world.invoke("enemy_attack", { enemyId: hound.id, targetCharacterId: goblin.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hpOf(goblin.id), 100, `the bite went through the Shield: ${JSON.stringify(out.result)}`);
  assert.equal(reacted(goblin.id), true);
  ({ hound, goblin } = await houndAndGoblin());
  row = world.enemies().find((enemy) => enemy.id === goblin.id);
  getDatabase().prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?").run(JSON.stringify({ ...row.stats, spellcasting: SHIELD_CASTER }), goblin.id);
  world.dice(8, 4, 6, 6);
  const notes = enemiesStrikeWalker(world.campaignId, goblin.id, [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], 1);
  world.clearDice();
  assert.ok(notes.length, "no opportunity attack was made");
  assert.equal(hpOf(goblin.id), 100, `the opportunity attack went through the Shield: ${notes.join(" ")}`);
});

// ---- G12: a Champion's natural 19 that misses is a miss after the roll too ----

// SRD 5.1, Improved Critical: "Your weapon attacks score a critical hit on a
// roll of 19 or 20"; Rolling 1 or 20: only a natural 20 "hits regardless of
// any modifiers or the target's AC". The attack itself rules a 19 that
// misses the AC a miss (attack-logic.ts adjudicateHit); the helpers that run
// after the roll read any face in the critical range as a hit, so a held
// Bardic Inspiration die, an ally's Chronal Shift or Fate's bend was never
// offered to a 19 that missed.
const { adjudicateHit } = await import("../src/lib/dm/attack-logic.ts");
const { attackHits, shiftCanHelp } = await import("../src/lib/dm/after-roll-logic.ts");
const { fateSucceeds } = await import("../src/lib/dm/fate-turn-logic.ts");
const { rollExpression } = await import("../src/lib/dice.ts");

await test("G12: a natural 19 in a widened critical range that misses the AC is a miss to every after-the-roll helper, as the attack rules it", async () => {
  world.clearDice();
  world.dice(19);
  const nineteen = rollExpression("1d20+5");
  world.clearDice();
  assert.equal(nineteen.natural, 19);
  // 24 against AC 25 with a critical range of 19.
  assert.equal(adjudicateHit(nineteen.total, nineteen.crit, 25, { natural: 19, critRange: 19 }).hit, false);
  assert.equal(attackHits(nineteen, 25, 19), false, "attackHits read the 19 as a hit");
  assert.equal(shiftCanHelp({ kind: "attack", outcome: nineteen, ac: 25, critRange: 19 }), true, "no shift was offered to a 19 that misses");
  assert.equal(fateSucceeds({ kind: "attack", outcome: nineteen, ac: 25, critRange: 19 }), false, "Fate read the 19 as a hit");
  // A natural 20 still hits whatever the AC.
  world.dice(20);
  const twenty = rollExpression("1d20+5");
  world.clearDice();
  assert.equal(attackHits(twenty, 40, 19), true);
});

await test("G12: a Champion's held Bardic Inspiration die lifts a natural 19 that misses, as it lifts any miss", async () => {
  await freshArena();
  const plain = world.sheet(hero.id).features.filter((feature) => !/critical/i.test(feature.name));
  arm({ str: 16, equipment: [{ name: "Longsword", qty: 1 }], features: [...plain, { name: "Improved Critical", source: "class" }], conditions: ["Bardic Inspiration (d6)"], conditionMeta: {} });
  const row = kit.dummy();
  getDatabase().prepare("UPDATE encounter_enemies SET ac = 30, stat_json = ? WHERE id = ?").run(JSON.stringify({ ...row.stats, ac: 30 }), row.id);
  // 19 + 3 + 3 = 25 misses AC 30; the held d6 of 6 makes it 31. The hit's
  // dice are a critical's: 19 is in the range once it hits.
  // A player at the table is asked on the after-the-roll card, as for any
  // miss the die could lift (after-roll.ts); read here as a hit, the 19 was
  // never offered it and simply missed.
  const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
  const swing = await kit.swing(hero.id, { weapon: "Longsword" }, 19, 6, 4, 4);
  const card = listOpenPendingRolls(world.campaignId).find((pending) => pending.characterId === hero.id && pending.parkedFor === "after_roll");
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  world.patch(hero.id, { features: plain, conditions: [] });
  assert.equal(swing.ok, true, swing.error);
  assert.ok(card, `the held die was never offered to the 19: ${JSON.stringify(swing.result)}`);
  assert.deepEqual(card.thrown.options.map((option) => option.id), ["bardic"]);
});

// ---- G13: the GM's targeted damage roll of 0 deals 0 ----

await test("G13: a damage roll the GM sends at a creature that totals 0 deals 0, not 1", async () => {
  // SRD 5.1 gives damage no floor: a penalty can leave nothing, as pc_attack
  // and every attack door leave 0 (G04). request_roll with targetEnemyId
  // floored the total at 1 (enemy-blow.ts applyBlow).
  const dummy = await freshArena();
  world.clearDice();
  world.dice(1);
  // The GM's own roll (an NPC ally's cut): a party character's damage on a
  // creature goes through pc_attack instead.
  const out = await world.invoke("request_roll", { kind: "damage", expression: "1d4-2", targetEnemyId: dummy.id, reason: "a weak cut" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.total, -1);
  assert.equal(kit.dummy().currentHp, dummy.currentHp, `a total under 1 took a hit point: ${JSON.stringify(out.result)}`);
});

await kit.endFight();
world.close();
finish();
