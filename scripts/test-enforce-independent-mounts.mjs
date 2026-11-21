// An independent mount: a creature that carries a rider and keeps its own
// turn (issue 1036).
//
// "You can either control the mount or allow it to act independently.
// Intelligent creatures, such as dragons, act independently." "An
// independent mount retains its place in the initiative order. Bearing a
// rider puts no restrictions on the actions the mount can take, and it moves
// and acts as it wishes" (SRD 5.1, Controlling a Mount).
//
// The rulings each test holds:
//   1. only a creature with a stat block is independent; a mount that is a
//      name on its rider's record stays controlled, and the result says why;
//   2. one token: the pair stands on the rider's, and the mount's turn moves it;
//   3. the GM plays the mount's turn, not the rider's player;
//   4. controlled by default; `controlled: false` on mount_up for a creature;
//   5. mounting and getting down are paid from the rider's own turn and
//      speed, and the rider does not move the pair.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { aiEngine } from "./lib/enforce-narrator.mjs";
import { caster, closeTables } from "./lib/enforce-spell-kit.mjs";
import { castOnOwnTurn, fightDummies, layMap } from "./lib/enforce-spells.mjs";
import { holdTurn, mapOf, nextTurn, OPEN, place, tokenOf } from "./lib/enforce-zones.mjs";
import { diff, revertTurn, snapshot } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-enforce-independent-mounts");
const { listTokens } = await import("../src/lib/db/battle-maps.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { getMounts } = await import("../src/lib/db/mounts.ts");
const { dmPlaysTurn } = await import("../src/lib/dm/companion-command.ts");
const { pcMoveBudget } = await import("../src/lib/battlemap/view.ts");
const { allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");

const PALADIN = () => caster("paladin", "cha", ["Find Steed"], [], 5, { speed: 30 });
const steedOf = (world) => world.sheets().find((sheet) => sheet.summon?.spell === "Find Steed");
const orderIds = (world) => world.encounter().order.map((entry) => entry.characterId ?? entry.enemyId);
const ownToken = (world, refId) => listTokens(mapOf(world).id).find((token) => token.refId === refId) ?? null;
const at = (world, refId) => [tokenOf(world, refId).x, tokenOf(world, refId).y];
// What a player typed: the AI walks a character only for a move their player declared.
const say = (world, content, sheet) =>
  insertCampaignMessage({ campaignId: world.campaignId, seq: allocateSeq(world.campaignId), authorType: "player", content, userId: sheet.userId, characterId: sheet.id });

// A paladin and the warhorse Find Steed made, in a fight on an open board
// with one enemy far off: the paladin acts first, the steed right after.
async function table() {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const paladin = world.addHero(PALADIN());
  const cast = await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  assert.equal(cast.ok, true, cast.error);
  const steed = steedOf(world);
  const [enemy] = await fightDummies(world, 1, { heroFaces: { [paladin.id]: 20 } });
  castOnOwnTurn(world);
  await layMap(world, OPEN(), { [paladin.id]: { x: 3, y: 3 }, [steed.id]: { x: 4, y: 3 }, [enemy.id]: { x: 20, y: 8 } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => (row.characterId ?? row.enemyId) === id);
  saveEncounter({ ...encounter, order: [entry(paladin.id), entry(steed.id), entry(enemy.id)], turnIndex: 0, turnBudget: null });
  return { world, paladin, steed, enemy, ai: await aiEngine(world) };
}

// The same table with the paladin up on the steed as an independent mount.
async function riding() {
  const seat = await table();
  const up = await seat.world.invoke("mount_up", { characterId: seat.paladin.id, mount: "Warhorse", controlled: false });
  assert.equal(up.ok, true, up.error);
  return { ...seat, up };
}

const moveRoute = async (world, sheet, x, y) => {
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: sheet.userId });
  const response = await route.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, { method: "POST", body: JSON.stringify({ x, y }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
};

await test("Ruling 4: a steed mounted with no word on control is a controlled mount, out of the order; controlled false makes it independent.", async () => {
  const plain = await table();
  const up = await plain.world.invoke("mount_up", { characterId: plain.paladin.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  assert.equal(getMounts(plain.world.campaignId)[plain.paladin.id].controlled, true, "a steed is independent by default");
  assert.ok(!orderIds(plain.world).includes(plain.steed.id), "a controlled steed kept a turn of its own");

  const free = await riding();
  const record = getMounts(free.world.campaignId)[free.paladin.id];
  assert.equal(record.controlled, false, "controlled false on a creature mount was not kept");
  assert.equal(record.sheetId, free.steed.id);
  assert.match(free.up.result.creature, /independent mount/, `the result does not say the mount is independent: ${free.up.result.creature}`);
});

await test("Ruling 1: a mount that is only a name on its rider's record stays controlled, whatever was asked, and the result says why.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const rider = world.addHero(PALADIN());
  const custom = await world.invoke("mount_up", { characterId: rider.id, customName: "Old Bess", speed: 40, size: "large", controlled: false });
  assert.equal(custom.ok, true, custom.error);
  assert.equal(getMounts(world.campaignId)[rider.id].controlled, true, "a hand-written mount with no stat block was made independent");
  assert.match(custom.result.controlled ?? "", /controlled mount.*stat block/, `the result does not say why it stays controlled: ${JSON.stringify(custom)}`);
  await world.invoke("dismount", { characterId: rider.id });
  // The elk's profile is not a trained mount, and it is still a record.
  const elk = await world.invoke("mount_up", { characterId: rider.id, mount: "Elk" });
  assert.equal(elk.ok, true, elk.error);
  assert.equal(getMounts(world.campaignId)[rider.id].controlled, true, "a listed elk, a record with no creature, was left independent with no turn to act on");
  assert.match(elk.result.controlled ?? "", /controlled mount/);
  await world.invoke("dismount", { characterId: rider.id });
  const horse = await world.invoke("mount_up", { characterId: rider.id, mount: "Warhorse" });
  assert.equal(horse.ok, true, horse.error);
  assert.equal(horse.result.controlled, undefined, "a trained mount's result explains a change that was not made");
});

await test("Ruling 2: an independent mount keeps its place in the initiative order and has no token of its own; the pair stands on the rider's token.", async () => {
  const before = await table();
  const placeBefore = orderIds(before.world).indexOf(before.steed.id);
  const { world, paladin, steed } = await riding();
  assert.equal(orderIds(world).indexOf(steed.id), placeBefore, "the independent mount lost or changed its place in the order");
  assert.equal(orderIds(world).filter((id) => id === steed.id).length, 1);
  assert.equal(ownToken(world, steed.id), null, "the mount kept a token of its own: two tokens for one pair");
  assert.ok(ownToken(world, paladin.id), "the rider's token is gone");
  assert.equal(tokenOf(world, steed.id)?.refId, paladin.id, "the mount is not found where its rider stands");
});

await test("Ruling 3: the mount's turn is the GM's to play, and its walk carries the rider's token at the mount's speed.", async () => {
  const { world, paladin, steed, ai } = await riding();
  nextTurn(world);
  const current = world.encounter().order[world.encounter().turnIndex];
  assert.equal(current.characterId, steed.id, "setup: the pointer is not on the steed");
  assert.equal(dmPlaysTurn(world.campaign(), current), true, "the mount's turn is not the GM's to play");
  assert.equal(tokenOf(world, paladin.id).movedThisRound, 0, "the mount's turn began with the rider's mounting cost still spent on the token they share");
  // 65 feet asked of a 60-foot speed: the walk stops where the movement does.
  const walk = await ai.invoke("move_token", { token: steed.name, x: 16, y: 3 });
  assert.equal(walk.ok, true, walk.error);
  assert.deepEqual(at(world, paladin.id), [15, 3], "the mount's move did not carry its rider's token its 60 feet");
  assert.equal(ownToken(world, steed.id), null, "the mount's move gave it a token of its own");
  const more = await ai.invoke("move_token", { token: steed.name, x: 16, y: 3 });
  assert.equal(more.ok, false, "the mount walked past its 60 feet");
});

await test("Rulings 2 and 5: on their own turn the rider does not move the pair, from the board or by the GM's hand, and has their own speed's movement to get down with.", async () => {
  const { world, paladin, ai } = await riding();
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  const dragged = await moveRoute(world, paladin, 5, 3);
  assert.equal(dragged.status, 409, `the rider's player walked the pair on the rider's turn: ${JSON.stringify(dragged.json)}`);
  assert.match(dragged.json.error, /independent mount/);
  say(world, "Hero rides five yards on.", paladin);
  const typed = await ai.invoke("move_token", { token: paladin.id, x: 5, y: 3 });
  assert.equal(typed.ok, false, "the GM walked the pair on the rider's turn");
  assert.match(typed.error, /independent mount/);
  assert.deepEqual(at(world, paladin.id), [3, 3]);
  const budget = pcMoveBudget(world.campaignId, world.encounter(), mapOf(world), world.sheet(paladin.id), tokenOf(world, paladin.id));
  assert.equal(budget.tiles, 0, "the board lights squares for a rider who cannot walk");
  assert.equal(budget.speed, 30, "the rider's own movement is counted at the mount's speed");

  // A controlled steed's rider walks at the mount's speed on their own turn.
  const led = await table();
  await led.world.invoke("mount_up", { characterId: led.paladin.id, mount: "Warhorse" });
  holdTurn(led.world, led.paladin.id);
  place(led.world, led.paladin.id, 3, 3);
  assert.equal((await moveRoute(led.world, led.paladin, 13, 3)).status, 200, "a controlled mount's rider lost their ride");
});

await test("The rider cannot spend an independent mount's action on their own turn: it takes its actions on its own.", async () => {
  const { world, paladin, steed, ai } = await riding();
  holdTurn(world, paladin.id);
  const borrowed = await world.invoke("take_action", { characterId: paladin.id, action: "dash", mount: true });
  assert.equal(borrowed.ok, false, "the rider took the independent mount's Dash");
  assert.match(borrowed.error, /independent mount/);
  nextTurn(world);
  const dash = await ai.invoke("take_action", { characterId: steed.id, action: "dash" });
  assert.equal(dash.ok, true, dash.error);
  // The pair fills the warhorse's space, two squares a side (issue 1055), so
  // its corner square goes no further than the board's last column but one.
  const walk = await ai.invoke("move_token", { token: steed.name, x: 22, y: 3 });
  assert.equal(walk.ok, true, `the mount's own Dash did not double its move: ${walk.error}`);
  assert.deepEqual(at(world, paladin.id), [22, 3]);
});

await test("Getting down from an independent mount costs half the rider's own speed, puts the mount back on a square beside them, and leaves its place in the order as it was.", async () => {
  const { world, paladin, steed } = await riding();
  const order = orderIds(world);
  nextTurn(world);
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  const down = await world.invoke("dismount", { characterId: paladin.id });
  assert.equal(down.ok, true, down.error);
  assert.equal(down.result.movementSpent, 15);
  assert.equal(tokenOf(world, paladin.id).movedThisRound, 3, "getting down was not charged to the rider's own movement");
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined);
  const horse = ownToken(world, steed.id);
  assert.ok(horse, "the mount has no token after its rider got down");
  const rider = tokenOf(world, paladin.id);
  assert.ok(Math.max(Math.abs(horse.x - rider.x), Math.abs(horse.y - rider.y)) <= 2, "the mount did not come back beside its rider");
  assert.ok(horse.x !== rider.x || horse.y !== rider.y, "two tokens on one square");
  assert.deepEqual(orderIds(world), order, "getting down changed the initiative order");
});

// "Standing up takes more effort; doing so costs an amount of movement equal
// to half your speed" (SRD 5.1, Being Prone): the rider's own speed, since
// the mount's movement is the mount's turn's.
await test("A rider prone in an independent mount's saddle stands for half their own speed, and has the other half to get down with.", async () => {
  const { world, paladin, ai } = await riding();
  nextTurn(world);
  holdTurn(world, paladin.id);
  place(world, paladin.id, 3, 3);
  world.patch(paladin.id, { conditions: ["prone"] });
  say(world, "Hero pulls themself upright in the saddle.", paladin);
  const stood = await ai.invoke("clear_condition", { characterId: paladin.id, condition: "prone" });
  assert.equal(stood.ok, true, stood.error);
  assert.deepEqual(world.sheet(paladin.id).conditions, [], "the rider is still prone");
  assert.equal(tokenOf(world, paladin.id).movedThisRound, 3, "standing up was charged half the mount's speed, not half the rider's");
  const down = await world.invoke("dismount", { characterId: paladin.id });
  assert.equal(down.ok, true, `the rider's other 15 feet did not pay for getting down: ${down.error}`);
  assert.equal(tokenOf(world, paladin.id).movedThisRound, 6);
});

await test("A rider thrown from an independent mount leaves it standing beside them with its turn where it was.", async () => {
  const { world, paladin, steed } = await riding();
  const order = orderIds(world);
  world.clearDice();
  world.dice(1);
  const thrown = await world.invoke("dismount", { characterId: paladin.id, cause: "forced-move" });
  world.clearDice();
  assert.equal(thrown.ok, true, thrown.error);
  assert.equal(thrown.result.dismounted, steed.name, `a 1 on the die kept the saddle: ${JSON.stringify(thrown)}`);
  assert.ok(ownToken(world, steed.id), "the mount has no token after it threw its rider");
  assert.deepEqual(orderIds(world), order, "the throw changed the initiative order");
});

await test("An independent mount that drops to 0 hit points leaves the order, and its rider comes down on their own token.", async () => {
  const { world, paladin, steed, enemy } = await riding();
  place(world, enemy.id, 3, 4);
  world.patch(steed.id, { currentHp: 1 });
  world.clearDice();
  // A 15 hits the warhorse's AC 11; a 3 on the damage die.
  world.dice(15, 3);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: paladin.id, targetMount: true });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(steed.id), null, "setup: the steed at 1 hit point did not disappear");
  assert.match(JSON.stringify(out.result), /"mountDown"/, `the blow's result says nothing of the mount going down: ${JSON.stringify(out.result).slice(0, 300)}`);
  assert.ok(!orderIds(world).includes(steed.id), "a steed that is gone kept its turn");
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined, "the rider still rides a steed that is gone");
  assert.deepEqual(at(world, paladin.id), [3, 3]);
  assert.ok(world.encounter().reactionsUsed.includes(paladin.id), "the rider spent no reaction landing on their feet");
});

await test("An independent mount that took the Dodge action on its own turn is attacked at disadvantage.", async () => {
  const { world, paladin, steed, enemy, ai } = await riding();
  nextTurn(world);
  const dodge = await ai.invoke("take_action", { characterId: steed.id, action: "dodge" });
  assert.equal(dodge.ok, true, dodge.error);
  place(world, enemy.id, 3, 4);
  world.clearDice();
  world.dice(2, 2);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: paladin.id, targetMount: true });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.match(JSON.stringify(out.result.notes ?? []), /dodging/, `the mount's own Dodge did not count: ${JSON.stringify(out.result).slice(0, 300)}`);
});

await test("Undoing the GM turn that mounted an independent mount puts the table back as the turn found it: the steed on its own square, its rider on foot.", async () => {
  const { world, paladin, steed } = await table();
  const before = snapshot();
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse", controlled: false });
  assert.equal(up.ok, true, up.error);
  assert.equal(ownToken(world, steed.id), null, "setup: the ridden mount kept its token");
  await revertTurn(world, up.turnId);
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.equal(getMounts(world.campaignId)[paladin.id], undefined);
  assert.ok(ownToken(world, steed.id), "the steed has no token after the turn was undone");
  assert.ok(orderIds(world).includes(steed.id));
});

await test("Undoing the GM turn in which an independent mount carried its rider puts the pair back where the turn found them.", async () => {
  const { world, paladin, steed, ai } = await riding();
  nextTurn(world);
  ai.fresh();
  const before = snapshot();
  const walk = await ai.invoke("move_token", { token: steed.name, x: 10, y: 3 });
  assert.equal(walk.ok, true, walk.error);
  await revertTurn(world, ai.turn().id);
  assert.deepEqual(diff(before, snapshot()), [], "after Revert this turn the table differs from the one the turn found");
  assert.deepEqual(at(world, paladin.id), [3, 3], "the pair did not go back to its square");
  assert.equal(getMounts(world.campaignId)[paladin.id]?.sheetId, steed.id, "the undo of a walk unseated the rider");
});

await test("A fight that begins with a rider already on an independent mount gives the mount its own place in the order and no token of its own.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const paladin = world.addHero(PALADIN());
  await world.invoke("cast_buff", { characterId: paladin.id, spell: "Find Steed", level: 2, variant: "warhorse" });
  const steed = steedOf(world);
  const up = await world.invoke("mount_up", { characterId: paladin.id, mount: "Warhorse", controlled: false });
  assert.equal(up.ok, true, up.error);
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [paladin.id]: 20 } });
  assert.ok(orderIds(world).includes(steed.id), "a mount that acts as it wishes was given no turn when the fight began");
  assert.ok(ownToken(world, paladin.id), "setup: the rider has no token");
  assert.equal(ownToken(world, steed.id), null, "the fight's board gave the ridden mount a token of its own");
});

// The guard on a forced move (issue 17) read the token's owner, and the
// pair's token is the rider's: on the mount's own turn a "push" by its name
// carried the pair past its speed, with nothing to say it was not a push.
await test("On an independent mount's own turn, a forced move by its name is refused as walking it: its move is the walk at its speed.", async () => {
  const { world, paladin, steed, ai } = await riding();
  nextTurn(world);
  assert.equal(world.encounter().order[world.encounter().turnIndex].characterId, steed.id, "setup: the pointer is not on the steed");
  const pushed = await ai.invoke("move_token", { token: steed.name, x: 23, y: 3, forced: true });
  assert.equal(pushed.ok, false, "a forced move on the mount's own turn carried the pair 100 feet of its 60");
  assert.match(pushed.error, new RegExp(`${steed.name}'s own turn`));
  assert.deepEqual(at(world, paladin.id), [3, 3]);
});

// "An area that catches a rider catches the mount under them" once
// (mount-area.ts): a call that also named the mount, a creature in the
// order now, struck it a second time.
await test("An area that names both the rider and their independent mount strikes the mount once.", async () => {
  const { world, paladin, steed } = await riding();
  const before = world.sheet(steed.id).currentHp;
  world.clearDice();
  world.dice(1, 1, 1, 1);
  const out = await world.invoke("aoe_damage", { damage: 8, type: "fire", saveAbility: "dex", dc: 30, halfOnSave: true, characterIds: [paladin.id, steed.id], reason: "a fire trap" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(steed.id).currentHp, before - 8, `the mount took the blast twice: ${JSON.stringify(out.result.results)}`);
  assert.equal(world.sheet(paladin.id).currentHp, world.sheet(paladin.id).maxHp - 8);
});

closeTables();
finish();
