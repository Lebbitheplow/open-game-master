// An area spell catches only the creatures inside one placement of its
// shape (docs/dnd-rules-audit-2026-10-09-extent.md, F13; src/lib/dm/aoe-shape.ts).
//
//   - Fireball (SRD 5.1): "Each creature in a 20-foot-radius sphere centered
//     on that point". Two creatures 100 feet apart are never in one sphere.
//   - Burning Hands: "Each creature in a 15-foot cone". A cone points one way
//     from its caster; creatures on both sides are not in it.
//   - Lightning Bolt: "A stroke of lightning forming a line 100 feet long and
//     5 feet wide blasts out from you in a direction you choose."
//   - A point of origin sits within the spell's range (Shatter: 60 feet).
//   - An id that names nobody catches nobody: the refusal names the creatures
//     there are, by name and id, as every other unknown id is refused.
//   - Ice Storm: "Each creature in the cylinder must make a Dexterity saving
//     throw", and the hail leaves difficult terrain. Laid on a square with
//     nobody named, it catches whoever stands in it, as a Fireball does
//     (play-test 2026-11-09: it rolled, spent its slot and caught nobody).
//     Web's area catches nobody as it is cast; it waits for a creature to
//     enter it or start a turn there.
//   - Entangle: "When the spell is cast, each creature within the area must
//     succeed on a Strength saving throw or be restrained"; Wall of Fire:
//     "When the wall appears, each creature within its area must make a
//     Dexterity saving throw". Their text prints no burst, so the squares
//     their area is laid on are the ones read; a wall's burning side is not
//     its area.
//
// A refusal spends nothing. Every check reads a refusal, a slot or an enemy.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf } from "./lib/enforce-spell-kit.mjs";
import { board, zonesOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-area-shapes");
const { boardCatchesCast } = await import("../src/lib/dm/area-casting.ts");

const WIZARD = caster("wizard", "int", ["Fireball", "Burning Hands", "Lightning Bolt", "Shatter", "Ice Storm", "Web"], [], 9);
const DRUID = caster("druid", "wis", ["Entangle", "Wall of Fire"], [], 9);
const slots = (world, id, level) => world.sheet(id).spellcasting.slots[String(level)].used;

await test("Fireball refuses two creatures 110 feet apart, and spends no slot.", async () => {
  const { world, sheets: [mage], enemies: [a, b] } = await board([WIZARD], { 0: { x: 12, y: 0 }, e0: { x: 1, y: 4 }, e1: { x: 23, y: 4 } }, { count: 2 });
  const out = await world.invoke("aoe_damage", { casterCharacterId: mage.id, spell: "Fireball", level: 3, enemyIds: [a.id, b.id] });
  assert.equal(out.ok, false, "one sphere caught creatures 110 feet apart");
  assert.match(String(out.error), /sphere/);
  assert.equal(slots(world, mage.id, 3), 0);
});

await test("Fireball catches two creatures 10 feet apart in one sphere.", async () => {
  const { world, sheets: [mage], enemies: [a, b] } = await board([WIZARD], { 0: { x: 2, y: 0 }, e0: { x: 10, y: 4 }, e1: { x: 12, y: 4 } }, { count: 2 });
  world.dice(...new Array(8).fill(1), 20, 20);
  const out = await world.invoke("aoe_damage", { casterCharacterId: mage.id, spell: "Fireball", level: 3, enemyIds: [a.id, b.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(slots(world, mage.id, 3), 1);
});

await test("Shatter placed beyond its 60-foot range is refused; within it, cast.", async () => {
  const { world, sheets: [mage], enemies: [a] } = await board([WIZARD], { 0: { x: 0, y: 0 }, e0: { x: 20, y: 4 } });
  // (20, 4) is 100 feet from the caster in the corner.
  const far = await world.invoke("aoe_damage", { casterCharacterId: mage.id, spell: "Shatter", level: 2, enemyIds: [a.id], atX: 20, atY: 4 });
  assert.equal(far.ok, false, "a point 100 feet off took a 60-foot spell");
  // Shatter is an area spell (its 10-foot sphere), so the creature's own
  // distance, past the 60-foot range plus the 10-foot radius, refuses it
  // before the point does (src/lib/dm/aoe-spell.ts).
  assert.match(String(far.error), /range|reaches 60 ft/);
  assert.equal(slots(world, mage.id, 2), 0);
  const { world: near, sheets: [caster2], enemies: [b] } = await board([WIZARD], { 0: { x: 0, y: 0 }, e0: { x: 10, y: 4 } });
  near.dice(1, 1, 1, 20);
  const cast = await near.invoke("aoe_damage", { casterCharacterId: caster2.id, spell: "Shatter", level: 2, enemyIds: [b.id], atX: 10, atY: 4 });
  near.clearDice();
  assert.equal(cast.ok, true, cast.error);
});

await test("Burning Hands refuses creatures on both sides of its caster; one side is one cone.", async () => {
  const both = await board([WIZARD], { 0: { x: 12, y: 4 }, e0: { x: 10, y: 4 }, e1: { x: 14, y: 4 } }, { count: 2 });
  const refused = await both.world.invoke("aoe_damage", { casterCharacterId: both.sheets[0].id, spell: "Burning Hands", level: 1, enemyIds: both.enemies.map((enemy) => enemy.id) });
  assert.equal(refused.ok, false, "one cone caught creatures east and west of its caster");
  assert.match(String(refused.error), /cone/);
  assert.equal(slots(both.world, both.sheets[0].id, 1), 0);
  const one = await board([WIZARD], { 0: { x: 12, y: 4 }, e0: { x: 13, y: 4 }, e1: { x: 14, y: 4 } }, { count: 2 });
  one.world.dice(1, 1, 1, 20, 20);
  const cast = await one.world.invoke("aoe_damage", { casterCharacterId: one.sheets[0].id, spell: "Burning Hands", level: 1, enemyIds: one.enemies.map((enemy) => enemy.id) });
  one.world.clearDice();
  assert.equal(cast.ok, true, cast.error);
});

await test("Lightning Bolt refuses creatures in opposite directions; one line holds creatures along it.", async () => {
  const split = await board([WIZARD], { 0: { x: 12, y: 4 }, e0: { x: 8, y: 4 }, e1: { x: 16, y: 4 } }, { count: 2 });
  const refused = await split.world.invoke("aoe_damage", { casterCharacterId: split.sheets[0].id, spell: "Lightning Bolt", level: 3, enemyIds: split.enemies.map((enemy) => enemy.id) });
  assert.equal(refused.ok, false, "one line ran both ways from its caster");
  assert.match(String(refused.error), /line/);
  const along = await board([WIZARD], { 0: { x: 12, y: 4 }, e0: { x: 14, y: 4 }, e1: { x: 18, y: 4 } }, { count: 2 });
  along.world.dice(...new Array(8).fill(1), 20, 20);
  const cast = await along.world.invoke("aoe_damage", { casterCharacterId: along.sheets[0].id, spell: "Lightning Bolt", level: 3, enemyIds: along.enemies.map((enemy) => enemy.id) });
  along.world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(enemyOf(along.world, along.enemies[1].id).currentHp < enemyOf(along.world, along.enemies[1].id).maxHp);
});

await test("An effect whose ids name nobody is refused with the creatures there are, and harms nobody.", async () => {
  const { world, sheets: [mage], enemies: [a] } = await board([WIZARD], { 0: { x: 2, y: 0 }, e0: { x: 3, y: 0 } });
  const mangled = `${a.id.slice(0, 9)}${mage.id.slice(9)}`;
  const hp = enemyOf(world, a.id).currentHp;
  const out = await world.invoke("aoe_damage", { enemyIds: [mangled], damage: "1d6", type: "fire", saveAbility: "dex", dc: 12, reason: "coals" });
  assert.equal(out.ok, false);
  assert.ok(String(out.error).includes(a.id), "the refusal names the enemy's id");
  assert.ok(String(out.error).includes(mage.id), "the refusal names the party's ids");
  assert.equal(enemyOf(world, a.id).currentHp, hp);
});

await test("Ice Storm laid on a square with nobody named catches every creature in its hail, each taking both types, and nobody outside it.", async () => {
  const { world, sheets: [mage], enemies: [a, b, far] } = await board([WIZARD], { 0: { x: 2, y: 4 }, e0: { x: 12, y: 4 }, e1: { x: 13, y: 6 }, e2: { x: 22, y: 4 } }, { count: 3, stats: { maxHp: 200 } });
  // Both saves fail; every die of the hail and the cold lands 1.
  world.dice(...new Array(6).fill(1), 1, 1);
  const out = await world.invoke("aoe_damage", { casterCharacterId: mage.id, spell: "Ice Storm", level: 4, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual((out.result?.results ?? []).map((entry) => entry.target).sort(), [a.displayName, b.displayName].sort(), JSON.stringify(out.result));
  for (const enemy of [a, b]) {
    assert.equal(enemyOf(world, enemy.id).currentHp, 200 - 6, `${enemy.displayName} takes 2 bludgeoning and 4 cold`);
  }
  assert.equal(enemyOf(world, far.id).currentHp, 200, "the goblin outside the storm is untouched");
  assert.equal(slots(world, mage.id, 4), 1, "one slot for the whole storm");
  assert.ok((zonesOf(world) ?? []).some((zone) => zone.spell === "Ice Storm"), "the hail is on the ground");
});

await test("Ice Storm laid on empty ground is still cast, for its hail; Web laid on a square catches nobody as it is cast.", async () => {
  const empty = await board([WIZARD], { 0: { x: 2, y: 4 }, e0: { x: 22, y: 4 } });
  const storm = await empty.world.invoke("aoe_damage", { casterCharacterId: empty.sheets[0].id, spell: "Ice Storm", level: 4, atX: 10, atY: 4 });
  assert.equal(storm.ok, true, storm.error);
  assert.deepEqual(storm.result?.results, []);
  assert.ok((zonesOf(empty.world) ?? []).some((zone) => zone.spell === "Ice Storm"));
  const { world, sheets: [mage], enemies: [goblin] } = await board([WIZARD], { 0: { x: 2, y: 4 }, e0: { x: 12, y: 4 } });
  const web = await world.invoke("aoe_damage", { casterCharacterId: mage.id, spell: "Web", level: 2, atX: 12, atY: 4 });
  assert.equal(web.ok, true, web.error);
  assert.deepEqual(web.result?.results, [], "nobody saves as the web appears");
  assert.ok(!(enemyOf(world, goblin.id).conditions ?? []).includes("restrained"));
  assert.ok((zonesOf(world) ?? []).some((zone) => zone.spell === "Web"));
});

await test("What aoe_damage and the Portent stop both catch on the board: a blast, Ice Storm's hail as it falls, never a Web as it is cast, nor a held Insect Plague coming again.", async () => {
  const { world, sheets: [mage] } = await board([WIZARD], { 0: { x: 2, y: 4 } });
  const catches = (spell) => boardCatchesCast([], mage.id, spell);
  assert.equal(catches("Fireball"), true);
  assert.equal(catches("Ice Storm"), true);
  assert.equal(catches({ spell: "Hailfall", runsAs: "Ice Storm" }), true, "a workshop copy reads the row of the spell it runs as");
  assert.equal(catches("Web"), false);
  assert.equal(catches("Spike Growth"), false);
  assert.equal(catches("Insect Plague"), true, "the swarm catches whoever stands in it as it appears");
  world.patch(mage.id, { concentratingOn: "Insect Plague" });
  assert.equal(catches("Insect Plague"), false, "coming again, it strikes only the creatures named");
});

await test("Entangle laid on a square with nobody named holds every creature standing in it to its save, and nobody outside it; a Wall of Fire catches the creature on the wall, not the one on its burning side.", async () => {
  const { world, sheets: [druid], enemies: [a, b, far] } = await board([DRUID], { 0: { x: 2, y: 4 }, e0: { x: 12, y: 4 }, e1: { x: 13, y: 4 }, e2: { x: 17, y: 4 } }, { count: 3, stats: { maxHp: 200 } });
  // Both Strength saves fail.
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", { casterCharacterId: druid.id, spell: "Entangle", level: 1, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual((out.result?.results ?? []).map((entry) => entry.target).sort(), [a.displayName, b.displayName].sort(), JSON.stringify(out.result));
  for (const enemy of [a, b]) {
    assert.ok(enemyOf(world, enemy.id).conditions.includes("restrained"), `${enemy.displayName} is restrained`);
  }
  assert.ok(!enemyOf(world, far.id).conditions.includes("restrained"), "the goblin outside the vines is free");
  assert.equal(slots(world, druid.id, 1), 1);
  const wall = await board([DRUID], { 0: { x: 2, y: 4 }, e0: { x: 12, y: 4 }, e1: { x: 13, y: 4 } }, { count: 2, stats: { maxHp: 200 } });
  const fire = await wall.world.invoke("aoe_damage", { casterCharacterId: wall.sheets[0].id, spell: "Wall of Fire", level: 4, atX: 12, atY: 4 });
  assert.equal(fire.ok, true, fire.error);
  assert.deepEqual((fire.result?.results ?? []).map((entry) => entry.target), [wall.enemies[0].displayName], JSON.stringify(fire.result));
  assert.equal(enemyOf(wall.world, wall.enemies[1].id).currentHp, 200, "the burning side bites at the end of a turn, not as the wall appears");
});

await test("Entangle with nobody named and no square picked is asked where it goes, and spends nothing.", async () => {
  const { world, sheets: [druid] } = await board([DRUID], { 0: { x: 2, y: 4 }, e0: { x: 12, y: 4 } });
  const out = await world.invoke("aoe_damage", { casterCharacterId: druid.id, spell: "Entangle", level: 1 });
  assert.equal(out.ok, false, "laid where nobody chose, it would catch nobody by chance");
  assert.match(String(out.error), /atX, atY/);
  assert.equal(slots(world, druid.id, 1), 0);
});

closeTables();
finish();
