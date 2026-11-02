// A prepared fight's events at the table (issue 685; the audit's 4.D). The
// rules:
//   - An event travels with its fight: saved through the prep routes (a
//     forged die refused there), copied from a workshop into a table with
//     its slots intact.
//   - Deploying the fight arms its events. "When the fight starts" runs
//     there and then, before the first turn; the rest run when the fight
//     reaches them, each once, however the fight is moved on: a person at
//     the console, a player's End Turn, the GM's controls, the storyteller's
//     own calls, the server playing the enemies at the close of its turn.
//   - Each runs through the engine's own handlers and posts one line to the
//     chronicle. A creature the GM keeps off the board is never named there
//     ("someone unseen"), until it appears. At an AI table the model hears
//     it in the call's result and in GAME STATE.
//   - Ending the fight disarms what is left. No event rolls a die for a
//     result: a hurt, a condition, a reveal and a line roll none at all.
//   - "The ground changes" names squares of the fight's prepared map: on that
//     map they turn to the picked kind through the painter, the board is
//     published once, and whoever stood there is set on open ground first,
//     never left in a wall. A fight with no map (or a board swapped since)
//     keeps none of it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-fight-events");
const { insertEncounterTemplate, listEncounterTemplates } = await import("../src/lib/db/encounter-templates.ts");
const { deployTemplate } = await import("../src/lib/dm/encounter-templates.ts");
const { normalizeTemplateExtras } = await import("../src/lib/dm/encounter-template-logic.ts");
const { EVENTS_REFUSAL } = await import("../src/lib/dm/fight-event-logic.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { runContentImport } = await import("../src/lib/db/content-import.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getBattleMapForEncounter, getTokenByRef } = await import("../src/lib/db/battle-maps.ts");
const { listFightEvents } = await import("../src/lib/db/fight-events.ts");
const { getEnemy } = await import("../src/lib/db/encounters.ts");
const { advanceAfterTurn, endOwnTurn, ensureInitiativeProgress } = await import("../src/lib/dm/encounter-tools.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { createPreparedMap } = await import("../src/lib/db/prepared-maps.ts");
const { setBattleMapTerrain, listTokens, placeToken } = await import("../src/lib/db/battle-maps.ts");
const { deployPreparedMap } = await import("../src/lib/dm/map-library.ts");
const { listNotesVisibleTo } = await import("../src/lib/db/notes.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { BRUSHES } = await import("../src/lib/battlemap/paint.ts");
const { blocksMove } = await import("../src/lib/battlemap/types.ts");
const { planGroundChange, standsOnOpenGround } = await import("../src/lib/battlemap/ground-change.ts");
const { GROUND_KINDS } = await import("../src/lib/dm/fight-ground-logic.ts");

const MAP = { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null };

// Three goblins: the first is the boss (Grak, 20 hit points), the third
// waits unseen in the reeds.
const BRIDGE = {
  overrides: [{ slot: 0, name: "Grak", hp: 20 }],
  hidden: [2],
  entry: { x: 2, y: 2 },
  phases: ["When Grak drops, the rest lose heart."],
  events: [
    { trigger: { kind: "start" }, actions: [{ kind: "hurt", slot: 1, to: "half" }, { kind: "hurt", slot: 2, to: "half" }] },
    {
      trigger: { kind: "round", round: 3 },
      actions: [
        { kind: "reinforce", enemies: [{ monster: "goblin", count: 2 }], at: "entry" },
        { kind: "say", text: "Horns sound from the ridge." },
      ],
    },
    {
      trigger: { kind: "falls", slot: 0 },
      actions: [
        { kind: "say", text: "The rope bridge gives way." },
        { kind: "visibility", slot: 2, hidden: false },
      ],
    },
  ],
};

const tableLines = (world) =>
  listRecentMessages(world.campaignId, 400)
    .filter((message) => message.authorType === "system")
    .map((message) => message.content);
const count = (lines, pattern) => lines.filter((line) => pattern.test(line)).length;
const slotsOf = (world) => listFightEvents(world.encounter().id)[0]?.slots ?? {};

async function post(world, route, body, params = {}) {
  world.signIn(world.owner);
  const handler = await world.route(route);
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId, ...params }) },
  );
  return { status: response.status, body: await response.json() };
}

// ---- a table a person runs ----

const person = await openWorld({ gameSettings: { dmMode: "human" } });
const kit = await combatKit(person);
const hero = person.addHero({ user: person.addUser(), class: "fighter", level: 5, maxHp: 300 });

await test("the prep route keeps a fight's events, and refuses one that names a die", async () => {
  const saved = await post(person, "campaigns/[campaignId]/dm/encounter-templates", {
    name: "Saved through the form",
    enemies: "goblin x3",
    extras: BRIDGE,
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.template.extras.events, normalizeTemplateExtras(BRIDGE, 3).events);
  const forged = await post(person, "campaigns/[campaignId]/dm/encounter-templates", {
    name: "Loaded dice",
    enemies: "goblin x3",
    extras: { events: [{ trigger: { kind: "start" }, actions: [{ kind: "roll", die: "d20", face: 20 }] }] },
  });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error, EVENTS_REFUSAL);
});

// Prepared in a workshop, brought into the table: what is deployed is the copy.
const workshop = createWorkshop(person.owner.id, { title: "River prep", targetParty: { size: 1, level: 5 } });
insertEncounterTemplate({
  campaignId: workshop.id,
  name: "The rope bridge",
  enemies: [{ monster: "goblin", count: 3 }],
  battlefield: "a rope bridge over a gorge",
  map: MAP,
  notes: "",
  extras: BRIDGE,
  createdByUserId: person.owner.id,
});

await test("an event survives the copy from a workshop into a table, its slots intact", async () => {
  const outcome = runContentImport({ sourceId: workshop.id, campaignId: person.campaignId, selection: ["encounters"], houseRulesMode: "replace" });
  assert.equal(outcome.error, undefined, outcome.error);
  const copied = listEncounterTemplates(person.campaignId).find((template) => template.name === "The rope bridge");
  assert.ok(copied, "the fight was not copied");
  assert.deepEqual(copied.extras.events, normalizeTemplateExtras(BRIDGE, 3).events);
});

const copied = listEncounterTemplates(person.campaignId).find((template) => template.name === "The rope bridge");
person.clearDice();
// The goblins' one initiative die, then the hero's: the hero goes first.
person.dice(1, 20);
const deployed = await deployTemplate(person.campaign(), person.owner.id, copied);
person.clearDice();

await test("a start event hurts its creature before the first turn, and names nobody unseen", async () => {
  assert.equal(deployed.ok, true, deployed.error);
  const encounter = person.encounter();
  assert.equal(encounter.round, 1);
  assert.equal(encounter.order[encounter.turnIndex]?.characterId, hero.id, "the hero's first turn has not come");
  const slots = slotsOf(person);
  const hurt = getEnemy(slots[1]);
  const lurker = getEnemy(slots[2]);
  assert.equal(hurt.currentHp, Math.floor(hurt.maxHp / 2));
  assert.equal(lurker.currentHp, Math.floor(lurker.maxHp / 2));
  const line = tableLines(person).find((entry) => /bloodied/.test(entry));
  assert.ok(line, `no line for the opening: ${tableLines(person).join(" | ")}`);
  assert.match(line, /Someone unseen is bloodied\./);
  assert.doesNotMatch(line, new RegExp(lurker.displayName));
  assert.equal(listFightEvents(encounter.id).filter((entry) => entry.firedAt).length, 1);
});

await test("round 3's reinforcements arrive once, where the party came in", async () => {
  const before = person.enemies().length;
  for (let step = 0; step < 3; step += 1) {
    kit.endTurn(hero.userId);
  }
  assert.equal(person.encounter().round, 3, "the fight never reached round 3");
  const arrivals = person.enemies().slice(before);
  assert.equal(arrivals.length, 2, `enemies: ${person.enemies().map((enemy) => enemy.displayName)}`);
  const map = getBattleMapForEncounter(person.encounter().id);
  for (const enemy of arrivals) {
    const token = getTokenByRef(map.id, enemy.id);
    assert.ok(token, `${enemy.displayName} has no token`);
    assert.ok(Math.max(Math.abs(token.x - 2), Math.abs(token.y - 2)) <= 4, `${enemy.displayName} came in at ${token.x},${token.y}`);
  }
  // A round on, nothing more comes.
  kit.endTurn(hero.userId);
  assert.equal(person.encounter().round, 4);
  assert.equal(person.enemies().length, before + 2);
  const lines = tableLines(person);
  assert.equal(count(lines, /join the fight/), 1, lines.join(" | "));
  assert.equal(count(lines, /Horns sound from the ridge\./), 1);
});

await test("the boss falling fires its event once, and the ambusher appears by name", async () => {
  const slots = slotsOf(person);
  const lurker = getEnemy(slots[2]);
  assert.equal(getTokenByRef(getBattleMapForEncounter(person.encounter().id).id, lurker.id).hidden, true);
  const felled = await person.invoke("damage_enemy", { enemyId: slots[0], amount: 100 });
  assert.equal(felled.ok, true, felled.error);
  assert.equal(getEnemy(slots[0]).status, "dead");
  assert.equal(getTokenByRef(getBattleMapForEncounter(person.encounter().id).id, lurker.id).hidden, false);
  const again = await person.invoke("damage_enemy", { enemyId: slots[1], amount: 1 });
  assert.equal(again.ok, true, again.error);
  const lines = tableLines(person);
  assert.equal(count(lines, /The rope bridge gives way\./), 1, lines.join(" | "));
  assert.equal(count(lines, new RegExp(`${lurker.displayName} appears\\.`)), 1);
});

await test("ending the fight disarms what its plan still held", async () => {
  const encounterId = person.encounter().id;
  const ended = await person.invoke("end_encounter", { outcome: "truce" });
  assert.equal(ended.ok, true, ended.error);
  assert.deepEqual(listFightEvents(encounterId), []);
});

await test("no event rolls a die: a hurt, a condition, a reveal and a line roll none", async () => {
  const quiet = insertEncounterTemplate({
    campaignId: person.campaignId,
    name: "Quiet plan",
    enemies: [{ monster: "goblin", count: 3 }],
    battlefield: "",
    map: MAP,
    notes: "",
    extras: {
      hidden: [2],
      events: [
        {
          trigger: { kind: "falls", slot: 0 },
          actions: [
            { kind: "hurt", slot: 1, to: "hp", hp: 2 },
            { kind: "condition", slot: 1, condition: "prone", remove: false },
            { kind: "visibility", slot: 2, hidden: false },
            { kind: "say", text: "The torches gutter out." },
          ],
        },
      ],
    },
    createdByUserId: person.owner.id,
  });
  person.clearDice();
  person.dice(1, 20);
  const opened = await deployTemplate(person.campaign(), person.owner.id, quiet);
  person.clearDice();
  assert.equal(opened.ok, true, opened.error);
  const slots = slotsOf(person);
  person.diceLog();
  const felled = await person.invoke("damage_enemy", { enemyId: slots[0], amount: 100 });
  assert.equal(felled.ok, true, felled.error);
  assert.deepEqual(person.diceLog(), [], "an event rolled a die");
  const second = getEnemy(slots[1]);
  assert.equal(second.currentHp, 2);
  assert.ok(second.conditions.includes("prone"), `conditions: ${second.conditions}`);
  assert.match(tableLines(person).at(-1) ?? "", /is wounded\.|is bloodied\./);
  await person.invoke("end_encounter", { outcome: "truce" });
});

// ---- the ground changes ----

// A gorge crossed by a two-square bridge at (6,4) and (6,5); the gorge's
// edge is the painter's low wall. Walls ring the map.
const WIDTH = 12;
const HEIGHT = 10;
function gorge(fill = (x, y) => (x === 6 && y !== 4 && y !== 5 ? "|" : ".")) {
  let terrain = "";
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      terrain += x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? "#" : fill(x, y);
    }
  }
  return terrain;
}
const at = (terrain, x, y) => terrain[y * WIDTH + x];
const BRIDGE_SQUARES = [{ x: 6, y: 4 }, { x: 6, y: 5 }];
const boardOf = (world) => getBattleMapForEncounter(world.encounter().id);
// Nobody stands where the engine's ground blocks a walker.
function nobodyInAWall(world) {
  const map = boardOf(world);
  for (const token of listTokens(map.id)) {
    assert.equal(blocksMove(at(map.terrain, token.x, token.y)), false, `${token.name} stands in a wall at ${token.x},${token.y}`);
  }
}
// The bus hands subscribers SSE text: the event's type, and for each board
// publish whether the board's ground had changed by then.
function watchBoard(world, before) {
  const seen = [];
  const stop = subscribe(world.campaignId, (chunk) => {
    const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
    seen.push({ type, changed: type === "battle_map_updated" && boardOf(world)?.drawnTerrain !== before });
  });
  return { seen, stop };
}

await test("the painter's brushes and the kinds of ground an event can leave are the same list", () => {
  assert.deepEqual([...GROUND_KINDS], [...BRUSHES]);
});

await test("the plan sets everyone on open ground, a Large creature whole, and may split the field as a bridge does", () => {
  const drawn = gorge();
  const plan = planGroundChange({
    drawn,
    ground: drawn,
    width: WIDTH,
    height: HEIGHT,
    tiles: BRIDGE_SQUARES,
    terrain: "lowwall",
    standing: [
      { id: "near", x: 2, y: 4, footprint: 1 },
      { id: "far", x: 9, y: 4, footprint: 1 },
      { id: "on", x: 6, y: 4, footprint: 1 },
      // An ogre's 2x2 straddling the bridge's west end: its anchor is open
      // ground, its east half is not.
      { id: "ogre", x: 5, y: 5, footprint: 2 },
    ],
  });
  assert.equal(plan.error, undefined, plan.error);
  assert.equal(at(plan.terrain, 6, 4), "|");
  assert.equal(at(plan.terrain, 6, 5), "|");
  const moved = new Map(plan.moves.map((move) => [move.id, move]));
  assert.deepEqual([...moved.keys()].sort(), ["ogre", "on"], "only those the ground no longer holds move");
  for (const [id, footprint] of [["on", 1], ["ogre", 2]]) {
    assert.ok(standsOnOpenGround(plan.terrain, WIDTH, moved.get(id), footprint), `${id} was set down in a wall`);
  }
  // Nobody shares a square with anybody.
  const squares = new Set(["2,4", "9,4"]);
  for (const move of plan.moves) {
    const tiles = move.id === "ogre" ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
    for (const [dx, dy] of tiles) {
      const key = `${move.x + dx},${move.y + dy}`;
      assert.equal(squares.has(key), false, `${move.id} was set down on someone at ${key}`);
      squares.add(key);
    }
  }
  // Ground with nowhere left to stand is refused, not a token in a wall.
  const sealed = planGroundChange({
    drawn,
    ground: drawn,
    width: WIDTH,
    height: HEIGHT,
    tiles: Array.from({ length: (WIDTH - 2) * (HEIGHT - 2) }, (_, index) => ({ x: (index % (WIDTH - 2)) + 1, y: Math.floor(index / (WIDTH - 2)) + 1 })),
    terrain: "wall",
    standing: [{ id: "on", x: 6, y: 4, footprint: 1 }],
  });
  assert.match(sealed.error ?? "", /no open ground/);
});

const bridgeMap = createPreparedMap({ campaignId: person.campaignId, name: "The gorge", width: WIDTH, height: HEIGHT, terrain: gorge(), ambient: "bright", theme: "field", seed: 4242 });
// The same gorge with its bridge somewhere else, for a board swapped mid-fight.
const otherMap = createPreparedMap({ campaignId: person.campaignId, name: "The other gorge", width: WIDTH, height: HEIGHT, terrain: gorge(), ambient: "bright", theme: "field", seed: 77 });
// Grak, the boss, across the gorge; a goblin on the bridge, and a third
// hidden under it.
const GORGE = {
  overrides: [{ slot: 0, name: "Grak" }],
  placements: [{ slot: 0, x: 9, y: 2 }, { slot: 1, x: 6, y: 4 }, { slot: 2, x: 6, y: 5 }],
  hidden: [2],
  entry: { x: 2, y: 4 },
  events: [
    {
      trigger: { kind: "falls", slot: 0 },
      actions: [
        { kind: "ground", tiles: [...BRIDGE_SQUARES, { x: 0, y: 4 }, { x: 40, y: 40 }], terrain: "lowwall" },
        { kind: "say", text: "The rope bridge gives way." },
      ],
    },
  ],
};
const gorgeMap = { ...MAP, mapId: bridgeMap.id };

await test("the prep route keeps a change of ground on a fight with a map, its squares fitted to that map, and drops it on a fight with none", async () => {
  const kept = await post(person, "campaigns/[campaignId]/dm/encounter-templates", { name: "Gorge saved", enemies: "goblin x3", map: { mapId: bridgeMap.id }, extras: GORGE });
  assert.equal(kept.status, 201, JSON.stringify(kept.body));
  assert.deepEqual(kept.body.template.extras.events[0].actions[0], { kind: "ground", tiles: BRIDGE_SQUARES, terrain: "lowwall" });
  const bare = await post(person, "campaigns/[campaignId]/dm/encounter-templates", {
    name: "Gorge with no map",
    enemies: "goblin x3",
    extras: { ...GORGE, events: [...GORGE.events, { trigger: { kind: "round", round: 2 }, actions: [{ kind: "ground", tiles: BRIDGE_SQUARES, terrain: "wall" }] }] },
  });
  assert.equal(bare.status, 201, JSON.stringify(bare.body));
  assert.deepEqual(bare.body.template.extras.events, [{ trigger: { kind: "falls", slot: 0 }, actions: [{ kind: "say", text: "The rope bridge gives way." }] }]);
  // Unlinking the map later takes the change with it.
  const unlinked = await post(person, "campaigns/[campaignId]/dm/encounter-templates", { name: "Gorge unlinked", enemies: "goblin x3", map: { mapId: bridgeMap.id }, extras: GORGE });
  person.signIn(person.owner);
  const patch = (await person.route("campaigns/[campaignId]/dm/encounter-templates/[templateId]")).PATCH;
  const response = await patch(new Request("http://test/", { method: "PATCH", body: JSON.stringify({ map: null }) }), {
    params: Promise.resolve({ campaignId: person.campaignId, templateId: unlinked.body.template.id }),
  });
  const edited = await response.json();
  assert.equal(response.status, 200, JSON.stringify(edited));
  assert.equal(JSON.stringify(edited.template.extras.events).includes("ground"), false);
});

async function deployGorge(world, name, extras = GORGE, map = gorgeMap) {
  const template = insertEncounterTemplate({ campaignId: world.campaignId, name, enemies: [{ monster: "goblin", count: 3 }], battlefield: "", map, notes: "", extras, createdByUserId: world.owner.id });
  world.clearDice();
  world.dice(1, 20);
  const outcome = await deployTemplate(world.campaign(), world.owner.id, template);
  world.clearDice();
  assert.equal(outcome.ok, true, outcome.error);
  assert.equal(outcome.mapError, undefined, outcome.mapError);
  return template;
}

await test("at a person's table the boss falling drops the bridge on the live board, published once, and the goblin on it is pushed clear", async () => {
  await deployGorge(person, "The gorge fight");
  const slots = slotsOf(person);
  const board = boardOf(person);
  assert.equal(board.drawnTerrain, bridgeMap.terrain, "the fight is not on its prepared map");
  const onBridge = getTokenByRef(board.id, slots[1]);
  const under = getTokenByRef(board.id, slots[2]);
  assert.deepEqual([onBridge.x, onBridge.y, under.x, under.y], [6, 4, 6, 5], "the plan did not set the goblins on the bridge");
  const armed = listFightEvents(person.encounter().id)[0];
  assert.deepEqual(armed.event.actions[0].tiles, BRIDGE_SQUARES, "the squares off the board or on its edge were armed");
  const watch = watchBoard(person, board.drawnTerrain);
  const felled = await person.invoke("damage_enemy", { enemyId: slots[0], amount: 100 });
  watch.stop();
  assert.equal(felled.ok, true, felled.error);
  const after = boardOf(person);
  assert.equal(at(after.drawnTerrain, 6, 4), "|");
  assert.equal(at(after.drawnTerrain, 6, 5), "|");
  assert.equal(at(after.terrain, 6, 4), "|", "the engine does not walk the new ground");
  const moved = getTokenByRef(after.id, slots[1]);
  assert.notDeepEqual([moved.x, moved.y], [6, 4], "the goblin stayed where the bridge was");
  const hidden = getTokenByRef(after.id, slots[2]);
  assert.notDeepEqual([hidden.x, hidden.y], [6, 5]);
  nobodyInAWall(person);
  assert.equal(watch.seen.filter((entry) => entry.changed).length, 1, `board publishes: ${JSON.stringify(watch.seen.filter((entry) => entry.type === "battle_map_updated"))}`);
  const line = tableLines(person).find((entry) => /The ground gives way\./.test(entry));
  assert.ok(line, tableLines(person).join(" | "));
  assert.match(line, new RegExp(`${getEnemy(slots[1]).displayName} is pushed clear\.`));
  assert.doesNotMatch(line, new RegExp(getEnemy(slots[2]).displayName), "the goblin the GM keeps hidden was named");
  assert.match(line, /The rope bridge gives way\./);
});

await test("the event fires once: put back by hand, the bridge stays", async () => {
  const slots = slotsOf(person);
  setBattleMapTerrain(boardOf(person).id, bridgeMap.terrain);
  const again = await person.invoke("damage_enemy", { enemyId: slots[1], amount: 1 });
  assert.equal(again.ok, true, again.error);
  assert.equal(boardOf(person).drawnTerrain, bridgeMap.terrain);
  assert.equal(count(tableLines(person), /The ground gives way\./), 1);
  await person.invoke("end_encounter", { outcome: "truce" });
});

await test("on a fight with no prepared map the change is never armed, and the board stays as the generator drew it", async () => {
  await deployGorge(person, "Gorge, no map", { ...GORGE, events: [{ ...GORGE.events[0], actions: [GORGE.events[0].actions[0], { kind: "say", text: "The ropes creak." }] }] }, MAP);
  const slots = slotsOf(person);
  const armed = listFightEvents(person.encounter().id);
  assert.deepEqual(armed.map((entry) => entry.event.actions.map((action) => action.kind)), [["say"]]);
  const before = boardOf(person).drawnTerrain;
  await person.invoke("damage_enemy", { enemyId: slots[0], amount: 100 });
  assert.equal(boardOf(person).drawnTerrain, before);
  assert.equal(count(tableLines(person), /The ropes creak\./), 1);
  await person.invoke("end_encounter", { outcome: "truce" });
});

await test("a board swapped for another map mid-fight is left alone, and the GM is told why", async () => {
  await deployGorge(person, "Gorge, swapped");
  const slots = slotsOf(person);
  const swapped = deployPreparedMap(person.campaign(), otherMap.id);
  assert.equal(swapped.ok, true, swapped.error);
  await person.invoke("damage_enemy", { enemyId: slots[0], amount: 100 });
  assert.equal(boardOf(person).drawnTerrain, otherMap.terrain);
  const notes = listNotesVisibleTo(person.campaignId, person.owner.id, true).filter((note) => /what an event could not do/.test(note.title));
  assert.ok(notes.some((note) => /no longer the map the plan was drawn on/.test(note.body)), JSON.stringify(notes.map((note) => note.body)));
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
  extras: {
    events: [
      { trigger: { kind: "start" }, actions: [{ kind: "hurt", slot: 0, to: "half" }, { kind: "say", text: "Mist hangs over the water." }] },
      { trigger: { kind: "round", round: 3 }, actions: [{ kind: "reinforce", enemies: [{ monster: "goblin", count: 1 }], at: "any" }] },
      { trigger: { kind: "falls", slot: 1 }, actions: [{ kind: "say", text: "A horn falls silent in the reeds." }] },
    ],
  },
  createdByUserId: ai.owner.id,
});
const model = await fakeModel();
model.pointAt(ai);

await test("at an AI table the storyteller's prepared fight opens with its start event, and the model hears it", async () => {
  model.script([reply({ calls: [call("run_prepared_encounter", { name: "Goblins at the ford" })] }), reply({ text: "Goblins rise from the reeds." })]);
  await model.turn(ai, "We wade into the ford.", aiHero.id);
  assert.ok(ai.encounter(), "the prepared fight never started");
  const slots = slotsOf(ai);
  const hurt = getEnemy(slots[0]);
  assert.equal(hurt.currentHp, Math.floor(hurt.maxHp / 2));
  const [answer] = model.results(model.requests[1]);
  assert.match(String(answer?.result.fightEvents ?? ""), /Mist hangs over the water\./, JSON.stringify(answer));
  assert.match(String(answer?.result.fightEvents ?? ""), /bloodied/);
});

await test("the server playing the enemies at the close of its turn brings round 3's reinforcement, once", async () => {
  ensureInitiativeProgress(ai.campaign());
  assert.equal(ai.encounter().orderReady, true);
  const before = ai.enemies().length;
  for (let step = 0; step < 12 && ai.encounter().round < 3; step += 1) {
    endOwnTurn(ai.campaignId, aiHero.userId);
    advanceAfterTurn(ai.campaign(), createDmTurn(ai.campaignId, [], "ai"));
  }
  assert.equal(ai.encounter().round, 3, "the fight never reached round 3");
  assert.equal(ai.enemies().length, before + 1);
  endOwnTurn(ai.campaignId, aiHero.userId);
  advanceAfterTurn(ai.campaign(), createDmTurn(ai.campaignId, [], "ai"));
  assert.equal(ai.enemies().length, before + 1, "the reinforcement came twice");
  assert.equal(count(tableLines(ai), /joins the fight/), 1);
});

await test("a creature falling in the model's own call fires its event, told in that call's result and in GAME STATE after", async () => {
  const slots = slotsOf(ai);
  model.script([reply({ calls: [call("enemy_flees", { enemyId: slots[1] })] }), reply({ text: "The goblin splashes away." })]);
  await model.turn(ai, "I shout at the goblins to run.", aiHero.id);
  assert.notEqual(getEnemy(slots[1]).status, "alive", "the goblin never left the fight");
  // The flight's own answer, wherever the turn's requests put it: under a
  // loaded run the turn can ask the model an extra time first.
  const answers = model.requests.flatMap((request) => model.results(request));
  const answer = answers.find((entry) => String(entry?.id ?? "").includes("enemy_flees")) ?? answers[0];
  assert.match(String(answer?.result.fightEvents ?? ""), /A horn falls silent in the reeds\./, JSON.stringify(answers).slice(0, 600));
  model.script([reply({ text: "The fight goes on." })]);
  await model.turn(ai, "I look around.", aiHero.id);
  const told = JSON.stringify(model.requests[0].messages);
  assert.match(told, /Prepared events that have happened in this fight/);
  assert.match(told, /A horn falls silent in the reeds\./);
  assert.equal(count(tableLines(ai), /A horn falls silent/), 1);
});

await test("at an AI table the model's own call fells the gatekeeper, the portcullis falls, and the model hears it once", async () => {
  await ai.invoke("end_encounter", { outcome: "truce" });
  const gate = createPreparedMap({ campaignId: ai.campaignId, name: "The gatehouse", width: WIDTH, height: HEIGHT, terrain: gorge(() => "."), ambient: "bright", theme: "interior", seed: 99 });
  insertEncounterTemplate({
    campaignId: ai.campaignId,
    name: "The gatehouse",
    enemies: [{ monster: "goblin", count: 2 }],
    battlefield: "a gatehouse",
    map: { ...MAP, mapId: gate.id },
    notes: "",
    extras: {
      placements: [{ slot: 0, x: 9, y: 2 }, { slot: 1, x: 6, y: 4 }],
      entry: { x: 2, y: 4 },
      events: [{ trigger: { kind: "falls", slot: 0 }, actions: [{ kind: "ground", tiles: [{ x: 6, y: 3 }, { x: 6, y: 4 }, { x: 6, y: 5 }], terrain: "wall" }] }],
    },
    createdByUserId: ai.owner.id,
  });
  model.script([reply({ calls: [call("run_prepared_encounter", { name: "The gatehouse" })] }), reply({ text: "The gatehouse goblins draw blades." })]);
  await model.turn(ai, "We walk under the gate.", aiHero.id);
  assert.equal(boardOf(ai)?.drawnTerrain, gate.terrain, "the fight is not on its prepared map");
  const slots = slotsOf(ai);
  // The server has played the goblins' turns since the deploy: the second
  // is stood back under the gate, where the portcullis will fall.
  const board = boardOf(ai);
  const blocker = listTokens(board.id).find((token) => token.x === 6 && token.y === 4 && token.refId !== slots[1]);
  assert.equal(blocker, undefined, `${blocker?.name} stands under the gate`);
  placeToken(getTokenByRef(board.id, slots[1]).id, 6, 4);
  const watch = watchBoard(ai, gate.terrain);
  model.script([reply({ calls: [call("enemy_flees", { enemyId: slots[0] })] }), reply({ text: "The goblin bolts, and the portcullis crashes down." })]);
  await model.turn(ai, "I roar at the gatekeeper.", aiHero.id);
  watch.stop();
  const after = boardOf(ai);
  for (const y of [3, 4, 5]) {
    assert.equal(at(after.drawnTerrain, 6, y), "#", `square 6,${y} is not wall`);
  }
  const pushed = getTokenByRef(after.id, slots[1]);
  assert.notEqual(at(after.terrain, pushed.x, pushed.y), "#", "the goblin was left inside the wall");
  nobodyInAWall(ai);
  assert.equal(watch.seen.filter((entry) => entry.changed).length, 1, `board publishes: ${JSON.stringify(watch.seen.filter((entry) => entry.type === "battle_map_updated"))}`);
  const answers = model.requests.flatMap((request) => model.results(request));
  const answer = answers.find((entry) => String(entry?.id ?? "").includes("enemy_flees")) ?? answers[0];
  assert.match(String(answer?.result.fightEvents ?? ""), /The way is blocked\. .+ is pushed clear\./, JSON.stringify(answers).slice(0, 600));
  model.script([reply({ text: "Dust settles." })]);
  await model.turn(ai, "I look at the gate.", aiHero.id);
  assert.equal(count(tableLines(ai), /The way is blocked\./), 1);
});

model.close();
finish();
