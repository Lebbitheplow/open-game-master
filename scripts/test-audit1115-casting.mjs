// The casting rules the 2026-11-15 audit found the engine getting wrong
// (casting lens, findings S01 on). Each test is the rule as SRD 5.1 prints
// it, read off the engine's own state: a refusal, a sheet, the dice rolled.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { freshTurn } from "./lib/enforce-spells.mjs";
import { caster, closeTables, table } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-audit1115-casting");

// ---- S01: a running spell's bonus action is not a spell cast ----

// SRD 5.1, Casting Time, Bonus Action: "You can't cast another spell during
// the same turn, except for a cantrip with a casting time of 1 action." Heat
// Metal's later bonus action (and Flaming Sphere's ram, Gust of Wind's blast)
// is the spell already cast doing its work again, not a casting, so it bars
// nothing and nothing bars it.
async function heatMetalDruid() {
  const { world, sheets: [druid], enemies: [goblin, second] } = await table([caster("druid", "wis", ["Heat Metal", "Thunderwave", "Healing Word"])], 2);
  world.dice(4, 4, 20);
  const cast = await world.invoke("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal", level: 2 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  await freshTurn(world);
  return { world, druid, goblin, second };
}

await test("S01: Heat Metal's bonus action again leaves the action free for a levelled spell (Thunderwave)", async () => {
  const { world, druid, goblin, second } = await heatMetalDruid();
  world.dice(4, 4, 20);
  const again = await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal" });
  world.clearDice();
  assert.equal(again.ok, true, again.error);
  assert.ok(again.result.repeat, "the second call is the running spell, not a new casting");
  world.dice(4, 4, 1);
  const wave = await world.invokeAsIs("aoe_damage", { casterCharacterId: druid.id, spell: "Thunderwave", enemyIds: [second.id], level: 1 });
  world.clearDice();
  assert.equal(wave.ok, true, wave.error);
});

await test("S01: a levelled spell cast with the action leaves Heat Metal's bonus action free that turn", async () => {
  const { world, druid, goblin, second } = await heatMetalDruid();
  world.dice(4, 4, 1);
  const wave = await world.invokeAsIs("aoe_damage", { casterCharacterId: druid.id, spell: "Thunderwave", enemyIds: [second.id], level: 1 });
  world.clearDice();
  assert.equal(wave.ok, true, wave.error);
  world.dice(4, 4, 20);
  const again = await world.invokeAsIs("cast_at_enemy", { characterId: druid.id, targetEnemyId: goblin.id, spell: "Heat Metal" });
  world.clearDice();
  assert.equal(again.ok, true, again.error);
});

await test("S01: a spell cast with the bonus action (Healing Word) still bars a levelled action spell that turn", async () => {
  const { world, druid, second } = await heatMetalDruid();
  world.dice(4);
  const word = await world.invokeAsIs("heal", { casterId: druid.id, characterId: druid.id, spell: "Healing Word", level: 1 });
  world.clearDice();
  assert.equal(word.ok, true, word.error);
  world.dice(4, 4, 1);
  const wave = await world.invokeAsIs("aoe_damage", { casterCharacterId: druid.id, spell: "Thunderwave", enemyIds: [second.id], level: 1 });
  world.clearDice();
  assert.equal(wave.refused, "rules", JSON.stringify(wave));
});

// ---- S02: a spell cast from a scroll or a wand is a spell cast ----

// SRD 5.1, Casting Time, Bonus Action: the limit counts every spell cast
// that turn, and a spell read from a scroll or let loose from a wand is one
// (Magic Items, Spells: the user casts the spell from the item). A cleric
// who cast Healing Word with the bonus action read a scroll of Bless with the
// action, and one who read the scroll first cast Healing Word after it.
const scroll = (spell) => ({ name: `Spell Scroll (${spell})`, qty: 1, tags: ["consumable", "scroll", "carried"], spell });

async function scrollCleric(equipment) {
  const { world, sheets: [priest] } = await table([caster("cleric", "wis", ["Healing Word", "Bless"], ["Sacred Flame"], 5, { equipment })]);
  await freshTurn(world);
  return { world, priest };
}

const heldItems = (world, id) => world.sheet(id).equipment.map((item) => item.name);

await test("S02: after Healing Word with the bonus action, a scroll of a levelled spell cannot be read that turn, and the scroll is kept", async () => {
  const { world, priest } = await scrollCleric([scroll("Bless")]);
  world.dice(4);
  const word = await world.invokeAsIs("heal", { casterId: priest.id, characterId: priest.id, spell: "Healing Word", level: 1 });
  world.clearDice();
  assert.equal(word.ok, true, word.error);
  const read = await world.invokeAsIs("use_item", { characterId: priest.id, item: "Spell Scroll (Bless)" });
  assert.equal(read.refused, "rules", JSON.stringify(read));
  assert.ok(heldItems(world, priest.id).includes("Spell Scroll (Bless)"), "the scroll is not spent");
});

await test("S02: a scroll of a levelled spell read with the action leaves no room for Healing Word that turn", async () => {
  const { world, priest } = await scrollCleric([scroll("Bless")]);
  const read = await world.invokeAsIs("use_item", { characterId: priest.id, item: "Spell Scroll (Bless)" });
  assert.equal(read.ok, true, read.error);
  world.dice(4);
  const word = await world.invokeAsIs("heal", { casterId: priest.id, characterId: priest.id, spell: "Healing Word", level: 1 });
  world.clearDice();
  assert.equal(word.refused, "rules", JSON.stringify(word));
});

await test("S02: a scroll of a cantrip with a casting time of one action still goes beside a bonus action spell", async () => {
  const { world, priest } = await scrollCleric([scroll("Sacred Flame")]);
  world.dice(4);
  const word = await world.invokeAsIs("heal", { casterId: priest.id, characterId: priest.id, spell: "Healing Word", level: 1 });
  world.clearDice();
  assert.equal(word.ok, true, word.error);
  const read = await world.invokeAsIs("use_item", { characterId: priest.id, item: "Spell Scroll (Sacred Flame)" });
  assert.equal(read.ok, true, read.error);
});

await test("S02: after Healing Word with the bonus action, a wand's levelled spell cannot be cast that turn, and no charge is spent", async () => {
  const { world, priest } = await scrollCleric([{ name: "Wand of Magic Missiles", qty: 1, equipped: true, charges: 7 }]);
  world.dice(4);
  const word = await world.invokeAsIs("heal", { casterId: priest.id, characterId: priest.id, spell: "Healing Word", level: 1 });
  world.clearDice();
  assert.equal(word.ok, true, word.error);
  const before = JSON.stringify(world.sheet(priest.id).equipment);
  const zap = await world.invokeAsIs("use_item", { characterId: priest.id, item: "Wand of Magic Missiles", spell: "Magic Missile", charges: 1 });
  assert.equal(zap.refused, "rules", JSON.stringify(zap));
  assert.equal(JSON.stringify(world.sheet(priest.id).equipment), before, "the wand keeps its charges");
});

// ---- S03: Bestow Curse from a 5th-level slot needs no concentration ----

// SRD 5.1, Bestow Curse: "Using a spell slot of 5th level or higher grants a
// duration that doesn't require concentration." (Major Image from a 6th
// level slot likewise.) The engine set concentration from the spell's own
// flag whatever the slot, so a 5th-level curse ended the cleric's Bless and
// the next hit could end the eight-hour curse.
async function cursingCleric() {
  const { world, sheets: [priest, ally], enemies: [goblin] } = await table([caster("cleric", "wis", ["Bless", "Bestow Curse"], [], 9), caster("fighter", "str", [], [], 9)]);
  const blessed = await world.invoke("cast_buff", { characterId: priest.id, spell: "Bless", targetCharacterIds: [ally.id] });
  assert.equal(blessed.ok, true, blessed.error);
  assert.equal(world.sheet(priest.id).concentratingOn, "Bless");
  return { world, priest, ally, goblin };
}

await test("S03: Bestow Curse from a 5th-level slot leaves the caster's concentration on Bless, and the curse holds", async () => {
  const { world, priest, ally, goblin } = await cursingCleric();
  world.dice(1);
  const cursed = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: goblin.id, spell: "Bestow Curse", condition: "str", saveAbility: "wis", level: 5 });
  world.clearDice();
  assert.equal(cursed.ok, true, cursed.error);
  assert.equal(world.sheet(priest.id).concentratingOn, "Bless", "the 5th-level curse takes no concentration");
  assert.ok(world.sheet(ally.id).conditions.includes("blessed"), "Bless still holds");
  assert.ok(world.enemies().find((entry) => entry.id === goblin.id).conditions.some((name) => name.startsWith("cursed")), "the goblin is cursed");
});

await test("S03: Bestow Curse from a 3rd-level slot still takes the concentration (and ends Bless)", async () => {
  const { world, priest, goblin } = await cursingCleric();
  world.dice(1);
  const cursed = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: goblin.id, spell: "Bestow Curse", condition: "str", saveAbility: "wis", level: 3 });
  world.clearDice();
  assert.equal(cursed.ok, true, cursed.error);
  assert.equal(world.sheet(priest.id).concentratingOn, "Bestow Curse");
});

// ---- S04: Dispel Magic weighs a spell at the level it was cast at ----

// SRD 5.1, Dispel Magic: "For each spell of 4th level or higher on the
// target, make an ability check using your spellcasting ability. The DC
// equals 10 + the spell's level." A spell cast from a higher slot is a spell
// of that level (Casting a Spell at a Higher Level), and the condition it
// laid records the slot. The engine read the spell's printed level, so a
// 3rd-level Dispel Magic ended a Hold Person cast at 4th outright, and the
// check was made with the sheet's first casting ability, not the ability of
// the class that cast Dispel Magic.
const dispelGrip = (world, id) => world.enemies().find((entry) => entry.id === id).conditions.includes("paralyzed");

async function heldGoblin(dispeller) {
  const { world, sheets: [holder, breaker], enemies: [goblin] } = await table([caster("wizard", "int", ["Hold Person"], [], 9), dispeller]);
  world.dice(1);
  const held = await world.invoke("cast_at_enemy", { characterId: holder.id, targetEnemyId: goblin.id, spell: "Hold Person", saveAbility: "wis", level: 4 });
  world.clearDice();
  assert.equal(held.ok, true, held.error);
  assert.ok(dispelGrip(world, goblin.id), "the goblin is held");
  return { world, breaker, goblin };
}

await test("S04: a Hold Person cast at 4th level asks a 3rd-level Dispel Magic for a DC 14 check, and a failed check leaves it", async () => {
  const { world, breaker, goblin } = await heldGoblin(caster("wizard", "int", ["Dispel Magic"], [], 9));
  world.dice(1);
  const dispel = await world.invoke("cast_at_enemy", { characterId: breaker.id, targetEnemyId: goblin.id, spell: "Dispel Magic", level: 3 });
  world.clearDice();
  assert.equal(dispel.ok, true, dispel.error);
  assert.ok(dispelGrip(world, goblin.id), JSON.stringify(dispel.result?.dispelled));
});

await test("S04: a wizard and cleric's Dispel Magic, prepared as a cleric spell, checks with Wisdom", async () => {
  const hero = caster("wizard", "int", [], [], 7, {
    abilities: { int: 8, wis: 18, con: 14 },
    classes: [{ id: "wizard", subclass: "", level: 2 }, { id: "cleric", subclass: "", level: 5 }],
    spellcasting: {
      ability: "int",
      prepared: ["Dispel Magic"],
      casters: [
        { classId: "wizard", ability: "int", known: [], prepared: [], cantrips: [], spellbook: [] },
        { classId: "cleric", ability: "wis", known: [], prepared: ["Dispel Magic"], cantrips: [] },
      ],
    },
  });
  const { world, breaker, goblin } = await heldGoblin(hero);
  world.dice(10);
  const dispel = await world.invoke("cast_at_enemy", { characterId: breaker.id, targetEnemyId: goblin.id, spell: "Dispel Magic", level: 3 });
  world.clearDice();
  assert.equal(dispel.ok, true, dispel.error);
  // 10 + 4 (WIS 18) against 10 + 4, where INT 8 would have made it 9.
  assert.match(JSON.stringify(dispel.result?.dispelled), /check 14 vs DC 14/);
  assert.ok(!dispelGrip(world, goblin.id));
});

// ---- S05: Destructive Wave deals both of its damage types ----

// SRD 5.1, Destructive Wave: "a creature takes 5d6 thunder damage and 5d6
// radiant or necrotic damage (your choice) and is knocked prone." The dice
// reader stopped at "radiant or necrotic", so the wave rolled 5d6 thunder
// and half of its damage was lost.
await test("S05: Destructive Wave rolls 5d6 thunder and 5d6 radiant, and a failed save knocks the creature prone", async () => {
  const { world, sheets: [paladin], enemies: [goblin] } = await table([caster("paladin", "cha", ["Destructive Wave"], [], 17)]);
  world.diceLog();
  world.dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
  const wave = await world.invoke("aoe_damage", { casterCharacterId: paladin.id, spell: "Destructive Wave", enemyIds: [goblin.id], level: 5 });
  world.clearDice();
  assert.equal(wave.ok, true, wave.error);
  assert.equal(world.diceLog().filter((die) => die.sides === 6).length, 10, "ten d6");
  const foe = world.enemies().find((entry) => entry.id === goblin.id);
  assert.equal(foe.maxHp - foe.currentHp, 10);
  assert.ok(foe.conditions.includes("prone"));
});

closeTables();
finish();
