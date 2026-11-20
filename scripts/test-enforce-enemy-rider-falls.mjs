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
import { caster, closeTables } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";
import { mapOf, OPEN, tokenOf } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-enforce-enemy-rider-falls");
const { listTokens } = await import("../src/lib/db/battle-maps.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { settleEnemyRiders } = await import("../src/lib/dm/enemy-rider-falls.ts");
const { pushTokenAway } = await import("../src/lib/dm/map-tools.ts");

const HERO = () => caster("paladin", "cha", [], [], 5, { speed: 30 });
const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;
const at = (world, refId) => [ownToken(world, refId)?.x, ownToken(world, refId)?.y];
const live = (world, id) => world.enemies().find((enemy) => enemy.id === id);
const prone = (world, id) => live(world, id).conditions.includes("prone");
const mounted = (world, rider) => live(world, rider.id).ridesEnemyId !== undefined;
const beside = (a, b, wide = 1) => a.x >= b.x - 1 && a.x <= b.x + wide && a.y >= b.y - 1 && a.y <= b.y + wide;
const d20s = (world) => world.diceLog().filter((die) => die.sides === 20).length;

// A hero at (11,4) beside a rider on its mount at (12,4), on an open board.
// The order is the hero, the rider, the mount, with the pointer on the hero.
async function pair({ mount = "wolf" } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(HERO());
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

closeTables();
finish();
