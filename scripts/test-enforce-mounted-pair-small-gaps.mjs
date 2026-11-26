// Two places where a mounted pair was still treated as one creature.
//
// War Caster's spell as a pair rides out of reach. SRD 5.1, Mounted Combat:
// "If the mount provokes an opportunity attack while you're on it, the
// attacker can target you or the mount." The weapon's swing asks which of the
// two (test-enforce-rider-two-names.mjs); the spell cast in its place was
// cast with nobody asked, always at the mount.
//
// A drag. SRD 5.1, Grappling, Moving a Grappled Creature: "When you move, you
// can drag or carry the grappled creature with you". The grapple holds the
// rider, and "If an effect moves your mount against its will while you're on
// it, you must succeed on a DC 10 Dexterity saving throw" (Mounting and
// Dismounting) is about a mount that was moved. A drag moved the pair's one
// token: the mount came along, a creature the grappler never held, and a
// character was asked the save for it. Issue 1055, ruling 6, says of a push
// that names the rider: "the rider is pushed out of the saddle, and the mount
// stays". A drag names the rider the same way. Nothing in the drag's rule
// knocks anyone prone, so the rider is set down standing.
//
// Dice forced; every check reads the card, the rows, the mounts on record or
// the board.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { settleQueue } from "./lib/enforce-narrator.mjs";
import { caster, FIGHTER } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { mapOf, OPEN } from "./lib/enforce-zones.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-mounted-pair-small-gaps");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { saveEncounter, listEnemies } = await import("../src/lib/db/encounters.ts");
const { getTokenByRef, getBattleMapForEncounter, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { getMounts } = await import("../src/lib/db/mounts.ts");
const { getFloor, setFloor } = await import("../src/lib/db/campaigns.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { askLine } = await import("../src/lib/dm/opportunity-ask-logic.ts");
const { tokenFootprint } = await import("../src/lib/dm/board-reach.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const said = (world) => listRecentMessages(world.campaignId, 20).map((message) => message.content).join("\n");

const d20s = (world) => world.diceLog().filter((die) => die.sides === 20).length;
const nextTo = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;

// ---- War Caster's spell at a pair ----

// A wizard with War Caster, Fire Bolt named for her opportunity attacks,
// beside a goblin on a wolf, on the wolf's turn, her player at the table.
async function warCaster({ mounted = true, riderHp = 60 } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
  const user = world.addUser("mira");
  const hero = world.addHero({
    ...caster("wizard", "int", ["Magic Missile"], ["Fire Bolt"], 5, { feats: ["War Caster"] }),
    user, name: "Mira", maxHp: 60, proficiencies: TRAINED,
    equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }],
  });
  await world.beginFight([mounted ? { monster: "goblin", mount: "wolf" } : { monster: "wolf" }]);
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId) ?? null;
  const mount = mounted ? world.enemies().find((enemy) => enemy.id === rider?.ridesEnemyId) : world.enemies()[0];
  assert.ok(mount && (rider || !mounted), "setup: the fight has no rider on a mount");
  const kit = await combatKit(world);
  kit.setEnemy(mount.id, { maxHp: 60, currentHp: 60 });
  if (rider) kit.setEnemy(rider.id, { maxHp: 60, currentHp: riderHp });
  await layMap(world, OPEN(), { [hero.id]: { x: 6, y: 4 }, [(rider ?? mount).id]: { x: 5, y: 4 } });
  const named = await world.invoke("use_resource", { characterId: hero.id, resource: "War Caster", variant: "Fire Bolt" });
  assert.equal(named.ok, true, named.error);
  assert.ok(world.sheet(hero.id).conditions.includes("opportunity spell (Fire Bolt)"), `setup: Fire Bolt is not named: ${JSON.stringify(named.result)}`);
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === mount.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [mount.id], acted: null } });
  const gone = subscribe(world.campaignId, () => {}, user.id);
  world.clearDice();
  const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/opportunity");
  const asks = () => listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "opportunity");
  const answer = async (ask, body) => {
    world.signIn(user);
    const out = await call(route, "POST", body, { campaignId: world.campaignId, pendingRollId: ask.id });
    await settleQueue(world.campaignId);
    return out;
  };
  const row = (enemy) => listEnemies(world.encounter().id).find((entry) => entry.id === enemy.id);
  const reacted = () => world.encounter().reactionsUsed.some((key) => key.includes(hero.id));
  const walk = () => world.invoke("move_token", { token: mount.id, x: 1, y: 4 });
  const at = (enemy) => {
    const token = getTokenByRef(getBattleMapForEncounter(world.encounter().id).id, enemy.id);
    return token ? [token.x, token.y] : null;
  };
  return { world, hero, rider, mount, asks, answer, row, reacted, walk, at, gone };
}

await test("A War Caster's card for a pair riding out of reach names the spell and both creatures, and nothing is cast or spent before the player picks.", async () => {
  const { rider, mount, asks, row, reacted, walk, at, gone } = await warCaster();
  const out = await walk();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.parked, true, `the spell was cast with nobody asked which of the two: ${JSON.stringify(out.result)}`);
  const [ask] = asks();
  assert.ok(ask, "no card asked Mira's player");
  assert.deepEqual(ask.carry?.ask?.rider, { id: rider.id, name: rider.displayName }, "the card does not offer the rider");
  assert.equal(ask.carry?.ask?.spell, "Fire Bolt", "the card does not say the spell is what is cast");
  const line = askLine(ask.carry.ask);
  assert.ok(line.includes("Fire Bolt") && line.includes(rider.displayName) && line.includes(mount.displayName), `the card's words: ${line}`);
  assert.doesNotMatch(line, /Quarterstaff/, `the card names the weapon the spell replaces: ${line}`);
  assert.match(line, /which of them/);
  assert.deepEqual(at(mount), [5, 4], "the pair walked on before the player answered");
  assert.equal(reacted(), false);
  assert.equal(row(rider).currentHp, 60);
  assert.equal(row(mount).currentHp, 60);
  gone();
});

await test("The spell aimed at the rider lands on the rider alone, spends the reaction, and the mount carries the pair on.", async () => {
  const { world, rider, mount, asks, answer, row, reacted, walk, at, gone } = await warCaster();
  await walk();
  const [ask] = asks();
  assert.ok(ask, "no card asked Mira's player");
  // A ranged spell attack beside a hostile creature is at disadvantage: two
  // d20s, then Fire Bolt's 2d10 at level 5.
  world.dice(15, 15, 5, 5);
  const out = await answer(ask, { strike: true, target: rider.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(60 - row(rider).currentHp, 10, "Fire Bolt did not land on the rider the player named");
  assert.equal(row(mount).currentHp, 60, "the spell aimed at the rider hurt the mount");
  assert.equal(reacted(), true);
  assert.equal(row(rider).ridesEnemyId, mount.id, "the rider struck came off its mount");
  assert.deepEqual(at(mount), [1, 4], "the walk did not go on after the spell");
  gone();
});

await test("The spell aimed at the mount lands on the mount alone.", async () => {
  const { world, rider, mount, asks, answer, row, walk, gone } = await warCaster();
  await walk();
  const [ask] = asks();
  assert.ok(ask, "no card asked Mira's player");
  world.dice(15, 15, 5, 5);
  const out = await answer(ask, { strike: true, target: mount.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(60 - row(mount).currentHp, 10, "Fire Bolt did not land on the mount the player named");
  assert.equal(row(rider).currentHp, 60, "the spell aimed at the mount hurt the rider");
  gone();
});

await test("Let it go on a War Caster's card for a pair casts nothing and keeps the reaction.", async () => {
  const { rider, mount, asks, answer, row, reacted, walk, at, gone } = await warCaster();
  await walk();
  const [ask] = asks();
  assert.ok(ask, "no card asked Mira's player");
  const out = await answer(ask, { strike: false });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(reacted(), false);
  assert.equal(row(rider).currentHp, 60);
  assert.equal(row(mount).currentHp, 60);
  assert.deepEqual(at(mount), [1, 4]);
  gone();
});

await test("A rider the spell drops as the pair rides past leaves the mount walking on.", async () => {
  const { world, rider, mount, asks, answer, row, walk, at, gone } = await warCaster({ riderHp: 1 });
  await walk();
  const [ask] = asks();
  assert.ok(ask, "no card asked Mira's player");
  world.dice(15, 15, 5, 5);
  const out = await answer(ask, { strike: true, target: rider.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.notEqual(row(rider).status, "alive", "the rider at 1 hit point lived through Fire Bolt");
  assert.equal(row(mount).currentHp, 60);
  assert.deepEqual(at(mount), [1, 4], "the mount did not finish its walk");
  gone();
});

await test("A creature with nobody on its back is cast at with nobody asked, as before.", async () => {
  const { world, mount, asks, row, reacted, walk, gone } = await warCaster({ mounted: false });
  world.dice(15, 15, 5, 5);
  const out = await walk();
  assert.equal(out.ok, true, out.error);
  assert.equal(asks().length, 0, "a lone wolf's walk asked which of two");
  assert.equal(60 - row(mount).currentHp, 10, `Fire Bolt was not cast at the wolf: ${JSON.stringify(out.result)}`);
  assert.equal(reacted(), true);
  gone();
});

// ---- a drag ----

const RIDER = { ...FIGHTER, speed: 30 };
const PALADIN = () => caster("paladin", "cha", ["Find Steed"], [], 5, { speed: 30 });

function turnOf(world, id) {
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => (entry.characterId ?? entry.enemyId) === id), turnBudget: null });
}

const grip = (world, hero, foe) => world.patch(hero.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: foe.id } } });

// A character on a mount, the pair's corner at (5,3), held by the enemy
// beside them at (7,3), on that enemy's turn. `steed` makes the mount a
// creature of its own (Find Steed); otherwise it is a mount on record.
async function heldInSaddle({ steed: summoned = false, mount = "Warhorse" } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(summoned ? PALADIN() : RIDER);
  let steed = null;
  if (summoned) {
    const cast = await world.invoke("cast_buff", { characterId: hero.id, spell: "Find Steed", level: 2, variant: "warhorse" });
    assert.equal(cast.ok, true, cast.error);
    steed = world.sheets().find((sheet) => sheet.summon?.spell === "Find Steed");
  }
  const [foe] = await fightDummies(world, 1, { heroFaces: { [hero.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [hero.id]: { x: 5, y: 3 }, ...(steed ? { [steed.id]: { x: 6, y: 3 } } : {}), [foe.id]: { x: 7, y: 3 } });
  turnOf(world, hero.id);
  const up = await world.invoke("mount_up", { characterId: hero.id, mount });
  assert.equal(up.ok, true, up.error);
  assert.deepEqual([ownToken(world, hero.id).x, ownToken(world, hero.id).y], [5, 3], "setup: mounting moved the rider");
  grip(world, hero, foe);
  turnOf(world, foe.id);
  // Their reaction is spent, so the walk away draws no opportunity attack
  // and every die rolled would be the drag's.
  saveEncounter({ ...world.encounter(), reactionsUsed: [hero.id] });
  world.clearDice();
  world.diceLog();
  return { world, hero, foe, steed };
}

await test("An enemy that drags the character it grapples off a mount on record takes the character alone: out of the saddle, standing beside it, still held, with no save.", async () => {
  const { world, hero, foe } = await heldInSaddle();
  assert.equal(tokenFootprint(ownToken(world, hero.id)), 2, "setup: the pair does not fill the warhorse's space");
  // A die left over would be the save the rules do not ask.
  world.dice(1);
  const out = await world.invoke("move_token", { token: foe.id, x: 9, y: 3, drag: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 1, "the dragged rider rolled a die");
  assert.equal(d20s(world), 0, "the dragged rider was asked a save to stay on a mount nobody moved");
  assert.equal(getMounts(world.campaignId)[hero.id], undefined, "the mount was dragged along with its rider");
  const grappler = ownToken(world, foe.id);
  const dragged = ownToken(world, hero.id);
  assert.deepEqual([grappler.x, grappler.y], [9, 3]);
  assert.equal(tokenFootprint(dragged), 1, "the character on foot still fills the mount's space");
  assert.ok(nextTo(dragged, grappler), `the character at (${dragged.x},${dragged.y}) was not set down beside the grappler`);
  const sheet = world.sheet(hero.id);
  assert.equal(sheet.conditions.includes("prone"), false, "a drag knocked the character prone");
  assert.equal(sheet.conditions.includes("grappled"), true, "the drag let the character go");
  assert.match(out.result.dragged ?? "", /out of the saddle/, `the result says nothing of it: ${JSON.stringify(out.result)}`);
  assert.match(said(world), /drags .* out of the saddle; Warhorse stays\./, `the table was told nothing: ${said(world)}`);
});

await test("An enemy that drags a character off a steed leaves the steed where the pair stood, on a token of its own.", async () => {
  const { world, hero, foe, steed } = await heldInSaddle({ steed: true });
  assert.equal(ownToken(world, steed.id), null, "setup: the ridden steed kept a token");
  world.dice(1);
  const out = await world.invoke("move_token", { token: foe.id, x: 9, y: 3, drag: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 1, "the dragged rider rolled a die");
  assert.equal(getMounts(world.campaignId)[hero.id], undefined, "the steed was dragged along with its rider");
  const left = ownToken(world, steed.id);
  assert.ok(left, "the steed has no token after its rider was dragged off");
  assert.deepEqual([left.x, left.y], [5, 3], "the steed did not stay where the pair stood");
  const dragged = ownToken(world, hero.id);
  assert.ok(nextTo(dragged, ownToken(world, foe.id)), `the character at (${dragged.x},${dragged.y}) was not set down beside the grappler`);
  assert.equal(world.sheet(hero.id).conditions.includes("prone"), false, "a drag knocked the character prone");
});

await test("A character on foot is dragged as before.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(RIDER);
  const [foe] = await fightDummies(world, 1, { heroFaces: { [hero.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [hero.id]: { x: 6, y: 3 }, [foe.id]: { x: 7, y: 3 } });
  grip(world, hero, foe);
  turnOf(world, foe.id);
  const out = await world.invoke("move_token", { token: foe.id, x: 9, y: 3, drag: true });
  assert.equal(out.ok, true, out.error);
  assert.ok(nextTo(ownToken(world, hero.id), ownToken(world, foe.id)));
  assert.equal(world.sheet(hero.id).conditions.includes("grappled"), true);
});

await test("A character who drags the enemy rider they grapple takes the rider alone: the mount stays where the pair stood on a token of its own, and the rider stands beside the character, still held.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero({ ...RIDER, name: "Kara" });
  await world.beginFight([{ monster: "goblin", mount: "wolf" }], { heroFaces: { [hero.id]: 19 } });
  const rider = world.enemies().find((enemy) => enemy.ridesEnemyId);
  const mount = world.enemies().find((enemy) => enemy.id === rider?.ridesEnemyId);
  assert.ok(rider && mount, "setup: the fight has no rider on a mount");
  const kit = await combatKit(world);
  await layMap(world, OPEN(), { [hero.id]: { x: 6, y: 4 }, [rider.id]: { x: 5, y: 4 } });
  kit.setEnemy(rider.id, { maxHp: 60, currentHp: 60, conditions: ["grappled"], conditionMeta: { grappled: { source: hero.id } } });
  await settleQueue(world.campaignId);
  // A fight may open held for the enemies ahead of her; this is her turn.
  const floor = getFloor(world.campaignId);
  if (floor.mode === "hold") setFloor(world.campaignId, floor.next);
  kit.giveTurn(hero.id);
  // Both enemies have reacted, so her walk away draws no opportunity attack
  // and every die rolled would be the drag's.
  saveEncounter({ ...world.encounter(), reactionsUsed: [rider.id, mount.id] });
  world.clearDice();
  world.diceLog();
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: hero.userId });
  world.dice(1);
  const response = await route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 8, y: 4, drag: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(world.clearDice(), 1, "the dragged rider rolled a die");
  const rows = listEnemies(world.encounter().id);
  const riderNow = rows.find((entry) => entry.id === rider.id);
  assert.equal(riderNow.ridesEnemyId ?? null, null, "the wolf was dragged along under its rider");
  const left = ownToken(world, mount.id);
  assert.ok(left, "the mount has no token of its own after its rider was dragged off");
  assert.deepEqual([left.x, left.y], [5, 4], "the mount did not stay where the pair stood");
  const dragged = ownToken(world, rider.id);
  const puller = ownToken(world, hero.id);
  assert.deepEqual([puller.x, puller.y], [8, 4]);
  assert.ok(dragged && nextTo(dragged, puller), `the rider at (${dragged?.x},${dragged?.y}) was not set down beside the character`);
  assert.equal(riderNow.conditions.some((entry) => /prone/i.test(entry)), false, "a drag knocked the rider prone");
  assert.equal(riderNow.conditions.some((entry) => /grappled/i.test(entry)), true, "the drag let the rider go");
  assert.match(said(world), /Kara drags .* out of the saddle; .* stays\./, `the table was told nothing: ${said(world)}`);
});

finish();
