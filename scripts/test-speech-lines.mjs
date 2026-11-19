// Who speaks each quoted line, stored with the message when it is written
// (src/lib/dm/speech-lines.ts): the claims reader names the speakers of a
// model's narration, in any language; a person's prose is read from its
// words, with English pronouns at an English table only. A reroll or an edit
// keeps the speakers of the lines it left alone. Runs whole turns against a
// scripted fake model on a real database.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-speech-lines");
const world = await openWorld({ gameSettings: { ttsEnabled: false, tableLanguage: "italian" } });
const english = await openWorld({ gameSettings: { ttsEnabled: false } });

const npcs = await import("../src/lib/db/npcs.ts");
const messages = await import("../src/lib/db/messages.ts");
const { narratedLines, personLines } = await import("../src/lib/dm/speech-lines.ts");
const { mergeLines } = await import("../src/lib/dm/speech.ts");
const { runRenarrate, selectRenarrateVariant } = await import("../src/lib/dm/renarrate.ts");
const { setStoryArc } = await import("../src/lib/db/campaigns.ts");
const { normalizeStoryArc } = await import("../src/lib/dm/arc-logic.ts");

const kara = world.addHero({ name: "Kara", class: "fighter", level: 3 });
const marla = npcs.upsertNpc({ campaignId: world.campaignId, name: "Marla Venn", gender: "Female" });
const said = (message) => message.speech.map((entry) => `${entry.speaker.name}: ${entry.line}`);

const model = await fakeModel();
model.pointAt(world);

await test("A turn stores who the reader says speaks each line, and never a person the prose does not name.", async () => {
  model.script([reply({ text: "Marla alza lo sguardo. «Sei tornato.»" })]);
  model.claims([[{ kind: "speaker", ref: marla.id, quote: "Sei tornato" }]]);
  const message = await model.turn(world, "Entro nella locanda.", kara.id);
  assert.deepEqual(message.speech, [{ line: "Sei tornato.", speaker: { kind: "npc", id: marla.id, name: "Marla Venn" } }]);
  const turnRead = model.readerRequests.find((request) => /Ask: .+, speaker/.test(request.messages[1].content));
  assert.match(turnRead.messages[0].content, /a speaker claim for every quoted line/, "a turn asks who speaks beside the other kinds");

  model.script([reply({ text: "Una figura incappucciata sussurra: «Fuggite.»" })]);
  model.claims([[{ kind: "speaker", ref: marla.id, quote: "Fuggite" }]]);
  const hidden = await model.turn(world, "Chi c'è?", kara.id);
  assert.deepEqual(hidden.speech, [], "the hooded figure stays nobody's, whoever the reader guesses");
});

await test("A line the reader leaves out gets the structural reading, so a split line and an unread reply still find their speaker.", async () => {
  model.script([reply({ text: "«Partiamo all'alba», disse Marla, «e non un momento dopo.»" })]);
  model.claims([[{ kind: "speaker", ref: marla.id, quote: "Partiamo all'alba" }]]);
  const split = await model.turn(world, "Quando partiamo?", kara.id);
  assert.deepEqual(said(split), ["Marla Venn: Partiamo all'alba", "Marla Venn: e non un momento dopo."]);
  model.script([reply({ text: "«Silenzio», ordina Marla." })]);
  model.claims([[]]);
  const unread = await model.turn(world, "Parlo forte.", kara.id);
  assert.deepEqual(said(unread), ["Marla Venn: Silenzio"]);
});

await test("The structural reading never gives a model's line to a party character; the reader still may.", async () => {
  const text = "Kara guarda la porta, poi Marla si avvicina. «Andiamo.»";
  assert.deepEqual(personLines(world.campaign(), text).map((entry) => entry.speaker.name), ["Kara"], "a person's prose reads the first name");
  model.script([reply({ text })]);
  model.claims([[]]);
  const unread = await model.turn(world, "Aspetto.", kara.id);
  assert.deepEqual(unread.speech, [], "left to the narrator, not given to Kara");
  model.script([reply({ text: "Kara alza la spada. «Andiamo.»" })]);
  model.claims([[{ kind: "speaker", ref: kara.id, quote: "Andiamo" }]]);
  const read = await model.turn(world, "Aspetto.", kara.id);
  assert.deepEqual(said(read), ["Kara: Andiamo."]);
});

await test("An NPC the same reply registers speaks their first line under their new row.", async () => {
  model.script([
    reply({ text: "Bruno apre la porta. «Benvenuti alla forgia.»", calls: [call("set_npc", { name: "Bruno", gender: "Male" })] }),
    reply({ text: "Il fuoco crepita." }),
  ]);
  model.claims([[{ kind: "speaker", ref: "new:Bruno", quote: "Benvenuti alla forgia" }]]);
  const message = await model.turn(world, "Saluto il fabbro.", kara.id);
  const bruno = npcs.getNpcByName(world.campaignId, "Bruno");
  assert.ok(bruno);
  assert.deepEqual(message.speech, [{ line: "Benvenuti alla forgia.", speaker: { kind: "npc", id: bruno.id, name: "Bruno" } }]);
});

// Issue 1027: the story plan named Captain Mira, GAME STATE listed her, and the
// narrator brought her on stage without set_npc. With no row she was nobody
// the table knew, so her lines had no face, no theatre insert and no voice.
await test("The story plan's cast speaks before the narrator registers them, and is registered by the line.", async () => {
  const jason = english.addHero({ name: "Jason", class: "rogue", level: 3 });
  setStoryArc(
    english.campaignId,
    normalizeStoryArc({
      premise: "A bandit lord raids Blackhaven.",
      beats: [{ text: "Take the contract.", status: "active", act: 1 }, { text: "Find Kethan.", act: 1 }],
      cast: [
        { name: "Captain Mira", role: "town protector", agenda: "End Kethan's raids." },
        { name: "Old Sabel", role: "fence", agenda: "Stay rich." },
      ],
    }),
  );
  const [mira, sabel] = english.campaign().storyArc.cast;
  const text =
    "Across from you, a stout clerk—Captain Mira, the town’s unofficial protector—leans back in a chair. Her eyes narrow as she watches you. She slides a parchment across the table, her voice low and urgent. “Word’s that the bandit lord has been raiding the outskirts.”\n\nShe hands you the contract. “Pay’s enough to keep you off the streets.”";
  model.pointAt(english);
  model.script([reply({ text })]);
  model.claims([[{ kind: "speaker", ref: `plan:${mira.id}`, quote: "Word’s that the bandit lord" }]]);
  const message = await model.turn(english, "I head to the tavern.", jason.id);
  const turnRead = model.readerRequests.findLast((request) => /Speaker refs:/.test(request.messages[1].content));
  assert.match(turnRead.messages[1].content, new RegExp(`"plan:${mira.id}" for Captain Mira`), "the reader is offered the planned speaker");
  const row = npcs.getNpcByName(english.campaignId, "Captain Mira");
  assert.ok(row, "the line registered her");
  assert.equal(row.arcCastId, mira.id, "linked to the plan's cast, as set_npc links her");
  assert.equal(row.agency.goals.ambition, "End Kethan's raids.");
  assert.deepEqual(said(message), [
    "Captain Mira: Word’s that the bandit lord has been raiding the outskirts.",
    "Captain Mira: Pay’s enough to keep you off the streets.",
  ]);
  assert.ok(message.speech.every((entry) => entry.speaker.id === row.id), "both lines carry her row, so they find her face and voice");
  assert.equal(npcs.getNpcByName(english.campaignId, "Old Sabel"), null, "a planned person who never speaks is not registered");

  // Left to the structural reading when the reader gives nobody, the set-off
  // name still finds a planned speaker.
  model.script([reply({ text: "At the counter, a thin man—Old Sabel—counts his coins. He does not look up. “No credit.”" })]);
  model.claims([[]]);
  const unread = await model.turn(english, "I ask the fence for credit.", jason.id);
  const fence = npcs.getNpcByName(english.campaignId, "Old Sabel");
  assert.ok(fence);
  assert.deepEqual(unread.speech, [{ line: "No credit.", speaker: { kind: "npc", id: fence.id, name: "Old Sabel" } }]);
  assert.equal(fence.arcCastId, sabel.id);
});

await test("A planned person the story has written out, or one sharing a hero's name, is never registered by a line.", () => {
  const gone = normalizeStoryArc({
    premise: "A bandit lord raids Blackhaven.",
    beats: [{ text: "Take the contract.", status: "active", act: 1 }, { text: "Find Kethan.", act: 1 }],
    cast: [{ name: "Brother Tam", role: "priest", agenda: "Pray." }, { name: "Jason", role: "a hero's double", agenda: "None." }],
  });
  gone.cast[0].status = "gone";
  setStoryArc(english.campaignId, gone);
  assert.deepEqual(personLines(english.campaign(), "“Pray with me,” says Brother Tam."), []);
  assert.equal(npcs.getNpcByName(english.campaignId, "Brother Tam"), null);
  const lines = personLines(english.campaign(), "“Follow me,” says Jason.");
  assert.equal(lines[0]?.speaker.kind, "pc", "the hero speaks as their sheet");
  assert.equal(npcs.getNpcByName(english.campaignId, "Jason"), null);
});

await test("A person's prose is read from its words: structure at every table, pronouns at an English one.", () => {
  const text = "Marla looks up. She smiles. “Sit.”";
  assert.deepEqual(personLines(world.campaign(), text), [], "an Italian table follows no English pronoun");
  assert.deepEqual(personLines(world.campaign(), "«Sedetevi», dice Marla."), [
    { line: "Sedetevi", speaker: { kind: "npc", id: marla.id, name: "Marla Venn" } },
  ]);
  const venn = npcs.upsertNpc({ campaignId: english.campaignId, name: "Marla Venn", gender: "Female" });
  assert.deepEqual(personLines(english.campaign(), text), [{ line: "Sit.", speaker: { kind: "npc", id: venn.id, name: "Marla Venn" } }]);
  assert.deepEqual(personLines(english.campaign(), "No one speaks."), []);
});

await test("A narrated passage spoken as one person has no lines of anyone's; an agent's keeps the reader's; a person's is read from its words.", () => {
  const text = "«Sedetevi», dice Marla.";
  const read = [{ line: "Sedetevi", speaker: { kind: "npc", id: "x", name: "Someone" } }];
  assert.deepEqual(narratedLines(world.campaign(), text, { speaker: { kind: "npc", id: marla.id, name: "Marla Venn" }, agentLines: read }), []);
  assert.deepEqual(narratedLines(world.campaign(), text, { speaker: null, agentLines: read }), read);
  assert.deepEqual(narratedLines(world.campaign(), text, { speaker: null, agentLines: null }), personLines(world.campaign(), text));
});

await test("An edit and a reroll keep the speakers of the lines they left alone; a new take's lines are read.", async () => {
  model.script([reply({ text: "Marla posa il boccale. «Domani si parte.»" })]);
  model.claims([[{ kind: "speaker", ref: marla.id, quote: "Domani si parte" }]]);
  const first = await model.turn(world, "Quando si parte?", kara.id);
  assert.deepEqual(said(first), ["Marla Venn: Domani si parte."]);

  const edited = "Marla posa il boccale. «Domani si parte.» Kara annuisce: «Bene.»";
  const kept = messages.updateMessageContent(first.id, edited, mergeLines(first.speech, personLines(world.campaign(), edited)));
  assert.deepEqual(said(kept), ["Marla Venn: Domani si parte.", "Kara: Bene."]);

  model.script([reply({ text: "Marla sorride. «All'alba, allora.»" })]);
  // The take is read for asides first, then for who speaks.
  model.claims([[], [{ kind: "speaker", ref: marla.id, quote: "All'alba" }]]);
  const rerolled = await runRenarrate({ campaignId: world.campaignId, messageId: first.id, guidance: "" });
  assert.ok("message" in rerolled, rerolled.error);
  assert.deepEqual(said(rerolled.message), ["Marla Venn: Domani si parte.", "Kara: Bene.", "Marla Venn: All'alba, allora."]);
  const rerollRead = model.readerRequests.find((request) => /Ask: speaker\n/.test(request.messages[1].content));
  assert.doesNotMatch(rerollRead.messages[0].content, /every quoted line/, "a read asking only who speaks is not told to answer for every line");
  const back = selectRenarrateVariant({ campaignId: world.campaignId, messageId: first.id, index: 0 });
  assert.ok("message" in back, back.error);
  assert.deepEqual(back.message.speech, rerolled.message.speech, "switching takes keeps every take's speakers");
});

model.close();
world.close();
english.close();
finish();
