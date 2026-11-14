// NPC minds (docs/specs/ogm-npc-isolation-design.md, scenarios A1-A14 of
// docs/specs/ogm-npc-behavior.md): each named NPC and companion answers from
// its own register through a model call that never sees the GM's prompt, the
// world's facts or another mind. These tests hold the information boundary
// deterministically; whether a real model plays the person well is a manual
// check, not this suite's.
import assert from "node:assert/strict";
import { openWorld, dice, clearDice } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { failure, fakeModel, reply, call } from "./lib/enforce-narrator.mjs";
import { revertTurn } from "./lib/sweep-lifecycle.mjs";

const { test, finish } = suite("test-npc-mind");
const logic = await import("../src/lib/dm/npc-mind-logic.ts");
const mind = await import("../src/lib/dm/npc-mind.ts");
const minds = await import("../src/lib/db/npc-minds.ts");
const { upsertNpc, getNpcByName, patchNpcAgency } = await import("../src/lib/db/npcs.ts");
const { recordExtractedFacts, listActiveFacts } = await import("../src/lib/db/facts.ts");
const { advanceClock, getClock } = await import("../src/lib/db/clock.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const { dmTurnToolCatalogue } = await import("../src/lib/dm/turn.ts");
const { markSheetAsCompanion, getSheetById } = await import("../src/lib/db/sheets.ts");
const { companionNpcFor } = await import("../src/lib/db/companion-npcs.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { partySplit } = await import("../src/lib/dm/party-split.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true } });
const model = await fakeModel();
model.pointAt(world);
const aria = world.addHero({ name: "Aria", race: "elf", class: "ranger" });

const answer = (fields) => reply({ text: JSON.stringify({ speech: "", intent: "", conclusion: "", lie: false, ...fields }) });
// The requests that went to a mind, told apart from the narrator's by the
// mind's own system prompt.
const mindRequests = () => model.requests.filter((request) => String(request.messages?.[0]?.content ?? "").startsWith("You are one character"));
const mindText = (request) => request.messages.map((message) => String(message.content ?? "")).join("\n");
// The scenarios below talk to minds, so their NPCs are first tier unless a
// test says otherwise.
const npc = (name, extra = {}, tier = "primary") => {
  const row = upsertNpc({ campaignId: world.campaignId, name, ...extra });
  minds.setNpcTier(row.id, tier);
  return row;
};
const memories = (name) => minds.listNpcMemories(world.campaignId, getNpcByName(world.campaignId, name).id);
const speak = (args) => mind.handleNpcSpeak(world.campaign(), JSON.stringify(args));
const memory = (fields) => ({ npcId: "n1", kind: "knowledge", sourceKind: "perceived", sourceName: "", content: "", learnedAt: 0, ...fields });

// ---- Pure rules ----------------------------------------------------------

await test("a name is known only once it reached the mind, never from its own words (A1)", () => {
  assert.equal(logic.knowsName("Aria", []), false);
  assert.equal(logic.knowsName("Aria", [memory({ kind: "said", sourceKind: "self", content: "Are you Aria?" })]), false);
  assert.equal(logic.knowsName("Aria", [memory({ content: 'The elf says: "I am Aria."' })]), true);
  assert.equal(logic.knowsName("Aria", [memory({ kind: "belief", sourceKind: "told", sourceName: "Aria", content: "the bridge is out" })]), true);
  const people = logic.presentPeople([{ name: "Aria", description: "elf ranger" }], []);
  assert.match(people[0], /someone you do not know by name: elf ranger/);
  assert.doesNotMatch(people[0], /Aria/);
});

await test("a mind reads only its own memories, learned no later than now (A2)", () => {
  const all = [memory({ npcId: "a", content: "mine" }), memory({ npcId: "b", content: "theirs" }), memory({ npcId: "a", content: "later", learnedAt: 100 })];
  assert.deepEqual(logic.memoriesFor("a", all, 50).map((entry) => entry.content), ["mine"]);
  assert.deepEqual(logic.memoriesFor("a", all, 100).map((entry) => entry.content), ["mine", "later"]);
});

await test("a reply that is not an answer is invalid, not filled in (A12)", () => {
  assert.equal(logic.parseProposal("I will think about it").ok, false);
  assert.equal(logic.parseProposal('{"speech": "", "intent": ""}').ok, false);
  assert.equal(logic.parseProposal("{not json}").ok, false);
  const parsed = logic.parseProposal('Sure: {"speech": "Go away.", "intent": "", "lie": true}');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.proposal, { speech: "Go away.", intent: "", conclusion: "", lie: true });
});

await test("names used without having been learned are flagged; learned ones and its own are not (A1, A3)", () => {
  const known = [memory({ content: "Brann told me about Vesna." })];
  assert.deepEqual(logic.unlearnedNames("Aria, Vesna wrote to me, says Brann.", "Brann", ["Aria", "Vesna", "Brann", "Oakhollow"], known), ["Aria"]);
});

await test("mental abilities become bands, and a 3 never reasons like a detective (A7)", () => {
  assert.equal(logic.bandOf(3), "very low");
  assert.equal(logic.bandOf(10), "average");
  assert.equal(logic.bandOf(18), "exceptional");
  assert.equal(logic.bandOf(undefined), "average");
  const guide = logic.mentalGuide({ int: 3, wis: 14, cha: 8 });
  assert.match(guide[0], /cannot chain clues into a theory/);
  assert.match(guide[1], /keen/);
  assert.match(guide[2], /unremarkable/);
  assert.deepEqual(logic.mentalScoresOf({ int: 3, wis: 14, cha: 8, str: 18 }), { int: 3, wis: 14, cha: 8 });
  assert.deepEqual(logic.mentalScoresOf({ abilities: { intelligence: 12 } }), { int: 12, wis: undefined, cha: undefined });
});

await test("an inspiration lends manner only, and lies and guesses are labelled as such (A5, A6, A8)", () => {
  const prompt = logic.renderMindPrompt({
    name: "Morven",
    identity: ["You are a tavern keeper."],
    inspiration: "Sherlock Holmes",
    scores: { int: 3 },
    memories: [
      memory({ kind: "belief", sourceKind: "told", sourceName: "Tibb", content: "the miller did it" }),
      memory({ kind: "hypothesis", sourceKind: "self", content: "the guard is hiding something" }),
      memory({ kind: "lie", sourceKind: "self", content: "I was home all night" }),
    ],
    present: [],
    bonds: ["Aria: standing -40; you remember: she broke her promise"],
    perceives: "Rain on the windows.",
  });
  assert.match(prompt, /Borrow temperament and voice only; none of that figure's names, world, memories, powers or relations are yours/);
  assert.match(prompt, /Reasoning: very limited/);
  assert.match(prompt, /you were told \(it may be false\) by Tibb\) the miller did it/);
  assert.match(prompt, /you suspect \(unproven\)\) the guard/);
  assert.match(prompt, /you lied, saying\) I was home all night/);
  assert.match(prompt, /she broke her promise/);
});

await test("the moment reaches the addressed NPC and the named ones present, each once (A2)", () => {
  const cast = [{ id: "1", name: "Brann" }, { id: "2", name: "Tibb", aliases: ["Old Tibb"] }];
  assert.deepEqual(logic.recipientsOf("Brann", ["Old Tibb", "brann", "Nobody"], cast), { ids: ["1", "2"], unknown: ["Nobody"] });
});

await test("a past can be laid down only before the NPC has lived anything (A3)", () => {
  assert.equal(logic.backgroundOpen([memory({ sourceKind: "background" })], 0), true);
  assert.equal(logic.backgroundOpen([memory({})], 0), false);
  assert.equal(logic.backgroundOpen([], 1), false);
});

await test("off-screen, only NPCs with a goal away from the scene act, longest idle first, within budget (A10)", () => {
  const npcs = [
    { id: "1", name: "A", location: "Mill", goal: "steal grain", lastActedAt: 5 },
    { id: "2", name: "B", location: "Inn", goal: "spy", lastActedAt: 1 },
    { id: "3", name: "C", location: "Mill", goal: "", lastActedAt: 0 },
    { id: "4", name: "D", location: "Tower", goal: "study", lastActedAt: 3 },
  ];
  assert.deepEqual(logic.offscreenCandidates(npcs, "Inn", 2).map((entry) => entry.id), ["4", "1"]);
});

// ---- Ticket 01: the unknown name -----------------------------------------

await test("a new table offers the minds and an older one does not (A14)", async () => {
  const names = (campaign) => dmTurnToolCatalogue(campaign, false, false).map((tool) => tool.function.name);
  assert.ok(names(world.campaign()).includes("npc_speak"));
  const old = await openWorld({ gameSettings: { ttsEnabled: false } });
  assert.equal(names(old.campaign()).includes("npc_speak"), false);
  assert.equal(old.campaign().gameSettings.npcMinds, false);
});

await test("a stranger is not given the hero's name or the GM's secrets; after an introduction it is (A1)", async () => {
  npc("Brann", { trait: "gruff innkeeper", location: "The Copper Kettle" });
  recordExtractedFacts(world.campaignId, [{ category: "npc", subject: "Mayor", fact: "The mayor poisoned the well." }], "manual", { knownBy: "dm" });
  model.script([answer({ speech: "Welcome, Aria. What'll it be?" }), answer({ speech: "Good to meet you, Aria." })]);
  const first = await speak({ name: "Brann", perceives: "An elf in a green cloak walks to the bar and nods." });
  const [asked] = mindRequests();
  assert.ok(asked, "the mind was asked");
  assert.doesNotMatch(mindText(asked), /Aria/, "the stranger's context never holds the hero's name");
  assert.doesNotMatch(mindText(asked), /poisoned/, "nor a fact of the world it was not told");
  assert.doesNotMatch(mindText(asked), /Tracked NPCs|GAME STATE/, "nor the narrator's prompt");
  assert.equal(first.ok, true);
  assert.deepEqual(first.unlearned, ["Aria"], "the name it used without learning it is flagged for the GM");
  const second = await speak({ name: "Brann", perceives: 'The elf says: "I am Aria, a ranger from the north."' });
  assert.match(mindText(mindRequests()[1]), /Aria \(elf ranger\)/, "after the introduction the name is known");
  assert.equal(second.unlearned, undefined);
  const said = memories("Brann").filter((entry) => entry.kind === "said");
  assert.equal(said.length, 2);
  assert.equal(listActiveFacts(world.campaignId).some((fact) => /Welcome/.test(fact.fact)), false, "words never become world facts");
});

await test("a mind that fails is reported, writes no words and keeps no memory; a retry answers once (A12)", async () => {
  npc("Ilsa", { trait: "nervous clerk" });
  model.script([failure(500), answer({ speech: "N-no, sir." })]);
  const failed = await speak({ name: "Ilsa", perceives: "A stranger asks about the ledger." });
  assert.equal(failed.refused, "limit");
  assert.match(failed.error, /did not answer/);
  assert.match(failed.error, /Do not write words or a decision for them/);
  const after = memories("Ilsa");
  assert.equal(after.filter((entry) => entry.sourceKind === "self").length, 0, "nothing it would have said is remembered");
  assert.equal(after.filter((entry) => entry.kind === "knowledge").length, 1, "what it perceived stays: that happened");
  const proposals = minds.listNpcProposals(world.campaignId, getNpcByName(world.campaignId, "Ilsa").id);
  assert.deepEqual(proposals.map((entry) => entry.status), ["failed"]);
  const retried = await speak({ name: "Ilsa", perceives: "The stranger asks again, louder." });
  assert.equal(retried.says, "N-no, sir.");
  assert.equal(memories("Ilsa").filter((entry) => entry.kind === "said").length, 1, "the retry answers once");
});

await test("an invalid answer is refused the same way (A12)", async () => {
  model.script([reply({ text: "I think I would greet them warmly." })]);
  const result = await speak({ name: "Ilsa", perceives: "Someone waves." });
  assert.equal(result.refused, "limit");
  assert.match(result.error, /held no JSON/);
});

await test("an unknown NPC is a mistake in the call, and nobody's mind is invented", async () => {
  const result = await speak({ name: "Nobody Here", perceives: "Hello?" });
  assert.equal(result.retry, true);
});

await test("a reverted turn takes back what that turn taught (A13)", async () => {
  npc("Garrick");
  model.script([answer({ speech: "Aye." })]);
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  await runInTurnScope(turn.id, async () => {
    mind.handleNpcPast(world.campaign(), JSON.stringify({ name: "Garrick", inspiration: "a weary old soldier", past: ["You kept the north gate for twenty years."] }));
    await mind.handleNpcInform(world.campaign(), JSON.stringify({ name: "Garrick", source: "a carter", news: "The bridge is out." }));
    return speak({ name: "Garrick", perceives: 'Aria says: "Garrick, the gate."' });
  });
  assert.ok(memories("Garrick").length >= 4);
  assert.equal(minds.getNpcInspiration(getNpcByName(world.campaignId, "Garrick").id), "a weary old soldier");
  await revertTurn(world, turn.id);
  assert.equal(memories("Garrick").length, 0, "npc_past, npc_inform and npc_speak are all taken back");
  assert.equal(minds.getNpcInspiration(getNpcByName(world.campaignId, "Garrick").id), "", "the inspiration too");
  assert.equal(minds.listNpcProposals(world.campaignId, getNpcByName(world.campaignId, "Garrick").id).length, 0);
});

await test("a whole turn: the narrator asks the mind and voices it, and the mind never sees the turn's prompt (A1, A11)", async () => {
  npc("Old Tibb", { trait: "ferryman" });
  model.script([
    reply({ calls: [call("npc_speak", { name: "Old Tibb", perceives: 'A cloaked elf asks: "Will you take me across?"' })] }),
    answer({ speech: "Two silver, stranger.", intent: "hold out his hand for payment" }),
    reply({ text: '"Two silver, stranger," Old Tibb says, holding out a calloused hand.' }),
  ]);
  const dm = await model.turn(world, "I ask the ferryman to take me across.", aria.id);
  assert.ok(dm, "the turn narrated");
  assert.match(dm.content, /Two silver/);
  const [asked] = mindRequests();
  assert.doesNotMatch(mindText(asked), /poisoned|Brann|Ilsa/, "no other mind's register, no world fact");
  const told = model.results(model.requests.find((request) => model.results(request).length) ?? { messages: [] });
  const answerResult = told.map((entry) => entry.result).find((result) => result.npc === "Old Tibb");
  assert.equal(answerResult.says, "Two silver, stranger.");
  assert.match(answerResult.narrate, /only an attempt/, "the intent is resolved by the engine, not by the mind");
  assert.equal(listActiveFacts(world.campaignId).some((fact) => /silver/.test(fact.fact)), false);
});

// ---- Ticket 02: news, the absent, late messages --------------------------

await test("an absent NPC learns of an event only when news reaches them, from that source, at that time (A2)", async () => {
  npc("Mira", { location: "the Abbey" });
  npc("Doran");
  model.script([answer({ speech: "The ferry is closed today." })]);
  await speak({ name: "Doran", perceives: "The river floods the lower town.", alsoPresent: [] });
  assert.equal(memories("Mira").length, 0, "the absent learn nothing");
  const before = getClock(world.campaignId).instant;
  advanceClock(world.campaignId, 2, "hours");
  const delivered = getClock(world.campaignId).instant;
  assert.ok(delivered > before);
  const result = await mind.handleNpcInform(world.campaign(), JSON.stringify({ name: "Mira", source: "a courier", news: "The river flooded the lower town." }));
  assert.equal(result.ok, true);
  const [news] = memories("Mira");
  assert.equal(news.kind, "belief");
  assert.equal(news.sourceName, "a courier");
  assert.equal(news.learnedAt, delivered, "known from the delivery, not from the flood");
});

await test("the NPCs named present perceive the moment and hear the answer; the others do not (A2)", async () => {
  npc("Kell");
  npc("Rook");
  npc("Faraway");
  model.script([answer({ speech: "Nobody leaves until the thief is found." })]);
  await speak({ name: "Kell", perceives: "A purse is snatched in the square.", alsoPresent: ["Rook"] });
  assert.ok(memories("Rook").some((entry) => /purse is snatched/.test(entry.content)));
  assert.ok(memories("Rook").some((entry) => /Nobody leaves/.test(entry.content)));
  assert.equal(memories("Faraway").length, 0);
});

await test("registers persist in the database apart from summaries and the transcript (A13)", () => {
  const rows = getDatabase().prepare(`SELECT COUNT(*) AS n FROM npc_memories WHERE campaign_id = ?`).get(world.campaignId);
  assert.ok(rows.n > 0);
  const kell = getNpcByName(world.campaignId, "Kell");
  assert.equal(minds.listNpcMemories(world.campaignId, kell.id).every((entry) => entry.npcId === kell.id), true);
});

// ---- Ticket 03: beliefs, lies, conclusions --------------------------------

await test("a lie believed stays a belief with its source; the world does not change (A5)", async () => {
  npc("Wren");
  const factsBefore = listActiveFacts(world.campaignId).length;
  await mind.handleNpcInform(world.campaign(), JSON.stringify({ name: "Wren", source: "Tibb", news: "The miller stole the grain." }));
  const [belief] = memories("Wren");
  assert.equal(belief.kind, "belief");
  assert.equal(belief.sourceName, "Tibb");
  assert.equal(listActiveFacts(world.campaignId).length, factsBefore, "no world fact from a testimony");
  await mind.handleNpcInform(world.campaign(), JSON.stringify({ name: "Wren", source: "herself", news: "The barn burned.", witnessed: true }));
  assert.equal(memories("Wren")[1].kind, "knowledge");
});

await test("a conclusion is kept as a suspicion and a knowing lie is not a lived fact (A6)", async () => {
  model.script([answer({ speech: "I was at home all night.", conclusion: "the miller is the thief", lie: true })]);
  const factsBefore = listActiveFacts(world.campaignId).length;
  await speak({ name: "Wren", perceives: 'Aria asks: "Where were you last night?"' });
  const kinds = memories("Wren").map((entry) => entry.kind);
  assert.ok(kinds.includes("hypothesis"));
  assert.ok(kinds.includes("lie"));
  assert.equal(kinds.includes("said"), false);
  assert.equal(listActiveFacts(world.campaignId).length, factsBefore);
});

// ---- Ticket 04: unlearned names in the output -----------------------------

await test("a companion inventing letters to a victim it never knew is flagged, and nothing becomes a fact (A3)", async () => {
  npc("Vesna", { trait: "the murdered herbalist" });
  npc("Corin");
  model.script([answer({ speech: "Vesna and I exchanged letters for years." })]);
  const result = await speak({ name: "Corin", perceives: "Aria shows the herbalist's body." });
  assert.ok(result.unlearned.includes("Vesna"));
  assert.match(result.flagNote, /never as a fact of the world/);
  assert.equal(listActiveFacts(world.campaignId).some((fact) => /letters/.test(fact.fact)), false);
});

await test("a lie or a guess about something it learned is not flagged (A4)", async () => {
  model.script([answer({ speech: "Vesna? Never met her.", lie: true })]);
  const result = await speak({ name: "Corin", perceives: 'Aria asks: "Did you know Vesna?"' });
  assert.equal(result.unlearned, undefined);
});

// ---- Ticket 05: off-screen ------------------------------------------------

await test("off-screen, a mind pursues its goal from what it knows, within the budget, as a GM-only rumour (A10)", async () => {
  const schemer = npc("Silas", { location: "the Docks" });
  patchNpcAgency(schemer.id, { goals: { session: { text: "smuggle the relic out of town", progress: 0, target: 3 } } });
  model.script([answer({ intent: "bribe a harbour guard" })]);
  dice(20);
  const acted = await mind.runOffscreenMinds(world.campaign(), 1);
  assert.equal(clearDice(), 0, "the engine rolled the die");
  assert.equal(acted, 1);
  assert.ok((getNpcByName(world.campaignId, "Silas").agency.goals.session?.progress ?? 3) > 0, "the engine's die moved the goal the mind pursued");
  assert.ok(mind.offscreenMindIds(world.campaign()).has(schemer.id), "the generic goal dice leave a first-tier mind's goal to it");
  const [asked] = mindRequests();
  assert.match(mindText(asked), /smuggle the relic/);
  assert.doesNotMatch(mindText(asked), /poisoned|flooded/, "off-screen it still knows only its own register");
  assert.ok(memories("Silas").some((entry) => entry.kind === "did" && /bribe/.test(entry.content)));
  const rumour = listActiveFacts(world.campaignId).find((fact) => /bribe a harbour guard/.test(fact.fact));
  assert.ok(rumour);
  assert.equal(rumour.knownBy, "dm");
  const offscreen = minds.listNpcProposals(world.campaignId).filter((entry) => entry.mode === "offscreen");
  assert.equal(offscreen.length, 1, "each off-screen call is measured");
});

await test("off-screen failure leaves no deed and blocks nothing (A10, A12)", async () => {
  const before = getNpcByName(world.campaignId, "Silas").agency.goals.session;
  model.script([failure(500)]);
  const acted = await mind.runOffscreenMinds(world.campaign(), 1);
  assert.equal(acted, 0);
  assert.deepEqual(getNpcByName(world.campaignId, "Silas").agency.goals.session, before, "no intent, no progress");
});

// ---- Ticket 06: abilities and inspiration ---------------------------------

await test("a past and an inspiration are laid down before the first act, and refused after (A3, A8)", async () => {
  npc("Thessaly");
  const set = mind.handleNpcPast(world.campaign(), JSON.stringify({ name: "Thessaly", inspiration: "a scheming dark lord", past: ["You served the old duke for ten years."] }));
  assert.equal(set.ok, true);
  model.script([answer({ speech: "The duke trusted me once." })]);
  await speak({ name: "Thessaly", perceives: "Aria mentions the old duke." });
  assert.match(mindText(mindRequests()[0]), /a scheming dark lord\. Borrow temperament and voice only/);
  assert.match(mindText(mindRequests()[0]), /from your past\) You served the old duke/);
  const late = mind.handleNpcPast(world.campaign(), JSON.stringify({ name: "Thessaly", past: ["You wrote letters to the victim."] }));
  assert.equal(late.refused, "rules");
  assert.equal(memories("Thessaly").some((entry) => /letters/.test(entry.content)), false);
});

// ---- Ticket 07: companions ------------------------------------------------

await test("a companion's mind knows its company from the start and is bound by its sheet (A4, A7)", async () => {
  const sheet = world.addHero({ name: "Seren", race: "human", class: "fighter", abilities: { str: 16, int: 3, wis: 10, cha: 9 } });
  markSheetAsCompanion(sheet.id, "party", "Loyal and blunt.");
  const row = companionNpcFor(getSheetById(sheet.id));
  assert.ok(row);
  model.script([answer({ speech: "Aria, I don't get it. Hit it?" })]);
  const result = await speak({ name: "Seren", perceives: "Aria lays out the clues of the murder on the table." });
  const text = mindText(mindRequests()[0]);
  assert.match(text, /You travel with this company: Aria \(elf ranger\)/);
  assert.match(text, /Reasoning: very limited/);
  assert.equal(result.unlearned, undefined, "a companion knows its company's names");
});

await test("a mind's intent is only proposed: the engine's state does not change by its words (A11)", async () => {
  const before = getSheetById(aria.id);
  model.script([answer({ speech: "I'll take your sword.", intent: "take Aria's sword" })]);
  const result = await speak({ name: "Brann", perceives: "Aria lays her sword on the bar." });
  assert.equal(result.intends, "take Aria's sword");
  assert.deepEqual(getSheetById(aria.id).equipment, before.equipment);
});

// ---- Two tiers -------------------------------------------------------------

await test("a party companion is first tier; a guest and an ordinary NPC are second unless made first", () => {
  assert.equal(logic.tierOf({ tier: "secondary", companionKind: "party" }), "primary");
  assert.equal(logic.tierOf({ tier: "secondary", companionKind: "guest" }), "secondary");
  assert.equal(logic.tierOf({ tier: "primary" }), "primary");
  assert.equal(logic.tierOf({ tier: "" }), "secondary");
});

await test("a second-tier NPC has no mind of their own: npc_speak is refused and no model is called", async () => {
  npc("Smith Hob", { trait: "the village blacksmith" }, "secondary");
  model.script([answer({ speech: "should never be asked" })]);
  model.requests.length = 0;
  const result = await speak({ name: "Smith Hob", perceives: "Aria asks for a horseshoe." });
  assert.equal(result.refused, "rules");
  assert.match(result.error, /voice them yourself/);
  assert.equal(mindRequests().length, 0);
});

await test("the roster asks first-tier minds and gives second-tier NPCs only their light register (ticket 02)", async () => {
  await mind.handleNpcInform(world.campaign(), JSON.stringify({ name: "Smith Hob", source: "the miller", news: "Wolves were seen near the mill." }));
  let notes = mind.mindRosterNotes(world.campaign());
  assert.match(notes.get("Smith Hob"), /second tier/);
  assert.match(notes.get("Smith Hob"), /heroes they know by name: none/, "a stranger to the party does not know Aria's name");
  assert.match(notes.get("Smith Hob"), /told by the miller: Wolves/);
  assert.doesNotMatch(notes.get("Smith Hob"), /poisoned/, "no world fact reaches the register");
  assert.match(notes.get("Brann"), /first tier/);
  await mind.handleNpcInform(world.campaign(), JSON.stringify({ name: "Smith Hob", source: "Aria", news: "The elf introduced herself as Aria." }));
  notes = mind.mindRosterNotes(world.campaign());
  assert.match(notes.get("Smith Hob"), /heroes they know by name: Aria/, "after the introduction the name is known");
});

await test("off-screen, only the first tier thinks; a second-tier NPC with a goal costs no call (ticket 05)", async () => {
  const idle = npc("Fence Mol", { location: "the Docks" }, "secondary");
  patchNpcAgency(idle.id, { goals: { session: { text: "sell stolen silver", progress: 0, target: 3 } } });
  const callsBefore = minds.listNpcProposals(world.campaignId).filter((entry) => entry.mode === "offscreen" && entry.npcId === idle.id).length;
  model.script([answer({ intent: "lie low" }), answer({ intent: "lie low" }), answer({ intent: "lie low" })]);
  await mind.runOffscreenMinds(world.campaign(), 5);
  const callsAfter = minds.listNpcProposals(world.campaignId).filter((entry) => entry.mode === "offscreen" && entry.npcId === idle.id).length;
  assert.equal(callsAfter, callsBefore);
});

await test("an unlearned name is kept in the turn's trace, and no other register learns it (ticket 04)", async () => {
  npc("Halden");
  npc("Pell");
  model.script([answer({ speech: "Lord Ostrin sent me." })]);
  npc("Lord Ostrin");
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  await runInTurnScope(turn.id, async () => speak({ name: "Halden", perceives: "A guard asks who sent him.", alsoPresent: ["Pell"] }));
  const [logged] = minds.listNpcProposals(world.campaignId, getNpcByName(world.campaignId, "Halden").id);
  assert.equal(logged.turnId, turn.id);
  assert.deepEqual(logged.flags, ["Lord Ostrin"]);
  const heard = memories("Pell").find((entry) => /Lord Ostrin/.test(entry.content));
  assert.ok(heard, "Pell heard the words");
  assert.equal(heard.kind, "belief", "as a claim, not as a fact");
  assert.equal(heard.sourceKind, "told");
  assert.doesNotMatch(heard.content, /Halden/, "hearing him does not teach his name");
  const pure = logic.overheard("Halden", "Hi.", [memory({ content: 'He says: "I am Halden."' })]);
  assert.equal(pure.sourceName, "Halden", "a hearer who knows the speaker names him");
});

await test("a betrayal actually lived lowers the standing the mind reads, with its memory (ticket 06, A9)", async () => {
  const relationships = await import("../src/lib/db/relationships.ts");
  npc("Odile");
  model.script([answer({ speech: "Hello." })]);
  await speak({ name: "Odile", perceives: 'The elf says: "I am Aria."' });
  const row = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: aria.id, characterName: "Aria", subjectKind: "npc", subjectName: "Odile" });
  relationships.patchRelationship(row.id, { approval: -60, memories: [{ kind: "betrayal", text: "Aria sold her map to the smugglers", at: new Date().toISOString() }] });
  model.script([answer({ speech: "You. Again." })]);
  model.requests.length = 0;
  await speak({ name: "Odile", perceives: "Aria walks in." });
  const text = mindText(mindRequests()[0]);
  assert.match(text, /Aria: standing -60/);
  assert.match(text, /sold her map to the smugglers/);
  assert.match(text, /You are|What people notice|attitude/, "the identity is still hers: the betrayal adds, it does not replace");
});

// ---- Companions apart from the party --------------------------------------

const seren = () => getNpcByName(world.campaignId, "Seren");

await test("a companion left behind is apart: the roster says where, and it does not hear the scene", async () => {
  patchNpcAgency(seren().id, { goals: {} });
  const told = partySplit(world.campaign(), [aria.id], "the Old Mill", "the Rusty Anchor");
  assert.match(told, /Seren stayed behind/);
  assert.equal(minds.getNpcAway(seren().id)?.place, "the Rusty Anchor");
  assert.equal(minds.getNpcAway(seren().id)?.since, getClock(world.campaignId).instant);
  npc("Innkeeper Marta", { location: "the Rusty Anchor" }, "secondary");
  const notes = mind.mindRosterNotes(world.campaign());
  assert.match(notes.get("Seren"), /apart from the party, at the Rusty Anchor/);
  assert.match(notes.get("Innkeeper Marta"), /Seren was left at the Rusty Anchor: before voicing Innkeeper Marta about it, call npc_speak for Seren with away: true/);
  model.script([answer({ speech: "The mill wheel has stopped." })]);
  await speak({ name: "Brann", perceives: "At the mill, Aria finds the miller's ledger torn.", alsoPresent: ["Seren"] });
  assert.equal(memories("Seren").some((entry) => /ledger/.test(entry.content)), false, "a mind apart from the scene does not hear it");
});

await test("the innkeeper touched: the companion's day apart is played first, on the engine's dice, and she knows only her own news", async () => {
  advanceClock(world.campaignId, 1, "days");
  const now = getClock(world.campaignId).instant;
  model.requests.length = 0;
  model.script([answer({ intent: "ask around about the stolen relic" }), answer({ intent: "follow a hooded man to the docks" })]);
  dice(17, 4);
  const result = await mind.handleNpcInform(world.campaign(), JSON.stringify({ name: "Innkeeper Marta", source: "Aria", news: "Aria asks where her friend went." }));
  assert.equal(clearDice(), 0, "the engine rolled one die per step");
  assert.equal(result.ok, true);
  assert.equal(result.whileApart[0].name, "Seren");
  assert.deepEqual(result.whileApart[0].did.map((line) => /d20 (\d+): it (.+)\)/.exec(line).slice(1)), [["17", "succeeds"], ["4", "fails"]]);
  const asked = mindRequests();
  assert.equal(asked.length, 2, "two half-day steps");
  assert.match(mindText(asked[0]), /You are at the Rusty Anchor, apart from your companions\. About 12 hours pass/);
  assert.doesNotMatch(mindText(asked[1]), /ledger|where her friend went/, "apart, it knows only its own place");
  const did = memories("Seren").filter((entry) => entry.kind === "did");
  assert.deepEqual(did.map((entry) => entry.learnedAt), [now - 720, now]);
  assert.match(did[1].content, /hooded man.*it fails/);
  assert.ok(listActiveFacts(world.campaignId).some((fact) => /While apart at the Rusty Anchor, Seren tried to follow a hooded man/.test(fact.fact)));
  assert.equal(memories("Innkeeper Marta").some((entry) => /hooded/.test(entry.content)), false, "the innkeeper knows only what reached her");
  assert.equal(minds.getNpcAway(seren().id)?.since, now, "played up to now");
});

await test("cut to her apart, then back with the party: she rejoins remembering what she did", async () => {
  advanceClock(world.campaignId, 2, "hours");
  model.requests.length = 0;
  model.script([answer({ intent: "rest by the fire" }), answer({ speech: "Quiet night here." })]);
  dice(10);
  const cut = await speak({ name: "Seren", perceives: "Evening falls on the common room.", away: true });
  assert.equal(clearDice(), 0);
  assert.equal(cut.apartAt, "the Rusty Anchor");
  assert.equal(cut.whileApart.length, 1);
  assert.match(cut.whileApart[0], /rest by the fire \(d20 10: it partly succeeds\)/);
  assert.ok(cut.apartNote);
  assert.doesNotMatch(mindText(mindRequests().at(-1)), /Present with you/, "apart, no hero stands with her");
  assert.match(mindText(mindRequests().at(-1)), /You are at the Rusty Anchor, apart from the party/);
  assert.equal(minds.getNpcAway(seren().id)?.since, getClock(world.campaignId).instant);
  model.requests.length = 0;
  model.script([answer({ speech: "Aria! I followed a hooded man to the docks." })]);
  const back = await speak({ name: "Seren", perceives: "Aria walks into the inn." });
  assert.equal(back.rejoined, true);
  assert.equal(back.whileApart, undefined, "no time passed since she was last played");
  assert.equal(minds.getNpcAway(seren().id), null);
  const text = mindText(mindRequests()[0]);
  assert.match(text, /follow a hooded man to the docks/, "she remembers her time apart");
  assert.match(text, /Present with you:\n- .*elf ranger/, "back with the party");
});

await test("a catch-up that fails keeps the steps played, writes nothing for the rest, and the turn reverts it all", async () => {
  minds.setNpcAway(seren().id, { place: "the Rusty Anchor", since: getClock(world.campaignId).instant });
  advanceClock(world.campaignId, 1, "days");
  const before = memories("Seren").length;
  model.script([answer({ intent: "look for work at the market" }), failure(500)]);
  dice(12);
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  const result = await runInTurnScope(turn.id, async () => speak({ name: "Seren", perceives: "Morning.", away: true }));
  clearDice();
  assert.equal(result.refused, "limit");
  assert.match(result.error, /no news of them yet/);
  assert.equal(memories("Seren").length, before + 1, "the first step stays, nothing else");
  assert.equal(minds.getNpcAway(seren().id)?.since, getClock(world.campaignId).instant - 720, "a retry resumes after the step kept");
  await revertTurn(world, turn.id);
  assert.equal(memories("Seren").length, before, "the revert takes the step back");
  assert.equal(minds.getNpcAway(seren().id)?.since, getClock(world.campaignId).instant - 1440);
  minds.setNpcAway(seren().id, null);
});

// ---- Ticket 08: a companion's own fight turn ------------------------------

const { setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const tobinSheet = world.addHero({ name: "Tobin", race: "dwarf", class: "fighter" });
markSheetAsCompanion(tobinSheet.id, "party", "Gruff and steady.");
companionNpcFor(getSheetById(tobinSheet.id));
setCompanionCommander(tobinSheet.id, null);
// The initiative resting on Tobin, whatever the dice gave.
const onTobin = () => {
  const fight = world.encounter();
  const at = fight.order.findIndex((entry) => entry.characterId === tobinSheet.id);
  getDatabase().prepare("UPDATE encounters SET turn_index = ? WHERE id = ?").run(at, fight.id);
};
const attack = (characterId) => JSON.stringify({ characterId, targetEnemyId: world.enemies()[0]?.id ?? "x" });

await test("on its own fight turn a companion's actions wait for its mind; the mind sees all of itself and the foes only as they look (ticket 08)", async () => {
  await world.beginFight([{ monster: "goblin" }]);
  onTobin();
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  await runInTurnScope(turn.id, async () => {
    const refused = mind.mindTurnRefusal(world.campaign(), "pc_attack", attack(tobinSheet.id));
    assert.match(refused?.error ?? "", /call npc_speak for Tobin first/);
    assert.equal(refused.retry, true);
    assert.equal(mind.mindTurnRefusal(world.campaign(), "end_turn", JSON.stringify({ characterId: tobinSheet.id }))?.retry, true, "nor may the turn be skipped");
    assert.equal(mind.mindTurnRefusal(world.campaign(), "pc_attack", attack(aria.id)), null, "another character is not held");
    model.requests.length = 0;
    model.script([answer({ speech: "For the hold!", intent: "close on the goblin and strike it with my battleaxe" })]);
    const chose = await speak({ name: "Tobin", perceives: "A goblin snarls across the clearing." });
    assert.equal(chose.intends, "close on the goblin and strike it with my battleaxe");
    assert.match(chose.fightTurn, /carry it out with the combat tools/);
    const text = mindText(mindRequests()[0]);
    assert.match(text, /Your character sheet, as the rules hold it now/);
    assert.match(text, /It is your turn in the fight \(round \d+\)/);
    assert.match(text, /Foes you see:\n- Goblin[^\n]*: unhurt/);
    const goblin = world.enemies()[0];
    assert.doesNotMatch(text, new RegExp(`Goblin[^\\n]*\\b${goblin.currentHp}\\s*/\\s*${goblin.maxHp}`), "never a foe's hit points");
    assert.equal(mind.mindTurnRefusal(world.campaign(), "pc_attack", attack(tobinSheet.id)), null, "once chosen, the narrator carries it out");
  });
});

await test("a commanded, fallen or mindless companion's turn is not held (ticket 08)", async () => {
  onTobin();
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  await runInTurnScope(turn.id, async () => {
    const off = { ...world.campaign(), gameSettings: { ...world.campaign().gameSettings, npcMinds: false } };
    assert.equal(mind.mindTurnRefusal(off, "pc_attack", attack(tobinSheet.id)), null, "a table without minds");
    setCompanionCommander(tobinSheet.id, world.owner.id);
    assert.equal(mind.mindTurnRefusal(world.campaign(), "pc_attack", attack(tobinSheet.id)), null, "its commander plays it");
    setCompanionCommander(tobinSheet.id, null);
    world.patch(tobinSheet.id, { currentHp: 0 });
    assert.equal(mind.mindTurnRefusal(world.campaign(), "end_turn", JSON.stringify({ characterId: tobinSheet.id })), null, "a fallen companion chooses nothing");
    world.patch(tobinSheet.id, { currentHp: getSheetById(tobinSheet.id).maxHp });
  });
});

await test("a whole fight turn: the narrator's action for the companion is refused until its mind chose, then voiced (ticket 08)", async () => {
  onTobin();
  model.script([
    reply({ calls: [call("pc_attack", { characterId: tobinSheet.id, targetEnemyId: world.enemies()[0].id })] }),
    reply({ calls: [call("npc_speak", { name: "Tobin", perceives: "The goblin circles." })] }),
    answer({ speech: "Come here, then.", intent: "strike the goblin with my battleaxe" }),
    reply({ text: '"Come here, then," Tobin growls, hefting his battleaxe.' }),
  ]);
  const dm = await model.turn(world, "Tobin's turn.", aria.id);
  assert.ok(dm, "the turn narrated");
  const results = model.requests.flatMap((request) => model.results(request)).map((entry) => entry.result);
  assert.ok(results.some((result) => /call npc_speak for Tobin first/.test(String(result?.error ?? ""))), "the first attack was held");
  assert.ok(results.some((result) => result?.npc === "Tobin" && result.fightTurn), "the mind chose the turn");
  await world.invoke("end_encounter", { outcome: "victory" });
});

await test("the mind's fight view says what its shield rules out, as the server's hands rule does (ticket 08 follow-up)", () => {
  const text = logic.renderFightView({ round: 2, foes: [], allies: [], hands: { shield: "Shield", blocked: ["Light Crossbow"] } });
  assert.match(text, /Your Shield is on your arm: while it is, you cannot use Light Crossbow \(they need both hands\)/);
  assert.doesNotMatch(logic.renderFightView({ round: 2, foes: [], allies: [], hands: { shield: null, blocked: [] } }), /arm/);
});

await test("a new party companion at a table with minds follows its own mind, not the one player (ticket 08 follow-up)", async () => {
  const { defaultCommander } = await import("../src/lib/dm/companion-command.ts");
  assert.equal(defaultCommander(world.campaign(), "party"), null);
  const { commandingPlayers } = await import("../src/lib/dm/companion-command.ts");
  const off = { ...world.campaign(), gameSettings: { ...world.campaign().gameSettings, npcMinds: false } };
  const players = commandingPlayers(off);
  assert.equal(defaultCommander(off, "party"), players.length === 1 ? players[0] : null, "without minds the one-player rule stands, as before");
});

await test("a companion's own fight turn waits on its mind until asked in this DM turn (ticket 08 follow-up)", async () => {
  await world.beginFight([{ monster: "goblin" }]);
  onTobin();
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  assert.equal(mind.mindTurnUnplayed(world.campaign(), tobinSheet.id, turn.id), true, "not asked in this turn");
  await runInTurnScope(turn.id, async () => {
    model.script([answer({ speech: "", intent: "strike the goblin with my battleaxe" })]);
    await speak({ name: "Tobin", perceives: "The goblin circles." });
  });
  assert.equal(mind.mindTurnUnplayed(world.campaign(), tobinSheet.id, turn.id), false, "asked in this turn: the basic turn is the safety net");
  setCompanionCommander(tobinSheet.id, world.owner.id);
  assert.equal(mind.mindTurnUnplayed(world.campaign(), tobinSheet.id, "another-turn"), false, "a commanded companion waits for its commander");
  setCompanionCommander(tobinSheet.id, null);
  await world.invoke("end_encounter", { outcome: "victory" });
});

await test("system: a short investigation with an absent NPC, a late messenger and a lying witness survives a restart (ticket 07, A2 A5 A6 A13)", async () => {
  const { closeDatabaseForRestore } = await import("../src/lib/db/core.ts");
  npc("Inspector Vale", { location: "the Watch House" });
  npc("Witness Gorm", { location: "the Square" });
  recordExtractedFacts(world.campaignId, [{ category: "npc", subject: "Gorm", fact: "Gorm himself stole the reliquary." }], "manual", { knownBy: "dm" });
  // The theft happens in the square: only Gorm is there.
  model.script([answer({ speech: "I saw a tall stranger run off!", lie: true })]);
  await speak({ name: "Witness Gorm", perceives: "The reliquary is gone from the shrine in the square." });
  assert.equal(memories("Inspector Vale").length, 0, "the inspector was not there");
  // Hours later a runner brings Gorm's account to the watch house.
  advanceClock(world.campaignId, 3, "hours");
  const delivered = getClock(world.campaignId).instant;
  await mind.handleNpcInform(world.campaign(), JSON.stringify({ name: "Inspector Vale", source: "Witness Gorm", news: "A tall stranger stole the reliquary and ran off." }));
  model.script([answer({ speech: "Then we look for a tall stranger.", conclusion: "the thief is a tall outsider" })]);
  await speak({ name: "Inspector Vale", perceives: "The runner waits for orders." });
  const before = memories("Inspector Vale").map(({ kind, sourceName, content, learnedAt }) => ({ kind, sourceName, content, learnedAt }));
  // Restart: the database is closed and opened again from its file.
  closeDatabaseForRestore();
  const after = memories("Inspector Vale").map(({ kind, sourceName, content, learnedAt }) => ({ kind, sourceName, content, learnedAt }));
  assert.deepEqual(after, before, "the register survives the restart unchanged");
  const told = after.find((entry) => entry.kind === "belief");
  assert.equal(told.sourceName, "Witness Gorm");
  assert.equal(told.learnedAt, delivered);
  assert.ok(after.some((entry) => entry.kind === "hypothesis" && /tall outsider/.test(entry.content)));
  assert.ok(listActiveFacts(world.campaignId).some((fact) => /Gorm himself stole/.test(fact.fact)), "the truth is unchanged");
  assert.equal(listActiveFacts(world.campaignId).some((fact) => /tall stranger/.test(fact.fact)), false, "no lie or guess became canon");
  model.script([answer({ speech: "Any news?" })]);
  model.requests.length = 0;
  await speak({ name: "Inspector Vale", perceives: "Morning at the watch house." });
  assert.doesNotMatch(mindText(mindRequests()[0]), /Gorm himself stole/, "the inspector never sees the truth");
  assert.match(mindText(mindRequests()[0]), /it may be false/);
});

model.close();
finish();
