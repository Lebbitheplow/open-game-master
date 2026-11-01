// "Revert this turn" and a prepared fight's events (issue 685). An event that
// fired in the turn is armed again, and what it did goes back with the rest
// of what the turn did to the fight (src/lib/db/turn-rows.ts): the hurt, the
// condition, the reveal, the reinforcements, the change of ground and whoever
// it moved, and the creature whose fall set it off. Its line in the chronicle
// says it was taken back, the GM's note of what it could not do goes, and the
// storyteller no longer hears it as done. Armed again, it fires when its
// moment comes round once more, and not before: a boss the revert stood back
// up has to fall again.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-revert-fight-events");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { deployTemplate } = await import("../src/lib/dm/encounter-templates.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getBattleMapForEncounter, getTokenByRef, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { listFightEvents } = await import("../src/lib/db/fight-events.ts");
const { firedEventsBlock } = await import("../src/lib/dm/fight-events.ts");
const { getEnemy } = await import("../src/lib/db/encounters.ts");
const { createPreparedMap } = await import("../src/lib/db/prepared-maps.ts");
const { blocksMove } = await import("../src/lib/battlemap/types.ts");
const { listLiveTurnChangeViews, liveTurnChanges } = await import("../src/lib/db/turn-changes.ts");
const { listNotesVisibleTo } = await import("../src/lib/db/notes.ts");

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

// The foes' one initiative die, then the hero's: the hero goes first.
async function deploy(world, name, extras, map = MAP, enemies = [{ monster: "goblin", count: 3 }]) {
  const template = insertEncounterTemplate({ campaignId: world.campaignId, name, enemies, battlefield: "", map, notes: "", extras, createdByUserId: world.owner.id });
  world.clearDice();
  world.dice(1, 20);
  const outcome = await deployTemplate(world.campaign(), world.owner.id, template);
  world.clearDice();
  assert.equal(outcome.ok, true, outcome.error);
  return template;
}

// ---- a table a person runs ----

const person = await openWorld({ gameSettings: { dmMode: "human" } });
const kit = await combatKit(person);
const hero = person.addHero({ user: person.addUser(), class: "fighter", level: 5, maxHp: 300 });

// Grak the boss (slot 0); a goblin the plan wounds (slot 1); a third the GM
// keeps unseen until Grak falls (slot 2). At round 2 two more come in.
await deploy(person, "The rope bridge", {
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
});
const slots = slotsOf(person);
const wounded = getEnemy(slots[1]);
const lurkerToken = () => getTokenByRef(boardOf(person).id, slots[2]);

await test("the boss's fall and its event go back together: Grak stands again, the hurt, the condition and the reveal are undone, the chronicle says so and the event is armed again", async () => {
  assert.equal(lurkerToken().hidden, true);
  const felled = await person.invoke("damage_enemy", { enemyId: slots[0], amount: 100 });
  assert.equal(felled.ok, true, felled.error);
  assert.equal(getEnemy(slots[1]).currentHp, 2);
  assert.ok(getEnemy(slots[1]).conditions.includes("prone"));
  assert.equal(lurkerToken().hidden, false);
  assert.ok(liveTurnChanges(person.campaignId, felled.turnId).some((change) => change.kind === "fight_event"), "the event was not kept under the call's turn");
  const listed = (await snapshot(person)).turnChanges.filter((change) => change.turnId === felled.turnId);
  assert.ok(listed.some((change) => /The rope bridge gives way\./.test(change.line)), JSON.stringify(listed));

  const back = await revertTurn(person, felled.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const grak = getEnemy(slots[0]);
  assert.equal(grak.status, "alive", "Grak stayed down");
  assert.equal(grak.currentHp, 20);
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

let refelled = "";

await test("armed again, the event waits for its moment: with Grak standing a call fires nothing, and when Grak falls again it fires, once", async () => {
  const quiet = await person.invoke("damage_enemy", { enemyId: slots[1], amount: 1 });
  assert.equal(quiet.ok, true, quiet.error);
  assert.equal(standing(tableLines(person), "The rope bridge gives way."), 0, "the event fired while Grak stood");
  const felled = await person.invoke("damage_enemy", { enemyId: slots[0], amount: 100 });
  assert.equal(felled.ok, true, felled.error);
  refelled = felled.turnId;
  assert.equal(getEnemy(slots[1]).currentHp, 2);
  assert.equal(standing(tableLines(person), "The rope bridge gives way."), 1);
});

await test("a creature the event touched and a later call changed again is asked about first, and on yes is as the reverted turn found it", async () => {
  const found = { hp: wounded.currentHp - 1, conditions: [] };
  assert.equal((await person.invoke("damage_enemy", { enemyId: slots[1], amount: 1 })).ok, true);
  assert.equal((await person.invoke("set_enemy_condition", { enemyId: slots[1], condition: "poisoned" })).ok, true);
  const asked = await revertTurn(person, refelled);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /changed again/.test(line)), JSON.stringify(asked.json));
  const done = await revertTurn(person, refelled, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  const goblin = getEnemy(slots[1]);
  assert.equal(goblin.currentHp, found.hp, "the hit points the turn found were not put back");
  assert.deepEqual(goblin.conditions, found.conditions);
  assert.equal(getEnemy(slots[0]).status, "alive");
});

await test("reinforcements that came as the round turned go with the turn that turned it, and come again, once, when round 2 begins again", async () => {
  const before = person.enemies().map((enemy) => enemy.id);
  for (let step = 0; step < 8 && person.encounter().round < 2; step += 1) {
    kit.endTurn(hero.userId);
  }
  const arrivals = person.enemies().filter((enemy) => !before.includes(enemy.id));
  assert.equal(arrivals.length, 2, `enemies: ${person.enemies().map((enemy) => enemy.displayName)}`);
  const fired = listLiveTurnChangeViews(person.campaignId).find((change) => /Horns sound/.test(change.line));
  assert.ok(fired, "the reinforcements were kept under no turn");
  // The player's End Turn after it moved the order again: asked first.
  const back = await revertTurn(person, fired.turnId, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  for (const enemy of arrivals) {
    assert.equal(getEnemy(enemy.id), null, `${enemy.displayName} is still in the fight`);
    assert.equal(getTokenByRef(boardOf(person).id, enemy.id), null, `${enemy.displayName} is still on the board`);
    assert.ok(!person.encounter().order.some((entry) => entry.kind === "enemy" && entry.enemyId === enemy.id), `${enemy.displayName} still has a turn`);
  }
  assert.equal(eventOf(person, "round").firedAt, null);
  assert.equal(standing(tableLines(person), "Horns sound from the ridge."), 0);
  for (let step = 0; step < 8 && person.enemies().length < before.length + 2; step += 1) {
    kit.endTurn(hero.userId);
  }
  kit.endTurn(hero.userId);
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
  // The hurt names a slot the roster never filled. The event fires as the
  // GM's Deploy lays the plan, after the call that opened the fight: a turn of
  // its own, whose revert leaves the fight standing.
  await deploy(person, "Two goblins", { events: [{ trigger: { kind: "round", round: 1 }, actions: [{ kind: "hurt", slot: 2, to: "half" }, { kind: "say", text: "Dust drifts down." }] }] }, MAP, [{ monster: "goblin", count: 2 }]);
  const notes = () => listNotesVisibleTo(person.campaignId, person.owner.id, true).filter((note) => /what an event could not do/.test(note.title) && /Two goblins/.test(note.title));
  assert.equal(notes().length, 1, "the refusal was not noted");
  const fired = listLiveTurnChangeViews(person.campaignId).find((change) => /Dust drifts down/.test(change.line));
  const back = await revertTurn(person, fired.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(notes().length, 0, "the refusal's note stayed");
  assert.ok(person.encounter(), "the fight went with an event the Deploy fired after opening it");
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

await test("at an AI table the storyteller's turn that opened the fight takes the fight and its opening event with it, asked first, and the model is no longer told it happened", async () => {
  model.script([reply({ calls: [call("run_prepared_encounter", { name: "Goblins at the ford" })] }), reply({ text: "Goblins rise from the reeds." })]);
  const said = await model.turn(ai, "We wade into the ford.", aiHero.id);
  assert.ok(said?.dmTurnId, "the turn wrote no narration");
  assert.ok(ai.encounter(), "the prepared fight never started");
  const asked = await revertTurn(ai, said.dmTurnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /began the fight/.test(line)), JSON.stringify(asked.json));
  const back = await revertTurn(ai, said.dmTurnId, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(ai.encounter(), null, "the fight the storyteller began is still on");
  assert.equal(firedEventsBlock(ai.campaignId), "");
  assert.equal(standing(tableLines(ai), "Mist hangs over the water."), 0);
});

model.close();
finish();
