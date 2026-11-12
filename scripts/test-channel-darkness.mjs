// Radiance of the Dawn (SRD 5.1, Light Domain): "Any magical darkness within
// 30 feet of you is dispelled." The option only rolled its burst: in the
// 0.33.0 play-test a drow's Darkness stayed on the board, still held, after
// the cleric used it 15 feet away. Now every area of magical darkness with a
// square within 30 feet ends, of any spell level, and so does its caster's
// concentration on it, as Daylight's dispel does (src/lib/dm/zone-cast.ts).
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, enemyOf } from "./lib/enforce-spell-kit.mjs";
import { board, holdTurn, mapOf, place, tokenOf, zonesOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-channel-darkness");
const { placeSpellZone } = await import("../src/lib/dm/zone-cast.ts");
const { setEnemyConcentration } = await import("../src/lib/db/encounters.ts");

const CLERIC = caster("cleric", "wis", [], [], 9, { subclass: "Light Domain" });
const SORCERER = caster("sorcerer", "cha", ["Darkness"]);
const used = (world, id) => world.sheet(id).resources.channel_divinity.used;
const darkness = (world) => zonesOf(world).filter((zone) => zone.spell === "Darkness");
const radiance = async (world, id, faces) => {
  world.dice(...faces);
  const out = await world.invoke("use_resource", { characterId: id, resource: "Channel Divinity", variant: "radiance of the dawn" });
  world.clearDice();
  return out;
};
// Squares from the cleric's square to the nearest square of the darkness, so
// each test states the reach it stands at rather than trusting the sphere's shape.
const nearest = (world, heroId, zone) => {
  const token = tokenOf(world, heroId);
  const { width } = mapOf(world);
  return Math.min(...zone.cells.map((cell) => Math.max(Math.abs(cell % width - token.x), Math.abs(Math.floor(cell / width) - token.y))));
};

await test("The play-test: an enemy's Darkness 15 feet off ends, with its concentration, and the result the GM reads says so.", async () => {
  const { world, sheets: [cleric], enemies: [drow] } = await board([CLERIC], { 0: { x: 4, y: 4 }, e0: { x: 7, y: 4 } });
  setEnemyConcentration(drow.id, "Darkness", 100);
  placeSpellZone(world.campaign(), { spell: "Darkness", caster: { kind: "enemy", id: drow.id, name: drow.displayName }, slotLevel: 2, at: { x: 7, y: 4 } });
  assert.equal(darkness(world).length, 1, "no Darkness on the board to dispel");
  // The burst's 2d10 (5 + 5, + 9), then the drow's failed CON save.
  const out = await radiance(world, cleric.id, [5, 5, 1]);
  assert.equal(out.ok, true, out.error);
  assert.equal(darkness(world).length, 0, "the Darkness stayed on the board");
  assert.equal(enemyOf(world, drow.id).concentration ?? null, null, "the drow still concentrates on Darkness");
  assert.match(JSON.stringify(out.result), /dispels .*Darkness/);
  assert.equal(enemyOf(world, drow.id).currentHp, 90 - 19, "the burst still lands");
  assert.equal(used(world, cleric.id), 1);
});

await test("A Darkness cast at 5th level with one edge square 30 feet off ends whole, and no foe in reach is needed.", async () => {
  const { world, sheets: [sorcerer, cleric] } = await board([SORCERER, CLERIC], [{ x: 2, y: 8 }, { x: 4, y: 8 }]);
  const dark = await world.invoke("use_spell_slot", { characterId: sorcerer.id, spell: "Darkness", level: 5, atX: 12, atY: 4 });
  assert.equal(dark.ok, true, dark.error);
  assert.equal(world.sheet(sorcerer.id).concentratingOn, "Darkness");
  const [zone] = darkness(world);
  place(world, cleric.id, 12 - 3 - 6, 4);
  assert.equal(nearest(world, cleric.id, zone), 6, "the test meant the darkness to reach 30 feet exactly");
  holdTurn(world, cleric.id);
  const out = await radiance(world, cleric.id, [5, 5]);
  assert.equal(out.ok, true, out.error);
  assert.equal(darkness(world).length, 0, "a darkness above 3rd level, or only partly in reach, stayed");
  assert.equal(world.sheet(sorcerer.id).concentratingOn ?? null, null, "the sorcerer still concentrates on Darkness");
  assert.equal(used(world, cleric.id), 1);
});

await test("A Darkness wholly beyond 30 feet stays, and with no foe in reach either the use is refused and spends nothing.", async () => {
  const { world, sheets: [sorcerer, cleric] } = await board([SORCERER, CLERIC], [{ x: 2, y: 8 }, { x: 4, y: 8 }]);
  const dark = await world.invoke("use_spell_slot", { characterId: sorcerer.id, spell: "Darkness", level: 2, atX: 12, atY: 4 });
  assert.equal(dark.ok, true, dark.error);
  const [zone] = darkness(world);
  place(world, cleric.id, 12 - 3 - 7, 4);
  assert.equal(nearest(world, cleric.id, zone), 7, "the test meant the darkness to start 35 feet off");
  holdTurn(world, cleric.id);
  const out = await radiance(world, cleric.id, [5, 5]);
  assert.equal(out.ok, false);
  assert.match(String(out.error), /Nothing was spent/);
  assert.equal(darkness(world).length, 1);
  assert.equal(world.sheet(sorcerer.id).concentratingOn, "Darkness");
  assert.equal(used(world, cleric.id), 0);
});

// Out of a fight a board can still be on the table (an exploration scene),
// and a Darkness laid on it is as much in reach: the burst has no foe to
// catch, but the darkness ends. Before, the GM read only that it was dispelled
// while the area stayed drawn and its caster kept concentrating.
const maps = await import("../src/lib/db/battle-maps.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
await test("On a scene's board with no fight, a Darkness within 30 feet still ends, with its caster's concentration.", async () => {
  const { world, sheets: [sorcerer, cleric] } = await board([SORCERER, CLERIC], [{ x: 2, y: 8 }, { x: 4, y: 8 }]);
  const dark = await world.invoke("use_spell_slot", { characterId: sorcerer.id, spell: "Darkness", level: 2, atX: 8, atY: 8 });
  assert.equal(dark.ok, true, dark.error);
  const encounterId = world.encounter().id;
  getDatabase().prepare("UPDATE encounters SET kind = 'scene' WHERE id = ?").run(encounterId);
  const sceneZones = () => maps.getBattleMapForEncounter(encounterId).spellZones.filter((zone) => zone.spell === "Darkness");
  assert.equal(sceneZones().length, 1, "no Darkness on the scene to dispel");
  const out = await radiance(world, cleric.id, []);
  assert.equal(out.ok, true, out.error);
  assert.equal(sceneZones().length, 0, "the Darkness stayed on the scene's board");
  assert.equal(world.sheet(sorcerer.id).concentratingOn ?? null, null, "the sorcerer still concentrates on Darkness");
  assert.match(JSON.stringify(out.result), /dispels .*Darkness/);
  assert.equal(used(world, cleric.id), 1);
});

closeTables();
finish();
