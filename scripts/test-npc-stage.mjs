// The stage (docs/specs/ogm-npc-ego.md, src/lib/dm/npc-stage.ts): at a staged
// table the engine gives every first-tier mind in the scene its turn, a
// referee decides how each action ends, the server rolls and records it, and
// the narrator is handed the facts. Deterministic: the models are scripted.
import assert from "node:assert/strict";
import { openWorld, dice } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-npc-stage");
const logic = await import("../src/lib/dm/npc-stage-logic.ts");
const minds = await import("../src/lib/db/npc-minds.ts");
const { upsertNpc, getNpcByName, setNpcState } = await import("../src/lib/db/npcs.ts");
const { getClock } = await import("../src/lib/db/clock.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true, npcStage: true } });
const model = await fakeModel();
model.pointAt(world);
const brakk = world.addHero({ name: "Brakk", race: "half-orc", class: "barbarian" });

const bare = { custody: "free", heldBy: "", restraint: "none", condition: "up", withParty: true, disarmed: false, carries: [] };
const npc = (name, state = {}) => {
  const row = upsertNpc({ campaignId: world.campaignId, name });
  minds.setNpcTier(row.id, "primary");
  setNpcState(row.id, { ...bare, ...state });
  return row;
};
const sheetOf = (name) => getNpcByName(world.campaignId, name).state;
const json = (value) => reply({ text: JSON.stringify(value) });
const voice = (deed) => reply({ text: `SAY: nulla\nDO: ${deed}\nTHINK: nulla\nLYING: no` });
const ego = (intent, speech = "") => json({ speech, intent, conclusion: "", lie: false });
const textOf = (request) => request.messages.map((message) => String(message.content ?? "")).join("\n");
const sentTo = (start) => model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith(start));

await test("pure rules: the order rotates, the die picks the branch, a thing changes hands by its words", () => {
  const cast = [{ name: "Volodar" }, { name: "Amleth" }, { name: "Kranz" }];
  assert.deepEqual(logic.stageOrder(cast, 0).map((entry) => entry.name), ["Amleth", "Kranz", "Volodar"]);
  assert.deepEqual(logic.stageOrder(cast, 4).map((entry) => entry.name), ["Kranz", "Volodar", "Amleth"]);
  const parsed = logic.parseRuling(JSON.stringify({ uncertain: true, dc: 14, modifier: 9, hero: "", success: { outcome: "Presa.", changes: [{ name: "Kranz", gains: ["la chiave"], condition: "dead" }] }, failure: { outcome: "Respinto.", changes: [] } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ruling.modifier, 4, "the modifier is held to its range");
  assert.equal(parsed.ruling.success.changes[0].condition, "", "the referee never kills");
  assert.equal(logic.settleRuling(parsed.ruling, 10).succeeded, true);
  assert.equal(logic.settleRuling(parsed.ruling, 9).branch.outcome, "Respinto.");
  assert.equal(logic.settleRuling({ ...parsed.ruling, uncertain: false }, 1).succeeded, true, "nothing to roll");
  assert.equal(logic.parseRuling("no").ok, false);
  assert.deepEqual(logic.carriesAfter(["la chiave del barile d'acqua", "una balestra"], { gains: [], loses: ["la chiave del barile"] }), ["una balestra"]);
  assert.deepEqual(logic.carriesAfter(["una balestra"], { gains: ["la chiave del barile d'acqua", "una balestra"], loses: [] }), ["una balestra", "la chiave del barile d'acqua"]);
});

await test("the engine gives each mind on stage its turn, the referee's ruling is rolled and recorded, and the narrator gets facts", async () => {
  const now = getClock(world.campaignId).instant;
  npc("Amleth", { drankAt: now - 40 * 60 });
  npc("Volodar", { carries: ["la chiave del barile d'acqua"], drankAt: now - 40 * 60 });
  const before = model.requests.length;
  // The order depends on the turn count: both minds get the same script, and
  // the checks read what was asked.
  const oneTurn = [voice("Faccio qualcosa."), ego("Strappo la chiave a chi la tiene, o bevo dal barile.")];
  const drink = json({ uncertain: false, dc: 5, modifier: 0, hero: "", success: { outcome: "Amleth beve un lungo sorso dal barile aperto.", changes: [{ name: "Amleth", drank: true }] }, failure: { outcome: "", changes: [] } });
  const grab = json({
    uncertain: true,
    dc: 12,
    modifier: 1,
    hero: "",
    success: { outcome: "Amleth strappa la chiave dal pugno di Volodar.", changes: [{ name: "Amleth", gains: ["la chiave del barile d'acqua"] }, { name: "Volodar", loses: ["la chiave del barile"] }] },
    failure: { outcome: "Volodar respinge Amleth e tiene la chiave.", changes: [] },
  });
  model.script([reply({ text: "Brakk resta seduto a guardare il barile." }), ...oneTurn, grab, ...oneTurn, drink, reply({ text: "La chiave cambia mano; poi qualcuno beve." })]);
  dice(15);
  const dm = await model.turn(world, "Resto seduto e guardo.", brakk.id);
  assert.match(dm.content, /La chiave cambia mano/);
  const referee = sentTo("You are the referee").slice(-2);
  assert.equal(referee.length, 2, "one ruling for each mind");
  assert.match(textOf(referee[0]), /Volodar: .*has: la chiave del barile d'acqua/s, "the referee sees who really has what");
  assert.match(textOf(referee[1]), /Already happened in this same moment:\n- .*strappa la chiave/, "the second ruling stands on the first");
  const asked = model.requests.slice(before).filter((request) => String(request.messages?.[0]?.content ?? "").startsWith("You are one character"));
  assert.equal(asked.length, 2, "both minds were asked, by the engine");
  assert.match(textOf(asked[0]), /Brakk resta seduto a guardare il barile/, "a mind perceives what the table was told");
  assert.match(textOf(asked[1]), /Since then, in this same moment.*strappa la chiave/s, "and what the mind before it did");
  assert.deepEqual(sheetOf("Amleth").carries, ["la chiave del barile d'acqua"], "16 against 12: the key changed hands on the record");
  assert.deepEqual(sheetOf("Volodar").carries, []);
  assert.equal(sheetOf("Amleth").drankAt, now, "the drink is recorded");
  assert.equal(sheetOf("Volodar").drankAt, now - 40 * 60);
  const note = textOf(model.requests.at(-1));
  assert.match(note, /These are facts now/);
  assert.match(note, /1\. .*strappa la chiave dal pugno di Volodar\. \(the die: 16 against 12\)/);
  assert.match(note, /2\. .*beve un lungo sorso/);
  assert.match(note, /This table runs a stage/, "the narrator's rules say who runs the minds");
  const told = minds.listNpcMemories(world.campaignId, getNpcByName(world.campaignId, "Volodar").id).map((entry) => entry.content).join("\n");
  assert.match(told, /beve un lungo sorso/, "those on stage learn how each action ended");
});

await test("an action aimed at a hero is left to the table as an attempt, and a silent mind is named", async () => {
  const aimed = json({ uncertain: false, dc: 5, modifier: 0, hero: "Brakk", success: { outcome: "Punta il coltello contro Brakk per avere l'acqua.", changes: [{ name: "Brakk", condition: "wounded" }] }, failure: { outcome: "", changes: [] } });
  model.script([reply({ text: "Brakk beve." }), voice("Punto il coltello."), ego("Punto il coltello contro Brakk."), aimed, reply({ text: "" }), reply({ text: "Il coltello è puntato; l'altro tace." }), reply({ text: "Fine." })]);
  await model.turn(world, "Bevo.", brakk.id);
  const notes = model.requests.map(textOf).filter((text) => text.includes("These are facts now"));
  assert.match(notes.at(-1), /\[aimed at Brakk: an attempt on a hero; resolve it with your tools now/);
  assert.match(notes.at(-1), /did not answer this turn/);
});

model.close();
finish();
