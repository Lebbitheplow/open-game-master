// GM rules audit 2026-11-16, conditions lens (D01 and on): the SRD 5.1
// conditions with all their effects, ended at the right time on every door,
// and dropping to 0 hit points. Each test failed on main before its fix.
//
// SRD 5.1 as printed. Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { kit as conditionsKit, FIGHTER as SWORD_FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-audit1116-conditions");
const encounters = await import("../src/lib/db/encounters.ts");
void openWorld;

const prone = (conditions) => conditions.some((entry) => entry.trim().toLowerCase() === "prone");

// D01. SRD 5.1, Unconscious: "The creature drops whatever it's holding and
// falls prone." Only the drop to 0 hit points wrote the prone; Sleep, a
// drow's poison or Eyebite wrote the unconscious alone, so a goblin woken by
// a blow stood at once (no half its speed to get up, no advantage for the
// next sword, no disadvantage on its own swing) and a hero shaken awake walked
// off at full speed.
await test("D01: a creature put to sleep falls prone, and stays prone when it wakes", async () => {
  const { world, sheets: [mage], enemies: [foe] } = await table([caster("wizard", "int", ["Sleep"], [], 5)]);
  encounters.patchEnemyHp(foe.id, 6, "alive");
  world.dice(8, 8, 8, 8, 8);
  const cast = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: foe.id, spell: "Sleep", level: 1 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(enemyOf(world, foe.id).conditions.includes("unconscious"), JSON.stringify(cast.result));
  assert.ok(prone(enemyOf(world, foe.id).conditions), `the sleeper is not prone: ${enemyOf(world, foe.id).conditions}`);
  const hit = await world.invoke("damage_enemy", { enemyId: foe.id, amount: 1 });
  assert.equal(hit.ok, true, hit.error);
  assert.equal(enemyOf(world, foe.id).conditions.includes("unconscious"), false);
  assert.ok(prone(enemyOf(world, foe.id).conditions), "the woken creature stood up for free");
});

await test("D01: the same through set_condition, on a creature and on a hero", async () => {
  const { world, sheets: [hero], enemies: [foe] } = await table([FIGHTER]);
  const laid = await world.invoke("set_condition", { enemyId: foe.id, condition: "unconscious", reason: "a sleeping draught", rounds: 10 });
  assert.equal(laid.ok, true, laid.error);
  assert.ok(prone(enemyOf(world, foe.id).conditions), `the sleeper is not prone: ${enemyOf(world, foe.id).conditions}`);
  const dart = await world.invoke("set_condition", { characterId: hero.id, condition: "unconscious", reason: "a drow's dart", rounds: 100 });
  assert.equal(dart.ok, true, dart.error);
  assert.ok(prone(world.sheet(hero.id).conditions), `the sleeping hero is not prone: ${world.sheet(hero.id).conditions}`);
  const woken = await world.invoke("clear_condition", { characterId: hero.id, condition: "unconscious", reason: "shaken awake" });
  assert.equal(woken.ok, true, woken.error);
  assert.ok(prone(world.sheet(hero.id).conditions), "the hero shaken awake is on their feet already");
});

// One fight off the board for the rules that read conditions alone.
const arena = await openWorld();
const arenaKit = conditionsKit(arena);
const swordsman = arena.addHero(SWORD_FIGHTER);
await arena.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [swordsman.id]: 20 } });
arenaKit.offBoard();
const [goblin] = arena.enemies();

// D02. SRD 5.1, Dodge: "You lose this benefit if you are incapacitated or if
// your speed drops to 0." The enemies' swings and the opportunity attacks
// dropped a Dodge at speed 0 (opportunity.ts withLiveDodge); a hero's own
// swing and the Dexterity save did not, so a goblin that took the Dodge and
// was then grappled still turned the fighter's sword at disadvantage and
// still saved against Burning Hands with advantage.
await test("D02: a dodger held at speed 0 gets nothing from the Dodge on a hero's swing", async () => {
  arenaKit.reset(swordsman.id);
  arenaKit.resetEnemy(goblin.id, ["dodging", "grappled"], { grappled: { source: swordsman.id } });
  const out = await arenaKit.swing([3, 17, 4, 4, 4], swordsman.id, goblin.id, { weapon: "Longsword" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(arenaKit.d20s(out.dice), 1, `the grappled dodger still turned the sword: ${out.dice.join(" ")}`);
});

await test("D02: ... nor on its Dexterity save", async () => {
  arenaKit.resetEnemy(goblin.id, ["dodging", "restrained"]);
  const out = await arenaKit.withDice([10, 10, 1], "aoe_damage", {
    damage: "1d4", saveAbility: "dex", dc: 25, halfOnSave: false, enemyIds: [goblin.id],
  });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  // Restrained alone: disadvantage. With the Dodge still counted the two
  // cancelled to one die.
  assert.equal(arenaKit.d20s(out.dice), 2, `the held dodger's DEX save rolled ${out.dice.join(" ")}`);
  arenaKit.resetEnemy(goblin.id);
});

closeTables();
finish();
