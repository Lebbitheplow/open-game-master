// The stage (docs/specs/ogm-npc-ego.md, src/lib/dm/npc-stage.ts): at a staged
// table the engine gives every first-tier mind in the scene its turn, a
// referee decides how each action ends, the server rolls and records it, and
// the narrator is handed the facts. Deterministic: the models are scripted.
import assert from "node:assert/strict";
import { openWorld, dice } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-npc-stage");
const logic = await import("../src/lib/dm/npc-stage-logic.ts");
const minds = await import("../src/lib/db/npc-minds.ts");
const { upsertNpc, getNpcByName, setNpcState } = await import("../src/lib/db/npcs.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { writeItems } = await import("../src/lib/owners/items.ts");
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

await test("pure rules: the order rotates, the die picks the branch, the referee moves no thing", () => {
  const cast = [{ name: "Volodar" }, { name: "Amleth" }, { name: "Kranz" }];
  assert.deepEqual(logic.stageOrder(cast, 0).map((entry) => entry.name), ["Amleth", "Kranz", "Volodar"]);
  assert.deepEqual(logic.stageOrder(cast, 4).map((entry) => entry.name), ["Kranz", "Volodar", "Amleth"]);
  const parsed = logic.parseRuling(JSON.stringify({ uncertain: true, dc: 14, modifier: 9, hero: "", success: { outcome: "Presa.", changes: [{ name: "Kranz", condition: "dead" }], moves: [{ thing: "la chiave", from: "", to: "Kranz" }, { thing: "", from: "Kranz", to: "" }] }, failure: { outcome: "Respinto.", changes: [] } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ruling.modifier, 4, "the modifier is held to its range");
  assert.equal(parsed.ruling.success.changes[0].condition, "", "the referee never kills");
  assert.equal("moves" in parsed.ruling.success, false, "who holds what is the items reader's, not the referee's");
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
    success: { outcome: "Amleth strappa la chiave dal pugno di Volodar.", changes: [] },
    failure: { outcome: "Volodar respinge Amleth e tiene la chiave.", changes: [] },
  });
  // The minds answer side by side, then the referee rules in order.
  model.script([reply({ text: "Brakk resta seduto a guardare il barile." }), oneTurn, oneTurn, grab, drink, reply({ text: "La chiave cambia mano; poi qualcuno beve." })]);
  model.items([json({ moves: [{ thing: "la chiave del barile", from: "Volodar", to: "Amleth" }] })]);
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
  const read = textOf(model.itemsRequests.at(-1));
  assert.match(read, /Volodar: la chiave del barile d'acqua/, "the items reader sees who held what");
  assert.match(read, /Amleth strappa la chiave dal pugno di Volodar/, "and what the stage decided");
  assert.match(read, /La chiave cambia mano/, "and how the narrator told it");
  assert.deepEqual(thingsOf("Amleth"), ["la chiave del barile d'acqua"], "16 against 12: the key changed hands on the server's sheets, recorded from the story");
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
  // docs/specs/ogm-npc-perception.md: every mind here keeps each event as it
  // took it in, the first to act too, and never a copy of the narrator's prose.
  for (const name of ["Amleth", "Volodar"]) {
    const kept = minds.listNpcMemories(world.campaignId, getNpcByName(world.campaignId, name).id).map((entry) => entry.content);
    assert.ok(kept.some((line) => line.startsWith("You saw: ")), `${name} keeps what the other did`);
    assert.ok(kept.some((line) => line.startsWith("You did: ")), `${name} keeps what it did`);
    assert.ok(!kept.some((line) => line.includes("Brakk resta seduto a guardare il barile")), `${name} keeps no copy of the narration`);
  }
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

await test("next turn each mind is handed what its senses took in since its last turn, the narration only as a line of mood", async () => {
  model.script([reply({ text: Array.from({ length: 30 }, (_, index) => `L'onda numero ${index + 1} batte sulle assi.`).join(" ") }), ego("Mi siedo."), ego("Mi siedo."), reply({ text: "Fine." })]);
  await model.turn(world, "Guardo il mare.", brakk.id);
  const asked = model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith("You are one character"));
  assert.equal(asked.length, 2);
  for (const request of asked) {
    const frame = textOf(request);
    assert.match(frame, /What you took in with your own senses since your last turn/);
    assert.match(frame, /Punta il coltello contro Brakk/, "last turn's deed is in both frames, the actor's and the silent one's");
    const mood = frame.match(/The mood of the moment, as the narrator tells it \(an impression, not a fact you witnessed\): (.*)/)?.[1] ?? "";
    assert.ok(mood.length > 0 && mood.length <= 300, "the narration is at most a line of mood");
  }
});

await test("pure rules: a thing is named by its words; the heroes' own words reach every mind", async () => {
  assert.equal(logic.thingNamed(["una bottiglia di rum", "un remo"], "la bottiglia di rum", italian), "una bottiglia di rum", "the article does not hide a thing");
  const events = await import("../src/lib/dm/scene-events-logic.ts");
  const own = events.perceivedLine({ actor: "Brakk", targets: [], speech: "", verb: "other", ownWords: true, outcome: "Mairon, passami il rum. Divido il pesce in sette pezzi." }, "Mairon", ["sight", "hearing"]);
  assert.match(own, /^Brakk, a hero, in their own words \(what they attempt[^)]*\): Mairon, passami il rum\. Divido il pesce in sette pezzi\./, "the hero's own words reach a mind whole, as an attempt");
  const prompt = logic.renderRefereePrompt({ actor: "Mairon", intent: "porgo il rum", speech: "", people: [], scene: "", facts: [], heroLines: [{ name: "Brakk", text: "Mairon, passami il rum." }] });
  assert.match(prompt, /What the heroes did and said this turn, in their own words:\n- Brakk: Mairon, passami il rum\./);
  const note = logic.stageNote([{ actor: "Mairon", speech: "", outcome: "Mairon getta il remo.", roll: "", hero: "" }], []);
  assert.match(note, /who holds which thing is recorded from your narration when the turn ends/);
  assert.match(note, /A thing new to the world in these outcomes \(a fish caught, something found\) is made now with grant_item/);
  assert.match(note, /If it left out something a hero did or said this turn, tell that first/);
});

await test("the rum: a hero asks a mind for its thing; the mind hears the hero's words, the referee sees the hero's pack, and the hand-over reaches the sheet", async () => {
  // Mairon alone on stage, so the one ruling scripted is his.
  for (const name of ["Amleth", "Volodar"]) {
    minds.setNpcTier(getNpcByName(world.campaignId, name).id, "secondary");
  }
  npc("Mairon", { carries: ["una bottiglia di rum"] });
  const own = listSheets(world.campaignId).find((sheet) => sheet.name === "Brakk");
  writeItems(own.id, { equipment: grantItemMath(own.equipment, "Pesce", 1, { identified: true }).equipment });
  const hand = ego("Porgo la bottiglia di rum a Brakk.", "Tieni, vecchio.");
  const ruling = json({
    uncertain: false,
    dc: 5,
    modifier: 0,
    hero: "",
    success: { outcome: "Mairon porge la bottiglia di rum a Brakk.", changes: [] },
    failure: { outcome: "", changes: [] },
  });
  // The narrator's own retelling leaves the request out on purpose: the
  // minds must still hear it from the player's own line.
  model.script([reply({ text: "Il sole picchia sulla zattera." }), hand, ruling, reply({ text: "Il rum passa di mano." })]);
  // The reader names the rum, and the fish too, as if misreading a plan for a deed:
  // the owner moves only what the giver holds, and the fish is still Brakk's to give.
  model.items([json({ moves: [{ thing: "bottiglia di rum", from: "Mairon", to: "Brakk" }, { thing: "la bottiglia di rum", from: "Mairon", to: "Brakk" }] })]);
  await model.turn(world, "Mairon, passami il rum: ne ho bisogno. Poi divido il pesce in sette pezzi.", brakk.id);
  const asked = model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith("You are one character"));
  assert.equal(asked.length, 1, "the one mind on stage was asked");
  for (const request of asked) {
    assert.match(textOf(request), /- Brakk, a hero, in their own words [^\n]*: Mairon, passami il rum: ne ho bisogno\. Poi divido il pesce in sette pezzi\./, "every mind hears the hero's own words, not only the retelling");
  }
  const referee = model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith("You are the referee"));
  assert.match(textOf(referee[0]), /- Brakk \(a hero\); has: [^\n]*Pesce/, "the referee sees what the hero really carries: the fish");
  assert.match(textOf(referee[0]), /- Brakk: Mairon, passami il rum/, "and what the hero asked");
  const pack = listSheets(world.campaignId).find((sheet) => sheet.name === "Brakk").equipment.map((item) => item.name);
  assert.equal(pack.filter((name) => /rum/i.test(name)).length, 1, "the rum is on Brakk's sheet, once, not twice");
  assert.ok(pack.includes("Pesce"), "and the fish is still his");
  assert.deepEqual(thingsOf("Mairon"), [], "and gone from Mairon");
  const note = textOf(model.requests.at(-1));
  assert.match(note, /A hero giving their own thing is the hero's deed, not a request: narrate it as done/, "the narrator tells the hero's own deeds; the record follows the story");
  assert.match(note, /never call handle_item "hand" or remove_item here/);
});

await test("the master does not move things at a staged table: hand and remove_item are refused with the reason", async () => {
  const { masterItemRefusal } = await import("../src/lib/dm/items-reader.ts");
  const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
  const campaign = getCampaignById(world.campaignId);
  assert.match(masterItemRefusal(campaign, "handle_item", JSON.stringify({ action: "hand" }))?.error ?? "", /recorded from your narration/);
  assert.match(masterItemRefusal(campaign, "remove_item", "{}")?.error ?? "", /recorded from your narration/);
  assert.equal(masterItemRefusal(campaign, "handle_item", JSON.stringify({ action: "equip" })), null, "putting a thing on is still the master's");
  assert.equal(masterItemRefusal(campaign, "grant_item", "{}"), null, "and making a new one");
  assert.equal(masterItemRefusal({ ...campaign, gameSettings: { ...campaign.gameSettings, npcStage: false } }, "remove_item", "{}"), null, "a table without a stage keeps its tools");
});

await test("a thing nobody has does not exist for the referee, and a mind hears the words it wore out", async () => {
  assert.match(logic.STAGE_REFEREE_SYSTEM, /nobody listed has and that is not lying here does not exist/);
  const { wornWords } = await import("../src/lib/dm/npc-mind-logic.ts");
  const { textKey } = await import("../src/lib/language/text-logic.ts");
  const mairon = [
    "Il mare è vasto, e ogni cosa è un dettaglio.",
    "Un voto è un voto, Brakk, e un giuramento è un legame.",
    "Il sole tramonta e il mare è vasto.",
    "Il mare è così grande che ogni cosa è un dettaglio.",
    "Un giuramento è più forte di un'ascia.",
    "Questo giuramento vale più del mare.",
  ];
  const worn = wornWords(mairon, textKey);
  assert.deepEqual(worn.slice(0, 2).sort(), ["giuramento", "mare"], JSON.stringify(worn));
  assert.ok(!worn.includes("ogni") && !worn.includes("dettaglio"), JSON.stringify(worn));
  assert.deepEqual(wornWords(["Ho sete.", "Dammi da bere."], textKey), []);
});

// The observer Zattera, 2026-11-17: after the stage's note the narrator
// asked the player a question with a call, said nothing more, and the turn
// closed on the hero's part alone: seven characters' turns never told.
await test("the stage's outcomes handed over and never told are narrated with tools closed", async () => {
  const hand = ego("Mi siedo accanto a Brakk.", "Bel silenzio.");
  const ruling = json({ uncertain: false, dc: 5, modifier: 0, hero: "", success: { outcome: "Mairon si siede accanto a Brakk.", changes: [] }, failure: { outcome: "", changes: [] } });
  const ask = reply({ calls: [call("request_player_input", { characterIds: [brakk.id], prompt: "Brakk, che fai?" })] });
  model.script([reply({ text: "Brakk resta in disparte." }), hand, ruling, ask, reply({ text: "«Bel silenzio» dice Mairon, sedendosi accanto a Brakk." })]);
  model.items([json({ moves: [] })]);
  const before = model.requests.length;
  await model.turn(world, "Brakk osserva in silenzio.", brakk.id);
  const { listRecentMessages } = await import("../src/lib/db/messages.ts");
  const told = listRecentMessages(world.campaignId, 4).filter((message) => message.authorType === "dm").map((message) => message.content).join("\n");
  assert.match(told, /Mairon, sedendosi accanto a Brakk/, `the stage was told (${model.requests.length - before} calls)`);
});

// The observer Zattera, 2026-11-17: food lay on the deck for hours while a
// starving mind begged the hero for some; neither it nor the referee saw it.
await test("where they stand and what lies there, as nobody's, are seen by every mind and by the referee", async () => {
  const { handleLocationCall } = await import("../src/lib/dm/turn.ts");
  const { insertDroppedItem } = await import("../src/lib/db/dropped-items.ts");
  const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
  handleLocationCall(getCampaignById(world.campaignId), "move_party", JSON.stringify({ name: "La zattera", visionClear: true }), false);
  insertDroppedItem({ campaignId: world.campaignId, mapId: null, x: null, y: null, place: "La zattera", item: { name: "Galletta", qty: 40 }, droppedBy: "", heldByEnemy: null });
  const take = ego("Prendo una galletta dalle assi e la mangio.");
  const ruling = json({ uncertain: false, dc: 5, modifier: 0, hero: "", success: { outcome: "Mairon prende una galletta dalle assi e la mangia.", changes: [] }, failure: { outcome: "", changes: [] } });
  model.script([reply({ text: "Il sole sale." }), take, ruling, reply({ text: "Mairon mangia una galletta presa dalle assi." })]);
  model.items([json({ moves: [] })]);
  await model.turn(world, "Brakk guarda il mare.", brakk.id);
  const mind = sentTo("You are one character").at(-1);
  assert.match(textOf(mind), /Lying here where you stand, belonging to nobody, for anyone to take: Galletta x40/);
  assert.match(textOf(sentTo("You are the referee").at(-1)), /Lying here, nobody's, for anyone to take: Galletta x40/);
  // And where they stand: the place, the hour, the sky (2026-11-17).
  assert.match(textOf(mind), /Where you are now: La zattera\. .*The hour: \d\d:00/s);
  assert.match(textOf(sentTo("You are the referee").at(-1)), /Where this happens: La zattera.*Hour \d\d:00/s);
});

await test("a hero's thing changing hands is an event the minds here see (perception slice 2)", async () => {
  const own = listSheets(world.campaignId).find((sheet) => sheet.name === "Brakk");
  writeItems(own.id, { equipment: grantItemMath(own.equipment, "Corda", 1, { identified: true }).equipment });
  const look = json({ uncertain: false, dc: 5, modifier: 0, hero: "", success: { outcome: "Mairon guarda la corda.", changes: [], event: { verb: "watch", targets: [], object: "", volume: "silent", covert: false } }, failure: { outcome: "", changes: [] } });
  model.script([reply({ text: "Brakk posa la Corda sulle assi." }), ego("Guardo la corda."), look, reply({ text: "Mairon guarda la corda." })]);
  model.items([json({ moves: [{ thing: "Corda", from: "Brakk", to: "ground" }] })]);
  await model.turn(world, "Poso la corda sulle assi.", brakk.id);
  const kept = minds.listNpcMemories(world.campaignId, getNpcByName(world.campaignId, "Mairon").id).map((entry) => entry.content);
  assert.ok(kept.includes("You saw: Brakk puts Corda down here."), kept.slice(-4).join(" | "));
  assert.ok(kept.some((line) => line.startsWith("Brakk, a hero, in their own words") && line.includes("Poso la corda")), "the hero's line, as an attempt");
});

model.close();
finish();
