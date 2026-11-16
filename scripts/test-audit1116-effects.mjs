// What common spells do after the roll and when they end, as the 2026-11-16
// audit found the engine getting it wrong (effects lens, findings Y01 on).
// Each test is the rule as SRD 5.1 prints it, read off the engine's own
// state: a sheet's conditions, an enemy's row, the dice rolled.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { freshTurn } from "./lib/enforce-spells.mjs";
import { caster, closeTables, enemyOf, table } from "./lib/enforce-spell-kit.mjs";
import { combatKit, DUMMY, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1116-effects");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");

const held = (world, id) => world.sheet(id).conditions;
const SANCTUARY = (source) => ({ conditions: ["sanctuary"], conditionMeta: { sanctuary: { spell: "Sanctuary", source, rounds: 10 } } });

// ---- Y01: Sanctuary ends on every door the warded creature harms through ----

// SRD 5.1, Sanctuary: "If the warded creature makes an attack or casts a
// spell that affects an enemy creature, this spell ends." pc_attack and a
// slot's cast at an enemy ended it; a spell let loose from a wand or a
// scroll (the item's credit takes the cast down its own path) and the
// warded creature's opportunity attack left it standing, so the cleric kept
// the ward while blasting and striking.
await test("Y01: a wand's Magic Missile at an enemy ends the caster's Sanctuary", async () => {
  const wand = { name: "Wand of Magic Missiles", qty: 1, equipped: true, charges: 7 };
  const { world, sheets: [priest], enemies: [goblin] } = await table([caster("cleric", "wis", ["Sanctuary"], [], 5, { equipment: [wand] })]);
  const warded = await world.invoke("cast_buff", { characterId: priest.id, spell: "Sanctuary", targetCharacterIds: [priest.id] });
  assert.equal(warded.ok, true, warded.error);
  assert.ok(held(world, priest.id).includes("sanctuary"));
  await freshTurn(world);
  const zap = await world.invoke("use_item", { characterId: priest.id, item: "Wand of Magic Missiles", spell: "Magic Missile", charges: 1 });
  assert.equal(zap.ok, true, zap.error);
  world.dice(4, 4, 4);
  const hit = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: goblin.id, spell: "Magic Missile", level: 1 });
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  assert.ok(enemyOf(world, goblin.id).currentHp < 90, "the darts landed");
  assert.ok(!held(world, priest.id).includes("sanctuary"), "a spell from a wand that harms an enemy ends Sanctuary");
});

await test("Y01: a scroll's healing spell on an ally keeps the reader's Sanctuary (it affects no enemy)", async () => {
  const scroll = { name: "Spell Scroll (Cure Wounds)", qty: 1, tags: ["consumable", "scroll", "carried"], spell: "Cure Wounds" };
  const { world, sheets: [priest] } = await table([caster("cleric", "wis", ["Sanctuary"], [], 5, { equipment: [scroll] })]);
  world.patch(priest.id, { currentHp: 10, ...SANCTUARY(priest.id) });
  await freshTurn(world);
  const read = await world.invoke("use_item", { characterId: priest.id, item: "Spell Scroll (Cure Wounds)" });
  assert.equal(read.ok, true, read.error);
  world.dice(5);
  const healed = await world.invoke("heal", { casterId: priest.id, characterId: priest.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  assert.equal(healed.ok, true, healed.error);
  assert.ok(held(world, priest.id).includes("sanctuary"), "healing a friend is no harm to an enemy");
});

await test("Y01: the warded creature's opportunity attack ends its Sanctuary", async () => {
  const { openWorld } = await import("./lib/enforce-world.mjs");
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const kara = world.addHero({
    name: "Kara", class: "fighter", level: 5, maxHp: 80, proficiencies: TRAINED,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  });
  // A companion the party runs swings without being asked
  // (test-enforce-opportunity-ask.mjs), so the walk resolves in one call.
  getDatabase().prepare("UPDATE character_sheets SET is_companion = 1 WHERE id = ?").run(kara.id);
  await kit.fight(1, { heroFaces: { [kara.id]: 20 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { stats: { ...DUMMY }, maxHp: 40, currentHp: 40 });
  kit.place(kara.id, 6, 7);
  kit.place(goblin.id, 5, 7);
  world.patch(kara.id, SANCTUARY(kara.id));
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === goblin.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [goblin.id], acted: null } });
  world.dice(15, 5);
  const walked = await world.invoke("move_token", { token: goblin.id, x: 1, y: 7 });
  world.clearDice();
  assert.equal(walked.ok, true, walked.error);
  assert.ok(world.encounter().reactionsUsed.some((key) => key.includes(kara.id)), "the swing was taken");
  assert.ok(!held(world, kara.id).includes("sanctuary"), "an opportunity attack is an attack: Sanctuary ends");
});

// ---- Y02: Fear's repeat save, out of the caster's sight ----

// SRD 5.1, Fear: "If the creature ends its turn in a location where it
// doesn't have line of sight to you, the creature can make a Wisdom saving
// throw. On a successful save, the spell ends for that creature." The row
// laid the fright for its minute with no save at all, so a goblin that fled
// behind a wall stayed frightened for the whole minute.
// A wizard, a goblin and a fighter, in that order, on a board, the wizard's
// turn: the stage the spells below are cast on.
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
  // The goblin's turn ends after the wizard's: the pointer walks past it,
  // and its turn's end comes with the next move (test-enforce-turn-end-saves.mjs).
  const roundOn = () => {
    assert.equal(kit.endTurn(wizard.userId), true);
    assert.equal(kit.endTurn(fighter.userId), true);
  };
  return { world, kit, wizard, fighter, goblin, roundOn };
}

async function fearStage() {
  const staged = await castStage(["Fear"]);
  const { world, kit, wizard, goblin } = staged;
  world.dice(1);
  const cast = await world.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Fear", enemyIds: [goblin.id], level: 3 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("frightened"), "the goblin failed and is frightened");
  // From here any save it rolls succeeds.
  kit.setEnemy(goblin.id, { stats: { saveMods: { ...DUMMY.saveMods, wis: 40 } } });
  return staged;
}

await test("Y02: a creature frightened by Fear that ends its turn behind a wall, out of the caster's sight, saves and shakes it off", async () => {
  const { kit, goblin, roundOn } = await fearStage();
  const height = kit.map().height;
  kit.openField(Array.from({ length: height }, (_, y) => [8, y, "#"]));
  kit.place(goblin.id, 14, 7);
  roundOn();
  assert.ok(!kit.enemy(goblin.id).conditions.includes("frightened"), "out of sight, its save ended the fear");
  assert.ok(!kit.enemy(goblin.id).conditions.includes("fleeing"), "and the flight with it");
});

await test("Y02: a creature frightened by Fear that ends its turn still in the caster's sight makes no save", async () => {
  const { kit, goblin, roundOn } = await fearStage();
  kit.place(goblin.id, 14, 7);
  roundOn();
  assert.ok(kit.enemy(goblin.id).conditions.includes("frightened"), "in plain sight the fear holds");
});

// ---- Y03: Color Spray blinds until the end of the caster's next turn ----

// SRD 5.1, Color Spray: "Each creature affected by this spell is blinded
// until the end of your next turn." The pool's one round was counted at the
// caster's turn start, so the blindness ended as the caster's next turn
// began, and the caster's own attacks that turn lost the advantage.
await test("Y03: a goblin blinded by Color Spray is still blinded through the caster's next turn, and sees again as it ends", async () => {
  const { world, kit, wizard, fighter, goblin } = await castStage(["Color Spray"]);
  kit.setEnemy(goblin.id, { maxHp: 10, currentHp: 10 });
  world.dice(10, 10, 10, 10, 10, 10);
  const cast = await world.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Color Spray", enemyIds: [goblin.id], level: 1 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("blinded"), "the spray blinded it");
  kit.endTurn(wizard.userId);
  kit.endTurn(fighter.userId);
  assert.equal(kit.current()?.characterId, wizard.id, "the caster's next turn");
  assert.ok(kit.enemy(goblin.id).conditions.includes("blinded"), "blinded through the caster's next turn");
  kit.endTurn(wizard.userId);
  assert.ok(!kit.enemy(goblin.id).conditions.includes("blinded"), "it ends as that turn ends");
});

// ---- Y04: Hideous Laughter passes over a creature of Intelligence 4 or less ----

// SRD 5.1, Hideous Laughter: "A creature with an Intelligence score of 4 or
// less isn't affected." The row's note said so and nothing read it, so a
// wolf fell laughing, prone and incapacitated.
await test("Y04: Hideous Laughter at a creature of Intelligence 3 is cast and spent and leaves it standing", async () => {
  const { world, kit, wizard, goblin } = await castStage(["Hideous Laughter"]);
  kit.setEnemy(goblin.id, { stats: { abilities: { ...DUMMY.abilities, int: 3 } } });
  world.dice(1);
  const cast = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Hideous Laughter", level: 1 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.deepEqual(kit.enemy(goblin.id).conditions, [], "a beast's mind is not touched");
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 1, "the slot is spent, as for any spell that has no effect");
});

await test("Y04: Hideous Laughter at a creature of Intelligence 5 that fails still lays it low", async () => {
  const { world, kit, wizard, goblin } = await castStage(["Hideous Laughter"]);
  kit.setEnemy(goblin.id, { stats: { abilities: { ...DUMMY.abilities, int: 5 } } });
  world.dice(1);
  const cast = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Hideous Laughter", level: 1 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("incapacitated"));
});

// ---- Y05: Banishment held for its whole minute keeps an outsider away ----

// SRD 5.1, Banishment: "If the target is native to a different plane of
// existence than the one you're on, the target is banished ... returning to
// its home plane. If the spell ends before 1 minute has passed, the target
// reappears in the space it left ... Otherwise, the target doesn't return."
// The banished condition's own minute ran out on the same turn start as the
// concentration, and first, so the spell found nobody to send home and the
// fiend stood back up in the fight.
async function banishStage(type) {
  const staged = await castStage(["Banishment"]);
  const { world, kit, wizard, goblin } = staged;
  kit.setEnemy(goblin.id, { stats: { type } });
  world.dice(1);
  const cast = await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: goblin.id, spell: "Banishment", level: 4 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("banished"));
  // The wizard holds it through ten of their turns.
  for (let round = 0; round < 11 && world.encounter(); round += 1) {
    staged.roundOn();
  }
  return staged;
}

await test("Y05: a fiend banished and held for the whole minute does not come back", async () => {
  const { world, kit, wizard, goblin } = await banishStage("fiend");
  assert.equal(world.sheet(wizard.id).concentratingOn, null, "the minute is over");
  assert.notEqual(kit.enemy(goblin.id).status, "alive", "it went home for good");
});

await test("Y05: a humanoid banished and held for the whole minute reappears as the spell ends", async () => {
  const { world, kit, wizard, goblin } = await banishStage("humanoid");
  assert.equal(world.sheet(wizard.id).concentratingOn, null, "the minute is over");
  assert.equal(kit.enemy(goblin.id).status, "alive");
  assert.ok(!kit.enemy(goblin.id).conditions.includes("banished"), "back from the demiplane");
});

closeTables();
finish();
