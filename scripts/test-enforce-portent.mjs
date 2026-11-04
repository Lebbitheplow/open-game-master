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
//   an undo of the spend gives the number back.
import assert from "node:assert/strict";
import { call, seats } from "./lib/enforce-campaign.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
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

model.close();
finish();
