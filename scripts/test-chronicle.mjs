// Issues 212 and 213: what the Chronicle beside the staged battle map holds,
// and when it follows the newest line. It followed its entry COUNT, which
// stops changing once the 14-entry window is full and never changes for an
// edit, so the newest passage slid below the fold.
import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);
const { CHRONICLE_ENTRIES, FOLLOW_SLACK_PX, atBottom, chronicleSignature, chronicleSystemLine, chronicleWindow, stagedHaltedTurn } = await import(
  "../src/lib/chronicle-logic.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const message = (n, overrides = {}) => ({
  id: `m${n}`,
  authorType: n % 3 === 0 ? "player" : "dm",
  dmTurnId: null,
  content: `Passage ${n}.`,
  ...overrides,
});
const story = (count) => Array.from({ length: count }, (_, index) => message(index + 1));

test("the window holds the newest entries and counts what it leaves out", () => {
  assert.ok(CHRONICLE_ENTRIES > 14, "the taller pane holds more than the old 14");
  const short = chronicleWindow(story(10));
  assert.equal(short.recent.length, 10);
  assert.equal(short.earlier, 0);
  const long = chronicleWindow(story(CHRONICLE_ENTRIES + 7));
  assert.equal(long.recent.length, CHRONICLE_ENTRIES);
  assert.equal(long.earlier, 7);
  assert.equal(long.recent.at(-1).id, `m${CHRONICLE_ENTRIES + 7}`);
});

test("a halted turn's system line is the turn's, not the tale's", () => {
  const messages = [
    message(1),
    message(2, { authorType: "system", dmTurnId: "t1", content: "The GM ran into a problem: timeout." }),
    message(4, { authorType: "system" }),
  ];
  assert.deepEqual(chronicleWindow(messages).recent.map((entry) => entry.id), ["m1", "m4"]);
});

// A lair action the GM's turn posts is linked to that turn as well. Read as
// a halt by its link alone, it was on no screen beside a staged board: the
// scroll left it out and the board hid the transcript.
test("a lair action linked to its turn is the tale's, and no halt", () => {
  const lair = message(5, { authorType: "system", dmTurnId: "t5", content: "Lair action (initiative 20, round 2): The ceiling sheds stones." });
  assert.deepEqual(chronicleWindow([message(1), lair]).recent.map((entry) => entry.id), ["m1", "m5"]);
  assert.equal(stagedHaltedTurn([message(1), lair]), null);
});

// 0.31.3 playtest: a test fight's GM halted (its program signed out) and the
// notice flashed and was gone. The scroll leaves the halt out and the staged
// board hides the transcript, so the stage shows the halt itself.
test("a staged fight shows the halted turn the scroll leaves out", () => {
  const halt = (n, overrides = {}) =>
    message(n, { authorType: "system", dmTurnId: `t${n}`, content: "The GM ran into a problem: The server's agent program is signed out.", ...overrides });
  const opening = [message(1), message(2, { authorType: "system", content: "Goblin 2 is up." })];
  assert.equal(stagedHaltedTurn(opening), null, "no halt, nothing shown");
  assert.equal(stagedHaltedTurn([...opening, halt(4)])?.id, "m4");
  // Table talk after it, and the GM's out-of-character answer, leave it up.
  const talk = message(6, { authorType: "player" });
  const aside = message(7, { content: "(ooc) The GM is away for a moment." });
  assert.equal(stagedHaltedTurn([...opening, halt(4), talk, aside])?.id, "m4");
  // The older wording reads the same.
  assert.equal(stagedHaltedTurn([...opening, halt(5, { content: "The DM ran into a problem: timeout." })])?.id, "m5");
  // A retry claimed clears the link, and the GM narrating again ends it.
  assert.equal(stagedHaltedTurn([...opening, halt(4, { dmTurnId: null })]), null);
  assert.equal(stagedHaltedTurn([...opening, halt(4), message(8)]), null);
  // Another system line that happens to be turn-linked is not a halt.
  assert.equal(stagedHaltedTurn([...opening, message(9, { authorType: "system", dmTurnId: "t9" })]), null);
  // The newest halt is the one shown.
  assert.equal(stagedHaltedTurn([...opening, halt(4), message(8), halt(10)])?.id, "m10");
});

test("a new entry in a full window moves the signature, where the count did not", () => {
  const full = chronicleWindow(story(CHRONICLE_ENTRIES + 3)).recent;
  const next = chronicleWindow(story(CHRONICLE_ENTRIES + 4)).recent;
  assert.equal(full.length, next.length, "the old trigger: the count stands still");
  assert.notEqual(chronicleSignature(full, 0), chronicleSignature(next, 0));
});

test("an edited or continued passage moves it; nothing else does", () => {
  const recent = chronicleWindow(story(20)).recent;
  const same = chronicleSignature(recent, 2);
  assert.equal(chronicleSignature(recent.map((entry) => ({ ...entry })), 2), same, "stable across a re-render");
  const grown = recent.map((entry, index) => (index === recent.length - 1 ? { ...entry, content: `${entry.content} The storm breaks.` } : entry));
  assert.notEqual(chronicleSignature(grown, 2), same);
  // A roll card that lands after its passage.
  assert.notEqual(chronicleSignature(recent, 3), same);
});

test("the reader follows within the slack and is left alone above it", () => {
  const at = (scrollTop) => atBottom({ scrollTop, scrollHeight: 2_000, clientHeight: 500 });
  assert.equal(at(1_500), true);
  assert.equal(at(1_500 - FOLLOW_SLACK_PX), true);
  assert.equal(at(1_500 - FOLLOW_SLACK_PX - 1), false);
  assert.equal(at(0), false);
});

console.log(`test-chronicle: ${passed} passed`);

test("a system line is shown whole, with the transcript's card prefixes as words", () => {
  const long = "The goblin swings twice. ".repeat(12).trim();
  assert.equal(chronicleSystemLine(long), long);
  assert.equal(chronicleSystemLine("[Party lead direction] Take the north door."), "Party lead: Take the north door.");
  assert.equal(chronicleSystemLine("[New adventurer] Mira joins the party."), "Mira joins the party.");
  // A settled offer (issue 239): the words, never the marker the DM reads.
  assert.equal(
    chronicleSystemLine("[Offer settled] Nysa accepted the offer: Give Coin purse to Nysa. Nysa now carries Coin purse."),
    "Nysa accepted the offer: Give Coin purse to Nysa. Nysa now carries Coin purse.",
  );
});
