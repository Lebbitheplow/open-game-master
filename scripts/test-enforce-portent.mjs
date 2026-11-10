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
//   a player watching a fight is asked before an attack, a check or one
//   creature's save is rolled, in order, for a moment only, and pays only if
//   a d20 took the number.
import assert from "node:assert/strict";
import { call, seats } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-portent");
const { getDmTurn, getPendingRoll, listOpenPendingRolls, publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
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
// The watcher's player is at the table: an absent one is not stopped for
// (chronal-shift.ts playerAtTable).
(await import("../src/lib/events.ts")).subscribe(fightWorld.campaignId, () => {}, seerUser.id);
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

// A person's table is watched as the AI's is: the console's calls stop for
// the watcher before their d20 (src/lib/dm/held-call.ts). Refused there
// before, Portent on another creature's roll had no door at all at a table a
// person runs (finding L856 of the 2026-11-09 gap sweep; SRD 5.1 Portent:
// "any attack roll, saving throw, or ability check made by you or a creature
// that you can see").
await test("The button needs a number held, at a table the AI runs or a person does.", async () => {
  arm({ foretold: [] });
  assert.equal((await toggle(true)).status, 409, "no number held");
  arm();
  const { setDmMode } = await import("../src/lib/db/campaigns.ts");
  setDmMode(fightWorld.campaignId, "human", fightWorld.owner.id);
  try {
    assert.equal((await toggle(true)).status, 200, "a person's console calls stop for the watcher too");
    assert.equal((await toggle(false)).status, 200);
  } finally {
    setDmMode(fightWorld.campaignId, "ai", fightWorld.owner.id);
  }
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

const saveRolls = () => listRecentRolls(fightWorld.campaignId, 100).filter((roll) => roll.kind === "saving_throw");

await test("A save one creature makes stops too: a hazard forcing a hero's save takes the number on its d20.", async () => {
  arm();
  const before = saveRolls().length;
  await enemyTurn([modelCall("cast_at_player", { characterId: target.id, source: "a poison needle", saveAbility: "con", dc: 25, damage: "1d4", damageType: "poison" })], "The needle bites.");
  const [stop] = stops();
  assert.ok(stop, "the save stops: it never did, and the feature names saves");
  assert.match(stop.reason, /Kara is about to make a saving throw against a poison needle\./);
  assert.equal(saveRolls().length, before, "no die yet");
  assert.equal((await answer(stop.id, { value: 17 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.equal(saveRolls().at(-1)?.breakdown.natural, 17, "the foretold 17 is the save's d20");
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [3]);
});

// The saves a GM call throws inside it, with no card to wait on
// (src/lib/dm/foresight-saves.ts): each stopped for nobody.
const { setParty, getParty } = await import("../src/lib/db/party.ts");
const { setMount } = await import("../src/lib/db/mounts.ts");

await test("The hours of cold stop too, and the number lands on the first hour's save.", async () => {
  arm();
  const before = saveRolls().length;
  await enemyTurn([modelCall("apply_hazard", { type: "extreme_cold", hours: 2, characterIds: [target.id] })], "The cold bites.");
  const [stop] = stops();
  assert.ok(stop, "the cold's saves stop");
  assert.match(stop.reason, /Kara is about to make 2 saving throws, one an hour, against the cold\./);
  assert.equal((await answer(stop.id, { value: 17 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  const landed = saveRolls().slice(before);
  assert.equal(landed.length, 2, "one save an hour");
  assert.equal(landed[0].breakdown.natural, 17, "the first hour's d20 shows the 17");
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [3]);
  fightWorld.patch(target.id, { conditions: [], conditionMeta: {} });
});

await test("A trap aimed at the front of the travel formation stops for the one who walks there.", async () => {
  arm();
  setParty(fightWorld.campaignId, { ...getParty(fightWorld.campaignId), marchingOrder: [target.id, seer.id] });
  await enemyTurn([modelCall("apply_hazard", { type: "trap", severity: "setback", rank: "front" })], "Darts fly.");
  const [stop] = stops();
  assert.ok(stop, "the trap's save stops");
  assert.match(stop.reason, /Kara is about to make a saving throw against a trap\./);
  await answer(stop.id, { pass: true });
  await settleQueue(fightWorld.campaignId);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3], "Let it roll spends nothing");
  setParty(fightWorld.campaignId, { ...getParty(fightWorld.campaignId), marchingOrder: [] });
});

await test("A condition laid with its save stops for that save, a character's or a creature's.", async () => {
  arm();
  await enemyTurn([modelCall("set_condition", { characterId: target.id, condition: "restrained", saveAbility: "str", saveDc: 15, reason: "a net" })], "The net falls.");
  const [stop] = stops();
  assert.ok(stop, "the character's save stops");
  assert.match(stop.reason, /Kara is about to make a saving throw against being restrained\./);
  assert.equal((await answer(stop.id, { value: 17 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.equal(saveRolls().at(-1)?.breakdown.natural, 17, "the foretold 17 is the save's d20");
  assert.ok(!fightWorld.sheet(target.id).conditions.includes("restrained"), "the save is made");
  arm();
  await enemyTurn([modelCall("set_condition", { enemyId: goblin2.id, condition: "restrained", saveAbility: "str", saveDc: 15, reason: "a net" })], "The net falls.");
  const [held] = stops();
  assert.ok(held, "the creature's save stops");
  assert.match(held.reason, /Goblin 2 is about to make a saving throw against being restrained\./);
  assert.equal((await answer(held.id, { value: 3 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.ok(kit.enemy(goblin2.id).conditions.includes("restrained"), "the 3 fails the save");
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17]);
  kit.setEnemy(goblin2.id, { conditions: [], conditionMeta: {} });
});

await test("A rider thrown from the saddle stops for the save to land on their feet.", async () => {
  arm();
  setMount(fightWorld.campaignId, target.id, { name: "Riding Horse", speed: 60, size: "large", controlled: true, hp: 13, maxHp: 13 });
  await enemyTurn([modelCall("dismount", { characterId: target.id, cause: "forced-move" })], "Kara is thrown.");
  const [stop] = stops();
  assert.ok(stop, "the save stops");
  assert.match(stop.reason, /Kara is about to make a saving throw to land on their feet\./);
  assert.equal((await answer(stop.id, { value: 17 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.equal(saveRolls().at(-1)?.breakdown.natural, 17);
  assert.ok(!fightWorld.sheet(target.id).conditions.includes("prone"), "17 lands on their feet");
  setMount(fightWorld.campaignId, target.id, null);
});

// A character's own call that makes a creature save (foresight-saves.ts):
// the creature's save, rolled inside the call, stopped for nobody.
const choiceNames = (stop) => publicPendingRoll(stop).watch.choices.map((choice) => choice.name);
const letItRoll = async (stop) => {
  await answer(stop.id, { pass: true });
  await settleQueue(fightWorld.campaignId);
};

// These calls run as they are let go, and their blows land: the goblins are
// kept standing through them, and given back their hit points after.
let goblinsBefore;
await test("A feature a character spends stops for the creature's save it asks.", async () => {
  goblinsBefore = [goblin, goblin2].map((enemy) => ({ id: enemy.id, currentHp: kit.enemy(enemy.id).currentHp, maxHp: kit.enemy(enemy.id).maxHp }));
  for (const enemy of goblinsBefore) kit.setEnemy(enemy.id, { currentHp: 300, maxHp: 300 });
  arm();
  await enemyTurn([modelCall("use_resource", { characterId: target.id, resource: "Intimidating Presence", targetEnemyId: goblin.id })], "Kara roars.");
  const [scare] = stops();
  assert.ok(scare, "Intimidating Presence's save stops");
  assert.match(scare.reason, /Goblin \S* ?is about to make a saving throw against Intimidating Presence\./);
  await letItRoll(scare);
});

await test("A reaction that makes the attacker save stops for that save.", async () => {
  arm();
  await enemyTurn([modelCall("use_reaction", { characterId: target.id, feature: "Hellish Rebuke", targetEnemyId: goblin.id })], "Flames answer.");
  const [rebuke] = stops();
  assert.ok(rebuke, "Hellish Rebuke's save stops");
  assert.match(rebuke.reason, /against Hellish Rebuke\./);
  await letItRoll(rebuke);
});

await test("A pet's attack stops, for its d20 or the save its sting asks, and the number lands on the pet's d20.", async () => {
  arm();
  fightWorld.patch(target.id, { pets: [{ name: "Imp", kind: "familiar", form: "imp", hp: 10, maxHp: 10, ac: 13, speed: 20, attacks: [{ name: "Sting", toHit: 5, damage: "1d4+3", type: "piercing", onHit: { save: "con", dc: 11 } }], notes: "" }] });
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  fightModel.script([reply({ calls: [modelCall("pet_attack", { characterId: target.id, targetEnemyId: goblin.id })] }), reply({ text: "The imp stings." })]);
  await fightModel.turn(fightWorld, "My imp stings the goblin.", target.id, targetUser.id);
  const [sting] = stops();
  assert.ok(sting, "the pet's attack stops");
  assert.match(sting.reason, /Imp is about to attack Goblin/);
  assert.deepEqual(choiceNames(sting), ["Imp", goblin.displayName], "the sting's d20 or the poison's save");
  assert.equal((await answer(sting.id, { value: 17, choice: 0 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.equal(hitRolls().at(-1)?.breakdown.natural, 17, "the foretold 17 is the sting's d20");
  fightWorld.patch(target.id, { pets: [] });
});

await test("A swing with Stunning Strike stops for the swing or the creature's save against the stun.", async () => {
  arm();
  await enemyTurn([modelCall("pc_attack", { characterId: target.id, attacks: [{ targetEnemyId: goblin.id, stunningStrike: true }] })], "Kara strikes.");
  const [stun] = stops();
  assert.ok(stun, "the swing stops");
  assert.deepEqual(choiceNames(stun), ["Kara", goblin.displayName], "the swing, or the creature's save against the stun");
  await letItRoll(stun);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3], "Let it roll spends nothing");
});

// The rest a call throws inside it (foresight-more.ts): a hurt creature's
// save, an action's contest, a walk, a legendary action.
// The last call's answer, as the model read it: rolls stored in the same
// millisecond have no order to read them back by.
const toldConcentration = () => fightModel.requests.at(-1)?.messages.filter((message) => message.role === "tool").map((message) => message.content).join(" ");
const kindRolls = (kind) => listRecentRolls(fightWorld.campaignId, 200).filter((roll) => roll.kind === kind);
const karaTurn = (calls, said, tail = "It is done.") => {
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  fightModel.script([reply({ calls }), reply({ text: tail })]);
  return fightModel.turn(fightWorld, said, target.id, targetUser.id);
};

await test("Damage to a concentrating character or creature stops for the save it asks, and the number lands on it.", async () => {
  arm();
  fightWorld.patch(target.id, { concentratingOn: "Bless" });
  // No creature is left due: its own swing after the narration would ask the
  // save again.
  await enemyTurn([modelCall("apply_damage", { characterId: target.id, dice: "1d4", type: "fire", reason: "embers" })], "Embers sear.", []);
  const [held] = stops();
  assert.ok(held, "the character's concentration save stops");
  assert.match(held.reason, /Kara is about to make a saving throw as the blow lands\./);
  assert.equal((await answer(held.id, { value: 17 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.match(String(toldConcentration()), /"rolled":17/, "the foretold 17 is the concentration save's d20");
  assert.equal(fightWorld.sheet(target.id).concentratingOn, "Bless", "the 17 keeps it");
  fightWorld.patch(target.id, { concentratingOn: null, currentHp: 60 });
  arm();
  kit.setEnemy(goblin2.id, { currentHp: 300, maxHp: 300 });
  (await import("../src/lib/db/encounters.ts")).setEnemyConcentration(goblin2.id, "Bless");
  await enemyTurn([modelCall("apply_damage", { enemyId: goblin2.id, dice: "1d4", type: "fire", source: "hazard", reason: "embers" })], "Embers sear.", []);
  const [foe] = stops();
  assert.ok(foe, "the creature's concentration save stops");
  assert.equal((await answer(foe.id, { value: 3 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.equal(kit.enemy(goblin2.id).concentration, null, `the 3 breaks it: ${JSON.stringify(fightModel.requests.at(-1)?.messages.filter((message) => message.role === "tool").map((message) => message.content.slice(0, 400)))}`);
});

await test("A grapple stops for either side of its contest, and the number lands on the side picked.", async () => {
  arm();
  kit.setEnemy(goblin.id, { conditions: [], conditionMeta: {} });
  await karaTurn([modelCall("take_action", { characterId: target.id, action: "grapple", targetEnemyId: goblin.id })], "I grab the goblin.");
  const [grab] = stops();
  assert.ok(grab, "the contest stops");
  assert.deepEqual(choiceNames(grab), ["Kara", goblin.displayName]);
  const before = kindRolls("skill_check").length;
  assert.equal((await answer(grab.id, { value: 3, choice: 1 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  const landed = kindRolls("skill_check").slice(before);
  assert.ok(landed.some((roll) => roll.characterId === null && roll.breakdown.natural === 3), `the goblin's side shows the 3 (${JSON.stringify(landed.map((roll) => [roll.characterId, roll.breakdown.natural]))})`);
  assert.ok(landed.some((roll) => roll.characterId === target.id), "Kara's side rolled too");
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17]);
  kit.setEnemy(goblin.id, { conditions: [], conditionMeta: {} });
  fightWorld.patch(target.id, { conditions: [], conditionMeta: {} });
});

await test("A walk out of a creature's reach and a legendary action stop for the rolls they may throw.", async () => {
  arm();
  kit.place(target.id, 5, 5);
  kit.place(goblin.id, 6, 5);
  await karaTurn([modelCall("move_token", { token: target.id, x: 5, y: 9 })], "I back away.");
  const [walk] = stops();
  assert.ok(walk, "the walk stops");
  assert.match(walk.reason, /Kara is about to move\./);
  assert.ok(choiceNames(walk).includes(goblin.displayName), "the goblin's opportunity attack is one");
  await letItRoll(walk);
  kit.place(target.id, 5, 5);
  arm();
  await enemyTurn([modelCall("legendary_action", { enemyId: goblin.id, action: "Club", targetCharacterId: target.id })], "It lashes out.");
  const [legend] = stops();
  assert.ok(legend, "the legendary action stops");
  assert.deepEqual(choiceNames(legend), [goblin.displayName, "Kara"]);
  await letItRoll(legend);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3]);
  for (const enemy of goblinsBefore) kit.setEnemy(enemy.id, { currentHp: enemy.currentHp, maxHp: enemy.maxHp });
  fightWorld.patch(target.id, { currentHp: 60, conditions: [], conditionMeta: {} });
});

await test("A poison laid with afflict stops for its save.", async () => {
  arm();
  await enemyTurn([modelCall("afflict", { characterId: target.id, kind: "poison", name: "Serpent Venom" })], "The fang sinks in.");
  const [stop] = stops();
  assert.ok(stop, "the poison's save stops");
  assert.match(stop.reason, /Kara is about to make a saving throw against Serpent Venom\./);
  assert.equal((await answer(stop.id, { value: 17 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.equal(saveRolls().at(-1)?.breakdown.natural, 17, "the foretold 17 is the save's d20");
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [3]);
  fightWorld.patch(target.id, { conditions: [], conditionMeta: {}, currentHp: 60 });
});

await test("Polymorph at a creature of the fight stops before its save.", async () => {
  arm();
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  fightModel.script([reply({ calls: [modelCall("cast_buff", { characterId: target.id, targetEnemyId: goblin.id, spell: "Polymorph" })] }), reply({ text: "The goblin shrinks." })]);
  await fightModel.turn(fightWorld, "I polymorph the goblin.", target.id, targetUser.id);
  const [stop] = stops();
  assert.ok(stop, "the spell stops before the creature's save");
  assert.match(stop.reason, /Kara is about to cast Polymorph at Goblin/);
  await answer(stop.id, { pass: true });
  await settleQueue(fightWorld.campaignId);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3]);
});

await test("A hero's spell at one creature stops before it is cast, and the number lands on that creature's save.", async () => {
  arm();
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  fightWorld.patch(target.id, { spellcasting: { ability: "wis", cantrips: ["Sacred Flame"], known: [], prepared: [], slots: {} } });
  fightModel.script([reply({ calls: [modelCall("cast_at_enemy", { characterId: target.id, targetEnemyId: goblin.id, spell: "Sacred Flame" })] }), reply({ text: "Radiance falls." })]);
  const before = saveRolls().length;
  await fightModel.turn(fightWorld, "I call down Sacred Flame on the goblin.", target.id, targetUser.id);
  const [stop] = stops();
  assert.ok(stop, "the spell stops before its roll");
  assert.match(stop.reason, /Kara is about to cast Sacred Flame at Goblin/);
  assert.equal((await answer(stop.id, { value: 3 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  const landed = saveRolls().slice(before);
  assert.equal(landed[0]?.breakdown.natural, 3, `the goblin's save shows the 3 (${JSON.stringify(landed.map((roll) => roll.detail))})`);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17], "the 3 is paid for");
});

// The tool sends its creatures in `targets` (src/lib/dm/cast-tools.ts), and a
// stop that read only the flat targetEnemyId never came for it (play-test
// 2026-11-09: Hold Person at one creature, twice, with no Portent stop).
await test("A hero's spell sent as the tool sends it, its creature in targets, stops too.", async () => {
  arm();
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  fightWorld.patch(target.id, { spellcasting: { ability: "wis", cantrips: ["Sacred Flame"], known: [], prepared: [], slots: {} } });
  fightModel.script([reply({ calls: [modelCall("cast_at_enemy", { characterId: target.id, targets: [{ targetEnemyId: goblin.id }], spell: "Sacred Flame" })] }), reply({ text: "Radiance falls." })]);
  const before = saveRolls().length;
  await fightModel.turn(fightWorld, "I call down Sacred Flame on the goblin.", target.id, targetUser.id);
  const [stop] = stops();
  assert.ok(stop, "the spell stops before its roll");
  assert.match(stop.reason, /Kara is about to cast Sacred Flame at Goblin/);
  assert.equal(stop.watch.choices.length, 1, "one creature: nothing to pick");
  assert.equal((await answer(stop.id, { value: 3 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  const landed = saveRolls().slice(before);
  assert.equal(landed[0]?.breakdown.natural, 3, `the goblin's save shows the 3 (${JSON.stringify(landed.map((roll) => roll.detail))})`);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17], "the 3 is paid for");
});

await test("An area with one creature in it stops for that one's save; with two the player picks whose save takes the number.", async () => {
  arm();
  await enemyTurn([modelCall("aoe_damage", { enemyIds: [goblin2.id], saveAbility: "dex", dc: 25, damage: "1d4", damageType: "fire", halfOnSave: true })], "Embers fall.");
  const [stop] = stops();
  assert.ok(stop, "one creature's save stops");
  assert.match(stop.reason, /is about to make a saving throw\./);
  assert.equal((await answer(stop.id, { value: 3 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  // An area's saves ride its answer, not the roll log.
  const told = JSON.parse(fightModel.requests.at(-1).messages.filter((message) => message.role === "tool").at(-1).content);
  assert.match(told.portent ?? "", /its d20 shows 3/, JSON.stringify(told));
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17]);
  arm();
  await enemyTurn([modelCall("aoe_damage", { enemyIds: [goblin.id, goblin2.id], saveAbility: "dex", dc: 25, damage: "1d4", damageType: "fire", halfOnSave: true })], "Embers fall again.");
  const [pair] = stops();
  assert.ok(pair, "two savers stop too");
  assert.match(pair.reason, /2 creatures are about to make saving throws/);
  const { publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
  assert.deepEqual(publicPendingRoll(pair).watch.choices.map((choice) => choice.name), [goblin.displayName, goblin2.displayName], "the card names whose saves they are");
  // A number with no creature named is refused: the card asks whose first.
  const unnamed = await answer(pair.id, { value: 3 });
  assert.equal(unnamed.status, 400);
  assert.match(unnamed.json.error, /whose roll/);
  assert.equal((await answer(pair.id, { value: 3, choice: 2 })).status, 400, "a creature not in the list");
  fightWorld.dice(10, 10, 10, 4);
  assert.equal((await answer(pair.id, { value: 3, choice: 1 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  fightWorld.clearDice();
  const answered = JSON.parse(fightModel.requests.at(-1).messages.filter((message) => message.role === "tool").at(-1).content);
  assert.match(answered.portent ?? "", /its d20 shows 3/, JSON.stringify(answered));
  const rowOf = (name) => (answered.results ?? answered.targets ?? []).find((row) => row.target === name);
  const first = rowOf(goblin.displayName);
  const second = rowOf(goblin2.displayName);
  assert.ok(first && second, JSON.stringify(answered));
  // The second goblin's d20 is the 3; the first rolled its own 10.
  assert.equal(first.save - second.save, 7, JSON.stringify([first, second]));
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17]);
});

await test("A hero's spell at two creatures asks whose save takes the number, as an area does.", async () => {
  arm();
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  const kept = fightWorld.sheet(target.id).equipment;
  fightWorld.patch(target.id, { concentratingOn: null, equipment: [...kept, { name: "Component Pouch", qty: 1 }], spellcasting: { ability: "wis", cantrips: [], known: [], prepared: ["Hold Person"], slots: { 3: { max: 1, used: 0 } } } });
  // Hold Person from a 3rd-level slot reaches two creatures.
  fightModel.script([
    reply({ calls: [modelCall("cast_at_enemy", { characterId: target.id, targets: [{ targetEnemyId: goblin.id }, { targetEnemyId: goblin2.id }], spell: "Hold Person", level: 3 })] }),
    reply({ text: "Both goblins stiffen." }),
  ]);
  const before = saveRolls().length;
  await fightModel.turn(fightWorld, "I cast Hold Person at both goblins.", target.id, targetUser.id);
  const [stop] = stops();
  assert.ok(stop, "the spell stops before its saves");
  assert.match(stop.reason, /Kara is about to cast Hold Person at Goblin/);
  const { publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
  assert.deepEqual(publicPendingRoll(stop).watch.choices.map((choice) => choice.name), [goblin.displayName, goblin2.displayName], "the card names whose saves they are");
  const unnamed = await answer(stop.id, { value: 3 });
  assert.equal(unnamed.status, 400);
  assert.match(unnamed.json.error, /whose roll/);
  fightWorld.dice(10);
  assert.equal((await answer(stop.id, { value: 3, choice: 1 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  fightWorld.clearDice();
  const landed = saveRolls().slice(before);
  const told = fightModel.requests.at(-1).messages.filter((message) => message.role === "tool").at(-1)?.content;
  // The second goblin's d20 is the 3; the first rolled its own 10.
  assert.deepEqual(landed.map((roll) => roll.breakdown.natural), [10, 3], told);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17]);
  // The tests after this one need the goblins free and Kara's mind clear.
  for (const enemy of [goblin, goblin2]) kit.setEnemy(enemy.id, { conditions: [] });
  fightWorld.patch(target.id, { concentratingOn: null, concentrationRounds: null, equipment: kept });
});

// With the tool's `targets` read, every cast_at_enemy came to the stop: Magic
// Missile's darts too, which throw no d20, and a spell at a creature already
// down, which the tool refuses before any roll. Each held the turn for its
// whole time with a number nothing could take.
await test("Magic Missile's darts, and a spell at a creature already down, hold nothing: no d20 is thrown there.", async () => {
  arm();
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  const hp = [goblin, goblin2].map((enemy) => fightWorld.enemies().find((entry) => entry.id === enemy.id).currentHp);
  fightWorld.patch(target.id, { spellcasting: { ability: "wis", cantrips: ["Sacred Flame"], known: [], prepared: ["Magic Missile"], slots: { 1: { max: 1, used: 0 } } } });
  fightModel.script([
    reply({ calls: [modelCall("cast_at_enemy", { characterId: target.id, targets: [{ targetEnemyId: goblin.id, darts: 2 }, { targetEnemyId: goblin2.id, darts: 1 }], spell: "Magic Missile", level: 1 })] }),
    reply({ text: "Darts streak out." }),
  ]);
  await fightModel.turn(fightWorld, "I cast Magic Missile at both goblins.", target.id, targetUser.id);
  await settleQueue(fightWorld.campaignId);
  assert.equal(stops().length, 0, "darts that never roll are not stopped for");
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3]);
  const { patchEnemyHp } = await import("../src/lib/db/encounters.ts");
  patchEnemyHp(goblin2.id, 0, "dead");
  try {
    saveEncounter({ ...fightWorld.encounter(), turnBudget: null });
    fightModel.script([reply({ calls: [modelCall("cast_at_enemy", { characterId: target.id, targets: [{ targetEnemyId: goblin2.id }], spell: "Sacred Flame" })] }), reply({ text: "The body lies still." })]);
    await fightModel.turn(fightWorld, "I call down Sacred Flame on the fallen goblin.", target.id, targetUser.id);
    await settleQueue(fightWorld.campaignId);
    assert.equal(stops().length, 0, "a creature already down makes no save");
  } finally {
    patchEnemyHp(goblin.id, hp[0], "alive");
    patchEnemyHp(goblin2.id, hp[1], "alive");
  }
});

// A lasting area whose first saves come as it appears, laid on a square and
// naming nobody (Grease, whose text prints no burst): the stop reads who
// stands on its squares as aoe_damage then catches them (area-casting.ts
// boardCatch). It read only a burst, so no stop came.
await test("Grease laid on a square with nobody named stops for the save of the creature standing in it, and the number lands there.", async () => {
  arm();
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  const kept = fightWorld.sheet(target.id).equipment;
  fightWorld.patch(target.id, { concentratingOn: null, equipment: [...kept, { name: "Component Pouch", qty: 1 }], spellcasting: { ability: "wis", cantrips: [], known: [], prepared: ["Grease"], slots: { 1: { max: 1, used: 0 } } } });
  // Kara steps back, so only the goblin stands on the grease's 10-foot square.
  kit.place(target.id, 1, 1);
  fightModel.script([reply({ calls: [modelCall("aoe_damage", { casterCharacterId: target.id, spell: "Grease", level: 1, atX: 6, atY: 5 })] }), reply({ text: "The goblin slides." })]);
  const before = saveRolls().length;
  await fightModel.turn(fightWorld, "I cast Grease under the goblin.", target.id, targetUser.id);
  const [stop] = stops();
  assert.ok(stop, "the casting stops before the save");
  assert.match(stop.reason, /Goblin.* is about to make a saving throw against Grease/);
  assert.equal(stop.watch.choices.length, 1, "one creature on the grease");
  assert.equal((await answer(stop.id, { value: 3 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  const landed = saveRolls().slice(before);
  assert.equal(landed[0]?.breakdown.natural, 3, `the goblin's save shows the 3 (${JSON.stringify(landed.map((roll) => roll.detail))})`);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17]);
  kit.place(target.id, 5, 5);
  kit.setEnemy(goblin.id, { conditions: [] });
  fightWorld.patch(target.id, { equipment: kept });
});

// Ice Storm laid on a square names nobody either; its burst is read from its
// text, and it leaves hail as well (issue 570, #889).
await test("Ice Storm laid on a square with nobody named asks whose save, of the creatures standing in its storm.", async () => {
  arm();
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  const kept = fightWorld.sheet(target.id).equipment;
  const hp = [goblin, goblin2].map((enemy) => fightWorld.enemies().find((entry) => entry.id === enemy.id).currentHp);
  fightWorld.patch(target.id, { concentratingOn: null, equipment: [...kept, { name: "Component Pouch", qty: 1 }], spellcasting: { ability: "wis", cantrips: [], known: [], prepared: ["Ice Storm"], slots: { 4: { max: 1, used: 0 } } } });
  // Kara stands well clear of her own storm, as does the watcher.
  kit.place(target.id, 0, 9);
  fightModel.script([reply({ calls: [modelCall("aoe_damage", { casterCharacterId: target.id, spell: "Ice Storm", level: 4, atX: 5, atY: 3 })] }), reply({ text: "Hail hammers the goblins." })]);
  await fightModel.turn(fightWorld, "I cast Ice Storm over the goblins.", target.id, targetUser.id);
  const [stop] = stops();
  assert.ok(stop, "the storm stops before its saves");
  const { publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
  assert.deepEqual(publicPendingRoll(stop).watch.choices.map((choice) => choice.name).sort(), [goblin.displayName, goblin2.displayName].sort(), "the creatures in the storm, and nobody outside it");
  assert.equal((await answer(stop.id, { pass: true })).status, 200);
  await settleQueue(fightWorld.campaignId);
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17, 3], "let it roll spends nothing");
  const { patchEnemyHp } = await import("../src/lib/db/encounters.ts");
  patchEnemyHp(goblin.id, hp[0], "alive");
  patchEnemyHp(goblin2.id, hp[1], "alive");
  kit.place(target.id, 5, 5);
  fightWorld.patch(target.id, { equipment: kept });
});

await test("A foretold miss on a hero's own swing still leaves them their Bardic die to decide, on the card, and the turn waits for it.", async () => {
  arm({ foretold: [17, 9] });
  const order = fightWorld.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === target.id), turnBudget: null });
  fightWorld.patch(target.id, { conditions: ["bardic inspiration (d8)"], equipment: [{ name: "Longsword", qty: 1, equipped: true }], abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 } });
  kit.setEnemy(goblin.id, { currentHp: 300, maxHp: 300, ac: 15 });
  fightModel.script([reply({ calls: [modelCall("pc_attack", { characterId: target.id, attacks: [{ targetEnemyId: goblin.id }] })] }), reply({ text: "The blade glances off." })]);
  await fightModel.turn(fightWorld, "I swing at the goblin.", target.id, targetUser.id);
  const [stop] = stops();
  assert.ok(stop, "the swing stops for the watcher");
  // A 9 and Kara's +3 make 12 against AC 15: a miss her d8 could still turn.
  assert.equal((await answer(stop.id, { value: 9 })).status, 200);
  await settleQueue(fightWorld.campaignId);
  const card = listOpenPendingRolls(fightWorld.campaignId).find((entry) => entry.kind === "attack" && entry.parkedFor === "after_roll");
  assert.ok(card, "the foretold 9 misses, and the die that could save it is the player's to spend");
  assert.equal(card.thrown.outcome.natural, 9);
  assert.equal(getDmTurn(card.turnId).status, "awaiting_rolls");
  fightWorld.signIn(targetUser);
  const kept = await call(await fightWorld.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"), "POST", { keep: true }, { campaignId: fightWorld.campaignId, pendingRollId: card.id });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  await settleQueue(fightWorld.campaignId);
  assert.equal(getDmTurn(card.turnId).status, "done");
  const told = fightModel.requests.at(-1).messages.filter((message) => message.role === "tool").map((message) => message.content).join(" ");
  assert.match(told, /MISS/, "the model reads the swing's answer");
  assert.ok(fightWorld.sheet(target.id).conditions.includes("bardic inspiration (d8)"), "kept: the die is still Kara's");
  assert.deepEqual(fightWorld.sheet(seer.id).foretold, [17]);
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
