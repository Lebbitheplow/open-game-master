// Sweep, modelio (4): the readers of a player's English that decide what the
// AI may do with their character's turn (src/lib/dm/player-word-logic.ts),
// against a phrase matrix.
//
// The verbs are the reader's own: the alternatives of its ACTS expression,
// read from the source, so a verb added there is walked the day it lands.
// Each verb is put through the forms a player writes on their turn in a
// fight, and each form states what the module's header says it is:
//
//   affirmative   "I attack the goblin."                 declares the turn
//   asks-by-verb  "Can I attack the goblin?"             declares ("a question counts only when it asks for the action by its verb")
//   negated       "I won't attack the goblin."           declares nothing: the player said what the character will NOT do
//   to-another    "Brann, attack the goblin!"            declares nothing for the speaker's own character
//   quoted-ask    "\"Should we attack?\" I ask Brann."   declares nothing ("a line that only asks a question declares nothing")
//
// and the hold reader ("keeps the character where they stand: no walk of
// theirs is made this turn") is put through the phrases that hold and the
// ones that only look like it: every hold phrase of HOLD_VERB's own word
// list said plainly, negated, and inside a sentence that moves.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, gap, finish } = suite("test-enforce-sweep-modelio-words");
const { readPlayerWord, englishHold, englishActs, onlyAsks } = await import("../src/lib/dm/player-word-logic.ts");

const source = fs.readFileSync(fileURLToPath(new URL("../src/lib/dm/player-word-logic.ts", import.meta.url)), "utf8");
// const ACT_VERBS = "a|b|c ...";, which ACTS and DECLINED both read.
const actsSource = /const ACT_VERBS =\s*\n?\s*"([^"]+)";/.exec(source);
assert.ok(actsSource, "the ACTS expression is where this suite reads it");
// Top-level alternatives only; "go (?:to|for)" becomes "go to".
const VERBS = [];
{
  let depth = 0;
  let word = "";
  for (const char of actsSource[1]) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "|" && depth === 0) {
      VERBS.push(word);
      word = "";
    } else {
      word += char;
    }
  }
  VERBS.push(word);
}
const plain = (verb) => verb.replace(/\(\?:([^|)]+)[^)]*\)/g, "$1");

const STARTED = "2026-01-01T00:00:10.000Z";
const DURING = "2026-01-01T00:00:20.000Z";
const word = (text) => readPlayerWord([{ content: text, createdAt: DURING, card: null }], { fightStartedAt: STARTED, english: true, names: ["Goblin"], read: null });

const FORMS = {
  affirmative: { say: (verb) => `I ${verb} the goblin.`, declares: true },
  "asks-by-verb": { say: (verb) => `Can I ${verb} the goblin?`, declares: true },
  negated: { say: (verb) => `I won't ${verb} the goblin.`, declares: false },
  "to-another": { say: (verb) => `Brann, ${verb} the goblin!`, declares: false },
  "quoted-ask": { say: (verb) => `"Should we ${verb} the goblin?" I ask Brann.`, declares: false },
};

// What fails today. One entry per form: the reader has no notion of the
// form at all, so every verb fails it the same way; a verb that starts
// holding moves its row out of the gap by failing the suite. A turned-down
// action ("I won't attack the goblin.") holds for every verb since #888's
// review (DECLINED in player-word-logic.ts), so it is a test now.
const KNOWN_FORMS = {
  "to-another": {
    rule: "The AI spends a character's turn only on what their player asked for that character. An order to another character ('Brann, attack the goblin!') declares nothing the speaker's own character does.",
    where: "src/lib/dm/player-word-logic.ts readPlayerWord (the reader is handed foes and spells as names, never the party's)",
    severity: "low",
    note: "No ruling written. The reader cannot tell whom a line addresses: it has no list of the other characters' names.",
  },
  "quoted-ask": {
    rule: "src/lib/dm/player-word-logic.ts header: 'a line that only asks a question declares nothing'.",
    where: "src/lib/dm/player-word-logic.ts onlyAsks (a sentence must END in a question mark: a quoted question followed by its tag does not)",
    severity: "low",
    note: "In flight: PR #887 reads a quoted question with its tag as a question, in the fight-turn rule too.",
  },
};

let rows = 0;
const unexpected = [];
for (const form of Object.keys(FORMS)) {
  const failing = [];
  for (const verb of VERBS) {
    rows += 1;
    const text = FORMS[form].say(plain(verb));
    const got = word(text);
    if (got.declares !== FORMS[form].declares) {
      failing.push(`"${text}" -> declares ${got.declares}${got.why ? ` (${got.why})` : ""}`);
    }
  }
  const check = () => assert.deepEqual(failing.slice(0, 6), [], `${failing.length} of ${VERBS.length} verbs`);
  if (KNOWN_FORMS[form]) {
    await gap(`declares:${form}`, KNOWN_FORMS[form], check);
    // The ratchet per verb: none of them holds today.
    await test(`declares:${form}: every verb fails the same way (${failing.length} of ${VERBS.length})`, () => {
      assert.equal(failing.length, VERBS.length, `some verbs already hold; split the gap: ${VERBS.filter((verb) => !failing.some((line) => line.includes(` ${plain(verb)} `))).join(", ")}`);
    });
  } else {
    await test(`declares:${form} over ${VERBS.length} verbs`, check);
  }
  if (!KNOWN_FORMS[form] && failing.length) unexpected.push(...failing);
}

// ---- the hold reader --------------------------------------------------------

// Each row: the line, whether it keeps the character where they stand, why.
const HOLDS = [
  ["I hold still.", true],
  ["I stay put and watch.", true],
  ["I don't move.", true],
  ["I stand my ground.", true],
  ["I wait.", true],
  ["I don't hold still, I charge the goblin.", false],
  ["I cast Hold Person on the goblin.", false],
  ["I hold the door shut.", false],
  ["I keep my shield up and step back.", false],
];
// Phrases that hold the character though the sentence moves them, or uses
// the word for something else. Each is its own row and its own decision.
const FALSE_HOLDS = {
  "stand-back-up": {
    line: "I stand back up and charge the goblin.",
    rule: "A hold 'keeps the character where they stand: no walk of theirs is made this turn' (player-word-logic.ts). Standing up from prone and charging is a walk the player asked for.",
    note: "HOLD_VERB reads 'stand back' (stand + back) inside 'stand back up'.",
  },
  "freeze-the-foe": {
    line: "I move behind the pillar and freeze the goblin with Ray of Frost.",
    rule: "A hold keeps the character where they stand. Freezing a foe with a cold spell is not the character freezing.",
    note: "HOLD_WAIT reads any 'freeze' as the character freezing in place.",
  },
  "the-foe-waits": {
    line: "I run at the goblin that waits by the door.",
    rule: "A hold is the character's own stillness. 'The goblin waits' is the foe's.",
    note: "HOLD_WAIT reads a bare 'waits', whoever its subject is.",
  },
  "order-to-another": {
    line: "Brann, hold still! I run to the door.",
    rule: "A hold is the character's own stillness. An order to another character holds nobody the speaker plays.",
    note: "The reader has no list of the party's names; no ruling written.",
  },
  "keep-back-foe": {
    line: "I rush forward to keep the goblin back from Brann.",
    rule: "A hold is the character's own stillness; here the character rushes forward.",
    note: "Control row: 'keep the goblin back' has words between the verb and 'back', and is not read as a hold.",
    holds: true,
  },
};

for (const [line, holds] of HOLDS) {
  rows += 1;
  await test(`hold: ${line}`, () => {
    assert.equal(englishHold(line) !== null, holds, `"${line}" read as ${JSON.stringify(englishHold(line))}`);
  });
}
for (const [id, entry] of Object.entries(FALSE_HOLDS)) {
  rows += 1;
  const got = word(entry.line);
  const check = () => assert.equal(got.holds, false, `"${entry.line}" holds the character still on the words ${JSON.stringify(got.holdQuote)}`);
  if (entry.holds === true) {
    // A control: this one is read right today.
    await test(`false-hold:${id}`, check);
  } else {
    await gap(`false-hold:${id}`, { rule: entry.rule, where: "src/lib/dm/player-word-logic.ts englishHold (HOLD_VERB, HOLD_WAIT)", severity: "low", note: entry.note }, check);
  }
}

// ---- only a question --------------------------------------------------------

const ASKS = [
  ["Is the goblin still there?", true],
  ["What do I see? Who is there?", true],
  ["¿Dónde está el goblin?", true],
  ["ゴブリンはどこですか？", true],
  ["I attack. Does it hit?", false],
  ["I look around the room.", false],
  ["Where is it... I attack it anyway.", false],
];
for (const [line, asks] of ASKS) {
  rows += 1;
  await test(`asks: ${line}`, () => assert.equal(onlyAsks(line), asks));
}

await test(`the matrix walked the reader's own verbs (${VERBS.length}) through ${Object.keys(FORMS).length} forms`, () => {
  assert.ok(VERBS.length >= 50, `${VERBS.length} verbs read from ACTS`);
  for (const verb of VERBS) {
    assert.ok(englishActs(`I ${plain(verb)} it.`, []), `${plain(verb)} is one of ACTS' own verbs`);
  }
  assert.deepEqual(unexpected, []);
});

console.log(`  rows: ${rows} (${VERBS.length} verbs x ${Object.keys(FORMS).length} forms, ${HOLDS.length + Object.keys(FALSE_HOLDS).length} hold phrases, ${ASKS.length} question lines); skipped 0`);
finish();
