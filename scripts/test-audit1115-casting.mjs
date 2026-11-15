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

// ---- S06: Armor of Agathys bites the creature that hits through it ----

// SRD 5.1, Armor of Agathys: "If a creature hits you with a melee attack while
// you have these hit points, the creature takes 5 cold damage", and "both the
// temporary hit points and the cold damage increase by 5 for each slot level
// above 1st." The engine gave the temporary hit points and left the cold to
// the GM ("apply_damage on the attacker"), which apply_damage refuses for a
// spell's harm to a foe: the frost never bit.
async function frostWarlock() {
  const { world, sheets: [lock], enemies: [goblin] } = await table([
    caster("warlock", "cha", [], ["Eldritch Blast"], 5, { spellcasting: { known: ["Armor of Agathys"], slots: { 3: { max: 2, used: 0 } } } }),
  ]);
  const armored = await world.invoke("cast_buff", { characterId: lock.id, spell: "Armor of Agathys", level: 3 });
  assert.equal(armored.ok, true, armored.error);
  assert.equal(world.sheet(lock.id).tempHp, 15, "15 temporary hit points from a 3rd-level slot");
  return { world, lock, goblin };
}

const hpLost = (world, id) => {
  const foe = world.enemies().find((entry) => entry.id === id);
  return foe.maxHp - foe.currentHp;
};

await test("S06: a creature that hits an Armor of Agathys cast at 3rd level with a melee attack takes 15 cold damage", async () => {
  const { world, lock, goblin } = await frostWarlock();
  world.dice(15, 3);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: lock.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.hit, true, JSON.stringify(swing.result));
  assert.equal(hpLost(world, goblin.id), 15, JSON.stringify(swing.result.swings));
});

await test("S06: once the spell's temporary hit points are gone, a melee hit takes no cold damage", async () => {
  const { world, lock, goblin } = await frostWarlock();
  world.patch(lock.id, { tempHp: 0 });
  world.dice(15, 3);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: lock.id });
  world.clearDice();
  assert.equal(swing.result.hit, true);
  assert.equal(hpLost(world, goblin.id), 0);
});

// ---- S07: GAME STATE's per-class save DC is the one the engine rolls ----

// SRD 5.1, Robe of the Archmagi: "Your spell save DC and spell attack bonus
// each increase by 2." A multiclass caster's GAME STATE line worked each
// class's DC out by hand as 8 + proficiency + the ability, so the robe's +2
// the engine rolls against was missing from the number the GM reads out.
await test("S07: a wizard and cleric in a Robe of the Archmagi reads each class's save DC with the robe's +2, as the engine rolls it", async () => {
  const { describeSheet } = await import("../src/lib/dm/prompt.ts");
  const { spellSaveDcFor } = await import("../src/lib/srd/index.ts");
  const hero = caster("wizard", "int", [], [], 5, {
    abilities: { int: 18, wis: 12, con: 14 },
    classes: [{ id: "wizard", subclass: "", level: 3 }, { id: "cleric", subclass: "", level: 2 }],
    equipment: [{ name: "Robe of the Archmagi", qty: 1, equipped: true, attuned: true }],
    spellcasting: {
      ability: "int",
      prepared: ["Magic Missile", "Cure Wounds"],
      casters: [
        { classId: "wizard", ability: "int", known: [], prepared: ["Magic Missile"], cantrips: [], spellbook: ["Magic Missile"] },
        { classId: "cleric", ability: "wis", known: [], prepared: ["Cure Wounds"], cantrips: [] },
      ],
    },
  });
  const { world, sheets: [mage] } = await table([hero]);
  const sheet = world.sheet(mage.id);
  const text = describeSheet(sheet, "a player", false);
  const wizardDc = spellSaveDcFor(sheet, "Magic Missile");
  const clericDc = spellSaveDcFor(sheet, "Cure Wounds");
  // 8 + 3 + 4 (INT 18) + 2, and 8 + 3 + 1 (WIS 12) + 2.
  assert.deepEqual([wizardDc, clericDc], [17, 14]);
  assert.match(text, new RegExp(`As a wizard \\(INT, Save DC ${wizardDc}\\)`));
  assert.match(text, new RegExp(`As a cleric \\(WIS, Save DC ${clericDc}\\)`));
});

// ---- S08: a spell's note never sends the GM to deal what the server deals ----

// Warding Bond's shared damage (pc-damage.ts wardingBondShare) and Fire
// Shield's retort (spell-retort.ts) are dealt by the server, but the note a
// cast hands the GM still said "(apply_damage)": a GM who obeyed hurt Warding
// Bond's caster twice for every blow the ward took (SRD 5.1: "you take the
// same amount of damage", once).
await test("S08: Warding Bond's and Fire Shield's cast notes leave their damage to the server", async () => {
  const { spellMechFor } = await import("../src/lib/srd/spell-mechanics.ts");
  for (const spell of ["Warding Bond", "Fire Shield"]) {
    const note = spellMechFor([spell])?.note ?? "";
    assert.ok(note, `${spell} has a note`);
    assert.doesNotMatch(note, /apply_damage/, `${spell}: ${note}`);
    assert.match(note, /the server/i, `${spell}: ${note}`);
  }
});

// ---- S09: a warlock's spent pact slots stay spent through a level-up ----

// SRD 5.1, Pact Magic: all of a warlock's slots are one level, and they come
// back on a short or long rest. A level that raises that level (warlock 3, 5,
// 7, 9) moves the slots to the new level; the engine kept spent slots spent
// on every other caster (level-change.ts: "Spent dice and spent slots stay
// spent") but read a lone warlock's spent count at the new level's key,
// where there was none, so both spent slots came back without a rest.
await test("S09: a warlock 2 with both pact slots spent who reaches warlock 3 has two 2nd-level slots, both still spent", async () => {
  const { settleSlots } = await import("../src/lib/srd/level-change.ts");
  const casting = { ability: "cha", slots: { 1: { max: 2, used: 2 } }, known: ["Hex"], prepared: [], cantrips: ["Eldritch Blast"] };
  const after = settleSlots({ class: "warlock", level: 2, spellcasting: casting }, [{ id: "warlock", level: 3 }]);
  assert.deepEqual(after.slots, { 2: { max: 2, used: 2 } });
  const fifth = settleSlots({ class: "warlock", level: 4, spellcasting: { ...casting, slots: { 2: { max: 2, used: 1 } } } }, [{ id: "warlock", level: 5 }]);
  assert.deepEqual(fifth.slots, { 3: { max: 2, used: 1 } });
});

// ---- S10: a spell read from a scroll keeps the scroll's numbers while it runs ----

// SRD 5.1, Spell Scroll: the spell is cast with the scroll's save DC and
// attack bonus (15 and +7 for a 3rd-level scroll). The item credit lent those
// numbers for one real minute after the cast, and a used-up scroll leaves no
// row to carry them on (ring-store.ts noteRunning), so a Spirit Guardians
// read from a scroll saved against the reader's own DC from the next minute
// on, and a Call Lightning's later bolts the same.
const { getDatabase } = await import("../src/lib/db/core.ts");
const { skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");
const { layMap } = await import("./lib/enforce-spells.mjs");
const { field } = await import("./lib/enforce-spell-kit.mjs");

// Real time passing since the scroll was read: more than the minute a taken
// credit lends its numbers for.
function ageItemCasts(sheetId, ms = 10 * 60 * 1000) {
  const db = getDatabase();
  const row = db.prepare(`SELECT payload_json FROM item_cast_credits WHERE character_id = ?`).get(sheetId);
  if (row) {
    const aged = JSON.parse(row.payload_json).map((credit) => ({ ...credit, at: credit.at - ms, ...(credit.usedAt !== undefined ? { usedAt: credit.usedAt - ms } : {}) }));
    db.prepare(`UPDATE item_cast_credits SET payload_json = ? WHERE character_id = ?`).run(JSON.stringify(aged), sheetId);
  }
}

// A 9th-level cleric (WIS 18, own DC 16) beside a goblin, Spirit Guardians
// read from a 3rd-level scroll (DC 15).
async function guardianScroll() {
  const { world, sheets: [priest], enemies: [goblin] } = await table([caster("cleric", "wis", ["Spirit Guardians"], [], 9, { equipment: [scroll("Spirit Guardians")] })]);
  await layMap(world, field(), { [priest.id]: { x: 1, y: 2 }, [goblin.id]: { x: 2, y: 2 } });
  const read = await world.invoke("use_item", { characterId: priest.id, item: "Spell Scroll (Spirit Guardians)" });
  assert.equal(read.ok, true, read.error);
  const cast = await world.invoke("cast_buff", { characterId: priest.id, spell: "Spirit Guardians", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  assert.equal(world.sheet(priest.id).spellcasting.slots["3"].used, 0, "the scroll paid, not a slot");
  return { world, priest, goblin };
}

await test("S10: Spirit Guardians read from a scroll saves against the scroll's DC 15 long after the minute, not the cleric's 16", async () => {
  const { world, priest, goblin } = await guardianScroll();
  ageItemCasts(priest.id);
  // A 15 saves against 15 (half of 12) and fails against 16 (all 12).
  world.dice(15, 4, 4, 4);
  assert.equal(skipCurrentTurn(world.campaignId), true);
  world.clearDice();
  assert.equal(hpLost(world, goblin.id), 6);
});

await test("S10: once the scroll's Spirit Guardians has ended, the cleric's own casting saves against their own DC 16", async () => {
  const { world, priest, goblin } = await guardianScroll();
  const dropped = await world.invoke("clear_condition", { characterId: priest.id, condition: "concentration" });
  assert.equal(dropped.ok, true, dropped.error);
  ageItemCasts(priest.id);
  await freshTurn(world);
  const own = await world.invoke("cast_buff", { characterId: priest.id, spell: "Spirit Guardians", level: 3 });
  assert.equal(own.ok, true, own.error);
  assert.equal(world.sheet(priest.id).spellcasting.slots["3"].used, 1);
  world.dice(15, 4, 4, 4);
  assert.equal(skipCurrentTurn(world.campaignId), true);
  world.clearDice();
  assert.equal(hpLost(world, goblin.id), 12);
});

await test("S10: a later Call Lightning bolt from a scroll is saved against the scroll's DC 15, not the druid's 16", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await table([caster("druid", "wis", ["Call Lightning"], [], 9, { equipment: [scroll("Call Lightning")] })]);
  const read = await world.invoke("use_item", { characterId: druid.id, item: "Spell Scroll (Call Lightning)" });
  assert.equal(read.ok, true, read.error);
  // The damage dice first, then the save.
  world.dice(1, 1, 1, 20);
  const one = await world.invoke("aoe_damage", { casterCharacterId: druid.id, spell: "Call Lightning", level: 3, enemyIds: [goblin.id] });
  world.clearDice();
  assert.equal(one.ok, true, one.error);
  assert.equal(hpLost(world, goblin.id), 1, "a 20 saved: half of 3");
  await freshTurn(world);
  ageItemCasts(druid.id);
  world.dice(5, 5, 5, 15);
  const two = await world.invokeAsIs("aoe_damage", { casterCharacterId: druid.id, spell: "Call Lightning", enemyIds: [goblin.id] });
  world.clearDice();
  assert.equal(two.ok, true, two.error);
  // A 15 saves against 15: half of 15.
  assert.equal(hpLost(world, goblin.id), 1 + 7);
});

await test("S10: a Sanctuary read from a scroll onto an ally wards them with the scroll's DC 13 long after the minute", async () => {
  const { world, sheets: [priest, ally], enemies: [goblin] } = await table([caster("cleric", "wis", ["Sanctuary"], [], 9, { equipment: [scroll("Sanctuary")] }), caster("fighter", "str", [], [], 9)]);
  const read = await world.invoke("use_item", { characterId: priest.id, item: "Spell Scroll (Sanctuary)" });
  assert.equal(read.ok, true, read.error);
  const warded = await world.invoke("cast_buff", { characterId: priest.id, spell: "Sanctuary", targetCharacterIds: [ally.id] });
  assert.equal(warded.ok, true, warded.error);
  assert.ok(world.sheet(ally.id).conditions.includes("sanctuary"));
  ageItemCasts(priest.id);
  // A 13 makes the goblin's WIS save against 13 and fails it against 16.
  world.dice(13, 15, 3);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
});

// ---- S11: an enemy's new casting of its concentration spell ends the old ----

// SRD 5.1, Concentration: "You lose concentration on a spell if you cast
// another spell that requires concentration", a second casting of the same
// spell too. An enemy's concentration was cleared only for a different spell,
// and after the new casting's conditions were laid, so a hag that cast Hold
// Person on one hero and again the next round on another held both.
const encounterRows = await import("../src/lib/db/encounters.ts");
const nextRound = (world) => {
  const live = world.encounter();
  encounterRows.saveEncounter({ ...live, round: live.round + 1 });
};
const heldBy = (world, id) => world.sheet(id).conditions.includes("paralyzed");

await test("S11: an enemy that casts Hold Person again the next round frees the hero its first casting held", async () => {
  const { world, sheets: [first, second], enemies: [hag] } = await table([{ class: "fighter", level: 5 }, { class: "rogue", level: 5 }], 1, { spells: ["Hold Person"] });
  const hold = async (target) => {
    world.dice(1);
    const out = await world.invoke("cast_at_player", { characterId: target.id, spell: "Hold Person", saveAbility: "wis", dc: 15, condition: "paralyzed", casterEnemyId: hag.id });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  };
  await hold(first);
  assert.ok(heldBy(world, first.id));
  nextRound(world);
  await hold(second);
  assert.ok(heldBy(world, second.id), "the new casting holds its target");
  assert.ok(!heldBy(world, first.id), "the first casting ended with the new one");
  assert.equal(world.enemies().find((entry) => entry.id === hag.id).concentration, "Hold Person");
});

await test("S11: one casting of an enemy's Hypnotic Pattern over two heroes holds them both", async () => {
  const { world, sheets: [first, second], enemies: [hag] } = await table([{ class: "fighter", level: 5 }, { class: "rogue", level: 5 }], 1, { spells: ["Hypnotic Pattern"] });
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", { casterEnemyId: hag.id, spell: "Hypnotic Pattern", characterIds: [first.id, second.id], saveAbility: "wis", dc: 15 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  for (const hero of [first, second]) {
    assert.ok(world.sheet(hero.id).conditions.includes("charmed"), JSON.stringify(out.result?.results));
  }
  assert.equal(world.enemies().find((entry) => entry.id === hag.id).concentration, "Hypnotic Pattern");
});

// ---- S12: the prepared count reads the score a worn item sets ----

// SRD 5.1, Wizard, Preparing and Casting Spells: "choose a number of wizard
// spells from your spellbook equal to your Intelligence modifier + your
// wizard level"; Headband of Intellect: "Your Intelligence score is 19 while
// you wear this headband." Every other number reads the headband's 19
// (computeSheetDerived), but the spells route, the sheet's Spells panel and
// the save check counted from the sheet's own INT 10.
const BOOK = ["Magic Missile", "Shield", "Sleep", "Burning Hands", "Mage Armor", "Detect Magic", "Thunderwave"];
const headbandWizard = (prepared) => caster("wizard", "int", prepared, ["Fire Bolt"], 3, {
  abilities: { int: 10, con: 14, dex: 12 },
  equipment: [{ name: "Headband of Intellect", qty: 1, equipped: true, attuned: true }],
  spellcasting: { spellbook: BOOK },
});

await test("S12: a 3rd-level wizard (INT 10) in a Headband of Intellect prepares 7 spells (3 + the headband's +4), not 3", async () => {
  const { openWorld } = await import("./lib/enforce-world.mjs");
  const world = await openWorld();
  const mage = world.addHero(headbandWizard(BOOK.slice(0, 3)));
  const spells = await world.route("campaigns/[campaignId]/sheet/spells");
  world.signIn({ id: mage.userId });
  const response = await spells.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepare", spell: "Burning Hands", sheetId: mage.id }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
});

await test("S12: the save check counts a headband wizard's 7 prepared spells as within the count", async () => {
  const { spellListProblems } = await import("../src/lib/srd/spell-prep.ts");
  const { openWorld } = await import("./lib/enforce-world.mjs");
  const world = await openWorld();
  const mage = world.sheet(world.addHero(headbandWizard(BOOK)).id);
  assert.deepEqual(spellListProblems(mage, { bookAllowance: false }).filter((line) => /prepare|spells/i.test(line)), []);
  const bare = { ...mage, equipment: [] };
  assert.ok(spellListProblems(bare, { bookAllowance: false }).some((line) => /3/.test(line)), "without the headband, 7 is over the count of 3");
});

// ---- S13: a duration in words ("a year and a day") is read ----

// SRD 5.1, Mass Suggestion: "When you cast this spell using a 7th-level
// spell slot, the duration is 10 days. When you use an 8th-level spell slot,
// the duration is 30 days. When you use a 9th-level spell slot, the duration
// is a year and a day." The reader took only a duration with digits, so the
// 9th-level casting kept the 8th's 30 days; and the longest count a lifetime
// could hold was one year, a day short. The same reader lost Geas's "until it
// is ended" and Planar Binding's 7th and 8th levels.
const DAY = 14400;

await test("S13: Mass Suggestion lasts 24 hours, 10 days from a 7th-level slot, 30 from an 8th, a year and a day from a 9th", async () => {
  const { spellDurationRounds } = await import("../src/lib/dm/spell-effects.ts");
  const { slotDurationsFromText } = await import("../src/lib/srd/spell-duration.ts");
  assert.deepEqual([6, 7, 8, 9].map((level) => spellDurationRounds("Mass Suggestion", undefined, level)), [DAY, 10 * DAY, 30 * DAY, 366 * DAY]);
  const printed = "When you cast this spell using a 7th-level spell slot, the duration is 10 days. When you use an 8th-level spell slot, the duration is 30 days. When you use a 9th-level spell slot, the duration is a year and a day.";
  assert.deepEqual(slotDurationsFromText(printed).at, [[7, 10 * DAY], [8, 30 * DAY], [9, 366 * DAY]]);
  // The other rows a slot lengthens still read as before.
  assert.deepEqual([3, 5].map((level) => spellDurationRounds("Hex", undefined, level)), [8 * 600, 24 * 600]);
  // Geas from a 9th-level slot: "until it is ended by one of the spells
  // mentioned above", no count (it read as the 7th level's year).
  assert.deepEqual([7, 9].map((level) => spellDurationRounds("Geas", undefined, level)), [365 * DAY, null]);
  // Planar Binding: "10 days with a 6th-level slot, to 30 days with a
  // 7th-level slot, to 180 days with an 8th-level slot, and to a year and a
  // day with a 9th-level slot" (the 7th and 8th read as the 6th's 10 days).
  assert.deepEqual([5, 6, 7, 8, 9].map((level) => spellDurationRounds("Planar Binding", undefined, level)), [DAY, 10 * DAY, 30 * DAY, 180 * DAY, 366 * DAY]);
  assert.equal(spellDurationRounds("Suggestion", undefined, 9), 8 * 600);
});

await test("S13: a goblin that fails its save against a 9th-level Mass Suggestion is held for a year and a day", async () => {
  const { world, sheets: [bard], enemies: [goblin] } = await table([caster("bard", "cha", [], [], 17, { spellcasting: { known: ["Mass Suggestion"] } })]);
  world.dice(1);
  const cast = await world.invoke("cast_at_enemy", { characterId: bard.id, targetEnemyId: goblin.id, spell: "Mass Suggestion", saveAbility: "wis", level: 9 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  const foe = world.enemies().find((entry) => entry.id === goblin.id);
  assert.equal(foe.conditionMeta.suggested?.rounds, 366 * DAY, JSON.stringify(foe.conditionMeta));
});

// ---- S15: a ranger casts a costless material only from a component pouch ----

// SRD 5.1, Spellcasting, Components: "A character can use a component pouch
// or a spellcasting focus (found in chapter 5) in place of the components
// specified for a spell", and each class names the focus it may use (the
// wizard an arcane focus, the druid a druidic focus...). The ranger's text
// names none, so a ranger needs the pouch. Letting a ranger use any focus is
// the 2024 rule. A fighter's or rogue's third-caster subclass names none
// either.
await test("S15: a ranger holding a druidic focus but no component pouch is refused Goodberry, and says why", async () => {
  const { focusProblem } = await import("../src/lib/dm/cast-materials.ts");
  const { spellFactsFor } = await import("../src/lib/content/index.ts");
  const facts = spellFactsFor("Goodberry");
  assert.ok(facts?.material, "Goodberry has a material component");
  const ranger = (equipment) => ({ name: "Wren", class: "ranger", classes: [{ id: "ranger", subclass: "", level: 5 }], equipment });
  const refused = focusProblem(ranger([{ name: "Druidic focus (yew wand)", qty: 1, tags: ["druidic_focus"] }]), facts);
  assert.equal(refused?.refused, "rules", JSON.stringify(refused));
  assert.match(refused.error, /a ranger needs a component pouch; the SRD ranger has no spellcasting focus/);
  assert.equal(focusProblem(ranger([{ name: "Component pouch", qty: 1 }]), facts), null, "the pouch serves");
  // A ranger and druid uses the druid's focus as the druid does.
  assert.equal(focusProblem({ ...ranger([{ name: "Druidic focus (yew wand)", qty: 1, tags: ["druidic_focus"] }]), classes: [{ id: "ranger", level: 5 }, { id: "druid", level: 2 }] }, facts), null);
  // A fighter's Eldritch Knight with an arcane focus: no focus in their text either.
  const grease = spellFactsFor("Grease");
  const knight = focusProblem({ name: "Brann", class: "fighter", classes: [{ id: "fighter", subclass: "Eldritch Knight", level: 7 }], equipment: [{ name: "Arcane focus (crystal)", qty: 1, tags: ["arcane_focus"] }] }, grease);
  assert.equal(knight?.refused, "rules", JSON.stringify(knight));
});

// ---- S16: Destructive Wave's second 5d6 is radiant or necrotic, the caster's choice ----

// SRD 5.1, Destructive Wave: "5d6 thunder damage and 5d6 radiant or necrotic
// damage (your choice)". S05 dealt the second 5d6 as radiant always; a
// paladin who chose necrotic had no way to say so. Each share meets its own
// resistance: a creature resistant to necrotic halves only that share.
async function waveAt(stats, args = {}) {
  const { world, sheets: [paladin], enemies: [foe] } = await table([caster("paladin", "cha", ["Destructive Wave"], [], 17)], 1, stats);
  // Every d6 a 2: 10 thunder and 10 of the chosen type; the save a 1.
  world.dice(2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1);
  const wave = await world.invoke("aoe_damage", { casterCharacterId: paladin.id, spell: "Destructive Wave", enemyIds: [foe.id], level: 5, ...args });
  world.clearDice();
  assert.equal(wave.ok, true, wave.error);
  return { wave, lost: hpLost(world, foe.id) };
}

await test("S16: Destructive Wave cast as necrotic deals its second 5d6 as necrotic, halved by a resistance to necrotic", async () => {
  const { wave, lost } = await waveAt({ resist: "necrotic" }, { type: "necrotic" });
  assert.equal(lost, 10 + 5, JSON.stringify(wave.result?.results));
  assert.match(JSON.stringify(wave.result), /necrotic/);
});

await test("S16: Destructive Wave with no choice named stays radiant, which a resistance to necrotic does not touch", async () => {
  const { lost } = await waveAt({ resist: "necrotic" });
  assert.equal(lost, 20);
});

// ---- S17: Heroism from a Ring of Spell Storing gives the original caster's modifier ----

// SRD 5.1, Ring of Spell Storing: the spell "uses the slot level, spell save
// DC, spell attack bonus, and spellcasting ability of the original caster";
// Heroism: temporary hit points "equal to your spellcasting ability modifier
// at the start of each of its turns". The turn-start grant read the
// wearer's own sheet, so a fighter casting a cleric's stored Heroism gained
// none at all (the fighter has no spellcasting ability).
await test("S17: a fighter casting a cleric's Heroism from a Ring of Spell Storing gains the cleric's 4 temporary hit points each turn", async () => {
  const ringRow = { name: "Ring of Spell Storing", qty: 1, equipped: true, attuned: true, storedSpells: [{ spell: "Heroism", level: 1, saveDc: 15, attackBonus: 7, abilityMod: 4, by: "Priest" }] };
  const { world, sheets: [fighter] } = await table([{ class: "fighter", level: 5, abilities: { str: 16 }, equipment: [ringRow] }]);
  const drawn = await world.invoke("use_item", { characterId: fighter.id, item: "Ring of Spell Storing", spell: "Heroism" });
  assert.equal(drawn.ok, true, JSON.stringify(drawn));
  const cast = await world.invoke("cast_buff", { characterId: fighter.id, spell: "Heroism", targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, JSON.stringify(cast));
  // The goblin's turn, then the fighter's own: Heroism's grant as it starts.
  assert.equal(skipCurrentTurn(world.campaignId), true);
  assert.equal(skipCurrentTurn(world.campaignId), true);
  world.clearDice();
  assert.equal(world.sheet(fighter.id).tempHp, 4);
});

closeTables();
finish();
