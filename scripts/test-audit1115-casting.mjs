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

// ---- S18: a list of slot levels sharing one length starts at the first ----

// A pack spell's higher-level text lists levels before the length they share
// ("using a spell slot of 5th, 6th, or 7th level, the duration increases to
// 48 hours"). The reader gave the length to the last level of the list, so
// a 5th or 6th-level casting kept the spell's own duration.
await test("S18: \"5th, 6th, or 7th level, the duration increases to 48 hours\" lasts 48 hours from a 5th-level slot", async () => {
  const { slotDurationsFromText } = await import("../src/lib/srd/spell-duration.ts");
  const printed = "When you cast this spell using a spell slot of 5th, 6th, or 7th level, the duration increases to 48 hours. When you cast this spell using a spell slot of 8th or 9th level, the duration increases to 72 hours.";
  assert.deepEqual(slotDurationsFromText(printed).at, [[5, 48 * 600], [8, 72 * 600]]);
});

// ---- S19: a multiclass caster's focus serves its own class's spells ----

// SRD 5.1, Druid: "You can use a druidic focus as a spellcasting focus for
// your druid spells" (each class's focus the same). On a ranger and druid
// the focus was judged by the union of the classes, so the druidic focus
// stood in for a spell learned as a ranger.
await test("S19: a ranger and druid's druidic focus serves the spell they prepared as a druid, not the one they know as a ranger", async () => {
  const { focusProblem } = await import("../src/lib/dm/cast-materials.ts");
  const { spellFactsFor } = await import("../src/lib/content/index.ts");
  const both = {
    name: "Wren", class: "ranger",
    classes: [{ id: "ranger", subclass: "", level: 5 }, { id: "druid", subclass: "", level: 3 }],
    equipment: [{ name: "Druidic focus (yew wand)", qty: 1, tags: ["druidic_focus"] }],
    spellcasting: {
      ability: "wis", slots: {}, known: ["Goodberry"], prepared: ["Longstrider"], cantrips: [],
      casters: [
        { classId: "ranger", ability: "wis", known: ["Goodberry"], prepared: [], cantrips: [] },
        { classId: "druid", ability: "wis", known: [], prepared: ["Longstrider"], cantrips: [] },
      ],
    },
  };
  assert.equal(focusProblem(both, spellFactsFor("Longstrider")), null, "a druid spell takes the druidic focus");
  const ranger = focusProblem(both, spellFactsFor("Goodberry"));
  assert.equal(ranger?.refused, "rules", JSON.stringify(ranger));
  assert.match(ranger.error, /component pouch/);
});

// ---- S20: a hit a reaction turns into a miss sets off nothing ----

// SRD 5.1 keys each answer to the hit: Fire Shield "Whenever a creature
// within 5 feet of you hits you with a melee attack", Armor of Agathys "If a
// creature hits you with a melee attack", Holy Aura "If a fiend or an undead
// hits a creature with a melee attack". Shield's +5 counts "including against
// the triggering attack" and Cutting Words comes "before the GM determines
// whether the attack roll succeeds", so an attack they turn into a miss never
// hit. The engine lands the hit and its answer in one call and the reaction
// after it: the creature kept the flame, the frost and the blindness of a
// blow that missed.
const { call: routeCall } = await import("./lib/enforce-campaign.mjs");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");

async function flameWizard(options = {}) {
  const { world, sheets: [mage], enemies: [goblin] } = await table([caster("wizard", "int", ["Fire Shield", "Shield"])], 1, {}, options);
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Fire Shield", variant: "fire shield (cold)", level: 4 });
  assert.equal(cast.ok, true, cast.error);
  world.patch(mage.id, { ac: 12, acOverride: true });
  return { world, mage, goblin };
}

async function swingAt(world, goblin, hero, faces) {
  world.dice(...faces);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: hero.id });
  world.clearDice();
  assert.equal(swing.ok, true, swing.error);
  return swing;
}

await test("S20: a hit Shield turns into a miss never set off Fire Shield: the goblin gets its 8 fire damage back", async () => {
  const { world, mage, goblin } = await flameWizard();
  // 10 + 4 against AC 12 hits for 3 + 2; the shield's 2d8 come up 4 and 4.
  const swing = await swingAt(world, goblin, mage, [10, 3, 4, 4]);
  assert.equal(swing.result.hit, true, JSON.stringify(swing.result));
  assert.equal(hpLost(world, goblin.id), 8, "the flame answers the hit as it lands");
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  // 14 against AC 17 misses: no hit, so no flame.
  assert.equal(hpLost(world, goblin.id), 0, JSON.stringify(shield.result));
  assert.equal(world.sheet(mage.id).currentHp, world.sheet(mage.id).maxHp);
  assert.match(JSON.stringify(shield.result), /Fire Shield/, "the GM is told the flame is taken back");
});

await test("S20: a hit Shield cannot turn keeps Fire Shield's flame, dealt once", async () => {
  const { world, mage, goblin } = await flameWizard();
  // 19 + 4 still meets AC 17.
  await swingAt(world, goblin, mage, [19, 3, 4, 4]);
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  assert.equal(hpLost(world, goblin.id), 8);
});

const loreBard = caster("bard", "cha", [], [], 5, { subclass: "College of Lore" });

await test("S20: a hit Cutting Words turns into a miss never froze its attacker on Armor of Agathys", async () => {
  const { world, sheets: [lock, bard], enemies: [goblin] } = await table([
    caster("warlock", "cha", [], ["Eldritch Blast"], 5, { spellcasting: { known: ["Armor of Agathys"], slots: { 3: { max: 2, used: 0 } } } }),
    loreBard,
  ]);
  const armored = await world.invoke("cast_buff", { characterId: lock.id, spell: "Armor of Agathys", level: 3 });
  assert.equal(armored.ok, true, armored.error);
  world.patch(lock.id, { ac: 12, acOverride: true });
  world.patch(bard.id, { resources: { ...world.sheet(bard.id).resources, bardic_inspiration: { max: 3, used: 0 } } });
  await swingAt(world, goblin, lock, [10, 3]);
  assert.equal(hpLost(world, goblin.id), 15, "the frost answers the hit as it lands");
  world.dice(8);
  const words = await world.invoke("use_reaction", { characterId: bard.id, feature: "Cutting Words", targetCharacterId: lock.id });
  world.clearDice();
  assert.equal(words.ok, true, words.error);
  // 14 - 8 against AC 12 misses.
  assert.equal(hpLost(world, goblin.id), 0, JSON.stringify(words.result));
  assert.equal(world.sheet(lock.id).tempHp, 15, "the temporary hit points are whole again");
  assert.match(JSON.stringify(words.result), /Armor of Agathys/, "the GM is told the frost is taken back");
});

await test("S20: a fiend whose hit Cutting Words turns into a miss is not left blinded by Holy Aura", async () => {
  const { world, sheets: [cleric, bard], enemies: [imp] } = await table([caster("cleric", "wis", ["Holy Aura"], [], 15), loreBard], 1, { type: "fiend" });
  world.patch(cleric.id, { equipment: [...world.sheet(cleric.id).equipment, { name: "Reliquary", qty: 1, worth: 1000 }] });
  const cast = await world.invoke("cast_buff", { characterId: cleric.id, spell: "Holy Aura", targetCharacterIds: [cleric.id], level: 8 });
  assert.equal(cast.ok, true, cast.error);
  world.patch(cleric.id, { ac: 12, acOverride: true });
  world.patch(bard.id, { resources: { ...world.sheet(bard.id).resources, bardic_inspiration: { max: 3, used: 0 } } });
  // The swing at disadvantage (10, 10), its damage, the cleric's concentration
  // save with the aura's advantage, then the imp's CON save, failed.
  await swingAt(world, imp, cleric, [10, 10, 3, 20, 20, 1]);
  assert.ok(world.enemies().find((entry) => entry.id === imp.id).conditions.includes("blinded"), "the aura blinds it as the hit lands");
  world.dice(8);
  const words = await world.invoke("use_reaction", { characterId: bard.id, feature: "Cutting Words", targetCharacterId: cleric.id });
  world.clearDice();
  assert.equal(words.ok, true, words.error);
  assert.ok(!world.enemies().find((entry) => entry.id === imp.id).conditions.includes("blinded"), JSON.stringify(words.result));
});

await test("S20: an answer is read off the creature before and after it, and taken back within the body that lost it", async () => {
  const { retortOf, joinRetorts, retortBack } = await import("../src/lib/dm/retort-logic.ts");
  const at = (currentHp, conditions = [], extra = {}) => ({ currentHp, maxHp: 30, status: "alive", conditions, conditionMeta: {}, ...extra });
  const frost = retortOf("g", at(30), at(15), ["Armor of Agathys"]);
  const blind = retortOf("g", at(15), at(15, ["blinded"]), ["Holy Aura"]);
  assert.equal(retortOf("g", at(30), at(30), ["Fire Shield"]), null, "an answer that did nothing keeps nothing");
  const both = joinRetorts(frost, blind);
  assert.deepEqual([both.hp, both.by, both.laid], [15, ["Armor of Agathys", "Holy Aura"], ["blinded"]]);
  // Hit for 5 more since: it gets the 15 back, from 10, and sees again.
  assert.deepEqual(retortBack(at(10, ["blinded"]), both), { currentHp: 25, conditions: [], conditionMeta: {}, hp: 15 });
  assert.equal(retortBack(at(10, [], { maxHp: 12 }), frost), null, "a body that changed since is not given another's hit points");
  assert.equal(retortBack(at(0, [], { status: "dead" }), { ...frost, fell: true }), null, "a slain creature stays slain");
  // Oil the flame burnt off comes back with its meta.
  const oil = retortOf("g", at(30, ["covered in oil"], { conditionMeta: { "covered in oil": { rounds: 10 } } }), at(17), ["Fire Shield"]);
  assert.deepEqual(retortBack(at(17), oil).conditionMeta, { "covered in oil": { rounds: 10 } });
});

await test("S20: on physical dice the held attack lands Fire Shield's flame once, and Shield still takes it back", async () => {
  const { world, mage, goblin } = await flameWizard({ gameSettings: { dicePolicy: "real_allowed" } });
  // A hit on a concentrating wizard asks a CON save, which the seat rolls.
  world.patch(mage.id, { concentratingOn: "Detect Magic" });
  setMemberRealDice(world.campaignId, mage.userId, true);
  const swing = await swingAt(world, goblin, mage, [10, 3, 4, 4]);
  assert.equal(swing.result?.parked, true, JSON.stringify(swing.result));
  assert.equal(hpLost(world, goblin.id), 0, "nothing lands while the save waits");
  const [card] = listOpenPendingRolls(world.campaignId).filter((pending) => pending.userId === mage.userId);
  assert.ok(card, "the save is the seat's to roll");
  world.dice(4, 4);
  world.signIn({ id: mage.userId });
  const entered = await routeCall(await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"), "POST", { dice: [15] }, { campaignId: world.campaignId, pendingRollId: card.id });
  world.clearDice();
  assert.equal(entered.status, 200, JSON.stringify(entered.json));
  assert.equal(hpLost(world, goblin.id), 8, "the call run again deals the flame once");
  setMemberRealDice(world.campaignId, mage.userId, false);
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  assert.equal(hpLost(world, goblin.id), 0, JSON.stringify(shield.result));
});

// ---- S21: an opportunity attack meets the answers enemy_attack meets ----

// An opportunity attack is a melee attack (SRD 5.1, Opportunity Attacks), so
// what answers a creature that hits in melee answers it: Armor of Agathys "If
// a creature hits you with a melee attack while you have these hit points",
// Thought Shield "whenever a creature deals psychic damage to you", Flames of
// Phlegethos. The server's opportunity attack called the spells' answer with
// no temporary hit points (so the frost never bit), dropped its line (so the
// GM never heard of Fire Shield's flame), and never called Thought Shield or
// a feature's retaliation at all.
const { resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");

async function leaver(hero, stats = {}) {
  const { world, sheets: [sheet], enemies: [goblin] } = await table([hero], 1, stats);
  await layMap(world, field(), { [sheet.id]: { x: 2, y: 2 }, [goblin.id]: { x: 3, y: 2 } });
  world.patch(sheet.id, { ac: 12, acOverride: true });
  const walk = (faces) => {
    world.dice(...faces);
    const out = resolveOpportunityAttacks(world.campaign(), sheet.id, { x: 2, y: 2 }, { x: 0, y: 2 }, false, [{ x: 1, y: 2 }, { x: 0, y: 2 }]);
    world.clearDice();
    return out;
  };
  return { world, sheet, goblin, walk };
}

await test("S21: a creature whose opportunity attack hits an Armor of Agathys cast at 3rd takes its 15 cold, and the GM is told", async () => {
  const { world, sheet, goblin, walk } = await leaver(caster("warlock", "cha", [], ["Eldritch Blast"], 5, { spellcasting: { known: ["Armor of Agathys"], slots: { 3: { max: 2, used: 0 } } } }));
  const armored = await world.invoke("cast_buff", { characterId: sheet.id, spell: "Armor of Agathys", level: 3 });
  assert.equal(armored.ok, true, armored.error);
  const out = walk([15, 3]);
  assert.equal(world.sheet(sheet.id).tempHp, 10, JSON.stringify(out.notes));
  assert.equal(hpLost(world, goblin.id), 15, JSON.stringify(out.notes));
  assert.match(out.notes.join(" "), /Armor of Agathys/);
});

await test("S21: a creature whose opportunity attack deals a Thought Shield warlock psychic damage takes the same", async () => {
  const { world, sheet, goblin, walk } = await leaver(
    { class: "warlock", level: 10, abilities: { cha: 16 }, features: [{ name: "Thought Shield", source: "choice" }] },
    { attacks: [{ name: "Mind Lash", toHit: 4, damage: "1d6+2", type: "psychic" }] },
  );
  const out = walk([15, 3]);
  const took = world.sheet(sheet.id).maxHp - world.sheet(sheet.id).currentHp;
  assert.ok(took > 0, JSON.stringify(out.notes));
  assert.equal(hpLost(world, goblin.id), took, JSON.stringify(out.notes));
});

await test("S21: Fire Shield's flame on an opportunity attack reaches the GM, and a Shield that turns the hit away takes it back", async () => {
  const { world, sheet, goblin, walk } = await leaver(caster("wizard", "int", ["Fire Shield", "Shield"]));
  const cast = await world.invoke("cast_buff", { characterId: sheet.id, spell: "Fire Shield", variant: "fire shield (cold)", level: 4 });
  assert.equal(cast.ok, true, cast.error);
  const out = walk([10, 3, 4, 4]);
  assert.match(out.notes.join(" "), /Fire Shield/);
  assert.equal(hpLost(world, goblin.id), 8);
  const shield = await world.invoke("use_reaction", { characterId: sheet.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  assert.equal(hpLost(world, goblin.id), 0, JSON.stringify(shield.result));
});

await test("S21: a creature whose opportunity attack hits a tiefling wreathed in Flames of Phlegethos takes the 1d4 fire", async () => {
  const { world, sheet, goblin, walk } = await leaver({ class: "fighter", level: 5, abilities: { str: 16 } });
  world.patch(sheet.id, { conditions: ["flames of phlegethos"] });
  const out = walk([15, 3, 4]);
  assert.equal(hpLost(world, goblin.id), 4, JSON.stringify(out.notes));
});

// ---- S22: what a hit lays on its target goes with the hit ----

// A creature's "Hit:" text is what the hit does (SRD 5.1, Attack Rolls: on a
// hit the attack's effects apply): a wolf's "If the target is a creature, it
// must succeed on a DC 11 Strength saving throw or be knocked prone", a
// constrictor's grapple, a spider's poison. A swing Shield or Cutting Words
// turns into a miss did none of it. The refund gave back the rider's damage
// and left the wizard prone, the fighter grappled.
const WOLF = { attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing", mode: "melee", onHit: { save: "str", dc: 11, condition: "prone" } }] };
const SNAKE = { attacks: [{ name: "Constrict", toHit: 4, damage: "1d8+2", type: "bludgeoning", mode: "melee", onHit: { condition: "grappled", escapeDc: 14, alsoCondition: "restrained" } }] };

async function bittenWizard(stats) {
  const { world, sheets: [mage], enemies: [beast] } = await table([caster("wizard", "int", ["Shield"])], 1, stats);
  world.patch(mage.id, { ac: 12, acOverride: true });
  return { world, mage, beast };
}

await test("S22: a wolf's bite Shield turns into a miss leaves the wizard standing, not prone", async () => {
  const { world, mage, beast } = await bittenWizard(WOLF);
  // 10 + 4 against AC 12, 2d4 of 1 and 1, the STR save a 1.
  await swingAt(world, beast, mage, [10, 1, 1, 1]);
  assert.ok(world.sheet(mage.id).conditions.includes("prone"), "the bite knocks the wizard down as it lands");
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  assert.ok(!world.sheet(mage.id).conditions.includes("prone"), JSON.stringify(shield.result));
});

await test("S22: a constrictor's hit Shield turns into a miss holds no one: not grappled, not restrained", async () => {
  const { world, mage, beast } = await bittenWizard(SNAKE);
  await swingAt(world, beast, mage, [10, 1]);
  assert.ok(world.sheet(mage.id).conditions.includes("grappled"));
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  const after = world.sheet(mage.id).conditions;
  assert.ok(!after.includes("grappled") && !after.includes("restrained"), JSON.stringify(after));
});

await test("S22: a Life Drain Shield turns into a miss drains nothing: the wizard's maximum and hit points are whole", async () => {
  const { world, mage, beast } = await bittenWizard({ attacks: [{ name: "Life Drain", toHit: 8, damage: "2d10", type: "necrotic", mode: "melee", onHit: { save: "con", dc: 13, drainMaxHp: "total" } }] });
  const full = world.sheet(mage.id).maxHp;
  // 5 + 8 against AC 12 hits for 3 + 3; the CON save a 1.
  await swingAt(world, beast, mage, [5, 3, 3, 1]);
  assert.ok(world.sheet(mage.id).conditions.some((name) => /max hp reduced/.test(name)), "the drain lands with the hit");
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  const after = world.sheet(mage.id);
  assert.ok(!after.conditions.some((name) => /max hp reduced/.test(name)), JSON.stringify(after.conditions));
  assert.equal(after.currentHp, full, "healed to the maximum the drain no longer lowers");
});

await test("S22: a rider's mark is its own conditions and the drain it raised, and comes off as it went on", async () => {
  const { riderMarkOf, ridersBack } = await import("../src/lib/dm/retort-logic.ts");
  const was = { conditions: ["blessed", "max hp reduced (-5)"], conditionMeta: { "max hp reduced (-5)": { source: "w1", untilLongRest: true } } };
  const now = { conditions: ["blessed", "unconscious", "prone", "poisoned", "max hp reduced (-12)"], conditionMeta: { "max hp reduced (-12)": { source: "w2", untilLongRest: true } } };
  // The drop's unconscious and prone are the refund's to undo, not the rider's.
  const mark = riderMarkOf(was, now, ["poisoned"]);
  assert.deepEqual(mark, { laid: ["poisoned", "max hp reduced (-12)"], ended: [{ name: "max hp reduced (-5)", meta: { source: "w1", untilLongRest: true } }] });
  assert.deepEqual(ridersBack({ conditions: ["blessed", "poisoned", "max hp reduced (-12)"], conditionMeta: now.conditionMeta }, [mark]), was);
});

await test("S22: a bite that still hits through Shield keeps the wizard prone", async () => {
  const { world, mage, beast } = await bittenWizard(WOLF);
  await swingAt(world, beast, mage, [19, 1, 1, 1]);
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  assert.ok(world.sheet(mage.id).conditions.includes("prone"));
});

// ---- S23: Thought Shield gives back what the warlock took, after the reaction ----

// SRD 5.1, Thought Shield: "whenever a creature deals psychic damage to you,
// that creature takes the same amount of damage that you do." A reaction that
// only lessens the blow (Uncanny Dodge's half, Cutting Words off the damage)
// lessens what the warlock took, so it lessens what goes back. The refund gave
// the warlock back the halved part and left the creature the full psychic.
const MIND_LASH = { attacks: [{ name: "Mind Lash", toHit: 4, damage: "1d6+2", type: "psychic" }] };
const thinker = (features = []) => ({ class: "warlock", level: 10, abilities: { cha: 16 }, features: [{ name: "Thought Shield", source: "choice" }, ...features] });

await test("S23: an Uncanny Dodge that halves a psychic blow on a Thought Shield warlock halves the psychic the creature takes back", async () => {
  const { world, sheets: [lock], enemies: [goblin] } = await table([thinker([{ name: "Uncanny Dodge", source: "choice" }])], 1, MIND_LASH);
  world.patch(lock.id, { ac: 12, acOverride: true });
  // 15 + 4 hits for 6 + 2 = 8 psychic, which the shield's resistance halves to 4.
  await swingAt(world, goblin, lock, [15, 6]);
  assert.equal(hpLost(world, goblin.id), 4, "the creature takes the 4 the warlock took");
  const dodge = await world.invoke("use_reaction", { characterId: lock.id, feature: "Uncanny Dodge" });
  assert.equal(dodge.ok, true, dodge.error);
  // 8 halved to 4, and the resistance halves that to 2.
  const after = world.sheet(lock.id);
  assert.equal(after.maxHp - after.currentHp, 2, JSON.stringify(dodge.result));
  assert.equal(hpLost(world, goblin.id), 2, JSON.stringify(dodge.result));
  assert.match(JSON.stringify(dodge.result), /Thought Shield/, "the GM is told the creature gets some back");
});

await test("S23: Cutting Words off the damage of a psychic critical lessens Thought Shield's answer the same", async () => {
  const { world, sheets: [lock, bard], enemies: [goblin] } = await table([thinker(), loreBard], 1, MIND_LASH);
  world.patch(lock.id, { ac: 12, acOverride: true });
  world.patch(bard.id, { resources: { ...world.sheet(bard.id).resources, bardic_inspiration: { max: 3, used: 0 } } });
  // A natural 20 that Cutting Words cannot turn: its die comes off the
  // damage instead. 2d6 of 6s + 2 = 14, halved by the resistance to 7; less
  // the die's 1, 13 halved to 6.
  await swingAt(world, goblin, lock, [20, 6, 6]);
  assert.equal(hpLost(world, goblin.id), 7);
  world.dice(1);
  const words = await world.invoke("use_reaction", { characterId: bard.id, feature: "Cutting Words", targetCharacterId: lock.id });
  world.clearDice();
  assert.equal(words.ok, true, words.error);
  const after = world.sheet(lock.id);
  assert.equal(hpLost(world, goblin.id), after.maxHp - after.currentHp, JSON.stringify(words.result));
});

// ---- S24: a bite a reaction turns into a miss swallows no one ----

// SRD 5.1, Behir, Swallow: "If the attack hits, the target is also
// swallowed, and the grapple ends"; the purple worm's bite, the giant toad's
// and frog's the same. A bite Shield turns into a miss never hit, so it
// swallowed no one and ended no grapple. The refund gave the bite's hit points
// back and left the wizard inside the behir, blinded and restrained.
const fsModule = await import("node:fs");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { readPage, rowOfBlock } = await import("./lib/srd-bestiary.mjs");
const srdBook = JSON.parse(fsModule.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
function srdBlock(title) {
  const page = srdBook.pages.find((entry) => entry.title === title && entry.kind === "monster");
  const parsed = parseMonster(rowOfBlock(title, readPage(page.md)));
  return parsed.stats ?? parsed;
}

async function behirGrips() {
  const { world, sheets: [mage], enemies: [behir] } = await table([caster("wizard", "int", ["Shield"])], 1, srdBlock("Behir"));
  world.patch(mage.id, { ac: 12, acOverride: true, conditions: ["grappled"], conditionMeta: { grappled: { source: behir.id, escapeDc: 16 } } });
  const swallow = async (faces) => {
    world.dice(...faces);
    const out = await world.invoke("enemy_attack", { enemyId: behir.id, targetCharacterId: mage.id, attack: "Swallow" });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    return out;
  };
  return { world, mage, behir, swallow };
}

await test("S24: a behir's Swallow that Shield turns into a miss swallows no one: out, seeing, free to move, and held in its grapple again", async () => {
  const { world, mage, behir, swallow } = await behirGrips();
  // 3 + 10 against AC 12 hits; Shield's 17 is missed.
  const bitten = await swallow([3, 1, 1, 1]);
  assert.ok(world.sheet(mage.id).conditions.includes("swallowed"), JSON.stringify(bitten.result));
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  const after = world.sheet(mage.id);
  for (const name of ["swallowed", "blinded", "restrained"]) {
    assert.ok(!after.conditions.includes(name), `no longer ${name}: ${JSON.stringify(after.conditions)} ${JSON.stringify(shield.result)}`);
  }
  assert.ok(after.conditions.includes("grappled"), "the grapple the bite ended holds again");
  assert.equal(after.conditionMeta.grappled?.source, behir.id);
  assert.equal(after.currentHp, after.maxHp);
  assert.match(JSON.stringify(shield.result), /swallowed/, "the GM is told the wizard is out");
});

await test("S24: a grapple the wizard held, which the swallow ended, holds again when Shield turns the bite into a miss", async () => {
  const { world, sheets: [mage], enemies: [behir, held] } = await table([caster("wizard", "int", ["Shield"])], 2, srdBlock("Behir"));
  world.patch(mage.id, { ac: 12, acOverride: true, conditions: ["grappled"], conditionMeta: { grappled: { source: behir.id } } });
  encounterRows.patchEnemyConditions(held.id, ["grappled"], { grappled: { source: mage.id } });
  world.dice(3, 1, 1, 1);
  const bitten = await world.invoke("enemy_attack", { enemyId: behir.id, targetCharacterId: mage.id, attack: "Swallow" });
  world.clearDice();
  assert.equal(bitten.ok, true, bitten.error);
  assert.ok(!world.enemies().find((entry) => entry.id === held.id).conditions.includes("grappled"), "swallowed, the wizard lets go");
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  const foe = world.enemies().find((entry) => entry.id === held.id);
  assert.ok(foe.conditions.includes("grappled"), JSON.stringify(shield.result));
  assert.equal(foe.conditionMeta.grappled?.source, mage.id);
});

await test("S24: a Swallow that still hits through Shield keeps the wizard inside", async () => {
  const { world, mage, swallow } = await behirGrips();
  await swallow([19, 1, 1, 1]);
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  assert.ok(world.sheet(mage.id).conditions.includes("swallowed"));
});

// ---- S25: Armor of Agathys reads the temporary hit points at each swing ----

// SRD 5.1, Armor of Agathys: "If a creature hits you with a melee attack
// while you have these hit points, the creature takes 5 cold damage" (more
// from a higher slot). Each swing is its own hit. When a reaction turns away
// the swing that used the hit points up, the next swing that still hits meets
// them, and the frost answers it; the refund gave the hit points back and
// left that swing unanswered.
const MAULER = { attacks: [{ name: "Maul", toHit: 4, damage: "2d6+10", type: "bludgeoning" }], attacksPerTurn: 2 };

await test("S25: when Cutting Words turns away the swing that took Armor of Agathys's hit points, the next swing that still hits is frozen", async () => {
  const { world, sheets: [lock, bard], enemies: [ogre] } = await table([
    caster("warlock", "cha", [], ["Eldritch Blast"], 5, { spellcasting: { known: ["Armor of Agathys"], slots: { 3: { max: 2, used: 0 } } } }),
    loreBard,
  ], 1, MAULER);
  const armored = await world.invoke("cast_buff", { characterId: lock.id, spell: "Armor of Agathys", level: 3 });
  assert.equal(armored.ok, true, armored.error);
  world.patch(lock.id, { ac: 12, acOverride: true });
  world.patch(bard.id, { resources: { ...world.sheet(bard.id).resources, bardic_inspiration: { max: 3, used: 0 } } });
  // The first maul: 10 + 4 hits for 6 + 6 + 10 = 22, through all 15
  // temporary hit points, and is frozen; the second, 19 + 4, hits for 12 with
  // none left, and is not.
  const swing = await swingAt(world, ogre, lock, [10, 6, 6, 19, 1, 1]);
  assert.equal(hpLost(world, ogre.id), 15, JSON.stringify(swing.result));
  world.dice(8);
  const words = await world.invoke("use_reaction", { characterId: bard.id, feature: "Cutting Words", targetCharacterId: lock.id });
  world.clearDice();
  assert.equal(words.ok, true, words.error);
  // 14 - 8 misses the first; the second now lands in the 15 temporary hit
  // points, and the frost answers it.
  assert.equal(world.sheet(lock.id).tempHp, 3, JSON.stringify(words.result));
  assert.equal(hpLost(world, ogre.id), 15, JSON.stringify(words.result));
  assert.match(JSON.stringify(words.result), /Armor of Agathys/);
});

// ---- S26: an answer that would slay its attacker waits on the reaction ----

// The lead's ruling on S20's product decision. SRD 5.1 decides Shield
// ("including against the triggering attack") and Cutting Words ("before the
// GM determines whether the attack roll succeeds") before the hit does
// anything, and a creature that never hit takes no flame. The engine lands
// the answer with the hit and never raises a creature it slew, so a goblin
// Fire Shield burnt to death stayed dead when Shield then turned the blow
// into a miss. An answer that would slay now waits while a reaction could
// still turn the swing, and lands when the hit is settled.
async function lowGoblin(hp, faces) {
  // Two goblins, so the first one's fall does not end the fight.
  const { world, sheets: [mage], enemies: [goblin, other] } = await table([caster("wizard", "int", ["Fire Shield", "Shield"])], 2);
  const cast = await world.invoke("cast_buff", { characterId: mage.id, spell: "Fire Shield", variant: "fire shield (cold)", level: 4 });
  assert.equal(cast.ok, true, cast.error);
  world.patch(mage.id, { ac: 12, acOverride: true });
  encounterRows.patchEnemyHp(goblin.id, hp, "alive");
  const swing = await swingAt(world, goblin, mage, faces);
  return { world, mage, goblin, other, swing };
}
const statusOf = (world, id) => world.enemies().find((entry) => entry.id === id);

await test("S26: Fire Shield's flame that would slay waits while the wizard can still cast Shield, and Shield turning the blow leaves the goblin unburnt", async () => {
  // 10 + 4 against AC 12 hits; the shield's 2d8 of 4 and 4 would slay a
  // goblin at 5, and Shield's 17 would turn the 14.
  const { world, mage, goblin, swing } = await lowGoblin(5, [10, 3, 4, 4]);
  assert.equal(statusOf(world, goblin.id).status, "alive", JSON.stringify(swing.result));
  assert.equal(statusOf(world, goblin.id).currentHp, 5);
  assert.match(JSON.stringify(swing.result), /Fire Shield would slay .* lands once the hit stands/);
  const shield = await world.invoke("use_reaction", { characterId: mage.id, feature: "Shield" });
  assert.equal(shield.ok, true, shield.error);
  assert.equal(world.sheet(mage.id).currentHp, world.sheet(mage.id).maxHp, "the blow is turned away");
  assert.deepEqual([statusOf(world, goblin.id).status, statusOf(world, goblin.id).currentHp], ["alive", 5], JSON.stringify(shield.result));
  assert.match(JSON.stringify(shield.result), /Fire Shield never came/);
});

await test("S26: with no reaction taken, the waiting flame lands as the next call of a later GM turn begins, and the goblin falls", async () => {
  const { world, goblin, other } = await lowGoblin(5, [10, 3, 4, 4]);
  assert.equal(statusOf(world, goblin.id).status, "alive");
  const next = await world.invoke("apply_damage", { enemyId: other.id, amount: 1, reason: "the next thing done" });
  assert.equal(next.ok, true, next.error);
  assert.equal(statusOf(world, goblin.id).status, "dead", JSON.stringify(next.result));
  assert.match(JSON.stringify(next.result.answersLanded ?? []), /Fire Shield lands now that the hit stands/);
});

await test("S26: a flame that would slay lands at once when no reaction could turn the hit", async () => {
  // 19 + 4 = 23 beats Shield's 17.
  const { world, goblin } = await lowGoblin(5, [19, 3, 4, 4]);
  assert.equal(statusOf(world, goblin.id).status, "dead");
});

await test("S26: Thought Shield's psychic that waits on an ally's Cutting Words lands at what the warlock took after Uncanny Dodge halved the blow", async () => {
  const { world, sheets: [lock, bard], enemies: [goblin, other] } = await table([thinker([{ name: "Uncanny Dodge", source: "choice" }]), loreBard], 2, MIND_LASH);
  world.patch(lock.id, { ac: 12, acOverride: true });
  world.patch(bard.id, { resources: { ...world.sheet(bard.id).resources, bardic_inspiration: { max: 3, used: 0 } } });
  encounterRows.patchEnemyHp(goblin.id, 3, "alive");
  // 15 + 4 hits for 8 psychic, 4 taken: enough to slay a goblin at 3, and
  // the bard's 8 off the 19 could still turn it, so it waits.
  await swingAt(world, goblin, lock, [15, 6]);
  assert.equal(statusOf(world, goblin.id).currentHp, 3);
  const dodge = await world.invoke("use_reaction", { characterId: lock.id, feature: "Uncanny Dodge" });
  assert.equal(dodge.ok, true, dodge.error);
  // Halved to 4, 2 taken: the goblin at 3 takes 2 once the hit stands.
  const next = await world.invoke("apply_damage", { enemyId: other.id, amount: 1, reason: "the next thing done" });
  assert.equal(next.ok, true, next.error);
  assert.deepEqual([statusOf(world, goblin.id).status, statusOf(world, goblin.id).currentHp], ["alive", 1], JSON.stringify(next.result));
});

await test("S26: Armor of Agathys's cold that would slay waits on an ally's Cutting Words, and the words turning the hit leave the goblin alive", async () => {
  const { world, sheets: [lock, bard], enemies: [goblin] } = await table([
    caster("warlock", "cha", [], ["Eldritch Blast"], 5, { spellcasting: { known: ["Armor of Agathys"], slots: { 3: { max: 2, used: 0 } } } }),
    loreBard,
  ], 2);
  const armored = await world.invoke("cast_buff", { characterId: lock.id, spell: "Armor of Agathys", level: 3 });
  assert.equal(armored.ok, true, armored.error);
  world.patch(lock.id, { ac: 12, acOverride: true });
  world.patch(bard.id, { resources: { ...world.sheet(bard.id).resources, bardic_inspiration: { max: 3, used: 0 } } });
  encounterRows.patchEnemyHp(goblin.id, 10, "alive");
  // 10 + 4 hits; the 15 cold would slay a goblin at 10, and an 8 off the 14 turns it.
  await swingAt(world, goblin, lock, [10, 3]);
  assert.equal(statusOf(world, goblin.id).status, "alive");
  world.dice(8);
  const words = await world.invoke("use_reaction", { characterId: bard.id, feature: "Cutting Words", targetCharacterId: lock.id });
  world.clearDice();
  assert.equal(words.ok, true, words.error);
  assert.deepEqual([statusOf(world, goblin.id).status, statusOf(world, goblin.id).currentHp], ["alive", 10], JSON.stringify(words.result));
});

closeTables();
finish();
