// Cosmic Omen and Restore Balance are used before the roll, on Portent's path
// (src/lib/dm/before-roll-logic.ts, foresight-before.ts; the maintainer's
// ruling on issue #908):
//
//   a long rest rolls the omen (even Weal, odd Woe), kept on the sheet and
//   said in the rest's line;
//   on the holder's own check or save, the hold before the throw offers Weal
//   (a d6 rides the roll) and Restore Balance on disadvantage (one d20), for
//   a use and the reaction;
//   on another's roll in a fight, the watch stop holds an enemy's attack and
//   answers it before its d20: Woe takes a d6 off it, Restore Balance throws
//   one d20, paid only if the roll had an edge;
//   out of a fight the same Watch toggle holds an ally's check for the stop;
//   and neither is offered on the after-the-roll card any more.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-before-roll");
const { getDmTurn, getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { longRestPatch } = await import("../src/lib/dm/rest-logic.ts");
const logic = await import("../src/lib/dm/before-roll-logic.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");

const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const route = {
  before: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/before-roll"),
  pending: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
  watch: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"),
  toggle: await world.route("campaigns/[campaignId]/foresight"),
};
const { subscribe } = await import("../src/lib/events.ts");

const druidUser = world.addUser("stars");
const druid = world.addHero({ user: druidUser, name: "Vela", class: "druid", level: 6 });
const allyUser = world.addUser("kara");
const ally = world.addHero({ user: allyUser, name: "Kara", class: "fighter", level: 6 });
// Both players are at the table: a stop never waits on an absent one.
subscribe(world.campaignId, () => {}, druidUser.id);
subscribe(world.campaignId, () => {}, allyUser.id);

const OMEN = (omen, used = 0) => ({ class: "druid", subclass: "Circle of Stars", features: [{ name: "Cosmic Omen", source: "subclass" }], resources: { sub_cosmic_omen: { max: 3, used } }, omen });
const BALANCE = (used = 0) => ({ class: "sorcerer", subclass: "Clockwork Soul", features: [{ name: "Restore Balance", source: "subclass" }], resources: { sub_restore_balance: { max: 3, used } }, omen: null });
const holder = (patch) => world.patch(druid.id, { currentHp: 40, maxHp: 40, conditions: [], feats: [], foretold: [], abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 }, proficiencies: { ...TRAINED, saves: [] }, watchingEncounterId: null, ...patch });
const used = (id) => world.sheet(druid.id).resources[id].used;
const open = () => listOpenPendingRolls(world.campaignId);
const stops = () => open().filter((pending) => pending.parkedFor === "watch");
const landed = (id) => listRecentRolls(world.campaignId, 100).find((roll) => roll.id === getPendingRoll(id).rollId);
const press = (id, body, user = druidUser, at = route.before) => {
  world.signIn(user);
  return call(at, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
const own = (args) => world.invoke("request_roll", { characterId: druid.id, kind: "ability_check", ability: "wis", dc: 5, reason: "the stars", ...args });
const toggle = (on) => {
  world.signIn(druidUser);
  return call(route.toggle, "POST", { on, characterId: druid.id }, { campaignId: world.campaignId });
};

await test("A long rest rolls the omen, even Weal and odd Woe, keeps it on the sheet and says it in the rest's line.", async () => {
  assert.deepEqual([2, 4, 6, 1, 3, 5].map(logic.omenOfFace), ["weal", "weal", "weal", "woe", "woe", "woe"]);
  holder(OMEN(null));
  const patch = longRestPatch(world.sheet(druid.id));
  assert.ok(patch.omen === "weal" || patch.omen === "woe", `the rest read ${patch.omen}`);
  holder({ resources: {}, features: [], omen: null });
  assert.equal("omen" in longRestPatch(world.sheet(druid.id)), false, "no counter, no omen");
  holder(OMEN(null, 3));
  world.dice(3);
  const out = await world.invoke("take_rest", { kind: "long" });
  world.clearDice();
  assert.equal(world.sheet(druid.id).omen, "woe", "a 3 is odd: Woe");
  assert.equal(used("sub_cosmic_omen"), 0, "the uses come back with it");
  assert.match(JSON.stringify(out), /Vela's Cosmic Omen reads Woe/);
});

await test("Weal on the druid's own check: the roll waits unthrown, and a d6 rides it for a use.", async () => {
  holder(OMEN("weal"));
  await own();
  const [pending] = open();
  assert.ok(pending, "the check waits before it is thrown");
  assert.equal(pending.parkedFor, "foretold");
  assert.equal(pending.thrown, null);
  const out = await press(pending.id, { use: "cosmic_omen" });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.match(getPendingRoll(pending.id).expression, /\+1d6$/);
  assert.equal(used("sub_cosmic_omen"), 1);
  assert.equal((await press(pending.id, { use: "cosmic_omen" })).status, 409, "once on a roll");
  world.dice(10, 4);
  await press(pending.id, { fallback: "digital" }, druidUser, route.pending);
  world.clearDice();
  assert.equal(landed(pending.id).total, 10 + 3 + 4, "the d20, Wisdom and the omen's d6");
});

await test("Woe never holds the druid's own roll, and Weal waits for nothing with the uses gone.", async () => {
  holder(OMEN("woe"));
  world.dice(10);
  await own();
  world.clearDice();
  assert.equal(open().length, 0, "Woe would only hurt the druid's own roll");
  holder(OMEN("weal", 3));
  world.dice(10);
  await own();
  world.clearDice();
  assert.equal(open().length, 0);
});

await test("Restore Balance on the sorcerer's own save with disadvantage: one d20 is thrown, for a use.", async () => {
  holder(BALANCE());
  await own({ kind: "saving_throw", ability: "wis", advantage: "disadvantage" });
  const [pending] = open();
  assert.ok(pending, "the save waits before it is thrown");
  assert.match(pending.expression, /^2d20kl1/);
  const out = await press(pending.id, { use: "restore_balance" });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const after = getPendingRoll(pending.id);
  assert.match(after.expression, /^1d20/);
  assert.equal(after.advantage, "none");
  assert.equal(used("sub_restore_balance"), 1);
  world.dice(12);
  await press(pending.id, { fallback: "digital" }, druidUser, route.pending);
  world.clearDice();
  assert.equal(landed(pending.id).total, 12 + 3);
  // A roll with no disadvantage has nothing for it to cancel on the holder's side.
  world.dice(10);
  await own({ kind: "saving_throw", ability: "wis" });
  world.clearDice();
  assert.equal(open().length, 0);
});

await test("The after-the-roll card no longer offers Restore Balance on an ally's disadvantaged save.", async () => {
  holder(BALANCE());
  world.dice(4, 15);
  await world.invoke("request_roll", { characterId: ally.id, kind: "saving_throw", ability: "wis", dc: 12, advantage: "disadvantage", reason: "the gate" });
  world.clearDice();
  const offered = open().flatMap((pending) => pending.thrown?.options ?? []).map((option) => option.id);
  assert.ok(!offered.includes("restore_balance"), `offered ${offered}`);
  for (const pending of open()) await press(pending.id, { keep: true }, allyUser, await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"));
  assert.equal(used("sub_restore_balance"), 0);
});

// ---- the watch stop, in a fight ----

await kit.fight(1, { heroFaces: { [druid.id]: 19, [ally.id]: 15 } });
const [goblin] = world.enemies();
kit.setEnemy(goblin.id, { maxHp: 400, currentHp: 400 });
kit.place(ally.id, 5, 5);
kit.place(goblin.id, 6, 5);
kit.place(druid.id, 5, 8);
const goblinTurn = (calls) => {
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === goblin.id || entry.id === goblin.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [goblin.id], acted: null } });
  model.script([reply({ calls }), reply({ text: "The goblin swings." })]);
  world.say("system", "The goblin presses in.");
  return startDmTurn(world.campaignId);
};
const attacks = () => listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack");

await test("Woe at the stop: the goblin's attack waits, and a d6 comes off its roll, for a use and the reaction.", async () => {
  holder(OMEN("woe"));
  world.patch(ally.id, { currentHp: 60, maxHp: 60, ac: 30 });
  assert.equal((await toggle(true)).status, 200);
  const before = attacks().length;
  await goblinTurn([modelCall("enemy_attack", { enemyId: goblin.id, targetCharacterId: ally.id })]);
  const [stop] = stops();
  assert.ok(stop, "the attack stops for the druid");
  assert.equal(stop.watch.power, "cosmic_omen");
  assert.equal(attacks().length, before, "no die yet");
  world.dice(15, 4);
  assert.equal((await press(stop.id, { shift: true }, druidUser, route.watch)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(getDmTurn(stop.turnId).status, "done");
  const roll = attacks().at(-1);
  assert.ok(roll, `an attack roll landed: ${JSON.stringify(model.requests.at(-1)?.messages?.filter((message) => message.role === "tool")).slice(0, 600)}`);
  assert.equal(roll.breakdown.natural, 15, "the d20 is the d20");
  assert.match(roll.expression, /-1d6$/);
  assert.equal(used("sub_cosmic_omen"), 1);
  assert.ok(world.encounter().reactionsUsed.includes(druid.id), "the reaction is spent");
  assert.match(JSON.stringify(model.requests.at(-1)), /used Cosmic Omen \(Woe\)/, "the model narrates from it");
  await toggle(false);
});

await test("Restore Balance at the stop: an attack with advantage is thrown with one d20; one with none costs nothing.", async () => {
  holder(BALANCE());
  assert.equal((await toggle(true)).status, 200);
  await goblinTurn([modelCall("enemy_attack", { enemyId: goblin.id, targetCharacterId: ally.id, advantage: "advantage", advantageSource: "other", advantageReason: "the goblin stands on higher ground" })]);
  let [stop] = stops();
  assert.equal(stop?.watch.power, "restore_balance");
  world.dice(3, 18);
  await press(stop.id, { shift: true }, druidUser, route.watch);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(attacks().at(-1).breakdown.natural, 3, "the first d20 alone");
  assert.equal(used("sub_restore_balance"), 1);
  await goblinTurn([modelCall("enemy_attack", { enemyId: goblin.id, targetCharacterId: ally.id })]);
  [stop] = stops();
  assert.ok(stop);
  world.dice(9);
  await press(stop.id, { shift: true }, druidUser, route.watch);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(attacks().at(-1).breakdown.natural, 9);
  assert.equal(used("sub_restore_balance"), 1, "no edge to cancel, so nothing is paid");
  await toggle(false);
});

await test("The GM's use_resource of either once the roll is on record is refused, nothing spent: they are used before the roll, at the watch.", async () => {
  for (const [patch, name, id] of [[BALANCE(), "Restore Balance", "sub_restore_balance"], [OMEN("woe"), "Cosmic Omen", "sub_cosmic_omen"]]) {
    holder(patch);
    const encounter = world.encounter();
    saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.enemyId === goblin.id || entry.id === goblin.id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [goblin.id], acted: null } });
    world.dice(15, 3, 1);
    const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: ally.id, advantage: "advantage", advantageSource: "other", advantageReason: "the goblin stands on higher ground" });
    world.clearDice();
    assert.equal(swing.ok, true, swing.error);
    const out = await world.invoke("use_resource", { characterId: druid.id, resource: name });
    assert.equal(out.ok ?? false, false, `${name} after the roll: ${JSON.stringify(out).slice(0, 200)}`);
    assert.match(String(out.error), /before the roll/);
    assert.match(String(out.error), /Watch/);
    assert.match(String(out.error), /Nothing was spent/);
    assert.equal(used(id), 0, `${name}: no use spent`);
    assert.ok(!world.encounter().reactionsUsed.includes(druid.id), `${name}: no reaction spent`);
  }
});

// ---- the Watch toggle out of a fight ----

await test("Out of a fight the toggle holds an ally's check for the druid's Weal; off, it is thrown at once.", async () => {
  await kit.endFight();
  holder(OMEN("weal"));
  assert.equal((await toggle(true)).status, 200);
  assert.equal(world.sheet(druid.id).watchingEncounterId, logic.TABLE_WATCH);
  model.script([reply({ calls: [modelCall("request_roll", { characterId: ally.id, kind: "ability_check", ability: "str", dc: 30, reason: "the gate" })] }), reply({ text: "The gate holds." })]);
  world.say("system", "Kara heaves at the gate.");
  await startDmTurn(world.campaignId);
  const [stop] = stops();
  assert.ok(stop, "the check stops for the druid");
  assert.equal(stop.watch.power, "cosmic_omen");
  world.dice(11, 5);
  assert.equal((await press(stop.id, { shift: true }, druidUser, route.watch)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  for (const pending of open()) await press(pending.id, { keep: true }, allyUser, await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"));
  const check = listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "ability_check").at(-1);
  assert.match(check.expression, /\+1d6$/);
  assert.equal(used("sub_cosmic_omen"), 1);
  assert.equal((await toggle(false)).status, 200);
  model.script([reply({ calls: [modelCall("request_roll", { characterId: ally.id, kind: "ability_check", ability: "str", dc: 30, reason: "the gate" })] }), reply({ text: "It holds." })]);
  world.say("system", "Kara tries again.");
  world.dice(11);
  await startDmTurn(world.campaignId);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(stops().length, 0, "the toggle off, nothing stops");
});

finish();
