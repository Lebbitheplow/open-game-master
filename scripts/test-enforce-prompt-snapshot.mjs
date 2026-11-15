// A narrator's first messages kept on its own disk and put back instead of
// read again (src/lib/dm/prompt-snapshot.ts).
//
// A turn's first message holds the rules and the tools, and llama.cpp reads
// the whole prompt again when it changes: a fight's start and end, the first
// turn after the server restarts. On a BC-250 that was 33K to 42K tokens, 80
// to 125 seconds each, and more than half of all the time its narrator spent
// in a measured session (2026-11-14). A llama-server started with
// --slot-save-path saves a slot's prompt to a file and restores it in
// seconds. Real turns here, against a fake one that keeps what it was asked:
//   - a server that offers no slot actions is called as it always was;
//   - one that does has the table's turns pinned to a slot and the claims
//     reader to another, each first message saved once, and restored before
//     the call that needs it: a fight's end, the next fight's start, a server
//     restart;
//   - a snapshot the server lost, or one that turned out not to be reused,
//     is written again.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, held, reply, settleQueue } from "./lib/enforce-narrator.mjs";

// The suites' setup turns the warm-up off; a first message is saved where one
// would be sent ahead.
process.env.DM_TURN_WARMUP = "1";

const { test, finish } = suite("test-enforce-prompt-snapshot");
const { fileToWrite, helperSlotFor, slotActionsOffered, slotIsEmpty, snapshotFileName, turnSlotFor, withEntry, withoutFile, SNAPSHOT_FILES } =
  await import("../src/lib/dm/prompt-snapshot-logic.ts");

// ---- the choices, on their own ----

await test("A table's turns take one slot and everything else the server's last; one slot is shared.", () => {
  assert.equal(turnSlotFor(1, 0), 0);
  assert.equal(helperSlotFor(1), null);
  assert.deepEqual([turnSlotFor(2, 0), turnSlotFor(2, 1), helperSlotFor(2)], [0, 0, 1]);
  assert.deepEqual([turnSlotFor(4, 0), turnSlotFor(4, 1), turnSlotFor(4, 2), turnSlotFor(4, 3), helperSlotFor(4)], [0, 1, 2, 0, 3]);
});

await test("A first message is saved to the file that holds it, else an unused name, else the one used longest ago; one entry per file and per first message.", () => {
  const name = (index) => snapshotFileName("ogm-ab", index);
  assert.equal(fileToWrite([], "k1", "ogm-ab"), name(0));
  let entries = [{ file: name(0), key: "k1", at: 5 }];
  assert.equal(fileToWrite(entries, "k1", "ogm-ab"), name(0));
  assert.equal(fileToWrite(entries, "k2", "ogm-ab"), name(1));
  entries = Array.from({ length: SNAPSHOT_FILES }, (_, index) => ({ file: name(index), key: `k${index}`, at: 10 + index }));
  entries[2].at = 1;
  assert.equal(fileToWrite(entries, "new", "ogm-ab"), name(2), "the file used longest ago is the one written over");
  const next = withEntry(entries, { file: name(2), key: "new", at: 99 });
  assert.equal(next.length, SNAPSHOT_FILES);
  assert.ok(!next.some((entry) => entry.key === "k2"), "the first message the file held is still listed");
  assert.equal(withoutFile(next, name(2)).length, SNAPSHOT_FILES - 1);
});

await test("A server says it saves slots by refusing an unknown action by name; a slot that has read nothing means the server restarted.", () => {
  assert.equal(slotActionsOffered(400, '{"error":{"code":400,"message":"Invalid action"}}'), true);
  assert.equal(slotActionsOffered(501, '{"error":{"message":"This server does not support slots action. Start it with `--slot-save-path`"}}'), false);
  assert.equal(slotActionsOffered(404, "Not Found"), false);
  assert.equal(slotIsEmpty([{ id: 0, id_task: -1, n_prompt_tokens: 0 }], 0), true);
  assert.equal(slotIsEmpty([{ id: 0, id_task: 12, n_prompt_tokens: 31000 }, { id: 1, id_task: -1 }], 0), false);
  assert.equal(slotIsEmpty(null, 0), false, "a server that does not list its slots is taken at the app's word");
});

// ---- real turns ----

const hero = (world, name) =>
  world.addHero({ name, class: "fighter", level: 1, maxHp: 10, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });

await test("A server that offers no slot actions is called as it always was: no slot named, nothing saved.", async () => {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const plain = await fakeModel();
  plain.pointAt(world);
  const brom = hero(world, "Brom");
  plain.script([reply({ text: "The road runs on under a grey sky." })]);
  await plain.turn(world, "I walk on.", brom.id, brom.userId);
  await settleQueue(world.campaignId);
  assert.ok(plain.requests.length >= 1);
  assert.ok(plain.requests.every((request) => request.id_slot === undefined), "a server that never offered slots was sent id_slot");
  plain.close();
});

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const alden = hero(world, "Alden Veyr");
const model = await fakeModel({ slots: 2 });
model.pointAt(world);

const head = (request) => request.messages[0].content;
const sentAhead = (request) => request.messages.length === 2 && /The table is reading/.test(String(request.messages[1].content));
// Past the turn's end, the check the table's events schedule after it, any
// warm-up, and a save posted as the turn ended.
const quiet = async () => {
  await settleQueue(world.campaignId);
  let seen = -1;
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    if (!globalThis.__odmTurnHeadChecks?.size && !globalThis.__odmTurnWarmups?.size && seen === model.slotLog.length) {
      break;
    }
    seen = model.slotLog.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
};
const actions = () => model.slotLog.map((entry) => `${entry.action}:${entry.slot}:${entry.after}${entry.ok ? "" : ":refused"}`);
const fresh = () => {
  model.slotLog.length = 0;
};
// A fight begun by the model with the goblin quicker than Alden: the call
// after the start plays the goblin, held until the fight exists.
async function ambush(name) {
  const attack = held(reply());
  world.dice(20, 1);
  model.script([
    reply({ calls: [call("start_encounter", { enemies: [{ monster: "goblin", name }], distanceFeet: 5 })] }),
    attack.entry,
    reply({ text: "The goblin's blade whistles past Alden's ear." }),
  ]);
  const turn = model.turn(world, "I climb into the loft.", alden.id, alden.userId);
  const until = Date.now() + 10_000;
  while (model.requests.length < 2 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const [goblin] = world.enemies();
  assert.ok(goblin, "no fight started");
  attack.entry.calls = [call("enemy_attack", { enemyId: goblin.id, targetCharacterId: alden.id })];
  world.clearDice();
  world.dice(2);
  attack.release();
  await turn;
  world.clearDice();
  await quiet();
  return goblin;
}

let calm = "";
let fighting = "";
let calmFile = "";
let fightFile = "";

await test("A table's turns are pinned to a slot and the claims reader to another; a first message is saved once, when the turn that read it ends.", async () => {
  model.script([reply({ text: "The barn door hangs open on one hinge." })]);
  await model.turn(world, "I look the barn over.", alden.id, alden.userId);
  await quiet();
  const turnCalls = model.requests.filter((request) => !sentAhead(request));
  assert.ok(turnCalls.length >= 1);
  assert.ok(model.requests.every((request) => request.id_slot === 0), `a turn's call went to another slot: ${model.requests.map((request) => request.id_slot)}`);
  assert.ok(model.readerRequests.length >= 1, "the claims reader read nothing");
  assert.ok(model.readerRequests.every((request) => request.id_slot === 1), "the claims reader was not sent to the helper slot");
  assert.deepEqual(actions().map((line) => line.split(":").slice(0, 2).join(":")), ["save:0"], "the first message was not saved once");
  calm = head(turnCalls[0]);
  calmFile = model.slotLog[0].file;

  fresh();
  model.script([reply({ text: "Swallows wheel out of the rafters." })]);
  await model.turn(world, "I step inside.", alden.id, alden.userId);
  await quiet();
  assert.deepEqual(actions(), [], "a first message the slot holds, with a snapshot, was saved or restored again");
});

await test("A fight's first message is read once and saved; the fight's end, and the next fight's start, restore instead of reading.", async () => {
  fresh();
  const goblin = await ambush("Loft Goblin");
  const [, played] = model.requests;
  fighting = head(played);
  assert.notEqual(fighting, calm);
  // Read once (nothing to restore yet), saved to a file of its own after.
  assert.equal(model.slotLog.filter((entry) => entry.action === "restore").length, 0);
  const saves = model.slotLog.filter((entry) => entry.action === "save");
  assert.equal(saves.length, 1, `the fight's first message was saved ${saves.length} times`);
  fightFile = saves[0].file;
  assert.notEqual(fightFile, calmFile, "the fight's snapshot was written over the other one");

  // Alden's blow ends the fight: the call after it has the first message of
  // no fight, restored from its snapshot before the call goes.
  fresh();
  kit.setEnemy(goblin.id, { maxHp: 3, currentHp: 3 });
  kit.place(alden.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  world.dice(15, 4);
  model.script([
    reply({ calls: [call("pc_attack", { characterId: alden.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
    reply({ text: "The goblin folds over the blade and is still." }),
  ]);
  await model.turn(world, "I run it through.", alden.id, alden.userId);
  world.clearDice();
  await quiet();
  assert.equal(world.encounter(), null, "the fight did not end");
  assert.equal(head(model.requests[1]), calm);
  assert.deepEqual(actions(), ["restore:0:1"], "the first message of no fight was not restored before the call after the fight");
  assert.equal(model.slotLog[0].file, calmFile);

  // The next fight starts from the fight's snapshot.
  fresh();
  await ambush("Rafter Goblin");
  assert.equal(head(model.requests[1]), fighting);
  assert.deepEqual(actions(), ["restore:0:1"], "the next fight's first message was read again, or saved again");
  assert.equal(model.slotLog[0].file, fightFile);
});

await test("A fight that ends between turns has the next turn's first message restored ahead, and a restarted server gets it back before the turn's first call.", async () => {
  fresh();
  model.script([]);
  await kit.endFight();
  await quiet();
  assert.deepEqual(model.slotLog.map((entry) => `${entry.action}:${entry.file}`), [`restore:${calmFile}`]);
  assert.ok(model.requests.length <= 1 && model.requests.every(sentAhead), "more than the one short request went out between turns");

  // The server was restarted: its slots are empty, whatever the app last sent.
  fresh();
  model.slots.restart();
  model.script([reply({ text: "Dust hangs in the light from the loft door." })]);
  await model.turn(world, "I catch my breath.", alden.id, alden.userId);
  await quiet();
  assert.equal(head(model.requests[0]), calm);
  assert.deepEqual(actions(), ["restore:0:0"], "a restarted server was left to read the prompt again");
});

await test("A snapshot the server lost, or one a call did not reuse, is written again.", async () => {
  // Lost: the restore is refused, the call goes on, and the turn's end saves.
  fresh();
  model.slots.loseFiles();
  model.slots.restart();
  model.script([reply({ text: "A cart rattles past outside." })]);
  await model.turn(world, "I listen.", alden.id, alden.userId);
  await quiet();
  assert.deepEqual(actions(), ["restore:0:0:refused", "save:0:1"]);

  // Not reused: the restored file held another prompt after all.
  fresh();
  model.slots.restart();
  model.slots.cached = 0;
  model.script([reply({ text: "The cart's rattle fades down the lane." })]);
  await model.turn(world, "I wait.", alden.id, alden.userId);
  model.slots.cached = 20_000;
  await quiet();
  assert.deepEqual(actions(), ["restore:0:0", "save:0:1"], "a snapshot no call reused was kept");
});

process.env.DM_TURN_WARMUP = "0";
model.close();
finish();
