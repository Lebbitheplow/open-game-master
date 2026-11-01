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
  const [answer] = model.results(model.requests[1]);
  assert.match(String(answer?.result.fightEvents ?? ""), /A horn falls silent in the reeds\./, JSON.stringify(answer));
  model.script([reply({ text: "The fight goes on." })]);
  await model.turn(ai, "I look around.", aiHero.id);
  const told = JSON.stringify(model.requests[0].messages);
  assert.match(told, /Prepared events that have happened in this fight/);
  assert.match(told, /A horn falls silent in the reeds\./);
  assert.equal(count(tableLines(ai), /A horn falls silent/), 1);
});

model.close();
finish();
