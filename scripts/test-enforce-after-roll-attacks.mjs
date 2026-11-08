// The after-the-roll pause on attacks (src/lib/dm/after-roll-logic.ts
// afterAttackOptions, pc-attack-parked.ts throwForChoice): a luck point and a
// held Bardic Inspiration die are decided after the d20 of a player's attack
// lands, and before the game says whether it hit.
//
// The rules held:
//   an attack waits only when it misses as it stands and what the attacker
//   holds could turn it into a hit; nothing is spent until the player spends
//   it, and a held die survives an attack that needed none or could not use it;
//   once the player decides, the attack lands through the same stages as any
//   other, and the server throws its damage;
//   the swings declared after a waiting one are made once it lands, in order;
//   real dice entered at the table wait the same way.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-after-roll-attacks");
const world = await openWorld({ campaign: { maxPlayers: 12 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getDmTurn, getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getRoll, listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { fillQueuedParts, QUEUED_BEHIND, AWAITING_ROLL } = await import("../src/lib/dm/pc-attack-parts.ts");
const { keepAfterRollWhenDue, rearmAfterRollKeeps } = await import("../src/lib/dm/after-roll-timer.ts");
const { listOpenAfterRolls } = await import("../src/lib/db/dm-turns.ts");
const { subscribe } = await import("../src/lib/events.ts");
const route = {
  choice: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"),
  pending: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
};

// A fifth-level fighter: +6 to hit with the longsword, 1d8+3 damage, two
// attacks a turn. The goblin's AC is 15.
const hero = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 10 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
// A second hero, so a turn ended passes to someone else.
const ally = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
// Someone else at the table, so a wait runs on the clock (after-roll-timer.ts).
const allyOnline = subscribe(world.campaignId, () => {}, world.sheet(ally.id).userId);
const LUCKY = { feats: ["Lucky"], resources: { ...world.sheet(hero.id).resources, luck_points: { max: 3, used: 0 } } };
const NONE = { feats: [], conditions: [], resources: { ...world.sheet(hero.id).resources, luck_points: { max: 3, used: 3 } } };

async function stage(patch) {
  await kit.endFight();
  world.patch(hero.id, { currentHp: 44, tempHp: 0, ...NONE, ...patch });
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [ally.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 15 });
  kit.place(hero.id, 5, 5);
  kit.place(ally.id, 2, 2);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemy;
}

const open = () => listOpenPendingRolls(world.campaignId);
const choose = (id, body) => {
  world.signIn({ id: world.sheet(hero.id).userId });
  return call(route.choice, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
const hp = (enemy) => kit.enemy(enemy.id).currentHp;
const held = () => world.sheet(hero.id).conditions;
const swingWith = (enemy, faces, args = {}) => kit.swing(hero.id, enemy.id, faces, args);

await test("A hit does not wait, and the held die is still held.", async () => {
  const enemy = await stage({ conditions: ["bardic inspiration (d8)"] });
  const swing = await swingWith(enemy, [12, 5]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(open().length, 0, "no card on a hit");
  assert.equal(swing.result.hit, true);
  assert.equal(hp(enemy), 400 - 8);
  assert.ok(held().includes("bardic inspiration (d8)"));
});

await test("A miss the die cannot turn does not wait, and the die is not spent on it: it was, blind, before.", async () => {
  const enemy = await stage({ conditions: ["bardic inspiration (d4)"] });
  const swing = await swingWith(enemy, [2]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(open().length, 0);
  assert.equal(swing.result.hit, false);
  assert.ok(held().includes("bardic inspiration (d4)"), "8 + a d4 never reaches AC 15: the die stays");
});

await test("A miss the die could turn waits, unrecorded; keeping it lands a miss and spends nothing.", async () => {
  const enemy = await stage({ conditions: ["bardic inspiration (d8)"] });
  const before = listRecentRolls(world.campaignId, 100).length;
  const swing = await swingWith(enemy, [5]);
  assert.equal(swing.ok, true, swing.error);
  const [pending] = open();
  assert.ok(pending, "the attack waits");
  assert.equal(pending.kind, "attack");
  assert.equal(pending.parkedFor, "after_roll");
  assert.deepEqual(pending.thrown.options.map((option) => option.id), ["bardic"]);
  assert.equal(pending.thrown.outcome.total, 11);
  assert.equal(listRecentRolls(world.campaignId, 100).length, before, "not recorded yet");
  assert.equal(hp(enemy), 400);
  const out = await choose(pending.id, { keep: true });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(open().length, 0);
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, 11);
  assert.match(getPendingRoll(pending.id).combatNote, /MISS/);
  assert.equal(hp(enemy), 400);
  assert.ok(held().includes("bardic inspiration (d8)"), "kept: the die is still theirs");
});

await test("Spending the die adds it, the hit lands, and the server throws the damage at once.", async () => {
  const enemy = await stage({ conditions: ["bardic inspiration (d8)"] });
  await swingWith(enemy, [5]);
  const [pending] = open();
  world.dice(6, 4);
  const out = await choose(pending.id, { use: "bardic" });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(open().length, 0, "no damage roll is left for the player: the server threw it");
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, 17);
  assert.equal(hp(enemy), 400 - 7);
  assert.match(getPendingRoll(pending.id).combatNote, /HIT.*applied this 7 damage/);
  assert.ok(!held().includes("bardic inspiration (d8)"), "spent");
});

await test("Lucky: a luck point rolls another d20 and the player chooses which counts.", async () => {
  const enemy = await stage(LUCKY);
  await swingWith(enemy, [3]);
  const [pending] = open();
  assert.deepEqual(pending.thrown.options.map((option) => option.id), ["lucky"]);
  world.dice(14);
  await choose(pending.id, { use: "lucky" });
  world.clearDice();
  assert.equal(world.sheet(hero.id).resources.luck_points.used, 1);
  const [waiting] = open();
  assert.equal(waiting.thrown.choosing, true);
  world.dice(5);
  const out = await choose(pending.id, { die: 1 });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(open().length, 0);
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, 20);
  assert.equal(hp(enemy), 400 - 8);
});

await test("A natural 1 misses whatever is added: a fresh d20 is offered, the Bardic die is not.", async () => {
  const enemy = await stage({ ...LUCKY, conditions: ["bardic inspiration (d12)"] });
  await swingWith(enemy, [1]);
  const [pending] = open();
  assert.deepEqual(pending.thrown.options.map((option) => option.id), ["lucky"]);
  await choose(pending.id, { keep: true });
  assert.ok(held().includes("bardic inspiration (d12)"));
});

await test("A luck point bought with the attack was its one: a miss after it offers no other.", async () => {
  const enemy = await stage(LUCKY);
  const swing = await swingWith(enemy, [3, 4], { luck: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(open().length, 0);
  assert.equal(world.sheet(hero.id).resources.luck_points.used, 1);
});

await test("The second swing of the call waits behind the first, and is made once it lands.", async () => {
  const enemy = await stage({ conditions: ["bardic inspiration (d8)"] });
  world.clearDice();
  world.dice(5);
  const out = await world.invoke("pc_attack", { characterId: hero.id, attacks: [{ targetEnemyId: enemy.id }, { targetEnemyId: enemy.id }] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const [pending] = open();
  assert.ok(pending, "the first swing waits");
  assert.equal(pending.attack.queue.parts.length, 1, "the second is queued, not made");
  assert.equal(listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack" && roll.createdAt >= pending.createdAt).length, 0, "no second d20 was thrown");
  // The first: kept, a miss. The second is made then: a 12, a hit for 1d8+3.
  world.dice(12, 5);
  const kept = await choose(pending.id, { keep: true });
  world.clearDice();
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  const results = getPendingRoll(pending.id).attack.queuedResults;
  assert.equal(results.length, 1);
  assert.equal(results[0].hit, true, JSON.stringify(results[0]));
  assert.equal(hp(enemy), 400 - 8);
  assert.equal(open().length, 0);
});

await test("A queued swing that misses in turn waits on its own roll, and the rest queue behind it.", async () => {
  const enemy = await stage({ ...LUCKY });
  world.dice(3);
  await world.invoke("pc_attack", { characterId: hero.id, attacks: [{ targetEnemyId: enemy.id }, { targetEnemyId: enemy.id }] });
  world.clearDice();
  const [first] = open();
  world.dice(4);
  await choose(first.id, { keep: true });
  world.clearDice();
  const [second] = open();
  assert.ok(second && second.id !== first.id, "the second swing waits on its own d20");
  assert.equal(getPendingRoll(first.id).attack.queuedResults[0][AWAITING_ROLL], true);
  await choose(second.id, { keep: true });
  assert.equal(open().length, 0);
});

await test("The turn cannot be ended while the player decides, and a turn skipped past the roll offers nothing to spend on it.", async () => {
  const enemy = await stage(LUCKY);
  world.dice(3);
  await world.invoke("pc_attack", { characterId: hero.id, attacks: [{ targetEnemyId: enemy.id }, { targetEnemyId: enemy.id }] });
  world.clearDice();
  const [pending] = open();
  const ended = await world.invoke("end_turn", { characterId: hero.id });
  assert.equal(ended.ok, false, "refused while the roll waits");
  assert.match(ended.error, /waits on their player's choice/);
  assert.equal(kit.current().characterId, hero.id);
  // The lead moves the pointer on by hand: the roll's turn is over.
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.characterId === ally.id), turnBudget: null });
  assert.equal((await choose(pending.id, { use: "lucky" })).status, 409, "no luck point is spent on a roll that cannot land");
  assert.equal(world.sheet(hero.id).resources.luck_points.used, 0);
  const kept = await choose(pending.id, { keep: true });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.match(getPendingRoll(pending.id).combatNote, /does not land/);
  assert.equal(getPendingRoll(pending.id).attack.queuedResults, undefined, "the queued swing is not made on someone else's turn");
  assert.equal(hp(enemy), 400);
});

await test("A readied attack, made on another's turn, never waits: it would never land.", async () => {
  const enemy = await stage(LUCKY);
  const ready = await world.invoke("take_action", { characterId: hero.id, action: "ready", trigger: "when it moves" });
  assert.equal(ready.ok, true, ready.error);
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.kind === "enemy" && entry.enemyId === enemy.id), turnBudget: null });
  const swing = await swingWith(enemy, [3]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(open().length, 0);
  assert.equal(swing.result.hit, false);
  assert.equal(world.sheet(hero.id).resources.luck_points.used, 0);
});

await test("The call's answer takes the queued swings' answers in their places, or says they were not made.", () => {
  const attacks = [{ hit: true }, { [AWAITING_ROLL]: true }, { [QUEUED_BEHIND]: true }, { [QUEUED_BEHIND]: true }];
  fillQueuedParts(attacks, 1, [{ hit: false }, { [AWAITING_ROLL]: true }]);
  assert.deepEqual(attacks, [{ hit: true }, { [AWAITING_ROLL]: true }, { hit: false }, { [AWAITING_ROLL]: true }]);
  const lost = [{ [AWAITING_ROLL]: true }, { [QUEUED_BEHIND]: true }];
  fillQueuedParts(lost, 0, undefined);
  assert.equal(lost[1].made, false);
});

await test("Real dice: a miss entered at the table waits the same way, and its damage roll is the player's.", async () => {
  // Staged first: real dice would park the fight's initiative too.
  const enemy = await stage({ conditions: ["bardic inspiration (d8)"] });
  setMemberRealDice(world.campaignId, world.sheet(hero.id).userId, true);
  try {
    await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id });
    const [toHit] = open();
    assert.equal(toHit.parkedFor, "real_dice");
    world.signIn({ id: world.sheet(hero.id).userId });
    const entered = await call(route.pending, "POST", { dice: [5] }, { campaignId: world.campaignId, pendingRollId: toHit.id });
    assert.equal(entered.status, 200, JSON.stringify(entered.json));
    assert.deepEqual(getPendingRoll(toHit.id).thrown.options.map((option) => option.id), ["bardic"]);
    world.dice(6);
    await choose(toHit.id, { use: "bardic" });
    world.clearDice();
    const damage = open().find((entry) => entry.kind === "damage");
    assert.ok(damage, "the hit asks the player for damage, as real dice do");
  } finally {
    setMemberRealDice(world.campaignId, world.sheet(hero.id).userId, false);
  }
});

await test("An attack waiting on its player runs on the same clock as a check: kept as it lies at the deadline, nothing spent.", async () => {
  const enemy = await stage({ conditions: ["bardic inspiration (d8)"] });
  await swingWith(enemy, [5]);
  // The real-dice test above leaves its damage roll open.
  const pending = open().find((entry) => entry.kind === "attack");
  assert.ok(pending.thrown.deadline, "the attack's wait has a deadline: it had none, and waited for good");
  assert.equal(await keepAfterRollWhenDue(pending.id, new Date(pending.thrown.deadline).getTime() + 1), true);
  assert.ok(!open().some((entry) => entry.id === pending.id), "the card is gone");
  assert.match(getPendingRoll(pending.id).combatNote, /MISS/);
  assert.ok(held().includes("bardic inspiration (d8)"), "kept as it lay: the die is still theirs");
});

await test("Real dice entered on the card run on the clock too, and a restart finds them to arm again.", async () => {
  const enemy = await stage({ conditions: ["bardic inspiration (d8)"] });
  setMemberRealDice(world.campaignId, world.sheet(hero.id).userId, true);
  try {
    await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id });
    const toHit = open().find((entry) => entry.kind === "attack");
    world.signIn({ id: world.sheet(hero.id).userId });
    assert.equal((await call(route.pending, "POST", { dice: [5] }, { campaignId: world.campaignId, pendingRollId: toHit.id })).status, 200);
    const waiting = getPendingRoll(toHit.id);
    assert.equal(waiting.parkedFor, "real_dice", "still parked for real dice");
    assert.ok(waiting.thrown.deadline, "with a deadline, as the server's own throw has");
    assert.ok(listOpenAfterRolls().some((entry) => entry.id === toHit.id), "a restart finds it by its dice, not its park reason");
    assert.ok(rearmAfterRollKeeps() >= 1);
    assert.equal(await keepAfterRollWhenDue(toHit.id, new Date(waiting.thrown.deadline).getTime() + 1), true);
    assert.equal(getPendingRoll(toHit.id).status, "submitted", "the player's own dice, as they lay");
    assert.ok(held().includes("bardic inspiration (d8)"));
  } finally {
    setMemberRealDice(world.campaignId, world.sheet(hero.id).userId, false);
  }
});

// ---- the AI's turn ----

const table = await openWorld({ gameSettings: { ttsEnabled: false } });
const tableKit = await combatKit(table);
const model = await fakeModel();
model.pointAt(table);
const tableChoice = await table.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");

await test("An AI turn waits on the first swing, and resumes with both swings' answers in their places.", async () => {
  const bard = table.addHero({
    name: "Reya", class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  });
  await tableKit.fight(1, { heroFaces: { [bard.id]: 19 } });
  const [enemy] = table.enemies();
  tableKit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 15 });
  tableKit.place(bard.id, 5, 5);
  tableKit.place(enemy.id, 5, 6);
  table.patch(bard.id, { conditions: ["bardic inspiration (d8)"] });
  model.script([
    reply({ calls: [modelCall("pc_attack", { characterId: bard.id, attacks: [{ targetEnemyId: enemy.id }, { targetEnemyId: enemy.id }] })] }),
    reply({ text: "Steel rings twice." }),
  ]);
  table.dice(5);
  await model.turn(table, "I swing twice at the goblin.", bard.id, table.sheet(bard.id).userId);
  table.clearDice();
  const [pending] = listOpenPendingRolls(table.campaignId);
  assert.ok(pending, "the first swing waits");
  assert.equal(getDmTurn(pending.turnId).status, "awaiting_rolls");
  assert.equal(model.requests.length, 1, "the model has not been told");
  table.signIn({ id: pending.userId });
  // The die: 11 + 6 is 17, a hit for 1d8+3 (a 4). The second swing: a 12, a hit for a 5.
  table.dice(6, 4, 12, 5);
  const out = await call(tableChoice, "POST", { use: "bardic" }, { campaignId: table.campaignId, pendingRollId: pending.id });
  table.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  await settleQueue(table.campaignId);
  assert.equal(getDmTurn(pending.turnId).status, "done");
  assert.equal(tableKit.enemy(enemy.id).currentHp, 400 - 7 - 8);
  const messages = model.requests[1].messages;
  const answer = JSON.parse(messages.findLast((message) => message.role === "tool").content);
  assert.equal(answer.attacks.length, 2);
  assert.equal(answer.attacks[0].total, 17, JSON.stringify(answer.attacks[0]));
  assert.match(answer.attacks[0].combat, /applied this 7 damage/);
  assert.equal(answer.attacks[1].hit, true, JSON.stringify(answer.attacks[1]));
  assert.equal(answer.attacks[1].damage, 8);
  assert.ok(!JSON.stringify(answer).includes(QUEUED_BEHIND), "no placeholder is left");
});

model.close();
allyOnline();
finish();
world.close();
table.close();
