// A pointer move held for a watch stop (src/lib/dm/turn-hold.ts). The saves a
// move rolls (a character's end-of-turn save against a hold, the death saves
// of the dying whose turns it starts) had no stop: Portent is chosen "before
// the roll" (SRD 5.1), and the move rolled them as End Turn was pressed. Now
// End Turn is in at once, the pointer stays, the ending character acts no
// more, and the move runs when the stop is answered, at its time limit, or
// after a restart. Nothing waits when nobody could answer, nor when the only
// watcher is the one ending their turn.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-turn-hold");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { listOpenPendingRolls, publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { releaseWatchWhenDue } = await import("../src/lib/dm/foresight-release.ts");
const { endTurnRefusal } = await import("../src/lib/dm/encounter-tools.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const route = {
  toggle: await world.route("campaigns/[campaignId]/foresight"),
  watch: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"),
  endTurn: await world.route("campaigns/[campaignId]/encounter/end-turn"),
};
const seerUser = world.addUser("seer");
(await import("../src/lib/events.ts")).subscribe(world.campaignId, () => {}, seerUser.id);
const seer = world.addHero({ user: seerUser, name: "Seer", class: "wizard", level: 5 });
const karaUser = world.addUser("kara");
const kara = world.addHero({ user: karaUser, name: "Kara", class: "fighter", level: 5 });
const tovUser = world.addUser("tov");
const tov = world.addHero({ user: tovUser, name: "Tov", class: "fighter", level: 5 });
const stops = () => listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "watch");
const answer = (id, body, user = seerUser) => {
  world.signIn(user);
  return call(route.watch, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
const watch = (on, user = seerUser, characterId = seer.id) => {
  world.signIn(user);
  return call(route.toggle, "POST", { on, characterId }, { campaignId: world.campaignId });
};
const pressEndTurn = (user = karaUser) => {
  world.signIn(user);
  return call(route.endTurn, "POST", {}, { campaignId: world.campaignId });
};
const FRIGHT = { frightened: { spell: "Fear", source: "a caster", saveEnds: { ability: "wis", dc: 15 } } };
const arm = () => {
  world.patch(seer.id, { currentHp: 30, maxHp: 30, conditions: [], conditionMeta: {}, resources: { sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] });
  world.patch(kara.id, { currentHp: 44, maxHp: 44, conditions: ["frightened"], conditionMeta: FRIGHT, deathSaves: null });
  world.patch(tov.id, { currentHp: 44, maxHp: 44, conditions: [], conditionMeta: {}, deathSaves: null });
};
// The order: Kara, then Tov, then the goblin; the floor on Kara.
const karaUp = () => {
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((each) => (each.kind === "pc" ? each.characterId : each.enemyId) === id);
  saveEncounter({ ...encounter, order: [entry(kara.id), entry(tov.id), entry(seer.id), entry(goblin.id)], turnIndex: 0, turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: undefined, walked: [], walkedHolds: undefined, heldMove: undefined } });
};
const on = () => kit.current()?.characterId;

let goblin;
await test("A turn ending with a save a watcher could answer is held: the pointer stays, the turn takes nothing more, and the stop says why.", async () => {
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [tov.id]: 15, [seer.id]: 12 } });
  [goblin] = world.enemies();
  arm();
  assert.equal((await watch(true)).status, 200);
  karaUp();
  const pressed = await pressEndTurn();
  assert.equal(pressed.status, 200);
  assert.equal(pressed.json?.held, true, JSON.stringify(pressed.json));
  assert.equal(on(), kara.id, "the pointer stays on Kara");
  const [stop] = stops();
  assert.ok(stop, "the move's stop is open");
  assert.match(stop.reason, /Kara's turn is ending: Kara is about to make a saving throw\./);
  assert.equal(activePublicEncounter(world.campaignId).turnHeld?.characterId, kara.id, "every view reads the held turn");
  const dodged = await world.invoke("take_action", { characterId: kara.id, action: "dodge" });
  assert.match(String(dodged.error ?? ""), /turn is ending/, "the ended turn takes nothing more");
  assert.equal((await pressEndTurn()).status, 409, "End Turn again is refused");
  assert.match(endTurnRefusal(world.campaignId, karaUser.id), /turn is ending/);
});

await test("Answered, the move runs with the number on the save's d20, the number is paid for, and the next turn begins.", async () => {
  const [stop] = stops();
  assert.equal((await answer(stop.id, { value: 17 })).status, 200);
  await settleQueue(world.campaignId);
  assert.equal(on(), tov.id, "the next turn has begun");
  assert.equal(activePublicEncounter(world.campaignId).turnHeld, undefined, "nothing reads held now");
  assert.ok(!world.sheet(kara.id).conditions.includes("frightened"), "17 shakes off the fear");
  assert.deepEqual(world.sheet(seer.id).foretold, [3], "the 17 is spent");
});

await test("At the time limit the move goes ahead, and nothing is spent.", async () => {
  arm();
  karaUp();
  assert.equal((await pressEndTurn()).json?.held, true);
  const [stop] = stops();
  releaseWatchWhenDue(stop.id);
  await settleQueue(world.campaignId);
  assert.equal(on(), tov.id);
  assert.deepEqual(world.sheet(seer.id).foretold, [17, 3]);
});

await test("A restart lets the stop go and runs the move.", async () => {
  arm();
  karaUp();
  assert.equal((await pressEndTurn()).json?.held, true);
  const { recoverDmAfterRestart } = await import("../src/lib/dm/restart-recovery.ts");
  globalThis.__odmDmRecovered = false;
  recoverDmAfterRestart();
  await settleQueue(world.campaignId);
  assert.equal(stops().length, 0);
  assert.equal(on(), tov.id, "the move ran");
});

await test("Nothing waits when nobody watching could answer, nor when the only watcher is the one ending their turn.", async () => {
  arm();
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  karaUp();
  const plain = await pressEndTurn();
  assert.equal(plain.status, 200);
  assert.equal(plain.json?.held, undefined, "no save to answer: an ordinary End Turn");
  assert.equal(on(), tov.id);
  // The seer's own turn, with a save of their own to make.
  arm();
  world.patch(seer.id, { conditions: ["frightened"], conditionMeta: FRIGHT });
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => entry.characterId === seer.id), turnBudget: null, legendary: { ...encounter.legendary, due: undefined, walked: [], walkedHolds: undefined, heldMove: undefined } });
  const own = await pressEndTurn(seerUser);
  assert.equal(own.status, 200);
  assert.equal(own.json?.held, undefined, "their own watch never holds their own turn's end");
  assert.equal(stops().length, 0);
});

await test("A death save the move rolls is stopped for, and a foretold 20 lands on it.", async () => {
  arm();
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  world.patch(tov.id, { currentHp: 0, conditions: ["unconscious"], conditionMeta: {}, deathSaves: { successes: 0, failures: 0 } });
  world.patch(seer.id, { foretold: [20, 3] });
  karaUp();
  assert.equal((await pressEndTurn()).json?.held, true, "Tov's death save is the move's");
  const [stop] = stops();
  assert.match(stop.reason, /Tov is about to make a saving throw/);
  assert.deepEqual(publicPendingRoll(stop).watch.choices.map((choice) => choice.name), ["Tov"]);
  assert.equal((await answer(stop.id, { value: 20 })).status, 200);
  await settleQueue(world.campaignId);
  assert.equal(world.sheet(tov.id).currentHp, 1, "a natural 20 on the death save: back on their feet with 1 hit point");
  assert.deepEqual(world.sheet(seer.id).foretold, [3]);
});

await test("The AI's end_turn stops for the move's saves too, before the call moves the pointer.", async () => {
  arm();
  karaUp();
  model.script([reply({ calls: [modelCall("end_turn", { characterId: kara.id })] }), reply({ text: "Kara steps back." })]);
  await model.turn(world, "I end my turn.", kara.id, karaUser.id);
  const [stop] = stops();
  assert.ok(stop, "the end_turn call stops");
  assert.match(stop.reason, /Kara's turn is ending/);
  assert.equal(on(), kara.id, "not moved yet");
  assert.equal((await answer(stop.id, { value: 17 })).status, 200);
  await settleQueue(world.campaignId);
  assert.notEqual(on(), kara.id, "the call moved it");
  assert.ok(!world.sheet(kara.id).conditions.includes("frightened"));
  assert.deepEqual(world.sheet(seer.id).foretold, [3]);
});

model.close();
finish();
world.close();
