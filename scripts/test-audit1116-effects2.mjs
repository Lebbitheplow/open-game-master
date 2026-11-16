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

// ---- Y15: Enlarge/Reduce and Ray of Enfeeblement on every creature's strike ----

// SRD 5.1, Enlarge/Reduce: enlarged, "the target's attacks with them deal
// 1d4 extra damage"; reduced, "1d4 less damage (this can't reduce the damage
// below 1)". Ray of Enfeeblement: "deals only half damage with weapon
// attacks that use Strength". Y10 put the size on a creature's own swing and
// its opportunity attack at a character; a creature fighting on the party's
// side, a creature striking another as it walks off, and a creature striking
// a pet as it walks off with its owner hit as printed (the last ignored Ray
// of Enfeeblement too).
async function sidesStage() {
  const { openWorld } = await import("./lib/enforce-world.mjs");
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const hero = world.addHero({ name: "Mira", class: "ranger", subclass: "Beast Master", level: 5, maxHp: 60, abilities: { str: 16 }, proficiencies: TRAINED, ac: 12, acOverride: true });
  await kit.fight(2, { heroFaces: { [hero.id]: 20 } });
  const [first, second] = world.enemies();
  for (const enemy of [first, second]) {
    kit.setEnemy(enemy.id, { maxHp: 200, currentHp: 200, stats: { ...DUMMY } });
  }
  kit.scatter();
  return { world, kit, hero, first, second };
}
const sized = (kit, enemy, condition) => kit.setEnemy(enemy.id, { conditions: [condition], conditionMeta: { [condition]: { spell: condition === "enfeebled" ? "Ray of Enfeeblement" : "Enlarge/Reduce", source: "x", rounds: 10 } } });

await test("Y15: a reduced creature fighting on the party's side deals 1d4 less", async () => {
  const { world, kit, hero, first, second } = await sidesStage();
  const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");
  patchEnemyConditions(first.id, ["charmed", "reduced"], { charmed: { spell: "Dominate Person", source: hero.id }, reduced: { spell: "Enlarge/Reduce", source: hero.id, rounds: 10 } });
  kit.place(first.id, 10, 2);
  kit.place(second.id, 11, 2);
  // The club's d20, its d6 at 6, Reduce's d4 at 4: 6 + 2 - 4.
  world.dice(19, 6, 4);
  const out = await world.invoke("enemy_attack", { enemyId: first.id, targetCharacterId: second.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(200 - kit.enemy(second.id).currentHp, 4, JSON.stringify(out.result).slice(0, 300));
});

await test("Y15: an enlarged creature's opportunity attack at a creature walking off its side deals 1d4 more", async () => {
  const { world, kit, hero, first, second } = await sidesStage();
  const { patchEnemyConditions } = await import("../src/lib/db/encounters.ts");
  const { enemiesStrikeWalker } = await import("../src/lib/dm/opportunity-sides.ts");
  patchEnemyConditions(first.id, ["charmed"], { charmed: { spell: "Dominate Person", source: hero.id } });
  sized(kit, second, "enlarged");
  kit.place(first.id, 11, 2);
  kit.place(second.id, 10, 2);
  world.dice(19, 6, 4);
  const notes = enemiesStrikeWalker(world.campaignId, first.id, [{ x: 11, y: 2 }, { x: 12, y: 2 }, { x: 13, y: 2 }], 1);
  world.clearDice();
  assert.equal(notes.length, 1, "the enlarged goblin strikes as it goes");
  assert.equal(200 - kit.enemy(first.id).currentHp, 12, "6 + 2 + 4");
});

async function petStage(condition) {
  const staged = await sidesStage();
  const { world, kit, hero, first } = staged;
  const summoned = await world.invoke("summon_pet", { characterId: hero.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  const { patchSheet } = await import("../src/lib/db/sheets.ts");
  patchSheet(hero.id, { pets: world.sheet(hero.id).pets.map((pet) => ({ ...pet, conditions: [] })) });
  sized(kit, first, condition);
  kit.place(hero.id, 11, 2);
  kit.place(first.id, 10, 2);
  const before = world.sheet(hero.id).pets[0].hp;
  const { strikePetsOnWalk } = await import("../src/lib/dm/opportunity-pets.ts");
  world.dice(19, 6, 4);
  const notes = strikePetsOnWalk(world.campaign(), hero.id, [{ x: 11, y: 2 }, { x: 12, y: 2 }, { x: 13, y: 2 }]);
  world.clearDice();
  assert.equal(notes.length, 1, "the goblin strikes the wolf as it goes");
  return before - world.sheet(hero.id).pets[0].hp;
}

await test("Y15: a reduced creature's opportunity attack at a pet deals 1d4 less", async () => {
  assert.equal(await petStage("reduced"), 4, "6 + 2 - 4");
});

await test("Y15: an enfeebled creature's opportunity attack at a pet deals half", async () => {
  assert.equal(await petStage("enfeebled"), 4, "(6 + 2) / 2");
});

// ---- Y16: Hypnotic Pattern's speed of 0 ----

// SRD 5.1, Hypnotic Pattern: "While charmed by this spell, the creature is
// incapacitated and has a speed of 0." The row laid charmed and
// incapacitated, and incapacitated stops actions, not feet, so a hypnotized
// goblin walked on its turn and GAME STATE gave a held hero their full speed.
const onTurnOf = (kit, world, id) => {
  const encounter = world.encounter();
  const at = encounter.order.findIndex((slot) => (slot.kind === "pc" ? slot.characterId : slot.enemyId) === id);
  kit.saveEncounter({ ...encounter, turnIndex: at, turnBudget: null, legendary: { ...encounter.legendary, due: encounter.order[at].kind === "pc" ? [] : [id], acted: null } });
};

await test("Y16: a creature held by Hypnotic Pattern has a speed of 0 and cannot walk on its turn", async () => {
  const { world, kit, wizard, goblin } = await castStage(["Hypnotic Pattern"]);
  world.dice(1);
  const cast = await world.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Hypnotic Pattern", enemyIds: [goblin.id], level: 3 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("charmed"), "the goblin failed and is charmed");
  const { enemySpeedTiles } = await import("../src/lib/dm/enemy-speed.ts");
  assert.equal(enemySpeedTiles(kit.enemy(goblin.id)), 0, "speed 0");
  onTurnOf(kit, world, goblin.id);
  await world.invoke("move_token", { token: goblin.id, x: 8, y: 7 });
  assert.deepEqual([kit.token(goblin.id).x, kit.token(goblin.id).y], [4, 7], "it stays where the pattern caught it");
  const hurt = await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 1 });
  assert.equal(hurt.ok, true, hurt.error);
  assert.deepEqual(kit.enemy(goblin.id).conditions, [], "damage ends the charm and its hold on its feet together");
  assert.ok(enemySpeedTiles(kit.enemy(goblin.id)) > 0);
});

await test("Y16: a hero held by a creature's Hypnotic Pattern has no movement on their turn", async () => {
  const { world, kit, fighter, goblin } = await castStage([]);
  kit.setEnemy(goblin.id, { stats: { spells: ["Hypnotic Pattern"] } });
  kit.place(fighter.id, 5, 7);
  world.dice(1);
  const cast = await world.invoke("aoe_damage", { casterEnemyId: goblin.id, spell: "Hypnotic Pattern", saveAbility: "wis", dc: 15, characterIds: [fighter.id], level: 3 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(world.sheet(fighter.id).conditions.includes("charmed"), "the fighter failed and is charmed");
  onTurnOf(kit, world, fighter.id);
  const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
  const budget = pcMoveBudget(world.campaignId, world.encounter(), kit.map(), world.sheet(fighter.id), kit.token(fighter.id));
  assert.deepEqual([budget.speed, budget.tiles], [0, 0], "GAME STATE's movement left reads this count");
  await world.invoke("move_token", { token: fighter.id, x: 8, y: 7 });
  assert.deepEqual([kit.token(fighter.id).x, kit.token(fighter.id).y], [5, 7]);
});

closeTables();
finish();
