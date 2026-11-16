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

closeTables();
finish();
