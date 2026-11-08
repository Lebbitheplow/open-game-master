// Portent (src/lib/dm/foretold-logic.ts): the numbers a Divination wizard
// rolled at a long rest, kept, shown, and used in place of a d20 before it is
// thrown.
//
// The rules held:
//   a long rest rolls the numbers the counter allows, and replaces the old ones;
//   the wizard's own check or save waits unthrown only while they hold a number;
//   a number replaces the d20 and keeps the modifier, and is gone once used;
//   the choice is the roller's, the number must be one they hold, and thrown
//   dice are too late;
//   an undo of the spend gives the number back;
//   a player watching a fight is asked before an attack is rolled, in order,
//   for a moment only, and pays only if a d20 took the number.
import assert from "node:assert/strict";
import { call, seats } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-portent");
const { getDmTurn, getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");
const { revertAuditEntry } = await import("../src/lib/sheet-undo.ts");
const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");

const world = await openWorld({ campaign: { maxPlayers: 20 } });
const who = await seats(world);
const route = {
  portent: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/portent"),
  pending: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
  choice: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"),
};
const params = (id) => ({ campaignId: world.campaignId, pendingRollId: id });
const open = () => listOpenPendingRolls(world.campaignId);
const landed = (id) => listRecentRolls(world.campaignId, 100).find((roll) => roll.id === getPendingRoll(id).rollId);
const portent = (id, value, user = who.player) => {
  world.signIn(user);
  return call(route.portent, "POST", { value }, params(id));
};

const wizard = (patch = {}) => {
  world.patch(who.sheet.id, {
    conditions: [],
    feats: [],
    class: "wizard",
    subclass: "School of Divination",
    level: 5,
    features: [{ name: "Portent", source: "subclass" }],
    abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
    proficiencies: { ...TRAINED, saves: [] },
    resources: { sub_portent: { max: 2, used: 0 } },
    foretold: [17, 3],
    ...patch,
  });
  return who.sheet.id;
};
const check = (args = {}) => world.invoke("request_roll", { characterId: who.sheet.id, kind: "ability_check", ability: "int", dc: 15, reason: "the runes", ...args });
const clear = async () => {
  for (const pending of open()) {
    world.signIn(who.player);
    await call(route.pending, "POST", { fallback: "digital" }, params(pending.id));
  }
  for (const pending of open()) {
    world.signIn(who.player);
    await call(route.choice, "POST", { keep: true }, params(pending.id));
  }
};

await test("A long rest rolls the numbers the counter allows and replaces the old ones; no counter, no numbers.", () => {
  wizard();
  const patch = longRestPatch(world.sheet(who.sheet.id));
  assert.equal(patch.foretold.length, 2);
  assert.ok(patch.foretold.every((value) => Number.isInteger(value) && value >= 1 && value <= 20));
  wizard({ resources: { sub_portent: { max: 3, used: 3 } }, foretold: [] });
  assert.equal(longRestPatch(world.sheet(who.sheet.id)).foretold.length, 3);
  wizard({ resources: {}, foretold: [] });
  assert.equal("foretold" in longRestPatch(world.sheet(who.sheet.id)), false);
});

await test("The take_rest tool stores them on the sheet.", async () => {
  wizard({ foretold: [] });
  await world.invoke("take_rest", { kind: "long" });
  assert.equal(world.sheet(who.sheet.id).foretold.length, 2);
});

await test("A check waits unthrown while a number is held, and a number replaces the d20 and keeps the modifier.", async () => {
  wizard();
  await check();
  const [pending] = open();
  assert.ok(pending, "the roll waits");
  assert.equal(pending.parkedFor, "foretold");
  assert.equal(pending.thrown, null, "no die is thrown yet");
  const out = await portent(pending.id, 17);
  assert.equal(out.status, 200);
  assert.equal(open().length, 0, "17 + 3 passes, so nothing more can change it");
  const roll = landed(pending.id);
  assert.equal(roll.total, 20);
  assert.equal(roll.breakdown.natural, 17);
  const after = world.sheet(who.sheet.id);
  assert.deepEqual(after.foretold, [3]);
  assert.equal(after.resources.sub_portent.used, 1);
});

await test("A saving throw takes a number too; advantage has no second die once it does.", async () => {
  wizard();
  await check({ kind: "saving_throw", ability: "int", advantage: "advantage" });
  const [pending] = open();
  assert.ok(pending);
  assert.equal((await portent(pending.id, 3)).status, 200);
  await clear();
  const roll = landed(pending.id);
  assert.equal(roll.total, 6, "3 and the Intelligence modifier, and no other die");
  assert.deepEqual(world.sheet(who.sheet.id).foretold, [17]);
});

await test("Rolling instead spends nothing, and the numbers stay.", async () => {
  wizard();
  await check();
  const [pending] = open();
  world.signIn(who.player);
  world.dice(14);
  assert.equal((await call(route.pending, "POST", { fallback: "digital" }, params(pending.id))).status, 200);
  world.clearDice();
  assert.equal(landed(pending.id).total, 17);
  const after = world.sheet(who.sheet.id);
  assert.deepEqual(after.foretold, [17, 3]);
  assert.equal(after.resources.sub_portent.used, 0);
});

await test("A screen that knows nothing of Portent types dice in: the server throws them, and the numbers stay.", async () => {
  wizard();
  await check();
  const [pending] = open();
  world.signIn(who.player);
  world.dice(14);
  assert.equal((await call(route.pending, "POST", { dice: [20] }, params(pending.id))).status, 200);
  world.clearDice();
  assert.equal(landed(pending.id).total, 17, "the server's 14 and the modifier, not the typed 20");
  assert.deepEqual(world.sheet(who.sheet.id).foretold, [17, 3]);
});

await test("No number held means no wait, and a counter spent elsewhere hides the number with it.", async () => {
  wizard({ foretold: [] });
  world.dice(14);
  await check();
  world.clearDice();
  assert.equal(open().length, 0);
  wizard({ resources: { sub_portent: { max: 2, used: 2 } } });
  world.dice(14);
  await check();
  world.clearDice();
  assert.equal(open().length, 0);
});

await test("Only the roller, only a number they hold, and never on thrown dice.", async () => {
  wizard();
  await check();
  const [pending] = open();
  assert.equal((await portent(pending.id, 9)).status, 409, "a number they do not hold");
  assert.equal((await portent(pending.id, 17, who.other ?? world.owner)).status, 403, "someone else");
  assert.deepEqual(world.sheet(who.sheet.id).foretold, [17, 3], "a refusal spends nothing");
  await clear();
  wizard({ conditions: ["bardic inspiration (d8)"] });
  await check();
  const [next] = open();
  world.signIn(who.player);
  world.dice(5);
  await call(route.pending, "POST", { fallback: "digital" }, params(next.id));
  world.clearDice();
  assert.ok(getPendingRoll(next.id).thrown, "the dice landed and the Bardic die can still answer");
  assert.equal((await portent(next.id, 17)).status, 409, "Portent comes before the roll");
  await clear();
});

await test("A foretold number can still take a Bardic die after it lands, and costs each once.", async () => {
  wizard({ conditions: ["bardic inspiration (d8)"] });
  await check({ dc: 12 });
  const [pending] = open();
  assert.equal((await portent(pending.id, 3)).status, 200);
  const waiting = getPendingRoll(pending.id);
  assert.ok(waiting.thrown, "6 falls short and a d8 could reach");
  assert.equal(waiting.thrown.outcome.total, 6);
  assert.equal(waiting.thrown.landing.physical, false);
  world.signIn(who.player);
  world.dice(8);
  assert.equal((await call(route.choice, "POST", { use: "bardic" }, params(pending.id))).status, 200);
  world.clearDice();
  await clear();
  assert.deepEqual(world.sheet(who.sheet.id).foretold, [17]);
  assert.ok(!world.sheet(who.sheet.id).conditions.includes("bardic inspiration (d8)"));
});

await test("A foretold number that leaves a die to decide runs on the table's clock, like any roll on the card.", async () => {
  const { subscribe } = await import("../src/lib/events.ts");
  const gmOnline = subscribe(world.campaignId, () => {}, who.dm.id);
  try {
    wizard({ conditions: ["bardic inspiration (d8)"] });
    await check({ dc: 12 });
    const [pending] = open();
    assert.equal((await portent(pending.id, 3)).status, 200);
    const waiting = getPendingRoll(pending.id);
    assert.ok(waiting.thrown?.deadline, "a deadline, as the server's own throw gets: it had none and waited for good");
    await clear();
  } finally {
    gmOnline();
  }
});

await test("The spend is the player's, and undoing it gives the number back.", async () => {
  wizard();
  await check();
  const [pending] = open();
  await portent(pending.id, 17);
  const row = listRecentAudit(world.campaignId, 20).find((entry) => entry.kind === "use_resource" && entry.turnId === pending.turnId);
  assert.ok(row, "filed under the turn");
  assert.equal(row.actor, "player");
  world.signIn(world.owner);
  const undone = revertAuditEntry(world.campaign(), row, { userId: world.owner.id, kind: "sheet_undo" });
  assert.equal(undone.ok, true, undone.error);
  const after = world.sheet(who.sheet.id);
  assert.deepEqual(after.foretold, [17, 3]);
  assert.equal(after.resources.sub_portent.used, 0);
});

await test("A roll behind the GM's screen does not wait on the table.", async () => {
  wizard();
  world.dice(14);
  await check({ visibility: "gm_only" });
  world.clearDice();
  assert.equal(open().length, 0);
  assert.deepEqual(world.sheet(who.sheet.id).foretold, [17, 3]);
});

const table = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(table);
const tableRoute = await table.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/portent");

await test("An AI turn stops on the unthrown roll, and resumes with the foretold result.", async () => {
  const seer = table.addHero({ name: "Reya", class: "wizard", level: 5 });
  table.patch(seer.id, { abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 }, resources: { sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] });
  model.script([
    reply({ calls: [modelCall("request_roll", { characterId: seer.id, kind: "ability_check", ability: "int", dc: 15, reason: "the runes" })] }),
    reply({ text: "The runes give way." }),
  ]);
  await model.turn(table, "I read the runes.");
  const [pending] = listOpenPendingRolls(table.campaignId);
  assert.ok(pending, "the roll waits");
  assert.equal(getDmTurn(pending.turnId).status, "awaiting_rolls");
  assert.equal(model.requests.length, 1, "the model has not been told the roll");
  const { recoverDmAfterRestart } = await import("../src/lib/dm/restart-recovery.ts");
  recoverDmAfterRestart();
  await settleQueue(table.campaignId);
  assert.equal(listOpenPendingRolls(table.campaignId)[0]?.id, pending.id, "a restart leaves it waiting");
  table.signIn({ id: pending.userId });
  assert.equal((await call(tableRoute, "POST", { value: 17 }, { campaignId: table.campaignId, pendingRollId: pending.id })).status, 200);
  await settleQueue(table.campaignId);
  assert.equal(getDmTurn(pending.turnId).status, "done");
  assert.match(JSON.stringify(model.requests[1]), /20/, "the total with the number on it");
});

// ---- watching a fight ----

const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { releaseWatchWhenDue } = await import("../src/lib/dm/foresight-release.ts");
const fightWorld = await openWorld({ gameSettings: { ttsEnabled: false } });
const fightModel = await fakeModel();
fightModel.pointAt(fightWorld);
const kit = await combatKit(fightWorld);
const fightRoute = {
  toggle: await fightWorld.route("campaigns/[campaignId]/foresight"),
  watch: await fightWorld.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"),
  pending: await fightWorld.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
};
const seerUser = fightWorld.addUser("seer");
const seer = fightWorld.addHero({ user: seerUser, name: "Seer", class: "wizard", level: 5 });
const targetUser = fightWorld.addUser("kara");
const target = fightWorld.addHero({ user: targetUser, name: "Kara", class: "fighter", level: 5 });
const stops = () => listOpenPendingRolls(fightWorld.campaignId).filter((pending) => pending.parkedFor === "watch");
const answer = (id, body, user = seerUser) => {
  fightWorld.signIn(user);
  return call(fightRoute.watch, "POST", body, { campaignId: fightWorld.campaignId, pendingRollId: id });
};
const toggle = (on, user = seerUser) => {
  fightWorld.signIn(user);
  return call(fightRoute.toggle, "POST", { on, characterId: seer.id }, { campaignId: fightWorld.campaignId });
};
const arm = (patch = {}) => {
  fightWorld.patch(seer.id, { currentHp: 30, maxHp: 30, conditions: [], resources: { sub_portent: { max: 2, used: 0 } }, foretold: [17, 3], ...patch });
  fightWorld.patch(target.id, { currentHp: 60, maxHp: 60, ac: 16 });
};
const hitRolls = () => listRecentRolls(fightWorld.campaignId, 100).filter((roll) => roll.kind === "attack");

await kit.fight(2, { heroFaces: { [seer.id]: 19, [target.id]: 15 } });
const [goblin, goblin2] = fightWorld.enemies();
kit.place(target.id, 5, 5);
kit.place(goblin.id, 6, 5);
kit.place(goblin2.id, 5, 6);
kit.place(seer.id, 9, 9);
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const turnOf = (enemy, due = [enemy.id]) => {
  const encounter = fightWorld.encounter();
  const place = encounter.order.findIndex((entry) => entry.enemyId === enemy.id || entry.id === enemy.id);
  assert.ok(place >= 0, `the order holds ${JSON.stringify(encounter.order[0])}`);
  saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, legendary: { ...encounter.legendary, due, acted: null } });
};
const enemyTurn = (calls, tail = "The blow falls.", due) => {
  turnOf(goblin, due);
  fightModel.script([reply({ calls }), reply({ text: tail })]);
  // Something new for the turn to answer.
  fightWorld.say("system", "The goblins press in.");
  return startDmTurn(fightWorld.campaignId);
};
const strike = (enemy = goblin) => modelCall("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });

await test("With the button off an attack never stops, and the numbers stay.", async () => {
  arm();
  fightWorld.dice(10, 4);
  await enemyTurn([strike()]);
  fightWorld.clearDice();
  await settleQueue(fightWorld.campaignId);
  assert.equal(stops().length, 0);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3]);
});

await test("The button needs a number held.", async () => {
  arm({ foretold: [] });
  assert.equal((await toggle(true)).status, 409, "no number held");
  arm();
  assert.equal((await toggle(true)).status, 200);
  assert.ok(fightWorld.sheet(seer.id).watchingEncounterId);
});

await test("A stop holds the attack unrolled; a number lands on its d20 and is paid for once.", async () => {
  arm();
  const before = hitRolls().length;
  await enemyTurn([strike()], "The club finds its mark.");
  const [stop] = stops();
  assert.ok(stop, "the turn stops");
  assert.equal(stop.userId, seerUser.id);
  assert.equal(getDmTurn(stop.turnId).status, "awaiting_rolls");
  assert.equal(hitRolls().length, before, "no die yet");
  assert.equal((await answer(stop.id, { value: 9 })).status, 409, "a number they do not hold");
  assert.equal((await answer(stop.id, { value: 3 }, targetUser)).status, 403, "someone else's");
  assert.equal((await answer(stop.id, { value: 3 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.equal(getDmTurn(stop.turnId).status, "done");
  const all = hitRolls();
  assert.equal(all.length, before + 1);
  assert.equal(all.at(-1).breakdown.natural, 3, "the foretold 3 is the attack's d20");
  const after = fightWorld.sheet(seer.id);
  assert.deepEqual(after.foretold, [17]);
  assert.equal(after.resources.sub_portent.used, 1);
  assert.match(JSON.stringify(fightModel.requests.at(-1)), /foretold this roll with Portent/, "the model narrates from it");
});

await test("Let it roll spends nothing; each attack of a reply stops in order; the time limit answers too.", async () => {
  arm();
  const before = hitRolls().length;
  fightWorld.dice(10, 4, 10, 4);
  await enemyTurn([strike(goblin), strike(goblin2)], "Both swing.", [goblin.id, goblin2.id]);
  const [first] = stops();
  assert.equal(first.watch.calls.length, 2, "the second waits behind the first");
  assert.equal((await answer(first.id, { pass: true })).status, 200);
  await settleQueue(fightWorld.campaignId);
  const [second] = stops();
  assert.ok(second, "the next attack stops as well");
  assert.notEqual(second.id, first.id);
  assert.equal(hitRolls().length, before + 1, "the first has rolled");
  releaseWatchWhenDue(second.id);
  await settleQueue(fightWorld.campaignId);
  fightWorld.clearDice();
  assert.equal(stops().length, 0);
  assert.equal(getDmTurn(second.turnId).status, "done");
  assert.equal(hitRolls().length, before + 2);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3], "nothing was spent");
  const tools = fightModel.requests.at(-1).messages.filter((message) => message.role === "tool");
  const ids = tools.map((message) => message.tool_call_id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "each call has one answer");
});

await test("Whoever runs the story can send a stop on, and only the watch route answers it.", async () => {
  arm();
  fightWorld.dice(10, 4);
  await enemyTurn([strike()]);
  const [stop] = stops();
  fightWorld.signIn(seerUser);
  assert.equal((await call(fightRoute.pending, "POST", { fallback: "digital" }, { campaignId: fightWorld.campaignId, pendingRollId: stop.id })).status, 409);
  assert.equal((await answer(stop.id, { pass: true }, fightWorld.owner)).status, 200);
  await settleQueue(fightWorld.campaignId);
  fightWorld.clearDice();
  assert.equal(stops().length, 0);
});

await test("A number no die took costs nothing: the rules refused the attack.", async () => {
  arm();
  await enemyTurn([modelCall("enemy_attack", { enemyId: goblin.id, targetCharacterId: "nobody-here" })]);
  const [stop] = stops();
  assert.ok(stop, "the stop reads no further than who is about to swing");
  await answer(stop.id, { value: 17 });
  await settleQueue(fightWorld.campaignId);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3]);
  assert.equal(fightWorld.sheet(seer.id).resources.sub_portent.used, 0);
});

await test("A blinded wizard sees nothing to stop, and the fight's end ends the watch.", async () => {
  arm({ conditions: ["blinded"] });
  fightWorld.dice(10, 4);
  await enemyTurn([strike()]);
  fightWorld.clearDice();
  await settleQueue(fightWorld.campaignId);
  assert.equal(stops().length, 0);
  arm();
  await kit.endFight();
  fightWorld.dice(14);
  fightModel.script([reply({ calls: [modelCall("request_roll", { characterId: target.id, kind: "ability_check", ability: "str", dc: 5, reason: "a door" })] }), reply({ text: "It opens." })]);
  fightWorld.say("system", "A door bars the way.");
  await startDmTurn(fightWorld.campaignId);
  fightWorld.clearDice();
  assert.equal(stops().length, 0, "no fight, no stop");
});

await test("A restart lets an open stop go, and its attack rolls.", async () => {
  await kit.fight(1, { heroFaces: { [seer.id]: 19, [target.id]: 15 } });
  const [lone] = fightWorld.enemies();
  kit.place(target.id, 5, 5);
  kit.place(lone.id, 6, 5);
  kit.place(seer.id, 9, 9);
  arm();
  assert.equal((await toggle(true)).status, 200);
  turnOf(lone);
  fightModel.script([reply({ calls: [modelCall("enemy_attack", { enemyId: lone.id, targetCharacterId: target.id })] }), reply({ text: "The club swings." })]);
  fightWorld.say("system", "The last goblin turns.");
  await startDmTurn(fightWorld.campaignId);
  const [stop] = stops();
  assert.ok(stop);
  const before = hitRolls().length;
  const recovery = await import("../src/lib/dm/restart-recovery.ts");
  delete globalThis.__odmDmRecovered;
  fightWorld.dice(10, 4);
  recovery.recoverDmAfterRestart();
  await settleQueue(fightWorld.campaignId);
  fightWorld.clearDice();
  assert.equal(stops().length, 0);
  assert.equal(getDmTurn(stop.turnId).status, "done");
  assert.equal(hitRolls().length, before + 1);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3]);
});

await test("What a stop holds never rides to the table.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [seer.id]: 19, [target.id]: 15 } });
  const [lone] = fightWorld.enemies();
  kit.place(target.id, 5, 5);
  kit.place(lone.id, 6, 5);
  kit.place(seer.id, 9, 9);
  arm();
  assert.equal((await toggle(true)).status, 200);
  turnOf(lone);
  fightModel.script([reply({ calls: [modelCall("enemy_attack", { enemyId: lone.id, targetCharacterId: target.id })] }), reply({ text: "It swings." })]);
  fightWorld.say("system", "It circles.");
  await startDmTurn(fightWorld.campaignId);
  const [stop] = stops();
  const { publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
  const shown = JSON.stringify(publicPendingRoll(stop));
  assert.ok(!shown.includes(lone.id), "no held call's arguments");
  assert.ok(!shown.includes("rawArguments"));
  assert.match(shown, /about to attack/, "the card still reads its line");
  fightWorld.dice(10, 4);
  await answer(stop.id, { pass: true });
  await settleQueue(fightWorld.campaignId);
  fightWorld.clearDice();
});

await test("A call that throws is answered, and the table does not wait on it for good.", async () => {
  const [lone] = fightWorld.enemies();
  arm();
  turnOf(lone);
  fightModel.script([reply({ calls: [modelCall("enemy_attack", { enemyId: lone.id, targetCharacterId: target.id })] }), reply({ text: "Something gave way." })]);
  fightWorld.say("system", "It circles again.");
  await startDmTurn(fightWorld.campaignId);
  const [stop] = stops();
  const hook = globalThis.__odmScriptedDie;
  globalThis.__odmScriptedDie = () => {
    throw new Error("the dice fell off the table");
  };
  try {
    await answer(stop.id, { pass: true });
    await settleQueue(fightWorld.campaignId);
  } finally {
    globalThis.__odmScriptedDie = hook;
  }
  assert.equal(getDmTurn(stop.turnId).status, "done");
  const messages = getDmTurn(stop.turnId).conversation;
  assert.ok(messages.some((message) => message.role === "tool" && /failed on the server/.test(String(message.content))), "the call has its answer");
});

await test("Dying among the held calls answers them; they do not run twice.", async () => {
  const [lone] = fightWorld.enemies();
  arm();
  turnOf(lone, []);
  fightModel.script([reply({ calls: [modelCall("enemy_attack", { enemyId: lone.id, targetCharacterId: target.id })] }), reply({ text: "The moment passes." })]);
  fightWorld.say("system", "It waits.");
  await startDmTurn(fightWorld.campaignId);
  const [stop] = stops();
  const before = hitRolls().length;
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const { resumeDmTurn } = await import("../src/lib/dm/turn.ts");
  getDatabase().prepare("UPDATE pending_rolls SET status = 'fallback', watch_json = ? WHERE id = ?").run(JSON.stringify({ ...stop.watch, taken: true }), stop.id);
  await resumeDmTurn(fightWorld.campaignId, stop.turnId);
  await settleQueue(fightWorld.campaignId);
  assert.equal(hitRolls().length, before, "the attack did not run again");
  assert.equal(getDmTurn(stop.turnId).status, "done");
  assert.ok(getDmTurn(stop.turnId).conversation.some((message) => message.role === "tool" && /restarted around this action/.test(String(message.content))));
});

await test("A number a stop has promised cannot be spent again on the wizard's own card.", async () => {
  const [lone] = fightWorld.enemies();
  arm();
  turnOf(lone);
  fightModel.script([
    reply({ calls: [modelCall("request_roll", { characterId: seer.id, kind: "ability_check", ability: "int", dc: 15, reason: "the runes" }), modelCall("enemy_attack", { enemyId: lone.id, targetCharacterId: target.id })] }),
    reply({ text: "All at once." }),
  ]);
  fightWorld.say("system", "Runes flare.");
  await startDmTurn(fightWorld.campaignId);
  const open = listOpenPendingRolls(fightWorld.campaignId);
  const card = open.find((pending) => pending.parkedFor === "foretold");
  const [stop] = stops();
  assert.ok(card && stop, "the card and the stop stand together");
  assert.equal((await answer(stop.id, { value: 17 })).status, 200);
  fightWorld.signIn(seerUser);
  const portentRoute = await fightWorld.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/portent");
  const twice = await call(portentRoute, "POST", { value: 17 }, { campaignId: fightWorld.campaignId, pendingRollId: card.id });
  assert.equal(twice.status, 409, "the 17 is promised");
  assert.equal((await call(portentRoute, "POST", { value: 3 }, { campaignId: fightWorld.campaignId, pendingRollId: card.id })).status, 200);
  await settleQueue(fightWorld.campaignId);
  const sheet = fightWorld.sheet(seer.id);
  assert.deepEqual(sheet.foretold, []);
  assert.equal(sheet.resources.sub_portent.used, 2);
  assert.equal(hitRolls().at(-1).breakdown.natural, 17);
});

await test("The watch button waits for a host that answers it.", async () => {
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  const { hostOffers } = await import("../src/lib/use-capabilities.ts");
  assert.equal(SERVER_FEATURES.portentWatch, true);
  assert.equal(hostOffers({ features: { afterRollChoice: true } }, "portentWatch"), false, "an app on an older host drew a button its host answers with a 404");
  assert.equal(hostOffers({ features: { portentWatch: true } }, "portentWatch"), true);
});

fightModel.close();
model.close();
finish();
