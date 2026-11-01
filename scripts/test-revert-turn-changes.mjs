// "Revert this turn" takes back what the issue 685 work lets a turn change
// beyond the sheets and the clock (src/lib/db/turn-changes.ts), the way it
// already takes back the sheets and the clock (issue #622):
//   - a prepared fight's event that fired in the turn is armed again, and
//     what it did is undone: the hurt, the condition, the reveal, the
//     reinforcements, the change of ground and whoever it moved; its line in
//     the chronicle says it was taken back, and the storyteller no longer
//     hears it as done. Fired by a player's End Turn, where no turn runs, it
//     is a turn of its own the lead can revert. A later change to what it
//     touched is asked about first, as a later sheet change is;
//   - a test table's forced dice the turn spent go back in the queue where
//     they stood, and the seed back where the turn found it, so the turn
//     played again rolls the same;
//   - a card the GM resolved as played goes back to "Waiting on you";
//   - the test fight's turn trace reads the reverted turn as taken back;
//   - the event log offers the revert for such a turn, and lists what it kept.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-revert-turn-changes");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { deployTemplate } = await import("../src/lib/dm/encounter-templates.ts");
const { listRecentMessages, getCampaignMessage } = await import("../src/lib/db/messages.ts");
const { getBattleMapForEncounter, getTokenByRef, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { listFightEvents } = await import("../src/lib/db/fight-events.ts");
const { firedEventsBlock } = await import("../src/lib/dm/fight-events.ts");
const { getEnemy } = await import("../src/lib/db/encounters.ts");
const { createPreparedMap } = await import("../src/lib/db/prepared-maps.ts");
const { blocksMove } = await import("../src/lib/battlemap/types.ts");
const { listLiveTurnChangeViews, liveTurnChanges } = await import("../src/lib/db/turn-changes.ts");
const { listNotesVisibleTo } = await import("../src/lib/db/notes.ts");
const scripts = await import("../src/lib/db/dice-scripts.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { runInUsageScope } = await import("../src/lib/usage/scope.ts");
const { turnTracePage } = await import("../src/lib/dm/turn-trace.ts");
const { setDmMode, setFloor } = await import("../src/lib/db/campaigns.ts");
const { initiativeFloorFor } = await import("../src/lib/dm/encounter-tools.ts");
const { queuedIntents } = await import("../src/lib/dm/intent-queue.ts");
const { buildFeed, revertableTurns } = await import("../src/app/campaigns/[campaignId]/event-log-logic.ts");
const { planTakeBack } = await import("../src/lib/dm/fight-event-undo-logic.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");

const MAP = { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null };

async function revertTurn(world, turnId, confirm = false) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/audit/revert-turn");
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, ...(confirm ? { confirm: true } : {}) }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

async function snapshot(world) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]");
  const response = await handler.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  return response.json();
}

const tableLines = (world) =>
  listRecentMessages(world.campaignId, 400)
    .filter((message) => message.authorType === "system")
    .map((message) => message.content);
const standing = (lines, text) => lines.filter((line) => line.includes(text) && !line.startsWith("Taken back: ")).length;
const slotsOf = (world) => listFightEvents(world.encounter().id)[0]?.slots ?? {};
const eventOf = (world, kind) => listFightEvents(world.encounter().id).find((entry) => entry.event.trigger.kind === kind);
const boardOf = (world) => getBattleMapForEncounter(world.encounter().id);

// The foes' one initiative die, then the hero's: by default the hero goes
// first.
async function deploy(world, name, extras, map = MAP, enemies = [{ monster: "goblin", count: 3 }], faces = [1, 20]) {
  const template = insertEncounterTemplate({ campaignId: world.campaignId, name, enemies, battlefield: "", map, notes: "", extras, createdByUserId: world.owner.id });
  world.clearDice();
  world.dice(...faces);
  const outcome = await deployTemplate(world.campaign(), world.owner.id, template);
  world.clearDice();
  assert.equal(outcome.ok, true, outcome.error);
  return template;
}

// ---- a table a person runs ----

const person = await openWorld({ gameSettings: { dmMode: "human" } });
const kit = await combatKit(person);
const hero = person.addHero({ user: person.addUser(), class: "fighter", level: 5, maxHp: 300 });

// Grak the boss (slot 0); a goblin the plan wounds and fells (slot 1); a
// third the GM keeps unseen until Grak falls (slot 2). At round 2 two more
// come in where the party did.
const PLAN = {
  overrides: [{ slot: 0, name: "Grak", hp: 20 }],
  hidden: [2],
  entry: { x: 2, y: 2 },
  events: [
    {
      trigger: { kind: "falls", slot: 0 },
      actions: [
        { kind: "hurt", slot: 1, to: "hp", hp: 2 },
        { kind: "condition", slot: 1, condition: "prone", remove: false },
        { kind: "visibility", slot: 2, hidden: false },
        { kind: "say", text: "The rope bridge gives way." },
      ],
    },
    { trigger: { kind: "round", round: 2 }, actions: [{ kind: "reinforce", enemies: [{ monster: "goblin", count: 2 }], at: "entry" }, { kind: "say", text: "Horns sound from the ridge." }] },
  ],
};

await deploy(person, "The rope bridge", PLAN);
const slots = slotsOf(person);
const wounded = getEnemy(slots[1]);
const lurkerToken = () => getTokenByRef(boardOf(person).id, slots[2]);

await test("a boss falling in a console call fires its event under that call's turn, and reverting the turn takes the hurt, the condition and the reveal back, says so in the chronicle and arms the event again", async () => {
  assert.equal(lurkerToken().hidden, true);
  const felled = await person.invoke("damage_enemy", { enemyId: slots[0], amount: 100 });
  assert.equal(felled.ok, true, felled.error);
  assert.equal(getEnemy(slots[1]).currentHp, 2);
  assert.ok(getEnemy(slots[1]).conditions.includes("prone"));
  assert.equal(lurkerToken().hidden, false);
  assert.match(firedEventsBlock(person.campaignId), /The rope bridge gives way\./);
  const kept = liveTurnChanges(person.campaignId, felled.turnId);
  assert.deepEqual(kept.map((change) => change.kind), ["fight_event"], "the event was not kept under the call's turn");
  // The event log lists the turn with the event's line, and offers its revert
  // though the turn changed no sheet.
  const listed = (await snapshot(person)).turnChanges.filter((change) => change.turnId === felled.turnId);
  assert.equal(listed.length, 1);
  assert.match(listed[0].line, /The rope bridge gives way\./);

  const back = await revertTurn(person, felled.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.ok(back.json.takenBack >= 1, JSON.stringify(back.json));
  const goblin = getEnemy(slots[1]);
  assert.equal(goblin.currentHp, wounded.currentHp, "the plan's wound stayed");
  assert.ok(!goblin.conditions.includes("prone"), "the plan's prone stayed");
  assert.equal(lurkerToken().hidden, true, "the ambusher stayed in view");
  assert.equal(eventOf(person, "falls").firedAt, null, "the event was not armed again");
  assert.doesNotMatch(firedEventsBlock(person.campaignId), /rope bridge/, "the storyteller still hears the event as done");
  const lines = tableLines(person);
  assert.ok(lines.some((line) => line.startsWith("Taken back: ") && line.includes("The rope bridge gives way.")), lines.join(" | "));
  assert.equal(standing(lines, "The rope bridge gives way."), 0, "the chronicle still reads the event as standing");
  assert.equal((await snapshot(person)).turnChanges.some((change) => change.turnId === felled.turnId), false, "the log offers the turn back twice");
});

await test("armed again, the event fires when its moment comes round: Grak is still down, so the next call fires it, once", async () => {
  const next = await person.invoke("damage_enemy", { enemyId: slots[1], amount: 1 });
  assert.equal(next.ok, true, next.error);
  assert.equal(getEnemy(slots[1]).currentHp, 2);
  assert.ok(getEnemy(slots[1]).conditions.includes("prone"));
  assert.equal(lurkerToken().hidden, false);
  assert.equal(standing(tableLines(person), "The rope bridge gives way."), 1);
});

await test("a creature the event touched and a later turn changed again is asked about first, as a later sheet change is, and goes back on yes", async () => {
  const fired = listLiveTurnChangeViews(person.campaignId).find((change) => /rope bridge/.test(change.line));
  const later = await person.invoke("damage_enemy", { enemyId: slots[1], amount: 1 });
  assert.equal(later.ok, true, later.error);
  // A condition gained since stays where the event's own is taken off.
  const poisoned = await person.invoke("set_enemy_condition", { enemyId: slots[1], condition: "poisoned" });
  assert.equal(poisoned.ok, true, poisoned.error);
  const asked = await revertTurn(person, fired.turnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /hit points have changed since/.test(line)), JSON.stringify(asked.json));
  const done = await revertTurn(person, fired.turnId, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  const goblin = getEnemy(slots[1]);
  assert.equal(goblin.currentHp, wounded.currentHp - 1, "the hit points the event found were not put back");
  assert.ok(!goblin.conditions.includes("prone"));
  assert.ok(goblin.conditions.includes("poisoned"), "a condition gained since was taken too");
});

await test("reinforcements a player's End Turn brought in are a turn of their own: reverting it takes them out of the fight and off the board, and the event waits again", async () => {
  // Grak's fall fires again on the way; only the round's event is read here.
  const before = person.enemies().map((enemy) => enemy.id);
  for (let step = 0; step < 8 && person.encounter().round < 2; step += 1) {
    kit.endTurn(hero.userId);
  }
  assert.equal(person.encounter().round, 2, "the fight never reached round 2");
  const arrivals = person.enemies().filter((enemy) => !before.includes(enemy.id));
  assert.equal(arrivals.length, 2, `enemies: ${person.enemies().map((enemy) => enemy.displayName)}`);
  const fired = listLiveTurnChangeViews(person.campaignId).find((change) => /Horns sound/.test(change.line));
  assert.ok(fired, "the reinforcements were kept under no turn");

  const back = await revertTurn(person, fired.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  for (const enemy of arrivals) {
    assert.equal(getEnemy(enemy.id), null, `${enemy.displayName} is still in the fight`);
    assert.equal(getTokenByRef(boardOf(person).id, enemy.id), null, `${enemy.displayName} is still on the board`);
    assert.ok(!person.encounter().order.some((entry) => entry.kind === "enemy" && entry.enemyId === enemy.id), `${enemy.displayName} still has a turn`);
  }
  assert.deepEqual(person.enemies().map((enemy) => enemy.id).sort(), [...before].sort());
  assert.equal(eventOf(person, "round").firedAt, null);
  assert.equal(standing(tableLines(person), "Horns sound from the ridge."), 0);
  // Round 2 still stands, so the next call brings them in again, once.
  const next = await person.invoke("damage_enemy", { enemyId: slots[1], amount: 1 });
  assert.equal(next.ok, true, next.error);
  assert.equal(person.enemies().length, before.length + 2);
  assert.equal(standing(tableLines(person), "Horns sound from the ridge."), 1);
  await person.invoke("end_encounter", { outcome: "truce" });
});

// ---- the ground changes, and changes back ----

const WIDTH = 12;
const HEIGHT = 10;
function gorge() {
  let terrain = "";
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      terrain += x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? "#" : x === 6 && y !== 4 && y !== 5 ? "|" : ".";
    }
  }
  return terrain;
}
const bridgeMap = createPreparedMap({ campaignId: person.campaignId, name: "The gorge", width: WIDTH, height: HEIGHT, terrain: gorge(), ambient: "bright", theme: "field", seed: 4242 });

await test("a bridge the boss's fall dropped comes back with the turn's revert, and the goblins it pushed clear stand on it again", async () => {
  await deploy(
    person,
    "The gorge",
    {
      overrides: [{ slot: 0, name: "Grak" }],
      placements: [{ slot: 0, x: 9, y: 2 }, { slot: 1, x: 6, y: 4 }, { slot: 2, x: 6, y: 5 }],
      hidden: [2],
      entry: { x: 2, y: 4 },
      events: [{ trigger: { kind: "falls", slot: 0 }, actions: [{ kind: "ground", tiles: [{ x: 6, y: 4 }, { x: 6, y: 5 }], terrain: "lowwall" }, { kind: "say", text: "The bridge falls." }] }],
    },
    { ...MAP, mapId: bridgeMap.id },
  );
  const gorgeSlots = slotsOf(person);
  assert.equal(boardOf(person).drawnTerrain, bridgeMap.terrain, "the fight is not on its prepared map");
  const felled = await person.invoke("damage_enemy", { enemyId: gorgeSlots[0], amount: 100 });
  assert.equal(felled.ok, true, felled.error);
  assert.notEqual(boardOf(person).drawnTerrain, bridgeMap.terrain, "the bridge never fell");
  const pushed = getTokenByRef(boardOf(person).id, gorgeSlots[1]);
  assert.notDeepEqual([pushed.x, pushed.y], [6, 4]);

  const back = await revertTurn(person, felled.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const board = boardOf(person);
  assert.equal(board.drawnTerrain, bridgeMap.terrain, "the bridge did not come back");
  const onBridge = getTokenByRef(board.id, gorgeSlots[1]);
  const under = getTokenByRef(board.id, gorgeSlots[2]);
  assert.deepEqual([onBridge.x, onBridge.y, under.x, under.y], [6, 4, 6, 5], "the goblins were not put back where they stood");
  for (const token of listTokens(board.id)) {
    assert.equal(blocksMove(board.terrain[token.y * WIDTH + token.x]), false, `${token.name} stands in a wall`);
  }
  assert.equal(eventOf(person, "falls").firedAt, null);
  await person.invoke("end_encounter", { outcome: "truce" });
});

await test("what an event could not do goes with its revert: the GM's note of it is not left to be written twice", async () => {
  // The hurt names a slot the roster never filled.
  await deploy(person, "Two goblins", { events: [{ trigger: { kind: "round", round: 1 }, actions: [{ kind: "hurt", slot: 2, to: "half" }, { kind: "say", text: "Dust drifts down." }] }] }, MAP, [{ monster: "goblin", count: 2 }]);
  const notes = () => listNotesVisibleTo(person.campaignId, person.owner.id, true).filter((note) => /what an event could not do/.test(note.title) && /Two goblins/.test(note.title));
  assert.equal(notes().length, 1, "the refusal was not noted");
  const fired = listLiveTurnChangeViews(person.campaignId).find((change) => /Dust drifts down/.test(change.line));
  const back = await revertTurn(person, fired.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(notes().length, 0, "the refusal's note stayed");
  await person.invoke("end_encounter", { outcome: "truce" });
});

// ---- a table the AI runs ----

const ai = await openWorld({ gameSettings: { dmMode: "ai" } });
const aiHero = ai.addHero({ class: "fighter", level: 5, maxHp: 300 });
insertEncounterTemplate({
  campaignId: ai.campaignId,
  name: "Goblins at the ford",
  enemies: [{ monster: "goblin", count: 2 }],
  battlefield: "a shallow ford",
  map: MAP,
  notes: "",
  extras: { events: [{ trigger: { kind: "start" }, actions: [{ kind: "hurt", slot: 0, to: "half" }, { kind: "say", text: "Mist hangs over the water." }] }] },
  createdByUserId: ai.owner.id,
});
const model = await fakeModel();
model.pointAt(ai);

await test("at an AI table the storyteller's turn that opened the fight takes back its opening event with it, and the model is no longer told it happened", async () => {
  model.script([reply({ calls: [call("run_prepared_encounter", { name: "Goblins at the ford" })] }), reply({ text: "Goblins rise from the reeds." })]);
  const said = await model.turn(ai, "We wade into the ford.", aiHero.id);
  assert.ok(said?.dmTurnId, "the turn wrote no narration");
  const opened = slotsOf(ai);
  const goblin = getEnemy(opened[0]);
  assert.equal(goblin.currentHp, Math.floor(goblin.maxHp / 2));
  const back = await revertTurn(ai, said.dmTurnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(getEnemy(opened[0]).currentHp, goblin.maxHp);
  assert.equal(eventOf(ai, "start").firedAt, null);
  assert.equal(firedEventsBlock(ai.campaignId), "");
  assert.equal(standing(tableLines(ai), "Mist hangs over the water."), 0);
});

model.close();

// ---- a test table's dice ----

const bench = await openWorld({ campaign: { kind: "playtest" } });
const benchKit = conditionsKit(bench);
const fighter = bench.addHero(FIGHTER);
const FRESH = { successes: 0, failures: 0, stable: false, dead: false };

await test("a forced face the reverted turn spent goes back in the queue, so the turn played again rolls it again", async () => {
  benchKit.reset(fighter.id, { currentHp: 0, deathSaves: { ...FRESH, failures: 1 } });
  scripts.setDiceScript(bench.campaignId, { seed: null, queue: [{ roller: "hero", kind: "death_save", face: 1 }, { roller: "enemy", kind: "attack", face: 20 }] });
  const out = await benchKit.withDice([15], "pass_time", { amount: 1, unit: "minutes" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(bench.sheet(fighter.id).deathSaves.dead, true);
  assert.equal(scripts.getDiceScript(bench.campaignId).queue.length, 1);

  const back = await revertTurn(bench, out.outcome.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.deepEqual(bench.sheet(fighter.id).deathSaves, { ...FRESH, failures: 1 });
  const script = scripts.getDiceScript(bench.campaignId);
  assert.deepEqual(script.queue, [{ roller: "hero", kind: "death_save", face: 1 }, { roller: "enemy", kind: "attack", face: 20 }], "the spent face did not go back where it stood");
  assert.deepEqual(script.used, [], "the face still reads as spent");

  const again = await benchKit.withDice([15], "pass_time", { amount: 1, unit: "minutes" });
  assert.equal(again.outcome.ok, true, again.outcome.error);
  assert.equal(again.unused, 1, "the replay rolled the harness's die, not the script's");
  assert.equal(bench.sheet(fighter.id).deathSaves.dead, true, "the replay did not roll the same");
  benchKit.reset(fighter.id);
  scripts.clearDiceScript(bench.campaignId);
});

await test("the seed goes back where the turn found it, so the replay rolls the same seeded dice; rolled on since, it stays, and the lead is told", async () => {
  benchKit.reset(fighter.id, { currentHp: 0, deathSaves: { ...FRESH } });
  scripts.setDiceScript(bench.campaignId, { seed: 31337, queue: [] });
  const start = scripts.getDiceScript(bench.campaignId).seededRolls;
  const out = await bench.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(out.ok, true, out.error);
  const after = scripts.getDiceScript(bench.campaignId).seededRolls;
  assert.ok(after > start, "the seed rolled nothing");
  const track = bench.sheet(fighter.id).deathSaves;

  const back = await revertTurn(bench, out.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(scripts.getDiceScript(bench.campaignId).seededRolls, start, "the seed did not go back");
  const replay = await bench.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(replay.ok, true, replay.error);
  assert.deepEqual(bench.sheet(fighter.id).deathSaves, track, "the replay rolled other seeded dice");

  // Rolled on since (a die the table rolled outside any turn): the seed
  // stays where it is, and the lead is asked first.
  runInUsageScope({ campaignId: bench.campaignId }, () => rollExpression("1d20"));
  const moved = scripts.getDiceScript(bench.campaignId).seededRolls;
  const asked = await revertTurn(bench, replay.turnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /seed has rolled on since/.test(line)), JSON.stringify(asked.json));
  const done = await revertTurn(bench, replay.turnId, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(scripts.getDiceScript(bench.campaignId).seededRolls, moved);
  benchKit.reset(fighter.id);
  scripts.clearDiceScript(bench.campaignId);
});

await test("the test fight's turn trace reads a reverted turn as taken back, its calls still listed", async () => {
  benchKit.reset(fighter.id, { currentHp: 0, deathSaves: { ...FRESH } });
  const out = await bench.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(out.ok, true, out.error);
  const read = () => turnTracePage(bench.campaignId, 30, null).turns.find((turn) => turn.id === out.turnId);
  assert.equal(read()?.revertedAt, null);
  const back = await revertTurn(bench, out.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const trace = read();
  assert.ok(trace?.revertedAt, "the trace reads the reverted turn as standing");
  assert.ok(trace.rows.some((row) => row.kind === "call" && row.tool === "pass_time"), "the reverted turn's calls were dropped");
  benchKit.reset(fighter.id);
});

await test("reinforcements a player's End Turn brought in at a seeded test fight roll their initiative under the event's own turn, and its revert gives the seed back", async () => {
  benchKit.reset(fighter.id);
  const benchCombat = await combatKit(bench);
  // The goblin goes first, so the hero's own End Turn closes the round: the
  // event fires there, where no turn runs.
  await deploy(bench, "Seeded ambush", { entry: { x: 2, y: 2 }, events: [{ trigger: { kind: "round", round: 2 }, actions: [{ kind: "reinforce", enemies: [{ monster: "goblin", count: 1 }], at: "entry" }] }] }, MAP, [{ monster: "goblin", count: 1 }], [20, 1]);
  assert.equal(bench.encounter().order.at(-1)?.characterId, fighter.id, "the hero does not close the round");
  scripts.setDiceScript(bench.campaignId, { seed: 4040, queue: [] });
  const before = bench.enemies().length;
  let rolls = scripts.getDiceScript(bench.campaignId).seededRolls;
  for (let step = 0; step < 8 && bench.encounter().round < 2; step += 1) {
    rolls = scripts.getDiceScript(bench.campaignId).seededRolls;
    benchCombat.endTurn(fighter.userId);
  }
  assert.equal(bench.encounter().round, 2, "the fight never reached round 2");
  assert.equal(bench.enemies().length, before + 1);
  const fired = listLiveTurnChangeViews(bench.campaignId).find((change) => change.kind === "fight_event");
  assert.ok(fired, "the reinforcement was kept under no turn");
  assert.ok(
    liveTurnChanges(bench.campaignId, fired.turnId).some((change) => change.kind === "dice_seed"),
    "the newcomer's initiative was rolled under no turn, so no revert gives the seed back",
  );
  const back = await revertTurn(bench, fired.turnId, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(bench.enemies().length, before);
  assert.ok(scripts.getDiceScript(bench.campaignId).seededRolls <= rolls, "the seed the newcomer's initiative spent stayed spent");
  await bench.invoke("end_encounter", { outcome: "truce" });
  scripts.clearDiceScript(bench.campaignId);
});

// ---- a card resolved as played ----

const table = await openWorld({ gameSettings: { multiCharacter: "all_active", ttsEnabled: false } });
const tableKit = await combatKit(table);
table.addHero({ name: "Vex", class: "wizard", level: 5, maxHp: 30, abilities: { int: 17 } });
const iris = table.addHero({
  name: "Iris",
  class: "wizard",
  level: 5,
  maxHp: 27,
  abilities: { int: 16 },
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, known: [], prepared: ["Detect Thoughts"], cantrips: [], spellbook: ["Detect Thoughts"] },
});
// The GM's own fighter, for the action economy a swing spends.
const brakka = table.addHero({
  user: table.owner,
  name: "Brakka",
  class: "fighter",
  level: 5,
  maxHp: 44,
  abilities: { str: 16 },
  proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
setDmMode(table.campaignId, "human", table.owner.id);

async function act(body, user) {
  const handler = await table.route("campaigns/[campaignId]/actions");
  table.signIn({ id: user.id });
  const response = await handler.POST(new Request("http://odm.test/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "do", ...body }) }), {
    params: Promise.resolve({ campaignId: table.campaignId }),
  });
  return { status: response.status, body: await response.json() };
}
async function resolve(messageId) {
  const handler = await table.route("campaigns/[campaignId]/dm/resolve-card");
  table.signIn({ id: table.owner.id });
  const response = await handler.POST(new Request("http://odm.test/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId }) }), {
    params: Promise.resolve({ campaignId: table.campaignId }),
  });
  return { status: response.status, body: await response.json() };
}
const waiting = () => queuedIntents(listRecentMessages(table.campaignId, 40), []).map((row) => row.messageId);

await test("a card the GM resolved as played waits again once the turn it was resolved in is reverted, and can be resolved again", async () => {
  await tableKit.fight(1);
  tableKit.giveTurn(iris.id);
  tableKit.freshTurn();
  setFloor(table.campaignId, initiativeFloorFor(table.campaignId));
  const played = await act({ content: "I cast Detect Thoughts using a level 2 slot.", characterId: iris.id, intent: { card: "spell", spell: "Detect Thoughts", slotLevel: 2 } }, { id: iris.userId });
  assert.equal(played.status, 202, JSON.stringify(played.body));
  const card = played.body.messageId;
  const pressed = await resolve(card);
  assert.equal(pressed.status, 200, JSON.stringify(pressed.body));
  assert.equal(table.sheet(iris.id).spellcasting.slots[2].used, 1);
  assert.ok(!waiting().includes(card));
  const kept = listLiveTurnChangeViews(table.campaignId).find((change) => change.kind === "card");
  assert.ok(kept, "the card was kept under no turn");

  const back = await revertTurn(table, kept.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(table.sheet(iris.id).spellcasting.slots[2].used, 0, "the slot stayed spent");
  assert.equal(getCampaignMessage(card).cardResolvedAt, undefined, "the card still reads as answered");
  assert.ok(waiting().includes(card), "the card is not back in Waiting on you");
  const again = await resolve(card);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(table.sheet(iris.id).spellcasting.slots[2].used, 1);
});

await test("a turn's revert gives back the attack it spent while it is still that creature's turn; spent more by a later turn, the lead is told first", async () => {
  const [dummy] = table.enemies();
  tableKit.openField();
  tableKit.place(brakka.id, 4, 4);
  tableKit.place(dummy.id, 5, 4);
  tableKit.setEnemy(dummy.id, { maxHp: 200, currentHp: 200 });
  tableKit.giveTurn(brakka.id);
  tableKit.freshTurn();
  const swing = async () => {
    table.clearDice();
    table.dice(15, 4);
    const out = await table.invoke("pc_attack", { characterId: brakka.id, enemyId: dummy.id, targetEnemyId: dummy.id, weapon: "Longsword" });
    table.clearDice();
    assert.equal(out.ok, true, out.error);
    return out;
  };
  const made = () => table.encounter().turnBudget?.attacksMade ?? 0;
  const first = await swing();
  assert.equal(made(), 1);
  // Reverted at once, the swing is Brakka's again.
  const back = await revertTurn(table, first.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(made(), 0, "the swing the revert took back stayed spent");
  const again = await swing();
  await swing();
  assert.equal(made(), 2);
  const asked = await revertTurn(table, again.turnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /spent more of it since/.test(line)), JSON.stringify(asked.json));
  const done = await revertTurn(table, again.turnId, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(made(), 0);
});

await test("the reactions a reverted turn spent come back by themselves, and one a later turn spent stays spent", async () => {
  // Two turns each spend a reaction this round, as an opportunity strike or a
  // Shield writes it (encounters.ts saveEncounter).
  const spendIn = (turn, id) =>
    runInTurnScope(turn.id, () => {
      const encounter = table.encounter();
      encounter.reactionsUsed = [...encounter.reactionsUsed, id];
      saveEncounter(encounter);
    });
  const before = table.encounter().reactionsUsed;
  const earlier = createDmTurn(table.campaignId, [], "human_dm");
  spendIn(earlier, iris.id);
  spendIn(createDmTurn(table.campaignId, [], "human_dm"), brakka.id);
  const back = await revertTurn(table, earlier.id);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.deepEqual(table.encounter().reactionsUsed, [...before, brakka.id]);
});

// ---- the event log's reading ----

await test("the event log offers the revert for a turn whose one sheet change came with a kept change, and lists the change, not a seed's run", () => {
  const audit = [{ id: "a1", characterId: "c", turnId: "t1", kind: "apply_damage", delta: {}, reason: "", seq: 3, undoable: true, revertedAt: null, patchKeys: ["currentHp"] }];
  const changes = [
    { id: "x1", turnId: "t1", seq: 4, kind: "fight_event", line: "Horns sound." },
    { id: "x2", turnId: "t2", seq: 5, kind: "dice_seed", line: "" },
  ];
  assert.equal(revertableTurns(audit).has("t1"), false, "one sheet change alone is the row's own undo");
  const offered = revertableTurns(audit, [], changes);
  assert.equal(offered.get("t1"), 1);
  assert.ok(offered.has("t2"));
  const feed = buildFeed(audit, [], [], changes);
  assert.deepEqual(feed.filter((item) => item.type === "change").map((item) => item.change.id), ["x1"]);
});

// ---- the rules, read alone ----

const picture = (overrides = {}) => ({
  encounterId: "e",
  order: [],
  turnIndex: 0,
  enemies: { g: { displayName: "Goblin", currentHp: 7, status: "alive", conditions: [], conditionMeta: {} } },
  map: { id: "m", width: 4, height: 1, drawn: "....", ground: "...." },
  tokens: { t: { refId: "g", name: "Goblin", x: 1, y: 0, hidden: false, footprint: 1 } },
  ...overrides,
});

await test("a creature out of the fight since keeps its hit points, and a token moved since stays where it stands; both are said", () => {
  const undo = {
    encounterId: "e",
    arrivals: [],
    enemies: [{ id: "g", before: { status: "alive", currentHp: 7 }, after: { status: "alive", currentHp: 3 } }],
    tokens: [{ id: "t", before: { x: 1 }, after: { x: 2 } }],
    ground: null,
  };
  const now = picture({
    enemies: { g: { displayName: "Goblin", currentHp: 0, status: "dead", conditions: [], conditionMeta: {} } },
    tokens: { t: { refId: "g", name: "Goblin", x: 3, y: 0, hidden: false, footprint: 1 } },
  });
  const plan = planTakeBack(undo, now);
  assert.deepEqual(plan.enemies, []);
  assert.deepEqual(plan.tokens, []);
  assert.ok(plan.warnings.some((line) => /left the fight since/.test(line)), plan.warnings.join(" | "));
  assert.ok(plan.warnings.some((line) => /moved since/.test(line)), plan.warnings.join(" | "));
});

finish();
