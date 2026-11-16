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
async function fearStage() {
  const { openWorld } = await import("./lib/enforce-world.mjs");
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const wizard = world.addHero({
    name: "Wiz", class: "wizard", level: 5, abilities: { int: 18, con: 14, dex: 12 }, proficiencies: { ...TRAINED, saves: ["int", "wis"] },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } }, known: [], prepared: ["Fear"], cantrips: [] },
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
  world.dice(1);
  const cast = await world.invoke("aoe_damage", { casterCharacterId: wizard.id, spell: "Fear", enemyIds: [goblin.id], level: 3 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("frightened"), "the goblin failed and is frightened");
  // From here any save it rolls succeeds.
  kit.setEnemy(goblin.id, { stats: { saveMods: { ...DUMMY.saveMods, wis: 40 } } });
  // The goblin's turn ends after the wizard's: the pointer walks past it,
  // and its turn's end comes with the next move (test-enforce-turn-end-saves.mjs).
  const roundOn = () => {
    assert.equal(kit.endTurn(wizard.userId), true);
    assert.equal(kit.endTurn(fighter.userId), true);
  };
  return { world, kit, wizard, goblin, roundOn };
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

closeTables();
finish();
