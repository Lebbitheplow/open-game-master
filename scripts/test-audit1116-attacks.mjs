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

await kit.endFight();
world.close();
finish();
