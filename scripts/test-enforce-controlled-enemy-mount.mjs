// An enemy rider steers its mount: a knight on a trained warhorse, a goblin
// on a wolf broken to the saddle (issue 1055, ruling 2).
//
// "You can control a mount only if it has been trained to accept a rider."
// "The initiative of a controlled mount changes to match yours when you mount
// it. It moves as you direct it, and it has only three action options: Dash,
// Disengage, and Dodge" (SRD 5.1, Mounted Combat: Controlling a Mount).
//
// An enemy's mount is independent unless its entry says `controlled: true`.
// What each test holds of a controlled one:
//   - it rolls no initiative and has no place in the order: one slot for the
//     pair, the rider's;
//   - its own move_token walks the pair, at its speed, on its rider's turn;
//   - it takes the Dash, Disengage and Dodge actions and nothing else: no
//     attack, no ability, no opportunity attack;
//   - it counts toward neither the eight combatants nor the XP multiplier,
//     and its XP counts in full (ruling 3);
//   - once its rider is dead, thrown or pushed off, it is an ordinary
//     creature with a turn of its own on its rider's count (ruling 4).
// Dice forced where a roll decides anything.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { caster, closeTables } from "./lib/enforce-spell-kit.mjs";
import { layMap } from "./lib/enforce-spells.mjs";
import { mapOf, nextTurn, OPEN, tokenOf } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-enforce-controlled-enemy-mount");
const { listTokens, resetTurnBudgets } = await import("../src/lib/db/battle-maps.ts");
const { createDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getEnemy, patchEnemyHp, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { enemyActedThisRound } = await import("../src/lib/dm/can-act.ts");
const { parseFightRoster } = await import("../src/lib/dm/encounter-template-logic.ts");
const { enemyTurnEntry } = await import("../src/lib/dm/enemy-turn-logic.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { askLine } = await import("../src/lib/dm/opportunity-ask-logic.ts");
const { resolveOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const { buildEncounterState } = await import("../src/lib/dm/turn.ts");
const { publicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { evaluateEncounter } = await import("../src/lib/srd/encounter-math.ts");
const { subscribe } = await import("../src/lib/events.ts");

const HERO = (name) => ({ ...caster("paladin", "cha", [], [], 5, { speed: 30 }), ...(name ? { name } : {}) });
const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;
const at = (world, refId) => [tokenOf(world, refId).x, tokenOf(world, refId).y];
const live = (world, id) => world.enemies().find((enemy) => enemy.id === id);
const orderIds = (world) => world.encounter().order.map((entry) => entry.characterId ?? entry.enemyId);
const steered = (world) => world.enemies().find((enemy) => enemy.ledBy) ?? null;

// Heroes, and a goblin on a wolf it steers, ten squares off on an open board.
// The order is the first hero, the rider, then any other hero, with the
// pointer on the first hero. `controlled: false` fields the default pair,
// whose order has the mount after its rider.
async function pair({ rider = "goblin", mount = "wolf", controlled = true, heroes = 1, user = false } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
  const player = user ? world.addUser("kara") : null;
  const party = Array.from({ length: heroes }, (_, index) => world.addHero({ ...HERO(`Hero ${index + 1}`), ...(player && index === 0 ? { user: player } : {}) }));
  await world.beginFight([{ monster: rider, mount, ...(controlled ? { controlled: true } : {}) }]);
  const up = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const under = world.enemies().find((enemy) => enemy.id === up?.ridesEnemyId);
  assert.ok(up && under, "setup: the fight has no rider on a mount");
  await layMap(world, OPEN(), { ...Object.fromEntries(party.map((hero, index) => [hero.id, { x: 2, y: 1 + index * 6 }])), [up.id]: { x: 12, y: 4 } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  const order = [entry(party[0].id), entry(up.id), entry(under.id), ...party.slice(1).map((hero) => entry(hero.id))].filter(Boolean);
  saveEncounter({ ...encounter, order, turnIndex: 0, turnBudget: null });
  return { world, hero: party[0], party, rider: up, mount: under, player };
}

// The pointer rests on this enemy's place in the order.
function turnOf(world, enemyId) {
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === enemyId), turnBudget: null });
}

// A call the AI GM makes on a turn of its own, where an enemy waits for its
// place in the order (enemy-turn-order.ts); the console's hand is free.
const ai = (world, turn, name, args) => invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });

await test("An entry with controlled: true fields a rider and a mount it steers, and the result tells the GM what the mount can do.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", mount: "wolf", controlled: true }] });
  assert.equal(started.ok, true, started.error);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const mount = steered(world);
  assert.ok(rider && mount, "no mount in the fight is steered by its rider");
  assert.equal(mount.id, rider.ridesEnemyId);
  assert.equal(mount.ledBy, rider.id);
  const rows = started.result.enemies;
  assert.match(rows.find((row) => row.enemyId === rider.id).rides, /controlled mount/);
  assert.match(rows.find((row) => row.enemyId === mount.id).carries, /no turn of its own and no attacks/);
  assert.match(rows.find((row) => row.enemyId === mount.id).carries, /dash, disengage or dodge/);
});

await test("The default stays independent: with no controlled, with controlled false, and with controlled on an entry that has no mount.", async () => {
  for (const extra of [{}, { controlled: false }, { controlled: "no" }]) {
    const world = await openWorld({ gameSettings: { ttsEnabled: false } });
    world.addHero(HERO());
    await world.beginFight([{ monster: "goblin", mount: "wolf", ...extra }]);
    assert.equal(steered(world), null, `a mount is steered with ${JSON.stringify(extra)}`);
    assert.equal(orderIds(world).length, 3, "the independent mount has no place of its own in the order");
  }
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", controlled: true }] });
  assert.equal(started.ok, true, started.error);
  assert.equal(world.enemies().length, 1);
  assert.equal(steered(world), null);
});

await test("Initiative lists the pair once: the controlled mount rolls nothing, takes its rider's count and has no place in the order.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(HERO());
  // One die for the goblins, none for their wolves, then the hero's.
  world.clearDice();
  world.diceLog();
  world.dice(11, 15);
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 2, mount: "wolf", controlled: true }] });
  assert.equal(started.ok, true, started.error);
  const enemies = world.enemies();
  const riders = enemies.filter((enemy) => enemy.ridesEnemyId);
  const mounts = enemies.filter((enemy) => enemy.ledBy);
  assert.equal(riders.length, 2);
  assert.equal(mounts.length, 2);
  assert.deepEqual(world.diceLog().filter((die) => die.sides === 20).map((die) => die.forced), [true, true], "a die was rolled for the mounts' initiative");
  for (const mount of mounts) {
    assert.equal(mount.initiative, riders.find((rider) => rider.id === mount.ledBy).initiative, "the mount's count is not its rider's");
  }
  const order = orderIds(world);
  assert.deepEqual([...order].sort(), [hero.id, ...riders.map((rider) => rider.id)].sort(), `the order is not the hero and the two riders: ${JSON.stringify(world.encounter().order.map((entry) => entry.name))}`);
  const state = buildEncounterState(world.campaignId, world.sheets());
  assert.equal(state.order.length, 3, "GAME STATE lists a turn for a controlled mount");
  const seen = publicEncounter(world.encounter(), world.enemies(), {});
  assert.equal(seen.order.length, 3, "the players' tracker lists a turn for a controlled mount");
  assert.equal(seen.enemies.length, 4, "the players' enemy list lost a creature");
  // The tap on the pair's token still has two names to offer (ruling 5).
  assert.equal(seen.enemies.find((enemy) => enemy.id === riders[0].id)?.ridesEnemyId, riders[0].ridesEnemyId, "a player's page no longer knows who rides whom");
});

await test("Ruling 3: a controlled mount is no combatant under the cap of eight and adds nothing to the XP multiplier, and its XP counts in full.", async () => {
  const party = async () => {
    const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
    for (let index = 0; index < 4; index += 1) {
      world.addHero({ ...caster("paladin", "cha", [], [], 12, { speed: 30 }), name: `Hero ${index + 1}` });
    }
    return world;
  };
  const led = await party();
  const started = await led.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 5, mount: "wolf", controlled: true }] });
  assert.equal(started.ok, true, `five riders on five mounts they steer were refused: ${started.error}`);
  assert.equal(led.enemies().length, 10);
  const more = await led.invoke("add_enemies", { enemies: [{ monster: "goblin", count: 3, mount: "wolf", controlled: true }] });
  assert.equal(more.ok, true, `three more steered pairs, eight who take turns, were refused: ${more.error}`);
  const ninth = await led.invoke("add_enemies", { enemies: [{ monster: "goblin" }] });
  assert.equal(ninth.ok, false, "a ninth creature that takes a turn was let in");
  const free = await party();
  const refused = await free.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 5, mount: "wolf" }] });
  assert.equal(refused.ok, false, "ten creatures that each take a turn were let in");
  assert.match(refused.error, /8 combatants/);
  // A goblin and a wolf are 50 XP each. Four heroes: one creature that acts
  // multiplies by 1, two by 1.5.
  const levels = [5, 5, 5, 5];
  assert.equal(evaluateEncounter(levels, [0.25], [0.25]).totalXp, 100, "the controlled mount's XP is not counted in full");
  assert.equal(evaluateEncounter(levels, [0.25], [0.25]).adjustedXp, 100, "the controlled mount raised the multiplier");
  assert.equal(evaluateEncounter(levels, [0.25, 0.25]).adjustedXp, 150);
});

await test("The mount's move_token walks the pair on its rider's turn, at the mount's speed, and the rider's own is refused with the call to make.", async () => {
  const { world, rider, mount } = await pair();
  turnOf(world, rider.id);
  const own = await world.invoke("move_token", { token: rider.id, x: 14, y: 4 });
  assert.equal(own.ok, false, "the rider walked the pair by its own name");
  assert.match(own.error, new RegExp(`call move_token for ${mount.displayName}`));
  assert.deepEqual(at(world, rider.id), [12, 4]);
  // 50 feet asked of a wolf's 40: the walk stops where its movement does.
  const ride = await world.invoke("move_token", { token: mount.id, x: 22, y: 4 });
  assert.equal(ride.ok, true, ride.error);
  assert.deepEqual(at(world, rider.id), [20, 4], "the pair did not ride 40 feet, the wolf's speed");
  assert.equal(ride.result.name, mount.displayName);
  assert.equal(ownToken(world, mount.id), null, "the walk gave the mount a token of its own");
  const more = await world.invoke("move_token", { token: mount.id, x: 22, y: 4 });
  assert.equal(more.ok, false, "the mount walked past its speed");
});

await test("For the AI GM the mount moves when its rider's turn has come, and is told whose turn it waits for before that.", async () => {
  const { world, hero, rider, mount } = await pair();
  const turn = createDmTurn(world.campaignId, [], "ai");
  const early = await ai(world, turn, "move_token", { token: mount.id, x: 14, y: 4 });
  assert.equal(early.ok, false, "the mount moved on the hero's turn, before its rider's");
  assert.match(early.error, new RegExp(`${mount.displayName} is a controlled mount and moves on ${rider.displayName}'s turn, which has not come yet`));
  assert.match(early.error, new RegExp(`it is ${hero.name}'s turn`));
  assert.deepEqual(at(world, rider.id), [12, 4]);
  const dash = await ai(world, turn, "take_action", { enemyId: mount.id, action: "dash" });
  assert.equal(dash.ok, false, "the mount Dashed before its rider's turn");
  // The rider is handed its turn, as end_turn hands the enemies it passes.
  const encounter = world.encounter();
  saveEncounter({ ...encounter, legendary: { ...encounter.legendary, due: [rider.id] } });
  const ride = await ai(world, turn, "move_token", { token: mount.id, x: 14, y: 4 });
  assert.equal(ride.ok, true, `the mount could not move on its rider's turn: ${ride.error}`);
  assert.deepEqual(at(world, rider.id), [14, 4]);
});

await test("The mount Dashes on its rider's turn with its own action: the pair rides twice the mount's speed, and the rider still attacks.", async () => {
  const { world, hero, rider, mount } = await pair();
  await layMap(world, OPEN(), { [hero.id]: { x: 17, y: 4 }, [rider.id]: { x: 0, y: 4 } });
  turnOf(world, rider.id);
  const dash = await world.invoke("take_action", { enemyId: mount.id, action: "dash" });
  assert.equal(dash.ok, true, dash.error);
  const ride = await world.invoke("move_token", { token: mount.id, x: 16, y: 4 });
  assert.equal(ride.ok, true, ride.error);
  assert.deepEqual(at(world, rider.id), [16, 4], "the pair did not ride 80 feet on the mount's Dash");
  assert.equal(enemyActedThisRound(world.encounter(), mount.id), true, "the Dash was not the mount's action");
  assert.equal(enemyActedThisRound(world.encounter(), rider.id), false, "the mount's Dash spent its rider's action");
  world.dice(2);
  const cut = await world.invoke("enemy_attack", { enemyId: rider.id, targetCharacterId: hero.id, attack: "Scimitar" });
  assert.equal(cut.ok, true, `the rider could not attack from the saddle after its mount Dashed: ${cut.error}`);
});

await test("The rider's attack rides the pair into reach on the mount's movement; a rider on a mount that acts as it wishes stays put.", async () => {
  const { world, hero, rider, mount } = await pair();
  await layMap(world, OPEN(), { [hero.id]: { x: 4, y: 4 }, [rider.id]: { x: 12, y: 4 } });
  turnOf(world, rider.id);
  world.dice(2);
  const cut = await world.invoke("enemy_attack", { enemyId: rider.id, targetCharacterId: hero.id, attack: "Scimitar" });
  assert.equal(cut.ok, true, `the rider did not ride into reach: ${cut.error}`);
  assert.deepEqual(at(world, rider.id), [5, 4], "the pair did not ride up beside the hero");
  assert.equal(tokenOf(world, rider.id).movedThisRound, 7, "the ride was not paid from the pair's movement");
  assert.equal(ownToken(world, mount.id), null);
  // One square of the wolf's eight is left.
  await world.invoke("move_token", { token: mount.id, x: 5, y: 8 });
  assert.deepEqual(at(world, rider.id), [5, 5], "the mount walked its whole speed again after carrying its rider's charge");
  const free = await pair({ controlled: false });
  await layMap(free.world, OPEN(), { [free.hero.id]: { x: 4, y: 4 }, [free.rider.id]: { x: 12, y: 4 } });
  turnOf(free.world, free.rider.id);
  const stuck = await free.world.invoke("enemy_attack", { enemyId: free.rider.id, targetCharacterId: free.hero.id, attack: "Scimitar" });
  assert.equal(stuck.ok, false, "a rider on an independent mount walked the pair on its own turn");
  assert.deepEqual(at(free.world, free.rider.id), [12, 4]);
});

await test("The mount Dodges on its rider's turn, and the Dodge ends as its rider's next turn begins.", async () => {
  const { world, rider, mount } = await pair({ heroes: 2 });
  turnOf(world, rider.id);
  const dodge = await world.invoke("take_action", { enemyId: mount.id, action: "dodge" });
  assert.equal(dodge.ok, true, dodge.error);
  assert.ok(live(world, mount.id).conditions.includes("dodging"), "the mount is not dodging");
  assert.equal(live(world, rider.id).conditions.includes("dodging"), false, "the mount's Dodge was laid on its rider");
  // Round the order to the first hero again, then past the rider.
  saveEncounter({ ...world.encounter(), turnIndex: 0, turnBudget: null });
  nextTurn(world);
  assert.equal(live(world, mount.id).conditions.includes("dodging"), false, "the Dodge outlasted the start of the rider's next turn");
});

await test("The rider's turn starting gives the pair its movement again and forgets the mount's Dash.", async () => {
  const { world, party, rider, mount } = await pair({ heroes: 2 });
  await world.invoke("take_action", { enemyId: mount.id, action: "dash" });
  await world.invoke("move_token", { token: mount.id, x: 16, y: 4 });
  assert.equal(tokenOf(world, rider.id).movedThisRound, 4);
  assert.equal(enemyTurnEntry(world.encounter(), mount.id).dashes, 1);
  // The pointer walks from the first hero past the rider to the second.
  nextTurn(world);
  assert.equal(orderIds(world)[world.encounter().turnIndex], party[1].id, "setup: the pointer did not walk past the rider");
  assert.equal(tokenOf(world, rider.id).movedThisRound, 0, "the rider's turn did not start the pair's movement again");
  assert.equal(enemyTurnEntry(world.encounter(), mount.id).dashes ?? 0, 0, "the mount kept the Dash of its last turn");
  // And by the count alone, where an independent mount's rider refills nothing.
  await world.invoke("move_token", { token: mount.id, x: 18, y: 4 });
  resetTurnBudgets(mapOf(world).id, [rider.id]);
  assert.equal(tokenOf(world, rider.id).movedThisRound, 0);
});

await test("A controlled mount makes no attack: enemy_attack is refused with the three actions it has, and nothing is spent.", async () => {
  const { world, hero, rider, mount } = await pair();
  await layMap(world, OPEN(), { [hero.id]: { x: 11, y: 4 }, [rider.id]: { x: 12, y: 4 } });
  turnOf(world, rider.id);
  const hpBefore = world.sheet(hero.id).currentHp;
  const bite = await world.invoke("enemy_attack", { enemyId: mount.id, targetCharacterId: hero.id });
  assert.equal(bite.ok, false, "a controlled mount attacked");
  assert.match(bite.error, new RegExp(`${mount.displayName} is a controlled mount under ${rider.displayName}`));
  assert.match(bite.error, /only the Dash, Disengage and Dodge actions \(SRD 5\.1, Controlling a Mount\)/);
  assert.match(bite.error, /makes no attack\. Nothing was spent\./);
  assert.equal(world.sheet(hero.id).currentHp, hpBefore);
  assert.equal(enemyActedThisRound(world.encounter(), mount.id), false, "the refused attack spent the mount's action");
  const turn = createDmTurn(world.campaignId, [], "ai");
  const again = await ai(world, turn, "enemy_attack", { enemyId: mount.id, targetCharacterId: hero.id });
  assert.equal(again.ok, false, "the AI GM's controlled mount attacked");
  assert.match(again.error, /controlled mount/);
  const escape = await world.invoke("take_action", { enemyId: mount.id, action: "escape" });
  assert.equal(escape.ok, false, "a controlled mount took an action that is none of its three");
  assert.match(escape.error, /makes no escape action/);
  world.dice(2);
  const cut = await world.invoke("enemy_attack", { enemyId: rider.id, targetCharacterId: hero.id, attack: "Scimitar" });
  assert.equal(cut.ok, true, `the rider could not attack from the saddle: ${cut.error}`);
});

await test("A controlled mount uses no ability of its block either: a young dragon steered by its rider is refused its breath.", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
  const heroes = Array.from({ length: 4 }, (_, index) => world.addHero({ ...caster("paladin", "cha", [], [], 15, { speed: 30 }), name: `Hero ${index + 1}` }));
  await world.beginFight([{ monster: "goblin", mount: "young red dragon", controlled: true }]);
  const mount = steered(world);
  assert.ok(mount, "setup: no steered mount");
  const breath = await world.invoke("aoe_damage", { casterEnemyId: mount.id, enemyAbility: "Fire Breath", targetCharacterIds: [heroes[0].id] });
  assert.equal(breath.ok, false, "a controlled mount breathed fire");
  assert.match(breath.error, /makes no use of a spell or ability/);
  assert.equal(world.sheet(heroes[0].id).currentHp, heroes[0].currentHp);
});

await test("A controlled mount makes no opportunity attack as a hero walks out of its reach; its rider's is still made.", async () => {
  const reactions = async (controlled) => {
    const { world, hero, rider, mount } = await pair({ controlled });
    await layMap(world, OPEN(), { [hero.id]: { x: 11, y: 4 }, [rider.id]: { x: 12, y: 4 } });
    world.dice(2, 2);
    resolveOpportunityAttacks(world.campaign(), hero.id, { x: 11, y: 4 }, { x: 9, y: 4 }, false, [{ x: 10, y: 4 }, { x: 9, y: 4 }]);
    const used = world.encounter().reactionsUsed;
    return { rider: used.includes(rider.id), mount: used.includes(mount.id) };
  };
  assert.deepEqual(await reactions(false), { rider: true, mount: true }, "setup: an independent pair does not strike twice as a hero leaves");
  assert.deepEqual(await reactions(true), { rider: true, mount: false });
});

await test("The pair riding out of a hero's reach asks that hero's player which of the two to strike, as an independent pair does.", async () => {
  const { world, hero, rider, mount, player } = await pair({ user: true });
  await layMap(world, OPEN(), { [hero.id]: { x: 6, y: 4 }, [rider.id]: { x: 5, y: 4 } });
  patchEnemyHp(rider.id, 1, "alive");
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === rider.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [rider.id], acted: null } });
  const gone = subscribe(world.campaignId, () => {}, player.id);
  world.clearDice();
  const ride = await world.invoke("move_token", { token: mount.id, x: 1, y: 4 });
  assert.equal(ride.ok, true, ride.error);
  assert.equal(ride.result.parked, true, `the walk did not wait for the player: ${JSON.stringify(ride.result)}`);
  const [ask] = listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "opportunity");
  assert.ok(ask, "no card asked the hero's player");
  assert.equal(ask.carry?.ask?.walkerId, mount.id);
  assert.deepEqual(ask.carry?.ask?.rider, { id: rider.id, name: rider.displayName });
  assert.match(askLine(ask.carry.ask), /which of them/);
  // Struck down by that swing, the rider leaves the mount riding on alone.
  const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/opportunity");
  world.signIn(player);
  world.dice(19, 6);
  const out = await call(route, "POST", { strike: true, target: rider.id }, { campaignId: world.campaignId, pendingRollId: ask.id });
  await settleQueue(world.campaignId);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.notEqual(live(world, rider.id).status, "alive", "setup: the rider at 1 hit point lived through the hit");
  assert.equal(live(world, mount.id).ledBy, undefined, "the mount is still steered by a rider struck down");
  assert.ok(orderIds(world).includes(mount.id), "the mount has no turn after its rider was struck down");
  assert.deepEqual([ownToken(world, mount.id).x, ownToken(world, mount.id).y], [1, 4], "the mount did not finish its walk on a token of its own");
  gone();
});

await test("A mount that Disengages provokes nothing: the pair rides out of a hero's reach and no card is asked.", async () => {
  const { world, hero, rider, mount, player } = await pair({ user: true });
  await layMap(world, OPEN(), { [hero.id]: { x: 6, y: 4 }, [rider.id]: { x: 5, y: 4 } });
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === rider.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [rider.id], acted: null } });
  const gone = subscribe(world.campaignId, () => {}, player.id);
  const away = await world.invoke("take_action", { enemyId: mount.id, action: "disengage" });
  assert.equal(away.ok, true, away.error);
  const ride = await world.invoke("move_token", { token: mount.id, x: 1, y: 4 });
  assert.equal(ride.ok, true, ride.error);
  assert.notEqual(ride.result.parked, true, "a mount that Disengaged drew an opportunity attack");
  assert.deepEqual(at(world, rider.id), [1, 4]);
  assert.equal(listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "opportunity").length, 0);
  gone();
});

await test("Ruling 4: a rider slain leaves its controlled mount an ordinary creature, with a token, a turn on its rider's count and its attacks.", async () => {
  const { world, hero, rider, mount } = await pair();
  await layMap(world, OPEN(), { [hero.id]: { x: 11, y: 4 }, [rider.id]: { x: 12, y: 4 } });
  assert.equal(orderIds(world).includes(mount.id), false, "setup: the steered mount has a place in the order");
  const slain = await world.invoke("damage_enemy", { enemyId: rider.id, amount: 99, reason: "test" });
  assert.equal(slain.ok, true, slain.error);
  assert.match(slain.result.pair ?? "", /riderless/);
  assert.match(slain.result.pair ?? "", new RegExp(`takes a turn of its own from now on, on ${rider.displayName}'s place in the order, with all its actions`));
  assert.equal(live(world, mount.id).ledBy, undefined, "the mount is still steered by a dead rider");
  const left = ownToken(world, mount.id);
  assert.ok(left, "the mount has no token after its rider died");
  assert.deepEqual([left.x, left.y], [12, 4]);
  const order = world.encounter().order;
  const riderAt = order.findIndex((entry) => entry.enemyId === rider.id);
  assert.equal(order[riderAt + 1]?.enemyId, mount.id, `the mount's turn is not right after its rider's: ${JSON.stringify(order.map((entry) => entry.name))}`);
  assert.equal(order[riderAt + 1].initiative, order[riderAt].initiative);
  assert.equal(orderIds(world)[world.encounter().turnIndex], hero.id, "the pointer left the hero");
  turnOf(world, mount.id);
  world.dice(2);
  const bite = await world.invoke("enemy_attack", { enemyId: mount.id, targetCharacterId: hero.id });
  assert.equal(bite.ok, true, `the riderless mount could not attack: ${bite.error}`);
  const state = buildEncounterState(world.campaignId, world.sheets());
  assert.equal(state.enemies.find((enemy) => enemy.enemyId === mount.id).pair, undefined, "a riderless mount is still told as steered");
});

await test("The mount's new place in the order survives a save of the fight as it stood before the two parted.", async () => {
  const { world, rider, mount } = await pair();
  const before = world.encounter();
  await world.invoke("damage_enemy", { enemyId: rider.id, amount: 99, reason: "test" });
  assert.ok(orderIds(world).includes(mount.id));
  // A call that read the fight before the rider fell saves its copy over it.
  saveEncounter({ ...world.encounter(), order: before.order, turnIndex: before.turnIndex });
  assert.equal(orderIds(world).includes(mount.id), false, "setup: the older copy kept the mount's place");
  nextTurn(world);
  assert.ok(orderIds(world).includes(mount.id), "the mount lost its turn for good");
  assert.equal(live(world, mount.id).slotOwed, undefined, "the walk of the order left the mount marked as owed its place");
});

await test("A mount that already moved with a rider who has acted waits for the next round; one whose rider had not acted keeps its action.", async () => {
  const spent = await pair();
  await layMap(spent.world, OPEN(), { [spent.hero.id]: { x: 11, y: 4 }, [spent.rider.id]: { x: 12, y: 4 } });
  turnOf(spent.world, spent.rider.id);
  spent.world.dice(2);
  await spent.world.invoke("enemy_attack", { enemyId: spent.rider.id, targetCharacterId: spent.hero.id, attack: "Scimitar" });
  assert.equal(enemyActedThisRound(spent.world.encounter(), spent.rider.id), true, "setup: the rider's attack did not spend its action");
  await spent.world.invoke("damage_enemy", { enemyId: spent.rider.id, amount: 99, reason: "test" });
  assert.equal(enemyActedThisRound(spent.world.encounter(), spent.mount.id), true, "the mount has an action left in a round its rider already took");
  const late = await spent.world.invoke("enemy_attack", { enemyId: spent.mount.id, targetCharacterId: spent.hero.id });
  assert.equal(late.ok, false, "the mount attacked in the round it rode under a rider who had acted");
  const fresh = await pair();
  await fresh.world.invoke("damage_enemy", { enemyId: fresh.rider.id, amount: 99, reason: "test" });
  assert.equal(enemyActedThisRound(fresh.world.encounter(), fresh.mount.id), false);
});

await test("Ruling 6: a push that names the rider takes it out of the saddle, and the mount it steered stays, with a turn of its own.", async () => {
  const { world, rider, mount } = await pair();
  const shove = await world.invoke("move_token", { token: rider.id, x: 14, y: 4, forced: true });
  assert.equal(shove.ok, true, shove.error);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined, "the pushed rider is still mounted");
  assert.ok(live(world, rider.id).conditions.includes("prone"));
  assert.equal(live(world, mount.id).ledBy, undefined, "the mount is still steered by a rider on the ground");
  assert.deepEqual([ownToken(world, mount.id).x, ownToken(world, mount.id).y], [12, 4]);
  assert.ok(orderIds(world).includes(mount.id), "the mount has no turn after its rider was pushed off");
  turnOf(world, rider.id);
  const up = await world.invoke("move_token", { token: rider.id, x: 15, y: 4 });
  assert.equal(up.ok, true, `the rider on foot has no movement of its own: ${up.error}`);
});

await test("A rider knocked prone who fails the DC 10 save falls, and the mount it steered takes a turn of its own from then on.", async () => {
  const { world, rider, mount } = await pair();
  world.dice(1);
  const prone = await world.invoke("set_enemy_condition", { enemyId: rider.id, condition: "prone" });
  assert.equal(prone.ok, true, prone.error);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined, "a rider who rolled a 1 kept its seat");
  assert.equal(live(world, mount.id).ledBy, undefined);
  assert.ok(ownToken(world, mount.id), "the mount has no token of its own");
  assert.ok(orderIds(world).includes(mount.id), "the mount has no turn after its rider fell");
});

await test("A controlled mount slain leaves its rider on foot with their own movement, and the order as it was.", async () => {
  const { world, rider, mount } = await pair();
  const before = orderIds(world);
  const slain = await world.invoke("damage_enemy", { enemyId: mount.id, amount: 99, reason: "test" });
  assert.equal(slain.ok, true, slain.error);
  assert.match(slain.result.pair ?? "", /on foot/);
  assert.equal(live(world, rider.id).ridesEnemyId, undefined);
  assert.equal(live(world, mount.id).slotOwed, undefined, "a dead mount is owed a place in the order");
  assert.deepEqual(orderIds(world), before, "a dead mount was given a turn");
  turnOf(world, rider.id);
  const walk = await world.invoke("move_token", { token: rider.id, x: 14, y: 4 });
  assert.equal(walk.ok, true, `the rider cannot walk once on foot: ${walk.error}`);
});

await test("A controlled mount that flees on its rider's turn carries its rider out; the rider is told to send the mount.", async () => {
  const { world, rider, mount } = await pair();
  turnOf(world, rider.id);
  const own = await world.invoke("enemy_flees", { enemyId: rider.id });
  assert.equal(own.ok, false, "the rider ran off without its mount");
  assert.match(own.error, new RegExp(`call enemy_flees for ${mount.displayName}`));
  const flees = await world.invoke("enemy_flees", { enemyId: mount.id });
  assert.equal(flees.ok, true, flees.error);
  assert.equal(getEnemy(mount.id).status, "fled");
  assert.equal(getEnemy(rider.id).status, "fled", "the rider was left behind");
  assert.equal(getEnemy(mount.id).ledBy, undefined);
});

await test("GAME STATE tells the GM the mount is steered: no turn, no attacks, moved on its rider's turn by its own move_token.", async () => {
  const { world, rider, mount } = await pair();
  const state = buildEncounterState(world.campaignId, world.sheets());
  const row = (id) => state.enemies.find((enemy) => enemy.enemyId === id);
  assert.match(row(rider.id).pair, new RegExp(`^rides ${mount.displayName} \\[enemyId=${mount.id}\\], a controlled mount`));
  assert.match(row(mount.id).pair, new RegExp(`^controlled mount of ${rider.displayName} \\[enemyId=${rider.id}\\]`));
  assert.match(row(mount.id).pair, /no turn of its own and no attacks/);
  assert.equal(state.order.some((entry) => entry.name === mount.displayName), false, "GAME STATE's order names the mount");
});

await test("The order told as the fight opens names the steered mount beside its rider, where only the creatures in that order are said to be in the fight.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(HERO());
  const turn = createDmTurn(world.campaignId, [], "ai");
  world.clearDice();
  world.dice(1, 1, 19);
  const started = await ai(world, turn, "start_encounter", { enemies: [{ monster: "goblin", mount: "wolf", controlled: true }] });
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  let told = JSON.stringify(started.result);
  if (!world.encounter().order.some((entry) => entry.characterId === hero.id)) {
    world.dice(19);
    told += JSON.stringify(await world.invoke("request_roll", { characterId: hero.id, kind: "initiative", reason: "initiative" }));
    world.clearDice();
  }
  const mount = steered(world);
  const rider = live(world, mount.ledBy);
  assert.match(told, /Only the creatures in that order are in this fight/, "setup: the opening named no order");
  assert.match(told, new RegExp(`Initiative order: [^"]*${rider.displayName} \\(riding ${mount.displayName}, the mount it steers\\)`), `the opening's order leaves the steered ${mount.displayName} out of the fight: ${told.slice(told.indexOf("Combat begins"), told.indexOf("Combat begins") + 200)}`);
});

await test("Reinforcements arrive on mounts they steer: add_enemies takes controlled, and the pair joins the order as one.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  await world.beginFight([{ monster: "goblin" }]);
  const places = orderIds(world).length;
  const added = await world.invoke("add_enemies", { enemies: [{ monster: "goblin", mount: "wolf", controlled: true }] });
  assert.equal(added.ok, true, added.error);
  const mount = steered(world);
  assert.ok(mount, "the reinforcement's mount is not steered");
  assert.equal(orderIds(world).length, places + 1, "the arriving pair took two places in the order");
  assert.equal(orderIds(world).includes(mount.id), false);
  assert.equal(mount.initiative, live(world, mount.ledBy).initiative);
  assert.match(added.result.added.find((row) => row.enemyId === mount.id).carries, /who steers it/);
});

await test("Undoing the GM turn that slew a rider puts the mount back under them: steered, off the order, on the pair's one token.", async () => {
  const { world, rider, mount } = await pair();
  const before = snapshot();
  const order = orderIds(world);
  const slain = await world.invoke("damage_enemy", { enemyId: rider.id, amount: 99, reason: "test" });
  assert.equal(slain.ok, true, slain.error);
  assert.ok(orderIds(world).includes(mount.id));
  await revertTurn(world, slain.turnId);
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.equal(live(world, rider.id).ridesEnemyId, mount.id);
  assert.equal(live(world, mount.id).ledBy, rider.id, "the undo left the mount unsteered");
  assert.deepEqual(orderIds(world), order, "the undo left the mount its own turn");
  assert.equal(ownToken(world, mount.id), null);
});

await test("The console's fight box reads controlled after the mount's name, and fields a steered pair from the line.", async () => {
  assert.deepEqual(parseFightRoster("knight riding warhorse controlled x2"), [{ monster: "knight", count: 2, mount: "warhorse", controlled: true }]);
  assert.deepEqual(parseFightRoster("bandit as Raider riding riding horse, controlled"), [{ monster: "bandit", count: 1, name: "Raider", mount: "riding horse", controlled: true }]);
  assert.deepEqual(parseFightRoster("goblin riding wolf x3"), [{ monster: "goblin", count: 3, mount: "wolf" }]);
  assert.deepEqual(parseFightRoster([{ monster: "goblin", mount: "wolf", controlled: true }]), [{ monster: "goblin", count: 1, mount: "wolf", controlled: true }]);
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  world.addHero(HERO());
  const started = await world.invoke("start_encounter", { enemies: "goblin riding wolf controlled" });
  assert.equal(started.ok, true, started.error);
  assert.ok(steered(world), "the console's line fielded no steered mount");
});

closeTables();
finish();
