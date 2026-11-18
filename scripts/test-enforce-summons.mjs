// Spells and features that make a creature (src/lib/dm/summon-*.ts): the
// creature arrives as an ally with its SRD 5.1 stat block, on the board and in
// the initiative order, fights with its own numbers, and goes when the spell
// or its hit points do.
//
// The rules, from SRD 5.1:
//   - Conjure Animals: one beast of challenge rating 2 or lower, two of 1 or
//     lower, four of 1/2 or lower, or eight of 1/4 or lower; twice as many
//     from a 5th level slot, three times from 7th, four times from 9th. The
//     same shape for Conjure Woodland Beings (fey) and Conjure Minor
//     Elementals (elementals). Concentration, up to an hour; the creatures
//     roll initiative as a group and act on their own turns.
//   - Conjure Elemental and Conjure Fey: one creature; when concentration
//     breaks it does not vanish but turns hostile.
//   - Animate Dead: one skeleton or zombie, two more for each slot level above
//     3rd, under control for 24 hours (no concentration).
//   - Giant Insect: ten centipedes, three spiders, five wasps or one scorpion.
//   - Find Steed: one steed (warhorse, pony, camel, elk, mastiff) with an
//     Intelligence of at least 6; one at a time.
//   - Animate Objects: ten objects (Medium count as two, Large four, Huge
//     eight), two more per slot level above 5th, with the spell's own table.
//   - A summoned creature reduced to 0 hit points disappears.
//   - Durable Summons: creatures a conjurer summons have 30 temporary hit
//     points.
//
// Every check reads a sheet, the encounter row, the board, an enemy row or a
// refusal; dice are forced.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables, enemyOf } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { board, holdTurn, mapOf, OPEN, place, tokenOf } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { sideOf } = await import("../src/lib/dm/combatant.ts");
const { test, finish } = suite("test-enforce-summons");
const { listTokens } = await import("../src/lib/db/battle-maps.ts");
const { getMounts } = await import("../src/lib/db/mounts.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { setSheetSummon } = await import("../src/lib/db/sheets.ts");

const summonsOf = (world, spell) =>
  world.sheets().filter((sheet) => sheet.summon && (!spell || sheet.summon.spell === spell));
const slotsLeft = (world, id, level) => {
  const slot = world.sheet(id).spellcasting.slots[String(level)];
  return slot.max - slot.used;
};
const DRUID = (spells, level = 5) => caster("druid", "wis", spells, [], level);
const WIZARD = (spells, level = 9, extra = {}) => caster("wizard", "int", spells, [], level, extra);

// A spell with a casting time of a minute or more is cast out of a fight (the
// engine refuses it in one, as the rules do): the heroes cast first, then a
// fight starts on an open board with everyone placed.
async function outOfFight(heroes) {
  const world = await openWorld();
  const sheets = heroes.map((hero) => world.addHero(hero));
  return { world, sheets };
}
async function thenFight(world, casterId) {
  const enemies = await fightDummies(world, 1, { heroFaces: { [casterId]: 20 } });
  castOnOwnTurn(world);
  const positions = {};
  world.sheets().forEach((sheet, index) => {
    positions[sheet.id] = { x: 1 + (index % 6), y: 1 + Math.floor(index / 6) };
  });
  enemies.forEach((enemy, index) => {
    positions[enemy.id] = { x: 22 - index, y: 8 };
  });
  await layMap(world, OPEN(), positions);
  return enemies;
}

await test("Conjure Animals from a 3rd level slot brings eight creatures of challenge rating 1/4, each an ally with the SRD stat block of its kind, on the board and in the initiative order, rolling initiative as one group.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  assert.equal(cast.ok, true, cast.error);
  const wolves = summonsOf(world, "Conjure Animals");
  assert.equal(wolves.length, 8, "eight wolves from a 3rd level slot");
  for (const wolf of wolves) {
    assert.equal(wolf.maxHp, 11);
    assert.equal(wolf.ac, 13);
    assert.equal(wolf.abilities.dex, 15);
    assert.equal(wolf.summon.casterId, druid.id);
    assert.ok(tokenOf(world, wolf.id), "every wolf has a token");
  }
  const entries = world.encounter().order.filter((entry) => wolves.some((wolf) => wolf.id === entry.characterId));
  assert.equal(entries.length, 8, "every wolf has an initiative entry");
  assert.equal(new Set(entries.map((entry) => entry.initiative)).size, 1, "one group roll");
  assert.equal(slotsLeft(world, druid.id, 3), 1);
});

await test("Conjure Animals with a beast of challenge rating 1 brings two; from a 5th level slot twice as many.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"], 9)], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 5, variant: "brown bear" });
  assert.equal(cast.ok, true, cast.error);
  const bears = summonsOf(world, "Conjure Animals");
  assert.equal(bears.length, 4);
  assert.equal(bears[0].maxHp, 34);
});

await test("Conjure Animals refuses, before the slot, a beast above challenge rating 2 and a creature that is not a beast.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  const ape = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "giant ape" });
  assert.equal(ape.ok, false);
  const skeleton = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "skeleton" });
  assert.equal(skeleton.ok, false);
  assert.match(skeleton.error, /beast/i);
  // No creature named, or one with no stat block: the question names what
  // the casting can call, with its challenge rating; a giant elk is no Elk.
  const unnamed = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3 });
  assert.equal(unnamed.ok, false);
  assert.match(unnamed.error, /needs the creature in variant: .*Wolf \(CR 1\/4\).*Brown Bear \(CR 1\).*Ask the player which/);
  assert.doesNotMatch(unnamed.error, /Giant Ape|Skeleton/);
  const hamster = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "giant hamster" });
  assert.equal(hamster.ok, false);
  assert.match(hamster.error, /no stat block here for "giant hamster"; it calls: .*Wolf.*Giant Elk \(CR 2\)/);
  assert.equal(slotsLeft(world, druid.id, 3), 2, "no slot spent");
  assert.equal(summonsOf(world).length, 0);
});

await test("A summoning spell spent through use_spell_slot alone would leave its creatures to be invented: it is refused before the slot, naming cast_buff.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Conjure Animals", level: 3 });
  assert.equal(cast.ok, false);
  assert.match(cast.error, /cast_buff/);
  assert.equal(slotsLeft(world, druid.id, 3), 2);
});

await test("A summoned wolf attacks with its bite's own numbers: +4 to hit and 2d4+2 piercing.", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await board([DRUID(["Conjure Animals"])], { 0: { x: 3, y: 4 }, e0: { x: 10, y: 4 } });
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  const [wolf] = summonsOf(world, "Conjure Animals");
  place(world, wolf.id, 9, 4);
  holdTurn(world, wolf.id);
  world.dice(9, 3, 3);
  const out = await world.invoke("pc_attack", { characterId: wolf.id, targetEnemyId: goblin.id, weapon: "Bite" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(enemyOf(world, goblin.id).currentHp, 90 - 8, "9 + 4 hits AC 13 and 2d4+2 lands");
});

await test("A summoned creature with Multiattack makes that many attacks with its Attack action (a giant scorpion: three).", async () => {
  const { world, sheets: [druid], enemies: [goblin] } = await board([DRUID(["Giant Insect"], 7)], { 0: { x: 3, y: 4 }, e0: { x: 10, y: 4 } });
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Giant Insect", level: 4, variant: "giant scorpion" });
  assert.equal(cast.ok, true, cast.error);
  const [scorpion] = summonsOf(world, "Giant Insect");
  place(world, scorpion.id, 9, 4);
  holdTurn(world, scorpion.id);
  // One turn, held: the plain call, so the turn's budget carries from one
  // attack to the next.
  for (const weapon of ["Claw", "Claw", "Sting"]) {
    world.dice(1);
    const out = await world.invokeAsIs("pc_attack", { characterId: scorpion.id, targetEnemyId: goblin.id, weapon });
    world.clearDice();
    assert.equal(out.ok, true, `${weapon}: ${out.error}`);
  }
  world.dice(1);
  const fourth = await world.invokeAsIs("pc_attack", { characterId: scorpion.id, targetEnemyId: goblin.id, weapon: "Claw" });
  world.clearDice();
  assert.equal(fourth.ok, false, "a fourth attack in the turn");
});

await test("A summoned creature reduced to 0 hit points disappears: its sheet, token and initiative entry go.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  const [wolf] = summonsOf(world, "Conjure Animals");
  const out = await world.invoke("apply_damage", { characterId: wolf.id, amount: 30, type: "slashing" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(wolf.id), null, "the wolf's sheet is gone");
  assert.equal(listTokens(mapOf(world).id).some((token) => token.refId === wolf.id), false);
  assert.equal(world.encounter().order.some((entry) => entry.characterId === wolf.id), false);
  assert.equal(summonsOf(world, "Conjure Animals").length, 7);
});

await test("When the caster's concentration on a conjuring spell ends, the creatures it conjured vanish.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  assert.equal(world.sheet(druid.id).concentratingOn, "Conjure Animals");
  world.dice(1);
  await world.invoke("apply_damage", { characterId: druid.id, amount: 4, type: "slashing" });
  world.clearDice();
  assert.equal(world.sheet(druid.id).concentratingOn, null);
  assert.equal(summonsOf(world, "Conjure Animals").length, 0);
});

await test("Conjure Elemental: when concentration breaks the elemental does not vanish; it turns hostile, the same sheet fighting on the foes' side where it stood (issue 503).", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Conjure Elemental"])]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Conjure Elemental", level: 5, variant: "fire elemental" });
  assert.equal(cast.ok, true, cast.error);
  await thenFight(world, wizard.id);
  const [elemental] = summonsOf(world, "Conjure Elemental");
  assert.equal(elemental.maxHp, 102);
  const at = tokenOf(world, elemental.id);
  world.dice(1);
  await world.invoke("apply_damage", { characterId: wizard.id, amount: 4, type: "slashing" });
  world.clearDice();
  const hostile = world.sheet(elemental.id);
  assert.ok(hostile, "the elemental keeps its sheet");
  assert.equal(hostile.maxHp, 102);
  assert.equal(hostile.summon.unbound, true, "no longer its maker's");
  assert.equal(sideOf(world.encounter(), "sheet", elemental.id), "foe");
  assert.ok(hostile.conditions.includes("summoned"), "its own hour still counts");
  assert.equal(hostile.conditionMeta.summoned?.spell, undefined, "and no spell of the wizard's ends it");
  const token = tokenOf(world, elemental.id);
  assert.deepEqual([token.x, token.y], [at.x, at.y]);
});

await test("Animate Dead raises one undead from a 3rd level slot and three from a 4th, a skeleton with its SRD numbers, with no concentration.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Animate Dead"])]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Animate Dead", level: 4, variant: "skeleton" });
  assert.equal(cast.ok, true, cast.error);
  const dead = summonsOf(world, "Animate Dead");
  assert.equal(dead.length, 3);
  assert.equal(dead[0].maxHp, 13);
  assert.equal(dead[0].ac, 13);
  assert.equal(world.sheet(wizard.id).concentratingOn, null);
});

await test("Giant Insect makes three giant spiders (or ten centipedes, five wasps, one scorpion).", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Giant Insect"], 7)], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Giant Insect", level: 4, variant: "giant spider" });
  assert.equal(cast.ok, true, cast.error);
  const spiders = summonsOf(world, "Giant Insect");
  assert.equal(spiders.length, 3);
  assert.equal(spiders[0].maxHp, 26);
});

await test("Find Steed makes one steed with an Intelligence of 6; casting it again replaces the first.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([caster("paladin", "cha", ["Find Steed"], [], 5)]);
  const first = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(first.ok, true, first.error);
  const second = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(second.ok, true, second.error);
  const steeds = summonsOf(world, "Find Steed");
  assert.equal(steeds.length, 1);
  assert.equal(steeds[0].abilities.int, 6);
  assert.equal(steeds[0].maxHp, 19);
});

// Mounted Combat (SRD 5.1): "A willing creature that is at least one size
// larger than you and that has an appropriate anatomy can serve as a mount";
// "you can mount a creature that is within 5 feet of you"; "The initiative of
// a controlled mount changes to match yours when you mount it"; "the attacker
// can target you or the mount". The steed Find Steed made is that creature
// (issue 986): one sheet, one set of hit points.
const PALADIN = () => caster("paladin", "cha", ["Find Steed", "Cure Wounds"], [], 5);
const orderIds = (world) => world.encounter().order.map((entry) => entry.characterId ?? entry.enemyId);
async function strikeMount(world, enemy, rider) {
  world.clearDice();
  // A 15 on the d20 hits the warhorse's AC 11; a 3 on the damage die.
  world.dice(15, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: rider.id, targetMount: true });
  world.clearDice();
  // The attack tool answers with the strike under result.
  return out.ok ? { ...out.result, ok: true } : out;
}

await test("Find Steed's steed, mounted by its name from within 5 feet, is the mount ridden: one creature, off the board and out of the order while it carries its maker, hurt by a blow aimed at the mount, healed by a spell sent to the steed, and beside its rider again when they get down.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  const cast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(cast.ok, true, cast.error);
  const [steed] = summonsOf(world, "Find Steed");
  const [enemy] = await thenFight(world, paladin.id);
  assert.ok(orderIds(world).includes(steed.id), "setup: a steed on foot has its own place in the order");
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  place(world, steed.id, 9, 3);
  const far = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(far.ok, false, "a steed 30 feet away was mounted");
  assert.match(far.error, /within 5 feet/);
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined);
  place(world, steed.id, 4, 3);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  const record = getMounts(world.campaignId)[paladin.id];
  assert.equal(record.sheetId, steed.id, "the mount is not the steed's own sheet");
  assert.equal(record.hp, undefined, "the record keeps hit points of its own beside the sheet's");
  assert.equal(record.speed, 60);
  assert.equal(summonsOf(world).length, 1, "mounting made a second creature");
  assert.ok(!tokenOf(world, steed.id), "the ridden steed still stands on a token of its own");
  assert.ok(!orderIds(world).includes(steed.id), "the ridden steed still takes a turn of its own");

  place(world, enemy.id, 3, 4);
  const hit = await strikeMount(world, enemy, paladin);
  assert.equal(hit.ok, true, hit.error);
  const dealt = hit.swings.find((swing) => swing.hit)?.damage;
  assert.ok(dealt > 0, "setup: the blow at the mount missed");
  assert.equal(world.sheet(steed.id).currentHp, 19 - dealt, "the blow aimed at the mount did not land on the steed's sheet");
  assert.equal(world.sheet(paladin.id).currentHp, world.sheet(paladin.id).maxHp, "the blow aimed at the mount landed on the rider");
  assert.equal(hit.mountHp, `${19 - dealt}/19`);

  const healed = await world.invoke("heal", { characterId: steed.id, casterId: paladin.id, spell: "Cure Wounds", level: 1 });
  assert.equal(healed.ok, true, healed.error);
  const mended = world.sheet(steed.id).currentHp;
  assert.ok(mended > 19 - dealt, "healing sent to the steed did not reach it");

  holdTurn(world, paladin.id);
  const down = await world.invoke("dismount", { characterId: paladin.id });
  assert.equal(down.ok, true, down.error);
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined);
  const rider = tokenOf(world, paladin.id);
  const horse = tokenOf(world, steed.id);
  assert.ok(horse, "the steed has no token after its rider got down");
  assert.ok(Math.max(Math.abs(horse.x - rider.x), Math.abs(horse.y - rider.y)) <= 2, "the steed did not come back beside its rider");
  const order = orderIds(world);
  assert.equal(order.indexOf(steed.id), order.indexOf(paladin.id) + 1, "the steed does not act right after its rider");
});

await test("An area that catches the rider catches the steed under them: its failed Dexterity save takes the blast off the steed's own sheet.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const [steed] = summonsOf(world, "Find Steed");
  await thenFight(world, paladin.id);
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  place(world, steed.id, 4, 3);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  // DC 30: no d20 a warhorse rolls reaches it.
  const blast = await world.invoke("aoe_damage", { characterIds: [paladin.id], damage: 10, type: "fire", saveAbility: "dex", dc: 30, halfOnSave: false });
  assert.equal(blast.ok, true, blast.error);
  assert.equal(world.sheet(steed.id).currentHp, 9, "the blast that caught the rider did not take 10 from the steed's 19 hit points");
  assert.equal(getMounts(world.campaignId)[paladin.id]?.sheetId, steed.id, "a steed with hit points left stopped carrying its rider");
});

// The ridden steed's sheet meets a blow as any creature's sheet does: each
// damage type of a two-type bite against its own defenses, and the water of
// the square it shares with its rider ("Creatures and objects that are fully
// immersed in water have resistance to fire damage", SRD 5.1, Underwater
// Combat). The blow at a sheet steed was landed whole as its first type, and
// the steed, off the board while ridden, stood in no water.
async function giveAttacks(world, enemy, attacks) {
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const stats = { ...world.enemies().find((entry) => entry.id === enemy.id).stats, attacks };
  getDatabase().prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?").run(JSON.stringify(stats), enemy.id);
}
async function riddenSteed(rows) {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const [steed] = summonsOf(world, "Find Steed");
  const [enemy] = await thenFight(world, paladin.id);
  await layMap(world, rows ?? OPEN(), { [paladin.id]: { x: 3, y: 3 }, [steed.id]: { x: 4, y: 3 }, [enemy.id]: { x: 3, y: 4 } });
  holdTurn(world, paladin.id);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  return { world, paladin, steed, enemy };
}

await test("A blow aimed at the ridden steed meets the steed's own defenses type by type: a steed immune to poison takes only a bite's piercing.", async () => {
  const { world, paladin, steed, enemy } = await riddenSteed();
  setSheetSummon(steed.id, { ...world.sheet(steed.id).summon, immune: "poison" });
  await giveAttacks(world, enemy, [{ name: "Venom Bite", toHit: 4, damage: "1d6+2d6", type: "piercing/poison" }]);
  world.clearDice();
  // 15 hits AC 11; 3 piercing and 2 + 2 poison.
  world.dice(15, 3, 2, 2);
  const bite = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: paladin.id, targetMount: true });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(world.sheet(steed.id).currentHp, 16, `a steed immune to poison took the bite's poison as piercing: ${JSON.stringify(bite.result?.swings)}`);
});

await test("A ridden steed stands in the water its rider stands in: a blow's fire on it is halved.", async () => {
  const wet = OPEN().map((row, y) => (y === 3 ? `${row.slice(0, 3)}~${row.slice(4)}` : row));
  const swim = await riddenSteed(wet);
  await giveAttacks(swim.world, swim.enemy, [{ name: "Flame Bite", toHit: 4, damage: "2d6", type: "fire" }]);
  swim.world.clearDice();
  swim.world.dice(15, 4, 4);
  const flame = await swim.world.invoke("enemy_attack", { enemyId: swim.enemy.id, targetCharacterId: swim.paladin.id, targetMount: true });
  swim.world.clearDice();
  assert.equal(flame.ok, true, flame.error);
  assert.equal(swim.world.sheet(swim.steed.id).currentHp, 15, `8 fire on a steed in its rider's water was not halved: ${JSON.stringify(flame.result?.swings)}`);
});

// What a hit carries onto a steed with a sheet lands on that sheet: the save
// from the steed's own block, the rider's damage through its defenses once,
// and the condition on the creature. "If your mount is knocked prone, you can
// use your reaction to dismount it as it falls and land on your feet" (SRD
// 5.1, Mounted Combat): the steed is prone where it stands beside its rider.
await test("A bite that knocks the ridden steed prone lays prone on the steed's own sheet, its fire meets the steed's resistance once, and the steed stands prone beside its rider.", async () => {
  const { world, paladin, steed, enemy } = await riddenSteed();
  setSheetSummon(steed.id, { ...world.sheet(steed.id).summon, resist: "fire" });
  await giveAttacks(world, enemy, [{ name: "Bite", toHit: 4, damage: "1d6", type: "piercing", onHit: { save: "str", dc: 11, condition: "prone", damage: "2d6", damageType: "fire" } }]);
  world.clearDice();
  // 15 hits; 2 piercing; a 1 on the steed's Strength save; 4 + 4 fire.
  world.dice(15, 2, 1, 4, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: paladin.id, targetMount: true });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined, `the steed knocked prone kept its rider: ${JSON.stringify(out.result)}`);
  const horse = world.sheet(steed.id);
  assert.equal(horse.currentHp, 19 - 2 - 4, `8 fire on a steed that resists fire did not land as 4: ${JSON.stringify(out.result?.swings)}`);
  assert.ok(horse.conditions.includes("prone"), "the steed knocked prone is not prone on its sheet");
  const rider = tokenOf(world, paladin.id);
  const token = tokenOf(world, steed.id);
  assert.ok(token, "the steed that threw its rider has no token");
  assert.ok(Math.max(Math.abs(token.x - rider.x), Math.abs(token.y - rider.y)) <= 2, "the steed did not come back beside its rider");
});

// A creature called up and ridden whose sheet keeps its form's resistances
// (a water elemental resists acid) meets the rider's damage once: the merged
// door halved it by the form's block and again by the sheet's.
await test("A ridden water elemental takes a bite's acid rider at half, not a quarter, and the bite's nonmagical piercing at half.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Conjure Elemental"])]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Conjure Elemental", level: 5, variant: "water elemental" });
  assert.equal(cast.ok, true, cast.error);
  const [elemental] = summonsOf(world, "Conjure Elemental");
  const [enemy] = await thenFight(world, wizard.id);
  await layMap(world, OPEN(), { [wizard.id]: { x: 3, y: 3 }, [elemental.id]: { x: 4, y: 3 }, [enemy.id]: { x: 3, y: 4 } });
  holdTurn(world, wizard.id);
  const up = await world.invoke("mount_up", { characterId: wizard.id, mount: "Water Elemental" });
  assert.equal(up.ok, true, up.error);
  assert.equal(getMounts(world.campaignId)[wizard.id]?.sheetId, elemental.id);
  const full = world.sheet(elemental.id).currentHp;
  await giveAttacks(world, enemy, [{ name: "Bite", toHit: 9, damage: "1d6", type: "piercing", onHit: { damage: "2d6", damageType: "acid" } }]);
  world.clearDice();
  // 15 hits; 4 piercing; 4 + 4 acid.
  world.dice(15, 4, 4, 4);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: wizard.id, targetMount: true });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(elemental.id).currentHp, full - 2 - 4, `4 piercing and 8 acid on a water elemental: ${JSON.stringify(out.result?.swings)}`);
});

// An area meets the steed's sheet with the blast's own type: a steed immune
// to fire takes nothing of a fireball it fails to dodge.
await test("An area's fire that catches the rider meets the ridden steed's own immunity.", async () => {
  const { world, paladin, steed } = await riddenSteed();
  setSheetSummon(steed.id, { ...world.sheet(steed.id).summon, immune: "fire" });
  const blast = await world.invoke("aoe_damage", { characterIds: [paladin.id], damage: 10, type: "fire", saveAbility: "dex", dc: 30, halfOnSave: false });
  assert.equal(blast.ok, true, blast.error);
  assert.equal(world.sheet(steed.id).currentHp, 19, "a steed immune to fire took the fire of the area");
});

await test("A paladin knocked prone who fails the save falls from the steed, which stands on the board and in the order again.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const [steed] = summonsOf(world, "Find Steed");
  await thenFight(world, paladin.id);
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  place(world, steed.id, 4, 3);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  world.clearDice();
  // A 1 on the DC 10 Dexterity save.
  world.dice(1);
  const prone = await world.invoke("set_condition", { characterId: paladin.id, condition: "prone", reason: "knocked down" });
  world.clearDice();
  assert.equal(prone.ok, true, prone.error);
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined, "the paladin who failed the save still rides");
  assert.ok(tokenOf(world, steed.id), "the steed its rider fell from has no token");
  assert.ok(orderIds(world).includes(steed.id), "the steed its rider fell from has no turn");
});

await test("A steed moved against its will keeps a paladin who makes the save, still ridden and off the board, and one who fails it is thrown and the steed stands beside them again.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const [steed] = summonsOf(world, "Find Steed");
  await thenFight(world, paladin.id);
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  place(world, steed.id, 4, 3);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  world.clearDice();
  // A 20 on the DC 10 Dexterity save.
  world.dice(20);
  const held = await world.invoke("dismount", { characterId: paladin.id, cause: "forced-move" });
  world.clearDice();
  assert.equal(held.ok, true, held.error);
  assert.equal(getMounts(world.campaignId)[paladin.id]?.sheetId, steed.id, "the paladin who made the save no longer rides the steed's own sheet");
  assert.ok(!tokenOf(world, steed.id), "a steed still ridden stands on a token of its own");
  assert.ok(!orderIds(world).includes(steed.id), "a steed still ridden takes a turn of its own");
  // A 1 on the same save.
  world.dice(1);
  const thrown = await world.invoke("dismount", { characterId: paladin.id, cause: "forced-move" });
  world.clearDice();
  assert.equal(thrown.ok, true, thrown.error);
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined, "the paladin who failed the save still rides");
  const rider = tokenOf(world, paladin.id);
  const horse = tokenOf(world, steed.id);
  assert.ok(horse, "the steed that threw its rider has no token");
  assert.ok(Math.max(Math.abs(horse.x - rider.x), Math.abs(horse.y - rider.y)) <= 2, "the steed did not come back beside its rider");
  const order = orderIds(world);
  assert.equal(order.indexOf(steed.id), order.indexOf(paladin.id) + 1, "the steed does not act right after its rider");
});

await test("A ridden steed brought to 0 hit points disappears, and its rider comes off as from a mount that went down.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const [steed] = summonsOf(world, "Find Steed");
  const [enemy] = await thenFight(world, paladin.id);
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  place(world, steed.id, 4, 3);
  place(world, enemy.id, 3, 4);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: steed.name });
  assert.equal(up.ok, true, up.error);
  world.patch(steed.id, { currentHp: 1 });
  const hit = await strikeMount(world, enemy, paladin);
  assert.equal(hit.ok, true, hit.error);
  assert.ok(hit.mountDown, "the blow that dropped the steed did not say the mount went down");
  assert.equal(summonsOf(world, "Find Steed").length, 0, "the steed at 0 hit points did not disappear");
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined, "the paladin still rides a steed that is gone");
  // One fall for one steed: the reaction spent landing is spent once, and
  // nothing asks again and finds it gone.
  assert.equal(hit.fall?.landed, "on their feet", "the rider with a reaction to spend did not land standing");
  assert.ok(!world.sheet(paladin.id).conditions.includes("prone"), "the rider who jumped clear is prone");
});

await test("A fight that begins with the paladin already on the steed seats no steed: it rolls no initiative and the order closes without it; a steed dismissed by a new casting leaves its rider on foot.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const [steed] = summonsOf(world, "Find Steed");
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "warhorse" });
  assert.equal(up.ok, true, up.error);
  assert.equal(up.movementSpent, undefined, "mounting out of a fight charged movement");
  await fightDummies(world, 1, { heroFaces: { [paladin.id]: 20 } });
  const encounter = world.encounter();
  assert.equal(encounter.orderReady, true, "the order waited on the ridden steed");
  assert.ok(!orderIds(world).includes(steed.id), "the ridden steed was seated in the fight");
  assert.equal(getMounts(world.campaignId)[paladin.id]?.sheetId, steed.id);
  const ended = await world.invoke("end_encounter", { outcome: "truce" });
  assert.equal(ended.ok, true, ended.error);
  const recast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "pony" });
  assert.equal(recast.ok, true, recast.error);
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined, "the paladin still rides the steed the new casting replaced");
});

await test("Animate Objects animates ten Tiny objects (20 hit points, AC 18, a slam at +8 for 1d4+4) or five Medium ones.", async () => {
  const { world, sheets: [wizard] } = await board([WIZARD(["Animate Objects"])], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Animate Objects", level: 5, variant: "Animated Object (Tiny)" });
  assert.equal(cast.ok, true, cast.error);
  const objects = summonsOf(world, "Animate Objects");
  assert.equal(objects.length, 10);
  assert.equal(objects[0].maxHp, 20);
  assert.equal(objects[0].ac, 18);
  assert.equal(objects[0].summon.attacks[0].toHit, 8);
  assert.equal(objects[0].summon.attacks[0].damage, "1d4+4");
});

await test("A summoned creature keeps its stat block's damage immunities (a fire elemental takes no fire damage).", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Conjure Elemental"])]);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Conjure Elemental", level: 5, variant: "fire elemental" });
  const [elemental] = summonsOf(world, "Conjure Elemental");
  await world.invoke("apply_damage", { characterId: elemental.id, amount: 20, type: "fire" });
  assert.equal(world.sheet(elemental.id).currentHp, 102);
});

await test("Conjured creatures stay while the spell lasts: the end of a fight does not send them away, the end of the duration does.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Giant Insect"], 7)], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Giant Insect", level: 4, variant: "giant wasp" });
  assert.equal(summonsOf(world, "Giant Insect").length, 5);
  await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(summonsOf(world, "Giant Insect").length, 5, "still here after the fight");
  await world.invoke("pass_time", { amount: 11, unit: "minutes" });
  assert.equal(summonsOf(world, "Giant Insect").length, 0, "gone after ten minutes");
});

await test("Durable Summons: a Conjuration wizard's summoned creatures arrive with 30 temporary hit points.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Conjure Minor Elementals"], 14, { subclass: "School of Conjuration" })]);
  const now = world.sheet(wizard.id);
  world.patch(wizard.id, { features: [...now.features, { name: "Durable Summons", source: "class" }] });
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Conjure Minor Elementals", level: 4, variant: "magma mephit" });
  assert.equal(cast.ok, true, cast.error);
  const mephits = summonsOf(world, "Conjure Minor Elementals");
  assert.equal(mephits.length, 4);
  assert.equal(mephits[0].tempHp, 30);
});


// ---- the rest of the summoning spells, and what the narrator reads ----

await test("Arcane Hand: a hand with AC 20, hit points equal to its caster's maximum, and a Clenched Fist at the caster's spell attack bonus for 4d8 force (6d8 from a 6th level slot).", async () => {
  const { world, sheets: [wizard] } = await board([WIZARD(["Arcane Hand"], 11)], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Arcane Hand", level: 6 });
  assert.equal(cast.ok, true, cast.error);
  const [hand] = summonsOf(world, "Arcane Hand");
  assert.equal(hand.ac, 20);
  assert.equal(hand.maxHp, world.sheet(wizard.id).maxHp);
  assert.equal(hand.abilities.str, 26);
  // Wizard 11: proficiency +4, Intelligence 18 (+4).
  assert.equal(hand.summon.attacks[0].toHit, 8);
  assert.equal(hand.summon.attacks[0].damage, "6d8");
});

await test("Arcane Hand's Grasping Hand grapples with the hand's own Strength 26 (+8), through take_action grapple under the hand's characterId.", async () => {
  const { world, sheets: [wizard], enemies: [goblin] } = await board([WIZARD(["Arcane Hand"], 11)], { 0: { x: 3, y: 4 }, e0: { x: 10, y: 4 } });
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Arcane Hand", level: 5 });
  const [hand] = summonsOf(world, "Arcane Hand");
  place(world, hand.id, 9, 4);
  holdTurn(world, hand.id);
  // The hand's 2 + 8 = 10 against the goblin's contest of 9.
  world.dice(2, 9, 9);
  const grip = await world.invoke("take_action", { characterId: hand.id, action: "grapple", targetEnemyId: goblin.id });
  world.clearDice();
  assert.equal(grip.ok, true, grip.error);
  assert.ok(enemyOf(world, goblin.id).conditions.includes("grappled"), JSON.stringify(grip).slice(0, 300));
});

await test("Create Undead makes three ghouls from a 6th level slot and refuses wights below an 8th level slot, before the slot.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Create Undead"], 13, { gold: 1000 })]);
  const wights = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 6, variant: "wight" });
  assert.equal(wights.ok, false);
  assert.equal(slotsLeft(world, wizard.id, 6), 1);
  const ghouls = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 6, variant: "ghoul" });
  assert.equal(ghouls.ok, true, ghouls.error);
  const made = summonsOf(world, "Create Undead");
  assert.equal(made.length, 3);
  assert.equal(made[0].maxHp, 22);
});

// SRD 5.1, Create Undead: "an 8th-level spell slot, you can animate or
// reassert control over five ghouls or two ghasts or wights"; a 6th level
// slot reasserts the three a 6th level casting makes.
await test("Create Undead reasserts control by kind, as its slot prints: an 8th level casting holds two of five wights, and a 6th level casting none, spending nothing.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Create Undead"], 17, { gold: 10000 })]);
  const fresh = () => {
    const sheet = world.sheet(wizard.id);
    const slots = Object.fromEntries(Object.entries(sheet.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: 0 }]));
    world.patch(wizard.id, { spellcasting: { ...sheet.spellcasting, slots } });
  };
  const nine = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 9, variant: "wight", count: 3 });
  assert.equal(nine.ok, true, nine.error);
  const eight = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 8, variant: "wight", count: 2 });
  assert.equal(eight.ok, true, eight.error);
  assert.equal(summonsOf(world, "Create Undead").length, 5, "five wights");
  fresh();
  const held = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 8, variant: "reassert control" });
  assert.equal(held.ok, true, held.error);
  assert.equal(held.result.reasserted.length, 2, `two wights held, not five: ${held.result.reasserted.join(", ")}`);
  assert.match(held.result.note, /3 more are beyond this casting's hold \(up to 5 Ghoul, or up to 2 Ghast or Wight\)/);
  fresh();
  const low = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 6, variant: "reassert control" });
  assert.equal(low.ok, false, JSON.stringify(low).slice(0, 300));
  assert.match(low.error, /Create Undead from a level 6 slot reasserts control over up to 3 Ghoul, and .* are Wight, Wight, Wight, Wight, Wight\. Nothing was spent/);
  assert.equal(slotsLeft(world, wizard.id, 6), 1, "the slot is kept");
});

// SRD 5.1: the casting "reasserts your control over up to" so many "creatures
// you have animated with this spell": the caster chooses which. With three
// ghouls and two ghasts, an 8th level casting holds the five ghouls' option
// unless the caster names the ghasts; Animate Dead's four from a 3rd level
// slot likewise take the zombies first when named. The engine used to pick
// the option holding most, and the oldest four, whatever the caster said.
await test("A reasserting casting holds the undead the caster names: Create Undead's two ghasts over three ghouls, Animate Dead's zombies before its skeletons.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Create Undead", "Animate Dead"], 17, { gold: 10000 })]);
  const fresh = () => {
    const sheet = world.sheet(wizard.id);
    const slots = Object.fromEntries(Object.entries(sheet.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: 0 }]));
    world.patch(wizard.id, { spellcasting: { ...sheet.spellcasting, slots } });
  };
  const ghouls = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 6, variant: "ghoul", count: 3 });
  assert.equal(ghouls.ok, true, ghouls.error);
  const ghasts = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 8, variant: "ghast", count: 2 });
  assert.equal(ghasts.ok, true, ghasts.error);
  fresh();
  const most = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 8, variant: "reassert control" });
  assert.equal(most.ok, true, most.error);
  assert.equal(most.result.reasserted.length, 3, `named none: the option holding most, the ghouls: ${most.result.reasserted.join(", ")}`);
  fresh();
  const named = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 8, variant: "reassert control ghast" });
  assert.equal(named.ok, true, named.error);
  const heldForms = named.result.reasserted.map((name) => world.sheets().find((sheet) => sheet.name === name)?.summon?.form);
  assert.deepEqual(heldForms, ["Ghast", "Ghast"], `the ghasts, as named: ${named.result.reasserted.join(", ")}`);
  fresh();
  const none = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Create Undead", level: 8, variant: "reassert control mummy" });
  assert.equal(none.ok, false, "a kind the caster has none of holds nothing");
  assert.match(none.error, /Nothing was spent/);
  fresh();
  // Three skeletons from a 4th level slot, then a zombie from each of two
  // 3rd level castings: five, of which a 3rd level casting holds four.
  for (const [form, level, count] of [["skeleton", 4, 3], ["zombie", 3, 1], ["zombie", 3, 1]]) {
    const raised = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Animate Dead", level, variant: form, count });
    assert.equal(raised.ok, true, raised.error);
    fresh();
  }
  const zombies = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Animate Dead", level: 3, variant: "reassert control zombie" });
  assert.equal(zombies.ok, true, zombies.error);
  const held = zombies.result.reasserted.map((name) => world.sheets().find((sheet) => sheet.name === name)?.summon?.form);
  assert.equal(held.length, 4);
  assert.equal(held.filter((form) => form === "Zombie").length, 2, `both zombies among the four: ${held.join(", ")}`);
});

await test("Phantom Steed's horse has a speed of 100 feet and disappears when it takes any damage.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Phantom Steed"], 5)]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Phantom Steed", level: 3 });
  assert.equal(cast.ok, true, cast.error);
  const [steed] = summonsOf(world, "Phantom Steed");
  assert.equal(steed.speed, 100);
  await world.invoke("apply_damage", { characterId: steed.id, amount: 1, type: "piercing" });
  assert.equal(world.sheet(steed.id), null);
});

await test("A wizard on a Phantom Steed that takes damage steps down as it fades: no fall and no reaction spent.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([WIZARD(["Phantom Steed"], 5)]);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Phantom Steed", level: 3 });
  const [steed] = summonsOf(world, "Phantom Steed");
  const up = await world.invoke("mount_up", { characterId: wizard.id, mount: steed.name });
  assert.equal(up.ok, true, up.error);
  const out = await world.invoke("apply_damage", { characterId: steed.id, amount: 1, type: "piercing" });
  assert.equal(out.ok, true, out.error);
  assert.equal(getMounts(world.campaignId)[wizard.id], undefined, "the wizard still rides a steed that is gone");
  assert.equal(out.result.riderFall?.[0]?.landed, "on their feet");
  assert.ok(!world.sheet(wizard.id).conditions.includes("prone"), "the rider of a fading steed fell prone");
});

await test("A ridden steed dropped by damage sent to its own sheet takes its rider down as a mount that went down does: the reaction to land standing, and prone without one.", async () => {
  for (const spent of [false, true]) {
    const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
    await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
    const [steed] = summonsOf(world, "Find Steed");
    await thenFight(world, paladin.id);
    holdTurn(world, paladin.id);
    place(world, paladin.id, 3, 3);
    place(world, steed.id, 4, 3);
    const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
    assert.equal(up.ok, true, up.error);
    if (spent) {
      const encounter = world.encounter();
      encounters.saveEncounter({ ...encounter, reactionsUsed: [...encounter.reactionsUsed, paladin.id] });
    }
    const out = await world.invoke("apply_damage", { characterId: steed.id, amount: 40, type: "slashing" });
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(steed.id), null, "the steed at 0 hit points did not disappear");
    assert.equal(getMounts(world.campaignId)[paladin.id], undefined, "the paladin still rides a steed that is gone");
    const prone = world.sheet(paladin.id).conditions.includes("prone");
    if (spent) {
      assert.ok(prone, "a rider with no reaction left did not fall prone with the steed");
    } else {
      assert.equal(out.result.riderFall?.[0]?.landed, "on their feet", "a rider with a reaction to spend did not land standing");
      assert.ok(!prone, "the rider who jumped clear is prone");
      assert.ok(world.encounter().reactionsUsed.includes(paladin.id), "landing standing spent no reaction");
    }
  }
});

// A fall decided as the steed went, on a turn later undone, brings the same
// sheet back with its rider on it. A later blow at that steed, already at 0,
// read the undone turn's fall as its own: the rider kept the saddle, no
// reaction was spent, and the result said one was.
await test("A rider's fall decided on a turn that was undone is not read by a later blow: the steed at 0 under them throws them as a mount that went down, with their reaction.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const [steed] = summonsOf(world, "Find Steed");
  const [enemy] = await thenFight(world, paladin.id);
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  place(world, steed.id, 4, 3);
  place(world, enemy.id, 3, 4);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  const out = await world.invoke("apply_damage", { characterId: steed.id, amount: 40, type: "slashing" });
  assert.equal(out.ok, true, out.error);
  const undone = await revertTurn(world, out.turnId);
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  assert.equal(getMounts(world.campaignId)[paladin.id]?.sheetId, steed.id, "setup: the undo did not seat the paladin on the steed again");
  assert.ok(!world.encounter().reactionsUsed.includes(paladin.id), "setup: the undo kept the reaction spent");
  world.patch(steed.id, { currentHp: 0 });
  const hit = await strikeMount(world, enemy, paladin);
  assert.equal(hit.ok, true, hit.error);
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined, `the paladin still rides a steed at 0: ${JSON.stringify(hit.fall)}`);
  assert.ok(world.encounter().reactionsUsed.includes(paladin.id), "the rider landed standing and spent no reaction");
});

await test("A ridden steed saves against an area as its own sheet saves: a Dexterity save proficiency on the sheet counts.", async () => {
  const totals = [];
  for (const trained of [false, true]) {
    const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
    await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
    const [steed] = summonsOf(world, "Find Steed");
    if (trained) {
      world.patch(steed.id, { proficiencies: { ...world.sheet(steed.id).proficiencies, saves: ["dex"] } });
    }
    await thenFight(world, paladin.id);
    holdTurn(world, paladin.id);
    place(world, paladin.id, 3, 3);
    place(world, steed.id, 4, 3);
    const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
    assert.equal(up.ok, true, up.error);
    world.clearDice();
    // The steed's d20, then the rider's.
    world.dice(10, 10);
    const blast = await world.invoke("aoe_damage", { characterIds: [paladin.id], damage: 4, type: "fire", saveAbility: "dex", dc: 30, halfOnSave: false });
    world.clearDice();
    assert.equal(blast.ok, true, blast.error);
    const row = JSON.stringify(blast).match(/"mount":\{"mount":"[^"]*","save":(\d+)/);
    assert.ok(row, `the area's result does not show the steed's save: ${JSON.stringify(blast).slice(0, 300)}`);
    totals.push(Number(row[1]));
  }
  assert.ok(totals[1] > totals[0], `a steed proficient in Dexterity saves rolled ${totals[1]}, and one that is not ${totals[0]}, on the same die`);
});

await test("Undoing the GM turn that mounted a steed puts it back as the turn found it: on foot, on its square, in the order, and its maker unmounted.", async () => {
  const { world, sheets: [paladin] } = await outOfFight([PALADIN()]);
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const [steed] = summonsOf(world, "Find Steed");
  await thenFight(world, paladin.id);
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  place(world, steed.id, 4, 3);
  const before = snapshot();
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  assert.ok(!tokenOf(world, steed.id), "setup: the ridden steed kept its token");
  await revertTurn(world, up.turnId);
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined);
  assert.ok(tokenOf(world, steed.id), "the steed has no token after the turn was undone");
  assert.ok(orderIds(world).includes(steed.id), "the steed has no turn after the turn was undone");
});

await test("Casting a conjuring spell again while it holds ends the first casting and its creatures.", async () => {
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"], 9)], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  const again = await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "brown bear" });
  assert.equal(again.ok, true, again.error);
  const now = summonsOf(world, "Conjure Animals");
  assert.equal(now.length, 2);
  assert.ok(now.every((sheet) => sheet.summon.form === "Brown Bear"));
});

await test("GAME STATE shows a summoned creature with its attacks, who made it and how it ends.", async () => {
  const { describeSheet } = await import("../src/lib/dm/prompt.ts");
  const { world, sheets: [druid] } = await board([DRUID(["Conjure Animals"])], [{ x: 3, y: 4 }]);
  await world.invoke("cast_buff", { characterId: druid.id, spell: "Conjure Animals", level: 3, variant: "wolf" });
  const [wolf] = summonsOf(world, "Conjure Animals");
  const text = describeSheet(world.sheet(wolf.id), "nobody", false);
  assert.match(text, /Summoned Wolf/);
  assert.match(text, /Bite \+4 \(2d4\+2 piercing\)/);
  assert.match(text, /concentration/);
});

// ---- Find Familiar, Faithful Hound, the beast-form spells ----

await test("Find Familiar through cast_buff pays the casting (a slot, 10 gp of incense) and binds the familiar as the caster's pet with its form's numbers; it cannot attack.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([{ ...WIZARD(["Find Familiar"], 3), gold: 50 }]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Find Familiar", level: 1, variant: "owl" });
  assert.equal(cast.ok, true, cast.error);
  const [owl] = world.sheet(wizard.id).pets;
  assert.equal(owl?.form, "Owl");
  assert.equal(owl.attacks.length, 0, "the familiar kept its talons");
  assert.equal(slotsLeft(world, wizard.id, 1), 3, "the slot was not spent");
  assert.equal(world.sheet(wizard.id).gold, 40, "the incense was not bought");
});

await test("Find Familiar: one familiar at a time; casting it again changes its form.", async () => {
  const { world, sheets: [wizard] } = await outOfFight([{ ...WIZARD(["Find Familiar"], 3), gold: 50 }]);
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Find Familiar", level: 1, variant: "owl" });
  await world.invoke("cast_buff", { characterId: wizard.id, spell: "Find Familiar", level: 1, variant: "cat" });
  const familiars = world.sheet(wizard.id).pets.filter((pet) => pet.kind === "familiar");
  assert.equal(familiars.length, 1);
  assert.equal(familiars[0].form, "Cat");
});

await test("Faithful Hound: an invisible watchdog that cannot be harmed, acting at the start of its caster's turn, biting at the caster's spell attack bonus for 4d8 piercing.", async () => {
  const { world, sheets: [wizard] } = await board([WIZARD(["Faithful Hound"], 7)], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: wizard.id, spell: "Faithful Hound", level: 4 });
  assert.equal(cast.ok, true, cast.error);
  const [hound] = summonsOf(world, "Faithful Hound");
  assert.ok(hound.conditions.includes("invisible"), "the hound is seen");
  assert.equal(hound.summon.attacks[0].toHit, 7, "INT +4 and proficiency +3");
  assert.equal(hound.summon.attacks[0].damage, "4d8");
  const order = world.encounter().order;
  assert.equal(order.findIndex((entry) => entry.characterId === hound.id) + 1, order.findIndex((entry) => entry.characterId === wizard.id), "the hound acts right before its caster");
  await world.invoke("apply_damage", { characterId: hound.id, amount: 20, type: "slashing" });
  assert.ok(world.sheet(hound.id), "the hound was harmed away");
  assert.equal(world.sheet(hound.id).currentHp, 1);
});

await test("Animal Shapes: a willing creature becomes a Large or smaller beast of challenge rating 4 or lower, keeping its own Intelligence, Wisdom and Charisma.", async () => {
  const { world, sheets: [druid, fighter] } = await outOfFight([DRUID(["Animal Shapes"], 15), { class: "fighter", level: 5, abilities: { str: 16, int: 14 } }]);
  const ape = await world.invoke("cast_buff", { characterId: druid.id, spell: "Animal Shapes", level: 8, variant: "giant ape", targetCharacterIds: [fighter.id] });
  assert.equal(ape.ok, false, "a CR 7 Huge ape was allowed");
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Animal Shapes", level: 8, variant: "brown bear", targetCharacterIds: [fighter.id] });
  assert.equal(cast.ok, true, cast.error);
  const shaped = world.sheet(fighter.id).wildShape;
  assert.equal(shaped?.form, "Brown Bear");
  assert.equal(shaped.abilities.int, 14, "the fighter's mind became the bear's");
  assert.equal(shaped.abilities.str, 19);
});

await test("Shapechange: the caster takes a beast form of challenge rating up to their level, keeping their own mind.", async () => {
  const { world, sheets: [druid] } = await board([{ ...DRUID(["Shapechange"], 17), equipment: [{ name: "Jade circlet", qty: 1, worth: 1500 }] }], [{ x: 3, y: 4 }]);
  const cast = await world.invoke("cast_buff", { characterId: druid.id, spell: "Shapechange", level: 9, variant: "tyrannosaurus rex" });
  assert.equal(cast.ok, true, cast.error);
  const shaped = world.sheet(druid.id).wildShape;
  assert.equal(shaped?.form, "Tyrannosaurus Rex");
  assert.equal(shaped.abilities.wis, 18, "the druid's Wisdom stayed");
});

await test("Each summoned creature's stat block matches the content pack's SRD block (armor class, hit points, challenge rating, ability scores).", async () => {
  if (!hasPack) {
    return;
  }
  const { SUMMON_FORMS } = await import("../src/lib/srd/summon-forms.ts");
  const content = await import("../src/lib/content/index.ts");
  const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
  // Where the pack's row says otherwise than the SRD 5.1 text, both the
  // table and parseMonster read it with src/lib/bestiary/pack-corrections.ts
  // laid over it, so the SRD's number is each side's.
  let compared = 0;
  for (const form of SUMMON_FORMS) {
    const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const entry = content.getEntryDetail("monsters", slug);
    if (!entry) {
      continue;
    }
    const stats = parseMonster(entry.data, entry.data.cr);
    const data = entry.data;
    assert.deepEqual(
      [form.ac, form.hp, form.cr, form.abilities.str, form.abilities.dex, form.abilities.con, form.abilities.int, form.abilities.wis, form.abilities.cha],
      [stats.ac, stats.maxHp, stats.cr, data.strength, data.dexterity, data.constitution, data.intelligence, data.wisdom, data.charisma],
      form.name,
    );
    compared += 1;
  }
  assert.ok(compared >= 110, `only ${compared} blocks compared`);
});

closeTables();
finish();
