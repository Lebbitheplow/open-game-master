// What common spells do after the roll and when they end: the 2026-11-16
// audit's effects lens, its follow-up (findings Y12 on; Y01 to Y11 are in
// scripts/test-audit1116-effects.mjs). Each test is the rule as SRD 5.1
// prints it, read off the engine's own state.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";
import { dropMap } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-audit1116-effects2");

// A wizard, a goblin and a fighter, in that order, on a board, the wizard's
// turn (scripts/test-audit1116-effects.mjs castStage). `roundOn` ends the
// wizard's and the fighter's turns; the goblin's, walked past between them,
// ends with the second move (test-enforce-turn-end-saves.mjs).
async function castStage(prepared) {
  const { openWorld } = await import("./lib/enforce-world.mjs");
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const wizard = world.addHero({
    name: "Wiz", class: "wizard", level: 9, abilities: { int: 18, con: 14, dex: 12 }, proficiencies: { ...TRAINED, saves: ["int", "wis"] },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 3, used: 0 }, 5: { max: 1, used: 0 } }, known: [], prepared, cantrips: [] },
  });
  const fighter = world.addHero({ name: "Fig", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
  await kit.fight(1, { heroFaces: { [wizard.id]: 20, [fighter.id]: 5 } });
  const [goblin] = world.enemies();
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((each) => (each.kind === "pc" ? each.characterId : each.enemyId) === id);
  kit.saveEncounter({ ...encounter, order: [entry(wizard.id), entry(goblin.id), entry(fighter.id)], turnIndex: 0, turnBudget: null });
  kit.place(wizard.id, 2, 7);
  kit.place(goblin.id, 4, 7);
  kit.place(fighter.id, 2, 2);
  const roundOn = () => {
    assert.equal(kit.endTurn(wizard.userId), true);
    assert.equal(kit.endTurn(fighter.userId), true);
  };
  return { world, kit, wizard, fighter, goblin, roundOn };
}

// ---- Y12: Mage Armor touches a creature who isn't wearing armor ----

// SRD 5.1, Mage Armor: "You touch a willing creature who isn't wearing
// armor". Cast on the fighter in chain mail, the slot was spent and the spell
// did nothing; it is refused before anything is spent.
await test("Y12: Mage Armor on a creature wearing armor is refused and spends no slot", async () => {
  const { world, sheets: [mage, tank] } = await table([
    caster("wizard", "int", ["Mage Armor"], [], 5),
    { ...FIGHTER, equipment: [{ name: "Chain Mail", qty: 1, equipped: true }] },
  ]);
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Mage Armor", level: 1, targetCharacterIds: [tank.id] });
  assert.equal(cast.refused, "rules", cast.error ?? "it was cast");
  assert.match(cast.error, /armor/i);
  assert.equal(world.sheet(mage.id).spellcasting.slots["1"].used, 0, "nothing spent");
  assert.ok(!world.sheet(tank.id).conditions.includes("mage armor"));
});

// ---- Y13: Fear's save off the board ----

// SRD 5.1, Fear: "If the creature ends its turn in a location where it
// doesn't have line of sight to you, the creature can make a Wisdom saving
// throw." Off the board nothing measures line of sight, so the save never
// came and the goblin fled for the whole minute. The ruling: off the board,
// the creature saves at the end of each of its turns after the first turn it
// spent fleeing (on the board the line of sight decides, Y02).
await test("Y13: off the board, a creature frightened by Fear saves from the end of its second turn", async () => {
  const { world, kit, wizard, goblin, roundOn } = await castStage(["Fear"]);
  world.dice(1);
  const cast = await world.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Fear", enemyIds: [goblin.id], level: 3 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("frightened"), "the goblin failed and is frightened");
  await dropMap(world);
  kit.setEnemy(goblin.id, { stats: { saveMods: { ...DUMMY.saveMods, wis: 40 } } });
  roundOn();
  assert.ok(kit.enemy(goblin.id).conditions.includes("frightened"), "its first turn is spent fleeing, with no save");
  roundOn();
  assert.ok(!kit.enemy(goblin.id).conditions.includes("frightened"), "the end of its second turn brings the save, and it passes");
  assert.ok(!kit.enemy(goblin.id).conditions.includes("fleeing"), "and the flight ends with it");
});

await test("Y13: off the board, a hero frightened by a creature's Fear saves from the end of their second turn", async () => {
  const { world, fighter, goblin, roundOn } = await castStage([]);
  await dropMap(world);
  // DC 1: any save passes, so only whether one is rolled is in question.
  const fear = { spell: "Fear", source: goblin.id, rounds: 10, saveEnds: { ability: "wis", dc: 1, unseen: true } };
  world.patch(fighter.id, { conditions: ["frightened", "fleeing"], conditionMeta: { frightened: fear, fleeing: fear } });
  roundOn();
  assert.ok(world.sheet(fighter.id).conditions.includes("frightened"), "the first turn is spent fleeing, with no save");
  roundOn();
  assert.ok(!world.sheet(fighter.id).conditions.includes("frightened"), "the second turn's end brings the save");
});

// ---- Y14: a creature's Hideous Laughter passes over an Intelligence of 4 or less ----

// SRD 5.1, Hideous Laughter: "A creature with an Intelligence score of 4 or
// less isn't affected." Y04 read it on a hero's cast_at_enemy alone, so a
// creature's Hideous Laughter still laid a polymorphed hero, a beast
// companion or a wolf low with laughter.
const LAUGHTER = { spell: "Hideous Laughter", level: 1, saveAbility: "wis", dc: 15, condition: "incapacitated" };
const laughingStage = () => table([{ ...FIGHTER, name: "Kara" }, { class: "ranger", subclass: "Beast Master", level: 5, name: "Rook", abilities: { wis: 14, int: 3 } }], 1, { spells: ["Hideous Laughter"], type: "humanoid" });

await test("Y14: a creature's Hideous Laughter at a hero polymorphed into a wolf is cast and spent with no effect", async () => {
  const { world, sheets: [kara], enemies: [hag] } = await laughingStage();
  world.patch(kara.id, { wildShape: { form: "Wolf", beastHp: 11, beastMaxHp: 11, beastAc: 13, kind: "polymorph", abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 } } });
  world.dice(1);
  const out = await world.invoke("cast_at_player", { characterId: kara.id, casterEnemyId: hag.id, ...LAUGHTER });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(!world.sheet(kara.id).conditions.includes("incapacitated"), "a wolf's mind is not touched");
});

await test("Y14: a creature's Hideous Laughter at a companion of Intelligence 3 has no effect", async () => {
  const { world, sheets: [, rook], enemies: [hag] } = await laughingStage();
  world.dice(1);
  const out = await world.invoke("cast_at_player", { characterId: rook.id, casterEnemyId: hag.id, ...LAUGHTER });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(!world.sheet(rook.id).conditions.includes("incapacitated"));
});

await test("Y14: a creature's Hideous Laughter at a ranger's wolf has no effect", async () => {
  const { world, sheets: [, rook], enemies: [hag] } = await laughingStage();
  const summoned = await world.invoke("summon_pet", { characterId: rook.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  world.dice(1, 1);
  const out = await world.invoke("cast_at_player", { characterId: rook.id, petName: "wolf", casterEnemyId: hag.id, ...LAUGHTER });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(!(world.sheet(rook.id).pets.find((pet) => pet.form.toLowerCase() === "wolf").conditions ?? []).includes("incapacitated"), "the wolf keeps its feet");
});

await test("Y14: a creature's Hideous Laughter sent through aoe_damage passes over a companion of Intelligence 3", async () => {
  const { world, sheets: [, rook], enemies: [hag] } = await laughingStage();
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", { casterEnemyId: hag.id, spell: "Hideous Laughter", level: 1, saveAbility: "wis", dc: 15, characterIds: [rook.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(!world.sheet(rook.id).conditions.includes("incapacitated"));
});

await test("Y14: a hero's Hideous Laughter sent through aoe_damage passes over a creature of Intelligence 3", async () => {
  const { world, sheets: [bard], enemies: [wolf] } = await table([caster("bard", "cha", ["Hideous Laughter"])], 1, { abilities: { str: 10, dex: 10, con: 10, int: 3, wis: 10, cha: 10 } });
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", { casterCharacterId: bard.id, spell: "Hideous Laughter", level: 1, enemyIds: [wolf.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(world.enemies().find((entry) => entry.id === wolf.id).conditions, []);
});

await test("Y14: a creature's Hideous Laughter at a hero of Intelligence 10 still lays them low", async () => {
  const { world, sheets: [kara], enemies: [hag] } = await laughingStage();
  world.dice(1);
  const out = await world.invoke("cast_at_player", { characterId: kara.id, casterEnemyId: hag.id, ...LAUGHTER });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(kara.id).conditions.includes("incapacitated"));
});

closeTables();
finish();
