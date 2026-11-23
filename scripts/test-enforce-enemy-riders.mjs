// An enemy that rides another enemy: a goblin on a wolf (issue 1055).
//
// "A willing creature that is at least one size larger than you and that has
// an appropriate anatomy can serve as a mount." "An independent mount retains
// its place in the initiative order. Bearing a rider puts no restrictions on
// the actions the mount can take, and it moves and acts as it wishes" (SRD
// 5.1, Mounted Combat).
//
// The rulings each test holds:
//   1. one token, the rider's, in the mount's space;
//   2. an enemy's mount is independent by default: its own turn, its own
//      attacks, and its move carries the pair. The rider has no movement of
//      its own;
//   4. a mount whose rider is gone stays, on a token of its own in the space
//      the pair held, and keeps its turn.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables } from "./lib/enforce-spell-kit.mjs";
import { dropMap, layMap } from "./lib/enforce-spells.mjs";
import { mapOf, OPEN, tokenOf } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-enforce-enemy-riders");
const { listTokens, resetTurnBudgets } = await import("../src/lib/db/battle-maps.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { partPair } = await import("../src/lib/dm/enemy-riders.ts");
const { parseFightRoster } = await import("../src/lib/dm/encounter-template-logic.ts");
const { buildEncounterState } = await import("../src/lib/dm/turn.ts");
const { buildPlayerMapView, footprintLookup, occupiedTiles } = await import("../src/lib/battlemap/view.ts");

const HERO = () => caster("paladin", "cha", [], [], 5, { speed: 30 });
const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;
const at = (world, refId) => [tokenOf(world, refId).x, tokenOf(world, refId).y];
const live = (world, id) => world.enemies().find((enemy) => enemy.id === id);
const orderIds = (world) => world.encounter().order.map((entry) => entry.characterId ?? entry.enemyId);

// A hero, and a rider on its mount twelve squares off on an open board. The
// order is the hero, the rider, the mount, with the pointer on the hero.
async function pair({ rider = "goblin", mount = "wolf" } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(HERO());
  await world.beginFight([{ monster: rider, mount }]);
  const up = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const under = world.enemies().find((enemy) => enemy.id === up?.ridesEnemyId);
  assert.ok(up && under, "setup: the fight has no rider on a mount");
  await layMap(world, OPEN(), { [hero.id]: { x: 2, y: 4 }, [up.id]: { x: 12, y: 4 } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  saveEncounter({ ...encounter, order: [entry(hero.id), entry(up.id), entry(under.id)], turnIndex: 0, turnBudget: null });
  return { world, hero, rider: up, mount: under };
}

// The pointer rests on this enemy's place in the order.
function turnOf(world, enemyId) {
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === enemyId), turnBudget: null });
}

await test("An enemy entry with a mount fields two enemies, the rider's row naming its mount, and the result tells the GM which is which.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 2, mount: "wolf" }] });
  assert.equal(started.ok, true, started.error);
  const enemies = world.enemies();
  assert.equal(enemies.length, 4, "two goblins on two wolves are four enemies");
  const riders = enemies.filter((enemy) => enemy.ridesEnemyId);
  assert.equal(riders.length, 2);
  assert.deepEqual(new Set(riders.map((enemy) => enemy.slug)), new Set(["goblin"]));
  assert.equal(new Set(riders.map((enemy) => enemy.ridesEnemyId)).size, 2, "two riders were put on one mount");
  for (const rider of riders) {
    assert.equal(enemies.find((enemy) => enemy.id === rider.ridesEnemyId)?.slug, "wolf");
  }
  const rows = started.result.enemies;
  assert.match(rows.find((row) => row.enemyId === riders[0].id).rides, /Wolf/);
  assert.match(rows.find((row) => row.enemyId === riders[0].ridesEnemyId).carries, /Goblin/);
});

await test("Ruling 2: the mount keeps a place of its own in the initiative order, beside its rider's.", async () => {
  const { world, rider, mount } = await pair();
  assert.equal(orderIds(world).filter((id) => id === rider.id).length, 1);
  assert.equal(orderIds(world).filter((id) => id === mount.id).length, 1, "the mount has no turn of its own");
});

await test("Ruling 1: the pair has one token, the rider's, and the mount is found where its rider stands.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  await world.beginFight([{ monster: "goblin", mount: "wolf" }]);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  assert.ok(ownToken(world, rider.id), "the rider has no token on the board the fight drew");
  assert.equal(ownToken(world, rider.ridesEnemyId), null, "the mount has a token of its own: two tokens for one pair");
  assert.equal(tokenOf(world, rider.ridesEnemyId)?.refId, rider.id, "the mount is not found where its rider stands");
});

await test("Ruling 1: the pair fills the mount's space, so a goblin on a Large warhorse covers four squares.", async () => {
  const { world, rider } = await pair({ mount: "warhorse" });
  const enemiesById = new Map(world.enemies().map((enemy) => [enemy.id, enemy]));
  const footprints = footprintLookup(enemiesById);
  assert.equal(footprints(tokenOf(world, rider.id)), 2, "the pair's token is one square wide");
  const map = mapOf(world);
  const covered = occupiedTiles(map, listTokens(map.id), null, footprints);
  for (const [x, y] of [[12, 4], [13, 4], [12, 5], [13, 5]]) {
    assert.ok(covered.has(y * map.width + x), `(${x},${y}) is not held by the pair`);
  }
  const view = buildPlayerMapView(world.campaignId, world.owner.id, { fullVision: true });
  const shown = view.tokens.find((token) => token.refId === rider.id);
  assert.equal(view.tokenFootprint[shown.id], 2, "the board draws the pair on one square");
});

await test("A mount must be at least one size larger than its rider: a hobgoblin on a wolf is refused, and no fight starts.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  const refused = await world.invoke("start_encounter", { enemies: [{ monster: "hobgoblin", mount: "wolf" }] });
  assert.equal(refused.ok, false, "a Medium rider was put on a Medium mount");
  assert.match(refused.error, /one size larger/);
  assert.equal(world.encounter(), null, "a refused fight was started");
  const unknown = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", mount: "no such beast" }] });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown monster "no such beast"/);
  assert.equal(world.encounter(), null);
});

await test("Ruling 2: the mount's move carries the pair at the mount's speed, and gives the mount no token of its own.", async () => {
  const { world, rider, mount } = await pair();
  turnOf(world, mount.id);
  // 50 feet asked of a wolf's 40: the walk stops where its movement does.
  const walk = await world.invoke("move_token", { token: mount.id, x: 22, y: 4 });
  assert.equal(walk.ok, true, walk.error);
  assert.deepEqual(at(world, rider.id), [20, 4], "the mount's move did not carry its rider's token 40 feet");
  assert.equal(walk.result.name, mount.displayName, "the walk is told as the rider's");
  assert.equal(ownToken(world, mount.id), null, "the mount's move gave it a token of its own");
  const more = await world.invoke("move_token", { token: mount.id, x: 22, y: 4 });
  assert.equal(more.ok, false, "the mount walked past its speed");
});

await test("Ruling 2: the pair walks on the mount's legs, so a crocodile's swim speed carries a goblin through water at the plain cost.", async () => {
  const { world, rider, mount } = await pair({ mount: "crocodile" });
  // Water all round: a creature with no swimming speed pays two squares for one.
  await layMap(world, Array.from({ length: 9 }, () => "~".repeat(24)), { [world.sheets()[0].id]: { x: 2, y: 4 }, [rider.id]: { x: 12, y: 4 } });
  turnOf(world, mount.id);
  // Its 20 feet are four squares of water to a swimmer, two to a goblin.
  const walk = await world.invoke("move_token", { token: mount.id, x: 20, y: 4 });
  assert.equal(walk.ok, true, walk.error);
  assert.deepEqual(at(world, rider.id), [16, 4], "the pair swam on its rider's traits, not the crocodile's");
});

await test("Ruling 2: the rider has no movement of its own, and is told its mount moves the pair.", async () => {
  const { world, rider, mount } = await pair();
  turnOf(world, rider.id);
  const walk = await world.invoke("move_token", { token: rider.id, x: 14, y: 4 });
  assert.equal(walk.ok, false, "the rider walked the pair on its own turn");
  assert.match(walk.error, new RegExp(`rides ${mount.displayName}`));
  assert.deepEqual(at(world, rider.id), [12, 4]);
  const flees = await world.invoke("enemy_flees", { enemyId: rider.id });
  assert.equal(flees.ok, false, "the rider ran off without its mount");
  assert.match(flees.error, /no movement of its own/);
});

await test("The mount's turn refills the movement of the token the pair shares; its rider's turn does not.", async () => {
  const { world, rider, mount } = await pair();
  turnOf(world, mount.id);
  await world.invoke("move_token", { token: mount.id, x: 16, y: 4 });
  assert.equal(tokenOf(world, rider.id).movedThisRound, 4);
  resetTurnBudgets(mapOf(world).id, [rider.id]);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 4, "the rider's turn gave the mount its movement back");
  resetTurnBudgets(mapOf(world).id, [mount.id]);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 0, "the mount's turn did not start its movement again");
});

await test("Each of the two strikes from where the pair stands: the mount's attack and the rider's both reach a hero beside their token.", async () => {
  const { world, hero, rider, mount } = await pair();
  await layMap(world, OPEN(), { [hero.id]: { x: 11, y: 4 }, [rider.id]: { x: 12, y: 4 } });
  turnOf(world, mount.id);
  const bite = await world.invoke("enemy_attack", { enemyId: mount.id, targetCharacterId: hero.id });
  assert.equal(bite.ok, true, `the mount could not attack from under its rider: ${bite.error}`);
  turnOf(world, rider.id);
  const cut = await world.invoke("enemy_attack", { enemyId: rider.id, targetCharacterId: hero.id, attack: "Scimitar" });
  assert.equal(cut.ok, true, `the rider could not attack from the saddle: ${cut.error}`);
});

await test("Ruling 4: a rider slain leaves its mount on a token of its own where the pair stood, with its turn and its own walk.", async () => {
  const { world, rider, mount } = await pair();
  const slain = await world.invoke("damage_enemy", { enemyId: rider.id, amount: 99, reason: "test" });
  assert.equal(slain.ok, true, slain.error);
  assert.match(slain.result.pair ?? "", /riderless/, `the result says nothing of the mount: ${JSON.stringify(slain.result)}`);
  assert.equal(ownToken(world, rider.id), null, "the dead rider kept a token");
  const left = ownToken(world, mount.id);
  assert.ok(left, "the mount has no token after its rider died");
  assert.deepEqual([left.x, left.y], [12, 4], "the mount is not where the pair stood");
  assert.equal(left.name, mount.displayName);
  assert.equal(live(world, mount.id).status, "alive");
  assert.ok(orderIds(world).includes(mount.id), "the riderless mount lost its turn");
  turnOf(world, mount.id);
  const walk = await world.invoke("move_token", { token: mount.id, x: 15, y: 4 });
  assert.equal(walk.ok, true, walk.error);
  assert.deepEqual([ownToken(world, mount.id).x, ownToken(world, mount.id).y], [15, 4]);
});

await test("A rider drained to 0 of a score that kills dies off its mount: the mount gets the pair's token, as a death by damage leaves it.", async () => {
  const { world, rider, mount } = await pair();
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { drainCreature } = await import("../src/lib/dm/creature-drain.ts");
  const said = drainCreature(world.campaign(), createDmTurn(world.campaignId, []), mount, rider.id, "Bite", { ability: "str", dice: "40d6", diesAtZero: true });
  assert.match(said ?? "", /dies/, `the drain did not kill: ${said}`);
  assert.equal(live(world, rider.id).status, "dead");
  assert.equal(live(world, rider.id).ridesEnemyId ?? null, null, "the dead rider still rides its mount");
  const left = ownToken(world, mount.id);
  assert.ok(left, "the mount has no token after its rider died");
  assert.deepEqual([left.x, left.y], [12, 4], "the mount is not where the pair stood");
});

await test("A mount slain leaves its rider on their own token, on foot, with their own movement again.", async () => {
  const { world, rider, mount } = await pair();
  const slain = await world.invoke("damage_enemy", { enemyId: mount.id, amount: 99, reason: "test" });
  assert.equal(slain.ok, true, slain.error);
  assert.match(slain.result.pair ?? "", /on foot/);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined, "the rider still rides a dead mount");
  assert.deepEqual(at(world, rider.id), [12, 4], "the rider's token went with the mount");
  turnOf(world, rider.id);
  const walk = await world.invoke("move_token", { token: rider.id, x: 14, y: 4 });
  assert.equal(walk.ok, true, `the rider cannot walk once on foot: ${walk.error}`);
});

await test("With no battle map the two part all the same: a mount slain leaves no rider on its back, and a rider slain leaves no mount under them.", async () => {
  const first = await pair();
  await dropMap(first.world);
  const horse = await first.world.invoke("damage_enemy", { enemyId: first.mount.id, amount: 99, reason: "test" });
  assert.equal(horse.ok, true, horse.error);
  assert.equal(live(first.world, first.rider.id).ridesEnemyId, undefined, "the rider still rides a dead mount");
  assert.match(horse.result.pair ?? "", /on foot/);
  const second = await pair();
  await dropMap(second.world);
  const goblin = await second.world.invoke("damage_enemy", { enemyId: second.rider.id, amount: 99, reason: "test" });
  assert.equal(goblin.ok, true, goblin.error);
  assert.equal(live(second.world, second.rider.id).ridesEnemyId, undefined, "a dead rider still names its mount");
  assert.match(goblin.result.pair ?? "", /riderless/);
});

await test("A rider left lying on the board lies beside its mount, never on its square: the mount takes the space the pair held.", async () => {
  const { world, rider, mount } = await pair();
  const line = partPair(world.campaign(), live(world, rider.id), false);
  assert.match(line ?? "", /riderless/);
  const horse = ownToken(world, mount.id);
  const fallen = ownToken(world, rider.id);
  assert.deepEqual([horse.x, horse.y], [12, 4]);
  assert.ok(fallen, "the rider has no token");
  assert.ok(fallen.x !== horse.x || fallen.y !== horse.y, "two tokens on one square");
  assert.ok(Math.max(Math.abs(fallen.x - horse.x), Math.abs(fallen.y - horse.y)) <= 1, "the rider does not lie beside the mount");
  assert.equal(partPair(world.campaign(), live(world, rider.id), false), null, "a creature on foot was parted from a mount");
});

await test("A mount that flees carries its rider out of the fight with it.", async () => {
  const { world, rider, mount } = await pair();
  turnOf(world, mount.id);
  const flees = await world.invoke("enemy_flees", { enemyId: mount.id });
  assert.equal(flees.ok, true, flees.error);
  const after = await import("../src/lib/db/encounters.ts");
  assert.equal(after.getEnemy(mount.id).status, "fled");
  assert.equal(after.getEnemy(rider.id).status, "fled", "the rider was left behind with no mount and no token");
});

await test("A mount that flees takes only a rider still on its back: one already parted from it stays in the fight.", async () => {
  const { world, rider, mount } = await pair();
  partPair(world.campaign(), live(world, rider.id), false);
  turnOf(world, mount.id);
  const flees = await world.invoke("enemy_flees", { enemyId: mount.id });
  assert.equal(flees.ok, true, flees.error);
  assert.equal(live(world, rider.id).status, "alive", "a rider no longer mounted was carried out of the fight");
  assert.ok(ownToken(world, rider.id), "the rider left on foot lost their token");
  assert.equal(flees.result.fled, mount.displayName);
});

await test("Reinforcements arrive mounted: add_enemies takes the same mount, and the pair comes in on one token.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  await world.beginFight([{ monster: "goblin" }]);
  const added = await world.invoke("add_enemies", { enemies: [{ monster: "goblin", mount: "wolf" }] });
  assert.equal(added.ok, true, added.error);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  assert.ok(rider, "the reinforcement is not on its mount");
  assert.ok(ownToken(world, rider.id), "the arriving rider has no token");
  assert.equal(ownToken(world, rider.ridesEnemyId), null, "the arriving mount has a token of its own");
  assert.match(added.result.added.find((row) => row.enemyId === rider.id).rides, /Wolf/);
});

await test("A foe still lying knocked out from the last fight is not put on a mount: the mount comes in on a token of its own.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  await world.beginFight([{ monster: "goblin" }]);
  const [goblin] = world.enemies();
  const { knockedOutConditions } = await import("../src/lib/dm/knockout.ts");
  const encounters = await import("../src/lib/db/encounters.ts");
  encounters.patchEnemyHp(goblin.id, 0, "alive");
  const out = knockedOutConditions({ ...goblin, currentHp: 0 });
  encounters.patchEnemyConditions(goblin.id, out.conditions, out.meta);
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", returning: goblin.id, mount: "wolf" }] });
  assert.equal(started.ok, true, started.error);
  const back = world.enemies().find((enemy) => enemy.slug === "goblin");
  const wolf = world.enemies().find((enemy) => enemy.slug === "wolf");
  assert.equal(back.currentHp, 0, "setup: the goblin did not come back knocked out");
  assert.equal(back.ridesEnemyId, undefined, "an unconscious goblin was put in the saddle");
  assert.ok(ownToken(world, wolf.id), "the wolf has no token of its own under a rider lying senseless");
});

await test("GAME STATE tells the GM who rides whom, and that only the mount's move moves the pair.", async () => {
  const { world, rider, mount } = await pair();
  const state = buildEncounterState(world.campaignId, world.sheets());
  const row = (id) => state.enemies.find((enemy) => enemy.enemyId === id);
  assert.match(row(rider.id).pair, new RegExp(`^rides ${mount.displayName} \\[enemyId=${mount.id}\\]`));
  assert.match(row(mount.id).pair, new RegExp(`^carries ${rider.displayName} \\[enemyId=${rider.id}\\]`));
  await world.invoke("damage_enemy", { enemyId: rider.id, amount: 99, reason: "test" });
  const after = buildEncounterState(world.campaignId, world.sheets());
  assert.equal(after.enemies.find((enemy) => enemy.enemyId === mount.id).pair, undefined, "a riderless mount is still told as carrying its rider");
});

await test("Undoing the GM turn that slew a rider puts the pair back on its one token.", async () => {
  const { world, rider, mount } = await pair();
  const before = snapshot();
  const slain = await world.invoke("damage_enemy", { enemyId: rider.id, amount: 99, reason: "test" });
  assert.equal(slain.ok, true, slain.error);
  await revertTurn(world, slain.turnId);
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id, "the undo left the rider on foot");
  assert.ok(ownToken(world, rider.id), "the rider's token did not come back");
  assert.equal(ownToken(world, mount.id), null, "the mount kept the token the undone turn gave it");
});

await test("The console's fight box reads a mount at the end of a line, and leaves a riding horse its name.", async () => {
  assert.deepEqual(parseFightRoster("goblin riding wolf x3"), [{ monster: "goblin", count: 3, mount: "wolf" }]);
  assert.deepEqual(parseFightRoster("bandit as Raider riding riding horse"), [{ monster: "bandit", count: 1, name: "Raider", mount: "riding horse" }]);
  assert.deepEqual(parseFightRoster("riding horse x2"), [{ monster: "riding horse", count: 2 }]);
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  const started = await world.invoke("start_encounter", { enemies: "goblin riding wolf" });
  assert.equal(started.ok, true, started.error);
  assert.ok(world.enemies().some((enemy) => enemy.ridesEnemyId), "the console's line fielded no rider");
});

closeTables();
finish();
