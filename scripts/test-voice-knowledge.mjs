// Lines the narrator voices for the world's people say only what those
// people could know (src/lib/dm/voice-knowledge-logic.ts). The case that
// asked for it: a sentinel at a quarantine barrier, meeting a traveller who
// walked up alone, told him to "go back to your people" and warned about
// "the wagon" left out of sight behind him.
//
// The reader is a model; here its replies are scripted, so what is pinned is
// everything around it: which lines it is asked about, what it is shown, how
// its reply is held to those lines, and what the guard does with a leak.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-voice-knowledge");
const logic = await import("../src/lib/dm/voice-knowledge-logic.ts");
const { readVoiceLeaks } = await import("../src/lib/dm/voice-knowledge.ts");
const { enforceEngineBoundary } = await import("../src/lib/dm/narration-guard.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { upsertNpc } = await import("../src/lib/db/npcs.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const messages = await import("../src/lib/db/messages.ts");

const LEAKY =
  "La sentinella perde il mezzo sorriso. «Non so dirti quanti muoiano.» Si aggiusta la coperta. «Puoi tornare dai tuoi e decidere con loro. Per Roccanera resta il problema del carro: i sentieri non sono sicuri.»";
const CLEAN =
  "La sentinella perde il mezzo sorriso. «Non so dirti quanti muoiano.» Si aggiusta la coperta. «Se hai paura, non oltrepassare le travi. I sentieri sulle alture non sono sicuri con questo fango, nemmeno per chi va a piedi da solo come te.»";

const say = (campaignId, authorType, content, characterId) =>
  messages.insertCampaignMessage({ campaignId, seq: campaigns.allocateSeq(campaignId), authorType, content, ...(characterId ? { characterId } : {}) });

await test("the narrator's own quoted lines are the ones read; a mind's words are not", () => {
  const conversation = [
    { role: "assistant", content: "", tool_calls: [{ id: "s1", type: "function", function: { name: "npc_speak", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "s1", content: JSON.stringify({ ok: true, npc: "Aldren", says: "Il sigillo non è dei Valdren." }) },
  ];
  const minds = logic.mindSpeeches(conversation);
  assert.deepEqual(minds, ["Il sigillo non è dei Valdren."]);
  const narration = "Aldren scuote la testa. «Il sigillo non è dei Valdren.» La sentinella ride. «E tu chi saresti?»";
  assert.deepEqual(logic.narratorLines(narration, minds), ["E tu chi saresti?"]);
  assert.deepEqual(logic.narratorLines("Piove sulla strada.", []), []);
});

await test("a leak holds only when its words are in a line it was asked about", () => {
  const lines = ["Puoi tornare dai tuoi e decidere con loro.", "Per Roccanera resta il problema del carro."];
  const leaks = logic.parseLeaks(
    JSON.stringify({
      leaks: [
        { speaker: "Sentinella", quote: "«tornare dai tuoi»", fact: "che viaggia con altri" },
        { speaker: "Sentinella", quote: "il problema del carro", fact: "il carro fuori vista" },
        { speaker: "Sentinella", quote: "the reader made this up", fact: "nothing" },
        { speaker: "Sentinella", quote: "il problema del carro", fact: "twice" },
      ],
    }),
    lines,
  );
  assert.deepEqual(leaks.map((leak) => leak.quote), ["«tornare dai tuoi»", "il problema del carro"]);
  assert.equal(logic.parseLeaks("no json here", lines), null);
  assert.deepEqual(logic.parseLeaks('Sure: {"leaks":[]}', lines), []);
  const contradiction = logic.leakContradiction(leaks[1]);
  assert.equal(contradiction.kind, "knowledge");
  assert.match(contradiction.detail, /cannot know il carro fuori vista/);
  assert.match(logic.knowledgeCorrectionPrompt([contradiction]), /You wrote: "il problema del carro"/);
});

const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true } });
const model = await fakeModel();
model.pointAt(world);
const brakk = world.addHero({ name: "Brakk", class: "barbarian", level: 3 });
upsertNpc({ campaignId: world.campaignId, name: "Sentinella del cordone", trait: "stanco, onesto", location: "Sbarramento di Malfosso" });
say(world.campaignId, "dm", "Dal dosso, Brakk vede le travi dello sbarramento. Il carro della scorta è fuori vista, alle sue spalle.");
say(world.campaignId, "player", "È mortale sto morbo? Se no, io torno indietro.", brakk.id);

await test("the reader is shown the scene, the speaker, and only the narrator's lines", async () => {
  let asked = null;
  const turn = createDmTurn(world.campaignId, [], "ai");
  const found = await readVoiceLeaks(world.campaign(), turn, world.sheets(), LEAKY, async (reading) => {
    asked = reading;
    return JSON.stringify({ leaks: [{ speaker: "Sentinella del cordone", quote: "il problema del carro", fact: "il carro della scorta, mai visto" }] });
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].clause, "il problema del carro");
  const [system, user] = asked;
  assert.ok(system.content.startsWith("You check what characters voiced by a game master could know"));
  assert.match(user.content, /Sentinella del cordone \(trait: stanco, onesto; place: Sbarramento di Malfosso\)/, "the sentinel is found from 'la sentinella'");
  assert.match(user.content, /fuori vista, alle sue spalle/, "the scene so far is shown");
  assert.match(user.content, /Player characters \(never flagged\): Brakk/);
  assert.match(user.content, /- «Puoi tornare dai tuoi e decidere con loro\./);
});

await test("with the NPC minds or the outcome check off, nothing is read", async () => {
  const quiet = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: false } });
  const turn = createDmTurn(quiet.campaignId, [], "ai");
  let calls = 0;
  const found = await readVoiceLeaks(quiet.campaign(), turn, quiet.sheets(), LEAKY, async () => {
    calls += 1;
    return '{"leaks":[]}';
  });
  assert.deepEqual(found, []);
  assert.equal(calls, 0);
});

await test("the guard rewrites a leaking line once, and keeps a clean one", async () => {
  const leak = { speaker: "Sentinella del cordone", quote: "il problema del carro", fact: "il carro mai visto" };
  const guarded = async (narration, rewrite, leaks) => {
    const turn = createDmTurn(world.campaignId, [{ role: "system", content: "system prompt" }], "ai");
    turn.narrationParts = [narration];
    model.script(rewrite ? [rewrite] : []);
    model.claims([]);
    model.leaks(leaks);
    const out = await enforceEngineBoundary(world.campaign(), turn, world.sheets(), new Map());
    return { guard: out.guard, text: turn.narrationParts.join("\n\n"), served: model.served() };
  };
  const fixed = await guarded(LEAKY, reply({ text: CLEAN }), [[leak], []]);
  assert.deepEqual(fixed.guard, { outcome: "rewritten", kinds: ["knowledge"] });
  assert.equal(fixed.text, CLEAN);
  assert.match(model.requests.at(-1).messages.at(-1).content, /cannot know il carro mai visto/);
  assert.equal(model.knowledgeRequests.length, 2, "the rewrite is read again");

  const stubborn = await guarded(LEAKY, reply({ text: LEAKY }), [[leak], [leak]]);
  assert.equal(stubborn.guard.outcome, "kept_unresolved");
  assert.ok(!stubborn.text.includes("problema del carro"), "the sentence the rewrite kept leaking is cut");

  const clean = await guarded(CLEAN, null, [[]]);
  assert.deepEqual(clean.guard, { outcome: "quiet", kinds: [] });
  assert.equal(clean.served, 0, "no rewrite is asked");
  assert.equal(clean.text, CLEAN);
});

await test("a rewrite that drops what a mind said is not taken: the mind's line stays, the leak is cut", async () => {
  const NERA = "Portate queste testimonianze a chi può costringere gli uomini di Vargo a rispondere. E fate arrivare cibo al villaggio: i malati non mangiano le prove.";
  const MINDS = `Nera indica le carte nelle tue mani. «${NERA}»`;
  const leak = { speaker: "Sentinella del cordone", quote: "il problema del carro", fact: "il carro mai visto" };
  const turn = createDmTurn(world.campaignId, [{ role: "system", content: "system prompt" }], "ai");
  turn.conversation.push(
    { role: "assistant", content: "", tool_calls: [{ id: "speak_1", type: "function", function: { name: "npc_speak", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "speak_1", content: JSON.stringify({ ok: true, npc: "Nera", says: NERA }) },
  );
  turn.narrationParts = [MINDS, LEAKY];
  model.script([reply({ text: CLEAN })]);
  model.claims([]);
  model.leaks([[leak]]);
  const out = await enforceEngineBoundary(world.campaign(), turn, world.sheets(), new Map());
  const text = turn.narrationParts.join("\n\n");
  assert.equal(out.guard.outcome, "kept_unresolved");
  assert.ok(text.includes(NERA), text);
  assert.ok(!text.includes("problema del carro"), text);
  assert.equal(logic.droppedMindLines(`${MINDS}\n\n${CLEAN}`, `«${NERA}» ${CLEAN}`, [NERA]).length, 0, "a mind's line kept in other prose is not dropped");
});

model.close();
finish();
