// Issue 640: a romantic step asked in a fight was lost. A player said "I want
// us to be together" mid-fight, the companion said "let me answer when we're
// safe", and nothing recorded the ask; another companion brought a confession
// back two turns later, in prose only. The romance tool stays out of fights
// (issue 503), but a call that reaches it there (a person's console, an agent
// program, a model that calls it anyway) now has the step held on the bond,
// unrolled; when the fight ends, however it ends, the GM is told to have the
// companion answer it: in the end of the fight's result and as a director
// note on the turns after, and on a person's console. Answering it clears it.
// The hold is also the seam issue 641's claims reader holds a step through.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-romance-held");
const relationships = await import("../src/lib/db/relationships.ts");
const messages = await import("../src/lib/db/messages.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const { bumpAiTurns } = await import("../src/lib/db/advances.ts");
const { heldStepOf } = await import("../src/lib/db/romance-held.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const held = await import("../src/lib/dm/romance-held.ts");
const logic = await import("../src/lib/dm/romance-held-logic.ts");

// Vex and her companion Hollis, courting and far enough past the bar that a
// "together" asked of him is a certain yes once it is answered.
async function table({ gameSettings = {} } = {}) {
  const world = await openWorld({ gameSettings: { companions: "full", ...gameSettings } });
  const hero = world.addHero({ name: "Vex", gender: "Female" });
  const joined = await world.invoke("add_companion", { name: "Hollis", class: "paladin", gender: "Male", personality: "Keeps his word.", kind: "party" });
  assert.equal(joined.ok, true, joined.error);
  const bond = () => relationships.getRelationship(world.campaignId, hero.id, "Hollis");
  relationships.patchRelationship(bond().id, { romance: "courting", approval: 80 });
  const ask = { characterId: hero.id, subject: "Hollis", to: "together", note: "I want us to be together." };
  const lines = () => messages.listAllMessages(world.campaignId).filter((message) => message.authorType === "system").map((message) => message.content);
  async function call(method, name) {
    world.signIn(world.owner);
    const mod = await world.route(name);
    const response = await mod[method](new Request("http://test/", { method }), { params: Promise.resolve({ campaignId: world.campaignId }) });
    return { status: response.status, json: await response.json().catch(() => ({})) };
  }
  return { world, hero, bond, ask, lines, call };
}

// ---- the rules ----

await test("a held step reads back as written, and anything else as nothing", () => {
  const step = { to: "together", note: "Stay.", source: "call", heldAt: "2026-10-31T00:00:00.000Z", releasedAt: null };
  assert.deepEqual(logic.parseHeldStep(logic.serializeHeldStep(step)), step);
  assert.equal(logic.serializeHeldStep(null), "");
  assert.equal(logic.parseHeldStep(""), null);
  assert.equal(logic.parseHeldStep("{not json"), null);
  assert.equal(logic.parseHeldStep(JSON.stringify({ ...step, to: "none" })), null);
  assert.equal(logic.parseHeldStep(JSON.stringify({ ...step, to: "eloped" })), null);
  assert.equal(logic.parseHeldStep(JSON.stringify({ ...step, source: "x", releasedAt: "3" })).source, "call");
});

await test("a held step stands while it is still the bond's next rung, and is owed for its turns", () => {
  const step = { to: "together", note: "", source: "call", heldAt: "", releasedAt: 10 };
  assert.equal(logic.heldStepStands(step, { romance: "courting", status: "active" }), true);
  assert.equal(logic.heldStepStands(step, { romance: "together", status: "active" }), false, "answered another way");
  assert.equal(logic.heldStepStands(step, { romance: "interested", status: "active" }), false, "slipped since");
  assert.equal(logic.heldStepStands(step, { romance: "courting", status: "ended" }), false);
  assert.equal(logic.heldStepDue(step, true, 10), false, "not while a fight is on");
  assert.equal(logic.heldStepDue(step, false, 10 + logic.ANSWER_TURNS - 1), true);
  assert.equal(logic.heldStepDue(step, false, 10 + logic.ANSWER_TURNS), false, "let go after its turns");
  assert.equal(logic.heldStepDue({ ...step, releasedAt: null }, false, 99), true, "owed from now when the end never stamped it");
});

// ---- at the table ----

await test("asked mid-fight at the console, the step is held: no roll, no rung, the result says how to play it", async () => {
  const { world, bond, ask, lines } = await table();
  await world.beginFight([{ monster: "goblin" }]);
  world.diceLog();
  const out = await world.invoke("romance_advance", ask);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.held, true);
  assert.equal(out.result.accepted, undefined, "nobody answered");
  assert.match(out.result.note, /^Held: a fight is on, so Hollis does not answer Vex's ask to be partners yet/);
  assert.match(out.result.note, /the console shows the ask under Waiting on you/);
  assert.deepEqual(world.diceLog(), [], "nothing was rolled");
  assert.equal(bond().romance, "courting");
  assert.equal(heldStepOf(bond().id).to, "together");
  assert.equal(heldStepOf(bond().id).note, "I want us to be together.");
  assert.deepEqual(lines().filter((line) => /Hollis/.test(line) && /partners|cooled/.test(line)), [], "no stage line for an ask");
  assert.deepEqual(held.heldStepNotes(world.campaign()), [], "the GM is not asked to answer it mid-fight");
});

await test("an AI turn reaching the tool mid-fight is held too, and told it will be reminded", async () => {
  const { world, bond, ask } = await table();
  await world.beginFight([{ monster: "goblin" }]);
  const turn = turns.createDmTurn(world.campaignId, [], "ai");
  const out = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "romance_advance", args: ask });
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.note, /When the fight ends you are told to have them answer it\./);
  assert.equal(heldStepOf(bond().id).to, "together");
});

await test("a skipped rung asked mid-fight is refused as it always was, and nothing is held", async () => {
  const { world, bond, ask } = await table();
  await world.beginFight([{ monster: "goblin" }]);
  const out = await world.invoke("romance_advance", { ...ask, to: "married" });
  assert.equal(out.ok, false);
  assert.match(out.error, /one step at a time/);
  assert.equal(heldStepOf(bond().id), null);
});

await test("a step romance's exclusivity refuses is refused mid-fight too, not held to be refused after it (issue 642)", async () => {
  const { world, hero, bond, ask } = await table();
  await world.invoke("set_npc", { name: "Mira", gender: "Female" });
  const other = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: hero.id, characterName: "Vex", subjectKind: "npc", subjectName: "Mira" });
  relationships.patchRelationship(other.id, { approval: 80, romance: "together" });
  await world.beginFight([{ monster: "goblin" }]);
  const out = await world.invoke("romance_advance", ask);
  assert.equal(out.ok, false);
  assert.match(out.error, /Vex is with Mira/);
  assert.equal(heldStepOf(bond().id), null, "nothing is held for after the fight");
});

await test("the fight's end tells the GM in its result, and the turns after carry it as a director note", async () => {
  const { world, hero, ask, call } = await table();
  await world.beginFight([{ monster: "goblin" }]);
  await world.invoke("romance_advance", ask);
  const ended = await world.invoke("end_encounter", { outcome: "enemies_fled" });
  assert.equal(ended.ok, true, ended.error);
  const cue = `In the fight, Vex asked Hollis to be partners ("I want us to be together."), and Hollis said they would answer when it was safe. The fight is over: have Hollis bring it up and answer now. Call romance_advance (characterId ${hero.id}, subject Hollis, to together) before narrating the answer; the server decides it.`;
  assert.equal(ended.result.answerOwed, cue);
  assert.deepEqual(held.heldStepNotes(world.campaign()), [cue]);
  assert.equal(held.romanceAnswerOwed(world.campaign()), true, "the compact profile offers the romance tool's group");
  const view = await call("GET", "campaigns/[campaignId]/relationships");
  assert.equal(view.status, 200);
  const row = view.json.relationships.find((entry) => entry.subjectName === "Hollis");
  assert.deepEqual(row.heldStep, { to: "together" }, "the console's Waiting on you reads it");

  // The next AI turn's prompt carries it.
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: "The last goblin's footsteps fade into the trees." })]);
  await model.turn(world, "I lower my sword.", hero.id);
  model.close();
  const prompt = JSON.stringify(model.requests[0].messages);
  assert.ok(prompt.includes("DIRECTOR NOTES"), "a director note block");
  assert.ok(prompt.includes("have Hollis bring it up and answer now"), "with the held ask in it");
});

await test("the lead's force-end of a fight releases a held step too", async () => {
  const { world, call, ask } = await table();
  await world.beginFight([{ monster: "goblin" }]);
  await world.invoke("romance_advance", ask);
  const ended = await call("DELETE", "campaigns/[campaignId]/encounter");
  assert.equal(ended.status, 200, JSON.stringify(ended.json));
  assert.equal(world.encounter(), null);
  assert.equal(held.heldStepNotes(world.campaign()).length, 1);
});

await test("answering after the fight rolls it, clears the hold and tells the table", async () => {
  const { world, bond, ask, lines, call } = await table();
  await world.beginFight([{ monster: "goblin" }]);
  await world.invoke("romance_advance", ask);
  await world.invoke("end_encounter", { outcome: "enemies_fled" });
  const answer = await world.invoke("romance_advance", ask);
  assert.equal(answer.ok, true, answer.error);
  assert.equal(answer.result.accepted, true);
  assert.equal(bond().romance, "together");
  assert.equal(heldStepOf(bond().id), null);
  assert.deepEqual(held.heldStepNotes(world.campaign()), []);
  assert.ok(lines().includes("Vex and Hollis became partners."));
  const view = await call("GET", "campaigns/[campaignId]/relationships");
  assert.equal(view.json.relationships.find((entry) => entry.subjectName === "Hollis").heldStep, undefined);
});

await test("a refusal answers it as surely as a yes", async () => {
  const { world, bond, ask } = await table();
  relationships.patchRelationship(bond().id, { approval: 71 });
  await world.beginFight([{ monster: "goblin" }]);
  await world.invoke("romance_advance", ask);
  await world.invoke("end_encounter", { outcome: "enemies_fled" });
  world.dice(1);
  const answer = await world.invoke("romance_advance", ask);
  world.clearDice();
  assert.equal(answer.ok, true, answer.error);
  assert.equal(answer.result.accepted, false);
  assert.equal(heldStepOf(bond().id), null);
});

await test("left unanswered for its turns the reminder stops; a person's console still lists it", async () => {
  const { world, ask } = await table();
  await world.beginFight([{ monster: "goblin" }]);
  await world.invoke("romance_advance", ask);
  await world.invoke("end_encounter", { outcome: "enemies_fled" });
  for (let turn = 0; turn < logic.ANSWER_TURNS; turn += 1) {
    bumpAiTurns(world.campaignId);
  }
  assert.deepEqual(held.heldStepNotes(world.campaign()), []);
  assert.equal(held.romanceAnswerOwed(world.campaign()), false);
  assert.equal(held.heldAsks(world.campaign()).size, 1);
});

await test("a step the story moved past is owed nothing, and a second fight holds the reminder back", async () => {
  const { world, bond, ask } = await table();
  await world.beginFight([{ monster: "goblin" }]);
  await world.invoke("romance_advance", ask);
  await world.invoke("end_encounter", { outcome: "enemies_fled" });
  await world.beginFight([{ monster: "goblin" }]);
  assert.deepEqual(held.heldStepNotes(world.campaign()), [], "not while the next fight runs");
  await world.invoke("end_encounter", { outcome: "enemies_fled" });
  assert.equal(held.heldStepNotes(world.campaign()).length, 1, "owed again after it");
  relationships.patchRelationship(bond().id, { romance: "interested" });
  assert.deepEqual(held.heldStepNotes(world.campaign()), [], "it slipped since: nothing left to answer");
  assert.equal(held.heldAsks(world.campaign()).size, 0);
});

await test("the seam: a step the claims reader finds in a fight is held the same way, and only in a fight with romance on", async () => {
  const { world, bond } = await table();
  assert.equal(held.holdRomanceStep(world.campaign(), bond(), "together", "Marry me after this.", "claim"), null, "no fight, nothing to hold");
  await world.beginFight([{ monster: "goblin" }]);
  const step = held.holdRomanceStep(world.campaign(), bond(), "together", "Be mine after this.", "claim");
  assert.equal(step.source, "claim");
  assert.equal(heldStepOf(bond().id).note, "Be mine after this.");
  assert.equal(held.holdRomanceStep(world.campaign(), bond(), "married", "", "claim"), null, "not the next rung");

  const off = await table({ gameSettings: { romance: "off" } });
  await off.world.beginFight([{ monster: "goblin" }]);
  assert.equal(held.holdRomanceStep(off.world.campaign(), off.bond(), "together", "", "claim"), null, "romance off");
});

finish();
