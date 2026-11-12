// Who is talking (docs/vtt-parity-implementation-plan.md 8.1): a quote
// the prose ties to a known person is theirs, any other stays the
// narrator's. The reading is structural in every table language; English
// alone also follows its pronouns back.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const speech = await import("../src/lib/dm/speech.ts");
const { normalizeSpeaker, speakersIn, spokenLine } = speech;
// An English table: the pronouns are read (src/lib/dm/speech-prose.ts).
const attributeSpeech = (text, speakers, options = {}) => speech.attributeSpeech(text, speakers, { englishPronouns: true, ...options });

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const cast = [
  { kind: "npc", id: "n1", name: "Marla" },
  { kind: "npc", id: "n2", name: "Old Pike" },
];

test("a name before or after a quote attributes it, within eight words", () => {
  const segments = attributeSpeech('Marla looks up. "You came back," she says. The fire pops. "Sit," says Old Pike.', cast);
  assert.deepEqual(
    segments.map((segment) => (segment.kind === "speech" ? `${segment.speaker.name}: ${segment.text}` : `prose: ${segment.text.trim()}`)),
    ["prose: Marla looks up.", "Marla: You came back,", "prose: she says. The fire pops.", "Old Pike: Sit,", "prose: says Old Pike."],
  );
});

test("a quote with no name near it stays the narrator's", () => {
  const far = `Someone in the crowd, eleven words further along the way than any name, mutters "Not again." Nine plain words then quietly follow before the name Marla appears.`;
  const segments = attributeSpeech(far, cast);
  assert.ok(segments.every((segment) => segment.kind === "prose"), "the name is more than eight words off");
  assert.deepEqual(attributeSpeech("No quotes at all.", cast), [{ kind: "prose", text: "No quotes at all." }]);
  assert.deepEqual(attributeSpeech('"Hello," says Marla.', []), [{ kind: "prose", text: '"Hello," says Marla.' }]);
});

test("one line's name never borrows into the next, and curly quotes count", () => {
  const segments = attributeSpeech('“We ride at dawn,” said Marla. “Fine.”', cast);
  const speech = segments.filter((segment) => segment.kind === "speech");
  assert.equal(speech.length, 1, "Marla's name was spent on the first line; the second stays the narrator's");
  assert.equal(speech[0].speaker.name, "Marla");
  const apart = attributeSpeech('“We ride at dawn,” said Marla. Twelve long words then pass between the speakers before anyone else says anything more. “Fine.”', cast);
  assert.equal(apart.filter((segment) => segment.kind === "speech").length, 1);
});

test("speakers are listed once, in order, and a speaker normalises", () => {
  const segments = attributeSpeech('"One," says Marla. "Two," says Old Pike. "Three," says Marla.', cast);
  assert.deepEqual(speakersIn(segments).map((speaker) => speaker.name), ["Marla", "Old Pike"]);
  assert.deepEqual(normalizeSpeaker({ kind: "npc", id: "n1", name: " Marla " }), { kind: "npc", id: "n1", name: "Marla" });
  assert.equal(normalizeSpeaker({ kind: "npc" }), null);
  assert.equal(normalizeSpeaker("x"), null);
});

// Issue 97: the prose rarely spells a name out in full.
test("a first name, a last name or an alias finds the person", () => {
  const table = [
    { kind: "npc", id: "n1", name: "Captain Marla Venn", aliases: ["the Captain"] },
    { kind: "npc", id: "n2", name: "Old Pike" },
    { kind: "pc", id: "s1", name: "Kara Brightwood" },
  ];
  const said = (text) => attributeSpeech(text, table).filter((segment) => segment.kind === "speech").map((segment) => segment.speaker.id);
  assert.deepEqual(said('"Hold the gate," says Marla.'), ["n1"]);
  assert.deepEqual(said('Venn frowns. "Not tonight."'), ["n1"]);
  assert.deepEqual(said('"Stand down," orders the Captain.'), ["n1"]);
  assert.deepEqual(said('"Aye," mutters Pike.'), ["n2"]);
  assert.deepEqual(said('"I will go first," Kara says.'), ["s1"]);
  assert.deepEqual(said('"Too old for this," someone says.'), [], "a title or an adjective is nobody's name");
  const hill = [{ kind: "npc", id: "h", name: "Tom Hill" }];
  assert.equal(attributeSpeech('"Up the hill," someone calls.', hill).filter((segment) => segment.kind === "speech").length, 0, "a word of a name only counts written as a name");
  assert.equal(attributeSpeech('"Up we go," Hill calls.', hill).filter((segment) => segment.kind === "speech").length, 1);
});

test("a short name two people share belongs to neither", () => {
  const twins = [
    { kind: "npc", id: "a", name: "Aldric Venn" },
    { kind: "npc", id: "b", name: "Marla Venn" },
  ];
  const segments = attributeSpeech('"We are agreed," says Venn. "Good," says Marla.', twins);
  assert.deepEqual(segments.filter((segment) => segment.kind === "speech").map((segment) => segment.speaker.id), ["b"]);
});

test("a line the tag splits in two stays one speaker's, a reply does not", () => {
  const split = attributeSpeech('"We ride at dawn," said Marla, "and not a moment later."', cast);
  assert.deepEqual(split.filter((segment) => segment.kind === "speech").map((segment) => segment.text), ["We ride at dawn,", "and not a moment later."]);
  const crowded = attributeSpeech('"Hold the gate," says Marla, "or we all die here." Old Pike does not look up.', cast);
  assert.deepEqual(
    crowded.filter((segment) => segment.kind === "speech").map((segment) => segment.speaker.name),
    ["Marla", "Marla"],
    "the next name along does not take the second half of her sentence",
  );
  const reply = attributeSpeech('"We ride at dawn," said Marla. "Fine."', cast);
  assert.equal(reply.filter((segment) => segment.kind === "speech").length, 1);
});

// A name beside a line is not its speaker: the sentence before a line is
// about whoever it opens with, and a person the table does not know is
// still somebody.
const said = (text, table, options) =>
  attributeSpeech(text, table, options)
    .filter((segment) => segment.kind === "speech")
    .map((segment) => `${segment.speaker.name}: ${segment.text.slice(0, 12)}`);

const SHRINE = [
  "Sella inclines her head to Liriel, a small acknowledgment rather than a smile.",
  "",
  "“Duskleaf’s waystone. I took it because someone was altering the ward through this fragment. Leaving it there would have meant letting them finish.”",
  "",
  "She keeps her hand beside the etched stone. “I didn’t steal its light. I was trying to keep someone from turning that light against the people it protects. But taking the fragment hasn’t cleansed it—please don’t simply put it back.”",
  "",
  "Her gaze moves between you. “The shrine’s basin may show what’s been done to it. Will you help me find out?”",
].join("\n");

test("a line after 'Sella turns to Liriel' is Sella's, or nobody's when Sella is not in the cast", () => {
  const liriel = { kind: "pc", id: "s1", name: "Liriel Syn'thae" };
  assert.deepEqual(said(SHRINE, [liriel]), [], "the party member the NPC bowed to never takes her lines");
  const sella = { kind: "npc", id: "n9", name: "Sella" };
  assert.deepEqual(said(SHRINE, [liriel, sella]), ["Sella: Duskleaf’s w", "Sella: I didn’t ste", "Sella: The shrine’s"], "she and her carry on about Sella");
});

test("the subject of the sentence before a line speaks it, not the person it turns to", () => {
  assert.deepEqual(said('Marla turns to Old Pike. "We leave at dawn."', cast), ["Marla: We leave at "]);
  assert.deepEqual(said('The innkeeper turns to Marla. "We leave at dawn."', cast), [], "an unknown speaker is still not Marla");
  assert.deepEqual(said('Kaelen inclines his head. "Prudent."\n\nBrisca slips half the coin into her belt.', [{ kind: "npc", id: "k", name: "Father Kaelen" }, { kind: "pc", id: "b", name: "Brisca Hale" }]), ["Father Kaelen: Prudent."]);
});

test("a tag's pronoun is the person before it, never a name the tag mentions", () => {
  assert.deepEqual(said('Marla kneels by the fire. "Hold still," she says, glancing at Old Pike.', cast), ["Marla: Hold still,"]);
  assert.deepEqual(said('Marla looks up. "Who goes there?" a guard calls.', cast), [], "a stranger's tag is a stranger's line");
  assert.deepEqual(said('Sella turns to Marla. "Who goes there?" Marla calls out.', cast), [], "after a line that ends its sentence, no word list tells a tag from an action");
  assert.deepEqual(said('Marla looks up. "Fine," you say.', cast), [], "the players' own words are nobody's at the table");
});

test("an action after a line counts only in the line's own paragraph, and only as its subject", () => {
  assert.deepEqual(said('"Not tonight." Marla frowns.', cast), ["Marla: Not tonight."]);
  assert.deepEqual(said('"There is more trouble at the market."\n\nMarla turns to you.', cast), [], "the next paragraph's first name is not this line's speaker");
  const table = [...cast, { kind: "pc", id: "s1", name: "Lebbi" }];
  assert.deepEqual(said('A merchant approaches you, his face pale. "Please! Take this!" He thrusts a heavy pouch into Lebbi\'s hands.', table), [], "a merchant's line is not the hands he fills");
});

test("a line with someone else's name straight after it is nobody's, whoever the prose before it is about", () => {
  const common = new Set(["the", "a", "silence"]);
  assert.deepEqual(said('Marla scowls at the stranger. "Who\'s asking?" Fella says.', cast, { common }), [], "a name with no row yet, in a tag");
  assert.deepEqual(said('Marla scowls. "No." Old Pike calls out.', cast, { common }), [], "a name the table knows, the same");
  assert.deepEqual(said('Marla scowls. "No." Marla turns away.', cast, { common }), ["Marla: No."], "the same person carries on");
  assert.deepEqual(said('Marla scowls. "No." She turns away.', cast, { common }), ["Marla: No."]);
  assert.deepEqual(said('Marla scowls. "No." The door creaks.', cast, { common }), ["Marla: No."], "a word the story writes in lower case is no name");
  assert.deepEqual(said('Marla scowls. "No." Silence falls.', cast, { common }), ["Marla: No."]);
  assert.deepEqual(said('Marla scowls. "No."\n\nFella flinches.', cast, { common }), ["Marla: No."], "the next paragraph says nothing about this line");
  assert.deepEqual(said('Marla scowls at Old Pike. "Not you." "Why not?" Old Pike asks.', cast, { common })[0], "Marla: Not you.", "the words after a line run only to the next line");
  // The sentence after a line opens on its own, so a word of a longer name
  // there is that person only if the story never writes it in lower case.
  const old = new Set([...common, "old"]);
  assert.deepEqual(said('Marla scowls. "No." Old habits die hard.', cast, { common: old }), ["Marla: No."], "an adjective is not Old Pike");
  assert.deepEqual(said('Marla scowls. "No." Old Pike laughs.', cast, { common: old }), [], "his whole name still is");
  assert.deepEqual(said('"No." Old habits die hard.', cast, { common: old }), [], "a line opening its paragraph is not Old Pike's either");
  assert.deepEqual(said('"No." Old Pike laughs.', cast, { common: old }), ["Old Pike: No."], "while his own beat after it is");
});

test("a tag's pronoun is never the person the tag names as spoken to", () => {
  const bram = { kind: "npc", id: "b", name: "Bram" };
  assert.deepEqual(said('Fella glances over. "You keep poor company," he tells Bram.', [...cast, bram]), []);
  assert.deepEqual(said('Marla looks over. "You keep poor company," she tells Bram.', [...cast, bram]), ["Marla: You keep poo"]);
  assert.deepEqual(said('He tells Bram. "Run."', [...cast, bram]), [], "a sentence before a line, the same");
});

test("a pronoun only follows back past a second name when the passage says it means the first", () => {
  assert.deepEqual(said('Marla nods to Old Pike. He grins. "Fine."', cast), [], "he could be Pike");
  assert.deepEqual(said('Marla nods to Old Pike, then tucks her hair back. She waits. "Fine."', cast), [], "her hair comes after Pike is named, so it could be anyone's");
  assert.deepEqual(said('Marla sets down her cup and nods to Old Pike. She waits. "Fine."', cast), ["Marla: Fine."], "her cup is Marla's, so she is Marla");
  assert.deepEqual(said('Marla looks up. She sighs, and he shrugs. "Fine."', cast), [], "she and he both: two people");
  assert.deepEqual(said('"One," says Marla. She pauses. "Two."', cast), ["Marla: One,", "Marla: Two."], "a pronoun after the tag follows the last speaker");
});

test("a line names nobody by the words inside other lines, and runs no further than its own line", () => {
  assert.deepEqual(said('A stranger bursts in. "Marla sent me to find you." The room goes still. "Sit down."', cast), []);
  const unclosed = said('Marla says, "We go now.\n\n"Wait," says Old Pike.', cast);
  assert.deepEqual(unclosed, ["Old Pike: Wait,"], "an unclosed quote does not swallow the next paragraph");
});

test("a sentence that hands the floor to a line, an opening phrase, a possessive, a name with an accent", () => {
  assert.deepEqual(said('Old Pike watches as Marla says, "Enough."', cast), ["Marla: Enough."]);
  assert.deepEqual(said('Without looking up, Marla sets down her cup. "Enough."', cast), ["Marla: Enough."]);
  assert.deepEqual(said('"Lebbi," Marla\'s voice comes from the dark.', cast), ["Marla: Lebbi,"]);
  assert.deepEqual(said('Élodie smiles. "Welcome."', [{ kind: "npc", id: "e", name: "Élodie" }]), ["Élodie: Welcome."]);
  assert.deepEqual(said('Captain Venn frowns. "Not tonight."', [{ kind: "npc", id: "n1", name: "Captain Marla Venn" }]), ["Captain Marla Venn: Not tonight."]);
});

test("Say quotes a player's words once, and never turns their action into speech", () => {
  assert.equal(spokenLine("  Then tell us.  "), '"Then tell us."');
  assert.equal(spokenLine('"Then tell us."'), '"Then tell us."', "already quoted");
  const mixed = 'Liriel leaves the fragment untouched. "Then tell us. Which waystone did this come from?"';
  assert.equal(spokenLine(mixed), mixed, "the action stays action and the line stays a line");
  assert.equal(spokenLine("“Then tell us,” Liriel says."), "“Then tell us,” Liriel says.");
  assert.equal(spokenLine("«Allora diccelo.»"), "«Allora diccelo.»", "every language's quote marks count as already quoted");
});

// Every table language reads the same structure: the quote pairs its prose
// uses, a tag after a comma, a colon lead-in, the subject before a line and
// the action after it. Pronouns are English's alone.
const other = (text, table) =>
  speech
    .attributeSpeech(text, table, { englishPronouns: false })
    .filter((segment) => segment.kind === "speech")
    .map((segment) => `${segment.speaker.name}: ${segment.text.slice(0, 12)}`);

test("each language's quote pairs and comma tags find the speaker", () => {
  assert.deepEqual(other("«Tenete il cancello», dice Marla. «Subito», risponde il Vecchio Pike.", [cast[0], { kind: "npc", id: "n2", name: "Vecchio Pike" }]), ["Marla: Tenete il ca", "Vecchio Pike: Subito"]);
  assert.deepEqual(other("« Tenez la porte », dit Marla.", cast), ["Marla: Tenez la por"]);
  assert.deepEqual(other("„Haltet das Tor“, sagt Marla.", cast), ["Marla: Haltet das T"]);
  assert.deepEqual(other("»Hold porten«, siger Marla.", cast), ["Marla: Hold porten"]);
  assert.deepEqual(other("“Sujetad la puerta”, dice Marla.", cast), ["Marla: Sujetad la p"]);
  assert.deepEqual(other("L'oste ride. «Non stanotte.»", cast), [], "an apostrophe opens no quote, and a stranger is nobody");
  assert.deepEqual(other("Pike segna « sulla mappa. «Basta!» dice Marla.", cast), ["Marla: Basta!"], "a lone guillemet opens nothing");
});

test("the subject before a line, the action after it and a colon lead-in, in any language", () => {
  assert.deepEqual(other("Marla alza lo sguardo. «Sei tornato.»", cast), ["Marla: Sei tornato."]);
  assert.deepEqual(other("«Non stanotte.» Marla aggrotta la fronte.", cast), ["Marla: Non stanotte"]);
  assert.deepEqual(other("Pike guarda mentre Marla dice: «Basta.»", cast), ["Marla: Basta."]);
  assert.deepEqual(other("Sella si volta verso Marla. «Chi va là?»", cast), [], "the person turned to is not the speaker");
  assert.deepEqual(other("Senza alzare gli occhi, Marla posa la tazza. «Basta.»", cast), ["Marla: Basta."]);
});

test("someone else's name after a line, and a tag that opens on its verb, in any language", () => {
  assert.deepEqual(other("Marla aggrotta la fronte. «Chi va là?» Fella dice.", cast), []);
  assert.deepEqual(other("Marla aggrotta la fronte. «Chi va là?» Marla si volta.", cast), ["Marla: Chi va là?"], "the same person carries on");
  assert.deepEqual(other("Fella si volta. «Basta», dice Marla.", cast), ["Marla: Basta"]);
});

test("pronouns are followed back only at an English table", () => {
  assert.deepEqual(other("Marla alza lo sguardo. Sorride. «Siediti.»", cast), [], "Italian drops the pronoun: nothing to follow");
  assert.deepEqual(other('Marla looks up. She smiles. "Sit."', cast), [], "English prose at another table is read structurally");
  assert.deepEqual(said('Marla looks up. She smiles. "Sit."', cast), ["Marla: Sit."]);
});

test("who 'she' can mean comes from the gender field", () => {
  const table = [
    { kind: "npc", id: "n1", name: "Marla", gender: "Female" },
    { kind: "npc", id: "n2", name: "Old Pike", gender: "Male" },
  ];
  assert.deepEqual(said('"Hold still," he says. Marla kneels by the fire.', table), []);
  assert.deepEqual(said('Marla nods to Old Pike. She waits. "Fine."', table), ["Marla: Fine."], "only Marla is a she");
  assert.deepEqual(said('Marla nods to Old Pike. He grins. "Fine."', table), [], "he is not Marla");
});

test("a word of a name the story writes in lower case names nobody where it opens a sentence", () => {
  const pike = [{ kind: "npc", id: "n2", name: "Old Pike" }];
  assert.deepEqual(said('Old habits die hard. "Never again."', pike, { common: new Set(["old"]) }), []);
  assert.deepEqual(said('Old habits die hard. "Never again."', pike), ["Old Pike: Never again."], "nothing says old is a common word");
  assert.deepEqual(said('"Never again," mutters Old Pike.', pike, { common: new Set(["old"]) }), ["Old Pike: Never again,"]);
  const venn = [{ kind: "npc", id: "n1", name: "Marla Venn" }];
  assert.deepEqual(said('The captain waits. Captain Venn frowns. "Not tonight."', venn), ["Marla Venn: Not tonight."], "a title the story writes in lower case is passed over");
});

test("stored lines draw the same segments, survive a rewrite of other lines, and read back only when shaped", () => {
  const text = '"Hold the gate," says Marla. "Aye," says Old Pike. "Who?"';
  const lines = speech.linesOf(attributeSpeech(text, cast));
  assert.deepEqual(lines.map((entry) => [entry.line, entry.speaker.name]), [["Hold the gate,", "Marla"], ["Aye,", "Old Pike"]]);
  assert.deepEqual(speech.segmentsOf(text, lines), attributeSpeech(text, cast).map((segment) => (segment.kind === "speech" ? { ...segment, speaker: speech.storedSpeaker(segment.speaker) } : segment)));
  const edited = '"Hold the gate," says Marla. "Never," says Old Pike.';
  const kept = speech.mergeLines(lines, speech.linesOf(attributeSpeech(edited, cast)));
  assert.deepEqual(speech.segmentsOf(edited, kept).filter((segment) => segment.kind === "speech").map((segment) => segment.text), ["Hold the gate,", "Never,"]);
  assert.deepEqual(speech.normalizeSpokenLines([{ line: "Hi", speaker: { kind: "pc", id: "s1", name: "Kara" } }, { line: "x", speaker: { kind: "narrator", name: "N" } }, "junk"]), [{ line: "Hi", speaker: { kind: "pc", id: "s1", name: "Kara" } }]);
  assert.equal(speech.storedSpeaker({ kind: "npc", id: "n1", name: "Marla", aliases: ["M"], gender: "Female" }).gender, undefined, "a stored line keeps who, not how they were found");
});

test("a line split by a short tag is one card with the tag inside it (issue #917)", () => {
  // As the transcript draws a message: the stored lines, then the cards.
  const people = [{ ...cast[0], gender: "Female" }, cast[1]];
  const cardsFor = (text) =>
    speech.cardsOf(speech.segmentsOf(text, speech.linesOf(attributeSpeech(text, people)))).map((card) =>
      card.kind === "speech" ? `${card.speaker.name}: ${card.parts.map((part) => (part.kind === "tag" ? `[${part.text}]` : part.text)).join(" ")}` : `prose: ${card.text.trim()}`,
    );
  // Model-written text: the claims reader stores both halves as Marla's
  // (src/lib/dm/claims.ts), where attributeSpeech leaves a line after a
  // full stop open.
  const stored = '"Marla," she says. "Which one."';
  const both = [{ line: "Marla,", speaker: cast[0] }, { line: "Which one.", speaker: cast[0] }];
  assert.deepEqual(speech.cardsOf(speech.segmentsOf(stored, both)), [
    { kind: "speech", speaker: cast[0], parts: [{ kind: "words", text: "Marla," }, { kind: "tag", text: "she says." }, { kind: "words", text: "Which one." }] },
  ]);
  assert.deepEqual(cardsFor('"We ride at dawn," said Marla, "and not a moment later."'), ["Marla: We ride at dawn, [said Marla,] and not a moment later."]);
  // Another speaker between is two cards, as before.
  assert.deepEqual(cardsFor('"Hold the gate," says Marla. "Aye," says Old Pike.'), ["Marla: Hold the gate,", "prose: says Marla.", "Old Pike: Aye,", "prose: says Old Pike."]);
  // So is a long passage, a new paragraph, or a quote nobody is tied to.
  const marla = { kind: "npc", id: "n1", name: "Marla" };
  const split = (between) => speech.cardsOf([{ kind: "speech", text: "Go,", speaker: marla }, { kind: "prose", text: between }, { kind: "speech", text: "now.", speaker: marla }]).length;
  assert.equal(split(" she says, and the wind takes the rest of it away from her. "), 3);
  assert.equal(split(" she says.\n\n"), 3);
  assert.equal(split(' she says. "Why?" '), 3);
  assert.equal(split(" she says. "), 1);
});

console.log(`test-speech-attribution: ${passed} passed`);
