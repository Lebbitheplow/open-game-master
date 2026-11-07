// A conversation in flight (src/lib/dm/conversation-logic.ts): the moments a
// player answers someone who just spoke to them, when the reply belongs to
// that exchange and nothing cuts in. The cases are a table's own: an elder
// asked where the blight came from (and a stag charged in instead), and a
// companion told "I've got to go back" (and the reply arrived in the village).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { conversationInFlight, conversationNote, spokenWords } = await import("../src/lib/dm/conversation-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const MIRA = "pc-mira";
const BRAM = "pc-bram";
const names = new Map([
  [MIRA, "Mira Vale"],
  [BRAM, "Bram Holt"],
]);
const companionIds = new Set([BRAM]);
const osric = { kind: "npc", id: "npc-osric", name: "Elder Osric" };
const bram = { kind: "pc", id: BRAM, name: "Bram Holt" };

// A reply and its stored lines, as [words, speaker] in the order they are
// stored, which need not be the order the reply says them.
const dm = (content, lines = []) => ({
  authorType: "dm",
  content,
  speech: lines.map(([line, speaker]) => ({ line, speaker })),
});
const player = (content, characterId = MIRA) => ({ authorType: "player", content, characterId });
const read = (history, inEncounter = false) => conversationInFlight({ history, inEncounter, companionIds, names });

test("a question put to an NPC who just spoke is a conversation with them", () => {
  const history = [
    dm('Elder Osric turns. "Mira." He nods. "You came."', [["Mira.", osric], ["You came.", osric]]),
    player('"Where would we go? Do we have any clues yet as to where this is coming from?"'),
  ];
  assert.deepEqual(read(history), { with: "Elder Osric", answering: ["Mira Vale"] });
});

test("words said to an AI companion who just spoke are a conversation with them", () => {
  const history = [
    dm('Bram Holt leans on the shelf. "Rough news?"', [["Rough news?", bram]]),
    player("“I’ve got to go back, Bram. It’s getting worse.”"),
  ];
  assert.deepEqual(read(history), { with: "Bram Holt", answering: ["Mira Vale"] });
});

test("an action with no words, a reply nobody spoke in, or a fight is no conversation", () => {
  const osricSpeaks = dm('Osric speaks. "Stay."', [["Stay.", osric]]);
  assert.equal(read([osricSpeaks, player("I approach Elder Osric and clear my throat.")]), null);
  assert.equal(read([dm("The village is quiet."), player('"Hello?"')]), null);
  assert.equal(read([osricSpeaks, player('"What now?"')], true), null);
  assert.equal(read([player('"Is anyone there?"')]), null, "nothing has been said to the party yet");
});

test("a player character's own quoted words make nobody the other side of the talk", () => {
  const hero = { kind: "pc", id: MIRA, name: "Mira Vale" };
  assert.equal(read([dm('You call out, "Anyone?"', [["Anyone?", hero]]), player('"Anyone?"')]), null);
  assert.deepEqual(
    read([dm('"Stay," Osric says. You answer, "Never."', [["Stay,", osric], ["Never.", hero]]), player('"Well?"')]),
    { with: "Elder Osric", answering: ["Mira Vale"] },
    "their own echoed line does not hide the person they were talking with",
  );
});

test("the last voice of the reply is who the party is talking with, and every answering player is named", () => {
  const history = [
    dm('"Hm," Bram grunts, and Osric answers him: "Go on."', [["Hm,", bram], ["Go on.", osric]]),
    player('"Is it the old mill?"'),
    player('"Tell us."', BRAM),
  ];
  assert.deepEqual(read(history), { with: "Elder Osric", answering: ["Mira Vale", "Bram Holt"] });
});

test("the last voice is read from the reply, not from the order its lines were stored in", () => {
  const history = [
    // The reader's lines come first, then the structural reading's (mergeLines).
    dm('"Hm," Bram grunts, and Osric answers him: "Go on."', [["Go on.", osric], ["Hm,", bram]]),
    player('"Is it the old mill?"'),
  ];
  assert.equal(read(history).with, "Elder Osric");
  assert.equal(
    read([dm('"Stay," Osric says.', [["Stay,", osric], ["A line of a take not shown.", bram]]), player('"Why?"')]).with,
    "Elder Osric",
    "a reroll's lines hold every take; only the shown one spoke",
  );
});

test("a last line nobody is on record for names nobody, rather than the person before it", () => {
  const history = [
    dm('"I don\'t trust them," Osric mutters.\n\nThe stranger in the corner chuckles. "Who\'s asking?"', [["I don't trust them,", osric]]),
    player('"Who\'s asking? I am. And who are you?"'),
  ];
  assert.deepEqual(read(history), { with: null, answering: ["Mira Vale"] });
  const goblin = { kind: "monster", id: "", name: "Goblin" };
  assert.equal(read([dm('"Stay," Osric says. "Hsss," the goblin spits.', [["Stay,", osric], ["Hsss,", goblin]]), player('"Why?"')]).with, null);
  assert.equal(read([dm('A voice calls, "Who goes there?"'), player('"Hello?"')]), null, "with nobody on record at all the reply is nobody's yet");
});

test("words are quotes of any script or a question", () => {
  for (const text of ['"Go."', "“Go.”", "„Geh.“", "«Va.»", "「行け」", "Where is it?", "¿Dónde?", "どこ？"]) {
    assert.ok(spokenWords(text), text);
  }
  assert.ok(!spokenWords("I search the shelves."));
});

test("the note asks for that person's answer and holds the fight, the arrival and the checklist", () => {
  const note = conversationNote({ with: "Elder Osric", answering: ["Mira Vale"] });
  assert.ok(note.startsWith("IN CONVERSATION: Mira Vale is talking, and Elder Osric spoke last."));
  assert.ok(note.includes("If they turn to nobody else, this reply is Elder Osric's answer"));
  assert.ok(note.includes("whoever they name or call to answers first, not Elder Osric"), "the last voice is no one's answer but their own");
  assert.ok(note.includes("if they turn to something else, answer that"), "a player who walks off to the notice board reads the board");
  assert.ok(note.includes("is not a check: roll only for a player's own attempt"), "what an NPC knows is the GM's to tell");
  assert.ok(note.includes("No fight starts"));
  assert.ok(note.includes("if they set out, end on the way there"));
  assert.ok(note.includes("open waypoints wait for a pause"));
  assert.ok(conversationNote({ with: "Mira", answering: ["A", "B"] }).startsWith("IN CONVERSATION: A and B are talking"));
  assert.ok(conversationNote({ with: "Mira", answering: [] }).startsWith("IN CONVERSATION: A player is talking"));
  const nameless = conversationNote({ with: null, answering: ["Mira Vale"] });
  assert.ok(nameless.startsWith("IN CONVERSATION: Mira Vale is talking with someone in the scene."));
  assert.ok(nameless.includes("the answer of whoever the players' words are for"));
  assert.ok(nameless.includes("No fight starts"), "the talk holds the fight whoever it is with");
  assert.ok(!nameless.includes("null"));
  // One player speaking to another's character names someone too; that
  // answer is the other player's, whichever way the note opens.
  for (const text of [note, nameless]) {
    assert.ok(text.includes("A player's character answers only through their own player"), text);
  }
});

console.log(`conversation: ${passed} tests passed`);
