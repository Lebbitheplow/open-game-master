// The party split up, through the engine the way a table reaches it (issue
// 951): a table split up and the GM folded both groups into one passage,
// because nothing kept who was where once move_party had answered.
//   - move_party naming who goes keeps the rest as a group elsewhere, and the
//     table reads the split as a line of its own;
//   - a turn's prompt says who the scene is with, and holds none of the lines
//     of those elsewhere; their reply is its own passage, after the scene has
//     cut to them;
//   - a call reaches only who is in the scene;
//   - a fight, a rest and a group check are the scene's;
//   - going where the others are ends the split.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { aiEngine, call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-party-split");
const { getParty } = await import("../src/lib/db/party.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const { getCurrentLocation } = await import("../src/lib/db/locations.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getNpcByName, upsertNpc } = await import("../src/lib/db/npcs.ts");
const model = await fakeModel();

// Four at the docks; Kael and Mira go to the mill, Bram and Tovin stay.
async function table({ split = true } = {}) {
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  model.pointAt(world);
  const [kael, mira, bram, tovin] = ["Kael", "Mira", "Bram", "Tovin"].map((name) => world.addHero({ name, class: "fighter", level: 3, maxHp: 30 }));
  const move = async (args) => {
    const out = await world.invoke("move_party", { visionClear: false, ...args });
    assert.equal(out.ok, true, out.error);
    return out.result;
  };
  await move({ name: "The Docks", layoutDescription: "A long quay under gulls, a chandler's shed at its end." });
  const splitNote = split ? (await move({ name: "The Old Mill", layoutDescription: "A leaning mill by a dry race.", characterIds: [kael.id, mira.id] })).note : "";
  const away = () => getParty(world.campaignId).away.map((group) => [group.place, group.ids]);
  const lines = (authorType) => listRecentMessages(world.campaignId, 60).filter((message) => message.authorType === authorType);
  const here = () => getCurrentLocation(world.campaignId)?.name;
  return { world, kael, mira, bram, tovin, move, away, lines, here, splitNote };
}

const prompt = (request) => request.messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");

await test("naming who goes keeps the rest elsewhere, and the table reads the split", async () => {
  const { world, kael, mira, bram, tovin, away, lines, here, splitNote } = await table();
  assert.deepEqual(away(), [["The Docks", [bram.id, tovin.id]]]);
  assert.equal(here(), "The Old Mill");
  assert.equal(world.campaign().party.away.length, 1, "the campaign the table loads carries it");
  assert.match(splitNote, /The party has split up: Kael and Mira went to The Old Mill, and Bram and Tovin stayed behind\./);
  assert.match(splitNote, /Elsewhere now: Bram and Tovin at The Docks\./);
  assert.deepEqual(lines("system").map((message) => message.content).filter((content) => /splits up/.test(content)), [
    "The party splits up: Kael and Mira go to The Old Mill, and Bram and Tovin stay at The Docks.",
  ]);
  void kael;
  void mira;
});

await test("the whole party moving, named or not, keeps nothing and says nothing", async () => {
  const { world, kael, mira, bram, tovin, move, away, lines } = await table({ split: false });
  await move({ name: "The Old Mill" });
  await move({ name: "The Crossroads", characterIds: [kael.id, mira.id, bram.id, tovin.id] });
  assert.deepEqual(away(), []);
  assert.equal(lines("system").some((message) => /splits up|Meanwhile|together again/.test(message.content)), false);
  void world;
});

const STAYS = { stays: [{ name: "Bram", quote: "I wait on the quay" }, { name: "Mira", quote: "Mira and Tovin stay with Bram" }, { name: "Tovin", quote: "Mira and Tovin stay with Bram" }], to: "the old mill" };

await test("the players' own words part the party: the storyteller is told, and its move of everyone is a move of those who go", async () => {
  const { world, kael, bram, away, lines, here } = await table({ split: false });
  world.say("player", "I wait on the quay and ask the fishermen about the tide.", bram);
  model.script([
    reply({ calls: [call("move_party", { name: "The Old Mill", layoutDescription: "A leaning mill by a dry race." })] }),
    reply({ text: "Kael slips through the mill's broken door." }),
    reply({ text: "The fishermen shrug: the tide turns at dusk." }),
  ]);
  model.parting([STAYS]);
  const dm = await model.turn(world, "Mira and Tovin stay with Bram. I go on alone to the old mill.", kael.id, kael.userId);
  assert.equal(dm.content, "Kael slips through the mill's broken door.");
  assert.equal(model.partingRequests.length, 1, "one read, as the turn opened");
  assert.match(model.partingRequests[0].messages[1].content, /^The party: Kael, Mira, Bram, Tovin\nThey are at: The Docks\nThe players' words:\n\[Bram\] I wait on the quay/);
  assert.match(prompt(model.requests[0]), /By the players' own words the party parts ways this turn: Mira, Bram and Tovin do not go with Kael\. When that one goes anywhere, your first call is move_party with the place and characterIds \["/);
  // Its move named nobody, and was read as Kael's.
  const told = model.results(model.requests[1]).at(-1).result.note;
  assert.match(told, /The party has split up: Kael went to The Old Mill, and Mira, Bram and Tovin stayed behind\./);
  assert.ok(lines("system").some((message) => message.content === "The party splits up: Kael goes to The Old Mill, and Mira, Bram and Tovin stay at The Docks."));
  // What Bram said in the same beat is still owed: the scene cuts to the docks for it.
  await settleQueue(world.campaignId);
  assert.equal(here(), "The Docks");
  assert.deepEqual(away(), [["The Old Mill", [kael.id]]]);
  assert.deepEqual(lines("dm").map((message) => message.content), ["Kael slips through the mill's broken door.", "The fishermen shrug: the tide turns at dusk."]);
  assert.equal(getParty(world.campaignId).parting, null, "the read is spent");
});

await test("a storyteller that records no move at all is put right by the server, at the place the players named", async () => {
  const { world, kael, mira, bram, tovin, away, lines, here } = await table({ split: false });
  model.script([reply({ text: "Kael slips off along the dry race toward the mill." })]);
  model.parting([STAYS]);
  const dm = await model.turn(world, "Mira and Tovin stay with Bram, I wait on the quay he says. I go on alone to the old mill.", kael.id, kael.userId);
  assert.equal(dm.content, "Kael slips off along the dry race toward the mill.");
  assert.equal(here(), "The old mill");
  assert.deepEqual(away(), [["The Docks", [mira.id, bram.id, tovin.id]]]);
  assert.ok(lines("system").some((message) => message.content === "The party splits up: Kael goes to The old mill, and Mira, Bram and Tovin stay at The Docks."));
  assert.equal(getParty(world.campaignId).parting, null);
  // With no place named there is nowhere to put the scene: the party stays as it was.
  const unnamed = await table({ split: false });
  model.script([reply({ text: "Kael slips off into the dusk." })]);
  model.parting([{ ...STAYS, to: "" }]);
  await model.turn(unnamed.world, "Mira and Tovin stay with Bram, I wait on the quay he says. I go on alone.", unnamed.kael.id, unnamed.kael.userId);
  assert.deepEqual(unnamed.away(), []);
  assert.equal(getParty(unnamed.world.campaignId).parting, null);
});

await test("the read is asked only where it can matter: not of speech alone, a party of one, or a table whose outcome check is off", async () => {
  const { world, kael, away } = await table({ split: false });
  model.script([reply({ calls: [call("move_party", { name: "The Old Mill" })] }), reply({ text: "The mill leans over its dry race." })]);
  model.parting([]);
  await model.turn(world, "We all walk up to the old mill.", kael.id, kael.userId);
  assert.equal(model.partingRequests.length, 1);
  assert.deepEqual(away(), []);
  assert.doesNotMatch(prompt(model.requests[0]), /parts ways/);
  model.script([reply({ text: "The miller's cat watches." })]);
  model.parting([]);
  await model.turn(world, '"Is anyone home?"', kael.id, kael.userId);
  assert.equal(model.partingRequests.length, 0, "words spoken aloud move nobody");
  const alone = await openWorld({ gameSettings: { ttsEnabled: false } });
  model.pointAt(alone);
  const hero = alone.addHero({ name: "Sola", class: "fighter", level: 3 });
  model.script([reply({ text: "Sola walks up to the mill." })]);
  model.parting([]);
  await model.turn(alone, "I walk up to the old mill.", hero.id, hero.userId);
  assert.equal(model.partingRequests.length, 0, "one character cannot part");
  const unchecked = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
  model.pointAt(unchecked);
  const [first] = ["Ada", "Bo"].map((name) => unchecked.addHero({ name, class: "fighter", level: 3 }));
  model.script([reply({ text: "They walk up to the mill." })]);
  model.parting([]);
  await model.turn(unchecked, "I walk up to the old mill.", first.id, first.userId);
  assert.equal(model.partingRequests.length, 0);
});

await test("the AI's own second move may say that only some came", async () => {
  const { world, kael, bram, away } = await table({ split: false });
  const ai = await aiEngine(world);
  const whole = await ai.invoke("move_party", { name: "The Old Mill", visionClear: false });
  assert.equal(whole.ok, true, whole.error);
  assert.deepEqual(away(), []);
  const only = await ai.invoke("move_party", { name: "The Old Mill", visionClear: false, characterIds: [kael.id] });
  assert.equal(only.ok, true, only.error);
  assert.deepEqual(away().map(([place, ids]) => [place, ids.length]), [["The Docks", 3]]);
  assert.ok(away()[0][1].includes(bram.id));
  assert.match(only.result.note, /The party has split up: Kael went to The Old Mill, and Mira, Bram and Tovin stayed behind\./);
});

await test("a room-to-room move while split moves those in the scene; going where the others are ends the split", async () => {
  const { bram, tovin, move, away, lines, here } = await table();
  const cellar = await move({ name: "The Mill Cellar" });
  assert.deepEqual(away(), [["The Docks", [bram.id, tovin.id]]]);
  assert.match(cellar.note, /Elsewhere now: Bram and Tovin at The Docks\./);
  const back = await move({ name: "The Docks" });
  assert.deepEqual(away(), []);
  assert.equal(here(), "The Docks");
  assert.match(back.note, /The party is back together at The Docks: everyone is in this scene again\./);
  assert.equal(lines("system").at(-1).content, "The party is together again at The Docks.");
});

await test("a turn's prompt says who the scene is with, and holds none of the lines of those elsewhere", async () => {
  const { world, kael, bram, away, lines } = await table();
  world.say("player", "I pick the lock on the chandler's shed.", bram);
  model.script([reply({ text: "Dust hangs in the mill's one shaft of light." }), reply({ text: "The shed's lock gives with a dry click." })]);
  const first = await model.turn(world, "I search the mill for tracks.", kael.id, kael.userId);
  assert.equal(first.content, "Dust hangs in the mill's one shaft of light.");
  const asked = prompt(model.requests[0]);
  assert.match(asked, /The party is split up\. In this scene, at The Old Mill: Kael and Mira\. Elsewhere: Bram and Tovin at The Docks\./);
  assert.match(asked, /NOT IN THIS SCENE: elsewhere, at The Docks\./);
  assert.match(asked, /I search the mill for tracks\./);
  assert.doesNotMatch(asked, /I pick the lock/, "Bram's move waits for the scene to come to him");

  // The reply owed to the docks follows as its own passage, after a cut.
  await settleQueue(world.campaignId);
  assert.equal(model.requests.length, 2, "one model call a group");
  assert.deepEqual(away(), [["The Old Mill", [kael.id, world.sheets().find((sheet) => sheet.name === "Mira").id]]]);
  const second = prompt(model.requests[1]);
  assert.match(second, /In this scene, at The Docks: Bram and Tovin\. Elsewhere: Kael and Mira at The Old Mill\./);
  assert.match(second, /Current location: The Docks/);
  const tail = model.requests[1].messages.slice(-3).map((message) => message.content);
  assert.match(tail.join("\n"), /\[Table note\] Meanwhile, at The Docks: Bram and Tovin\.[\s\S]*I pick the lock on the chandler's shed\./, "his move is the newest line, after the cut");
  assert.deepEqual(lines("dm").map((message) => message.content), ["Dust hangs in the mill's one shaft of light.", "The shed's lock gives with a dry click."]);
});

await test("a move by someone elsewhere, alone, cuts the scene to them before the reply", async () => {
  const { world, kael, bram, away, here } = await table();
  model.script([reply({ text: "Bram shoulders the shed door open." })]);
  const dm = await model.turn(world, "I force the shed door.", bram.id, bram.userId);
  assert.equal(dm.content, "Bram shoulders the shed door open.");
  assert.equal(here(), "The Docks");
  assert.deepEqual(away().map(([place]) => place), ["The Old Mill"]);
  assert.equal(model.requests.length, 1);
  assert.match(prompt(model.requests[0]), /In this scene, at The Docks: Bram and Tovin\./);
  void kael;
});

await test("a call reaches only who is in the scene, whoever sends it", async () => {
  const { world, kael, bram, tovin } = await table();
  const ai = await aiEngine(world);
  const refused = await ai.invoke("request_roll", { characterId: bram.id, kind: "skill_check", skill: "perception", dc: 12, reason: "listening at the door" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /^Bram is not in this scene: the party is split up, and they are at The Docks\./);
  assert.match(refused.error, /move_party \(name "The Docks", characterIds /);
  const console = await world.invoke("heal", { characterId: tovin.id, amount: 4 });
  assert.equal(console.ok, false);
  assert.match(console.error, /^Tovin is not in this scene/);
  // Those in the scene, and the bookkeeping that reaches nowhere.
  const here = await world.invoke("heal", { characterId: kael.id, amount: 1 });
  assert.equal(here.ok, true, here.error);
  const xp = await world.invoke("party_award", { characterIds: [kael.id, bram.id], xp: 50, reason: "the night's work" });
  assert.equal(xp.ok, true, xp.error);
});

await test("a fight is where the scene is: those elsewhere are not at it", async () => {
  const { world, bram, tovin, away } = await table();
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(started.ok, true, started.error);
  assert.deepEqual([...world.encounter().awayIds].sort(), [bram.id, tovin.id].sort());
  const rolled = () => world.encounter().order.flatMap((entry) => entry.characterId ?? []);
  assert.equal(rolled().some((id) => id === bram.id || id === tovin.id), false, "nobody elsewhere was asked to roll");
  // Bram runs in: his initiative roll brings him to the fight, and so to the scene.
  const arrived = await world.invoke("request_roll", { characterId: bram.id, kind: "initiative", reason: "initiative" });
  assert.equal(arrived.ok, true, arrived.error);
  assert.deepEqual(world.encounter().awayIds, [tovin.id]);
  assert.deepEqual(away(), [["The Docks", [tovin.id]]]);
});

await test("a rest is the scene's, and one taken while the scene was elsewhere passes no more time", async () => {
  const { world, kael, mira, bram, tovin, move, away } = await table();
  for (const hero of [kael, mira, bram, tovin]) {
    world.patch(hero.id, { currentHp: 5 });
  }
  const before = getClock(world.campaignId).instant;
  const night = await world.invoke("take_rest", { kind: "long" });
  assert.equal(night.ok, true, night.error);
  assert.equal(getClock(world.campaignId).instant - before, 480);
  assert.equal(world.sheet(kael.id).currentHp, 30);
  assert.equal(world.sheet(bram.id).currentHp, 5, "Bram is at the docks: this was not his rest");
  // The scene cuts to the docks, eight hours behind.
  await move({ name: "The Docks", characterIds: [bram.id, tovin.id] });
  assert.deepEqual(away().map(([place]) => place), ["The Old Mill"]);
  assert.equal(getParty(world.campaignId).cut.behind, 480);
  const theirs = await world.invoke("take_rest", { kind: "long" });
  assert.equal(theirs.ok, true, theirs.error);
  assert.equal(getClock(world.campaignId).instant - before, 480, "their night was the same night");
  assert.match(theirs.result.note, /They took the 8 hours while the scene was elsewhere, so no more time passed\./);
  assert.equal(world.sheet(bram.id).currentHp, 30);
  // That time is spent: another rest passes its own hours.
  const again = await world.invoke("take_rest", { kind: "short" });
  assert.equal(again.ok, true, again.error);
  assert.equal(getClock(world.campaignId).instant - before, 540);
});

await test("who travels with the party stays with whoever is left where they were", async () => {
  const { world, kael, mira, bram, tovin, move } = await table({ split: false });
  upsertNpc({ campaignId: world.campaignId, name: "Old Hobb", location: "The Docks" });
  const state = await world.invoke("npc_state", { name: "Old Hobb", withParty: true });
  assert.equal(state.ok, true, state.error);
  const place = () => getNpcByName(world.campaignId, "Old Hobb").location;
  await move({ name: "The Old Mill", characterIds: [kael.id, mira.id] });
  assert.equal(place(), "The Docks", "a scout going ahead takes nobody");
  await move({ name: "The Mill Cellar" });
  assert.equal(place(), "The Docks", "he is with those at the docks");
  // The scene cuts to the docks, and they set out with him.
  await move({ name: "The Docks", characterIds: [bram.id, tovin.id] });
  await move({ name: "The Lighthouse" });
  assert.equal(place(), "The Lighthouse");
});

model.close();
finish();
