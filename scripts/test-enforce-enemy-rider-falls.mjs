// How an enemy rider loses its seat (issue 1055, ruling 6 and the rules as
// written).
//
// "If an effect moves your mount against its will while you're on it, you
// must succeed on a DC 10 Dexterity saving throw or fall off the mount,
// landing prone in a space within 5 feet of it. If you're knocked prone while
// mounted, you must make the same saving throw. If your mount is knocked
// prone, you can use your reaction to dismount it as it falls and land on
// your feet. Otherwise, you are dismounted and fall prone in a space within
// 5 feet it" (SRD 5.1, Mounting and Dismounting).
//
// Ruling 6: a push or a pull that names the rider takes the rider alone, out
// of the saddle, prone where the push ends, with no save; the mount stays.
// The two checks asked for with the rulings: a rider that cannot act fails
// the save with no roll, and a mount that Disengages provokes nothing.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { caster, closeTables } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";
import { mapOf, OPEN, zonesOf } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-enforce-enemy-rider-falls");
const { listTokens } = await import("../src/lib/db/battle-maps.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { settleEnemyRiders } = await import("../src/lib/dm/enemy-rider-falls.ts");
const { pullTokenToward, pushTokenAway } = await import("../src/lib/dm/map-tools.ts");
const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
const { saveZones } = await import("../src/lib/dm/zone-store.ts");
const { zoneTurnStart } = await import("../src/lib/dm/zone-triggers.ts");
const { endOwnTurn, skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");

const HERO = () => caster("paladin", "cha", [], [], 5, { speed: 30 });
// A hero of a martial subclass, every ability 16.
const MARTIAL = (cls, subclass, level, weapon) => ({
  class: cls, subclass, level, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
  abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 },
  equipment: [{ name: weapon, qty: 1, equipped: true }],
});
const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;
const at = (world, refId) => [ownToken(world, refId)?.x, ownToken(world, refId)?.y];
const live = (world, id) => world.enemies().find((enemy) => enemy.id === id);
const prone = (world, id) => live(world, id).conditions.includes("prone");
const mounted = (world, rider) => live(world, rider.id).ridesEnemyId !== undefined;
const beside = (a, b, wide = 1) => a.x >= b.x - 1 && a.x <= b.x + wide && a.y >= b.y - 1 && a.y <= b.y + wide;
const d20s = (world) => world.diceLog().filter((die) => die.sides === 20).length;

// A hero at (11,4) beside a rider on its mount at (12,4), on an open board.
// The order is the hero, the rider, the mount, with the pointer on the hero.
async function pair({ mount = "wolf", hero: who = HERO() } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(who);
  await world.beginFight([{ monster: "goblin", mount }]);
  const up = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const under = world.enemies().find((enemy) => enemy.id === up?.ridesEnemyId);
  assert.ok(up && under, "setup: the fight has no rider on a mount");
  await layMap(world, OPEN(), { [hero.id]: { x: 11, y: 4 }, [up.id]: { x: 12, y: 4 } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  saveEncounter({ ...encounter, order: [entry(hero.id), entry(up.id), entry(under.id)], turnIndex: 0, turnBudget: null, reactionsUsed: [] });
  world.clearDice();
  world.diceLog();
  return { world, hero, rider: up, mount: under };
}

function turnOf(world, enemyId) {
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === enemyId), turnBudget: null });
}

// The hero's shove, won: their d20, the target's, then whatever the test
// expects the engine to roll after it.
async function shove(world, hero, targetId, how, ...then) {
  world.dice(20, 1, ...then);
  const out = await world.invoke("take_action", { characterId: hero.id, action: "shove", targetEnemyId: targetId, shove: how });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true, `the shove was lost: ${JSON.stringify(out.result)}`);
  return out;
}

// The pair has parted with both on the board: the mount on a token of its
// own where the pair stood, the rider on its own beside it.
function assertParted(world, rider, mount, where = [12, 4], wide = 1) {
  assert.equal(mounted(world, rider), false, "the rider is still mounted");
  assert.deepEqual(at(world, mount.id), where, "the mount does not stand where the pair stood, on a token of its own");
  const fallen = ownToken(world, rider.id);
  assert.ok(fallen, "the rider has no token");
  assert.ok(beside(fallen, ownToken(world, mount.id), wide), `the rider at (${fallen.x},${fallen.y}) is not within 5 feet of its mount`);
}

await test("A rider knocked prone makes the DC 10 Dexterity save from its own block, and a failure takes it off its mount, prone beside it.", async () => {
  const { world, hero, rider, mount } = await pair();
  // A goblin's Dexterity is 14: a 3 on the die is 5.
  await shove(world, hero, rider.id, "prone", 3);
  assert.equal(world.clearDice(), 0, "the save to stay mounted was not rolled");
  assertParted(world, rider, mount);
  assert.equal(prone(world, rider.id), true, "the fallen rider is not prone");
  assert.equal(prone(world, mount.id), false);
});

await test("A rider knocked prone who makes the save keeps its seat, still prone, and one prone asks one save.", async () => {
  const { world, hero, rider, mount } = await pair();
  await shove(world, hero, rider.id, "prone", 15);
  assert.equal(world.clearDice(), 0, "the save to stay mounted was not rolled");
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id, "a made save took the rider off");
  assert.equal(prone(world, rider.id), true);
  assert.equal(ownToken(world, mount.id), null);
  world.diceLog();
  const later = await world.invoke("damage_enemy", { enemyId: rider.id, amount: 1, reason: "test" });
  assert.equal(later.ok, true, later.error);
  assert.equal(d20s(world), 0, "a rider who kept its seat was asked again for the same prone");
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id);
});

await test("The mount pushed against its will carries the pair, and its rider saves once as the call finishes: a made save keeps the seat.", async () => {
  const { world, hero, rider, mount } = await pair();
  await shove(world, hero, mount.id, "push", 15);
  assert.equal(world.clearDice(), 0, "the rider of a pushed mount made no save");
  assert.deepEqual(at(world, rider.id), [13, 4], "the pair's token did not go with the pushed mount");
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id);
  assert.equal(prone(world, rider.id), false);
});

await test("The mount pushed against its will throws a rider who fails the save: prone beside the mount, which stands where the push left the pair.", async () => {
  const { world, hero, rider, mount } = await pair();
  await shove(world, hero, mount.id, "push", 2);
  assert.equal(world.clearDice(), 0);
  assertParted(world, rider, mount, [13, 4]);
  assert.equal(prone(world, rider.id), true, "the thrown rider is not prone");
});

await test("A forced move_token that names the mount is the mount moved against its will: one save, however far it went.", async () => {
  const { world, rider, mount } = await pair();
  world.dice(2);
  const dragged = await world.invoke("move_token", { token: mount.id, x: 16, y: 4, forced: true });
  assert.equal(dragged.ok, true, dragged.error);
  assert.equal(world.clearDice(), 0, "the rider of a dragged mount made no save");
  assert.equal(d20s(world), 1, "the rider saved more than once for one move");
  assertParted(world, rider, mount, [16, 4]);
  assert.equal(prone(world, rider.id), true);
});

await test("Ruling 6: a push that names the rider takes the rider alone out of the saddle, prone where the push ends, with no save; the mount stays.", async () => {
  const { world, hero, rider, mount } = await pair();
  // A die left over would be the save the ruling says is not made.
  await shove(world, hero, rider.id, "push", 20);
  assert.equal(world.clearDice(), 1, "the rider pushed from the saddle made a save to stay on");
  assert.equal(mounted(world, rider), false, "the pushed rider is still mounted");
  assert.deepEqual(at(world, rider.id), [13, 4], "the rider did not end where the push ends");
  assert.deepEqual(at(world, mount.id), [12, 4], "the push at the rider moved the mount it never touched");
  assert.equal(prone(world, rider.id), true, "the rider pushed from the saddle did not land prone");
  assert.equal(prone(world, mount.id), false);
});

await test("Ruling 6: a push that would end inside a Large mount's space sets the rider down in the nearest open square just outside it.", async () => {
  const { world, hero, rider, mount } = await pair({ mount: "warhorse" });
  // The warhorse holds (12,4) to (13,5); the push from (11,4) ends at (13,4).
  await shove(world, hero, rider.id, "push");
  assert.equal(mounted(world, rider), false);
  assert.deepEqual(at(world, mount.id), [12, 4]);
  const fallen = ownToken(world, rider.id);
  const inside = fallen.x >= 12 && fallen.x <= 13 && fallen.y >= 4 && fallen.y <= 5;
  assert.equal(inside, false, `the rider lies at (${fallen.x},${fallen.y}), inside its mount's space`);
  assert.ok(beside(fallen, { x: 12, y: 4 }, 2), `the rider at (${fallen.x},${fallen.y}) is not just outside the mount`);
  assert.ok(Math.max(Math.abs(fallen.x - 13), Math.abs(fallen.y - 4)) <= 1, "the rider is not in the open square nearest where the push ended");
  assert.equal(prone(world, rider.id), true);
});

await test("Ruling 6: a forced move_token that names the rider carries the rider alone to that square, prone, and leaves the mount.", async () => {
  const { world, rider, mount } = await pair();
  world.dice(20);
  const thrown = await world.invoke("move_token", { token: rider.id, x: 15, y: 6, forced: true });
  assert.equal(thrown.ok, true, thrown.error);
  assert.equal(world.clearDice(), 1, "a rider carried from the saddle made a save");
  assert.match(thrown.result.note ?? "", /out of the saddle/);
  assert.deepEqual(at(world, rider.id), [15, 6]);
  assert.deepEqual(at(world, mount.id), [12, 4]);
  assert.equal(mounted(world, rider), false);
  assert.equal(prone(world, rider.id), true);
});

await test("Ruling 6: a pull that names the rider draws the rider alone out of the saddle, and a pull that names the mount draws the pair, whose rider then saves.", async () => {
  const { world, hero, rider, mount } = await pair();
  await layMap(world, OPEN(), { [hero.id]: { x: 8, y: 4 }, [rider.id]: { x: 12, y: 4 } });
  const campaign = world.campaign();
  const encounterId = world.encounter().id;
  // The mount first: the pair comes a square nearer, and the rider is asked.
  assert.equal(pullTokenToward(campaign, encounterId, hero.id, mount.id).moved, true);
  assert.deepEqual(at(world, rider.id), [11, 4], "the pull at the mount did not draw the pair's token");
  assert.equal(ownToken(world, mount.id), null);
  world.diceLog();
  world.dice(15);
  assert.match(settleEnemyRiders(campaign, [])[0] ?? "", /kept its seat/);
  assert.equal(world.clearDice(), 0, "the rider of a pulled mount made no save");
  // Then the rider, in a call of its own: out of the saddle, with no save.
  const drawn = pullTokenToward(campaign, encounterId, hero.id, rider.id);
  assert.equal(drawn.moved, true, drawn.reason);
  assert.deepEqual(at(world, rider.id), [10, 4], "the rider did not end where the pull ends");
  assert.deepEqual(at(world, mount.id), [11, 4], "the pull at the rider moved its mount");
  assert.equal(mounted(world, rider), false);
  assert.equal(prone(world, rider.id), true);
  world.dice(20);
  settleEnemyRiders(campaign, []);
  assert.equal(world.clearDice(), 1, "a rider pulled from the saddle made a save");
});

await test("Ruling 6: both pushed together move as the pair, and the rider saves once.", async () => {
  const { world, hero, rider, mount } = await pair();
  const campaign = world.campaign();
  const encounterId = world.encounter().id;
  assert.equal(pushTokenAway(campaign, encounterId, hero.id, mount.id).moved, true);
  const second = pushTokenAway(campaign, encounterId, hero.id, rider.id);
  assert.equal(second.moved, false, "the rider was pushed again after its mount carried it");
  assert.match(second.reason, /pair moved as one/);
  world.diceLog();
  world.dice(15);
  const lines = settleEnemyRiders(campaign, []);
  assert.equal(world.clearDice(), 0);
  assert.equal(d20s(world), 1, "the rider saved more than once");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /kept its seat/);
  assert.deepEqual(at(world, rider.id), [13, 4]);
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id);
});

await test("The mount knocked prone: its rider spends its reaction to land on its feet beside it, with no save.", async () => {
  const { world, hero, rider, mount } = await pair();
  await shove(world, hero, mount.id, "prone", 20);
  assert.equal(world.clearDice(), 1, "the rider of a fallen mount was asked a save");
  assertParted(world, rider, mount);
  assert.equal(prone(world, mount.id), true);
  assert.equal(prone(world, rider.id), false, "a rider with its reaction fell prone");
  assert.ok(world.encounter().reactionsUsed.includes(rider.id), "landing on its feet cost the rider no reaction");
});

await test("The mount knocked prone under a rider with no reaction left: the rider falls prone within 5 feet.", async () => {
  const { world, hero, rider, mount } = await pair();
  saveEncounter({ ...world.encounter(), reactionsUsed: [rider.id] });
  await shove(world, hero, mount.id, "prone");
  assertParted(world, rider, mount);
  assert.equal(prone(world, rider.id), true, "a rider with no reaction landed on its feet");
});

await test("The mount dropped to 0: its rider lands on its feet with its reaction, and the result of the blow says so.", async () => {
  const { world, rider, mount } = await pair();
  const slain = await world.invoke("damage_enemy", { enemyId: mount.id, amount: 99, reason: "test" });
  assert.equal(slain.ok, true, slain.error);
  assert.match(slain.result.pair ?? "", /spends its reaction/, JSON.stringify(slain.result));
  assert.equal(mounted(world, rider), false);
  assert.deepEqual(at(world, rider.id), [12, 4]);
  assert.equal(prone(world, rider.id), false);
  assert.ok(world.encounter().reactionsUsed.includes(rider.id), "the reaction was not spent");
});

await test("The mount dropped to 0 under a rider that cannot react: the rider falls prone, and no reaction is spent.", async () => {
  const { world, rider, mount } = await pair();
  const held = await world.invoke("set_condition", { enemyId: rider.id, condition: "paralyzed", reason: "test" });
  assert.equal(held.ok, true, held.error);
  const slain = await world.invoke("damage_enemy", { enemyId: mount.id, amount: 99, reason: "test" });
  assert.equal(slain.ok, true, slain.error);
  assert.match(slain.result.pair ?? "", /falls prone/, JSON.stringify(slain.result));
  assert.equal(prone(world, rider.id), true, "a paralyzed rider landed on its feet");
  assert.equal(world.encounter().reactionsUsed.includes(rider.id), false);
});

for (const condition of ["paralyzed", "stunned", "petrified"]) {
  await test(`The check asked with the rulings: a ${condition} rider fails the save with no die rolled when its mount is moved.`, async () => {
    const { world, rider, mount } = await pair();
    const laid = await world.invoke("set_condition", { enemyId: rider.id, condition, reason: "test" });
    assert.equal(laid.ok, true, laid.error);
    assert.equal(live(world, rider.id).ridesEnemyId, mount.id, `${condition} alone took the rider off`);
    world.diceLog();
    world.dice(20);
    const dragged = await world.invoke("move_token", { token: mount.id, x: 14, y: 4, forced: true });
    assert.equal(dragged.ok, true, dragged.error);
    assert.equal(world.clearDice(), 1, `a ${condition} rider rolled the save`);
    assert.equal(d20s(world), 0);
    assertParted(world, rider, mount, [14, 4]);
    assert.equal(prone(world, rider.id), true);
  });
}

await test("The check asked with the rulings: a rider that falls unconscious drops prone and fails the save with no die, so it always falls.", async () => {
  const { world, rider, mount } = await pair();
  world.dice(20);
  const laid = await world.invoke("set_condition", { enemyId: rider.id, condition: "unconscious", reason: "a sleeping draught" });
  assert.equal(laid.ok, true, laid.error);
  assert.equal(world.clearDice(), 1, "an unconscious rider rolled the save");
  assertParted(world, rider, mount);
  assert.equal(prone(world, rider.id), true);
});

await test("The check asked with the rulings: a mount that Disengages provokes nothing, so neither it nor its rider is struck as the pair leaves a hero's reach.", async () => {
  const { world, hero, rider, mount } = await pair();
  turnOf(world, mount.id);
  const hp = [live(world, rider.id).currentHp, live(world, mount.id).currentHp];
  world.diceLog();
  const away = await world.invoke("move_token", { token: mount.id, x: 18, y: 4, disengage: true });
  assert.equal(away.ok, true, away.error);
  assert.ok(away.result.disengaged, "the walk says nothing of the Disengage");
  assert.equal(away.result.opportunityAttacks, undefined, "the pair was struck as it left");
  assert.equal(d20s(world), 0, "an attack was rolled against the pair");
  assert.deepEqual([live(world, rider.id).currentHp, live(world, mount.id).currentHp], hp);
  assert.equal(world.encounter().reactionsUsed.includes(hero.id), false, "the hero's reaction was spent");
  assert.deepEqual(at(world, rider.id), [18, 4]);
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id, "a walk the mount chose asked its rider to save");
});

await test("Without the Disengage the same walk is struck: the check above is not passing for want of anyone to strike.", async () => {
  const { world, mount } = await pair();
  turnOf(world, mount.id);
  world.dice(2);
  const away = await world.invoke("move_token", { token: mount.id, x: 18, y: 4 });
  world.clearDice();
  assert.equal(away.ok, true, away.error);
  assert.ok(away.result.opportunityAttacks?.length, `leaving a hero's reach drew no opportunity attack: ${JSON.stringify(away.result)}`);
});

await test("Undoing the GM turn that pushed a rider out of the saddle puts the pair back on its one token.", async () => {
  const { world, hero, rider, mount } = await pair();
  const before = snapshot();
  const out = await shove(world, hero, rider.id, "push");
  assert.equal(mounted(world, rider), false);
  await revertTurn(world, out.turnId);
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id, "the undo left the rider on foot");
  assert.deepEqual(at(world, rider.id), [12, 4]);
  assert.equal(ownToken(world, mount.id), null, "the mount kept the token the undone turn gave it");
  assert.equal(prone(world, rider.id), false, "the undo left the rider prone");
});

// ---- the other doors that push: a spell's area, a thrown foe, a psionic push ----

const gust = (world, druid, ...enemyIds) =>
  world.invoke("aoe_damage", { casterCharacterId: druid.id, spell: "Gust of Wind", enemyIds, saveAbility: "str", dc: 15, level: 2 });
const DRUID = () => caster("druid", "wis", ["Gust of Wind"]);

await test("A spell that pushes as it is cast (Gust of Wind) carries the pair when it names the mount, and its rider saves once as the call finishes.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: DRUID() });
  // The wolf's Strength save against the wind, then the goblin's to stay on.
  world.dice(1, 2);
  const out = await gust(world, hero, mount.id);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 0, "the rider of a mount the wind pushed made no save");
  assertParted(world, rider, mount, [15, 4]);
  assert.equal(prone(world, rider.id), true);
});

await test("Ruling 6 for a spell that pushes as it is cast: the wind that names the rider takes it alone out of the saddle, with no save to stay on.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: DRUID() });
  world.dice(1, 20);
  const out = await gust(world, hero, rider.id);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 1, "the rider the wind took made a save to stay on");
  assert.equal(mounted(world, rider), false, "the rider the wind took is still mounted");
  assert.deepEqual(at(world, rider.id), [15, 4]);
  assert.deepEqual(at(world, mount.id), [12, 4], "the wind at the rider moved the mount");
  assert.equal(prone(world, rider.id), true);
});

await test("Ruling 6 for a spell that pushes as it is cast: the wind that names the mount and then its rider moves the pair as one, and the rider saves once.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: DRUID() });
  // Each one's Strength save, then the one save to stay on.
  world.dice(1, 1, 15);
  const out = await gust(world, hero, mount.id, rider.id);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 0);
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id, "a made save took the rider off");
  assert.deepEqual(at(world, rider.id), [15, 4], "the pair was not pushed once, as one");
  assert.equal(ownToken(world, mount.id), null);
});

// Gust of Wind left standing: "Each creature that starts its turn in the
// line must succeed on a Strength saving throw or be pushed 15 feet away
// from you." The line runs east from the druid at (11,4), over the pair.
function windOver(world, druid) {
  const map = mapOf(world);
  const cells = [12, 13, 14, 15, 16, 17, 18].map((x) => 4 * map.width + x);
  saveZones(map.id, [{ id: "gust-pair", spell: "Gust of Wind", casterId: druid.id, casterKind: "pc", casterName: druid.name, origin: { x: 11, y: 4 }, toward: { x: 20, y: 4 }, cells, concentration: false, castRound: world.encounter().round, untilRound: null, slotLevel: 2, dc: 15 }]);
}
const turnStartsFor = (world, enemyId) => onPersonsTurn(world.campaign(), () => zoneTurnStart(world.campaign(), world.encounter(), [enemyId]));

await test("A mount whose turn starts in a standing area that pushes is pushed with its rider on it, who saves once to stay on.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: DRUID() });
  windOver(world, hero);
  world.dice(1, 2);
  const lines = turnStartsFor(world, mount.id);
  assert.equal(world.clearDice(), 0, `the wind asked the mount no save, or its rider none to stay on: ${JSON.stringify(lines)}`);
  assertParted(world, rider, mount, [15, 4]);
  assert.equal(prone(world, rider.id), true);
});

await test("Ruling 6 in a standing area: a rider whose turn starts in the wind is pushed alone out of the saddle, with no save to stay on.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: DRUID() });
  windOver(world, hero);
  world.dice(1, 20);
  turnStartsFor(world, rider.id);
  assert.equal(world.clearDice(), 1, "the rider the wind took made a save to stay on");
  assert.equal(mounted(world, rider), false, "the rider the wind took is still mounted");
  assert.deepEqual(at(world, rider.id), [15, 4]);
  assert.deepEqual(at(world, mount.id), [12, 4], "the wind at the rider moved the mount");
  assert.equal(prone(world, rider.id), true);
});

const rage = (world, hero) => {
  const sheet = world.sheet(hero.id);
  world.patch(hero.id, { conditions: [...sheet.conditions, "raging"], conditionMeta: { ...sheet.conditionMeta, raging: { rounds: 10 } } });
};
const impel = (world, hero, targetId) => world.invoke("use_resource", { characterId: hero.id, resource: "Mighty Impel", targetEnemyId: targetId });
const GIANT = () => MARTIAL("barbarian", "Path of the Giant", 10, "Greataxe");

await test("A thrown mount (Mighty Impel) lands with its rider on it, who saves once to stay on.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: GIANT() });
  rage(world, hero);
  world.dice(2, 2);
  const out = await impel(world, hero, mount.id);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false, JSON.stringify(out.result));
  assert.equal(world.clearDice(), 0, "the rider of a thrown mount made no save");
  // Thirty feet from the barbarian at (11,4), along the line through the pair.
  assertParted(world, rider, mount, [17, 4]);
  assert.equal(prone(world, rider.id), true);
});

await test("Ruling 6 for a thrown foe: Mighty Impel at the rider throws it alone from the saddle, prone where it lands, and the mount stays.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: GIANT() });
  rage(world, hero);
  world.dice(2, 20);
  const out = await impel(world, hero, rider.id);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false, JSON.stringify(out.result));
  assert.equal(world.clearDice(), 1, "the thrown rider made a save to stay on");
  assert.equal(mounted(world, rider), false);
  assert.deepEqual(at(world, rider.id), [17, 4]);
  assert.deepEqual(at(world, mount.id), [12, 4], "the throw at the rider moved the mount");
  assert.equal(prone(world, rider.id), true);
});

const PSI = () => MARTIAL("fighter", "Psi Warrior", 15, "Longsword");
// Telekinetic Thrust follows a Psionic Strike, which follows a weapon hit:
// both are landed on the creature first, sturdy enough to stand them.
async function thrust(world, hero, rider, mount, target, ...then) {
  const kit = await combatKit(world);
  for (const enemy of [rider, mount]) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  world.dice(15, 4, 4, 4, 4);
  const hit = await world.invoke("pc_attack", { characterId: hero.id, enemyId: target.id, targetEnemyId: target.id });
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  world.dice(4, 4, 4);
  const strike = await world.invoke("use_resource", { characterId: hero.id, resource: "Psionic Strike", targetEnemyId: target.id });
  world.clearDice();
  assert.equal(strike.ok, true, strike.error);
  world.diceLog();
  world.dice(2, ...then);
  const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Telekinetic Adept", variant: "push", targetEnemyId: target.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false, JSON.stringify(out.result));
  return out;
}

await test("A psionic push at the mount (Telekinetic Thrust) carries the pair 10 feet, and its rider saves once to stay on.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: PSI() });
  await thrust(world, hero, rider, mount, mount, 2);
  assert.equal(world.clearDice(), 0, "the rider of a mount pushed by Telekinetic Thrust made no save");
  assertParted(world, rider, mount, [14, 4]);
  assert.equal(prone(world, rider.id), true);
});

await test("Ruling 6 for a psionic push: Telekinetic Thrust at the rider pushes it alone from the saddle, prone, and the mount stays.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: PSI() });
  await thrust(world, hero, rider, mount, rider, 20);
  assert.equal(world.clearDice(), 1, "the rider pushed from the saddle made a save to stay on");
  assert.equal(mounted(world, rider), false);
  assert.deepEqual(at(world, rider.id), [14, 4]);
  assert.deepEqual(at(world, mount.id), [12, 4], "the push at the rider moved the mount");
  assert.equal(prone(world, rider.id), true);
});

// ---- a mount an area holds ----

await test("A mount the webs catch as it walks is held on the square it was caught on, its rider still on its back.", async () => {
  const { world, hero, rider, mount } = await pair({ hero: caster("wizard", "int", ["Web"]) });
  const cast = await world.invoke("use_spell_slot", { characterId: hero.id, spell: "Web", level: 2, atX: 16, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const web = zonesOf(world).find((zone) => zone.spell === "Web");
  const width = mapOf(world).width;
  const columns = web.cells.filter((cell) => Math.floor(cell / width) === 4).map((cell) => cell % width).sort((a, b) => a - b);
  const [entry, further] = columns;
  assert.ok(entry > 12 && further === entry + 1, `setup: the webs lie on columns ${columns.join(",")} of the pair's row`);
  turnOf(world, mount.id);
  // The wolf's Dexterity save against the webs. The Disengage keeps the
  // hero's opportunity attack out of the dice.
  world.dice(1);
  const out = await world.invoke("move_token", { token: mount.id, x: further, y: 4, disengage: true });
  assert.equal(world.clearDice(), 0, "the mount walked into the webs with no save");
  assert.equal(out.ok, true, out.error);
  assert.ok(live(world, mount.id).conditions.includes("restrained"), "the webs did not hold the mount");
  assert.deepEqual(at(world, rider.id), [entry, 4], "the restrained mount walked on past the square the webs caught it on");
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id, "a mount held by the webs lost its rider");
  assert.equal(ownToken(world, mount.id), null);
});

// ---- a turn passed outside an engine call ----

// Earthquake laid over the pair by a cleric 50 feet off, every save of the
// cast made, the pointer on the cleric with nothing owed before them. The
// ground shakes as the cleric's turn ends, and every save then fails.
async function quakeOverPair() {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(caster("cleric", "wis", ["Earthquake"], [], 15));
  await world.beginFight([{ monster: "goblin", mount: "wolf" }]);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const mount = world.enemies().find((enemy) => enemy.id === rider.ridesEnemyId);
  await layMap(world, OPEN(), { [hero.id]: { x: 2, y: 4 }, [rider.id]: { x: 12, y: 4 } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  saveEncounter({ ...encounter, order: [entry(hero.id), entry(rider.id), entry(mount.id)], turnIndex: 0, turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [] } });
  world.dice(...new Array(12).fill(20));
  const cast = await world.invoke("use_spell_slot", { characterId: hero.id, spell: "Earthquake", level: 8, atX: 12, atY: 4 });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.ok(zonesOf(world).some((zone) => zone.spell === "Earthquake"), "setup: the area is laid");
  const now = world.encounter();
  saveEncounter({ ...now, turnIndex: 0, turnBudget: null, legendary: { ...now.legendary, due: [] } });
  world.dice(...new Array(8).fill(1));
  return { world, hero, rider, mount };
}

await test("A mount the ground throws down as its caster's player ends their turn drops its rider then, where nobody was asked and the goblin sat on its fallen wolf.", async () => {
  const { world, hero, rider, mount } = await quakeOverPair();
  assert.equal(endOwnTurn(world.campaignId, hero.userId ?? world.owner.id), true, "setup: the player's End Turn was refused");
  world.clearDice();
  assert.ok(prone(world, mount.id), "setup: the mount kept its feet");
  assertParted(world, rider, mount);
  assert.ok(prone(world, rider.id), "the rider stands, though the ground threw it down too");
  assert.ok(!world.encounter().reactionsUsed.includes(rider.id), "a rider already prone spent its reaction to land on its feet");
});

await test("A mount the ground throws down as the party lead skips its caster's turn drops its rider then.", async () => {
  const { world, rider, mount } = await quakeOverPair();
  assert.equal(skipCurrentTurn(world.campaignId), true, "setup: the skip was refused");
  world.clearDice();
  assert.ok(prone(world, mount.id), "setup: the mount kept its feet");
  assertParted(world, rider, mount);
});

closeTables();
finish();
