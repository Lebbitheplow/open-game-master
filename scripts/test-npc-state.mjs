// The NPC state sheet (docs/specs/ogm-npc-state.md): the server keeps whether
// a tracked NPC is free or a prisoner, what holds them, and whether they
// stand or are down, and the GM reads it on the roster every turn. Before it,
// a prisoner taken at a mill stayed "at the mill" in the record while the
// party marched him off, and was forgotten.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply, call } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-npc-state");
const logic = await import("../src/lib/dm/npc-state-logic.ts");
const { handleNpcState, npcStateTools } = await import("../src/lib/dm/npc-state-tools.ts");
const { rankNpcsForPrompt } = await import("../src/lib/dm/npc-rank-logic.ts");
const mind = await import("../src/lib/dm/npc-mind.ts");
const minds = await import("../src/lib/db/npc-minds.ts");
const { upsertNpc, getNpcByName } = await import("../src/lib/db/npcs.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { dmTurnToolCatalogue } = await import("../src/lib/dm/turn.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true } });
const model = await fakeModel();
model.pointAt(world);
const brakk = world.addHero({ name: "Brakk", race: "half-orc", class: "barbarian" });

const state = (args) => handleNpcState(world.campaign(), JSON.stringify(args));
const sheetOf = (name) => getNpcByName(world.campaignId, name).state;

// ---- Pure rules ----------------------------------------------------------

await test("a row written before the sheet reads as free, unbound and standing", () => {
  for (const raw of ["", null, undefined, "not json", "[]", '{"custody":"sideways"}']) {
    assert.deepEqual(logic.parseNpcState(raw), logic.DEFAULT_NPC_STATE);
  }
  assert.equal(logic.serializeNpcState(logic.DEFAULT_NPC_STATE), "", "the default keeps an empty column");
  assert.equal(logic.npcStateWords(logic.DEFAULT_NPC_STATE), "");
});

await test("a declared change keeps what it does not name, and freeing removes the bonds", () => {
  const taken = logic.applyNpcStatePatch(logic.DEFAULT_NPC_STATE, { custody: "captive", heldBy: "Mara", restraint: "bound" });
  assert.deepEqual(taken.state, { custody: "captive", heldBy: "Mara", restraint: "bound", condition: "up", withParty: false, disarmed: false, carries: [] });
  const hurt = logic.applyNpcStatePatch(taken.state, { condition: "wounded" });
  assert.equal(hurt.state.heldBy, "Mara");
  assert.equal(logic.npcStateWords(hurt.state), "prisoner of Mara, bound, wounded");
  const freed = logic.applyNpcStatePatch(hurt.state, { custody: "free" });
  assert.deepEqual(freed.state, { custody: "free", heldBy: "", restraint: "none", condition: "wounded", withParty: false, disarmed: false, carries: [] });
  const handed = logic.applyNpcStatePatch(taken.state, { heldBy: "Brakk" });
  assert.equal(handed.state.heldBy, "Brakk", "a new keeper alone hands the prisoner over");
});

await test("a prisoner needs a keeper, and the dead stay dead", () => {
  assert.match(logic.applyNpcStatePatch(logic.DEFAULT_NPC_STATE, { custody: "captive" }).error, /heldBy/);
  const dead = logic.applyNpcStatePatch(logic.DEFAULT_NPC_STATE, { condition: "dead" }).state;
  assert.match(logic.applyNpcStatePatch(dead, { condition: "up" }).error, /dead/);
  assert.match(logic.applyNpcStatePatch(dead, { restraint: "bound" }).error, /dead/);
  assert.equal(logic.npcSilencedBy(dead), "dead");
  assert.equal(logic.npcSilencedBy({ ...logic.DEFAULT_NPC_STATE, condition: "unconscious" }), "unconscious");
  assert.equal(logic.npcSilencedBy({ ...logic.DEFAULT_NPC_STATE, condition: "wounded" }), "");
});

await test("a prisoner stays near the roster's head wherever the record puts them", () => {
  const roster = [
    { name: "Far Away", location: "Roccanera" },
    { name: "Rugo", location: "the old mill", inView: true },
    { name: "Here", location: "the square" },
  ];
  assert.deepEqual(
    rankNpcsForPrompt(roster, { location: "the square", text: "" }).map((npc) => npc.name),
    ["Rugo", "Here", "Far Away"],
  );
});

// ---- The tool ------------------------------------------------------------

await test("npc_state records a prisoner and refuses what it cannot apply, writing nothing", () => {
  upsertNpc({ campaignId: world.campaignId, name: "Uomo armato", location: "the old mill" });
  assert.ok(npcStateTools.some((tool) => tool.function.name === "npc_state"));
  const unknown = state({ name: "Nobody Here", custody: "free" });
  assert.equal(unknown.retry, true);
  assert.equal(state({ name: "Uomo armato" }).retry, true, "nothing changed is a call to fix");
  assert.equal(state({ name: "Uomo armato", restraint: "handcuffed" }).retry, true, "a value off the list");
  assert.match(state({ name: "Uomo armato", custody: "captive" }).error, /heldBy/);
  assert.deepEqual(sheetOf("Uomo armato"), logic.DEFAULT_NPC_STATE, "refusals wrote nothing");
  const taken = state({ name: "Uomo armato", custody: "captive", heldBy: "Mara", restraint: "bound" });
  assert.equal(taken.ok, true);
  assert.equal(taken.state, "prisoner of Mara, bound");
  assert.equal(sheetOf("Uomo armato").heldBy, "Mara");
  const freed = state({ name: "Uomo armato", custody: "free" });
  assert.equal(freed.state, "free and on their feet");
  assert.equal(getDatabase().prepare("SELECT state_json FROM npcs WHERE name = ?").get("Uomo armato").state_json, "");
});

await test("the senseless and the dead neither speak nor hear", async () => {
  const row = upsertNpc({ campaignId: world.campaignId, name: "Vell" });
  minds.setNpcTier(row.id, "primary");
  state({ name: "Vell", condition: "unconscious" });
  const spoken = await mind.handleNpcSpeak(world.campaign(), JSON.stringify({ name: "Vell", perceives: "Brakk shakes you." }));
  assert.equal(spoken.refused, "rules");
  assert.match(spoken.error, /unconscious/);
  const heard = mind.handleNpcHear(world.campaign(), JSON.stringify({ speaker: "Brakk", words: "Wake up.", listeners: [{ name: "Vell", reach: "near" }] }));
  assert.deepEqual(heard.heard, []);
  assert.deepEqual(heard.missed, ["Vell"]);
  assert.equal(minds.listNpcMemories(world.campaignId, row.id).length, 0, "nothing reached a senseless mind");
});

// ---- A whole turn --------------------------------------------------------

await test("the GM sees the prisoner on the roster on the next turn, with the tool on offer", async () => {
  assert.ok(dmTurnToolCatalogue(world.campaign()).some((tool) => tool.function.name === "npc_state"));
  upsertNpc({ campaignId: world.campaignId, name: "Aldren", location: "" });
  model.script([
    reply({ calls: [call("npc_state", { name: "Aldren", custody: "captive", heldBy: "Mara", restraint: "chained" })] }),
    reply({ text: "Mara snaps the irons shut on Aldren's wrists." }),
  ]);
  await model.turn(world, "We chain Aldren.", brakk.id);
  assert.equal(sheetOf("Aldren").restraint, "chained");
  model.script([reply({ text: "The road is quiet." })]);
  await model.turn(world, "We walk on.", brakk.id);
  const system = model.requests.at(-1).messages.map((message) => String(message.content ?? "")).join("\n");
  assert.match(system, /- Aldren: [a-z]+, prisoner of Mara, in chains/);
  assert.match(system, /call npc_state in the same reply/);
});

// ---- Who travels with the party (ticket 02) ------------------------------

const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const placeOf = (name) => getNpcByName(world.campaignId, name).location;
const candidate = (id, state, extra = {}) => ({ id, name: id, state: { ...logic.DEFAULT_NPC_STATE, ...state }, away: false, ...extra });

await test("who follows the party: its travellers, its prisoners, and the prisoners of those who travel with it", () => {
  const followers = logic.partyFollowers([
    candidate("Mara", { withParty: true }),
    candidate("Aldren", { custody: "captive", heldBy: "Mara" }),
    candidate("Rugo", { custody: "captive", heldBy: "Brakk" }),
    candidate("Nera", {}),
    candidate("Held by Nera", { custody: "captive", heldBy: "Nera" }),
    candidate("Left apart", { withParty: true }, { away: true }),
    candidate("Loop A", { custody: "captive", heldBy: "Loop B" }),
    candidate("Loop B", { custody: "captive", heldBy: "Loop A" }),
  ]);
  assert.deepEqual(followers.sort(), ["Aldren", "Mara", "Rugo"]);
});

await test("when the party moves, its travellers and prisoners are moved with it and nobody else is", async () => {
  upsertCurrentLocation({ campaignId: world.campaignId, name: "Malfosso" });
  for (const name of ["Capitana Mara", "Prigioniero", "Nera"]) {
    upsertNpc({ campaignId: world.campaignId, name, location: "Malfosso" });
  }
  state({ name: "Capitana Mara", withParty: true });
  state({ name: "Prigioniero", custody: "captive", heldBy: "Capitana Mara", restraint: "bound" });
  upsertCurrentLocation({ campaignId: world.campaignId, name: "Roccanera road" });
  assert.equal(placeOf("Capitana Mara"), "Roccanera road");
  assert.equal(placeOf("Prigioniero"), "Roccanera road");
  assert.equal(placeOf("Nera"), "Malfosso");
  state({ name: "Prigioniero", custody: "free" });
  upsertCurrentLocation({ campaignId: world.campaignId, name: "Roccanera" });
  assert.equal(placeOf("Prigioniero"), "Roccanera road", "freed, he stays where he was let go");
  assert.equal(placeOf("Capitana Mara"), "Roccanera");
  assert.match(logic.npcStateWords(sheetOf("Capitana Mara")), /with the party/);
});

await test("whoever speaks in the scene or hears it close by is in it; a mind apart is not moved", async () => {
  upsertCurrentLocation({ campaignId: world.campaignId, name: "the gatehouse" });
  const guard = upsertNpc({ campaignId: world.campaignId, name: "Gate guard", location: "the barracks" });
  minds.setNpcTier(guard.id, "primary");
  mind.handleNpcHear(world.campaign(), JSON.stringify({ speaker: "Brakk", words: "Open up.", listeners: [{ name: "Gate guard", reach: "near" }] }));
  assert.equal(placeOf("Gate guard"), "the gatehouse");
  const far = upsertNpc({ campaignId: world.campaignId, name: "Far sentry", location: "the wall" });
  mind.handleNpcHear(world.campaign(), JSON.stringify({ speaker: "Brakk", words: "Open up.", listeners: [{ name: "Far sentry", reach: "far" }] }));
  assert.equal(placeOf("Far sentry"), "the wall", "a far listener is not dragged into the scene");
  minds.setNpcAway(far.id, { place: "the wall", since: 0 });
  state({ name: "Far sentry", withParty: true });
  upsertCurrentLocation({ campaignId: world.campaignId, name: "the keep" });
  assert.equal(placeOf("Far sentry"), "the wall", "a mind apart from the party stays apart");
});

// ---- What they carry (ticket 04) -----------------------------------------

await test("what an NPC carries is a short list of story things, replaced whole, and disarming is noted", () => {
  upsertNpc({ campaignId: world.campaignId, name: "Sergente" });
  const carried = state({ name: "Sergente", carries: ["the magistrate's order", "a cell key"], disarmed: true });
  assert.equal(carried.state, "disarmed, carries the magistrate's order; a cell key");
  assert.equal(state({ name: "Sergente", carries: ["the magistrate's order"] }).state, "disarmed, carries the magistrate's order", "the list is replaced, not added to");
  const tooMany = state({ name: "Sergente", carries: Array.from({ length: 9 }, (_, index) => `thing ${index}`) });
  assert.match(tooMany.error, /limit of 8/);
  const tooLong = state({ name: "Sergente", carries: ["x".repeat(61)] });
  assert.match(tooLong.error, /over 60 characters/);
  assert.deepEqual(sheetOf("Sergente").carries, ["the magistrate's order"], "a refusal wrote nothing");
  assert.equal(logic.npcVisibleStateWords(sheetOf("Sergente")), "disarmed", "what they carry is not what anyone sees");
  state({ name: "Sergente", carries: [], disarmed: false });
  assert.equal(logic.serializeNpcState(sheetOf("Sergente")), "", "emptied, the column is empty again");
});

// ---- A name the story reveals (ticket 03) --------------------------------

await test("a revealed name renames the same person: memories, tier and sheet stay, the old name still finds them", () => {
  const row = upsertNpc({ campaignId: world.campaignId, name: "Uomo armato del mulino" });
  minds.setNpcTier(row.id, "primary");
  minds.addNpcMemories(world.campaignId, [row.id], { kind: "knowledge", sourceKind: "perceived", sourceName: "", content: "The sergeant gave the order.", learnedAt: 0 }, "");
  const told = state({ name: "Uomo armato del mulino", revealedName: "Rugo", custody: "captive", heldBy: "Brakk", restraint: "bound" });
  assert.equal(told.npc, "Rugo");
  assert.equal(told.formerly, "Uomo armato del mulino");
  const rugo = getNpcByName(world.campaignId, "Rugo");
  assert.equal(rugo.id, row.id);
  assert.ok(rugo.aliases.includes("Uomo armato del mulino"));
  assert.equal(getNpcByName(world.campaignId, "Uomo armato del mulino").id, row.id, "the old name still finds him");
  assert.equal(minds.listNpcMemories(world.campaignId, row.id).length, 1);
  assert.equal(minds.getNpcTier(row.id), "primary");
  assert.equal(rugo.state.heldBy, "Brakk");
});

await test("a revealed name another NPC already answers to is refused and nothing is written", () => {
  upsertNpc({ campaignId: world.campaignId, name: "Daro" });
  upsertNpc({ campaignId: world.campaignId, name: "Lo sconosciuto" });
  const refused = state({ name: "Lo sconosciuto", revealedName: "Daro", condition: "wounded" });
  assert.equal(refused.refused, "rules");
  const still = getNpcByName(world.campaignId, "Lo sconosciuto");
  assert.equal(still.name, "Lo sconosciuto");
  assert.equal(still.state.condition, "up", "the state was not written either");
});

// ---- What a mind sees (ticket 05) ----------------------------------------

const mindRequests = () => model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith("You are one character"));
const mindText = (request) => request.messages.map((message) => String(message.content ?? "")).join("\n");
const answer = (fields) => reply({ text: JSON.stringify({ speech: "", intent: "", conclusion: "", lie: false, ...fields }) });

await test("a mind sees who is tied or down beside it, and its own bonds, never what others carry or a keeper it cannot name", async () => {
  upsertCurrentLocation({ campaignId: world.campaignId, name: "the well square" });
  const watcher = upsertNpc({ campaignId: world.campaignId, name: "Watcher", location: "the well square" });
  minds.setNpcTier(watcher.id, "primary");
  upsertNpc({ campaignId: world.campaignId, name: "Bound man", location: "the well square" });
  state({ name: "Bound man", custody: "captive", heldBy: "Keeper Ilse", restraint: "bound", carries: ["a forged writ"] });
  upsertNpc({ campaignId: world.campaignId, name: "Elsewhere", location: "the mill" });
  state({ name: "Elsewhere", condition: "unconscious" });
  upsertNpc({ campaignId: world.campaignId, name: "Idle farmer", location: "the well square" });
  state({ name: "Watcher", custody: "captive", heldBy: "Brakk", restraint: "chained" });
  const before = mindRequests().length;
  model.script([answer({ speech: "Who is that man?" })]);
  const said = await mind.handleNpcSpeak(world.campaign(), JSON.stringify({ name: "Watcher", perceives: "Morning in the square." }));
  assert.equal(said.ok, true, JSON.stringify(said));
  const text = mindText(mindRequests()[before]);
  assert.match(text, /You yourself are a prisoner, in chains\./, "its own state, with a keeper it has not learned the name of");
  assert.match(text, /now a prisoner, bound/);
  assert.doesNotMatch(text, /forged writ/, "what another carries is not seen");
  assert.doesNotMatch(text, /Keeper Ilse/, "a keeper's name is not read off the sheet");
  assert.doesNotMatch(text, /unconscious/, "someone elsewhere is not seen");
  assert.doesNotMatch(text, /Idle farmer|someone you do not know by name: a person$/m, "a free, standing bystander adds nothing");
  assert.doesNotMatch(text, /first tier|tier/i);
});

await test("an unconscious or dead mind is owed no turn in the scene", async () => {
  const { mindsOwedTurn } = await import("../src/lib/dm/npc-mind-logic.ts");
  const base = { tier: "primary", archived: false, away: false, companionInFight: false, actedLastTurn: true, onStageRecently: true };
  const owed = mindsOwedTurn([{ id: "a", name: "Awake", ...base }, { id: "b", name: "Knocked out", ...base, silenced: true }], new Set());
  assert.deepEqual(owed.map((entry) => entry.id), ["a"]);
});

// ---- The narration held to the record (ticket 06) -------------------------

const guard = await import("../src/lib/dm/npc-state-guard-logic.ts");
const { readStateGuard } = await import("../src/lib/dm/npc-state-guard.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");

await test("the read is due only when someone named is held or down, a change shows, or the party moves holding someone", () => {
  const free = { name: "Nera", aliases: [], record: "" };
  const held = { name: "Rugo", aliases: [], record: "prisoner of Brakk, bound" };
  assert.equal(guard.stateGuardDue({ named: [free], narration: "Nera hands out the bread.", partyMoved: false, partyHolds: false }), false);
  assert.equal(guard.stateGuardDue({ named: [], narration: "The road is empty.", partyMoved: false, partyHolds: true }), false);
  assert.equal(guard.stateGuardDue({ named: [held], narration: "Rugo stares.", partyMoved: false, partyHolds: true }), true);
  assert.equal(guard.stateGuardDue({ named: [free], narration: "Nera falls, svenuta.", partyMoved: false, partyHolds: false }), true);
  assert.equal(guard.stateGuardDue({ named: [], narration: "You set off.", partyMoved: true, partyHolds: true }), true);
  assert.deepEqual(guard.peopleNamed("Rugo grunts.", [held, free]).map((person) => person.name), ["Rugo"]);
});

await test("the reader's reply is held to the people asked about and to words really in the narration", () => {
  const people = [{ name: "Rugo", aliases: ["Uomo armato"], record: "prisoner of Brakk, bound" }];
  const narration = "Rugo afferra l'ascia e colpisce la guardia.";
  const reading = guard.parseStateReading(
    JSON.stringify({
      clashes: [
        { name: "Uomo armato", quote: "afferra l'ascia", problem: "he is bound" },
        { name: "Rugo", quote: "words not in the narration", problem: "x" },
        { name: "Somebody else", quote: "colpisce", problem: "x" },
      ],
      unrecorded: [{ name: "Rugo", change: "wounded" }, { name: "Rugo", change: "twice" }, { name: "Nobody", change: "dead" }],
    }),
    narration,
    people,
  );
  assert.deepEqual(reading.clashes, [{ name: "Rugo", quote: "afferra l'ascia", problem: "he is bound" }]);
  assert.deepEqual(reading.unrecorded, [{ name: "Rugo", change: "wounded" }]);
  assert.equal(guard.parseStateReading("no json", narration, people), null);
  assert.equal(guard.parseStateReading('{"clashes":[]}', narration, people), null);
  assert.match(guard.stateGuardPrompt({ clashes: [], unrecorded: [{ name: "Rugo", change: "taken prisoner" }] }), /Call npc_state[\s\S]*Your narration stands/);
  assert.match(guard.stateGuardPrompt(reading), /narrate this moment again in full/);
});

await test("the guard asks nothing when nobody named is held, down or changing, and finds nothing when the reader fails", async () => {
  const turn = createDmTurn(world.campaignId, []);
  let asked = 0;
  const reader = async () => {
    asked += 1;
    return null;
  };
  assert.equal(await readStateGuard(world.campaign(), turn, ["Brakk"], "Nera hands out the bread.", [], reader), null);
  assert.equal(asked, 0, "no call for a quiet scene");
  assert.equal(await readStateGuard(world.campaign(), turn, ["Brakk"], "Aldren rattles his chains.", [], reader), null);
  assert.equal(asked, 1, "a held man named is read, and a failed read finds nothing");
});

await test("a capture the prose shows with no npc_state sends the narrator back once for the call, and the narration stands", async () => {
  upsertNpc({ campaignId: world.campaignId, name: "Bandito", location: "" });
  model.script([
    reply({ text: "Brakk stende il Bandito con un pugno e lo lega al carro." }),
    reply({ text: JSON.stringify({ clashes: [], unrecorded: [{ name: "Bandito", change: "knocked out and tied, prisoner of Brakk" }] }) }),
    reply({ calls: [call("npc_state", { name: "Bandito", custody: "captive", heldBy: "Brakk", restraint: "bound", condition: "unconscious" })] }),
  ]);
  await model.turn(world, "Lo stendo e lo lego.", brakk.id);
  const bandit = sheetOf("Bandito");
  assert.equal(bandit.custody, "captive");
  assert.equal(bandit.condition, "unconscious");
  const lastNarration = getDatabase()
    .prepare("SELECT content FROM campaign_messages WHERE campaign_id = ? AND author_type = 'dm' ORDER BY seq DESC LIMIT 1")
    .get(world.campaignId);
  assert.match(lastNarration.content, /lo lega al carro/);
});

model.close();
finish();
