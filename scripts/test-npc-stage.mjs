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
const { listSheets, patchSheet } = await import("../src/lib/db/sheets.ts");
const { grantItemMath } = await import("../src/lib/dm/mutation-math.ts");
const { npcThings } = await import("../src/lib/db/cast-sheets.ts");
const { withoutLeadingStopWords } = await import("../src/lib/language/language.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const italian = (thing) => withoutLeadingStopWords(textKey(thing), "italian");

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
const thingsOf = (name) => npcThings(getNpcByName(world.campaignId, name));
const json = (value) => reply({ text: JSON.stringify(value) });
const ego = (intent, speech = "") => json({ speech, intent, conclusion: "", lie: false });
const textOf = (request) => request.messages.map((message) => String(message.content ?? "")).join("\n");
const sentTo = (start) => model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith(start));

await test("pure rules: the order rotates, the die picks the branch, a thing changes hands by its words", () => {
  const cast = [{ name: "Volodar" }, { name: "Amleth" }, { name: "Kranz" }];
  assert.deepEqual(logic.stageOrder(cast, 0).map((entry) => entry.name), ["Amleth", "Kranz", "Volodar"]);
  assert.deepEqual(logic.stageOrder(cast, 4).map((entry) => entry.name), ["Kranz", "Volodar", "Amleth"]);
  const parsed = logic.parseRuling(JSON.stringify({ uncertain: true, dc: 14, modifier: 9, hero: "", success: { outcome: "Presa.", changes: [{ name: "Kranz", condition: "dead" }], moves: [{ thing: "la chiave", from: "", to: "Kranz" }, { thing: "", from: "Kranz", to: "" }] }, failure: { outcome: "Respinto.", changes: [] } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ruling.modifier, 4, "the modifier is held to its range");
  assert.equal(parsed.ruling.success.changes[0].condition, "", "the referee never kills");
  assert.deepEqual(parsed.ruling.success.moves, [{ thing: "la chiave", from: "", to: "Kranz" }], "a move without a thing is dropped");
  assert.deepEqual(parsed.ruling.failure.moves, []);
  assert.equal(logic.settleRuling(parsed.ruling, 10).succeeded, true);
  assert.equal(logic.settleRuling(parsed.ruling, 9).branch.outcome, "Respinto.");
  assert.equal(logic.settleRuling({ ...parsed.ruling, uncertain: false }, 1).succeeded, true, "nothing to roll");
  assert.equal(logic.parseRuling("no").ok, false);
  assert.equal(logic.thingNamed(["la chiave del barile d'acqua", "una balestra"], "la chiave del barile"), "la chiave del barile d'acqua");
  assert.equal(logic.thingNamed(["una chiave grande", "una chiave d'ottone"], "chiave"), null, "two lines fit: nothing is guessed");
});

await test("the engine gives each mind on stage its turn, the referee's ruling is rolled and recorded, and the narrator gets facts", async () => {
  const now = getClock(world.campaignId).instant;
  npc("Amleth", { drankAt: now - 40 * 60 });
  npc("Volodar", { carries: ["la chiave del barile d'acqua"], drankAt: now - 40 * 60 });
  const before = model.requests.length;
  // The order depends on the turn count: both minds get the same script, and
  // the checks read what was asked.
  // A mind's reply already in the engine's terms needs no Ego: the two minds
  // answer side by side in any order, so their replies are the same.
  const oneTurn = ego("Strappo la chiave a chi la tiene, o bevo dal barile.");
  const drink = json({ uncertain: false, dc: 5, modifier: 0, hero: "", success: { outcome: "Amleth beve un lungo sorso dal barile aperto.", changes: [{ name: "Amleth", drank: true }] }, failure: { outcome: "", changes: [] } });
  const grab = json({
    uncertain: true,
    dc: 12,
    modifier: 1,
    hero: "",
    success: { outcome: "Amleth strappa la chiave dal pugno di Volodar.", changes: [], moves: [{ thing: "la chiave del barile", from: "Volodar", to: "Amleth" }] },
    failure: { outcome: "Volodar respinge Amleth e tiene la chiave.", changes: [] },
  });
  // The minds answer side by side, then the referee rules in order.
  model.script([reply({ text: "Brakk resta seduto a guardare il barile." }), oneTurn, oneTurn, grab, drink, reply({ text: "La chiave cambia mano; poi qualcuno beve." })]);
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
  assert.match(textOf(asked[1]), /Brakk resta seduto a guardare il barile/, "every mind perceives the same moment");
  assert.deepEqual(thingsOf("Amleth"), ["la chiave del barile d'acqua"], "16 against 12: the key changed hands on the server's sheets");
  assert.deepEqual(thingsOf("Volodar"), []);
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
  // One mind answers, the other's reply is empty: either may be first.
  model.script([reply({ text: "Brakk beve." }), ego("Punto il coltello contro Brakk."), reply({ text: "" }), aimed, reply({ text: "Il coltello è puntato; l'altro tace." }), reply({ text: "Fine." })]);
  await model.turn(world, "Bevo.", brakk.id);
  const notes = model.requests.map(textOf).filter((text) => text.includes("These are facts now"));
  assert.match(notes.at(-1), /\[aimed at Brakk: an attempt on a hero; resolve it with your tools now/);
  assert.match(notes.at(-1), /did not answer this turn/);
});

await test("pure rules: a hero only gains what the actor really carried and gives up; the heroes' own words reach every mind", () => {
  assert.equal(logic.thingNamed(["una bottiglia di rum", "un remo"], "la bottiglia di rum", italian), "una bottiglia di rum", "the article does not hide a thing");
  const people = [{ name: "Brakk", state: "", carries: ["Pesce"], hero: true }, { name: "Mairon", state: "", carries: ["una bottiglia di rum"] }, { name: "Kranz", state: "", carries: [] }];
  assert.deepEqual(logic.planMove({ thing: "la bottiglia di rum", from: "Mairon", to: "Brakk" }, "Mairon", people), { kind: "hand", thing: "la bottiglia di rum", from: "Mairon", to: "Brakk" });
  assert.equal(logic.planMove({ thing: "la bottiglia di rum", from: "Mairon", to: "Brakk" }, "Kranz", people).kind, "refused", "only the actor's own moves");
  assert.equal(logic.planMove({ thing: "Pesce", from: "Brakk", to: "Mairon" }, "Mairon", people).kind, "refused", "the stage never takes from a hero");
  const offered = [{ name: "Brakk", text: "Brakk porge il suo pesce a Mairon: «Mangia.»" }];
  assert.equal(logic.planMove({ thing: "il pesce", from: "Brakk", to: "Mairon" }, "Mairon", people, offered, italian).kind, "hand", "a thing the hero offered in their own words, the actor takes");
  assert.equal(logic.planMove({ thing: "il pesce", from: "Brakk", to: "Kranz" }, "Kranz", people, [{ name: "Brakk", text: "Guardo il mare." }], italian).kind, "refused", "a thing the hero never named stays theirs");
  const pack = [{ name: "Brakk", state: "", carries: ["una bussola d'ottone", "Pesce"], hero: true }, ...people.slice(1)];
  assert.equal(logic.planMove({ thing: "la bussola d'ottone", from: "Brakk", to: "Mairon" }, "Mairon", pack, [{ name: "Brakk", text: "Poi porge la bussola a Mairon: «Tua.»" }], italian).kind, "hand", "its first word names it when nothing else of theirs shares it");
  const recorded = [{ thing: "Quarto di pesce crudo", from: "Brakk", to: "Amleth" }];
  assert.equal(logic.takeRecorded({ thing: "il quarto di pesce crudo", from: "Brakk", to: "Amleth" }, recorded, italian), true, "the master's own hand-over is the one the referee tells");
  assert.equal(logic.takeRecorded({ thing: "il quarto di pesce crudo", from: "Brakk", to: "Amleth" }, recorded, italian), false, "and it answers once: a second is a second");
  assert.equal(logic.takeRecorded({ thing: "il quarto di pesce crudo", from: "Brakk", to: "Volodar" }, [{ thing: "Quarto di pesce crudo", from: "Brakk", to: "Amleth" }], italian), false, "another taker is another move");
  const two = [{ name: "Brakk", state: "", carries: ["una bussola d'ottone", "una bussola rotta"], hero: true }, ...people.slice(1)];
  assert.equal(logic.planMove({ thing: "la bussola d'ottone", from: "Brakk", to: "Mairon" }, "Mairon", two, [{ name: "Brakk", text: "Porge la bussola a Mairon." }], italian).kind, "refused", "but not when two of their things share it");
  assert.equal(logic.planMove({ thing: "il pesce", from: "Brakk", to: "Kranz" }, "Mairon", people, offered, italian).kind, "refused", "and only the actor takes it");
  assert.equal(logic.planMove({ thing: "un tesoro", from: "", to: "Brakk" }, "Mairon", people).kind, "refused", "nothing made up for a hero");
  assert.equal(logic.planMove({ thing: "un pesce", from: "", to: "Mairon" }, "Mairon", people).kind, "grant", "a character finds a thing");
  assert.equal(logic.planMove({ thing: "il remo", from: "Mairon", to: "" }, "Mairon", people).kind, "remove", "and loses one");
  assert.equal(logic.planMove({ thing: "il remo", from: "Mairon", to: "Ugo" }, "Mairon", people).kind, "refused", "only people present");
  const senses = logic.stageSenses("La zattera dondola. ".repeat(120), [], [{ name: "Brakk", text: "Mairon, passami il rum. Divido il pesce in sette pezzi." }]);
  assert.match(senses, /^What the heroes just did and said, in their own words[^\n]*\n- Brakk: Mairon, passami il rum\. Divido il pesce in sette pezzi\./, "the hero's own words come first and whole");
  assert.ok(senses.length <= 2000, "it still fits npc_speak's perceives");
  const prompt = logic.renderRefereePrompt({ actor: "Mairon", intent: "porgo il rum", speech: "", people: [], scene: "", facts: [], heroLines: [{ name: "Brakk", text: "Mairon, passami il rum." }] });
  assert.match(prompt, /What the heroes did and said this turn, in their own words:\n- Brakk: Mairon, passami il rum\./);
  const note = logic.stageNote([{ actor: "Mairon", speech: "", outcome: "Mairon getta il remo.", roll: "", hero: "", undone: ["il remo: Mairon has no remo"] }], [], [{ thing: "una bottiglia di rum", from: "Mairon", to: "Brakk" }]);
  assert.match(note, /Already recorded, do not record again: Mairon → Brakk: una bottiglia di rum/);
  assert.match(note, /the engine could not record: il remo: Mairon has no remo; tell it as not happening/);
  assert.match(note, /If it left out something a hero did or said this turn, tell that first/);
});

await test("the rum: a hero asks a mind for its thing; the mind hears the hero's words, the referee sees the hero's pack, and the hand-over reaches the sheet", async () => {
  // Mairon alone on stage, so the one ruling scripted is his.
  for (const name of ["Amleth", "Volodar"]) {
    minds.setNpcTier(getNpcByName(world.campaignId, name).id, "secondary");
  }
  npc("Mairon", { carries: ["una bottiglia di rum"] });
  const own = listSheets(world.campaignId).find((sheet) => sheet.name === "Brakk");
  patchSheet(own.id, { equipment: grantItemMath(own.equipment, "Pesce", 1, { identified: true }).equipment });
  const hand = ego("Porgo la bottiglia di rum a Brakk.", "Tieni, vecchio.");
  const ruling = json({
    uncertain: false,
    dc: 5,
    modifier: 0,
    hero: "",
    success: { outcome: "Mairon porge la bottiglia di rum a Brakk.", changes: [], moves: [{ thing: "bottiglia di rum", from: "Mairon", to: "Brakk" }] },
    failure: { outcome: "", changes: [] },
  });
  // The narrator's own retelling leaves the request out on purpose: the
  // minds must still hear it from the player's own line.
  model.script([reply({ text: "Il sole picchia sulla zattera." }), hand, ruling, reply({ text: "Il rum passa di mano." })]);
  await model.turn(world, "Mairon, passami il rum: ne ho bisogno. Poi divido il pesce in sette pezzi.", brakk.id);
  const asked = model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith("You are one character"));
  assert.equal(asked.length, 1, "the one mind on stage was asked");
  for (const request of asked) {
    assert.match(textOf(request), /- Brakk: Mairon, passami il rum: ne ho bisogno\. Poi divido il pesce in sette pezzi\./, "every mind hears the hero's own words, not only the retelling");
  }
  const referee = model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith("You are the referee"));
  assert.match(textOf(referee[0]), /- Brakk \(a hero\); has: [^\n]*Pesce/, "the referee sees what the hero really carries: the fish");
  assert.match(textOf(referee[0]), /- Brakk: Mairon, passami il rum/, "and what the hero asked");
  const pack = listSheets(world.campaignId).find((sheet) => sheet.name === "Brakk").equipment.map((item) => item.name);
  assert.equal(pack.filter((name) => /rum/i.test(name)).length, 1, "the rum is on Brakk's sheet, once, not twice");
  assert.ok(pack.includes("Pesce"), "and the fish is still his: the stage never takes from a hero");
  assert.deepEqual(thingsOf("Mairon"), [], "and gone from Mairon");
  const note = textOf(model.requests.at(-1));
  assert.match(note, /Already recorded, do not record again: Mairon → Brakk: una bottiglia di rum/);
  assert.match(note, /A hero giving their own thing is the hero's deed, not a request: record it now/, "the narrator keeps the hero's own deeds (the fish) on its side");
});

model.close();
finish();
