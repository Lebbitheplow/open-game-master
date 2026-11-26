// An enemy gets on and off a mount in the middle of a fight (issue 1091).
//
// "Once during your move, you can mount a creature that is within 5 feet of
// you or dismount. Doing so costs an amount of movement equal to half your
// speed." "A willing creature that is at least one size larger than you and
// that has an appropriate anatomy can serve as a mount" (SRD 5.1, Mounting
// and Dismounting).
//
// mount_up and dismount take an enemy's id in characterId. What each test
// holds, by the ruling on the issue it follows:
//   1. one field, told in its description, and left out of the 16K set;
//   2. enemies mount enemies only: a riderless enemy of the same side, a size
//      larger, within 5 feet of any square it fills, not incapacitated, not
//      prone;
//   3. half the rider's own speed, once a move, on its own turn; refused off
//      it for the GM's tools and free at the console; never at speed 0;
//   4. the pair has no movement until the mount's next turn refills it;
//   5. independent unless controlled, which takes the mount out of the order;
//   6. the pair in the mount's space, the rider set down on an open square
//      beside it, and an opportunity attack for a reach it leaves.
// Dice forced where a roll decides anything.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";
import { mapOf, nextTurn, OPEN, tokenOf } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-enforce-enemy-midfight-mounting");
const { listTokens, resetTurnBudgets } = await import("../src/lib/db/battle-maps.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { patchEnemyConditions, patchEnemyHp, saveEncounter, setEncounterSides } = await import("../src/lib/db/encounters.ts");
const { enemyActedThisRound } = await import("../src/lib/dm/can-act.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { mountTools } = await import("../src/lib/dm/mount-tools.ts");
const { compactTool, COMPACT_OMITS } = await import("../src/lib/dm/tool-profiles.ts");
const { buildEncounterState } = await import("../src/lib/dm/turn.ts");
const { leavesReachAt } = await import("../src/lib/dm/opportunity-reach-logic.ts");

const HERO = (name) => ({ ...caster("paladin", "cha", [], [], 5, { speed: 30 }), ...(name ? { name } : {}) });
const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;
const at = (world, refId) => [tokenOf(world, refId).x, tokenOf(world, refId).y];
const live = (world, id) => world.enemies().find((enemy) => enemy.id === id);
const orderIds = (world) => world.encounter().order.map((entry) => entry.characterId ?? entry.enemyId);
const lay = (world, id, ...conditions) => patchEnemyConditions(id, conditions, {});
const ai = (world, turn, name, args) => invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });

// A hero, a creature on foot and a riderless creature beside it, far from the
// hero on an open board. `first` says which of the two enemies comes first in
// the order, after the hero; the pointer rests on the hero.
async function afoot({ rider = "goblin", mount = "wolf", first = "rider", riderAt = { x: 12, y: 4 }, mountAt = { x: 13, y: 4 }, heroAt = { x: 2, y: 1 }, extra = [], rows = OPEN() } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(HERO("Hero 1"));
  await world.beginFight([{ monster: rider, name: "Rider" }, { monster: mount, name: "Steed" }, ...extra.map((monster, index) => ({ monster, name: `Other ${index + 1}` }))]);
  const riderRow = world.enemies().find((enemy) => enemy.displayName === "Rider");
  const mountRow = world.enemies().find((enemy) => enemy.displayName === "Steed");
  assert.ok(riderRow && mountRow, `setup: the fight has no two creatures to pair: ${world.enemies().map((enemy) => enemy.displayName).join(", ")}`);
  const rest = world.enemies().filter((enemy) => enemy.id !== riderRow.id && enemy.id !== mountRow.id);
  await layMap(world, rows, { [hero.id]: heroAt, [riderRow.id]: riderAt, [mountRow.id]: mountAt, ...Object.fromEntries(rest.map((enemy, index) => [enemy.id, { x: 20, y: 1 + index * 2 }])) });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  const pairOrder = first === "rider" ? [riderRow.id, mountRow.id] : [mountRow.id, riderRow.id];
  const order = [entry(hero.id), ...pairOrder.map(entry), ...rest.map((enemy) => entry(enemy.id))].filter(Boolean);
  saveEncounter({ ...encounter, order, turnIndex: 0, turnBudget: null });
  return { world, hero, rider: riderRow, mount: mountRow, rest };
}

// The pointer rests on this enemy's place in the order.
function turnOf(world, enemyId) {
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === enemyId), turnBudget: null });
}

const mountUp = (world, rider, mount, more = {}) => world.invoke("mount_up", { characterId: rider.id, mount: mount.id, ...more });
const getDown = (world, rider, more = {}) => world.invoke("dismount", { characterId: rider.id, ...more });
const mounted = (world, rider, mount) => live(world, rider.id).ridesEnemyId === mount.id;

// ---- ruling 1: one field ----

await test("Ruling 1: mount_up takes an enemy's id in characterId and puts it on the enemy that mount names, on one token in the mount's space.", async () => {
  const { world, rider, mount } = await afoot();
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, `an enemy's id in characterId was refused: ${up.error}`);
  assert.equal(mounted(world, rider, mount), true, "the rider's row does not name its mount");
  assert.deepEqual(at(world, rider.id), [13, 4], "the pair does not stand in the mount's space");
  assert.equal(ownToken(world, mount.id), null, "the mount kept a token of its own");
  assert.equal(listTokens(mapOf(world).id).filter((token) => token.kind === "enemy").length, 1, "the pair stands on more than one token");
  assert.equal(up.result.mounted, mount.displayName);
  assert.equal(live(world, mount.id).ledBy, undefined, "a pair made with no controlled is steered");
});

await test("Ruling 1: the mount is named by its name on the tracker as well as by its enemyId.", async () => {
  const { world, rider, mount } = await afoot();
  turnOf(world, rider.id);
  const up = await world.invoke("mount_up", { characterId: rider.id, mount: mount.displayName });
  assert.equal(up.ok, true, up.error);
  assert.equal(mounted(world, rider, mount), true);
});

await test("Ruling 1: the field's description says it takes a character's or an enemy's id, and the 16K set leaves that and the landing square out.", () => {
  for (const name of ["mount_up", "dismount"]) {
    const tool = mountTools.find((entry) => entry.function.name === name);
    const field = tool.function.parameters.properties.characterId.description;
    assert.match(field, /a character's or an enemy's id/i, `${name}: the description does not say an enemy's id is taken`);
    const compact = compactTool(tool);
    assert.equal(compact.function.parameters.properties.characterId.description, "Exact characterId from GAME STATE.", `${name}: the 16K set carries the enemy's words`);
    assert.equal(Object.keys(tool.function.parameters.properties).includes("enemyId"), false, `${name} grew a second field for the enemy`);
  }
  assert.deepEqual(COMPACT_OMITS.dismount, ["x", "y"]);
  assert.equal("x" in compactTool(mountTools.find((entry) => entry.function.name === "dismount")).function.parameters.properties, false, "the 16K set carries the landing square");
});

await test("An id that is neither a character's nor an enemy's is still refused as an unknown characterId, and an enemy's with no mount named is told what to send.", async () => {
  const { world, rider } = await afoot();
  const nobody = await world.invoke("mount_up", { characterId: "no-such-creature", mount: "Riding horse" });
  assert.equal(nobody.ok, false);
  assert.match(nobody.error, /Unknown characterId/);
  const bare = await world.invoke("mount_up", { characterId: rider.id });
  assert.equal(bare.ok, false);
  assert.match(bare.error, /needs mount: the enemyId of a riderless enemy/);
});

await test("GAME STATE and the call's result say who rides whom in the words a pair made as the fight opened has.", async () => {
  const { world, rider, mount } = await afoot();
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, up.error);
  assert.match(up.result.rides, new RegExp(`${mount.displayName} \\(enemyId=${mount.id}\\): one token for the pair, moved by ${mount.displayName}'s move_token on its own turn`));
  const state = buildEncounterState(world.campaignId, world.sheets());
  const riderLine = state.enemies.find((enemy) => enemy.enemyId === rider.id).pair;
  const mountLine = state.enemies.find((enemy) => enemy.enemyId === mount.id).pair;
  assert.match(riderLine, new RegExp(`rides ${mount.displayName} \\[enemyId=${mount.id}\\]: one token for the pair, no movement of its own`));
  assert.match(mountLine, new RegExp(`carries ${rider.displayName} \\[enemyId=${rider.id}\\]`));
  const down = await getDown(world, rider);
  void down;
});

// ---- ruling 2: what an enemy may mount ----

await test("Ruling 2: a character's mount on record, a creature on the party's side and an enemy that fights for the party are each refused with the reason.", async () => {
  const { world, hero, rider, mount } = await afoot();
  const horse = await world.invoke("mount_up", { characterId: hero.id, mount: "Riding horse" });
  assert.equal(horse.ok, true, `setup: the hero could not mount: ${horse.error}`);
  turnOf(world, rider.id);
  const kept = await world.invoke("mount_up", { characterId: rider.id, mount: "Riding horse" });
  assert.equal(kept.ok, false, "an enemy mounted a character's horse");
  assert.match(kept.error, new RegExp(`is ${hero.name}'s mount and will not carry ${rider.displayName}`));
  assert.match(kept.error, /only a willing creature serves as a mount/);
  const friend = await world.invoke("mount_up", { characterId: rider.id, mount: hero.id });
  assert.equal(friend.ok, false, "an enemy mounted a creature of the party's");
  assert.match(friend.error, /is on the party's side and will not carry/);
  // The wolf turns: it fights beside the party now.
  setEncounterSides(world.encounter().id, { ...world.encounter().sides, [mount.id]: "party" });
  const turned = await mountUp(world, rider, mount);
  assert.equal(turned.ok, false, "an enemy mounted a creature that fights for the party");
  assert.match(turned.error, /fights on the other side and will not carry/);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 0, "a refused mount spent movement");
});

await test("Ruling 2: the size rule is read from the two stat blocks, and a mount no larger than its rider is refused.", async () => {
  const same = await afoot({ rider: "goblin", mount: "goblin" });
  turnOf(same.world, same.rider.id);
  const small = await mountUp(same.world, same.rider, same.mount);
  assert.equal(small.ok, false, "a Small creature mounted a Small one");
  assert.match(small.error, /\(Small\) cannot carry .* \(Small\): a mount is at least one size larger than its rider/);
  const even = await afoot({ rider: "hobgoblin", mount: "wolf" });
  turnOf(even.world, even.rider.id);
  const medium = await mountUp(even.world, even.rider, even.mount);
  assert.equal(medium.ok, false, "a Medium creature mounted a Medium one");
  assert.match(medium.error, /at least one size larger/);
});

await test("Ruling 2: a mount that already carries a rider takes no second one, and neither half of a pair mounts anything.", async () => {
  const { world, rider, mount, rest } = await afoot({ extra: ["goblin"] });
  const [second] = rest;
  await layMap(world, OPEN(), { [world.sheets()[0].id]: { x: 2, y: 1 }, [rider.id]: { x: 12, y: 4 }, [mount.id]: { x: 13, y: 4 }, [second.id]: { x: 14, y: 4 } });
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  turnOf(world, second.id);
  const crowd = await mountUp(world, second, mount);
  assert.equal(crowd.ok, false, "a second rider got on");
  assert.match(crowd.error, new RegExp(`${mount.displayName} already carries ${rider.displayName}: a mount takes one rider`));
  const again = await mountUp(world, rider, mount);
  assert.equal(again.ok, false);
  assert.match(again.error, /already rides/);
  const stack = await world.invoke("mount_up", { characterId: mount.id, mount: second.id });
  assert.equal(stack.ok, false, "a mount with a rider on its back mounted another creature");
  assert.match(stack.error, new RegExp(`carries ${rider.displayName} and rides nothing`));
});

await test("Ruling 2: within 5 feet is measured to any square a Large mount fills, and a mount further off is refused with the distance.", async () => {
  // A warhorse fills (13,4) to (14,5). The rider stands off its far corner.
  const near = await afoot({ rider: "hobgoblin", mount: "warhorse", riderAt: { x: 15, y: 6 }, mountAt: { x: 13, y: 4 } });
  turnOf(near.world, near.rider.id);
  const up = await mountUp(near.world, near.rider, near.mount);
  assert.equal(up.ok, true, `a rider beside the mount's far corner was refused: ${up.error}`);
  assert.deepEqual(at(near.world, near.rider.id), [13, 4], "the pair does not stand in the warhorse's space");
  const far = await afoot({ rider: "hobgoblin", mount: "warhorse", riderAt: { x: 16, y: 6 }, mountAt: { x: 13, y: 4 } });
  turnOf(far.world, far.rider.id);
  const off = await mountUp(far.world, far.rider, far.mount);
  assert.equal(off.ok, false, "a rider 10 feet from the mount got on");
  assert.match(off.error, /is 10 feet from .*: a creature is mounted from within 5 feet of it/);
  assert.equal(tokenOf(far.world, far.rider.id).movedThisRound, 0);
});

await test("Ruling 2: an incapacitated mount and a prone one are refused; a mount that is only grappled or restrained can be mounted.", async () => {
  for (const [condition, words] of [["stunned", /is stunned and cannot serve as a mount/], ["unconscious", /is unconscious and cannot serve as a mount/], ["prone", /is prone: .* nobody gets on until it stands/]]) {
    const { world, rider, mount } = await afoot();
    lay(world, mount.id, condition);
    turnOf(world, rider.id);
    const up = await mountUp(world, rider, mount);
    assert.equal(up.ok, false, `a ${condition} mount was mounted`);
    assert.match(up.error, words);
    assert.equal(live(world, rider.id).ridesEnemyId, undefined);
  }
  for (const condition of ["grappled", "restrained"]) {
    const { world, rider, mount } = await afoot();
    lay(world, mount.id, condition);
    turnOf(world, rider.id);
    const up = await mountUp(world, rider, mount);
    assert.equal(up.ok, true, `a ${condition} mount could not be mounted: ${up.error}`);
    assert.equal(mounted(world, rider, mount), true);
  }
});

await test("A prone rider stands first: mounting from prone is refused with the reason, and nothing is spent.", async () => {
  const { world, rider, mount } = await afoot();
  lay(world, rider.id, "prone");
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, false, "a prone creature mounted");
  assert.match(up.error, /is prone and stands first, for half its speed, before it mounts/);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 0);
});

// ---- ruling 3: the cost ----

await test("Ruling 3: mounting costs half the rider's own speed and ends its own movement for the turn; it still acts from the saddle.", async () => {
  const { world, hero, rider, mount } = await afoot({ riderAt: { x: 12, y: 4 }, mountAt: { x: 13, y: 4 }, heroAt: { x: 14, y: 4 } });
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, up.error);
  assert.equal(up.result.movementSpent, 15, "a goblin's mount did not cost half of its 30 feet");
  const own = await world.invoke("move_token", { token: rider.id, x: 12, y: 6 });
  assert.equal(own.ok, false, "the rider walked on its own legs after mounting");
  assert.match(own.error, /has no movement of its own/);
  world.dice(2);
  const cut = await world.invoke("enemy_attack", { enemyId: rider.id, targetCharacterId: hero.id, attack: "Scimitar" });
  assert.equal(cut.ok, true, `the rider could not attack from the saddle after mounting: ${cut.error}`);
});

await test("Ruling 3: with less than half its speed left the rider cannot mount, and nothing is spent.", async () => {
  const { world, rider, mount } = await afoot({ riderAt: { x: 8, y: 4 }, mountAt: { x: 13, y: 4 } });
  turnOf(world, rider.id);
  // 20 of its 30 feet walked: 10 left, and the mount costs 15.
  const walk = await world.invoke("move_token", { token: rider.id, x: 12, y: 4 });
  assert.equal(walk.ok, true, walk.error);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, false, "a rider with 10 feet left paid 15");
  assert.match(up.error, /too little movement left this turn to mount: it costs half its speed, 15 ft, and it has 10 ft left/);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 4);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
});

await test("Ruling 3: the half is rounded up to the square, as a character's is: 15 feet of speed pays 10.", async () => {
  // Half of 15 feet is 7.5: two squares are spent, as standing up rounds.
  const { world, rider, mount } = await afoot();
  lay(world, rider.id, "slowed");
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, up.error);
  assert.equal(up.result.movementSpent, 10, `a slowed goblin's 15 feet did not round its half up to two squares: ${JSON.stringify(up.result)}`);
});

await test("Ruling 3: once a move. A rider that mounted this turn does not get down in it, and one that got down does not mount again.", async () => {
  const { world, rider, mount } = await afoot();
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  const down = await getDown(world, rider);
  assert.equal(down.ok, false, "a rider mounted and dismounted in one move");
  assert.match(down.error, /already mounted or dismounted during this move: that is once a move/);
  assert.equal(mounted(world, rider, mount), true);
  // Its next turn: it gets down, and cannot climb back up in the same move.
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  const off = await getDown(world, rider);
  assert.equal(off.ok, true, `the rider could not get down on its next turn: ${off.error}`);
  const back = await mountUp(world, rider, mount);
  assert.equal(back.ok, false, "a rider dismounted and mounted in one move");
  assert.match(back.error, /once a move/);
});

await test("Ruling 3: a rider whose speed is 0 neither mounts nor gets down by choice.", async () => {
  const foot = await afoot();
  lay(foot.world, foot.rider.id, "grappled");
  turnOf(foot.world, foot.rider.id);
  const up = await mountUp(foot.world, foot.rider, foot.mount);
  assert.equal(up.ok, false, "a grappled creature mounted");
  assert.match(up.error, /speed is 0 \(grappled\): it cannot mount by choice/);
  const saddle = await afoot();
  turnOf(saddle.world, saddle.rider.id);
  assert.equal((await mountUp(saddle.world, saddle.rider, saddle.mount)).ok, true);
  saveEncounter({ ...saddle.world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(saddle.world);
  turnOf(saddle.world, saddle.rider.id);
  lay(saddle.world, saddle.rider.id, "restrained");
  const down = await getDown(saddle.world, saddle.rider);
  assert.equal(down.ok, false, "a restrained rider got down by choice");
  assert.match(down.error, /speed is 0 \(restrained\): it cannot get down by choice/);
  assert.equal(mounted(saddle.world, saddle.rider, saddle.mount), true);
});

await test("Ruling 3: off the rider's turn the GM's tools are refused, mounting and getting down, and nothing changes.", async () => {
  const { world, hero, rider, mount } = await afoot();
  const turn = createDmTurn(world.campaignId, [], "ai");
  const early = await ai(world, turn, "mount_up", { characterId: rider.id, mount: mount.id });
  assert.equal(early.ok, false, "the AI mounted an enemy on the hero's turn");
  assert.match(early.error, new RegExp(`${rider.displayName} mounts during its own move only`));
  assert.match(early.error, new RegExp(`it is ${hero.name}'s turn`));
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
  // Handed its turn, as end_turn hands the enemies it passes, it mounts.
  const encounter = world.encounter();
  saveEncounter({ ...encounter, legendary: { ...encounter.legendary, due: [rider.id] } });
  const up = await ai(world, turn, "mount_up", { characterId: rider.id, mount: mount.id });
  assert.equal(up.ok, true, `the AI could not mount an enemy on its own turn: ${up.error}`);
  assert.equal(up.result.movementSpent, 15);
  const later = world.encounter();
  saveEncounter({ ...later, legendary: { ...later.legendary, due: [], turns: undefined } });
  const down = await ai(world, turn, "dismount", { characterId: rider.id });
  assert.equal(down.ok, false, "the AI took an enemy out of the saddle on the hero's turn");
  assert.match(down.error, /dismounts during its own move only/);
  assert.equal(mounted(world, rider, mount), true);
});

await test("Ruling 3: at the console, off the rider's turn, it is free: no movement is charged, and the pair has what the mount has left.", async () => {
  const { world, rider, mount } = await afoot();
  // The pointer rests on the hero: neither enemy's turn has come.
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, `the console was refused off the rider's turn: ${up.error}`);
  assert.equal(up.result.movementSpent, undefined, "movement was charged to a turn that is not running");
  assert.match(up.result.note, /No movement was charged/);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 0);
  const down = await getDown(world, rider);
  assert.equal(down.ok, true, `the console could not take it down off its turn: ${down.error}`);
  assert.equal(down.result.movementSpent, undefined);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 0);
});

// ---- ruling 4: the mount's movement ----

await test("Ruling 4: the mount's turn this round is over, so the pair cannot move, whatever the mount had left, until the mount's next turn refills it.", async () => {
  const { world, rider, mount } = await afoot({ first: "mount", riderAt: { x: 12, y: 4 }, mountAt: { x: 5, y: 4 } });
  // The wolf walks 30 of its 40 feet on its own turn and ends beside the goblin.
  turnOf(world, mount.id);
  const walk = await world.invoke("move_token", { token: mount.id, x: 11, y: 4 });
  assert.equal(walk.ok, true, walk.error);
  assert.equal(tokenOf(world, mount.id).movedThisRound, 6);
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, up.error);
  assert.match(up.result.note, /Movement belongs to a turn: the pair has none until .* next turn starts/);
  const ride = await world.invoke("move_token", { token: mount.id, x: 9, y: 4 });
  assert.equal(ride.ok, false, "the pair rode on the 10 feet the wolf did not use on its own turn");
  assert.match(ride.error, /has no movement left this turn/);
  assert.deepEqual(at(world, rider.id), [11, 4]);
  const state = buildEncounterState(world.campaignId, world.sheets());
  assert.match(state.enemies.find((enemy) => enemy.enemyId === mount.id).moving, /^0 ft left this turn/);
  // The wolf's next turn starts.
  resetTurnBudgets(mapOf(world).id, [mount.id]);
  const next = await world.invoke("move_token", { token: mount.id, x: 3, y: 4 });
  assert.equal(next.ok, true, next.error);
  assert.deepEqual(at(world, rider.id), [3, 4], "the mount's next turn did not bring its 40 feet");
});

await test("Ruling 4: the mount's turn has not come yet, so the pair cannot move on the rider's turn, and the mount's turn brings its full speed.", async () => {
  const { world, rider, mount } = await afoot({ first: "rider" });
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, up.error);
  const ride = await world.invoke("move_token", { token: mount.id, x: 15, y: 4 });
  assert.equal(ride.ok, false, "the pair moved on the rider's turn, before the mount's had come");
  // The pointer walks on past the wolf, whose turn starts.
  nextTurn(world);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 0, "the mount's turn did not refill the pair's token");
  const go = await world.invoke("move_token", { token: mount.id, x: 21, y: 4 });
  assert.equal(go.ok, true, go.error);
  assert.deepEqual(at(world, rider.id), [21, 4], "the pair did not ride the wolf's 40 feet on the wolf's turn");
});

await test("Ruling 4: a person at the console who mounts the rider during the mount's own turn leaves the pair what the mount has left.", async () => {
  const { world, rider, mount } = await afoot({ first: "mount", riderAt: { x: 12, y: 4 }, mountAt: { x: 5, y: 4 } });
  turnOf(world, mount.id);
  assert.equal((await world.invoke("move_token", { token: mount.id, x: 11, y: 4 })).ok, true);
  // Still the wolf's turn: the goblin's has not come.
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, up.error);
  assert.equal(up.result.movementSpent, undefined);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 6, "the pair's token does not carry what the wolf walked");
  const ride = await world.invoke("move_token", { token: mount.id, x: 5, y: 4 });
  assert.equal(ride.ok, true, ride.error);
  assert.deepEqual(at(world, rider.id), [9, 4], "the pair did not ride the 10 feet the wolf had left");
});

// ---- ruling 5: independent, or controlled ----

await test("Ruling 5: a pair made mid-fight is independent: the mount keeps its place in the order and its own turn.", async () => {
  const { world, rider, mount } = await afoot();
  const before = orderIds(world);
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  assert.deepEqual(orderIds(world), before, "an independent mount lost or moved its place in the order");
  assert.equal(live(world, mount.id).ledBy, undefined);
});

await test("Ruling 5: controlled: true makes the rider steer it: the mount leaves the order, takes its rider's count, and the pointer stays where it was.", async () => {
  const { world, hero, rider, mount } = await afoot({ first: "mount" });
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount, { controlled: true });
  assert.equal(up.ok, true, up.error);
  assert.equal(live(world, mount.id).ledBy, rider.id, "the mount is not marked as steered by its rider");
  assert.deepEqual(orderIds(world), [hero.id, rider.id], "the controlled mount kept a place of its own in the order");
  assert.equal(orderIds(world)[world.encounter().turnIndex], rider.id, "the pointer left the rider");
  assert.equal(live(world, mount.id).initiative, world.encounter().order.find((entry) => entry.enemyId === rider.id).initiative, "the mount's initiative does not match its rider's");
  assert.match(up.result.rides, /a controlled mount/);
  const state = buildEncounterState(world.campaignId, world.sheets());
  assert.match(state.enemies.find((enemy) => enemy.enemyId === mount.id).pair, /controlled mount of/);
  assert.equal(state.order.length, 2, "GAME STATE lists a turn for the controlled mount");
});

await test("Ruling 5: a mount handed its turn with its rider's is no longer waiting to be played once its rider steers it.", async () => {
  const { world, rider, mount } = await afoot({ first: "rider" });
  const encounter = world.encounter();
  saveEncounter({ ...encounter, legendary: { ...encounter.legendary, due: [rider.id, mount.id] } });
  const turn = createDmTurn(world.campaignId, [], "ai");
  const up = await ai(world, turn, "mount_up", { characterId: rider.id, mount: mount.id, controlled: true });
  assert.equal(up.ok, true, up.error);
  assert.deepEqual(world.encounter().legendary.due, [rider.id], "the steered mount still waits for a turn of its own");
  assert.equal(orderIds(world).includes(mount.id), false);
});

await test("Ruling 5: a controlled mount whose own turn had not begun this round takes it with its rider's, and carries the pair at its speed now.", async () => {
  const { world, rider, mount } = await afoot({ first: "rider" });
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount, { controlled: true });
  assert.equal(up.ok, true, up.error);
  const ride = await world.invoke("move_token", { token: mount.id, x: 21, y: 4 });
  assert.equal(ride.ok, true, `the controlled mount could not carry the pair on its rider's turn: ${ride.error}`);
  assert.deepEqual(at(world, rider.id), [21, 4], "the pair did not ride the wolf's 40 feet");
});

await test("Ruling 5: a controlled mount whose turn this round is over waits for its rider's next turn: no movement and no Dash until then.", async () => {
  const { world, rider, mount } = await afoot({ first: "mount" });
  turnOf(world, rider.id);
  const up = await mountUp(world, rider, mount, { controlled: true });
  assert.equal(up.ok, true, up.error);
  assert.match(up.result.note, /Its turn this round is over, so the pair moves from .* next turn/);
  const ride = await world.invoke("move_token", { token: mount.id, x: 15, y: 4 });
  assert.equal(ride.ok, false, "a mount whose turn was over carried the pair");
  assert.equal(enemyActedThisRound(world.encounter(), mount.id), true, "a mount whose turn was over still has an action this round");
  const dash = await world.invoke("take_action", { enemyId: mount.id, action: "dash" });
  assert.equal(dash.ok, false, "a mount whose turn was over Dashed");
  // Round the order to the hero, then past the rider: its turn refills the pair.
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  const next = await world.invoke("move_token", { token: mount.id, x: 21, y: 4 });
  assert.equal(next.ok, true, next.error);
  assert.deepEqual(at(world, rider.id), [21, 4]);
});

await test("Ruling 5: a mount whose own turn is running gives up no place in the order: controlled is refused then, and nothing changes.", async () => {
  const { world, rider, mount } = await afoot({ first: "mount" });
  const before = orderIds(world);
  turnOf(world, mount.id);
  const up = await mountUp(world, rider, mount, { controlled: true });
  assert.equal(up.ok, false, "the pointer's own creature was taken out of the order");
  assert.match(up.error, /own turn: .* takes its reins once that turn has ended/);
  assert.deepEqual(orderIds(world), before);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
});

await test("Ruling 5: the steering mark is cleared when the rider gets down, and the mount takes a turn of its own after its rider's.", async () => {
  const { world, hero, rider, mount } = await afoot({ first: "rider" });
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount, { controlled: true })).ok, true);
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  const down = await getDown(world, rider);
  assert.equal(down.ok, true, down.error);
  assert.equal(live(world, mount.id).ledBy, undefined, "the mount is still marked as steered");
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
  assert.deepEqual(orderIds(world), [hero.id, rider.id, mount.id], "the freed mount's turn is not right after its rider's");
  assert.match(down.result.note, /takes a turn of its own from now on/);
});

await test("Ruling 5: a steered mount whose rider gets down by choice on its own turn has had its turn this round: it neither acts nor moves again until the next round.", async () => {
  const { world, hero, rider, mount } = await afoot({ rider: "hobgoblin", mount: "warhorse", first: "rider", heroAt: { x: 22, y: 1 } });
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount, { controlled: true })).ok, true);
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  // The warhorse carries the pair 35 of its 60 feet, and the rider gets down
  // before it has taken its action.
  const ride = await world.invoke("move_token", { token: mount.id, x: 20, y: 4 });
  assert.equal(ride.ok, true, ride.error);
  const down = await getDown(world, rider);
  assert.equal(down.ok, true, down.error);
  assert.equal(enemyActedThisRound(world.encounter(), mount.id), true, "the warhorse still has a turn of its own this round");
  const walk = await world.invoke("move_token", { token: mount.id, x: 21, y: 1 });
  assert.equal(walk.ok, false, "the warhorse walked on after its rider got down");
  const kick = await world.invoke("enemy_attack", { enemyId: mount.id, targetCharacterId: hero.id });
  assert.equal(kick.ok, false, "the warhorse attacked after its turn was its rider's");
  assert.match(down.result.note, /from next round/);
});

await test("Ruling 5: the steering mark is cleared however the pair comes apart: the rider slain, and the rider pushed out of the saddle.", async () => {
  const slain = await afoot({ first: "rider" });
  turnOf(slain.world, slain.rider.id);
  assert.equal((await mountUp(slain.world, slain.rider, slain.mount, { controlled: true })).ok, true);
  await slain.world.invoke("damage_enemy", { enemyId: slain.rider.id, amount: 99, reason: "test" });
  assert.equal(live(slain.world, slain.mount.id).ledBy, undefined, "a slain rider still steers its mount");
  assert.ok(orderIds(slain.world).includes(slain.mount.id), "the mount of a slain rider has no turn");
  assert.ok(ownToken(slain.world, slain.mount.id), "the mount of a slain rider has no token");
  const pushed = await afoot({ first: "rider" });
  turnOf(pushed.world, pushed.rider.id);
  assert.equal((await mountUp(pushed.world, pushed.rider, pushed.mount, { controlled: true })).ok, true);
  const shove = await pushed.world.invoke("move_token", { token: pushed.rider.id, x: 15, y: 4, forced: true });
  assert.equal(shove.ok, true, shove.error);
  assert.equal(live(pushed.world, pushed.mount.id).ledBy, undefined, "a rider pushed off still steers its mount");
  assert.equal(live(pushed.world, pushed.rider.id).ridesEnemyId, undefined);
});

// ---- ruling 6: where each stands, and the reach it leaves ----

await test("Ruling 6: getting down leaves the mount on a token of its own where the pair stood, and the rider on the open square beside it nearest the one named.", async () => {
  const { world, rider, mount } = await afoot();
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  // Asked for a square three off to the east and south: the nearest beside the mount is its south-east corner.
  const down = await getDown(world, rider, { x: 16, y: 7 });
  assert.equal(down.ok, true, down.error);
  assert.deepEqual([ownToken(world, mount.id).x, ownToken(world, mount.id).y], [13, 4], "the mount did not keep the space the pair held");
  assert.deepEqual(at(world, rider.id), [14, 5], "the rider did not land on the open square nearest the one named");
  assert.equal(down.result.at, "(14,5)");
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
});

await test("Ruling 6: with no square named the rider takes the nearest open one, never one another creature fills.", async () => {
  const { world, hero, rider, mount } = await afoot({ heroAt: { x: 12, y: 3 } });
  turnOf(world, rider.id);
  world.dice(2);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  world.clearDice();
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null, reactionsUsed: [hero.id] });
  nextTurn(world);
  turnOf(world, rider.id);
  saveEncounter({ ...world.encounter(), reactionsUsed: [hero.id] });
  // The hero fills (12,3), the first square a scan from the pair's corner meets.
  const down = await getDown(world, rider, { x: 12, y: 3 });
  assert.equal(down.ok, true, down.error);
  const [x, y] = at(world, rider.id);
  assert.notDeepEqual([x, y], [12, 3], "the rider was set down in the hero's space");
  assert.ok(Math.max(Math.abs(x - 13), Math.abs(y - 4)) === 1, `the rider landed at (${x},${y}), not beside its mount`);
});

await test("Ruling 6: getting down from an independent mount reads the rider's own speed and leaves the other half to walk with.", async () => {
  const { world, rider, mount } = await afoot();
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  const down = await getDown(world, rider, { x: 12, y: 4 });
  assert.equal(down.ok, true, down.error);
  assert.equal(down.result.movementSpent, 15);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 3, "the dismount did not cost half of the goblin's 30 feet");
  // 40 feet asked of the 15 it has left.
  const walk = await world.invoke("move_token", { token: rider.id, x: 4, y: 4 });
  assert.equal(walk.ok, true, walk.error);
  assert.deepEqual(at(world, rider.id), [9, 4], "the rider did not walk the other half of its speed, 15 feet");
});

await test("Ruling 6: with no open square within 5 feet the dismount is refused, and the rider stays mounted.", async () => {
  // The pair in a corner: a wall on two sides and the hero on the third.
  const rows = OPEN();
  rows[0] = `.#${rows[0].slice(2)}`;
  rows[1] = `#${rows[1].slice(1)}`;
  const { world, hero, rider, mount } = await afoot({ rows, riderAt: { x: 5, y: 5 }, mountAt: { x: 6, y: 5 }, heroAt: { x: 10, y: 8 } });
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  await layMap(world, rows, { [hero.id]: { x: 1, y: 1 }, [rider.id]: { x: 0, y: 0 } });
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  const down = await getDown(world, rider);
  assert.equal(down.ok, false, "a rider got down with nowhere to stand");
  assert.match(down.error, /has no open square within 5 feet of .* to get down into/);
  assert.equal(mounted(world, rider, mount), true);
  assert.equal(ownToken(world, mount.id), null);
});

await test("Ruling 6: mounting out of a hero's reach draws that hero's opportunity attack; a hero the pair's space still touches makes none.", async () => {
  // The hero stands on the far side of the goblin from the wolf.
  const far = await afoot({ riderAt: { x: 12, y: 4 }, mountAt: { x: 13, y: 4 }, heroAt: { x: 11, y: 4 } });
  turnOf(far.world, far.rider.id);
  far.world.dice(2);
  const up = await mountUp(far.world, far.rider, far.mount);
  far.world.clearDice();
  assert.equal(up.ok, true, up.error);
  assert.equal(up.result.opportunityAttacks?.length, 1, `mounting out of a hero's reach drew no opportunity attack: ${JSON.stringify(up.result)}`);
  assert.ok(far.world.encounter().reactionsUsed.includes(far.hero.id), "the swing did not spend the hero's reaction");
  assert.equal(mounted(far.world, far.rider, far.mount), true, "a missed swing kept the rider off its mount");
  // The hero stands beside both: the rider never leaves the reach.
  const near = await afoot({ riderAt: { x: 12, y: 4 }, mountAt: { x: 13, y: 4 }, heroAt: { x: 12, y: 3 } });
  turnOf(near.world, near.rider.id);
  const stay = await mountUp(near.world, near.rider, near.mount);
  assert.equal(stay.ok, true, stay.error);
  assert.equal(stay.result.opportunityAttacks, undefined, "a hero the pair still stands beside swung");
  assert.equal(near.world.encounter().reactionsUsed.includes(near.hero.id), false);
});

await test("Ruling 6: a rider that Disengaged mounts out of a hero's reach and draws nothing.", async () => {
  const { world, hero, rider, mount } = await afoot({ riderAt: { x: 12, y: 4 }, mountAt: { x: 13, y: 4 }, heroAt: { x: 11, y: 4 } });
  turnOf(world, rider.id);
  const away = await world.invoke("take_action", { enemyId: rider.id, action: "disengage" });
  assert.equal(away.ok, true, away.error);
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, up.error);
  assert.equal(up.result.opportunityAttacks, undefined, "a rider that Disengaged drew an opportunity attack");
  assert.equal(world.encounter().reactionsUsed.includes(hero.id), false);
});

await test("Ruling 6: getting down out of a hero's reach draws that hero's opportunity attack, measured from the whole space of a Large mount.", async () => {
  // A warhorse at (13,4) to (14,5). The hero stands beside its east side.
  const { world, hero, rider, mount } = await afoot({ rider: "hobgoblin", mount: "warhorse", riderAt: { x: 12, y: 4 }, mountAt: { x: 13, y: 4 }, heroAt: { x: 2, y: 1 } });
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  await layMap(world, OPEN(), { [hero.id]: { x: 15, y: 5 }, [rider.id]: { x: 13, y: 4 } });
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  world.dice(2);
  // Down on the west side, two squares from the hero's reach.
  const down = await getDown(world, rider, { x: 12, y: 4 });
  world.clearDice();
  assert.equal(down.ok, true, down.error);
  assert.deepEqual(at(world, rider.id), [12, 4]);
  assert.equal(down.result.opportunityAttacks?.length, 1, `getting down out of a hero's reach drew no opportunity attack: ${JSON.stringify(down.result)}`);
  assert.ok(world.encounter().reactionsUsed.includes(hero.id));
});

await test("Ruling 6: a creature fighting for the party measures the pair's whole space too: one beside both a rider and its Large mount makes no swing as the rider gets on.", async () => {
  // A warhorse at (13,4) to (14,5), its rider at (12,5), and a wolf that
  // fights for the party at (13,6): beside the rider and beside the
  // warhorse's lower row, two squares from the warhorse's top corner.
  const { world, rider, mount, rest } = await afoot({ rider: "hobgoblin", mount: "warhorse", riderAt: { x: 12, y: 5 }, mountAt: { x: 13, y: 4 }, extra: ["wolf"] });
  const [wolf] = rest;
  await layMap(world, OPEN(), { [rider.id]: { x: 12, y: 5 }, [mount.id]: { x: 13, y: 4 }, [wolf.id]: { x: 13, y: 6 } });
  setEncounterSides(world.encounter().id, { ...world.encounter().sides, [wolf.id]: "party" });
  turnOf(world, rider.id);
  world.dice(2);
  const up = await mountUp(world, rider, mount);
  world.clearDice();
  assert.equal(up.ok, true, up.error);
  assert.equal(up.result.opportunityAttacks, undefined, `a creature the pair's space still touches swung: ${JSON.stringify(up.result.opportunityAttacks)}`);
  assert.equal(world.encounter().reactionsUsed.includes(wolf.id), false, "the wolf spent its reaction on a rider that never left its reach");
});

await test("A rider struck down by the swing as it reaches for its mount never gets on, and the mount keeps its own token.", async () => {
  const { world, rider, mount } = await afoot({ riderAt: { x: 12, y: 4 }, mountAt: { x: 13, y: 4 }, heroAt: { x: 11, y: 4 } });
  patchEnemyHp(rider.id, 1, "alive");
  turnOf(world, rider.id);
  world.dice(19, 6, 6, 6);
  const up = await mountUp(world, rider, mount);
  world.clearDice();
  assert.equal(up.ok, true, up.error);
  assert.notEqual(live(world, rider.id).status, "alive", "setup: the goblin at 1 hit point lived through the hit");
  assert.equal(up.result.stopped, rider.displayName);
  assert.match(up.result.note, /struck down as it reached for/);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
  assert.ok(ownToken(world, mount.id), "the mount lost its token to a rider that never got on");
});

await test("A walker changes size on the way: a reach is left when the rider's own square, not its mount's space, is out of it.", () => {
  // A hero at (15,5) with a 5-foot reach, a pair two squares wide at (13,4), a landing at (12,4).
  assert.deepEqual(leavesReachAt([{ x: 13, y: 4 }, { x: 12, y: 4 }], { x: 15, y: 5 }, 1, 1, [2, 1]), { x: 13, y: 4 });
  assert.equal(leavesReachAt([{ x: 13, y: 4 }, { x: 12, y: 4 }], { x: 15, y: 5 }, 1, 1, 1), null, "one size for the whole walk measures from the corner alone");
  assert.equal(leavesReachAt([{ x: 13, y: 4 }, { x: 15, y: 6 }], { x: 15, y: 5 }, 1, 1, [2, 1]), null);
});

// ---- the rest of the list ----

await test("dismount for an enemy is for getting down by choice: a cause is refused, since the server settles a fall itself, and so is one that rides nothing.", async () => {
  const { world, rider, mount } = await afoot();
  const none = await getDown(world, rider);
  assert.equal(none.ok, false);
  assert.match(none.error, /is not mounted/);
  turnOf(world, rider.id);
  assert.equal((await mountUp(world, rider, mount)).ok, true);
  const thrown = await getDown(world, rider, { cause: "forced-move" });
  assert.equal(thrown.ok, false, "a cause took an enemy out of the saddle");
  assert.match(thrown.error, /The server settles an enemy rider's fall itself/);
  assert.equal(mounted(world, rider, mount), true);
});

await test("Undoing the GM turn that mounted an enemy puts the two back on their own tokens, and undoing the one that took it down puts the pair back.", async () => {
  const { world, rider, mount } = await afoot();
  turnOf(world, rider.id);
  const before = snapshot();
  const up = await mountUp(world, rider, mount);
  assert.equal(up.ok, true, up.error);
  assert.equal(mounted(world, rider, mount), true);
  await revertTurn(world, up.turnId);
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.equal(live(world, rider.id).ridesEnemyId, undefined, "the undo left the rider mounted");
  assert.deepEqual(at(world, rider.id), [12, 4]);
  assert.deepEqual([ownToken(world, mount.id).x, ownToken(world, mount.id).y], [13, 4], "the undo did not give the mount its token back");
  // Mounted again, steered this time, then taken down and that undone.
  const steered = await mountUp(world, rider, mount, { controlled: true });
  assert.equal(steered.ok, true, steered.error);
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  turnOf(world, rider.id);
  const paired = snapshot();
  const down = await getDown(world, rider);
  assert.equal(down.ok, true, down.error);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
  await revertTurn(world, down.turnId);
  assert.deepEqual(diff(paired, snapshot()), [], "after Revert this turn the pair differs from the one the turn found");
  assert.equal(mounted(world, rider, mount), true, "the undo left the rider on foot");
  assert.equal(live(world, mount.id).ledBy, rider.id, "the undo did not give the rider its reins back");
  assert.equal(ownToken(world, mount.id), null);
});

closeTables();
finish();
