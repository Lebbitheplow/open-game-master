// A push that names a mounted character (issue 1055, ruling 6, the player's
// side).
//
// "The rider is pushed out of the saddle, and the mount stays. A push moves
// the creature it targets. The mount-moved clause applies only when the mount
// moves ... So when a push or pull names the rider, the rider ends up where
// the push ends and lands prone ... If the push would end inside a Large
// mount's space, use the nearest open square just outside it. The rider gets
// no extra DC 10 save ... If only the mount is pushed, the rider makes the DC
// 10 save to stay on. If both are pushed together, the pair moves and the
// rider saves once. Players should follow the same reading once the engine
// can tell that a push named the rider."
//
// A character and their mount stand on the character's one token, so every
// push, pull and forced move_token of it moved the pair and asked the save
// (mount-moved.ts). The engine can tell which was named: the character's own
// id is the rider, and the id of a creature mount that keeps its own turn is
// the mount.
//
// What each test holds:
//   - the doors: a forced move_token, a push, a pull, a standing area that
//     pushes;
//   - the mounts: one on record, a creature ridden as a controlled mount, a
//     creature ridden as an independent one;
//   - a Large mount whose own space the push would end inside;
//   - the mount named still carries the pair, and the mount and then the
//     rider in one call move as one;
//   - a willing move, and Born to the Saddle;
//   - the player's Undo and the GM's Revert this turn afterwards.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { caster, closeTables, FIGHTER } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { mapOf, OPEN } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-enforce-pc-rider-push");
const { listTokens, setTokenMovement } = await import("../src/lib/db/battle-maps.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { getMounts } = await import("../src/lib/db/mounts.ts");
const { tokenFootprint } = await import("../src/lib/dm/board-reach.ts");
const { pullTokenToward, pushTokenAway } = await import("../src/lib/dm/map-tools.ts");
const { settleMovedRiders } = await import("../src/lib/dm/mount-tools.ts");
const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
const { saveZones } = await import("../src/lib/dm/zone-store.ts");
const { zoneTurnStart } = await import("../src/lib/dm/zone-triggers.ts");

const RIDER = { ...FIGHTER, speed: 30 };
const SMALL = { ...FIGHTER, speed: 25, race: "Halfling" };
const PALADIN = () => caster("paladin", "cha", ["Find Steed"], [], 5, { speed: 30 });
const CAVALIER = {
  class: "fighter", subclass: "Cavalier", level: 5, maxHp: 60, speed: 30, proficiencies: TRAINED,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
};

const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;
const at = (world, refId) => [ownToken(world, refId)?.x, ownToken(world, refId)?.y];
const mountOf = (world, sheet) => getMounts(world.campaignId)[sheet.id];
const prone = (world, sheet) => world.sheet(sheet.id).conditions.includes("prone");
const orderIds = (world) => world.encounter().order.map((entry) => entry.characterId ?? entry.enemyId);
const d20s = (world) => world.diceLog().filter((die) => die.sides === 20).length;
const steedOf = (world) => world.sheets().find((sheet) => sheet.summon?.spell === "Find Steed");
// Whether (x,y) lies in the space a creature `wide` squares a side holds from `corner`.
const inside = (spot, corner, wide) => spot.x >= corner[0] && spot.x < corner[0] + wide && spot.y >= corner[1] && spot.y < corner[1] + wide;
const nextTo = (spot, x, y) => Math.max(Math.abs(spot.x - x), Math.abs(spot.y - y)) <= 1;

function turnOf(world, id) {
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => (entry.characterId ?? entry.enemyId) === id), turnBudget: null });
}

// A fighter on a mount on record, corner at (5,3), and one enemy whose turn
// it is. The warhorse is Large: the pair holds (5,3) to (6,4).
async function onRecord({ hero: who = RIDER, mount = "Warhorse", enemy = { x: 20, y: 7 }, ownTurn = false } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(who);
  const [foe] = await fightDummies(world, 1, { heroFaces: { [hero.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [hero.id]: { x: 5, y: 3 }, [foe.id]: enemy });
  const up = await world.invoke("mount_up", { characterId: hero.id, mount });
  assert.equal(up.ok, true, up.error);
  assert.deepEqual(at(world, hero.id), [5, 3], "setup: mounting moved the rider");
  if (!ownTurn) turnOf(world, foe.id);
  world.clearDice();
  world.diceLog();
  return { world, hero, foe };
}

// A paladin on the warhorse Find Steed made, at (5,3), the steed's own token
// gone under them, and one enemy whose turn it is.
async function onSteed({ controlled = true } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const hero = world.addHero(PALADIN());
  const cast = await world.invoke("cast_buff", { characterId: hero.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(cast.ok, true, cast.error);
  const steed = steedOf(world);
  const [foe] = await fightDummies(world, 1, { heroFaces: { [hero.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [hero.id]: { x: 5, y: 3 }, [steed.id]: { x: 6, y: 3 }, [foe.id]: { x: 20, y: 7 } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  saveEncounter({ ...encounter, order: [entry(hero.id), entry(steed.id), entry(foe.id)], turnIndex: 0, turnBudget: null });
  const up = await world.invoke("mount_up", { characterId: hero.id, mount: "Warhorse", ...(controlled ? {} : { controlled: false }) });
  assert.equal(up.ok, true, up.error);
  assert.equal(mountOf(world, hero)?.sheetId, steed.id, "setup: the steed is not the mount");
  assert.equal(ownToken(world, steed.id), null, "setup: the ridden steed kept a token");
  const corner = at(world, hero.id);
  turnOf(world, foe.id);
  world.clearDice();
  world.diceLog();
  return { world, hero, steed, foe, corner };
}

// The rider is out of the saddle, on a token of one square, with no save rolled.
function assertOut(world, hero, label = "the rider") {
  assert.equal(mountOf(world, hero), undefined, `${label} is still mounted`);
  assert.equal(tokenFootprint(ownToken(world, hero.id)), 1, `${label} on foot still fills the mount's space`);
  assert.equal(d20s(world), 0, `${label} pushed from the saddle rolled a save to stay on`);
}

const post = async (world, sheet, name, body) => {
  const route = await world.route(`campaigns/[campaignId]/battle-map/${name}`);
  world.signIn({ id: sheet.userId });
  const response = await route.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/${name}`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
};

// ---- a mount on record ----

await test("A forced move_token that names a character on a mount on record carries them alone out of the saddle to that square, prone, with no save.", async () => {
  const { world, hero } = await onRecord({ hero: SMALL, mount: "Pony" });
  assert.equal(tokenFootprint(ownToken(world, hero.id)), 1, "setup: a pony is one square");
  // A die left over would be the save the ruling says is not made.
  world.dice(20);
  const out = await world.invoke("move_token", { token: hero.id, x: 9, y: 5, forced: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 1, "a rider carried from the saddle made a save");
  assert.match(out.result.note ?? "", /out of the saddle/, JSON.stringify(out.result));
  assertOut(world, hero);
  assert.deepEqual(at(world, hero.id), [9, 5], "the rider did not end where the push ends");
  assert.equal(prone(world, hero), true, "the rider pushed from the saddle did not land prone");
});

await test("A forced move_token that would end inside a Large mount's own space sets the rider down in the nearest open square just outside it.", async () => {
  const { world, hero } = await onRecord();
  assert.equal(tokenFootprint(ownToken(world, hero.id)), 2, "setup: the pair does not fill the warhorse's space");
  const out = await world.invoke("move_token", { token: hero.id, x: 6, y: 4, forced: true });
  assert.equal(out.ok, true, out.error);
  assertOut(world, hero);
  const fallen = ownToken(world, hero.id);
  assert.equal(inside(fallen, [5, 3], 2), false, `the rider lies at (${fallen.x},${fallen.y}), inside the space the mount stays in`);
  assert.ok(nextTo(fallen, 6, 4), `the rider at (${fallen.x},${fallen.y}) is not in the open square nearest where the push ended`);
  assert.equal(prone(world, hero), true);
});

await test("A push that names a character on a Large mount on record takes them alone: one square would end inside the mount's space, so they lie just outside it, with no save.", async () => {
  const { world, hero, foe } = await onRecord({ enemy: { x: 4, y: 3 } });
  world.dice(20);
  const pushed = onPersonsTurn(world.campaign(), () => {
    const moved = pushTokenAway(world.campaign(), world.encounter().id, foe.id, hero.id);
    return { moved, lines: settleMovedRiders(world.campaign()) };
  });
  assert.equal(pushed.moved.moved, true, pushed.moved.reason);
  assert.equal(world.clearDice(), 1, "the pushed rider made a save to stay on");
  assertOut(world, hero);
  const fallen = ownToken(world, hero.id);
  assert.equal(inside(fallen, [5, 3], 2), false, `the rider lies at (${fallen.x},${fallen.y}), inside the space the mount stays in`);
  assert.ok(nextTo(fallen, 6, 3), `the rider at (${fallen.x},${fallen.y}) is not beside where the push ended`);
  assert.deepEqual([pushed.moved.at.x, pushed.moved.at.y], [fallen.x, fallen.y], "the push reports a square the rider is not on");
  assert.equal(prone(world, hero), true);
  assert.match(pushed.lines.join(" "), /out of the saddle.*no save/, `the call's result says nothing of it: ${JSON.stringify(pushed.lines)}`);
});

// A creature knocked off a flying mount falls. The board keeps no height, so
// the token comes down and the GM is told the fall's damage is theirs to send.
await test("A push that names a character on a griffon in the air takes them out of the saddle and down: on the ground, prone, and the GM told to send the fall.", async () => {
  const { world, hero, foe } = await onRecord({
    hero: { ...RIDER, equipment: [...RIDER.equipment, { name: "Saddle, Exotic", qty: 1 }] },
    mount: "Griffon",
    enemy: { x: 4, y: 3 },
  });
  setTokenMovement(ownToken(world, hero.id).id, "fly");
  const pushed = onPersonsTurn(world.campaign(), () => {
    const moved = pushTokenAway(world.campaign(), world.encounter().id, foe.id, hero.id);
    return { moved, lines: settleMovedRiders(world.campaign()) };
  });
  assert.equal(pushed.moved.moved, true, pushed.moved.reason);
  assertOut(world, hero);
  assert.equal(ownToken(world, hero.id).movement, "walk", "the rider thrown from a flying mount is still in the air");
  assert.equal(prone(world, hero), true);
  assert.match(pushed.lines.join(" "), /apply_hazard falling/, `the GM is not told of the fall: ${JSON.stringify(pushed.lines)}`);
});

await test("A pull that names a character on a mount on record draws them alone out of the saddle, prone where the pull ends.", async () => {
  const { world, hero, foe } = await onRecord({ hero: SMALL, mount: "Pony", enemy: { x: 9, y: 3 } });
  world.dice(20);
  const pulled = onPersonsTurn(world.campaign(), () => {
    const moved = pullTokenToward(world.campaign(), world.encounter().id, foe.id, hero.id);
    settleMovedRiders(world.campaign());
    return moved;
  });
  assert.equal(pulled.moved, true, pulled.reason);
  assert.equal(world.clearDice(), 1, "the pulled rider made a save to stay on");
  assertOut(world, hero);
  assert.deepEqual(at(world, hero.id), [6, 3]);
  assert.equal(prone(world, hero), true);
});

// ---- a creature as the mount ----

await test("A forced move_token that names the rider of a controlled creature mount takes the rider alone: the steed stands where the pair stood, on its own token, back in the order.", async () => {
  const { world, hero, steed, corner } = await onSteed();
  assert.ok(!orderIds(world).includes(steed.id), "setup: a controlled steed kept its turn");
  world.dice(20);
  const out = await world.invoke("move_token", { token: hero.id, x: 10, y: 6, forced: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 1, "a rider carried from the saddle made a save");
  assertOut(world, hero);
  assert.deepEqual(at(world, hero.id), [10, 6]);
  assert.deepEqual(at(world, steed.id), corner, "the steed does not stand where the pair stood");
  assert.ok(orderIds(world).includes(steed.id), "the riderless steed has no turn");
  assert.equal(prone(world, hero), true);
  assert.equal(prone(world, steed), false);
});

await test("A forced move_token that names the rider of an independent creature mount takes the rider alone, and the mount keeps its square and its turn.", async () => {
  const { world, hero, steed, corner } = await onSteed({ controlled: false });
  world.dice(20);
  const out = await world.invoke("move_token", { token: hero.id, x: 10, y: 6, forced: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 1, "a rider carried from the saddle made a save");
  assertOut(world, hero);
  assert.deepEqual(at(world, hero.id), [10, 6]);
  assert.deepEqual(at(world, steed.id), corner, "the mount does not stand where the pair stood");
  assert.equal(orderIds(world).filter((id) => id === steed.id).length, 1, "the mount's place in the order was lost or doubled");
  assert.equal(prone(world, hero), true);
});

await test("A forced move_token that names the independent mount still carries the pair, and its rider saves once as the call finishes: a made save keeps the saddle.", async () => {
  const { world, hero, steed } = await onSteed({ controlled: false });
  world.dice(15);
  const out = await world.invoke("move_token", { token: steed.id, x: 10, y: 6, forced: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 0, "the rider of a mount moved against its will made no save");
  assert.equal(d20s(world), 1, "the rider saved more than once for one move");
  assert.equal(mountOf(world, hero)?.sheetId, steed.id, "a made save took the rider off");
  assert.deepEqual(at(world, hero.id), [10, 6], "the pair's token did not go with the mount");
  assert.equal(ownToken(world, steed.id), null);
  assert.equal(prone(world, hero), false);
});

await test("A forced move_token that names the independent mount throws a rider who fails the save, as it did before.", async () => {
  const { world, hero, steed } = await onSteed({ controlled: false });
  world.dice(1);
  const out = await world.invoke("move_token", { token: steed.id, x: 10, y: 6, forced: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.clearDice(), 0, "the rider of a mount moved against its will made no save");
  assert.equal(mountOf(world, hero), undefined, "a failed save kept the rider on");
  assert.equal(prone(world, hero), true);
});

await test("One call that pushes the mount and then names its rider moves the pair as one, and the rider saves once.", async () => {
  const { world, hero, steed, foe, corner } = await onSteed({ controlled: false });
  await layMap(world, OPEN(), { [hero.id]: { x: corner[0], y: corner[1] }, [foe.id]: { x: corner[0] - 1, y: corner[1] } });
  world.diceLog();
  world.dice(15);
  const done = onPersonsTurn(world.campaign(), () => {
    const first = pushTokenAway(world.campaign(), world.encounter().id, foe.id, steed.id);
    const second = pushTokenAway(world.campaign(), world.encounter().id, foe.id, hero.id);
    return { first, second, lines: settleMovedRiders(world.campaign()) };
  });
  assert.equal(done.first.moved, true, done.first.reason);
  assert.equal(done.second.moved, false, "the rider was pushed again after their mount carried them");
  assert.match(done.second.reason, /pair moved as one/);
  assert.equal(world.clearDice(), 0, "the rider made no save");
  assert.equal(d20s(world), 1, "the rider saved more than once");
  assert.equal(done.lines.length, 1, JSON.stringify(done.lines));
  assert.equal(mountOf(world, hero)?.sheetId, steed.id);
  assert.deepEqual(at(world, hero.id), [corner[0] + 1, corner[1]], "the pair was not pushed once, as one");
});

// ---- a standing area that pushes ----

// Gust of Wind left standing: "Each creature that starts its turn in the
// line must succeed on a Strength saving throw or be pushed 15 feet away
// from you." The line runs east along row 3 from (3,3), over the pair.
function windOver(world) {
  const map = mapOf(world);
  const cells = [4, 5, 6, 7, 8, 9, 10, 11, 12].map((x) => 3 * map.width + x);
  saveZones(map.id, [{ id: "gust-pair", spell: "Gust of Wind", casterId: "the-wind", casterKind: "enemy", casterName: "The wind", origin: { x: 3, y: 3 }, toward: { x: 20, y: 3 }, cells, concentration: false, castRound: world.encounter().round, untilRound: null, slotLevel: 2, dc: 30 }]);
}
const turnStartsFor = (world, id) => onPersonsTurn(world.campaign(), () => [...zoneTurnStart(world.campaign(), world.encounter(), [id]), ...settleMovedRiders(world.campaign())]);

await test("A rider whose turn starts in a standing area that pushes is pushed alone out of the saddle, with no save to stay on.", async () => {
  const { world, hero } = await onRecord({ hero: SMALL, mount: "Pony" });
  windOver(world);
  // Their Strength save against the wind; a second die would be the save to stay on.
  world.dice(1, 20);
  const lines = turnStartsFor(world, hero.id);
  assert.equal(world.clearDice(), 1, `the rider the wind took made a save to stay on: ${JSON.stringify(lines)}`);
  assert.equal(mountOf(world, hero), undefined, "the rider the wind took is still mounted");
  assert.deepEqual(at(world, hero.id), [8, 3]);
  assert.equal(prone(world, hero), true);
});

await test("An independent mount whose turn starts in a standing area that pushes is pushed with its rider on it, who saves once to stay on.", async () => {
  const { world, hero, steed, corner } = await onSteed({ controlled: false });
  windOver(world);
  world.dice(1, 15);
  const lines = turnStartsFor(world, steed.id);
  assert.equal(world.clearDice(), 0, `the wind asked the mount no save, or its rider none to stay on: ${JSON.stringify(lines)}`);
  assert.equal(mountOf(world, hero)?.sheetId, steed.id);
  assert.deepEqual(at(world, hero.id), [corner[0] + 3, corner[1]], "the pair did not go with the mount");
});

// ---- what is not a push at the rider ----

await test("A willing move keeps the pair together and asks nothing: an ally's shove that the rider lets happen moves the mount with them.", async () => {
  const { world, hero, foe } = await onRecord({ hero: SMALL, mount: "Pony", enemy: { x: 4, y: 3 } });
  world.dice(1);
  const moved = onPersonsTurn(world.campaign(), () => {
    const out = pushTokenAway(world.campaign(), world.encounter().id, foe.id, hero.id, true);
    settleMovedRiders(world.campaign());
    return out;
  });
  assert.equal(moved.moved, true, moved.reason);
  assert.equal(mountOf(world, hero)?.name, "Pony", "a willing move took the rider out of the saddle");
  assert.deepEqual(at(world, hero.id), [6, 3]);
  assert.equal(prone(world, hero), false);
});

await test("Born to the Saddle: a Cavalier pushed out of the saddle of a mount on the ground lands on their feet.", async () => {
  const { world, hero } = await onRecord({ hero: CAVALIER });
  const out = await world.invoke("move_token", { token: hero.id, x: 9, y: 5, forced: true });
  assert.equal(out.ok, true, out.error);
  assertOut(world, hero);
  assert.deepEqual(at(world, hero.id), [9, 5]);
  assert.equal(prone(world, hero), false, "a Cavalier off a mount on the ground fell prone");
});

// ---- taking it back ----

await test("Revert this turn after a rider on a mount on record is pushed out puts the pair back in its four squares.", async () => {
  const { world, hero } = await onRecord();
  const before = snapshot();
  const out = await world.invoke("move_token", { token: hero.id, x: 9, y: 5, forced: true });
  assert.equal(out.ok, true, out.error);
  assert.equal(mountOf(world, hero), undefined);
  const reverted = await revertTurn(world, out.turnId);
  assert.equal(reverted.status, 200, JSON.stringify(reverted.json).slice(0, 300));
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.equal(mountOf(world, hero)?.name, "Warhorse", "the revert left the rider on foot");
  assert.deepEqual(at(world, hero.id), [5, 3]);
  assert.equal(tokenFootprint(ownToken(world, hero.id)), 2);
  assert.equal(prone(world, hero), false, "the revert left the rider prone");
});

for (const controlled of [true, false]) {
  await test(`Revert this turn after the rider of ${controlled ? "a controlled" : "an independent"} creature mount is pushed out puts them back on it: one token, and the order as it was.`, async () => {
    const { world, hero, steed, corner } = await onSteed({ controlled });
    const order = orderIds(world);
    const before = snapshot();
    const out = await world.invoke("move_token", { token: hero.id, x: 10, y: 6, forced: true });
    assert.equal(out.ok, true, out.error);
    assert.equal(mountOf(world, hero), undefined);
    const reverted = await revertTurn(world, out.turnId);
    assert.equal(reverted.status, 200, JSON.stringify(reverted.json).slice(0, 300));
    assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
    assert.equal(mountOf(world, hero)?.sheetId, steed.id, "the revert left the rider on foot");
    assert.deepEqual(at(world, hero.id), corner);
    assert.equal(ownToken(world, steed.id), null, "the steed kept the token the reverted turn gave it");
    assert.deepEqual(orderIds(world), order);
  });
}

await test("The player's Undo does not reach back across a push out of the saddle: the walk before it stands, and nothing is set down in the mount's space.", async () => {
  const { world, hero, foe } = await onRecord({ ownTurn: true });
  const walk = await post(world, hero, "move", { x: 9, y: 3 });
  assert.equal(walk.status, 200, JSON.stringify(walk.json).slice(0, 300));
  assert.deepEqual(at(world, hero.id), [9, 3]);
  // A reaction's push on the rider's own turn, from the square west of them.
  await layMap(world, OPEN(), { [hero.id]: { x: 9, y: 3 }, [foe.id]: { x: 8, y: 3 } });
  const walked = await post(world, hero, "move", { x: 10, y: 3 });
  assert.equal(walked.status, 200, JSON.stringify(walked.json).slice(0, 300));
  const pushed = onPersonsTurn(world.campaign(), () => {
    const moved = pushTokenAway(world.campaign(), world.encounter().id, foe.id, hero.id);
    settleMovedRiders(world.campaign());
    return moved;
  });
  assert.equal(pushed.moved, true, pushed.reason);
  assert.equal(mountOf(world, hero), undefined, "the pushed rider is still mounted");
  const landed = at(world, hero.id);
  const undone = await post(world, hero, "undo");
  assert.notEqual(undone.status, 200, "a walk made in the saddle was taken back after the rider was pushed out of it");
  assert.deepEqual(at(world, hero.id), landed, "the refused Undo moved the rider");
  assert.equal(mountOf(world, hero), undefined);
  assert.equal(prone(world, hero), true);
});

await test("After a push out of the saddle the rider's own next walk can be taken back, to the square they landed on, still on foot.", async () => {
  const { world, hero } = await onRecord();
  const out = await world.invoke("move_token", { token: hero.id, x: 9, y: 5, forced: true });
  assert.equal(out.ok, true, out.error);
  turnOf(world, hero.id);
  const walk = await post(world, hero, "move", { x: 9, y: 6 });
  assert.equal(walk.status, 200, JSON.stringify(walk.json).slice(0, 300));
  assert.deepEqual(at(world, hero.id), [9, 6]);
  const undone = await post(world, hero, "undo");
  assert.equal(undone.status, 200, JSON.stringify(undone.json).slice(0, 300));
  assert.deepEqual(at(world, hero.id), [9, 5], "the walk was not taken back to where the push left them");
  assert.equal(mountOf(world, hero), undefined, "Undo put the rider back in the saddle");
  assert.equal(tokenFootprint(ownToken(world, hero.id)), 1);
  assert.equal(prone(world, hero), true, "Undo did not lie them back down");
});

closeTables();
finish();
