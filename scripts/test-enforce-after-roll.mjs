// The after-the-roll pause (src/lib/dm/after-roll.ts): the Lucky feat, a held
// Bardic Inspiration die and Dark One's Own Luck are decided after the d20 of a
// check or a save lands and before the game says what it did.
//
// The rules held:
//   a roll waits only when what the character holds could change its result;
//   nothing is spent until the player spends it, and a held die survives a
//   roll that needed none;
//   a luck point's d20 is the player's to choose among, whatever the advantage;
//   whoever runs the story may keep the dice for an absent player, and an
//   answer from a screen that knows nothing of the pause keeps them too;
//   a roll nobody chooses for is kept as it lies when its time runs out
//   (src/lib/dm/after-roll-timer.ts), each choice giving fresh time, a break
//   holding it, and a restart arming it again.
import assert from "node:assert/strict";
import { call, seats } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-after-roll");
const { getDmTurn, getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { AFTER_ROLL_SECONDS, keepAfterRollWhenDue, rearmAfterRollKeeps } = await import("../src/lib/dm/after-roll-timer.ts");
const { pauseTable, resumeTable } = await import("../src/lib/dm/table-break.ts");
const { subscribe } = await import("../src/lib/events.ts");
const past = (pending) => new Date(getPendingRoll(pending.id).thrown.deadline).getTime() + 1;

const world = await openWorld({ campaign: { maxPlayers: 20 } });
const who = await seats(world);
// The clock runs only while someone else is at the table to be held up
// (after-roll-timer.ts): the GM's screen is open, as at a table in play.
let gmOnline = subscribe(world.campaignId, () => {}, who.dm.id);
const kit = await combatKit(world);
const route = {
  choice: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"),
  pending: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
};
const params = (id) => ({ campaignId: world.campaignId, pendingRollId: id });

const open = () => listOpenPendingRolls(world.campaignId);
const stored = () => listRecentRolls(world.campaignId, 100);
const landed = (id) => stored().find((roll) => roll.id === getPendingRoll(id).rollId);
const choose = (id, body, user = who.player) => {
  world.signIn(user);
  return call(route.choice, "POST", body, params(id));
};

// Each test's hero, on the seated player's account, as the table's own.
const hero = (patch) => {
  world.patch(who.sheet.id, {
    conditions: [],
    feats: [],
    features: [],
    resources: {},
    class: "fighter",
    level: 5,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencies: { ...TRAINED, saves: [] },
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    ...patch,
  });
  return who.sheet.id;
};

const LUCKY = { feats: ["Lucky"], resources: { luck_points: { max: 3, used: 0 } } };
const check = (args = {}) => world.invoke("request_roll", { characterId: who.sheet.id, kind: "ability_check", ability: "str", dc: 15, reason: "lift the gate", ...args });
const clear = async () => {
  for (const pending of open()) {
    await choose(pending.id, { keep: true });
  }
};

await test("A roll that already succeeds does not wait, and nothing is spent on it.", async () => {
  hero({ ...LUCKY, conditions: ["bardic inspiration (d8)"] });
  world.dice(18);
  const out = await check();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(open().length, 0, "no card on a success");
  const sheet = world.sheet(who.sheet.id);
  assert.equal(sheet.resources.luck_points.used, 0);
  assert.ok(sheet.conditions.includes("bardic inspiration (d8)"), "the die is still held: this was the bug");
});

await test("A character who holds none of these rolls as they always did.", async () => {
  hero({});
  world.dice(3);
  const out = await check();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(open().length, 0);
  assert.equal(out.result.total, 3);
});

await test("A failed roll waits; keeping it spends nothing and lands the dice as they lay.", async () => {
  hero(LUCKY);
  const before = stored().length;
  world.dice(3);
  await check();
  world.clearDice();
  const [pending] = open();
  assert.ok(pending, "the roll waits");
  assert.deepEqual(pending.thrown.options.map((option) => option.id), ["lucky"]);
  assert.equal(stored().length, before, "not recorded yet");
  const out = await choose(pending.id, { keep: true });
  assert.equal(out.status, 200);
  assert.equal(open().length, 0);
  assert.equal(landed(pending.id).total, 3);
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 0);
});

await test("Lucky: the point rolls another d20 and the player chooses, even a lower die.", async () => {
  hero(LUCKY);
  world.dice(3);
  await check();
  world.clearDice();
  const [pending] = open();
  world.dice(16);
  const spent = await choose(pending.id, { use: "lucky" });
  world.clearDice();
  assert.equal(spent.status, 200);
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 1);
  const [waiting] = open();
  assert.equal(waiting.thrown.choosing, true, "the player picks a die before anything lands");
  assert.equal((await choose(pending.id, { keep: false })).status, 400, "a bad body is refused");
  // The lower of the two: the feat says the character chooses.
  await choose(pending.id, { die: 0 });
  assert.equal(open().length, 0, "one luck point a roll: still short, with points left, the roll lands");
  assert.equal(landed(pending.id).total, 3);
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 1);
});

await test("Lucky at disadvantage: any of the dice can be the one, the high one too.", async () => {
  hero(LUCKY);
  world.dice(2, 19);
  await check({ advantage: "disadvantage" });
  world.clearDice();
  const [pending] = open();
  assert.equal(pending.thrown.outcome.total, 2);
  world.dice(5);
  await choose(pending.id, { use: "lucky" });
  world.clearDice();
  await choose(pending.id, { die: 1 });
  assert.equal(open().length, 0, "19 clears the DC: it lands");
  assert.equal(landed(pending.id).total, 19);
  assert.equal(landed(pending.id).breakdown.natural, 19);
});

await test("Bardic Inspiration: the die is added only when the player spends it, and landing the roll ends the wait.", async () => {
  hero({ conditions: ["bardic inspiration (d8)"] });
  world.dice(12);
  await check();
  world.clearDice();
  const [pending] = open();
  assert.deepEqual(pending.thrown.options.map((option) => option.id), ["bardic"]);
  assert.ok(world.sheet(who.sheet.id).conditions.includes("bardic inspiration (d8)"), "not spent by being offered");
  world.dice(6);
  const out = await choose(pending.id, { use: "bardic" });
  world.clearDice();
  assert.equal(out.status, 200);
  assert.equal(open().length, 0);
  assert.equal(landed(pending.id).total, 18);
  assert.ok(!world.sheet(who.sheet.id).conditions.includes("bardic inspiration (d8)"));
});

await test("Each of them rides a roll once: no second luck point with no DC, none after a point spent before the throw, and each die once.", async () => {
  hero({ ...LUCKY, conditions: ["bardic inspiration (d8)"] });
  world.dice(3);
  await check({ dc: undefined });
  world.clearDice();
  const [pending] = open();
  world.dice(4);
  await choose(pending.id, { use: "lucky" });
  world.clearDice();
  await choose(pending.id, { die: 1 });
  const [after] = open();
  assert.deepEqual(after.thrown.options.map((option) => option.id), ["bardic"], "no DC still asks, but the luck point is not offered twice");
  world.dice(2);
  await choose(pending.id, { use: "bardic" });
  world.clearDice();
  assert.equal(open().length, 0, "nothing is left to offer: it lands");
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 1);

  hero(LUCKY);
  world.dice(2, 3);
  await check({ luck: true });
  world.clearDice();
  assert.equal(open().length, 0, "the point spent before the throw was this roll's one");
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 1);
});

await test("A die too small to reach the target is not offered, so nobody waits on it.", async () => {
  hero({ conditions: ["bardic inspiration (d4)"] });
  world.dice(3);
  const out = await check();
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(open().length, 0);
  assert.ok(world.sheet(who.sheet.id).conditions.includes("bardic inspiration (d4)"));
});

await test("Dark One's Own Luck: a check or a save, from a Fiend warlock's own use.", async () => {
  const warlock = world.addHero({ user: who.player, class: "warlock", subclass: "the_fiend", level: 6, proficiencies: TRAINED });
  assert.equal(world.sheet(warlock.id).resources.dark_ones_own_luck?.max, 1, "the real sheet holds the feature");
  world.dice(9);
  await check({ characterId: warlock.id });
  world.clearDice();
  const [pending] = open();
  assert.deepEqual(pending.thrown.options.map((option) => option.id), ["own_luck"]);
  world.dice(10);
  await choose(pending.id, { use: "own_luck" });
  world.clearDice();
  assert.equal(landed(pending.id).total, 19);
  assert.equal(world.sheet(warlock.id).resources.dark_ones_own_luck.used, 1);
});

await test("A seat an agent plays rolls as it always did: it has no card to press.", async () => {
  const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
  const agent = world.addUser("agent");
  const seat = world.addHero({ user: agent, class: "fighter", level: 5, proficiencies: TRAINED });
  world.patch(seat.id, { conditions: ["bardic inspiration (d8)"] });
  const made = createConnectionGrant({ userId: agent.id, name: "seat", scopes: ["play"], campaignId: world.campaignId });
  assert.ok(!("error" in made), made.error);
  world.dice(3, 6);
  const out = await check({ characterId: seat.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(open().length, 0);
  assert.ok(!world.sheet(seat.id).conditions.includes("bardic inspiration (d8)"), "the die rides the roll, as it did");
});

await test("A grant that cannot play is no agent in the seat: its person still gets the pause.", async () => {
  const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
  const reader = world.addUser("reader");
  const seat = world.addHero({ user: reader, class: "fighter", level: 5, proficiencies: TRAINED });
  world.patch(seat.id, { conditions: ["bardic inspiration (d8)"] });
  const made = createConnectionGrant({ userId: reader.id, name: "reader", scopes: ["read"], campaignId: null });
  assert.ok(!("error" in made), made.error);
  world.dice(10);
  await check({ characterId: seat.id });
  world.clearDice();
  const [pending] = open();
  assert.ok(pending, "the roll waits");
  await choose(pending.id, { keep: true }, reader);
  assert.ok(world.sheet(seat.id).conditions.includes("bardic inspiration (d8)"));
});

await test("Typed dice wait too; a server die on them drops the \"(physical)\" label; the GM's fallback for an absent player lands.", async () => {
  const prefs = await world.route("campaigns/[campaignId]/members/me");
  const campaigns = await import("../src/lib/db/campaigns.ts");
  world.signIn(who.player);
  const hold = await call(prefs, "PATCH", { holdRolls: true }, { campaignId: world.campaignId });
  assert.ok(hold.status < 300);
  void campaigns;
  hero({ conditions: ["bardic inspiration (d8)"] });
  await check();
  const [first] = open();
  assert.equal(first.thrown, null, "a held roll waits to be thrown");
  world.dice(10);
  const fallback = await call(route.pending, "POST", { fallback: "digital" }, params(first.id));
  world.clearDice();
  assert.equal(fallback.status, 200);
  const [waiting] = open();
  assert.ok(waiting.thrown, "the roller's own release shows them the dice");
  world.dice(6);
  await choose(first.id, { use: "bardic" });
  world.clearDice();
  assert.equal(getPendingRoll(first.id).status, "fallback");
  assert.ok(!landed(first.id).detail.includes("physical"));

  hero({ conditions: ["bardic inspiration (d8)"] });
  await check();
  const [away] = open();
  world.signIn(world.owner);
  world.dice(10);
  const steered = await call(route.pending, "POST", { fallback: "digital" }, params(away.id));
  world.clearDice();
  assert.equal(steered.status, 200);
  assert.equal(open().length, 0, "the GM's press lands it");
  assert.ok(world.sheet(who.sheet.id).conditions.includes("bardic inspiration (d8)"), "and spends nothing of theirs");
  world.signIn(who.player);
  await call(prefs, "PATCH", { holdRolls: false }, { campaignId: world.campaignId });
});

await test("A die or a use is taken once per roll, and Inspiration cannot follow the dice.", async () => {
  hero({ ...LUCKY, conditions: ["bardic inspiration (d4)"] });
  world.dice(11);
  await check();
  world.clearDice();
  const [pending] = open();
  world.dice(1);
  await choose(pending.id, { use: "bardic" });
  world.clearDice();
  const [again] = open();
  assert.deepEqual(again.thrown.options.map((option) => option.id), ["lucky"], "the bard's die is gone and is not offered");
  assert.equal(again.thrown.outcome.total, 12);
  assert.equal((await choose(pending.id, { use: "bardic" })).status, 409);
  world.signIn(who.player);
  const inspired = await call(await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/inspiration"), "POST", {}, params(pending.id));
  assert.equal(inspired.status, 409);
  await choose(pending.id, { keep: true });
});

await test("A spend is filed under the turn it served, so an undo of the turn can give it back.", async () => {
  const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");
  hero({ ...LUCKY, conditions: ["bardic inspiration (d8)"] });
  world.dice(12);
  await check();
  world.clearDice();
  const [pending] = open();
  world.dice(1);
  await choose(pending.id, { use: "lucky" });
  world.clearDice();
  const row = listRecentAudit(world.campaignId, 20).find((entry) => entry.kind === "use_resource" && entry.turnId === pending.turnId);
  assert.ok(row, "filed under the turn");
  assert.equal(row.actor, "player", "the player's own spend, not the GM's");
  // Undoing that row gives the point back.
  world.signIn(world.owner);
  const undone = await call(await world.route("campaigns/[campaignId]/audit/[entryId]/undo"), "POST", {}, { campaignId: world.campaignId, entryId: row.id });
  assert.equal(undone.status, 200, JSON.stringify(undone.body ?? undone));
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 0);
  await choose(pending.id, { die: 0 });
  await choose(pending.id, { keep: true });
});

await test("A turn cannot be reverted while its roll waits on the card; once it lands, its revert gives the luck point back.", async () => {
  hero(LUCKY);
  world.dice(3);
  await check();
  world.clearDice();
  const [pending] = open();
  const revert = await world.route("campaigns/[campaignId]/audit/revert-turn");
  world.signIn(world.owner);
  const early = await call(revert, "POST", { turnId: pending.turnId, confirm: true }, { campaignId: world.campaignId });
  assert.equal(early.status, 409, "a waiting turn is still being played");
  world.dice(2);
  await choose(pending.id, { use: "lucky" });
  world.clearDice();
  await choose(pending.id, { die: 0 });
  await choose(pending.id, { keep: true });
  assert.equal(open().length, 0);
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 1);
  world.signIn(world.owner);
  const done = await call(revert, "POST", { turnId: pending.turnId, confirm: true }, { campaignId: world.campaignId });
  assert.equal(done.status, 200, JSON.stringify(done.body ?? done));
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 0, "the player's spend on the turn's roll goes with the turn");
});

await test("Only the roller chooses; whoever runs the story may keep the dice for them.", async () => {
  hero(LUCKY);
  world.dice(3);
  await check();
  world.clearDice();
  const [pending] = open();
  assert.equal((await choose(pending.id, { use: "lucky" }, who.other)).status, 403);
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 0);
  assert.equal((await choose(pending.id, { keep: true }, world.owner)).status, 200);
  assert.equal(open().length, 0);
});

await test("An answer from a screen that knows no pause keeps the dice: it never rethrows them.", async () => {
  hero(LUCKY);
  world.dice(3);
  await check();
  world.clearDice();
  const [pending] = open();
  world.signIn(who.player);
  world.dice(20);
  const out = await call(route.pending, "POST", { fallback: "digital" }, params(pending.id));
  world.clearDice();
  assert.equal(out.status, 200);
  assert.equal(landed(pending.id).total, 3);
});

await test("A roll behind the GM's screen never waits: its card would show the table the dice.", async () => {
  hero(LUCKY);
  world.dice(3);
  const out = await check({ visibility: "dm" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(open().length, 0);
});

// Attacks have their own suite: scripts/test-enforce-after-roll-attacks.mjs.
await test("An attack waits too, on a miss the die could turn: the engine no longer adds it unasked.", async () => {
  await kit.endFight();
  hero({ conditions: ["bardic inspiration (d8)"] });
  await kit.fight(1, { heroFaces: { [who.sheet.id]: 19, [who.leadSheet.id]: 2, [who.otherSheet.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(who.sheet.id, 5, 5);
  kit.place(enemy.id, 6, 5);
  kit.giveTurn(who.sheet.id);
  world.patch(who.sheet.id, { conditions: ["bardic inspiration (d8)"] });
  const swing = await kit.swing(who.sheet.id, enemy.id, [2, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  const [pending] = open();
  assert.equal(pending?.kind, "attack", "the attack waits on the player");
  assert.ok(world.sheet(who.sheet.id).conditions.includes("bardic inspiration (d8)"), "nothing spent yet");
  await choose(pending.id, { keep: true });
  await kit.endFight();
});

await test("A halfling's Lucky trait holds no luck points, and a stored counter goes at the next resync; the feat holds them.", async () => {
  const { populateResources } = await import("../src/lib/srd/class-resources.ts");
  const halfling = world.addHero({ user: who.player, race: "halfling", class: "fighter", level: 5, proficiencies: TRAINED, features: [{ name: "Lucky", source: "race", level: 1 }] });
  const sheet = world.sheet(halfling.id);
  assert.ok(sheet.features.some((feature) => feature.source === "race" && /^lucky/i.test(feature.name)), "the trait is on the sheet");
  assert.equal(sheet.resources.luck_points, undefined, "no points from the trait: this was the bug");
  // A row written before the fix keeps its counter until the boot resync,
  // which drops it (src/lib/db/core.ts reads populateResources).
  const resynced = populateResources(sheet.features, 5, {}, { ...sheet.resources, luck_points: { max: 3, used: 1 } }, undefined, []);
  assert.equal(resynced.luck_points, undefined);
  assert.equal(populateResources(sheet.features, 5, {}, {}, undefined, ["Lucky"]).luck_points?.max, 3, "the feat still holds three");
});

await test("A roll nobody chooses for is kept as it lies when its time runs out, and nothing is spent.", async () => {
  hero({ ...LUCKY, conditions: ["bardic inspiration (d8)"] });
  const before = Date.now();
  world.dice(9);
  await check();
  world.clearDice();
  const [pending] = open();
  const deadline = new Date(pending.thrown.deadline).getTime();
  assert.ok(Math.abs(deadline - before - AFTER_ROLL_SECONDS * 1000) < 5000, `the roll has ${AFTER_ROLL_SECONDS}s`);
  assert.equal(await keepAfterRollWhenDue(pending.id, deadline - 1000), false, "not before its time");
  assert.equal(open().length, 1);
  assert.equal(await keepAfterRollWhenDue(pending.id, past(pending)), true);
  assert.equal(open().length, 0, "the card is gone");
  assert.equal(landed(pending.id).total, 9, "the dice as they lay");
  const sheet = world.sheet(who.sheet.id);
  assert.equal(sheet.resources.luck_points.used, 0, "no luck point spent");
  assert.ok(sheet.conditions.includes("bardic inspiration (d8)"), "the die is still held");
  assert.equal(await keepAfterRollWhenDue(pending.id, past(pending)), false, "a landed roll is left alone");
});

await test("Each choice gives fresh time, and a luck point's dice left unchosen keep the higher.", async () => {
  hero(LUCKY);
  world.dice(4);
  await check();
  world.clearDice();
  const [pending] = open();
  const first = pending.thrown.deadline;
  await new Promise((resolve) => setTimeout(resolve, 20));
  world.dice(12);
  assert.equal((await choose(pending.id, { use: "lucky" })).status, 200);
  world.clearDice();
  const choosing = getPendingRoll(pending.id).thrown;
  assert.equal(choosing.choosing, true);
  assert.ok(new Date(choosing.deadline).getTime() > new Date(first).getTime(), "the new decision has its own time");
  assert.equal(await keepAfterRollWhenDue(pending.id, new Date(first).getTime() + 1), false, "the old deadline no longer counts");
  assert.equal(await keepAfterRollWhenDue(pending.id, past(pending)), true);
  assert.equal(landed(pending.id).total, 12, "the higher die");
  assert.equal(world.sheet(who.sheet.id).resources.luck_points.used, 1, "the point the player spent, and no other");
});

await test("A player alone at the table is given no clock: nobody waits on them, so nothing takes their choice away.", async () => {
  gmOnline();
  const ownTab = subscribe(world.campaignId, () => {}, who.player.id);
  try {
    hero(LUCKY);
    world.dice(4);
    await check();
    world.clearDice();
    const [pending] = open();
    assert.ok(pending, "the roll still waits on the card");
    assert.equal(pending.thrown.deadline, undefined, "with no count: the player's own screen is no one else");
    assert.equal(await keepAfterRollWhenDue(pending.id, Date.now() + 60 * 60 * 1000), false, "and nothing keeps it for them");
    world.dice(15);
    await choose(pending.id, { use: "lucky" });
    world.clearDice();
    assert.equal(getPendingRoll(pending.id).thrown.deadline, undefined, "the next decision has none either");
    await choose(pending.id, { die: 1 });
  } finally {
    ownTab();
    gmOnline = subscribe(world.campaignId, () => {}, who.dm.id);
  }
  assert.equal(open().length, 0);
});

await test("A break holds the roll past its time; the wait goes on after it.", async () => {
  hero(LUCKY);
  world.dice(5);
  await check();
  world.clearDice();
  const [pending] = open();
  pauseTable(world.campaignId, { id: who.dm.id, username: "dm" });
  try {
    assert.equal(await keepAfterRollWhenDue(pending.id, past(pending)), false, "not during a break");
    assert.equal(open().length, 1);
  } finally {
    resumeTable(world.campaignId, { id: who.dm.id, username: "dm" });
  }
  assert.equal(await keepAfterRollWhenDue(pending.id, past(pending)), true);
  assert.equal(landed(pending.id).total, 5);
});

// ---- the AI's turn ----

const table = await openWorld({ gameSettings: { ttsEnabled: false } });
const tableOwnerOnline = subscribe(table.campaignId, () => {}, table.owner.id);
const model = await fakeModel();
model.pointAt(table);
const tableRoute = await table.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");

await test("An AI turn stops on the waiting roll, and resumes with the result the player settled on.", async () => {
  const bard = table.addHero({ name: "Reya", class: "fighter", level: 5 });
  table.patch(bard.id, { conditions: ["bardic inspiration (d8)"] });
  model.script([
    reply({ calls: [modelCall("request_roll", { characterId: bard.id, kind: "ability_check", ability: "str", dc: 15, reason: "the gate" })] }),
    reply({ text: "The gate groans open." }),
  ]);
  table.dice(10);
  const turn = await model.turn(table, "I heave at the gate.");
  table.clearDice();
  const pending = listOpenPendingRolls(table.campaignId)[0];
  assert.ok(pending, "the roll waits");
  assert.equal(pending.toolCallId !== null, true, "it remembers the call it answers");
  assert.equal(getDmTurn(pending.turnId).status, "awaiting_rolls");
  assert.equal(model.requests.length, 1, "the model has not been told the roll");
  void turn;

  table.signIn({ id: pending.userId });
  table.dice(8);
  const out = await call(tableRoute, "POST", { use: "bardic" }, { campaignId: table.campaignId, pendingRollId: pending.id });
  table.clearDice();
  assert.equal(out.status, 200);
  await settleQueue(table.campaignId);
  assert.equal(getDmTurn(pending.turnId).status, "done");
  const told = JSON.stringify(model.requests[1]);
  assert.match(told, /\\"total\\":\s*\d+|"total"/, "the resumed model reads the roll");
  assert.match(told, /18/, "the total with the die on it");
});

await test("A restart while the roll waits leaves it waiting, with its dice and its choice.", async () => {
  const lucky = table.addHero({ name: "Tam", class: "fighter", level: 5, feats: ["Lucky"], resources: { luck_points: { max: 3, used: 0 } } });
  model.script([
    reply({ calls: [modelCall("request_roll", { characterId: lucky.id, kind: "ability_check", ability: "str", dc: 15, reason: "the gate" })] }),
    reply({ text: "It holds." }),
  ]);
  table.dice(4);
  await model.turn(table, "I heave again.");
  table.clearDice();
  const [pending] = listOpenPendingRolls(table.campaignId);
  const { recoverDmAfterRestart } = await import("../src/lib/dm/restart-recovery.ts");
  recoverDmAfterRestart();
  await settleQueue(table.campaignId);
  const [still] = listOpenPendingRolls(table.campaignId);
  assert.equal(still?.id, pending.id, "the roll still waits");
  assert.equal(still.thrown.outcome.total, 4);
  assert.deepEqual(still.thrown.options.map((option) => option.id), ["lucky"]);
  assert.ok(still.thrown.deadline, "with its time");
  assert.ok(rearmAfterRollKeeps() >= 1, "its timer armed again");
  table.signIn({ id: pending.userId });
  assert.equal((await call(tableRoute, "POST", { keep: true }, { campaignId: table.campaignId, pendingRollId: pending.id })).status, 200);
  await settleQueue(table.campaignId);
  assert.equal(getDmTurn(pending.turnId).status, "done");
});

await test("An AI turn waiting on a roll nobody chooses for resumes when its time runs out.", async () => {
  const lucky = table.addHero({ name: "Ola", class: "fighter", level: 5, feats: ["Lucky"], resources: { luck_points: { max: 3, used: 0 } } });
  model.script([
    reply({ calls: [modelCall("request_roll", { characterId: lucky.id, kind: "ability_check", ability: "str", dc: 15, reason: "the door" })] }),
    reply({ text: "The door stays shut." }),
  ]);
  const asked = model.requests.length;
  table.dice(6);
  await model.turn(table, "I shoulder the door.");
  table.clearDice();
  const [pending] = listOpenPendingRolls(table.campaignId);
  assert.equal(getDmTurn(pending.turnId).status, "awaiting_rolls");
  assert.equal(await keepAfterRollWhenDue(pending.id, new Date(pending.thrown.deadline).getTime() + 1), true);
  await settleQueue(table.campaignId);
  assert.equal(getDmTurn(pending.turnId).status, "done");
  assert.match(JSON.stringify(model.requests[asked + 1]), /total\\{0,2}":\s*6\b/, "the model reads the roll as it lay");
  assert.equal(table.sheet(lucky.id).resources.luck_points.used, 0);
});

model.close();
gmOnline();
tableOwnerOnline();
finish();
