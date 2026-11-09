// What a player's words let the AI do with their character's turn
// (src/lib/dm/player-word-logic.ts): a hold keeps them where they stand,
// words from before the fight declare a turn only when they name something
// done in it, a line that only asks declares nothing, and a Hand card always
// declares. The 0.34.0 report: "hold still", said before the AI opened a
// fight, walked Kara 30 feet through two opportunity attacks.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { englishHold, englishActs, englishDeclines, onlyAsks, readPlayerWord, unaskedRefusal, heldRefusal } = await import("../src/lib/dm/player-word-logic.ts");
const { parseWordReading } = await import("../src/lib/dm/player-word-read.ts");

const FIGHT = "2026-11-08T12:00:00.000Z";
const line = (content, at = "2026-11-08T12:00:01.000Z", card = null) => ({ content, createdAt: at, card });
const before = (content) => line(content, "2026-11-08T11:59:59.000Z");
const word = (lines, options = {}) => readPlayerWord(lines, { fightStartedAt: FIGHT, english: true, names: ["Goblin", "Fire Bolt"], read: null, ...options });

// ---- holds ----

for (const text of [
  "hold still",
  "Hold still.",
  "I hold my ground.",
  "Kara stays put and watches the hatch.",
  "I stand perfectly still",
  "I don't move.",
  "We wait.",
  "I keep still and listen",
  "I stay where I am",
  "I hold position",
  "I freeze",
]) {
  assert.ok(englishHold(text), `a hold: ${text}`);
}
for (const text of [
  "I cast Hold Person on the goblin",
  "I hold the door shut",
  "I don't hold still, I charge",
  "Wait, can I see it?",
  "I move up and attack",
  "I stand up from prone",
]) {
  assert.equal(englishHold(text), null, `not a hold: ${text}`);
}

// ---- acts and questions ----

assert.equal(englishActs("I swing at it", []), true);
assert.equal(englishActs("Fire Bolt at the goblin", ["Fire Bolt"]), true);
assert.equal(englishActs("hold still", ["Goblin"]), false);
assert.equal(englishActs("I listen at the hatch", []), false);
assert.equal(onlyAsks("What do I see?"), true);
assert.equal(onlyAsks("Is it still there? How far?"), true);
assert.equal(onlyAsks("¿Sigue ahí el goblin？"), true);
assert.equal(onlyAsks("I attack. Does it hit?"), false);
assert.equal(onlyAsks("I attack"), false);

// ---- the reading ----

// The report: "hold still" before the fight began is no fight turn.
const report = word([before("hold still")]);
assert.deepEqual([report.declares, report.holds, report.why], [false, true, "before_fight"]);
assert.match(unaskedRefusal("Kara", report), /spoke before this fight began and named nothing Kara does in it/);

// Words from before the fight that name an attack do declare it.
const charge = word([before("I charge the goblin!")]);
assert.deepEqual([charge.declares, charge.holds], [true, false]);
// A foe of the fight or a spell on the sheet, named, is an action too.
assert.equal(word([before("Fire Bolt, now.")]).declares, true);
// A remark about the scene is not.
assert.deepEqual([word([before("I peer at the hatch.")]).declares, word([before("I peer at the hatch.")]).why], [false, "before_fight"]);

// In the fight, any line still declares, as before: the turn's own words.
assert.equal(word([line("I take the Dodge action.")]).declares, true);
assert.equal(word([line("Second Wind!")]).declares, true);
// A question only asks.
const asked = word([line("Is the goblin still on the stairs?")]);
assert.deepEqual([asked.declares, asked.why], [false, "asked"]);
assert.match(unaskedRefusal("Kara", asked), /only asked a question/);
// Unless it names the action it wants.
assert.equal(word([line("Can I attack the goblin?")]).declares, true);
// A pure hold in the fight declares nothing but may end the turn.
const still = word([line("I hold still.")]);
assert.deepEqual([still.declares, still.holds, still.why], [false, true, "held"]);
assert.match(unaskedRefusal("Kara", still), /end_turn ends the turn/);
// A hold with an action declares the action and still holds.
const ground = word([line("I hold my ground and swing at anything that comes close.")]);
assert.deepEqual([ground.declares, ground.holds], [true, true]);
assert.match(heldRefusal("Kara", ground.holdQuote), /^Kara's player said Kara stays where they are \("hold my ground"\), so the server will not walk them\. Nothing was spent\./);

// ---- an action turned down (issue 761) ----

// The words of the 0.34.1 play-test that ended a turn through the model's
// end_turn, and the borderline ones: they only say what is not done.
for (const text of [
  "I won't attack again.",
  "Don't attack again this turn. I keep my shield up.",
  "I keep my hands ready but don't attack again this turn.",
  "Bryn won't attack again this turn.",
  "Bryn doesn't attack again this turn.",
  "No more attacks from me.",
  "Don't attack again.",
  "I won't cast anything else this turn.",
  "Not casting anything else.",
  "I won't make another attack on the goblin.",
  "Don't attack again. Don't end my turn yet.",
]) {
  assert.equal(englishActs(text, ["Goblin", "Fire Bolt"]), false, `acts: ${text}`);
  assert.equal(englishDeclines(text), true, `declines: ${text}`);
  const read = word([line(text)]);
  assert.deepEqual([read.spoke, read.declares, read.why], [true, false, "declined"], text);
}
assert.equal(
  unaskedRefusal("Kara", { why: "declined" }),
  "Kara's player only said what Kara will not do; they did not end the turn. Nothing was spent and the turn stays open. Ask them whether Kara moves, uses a bonus action, or ends the turn, and wait for their answer.",
);
// Something else asked for beside it is still the player's word.
for (const text of [
  "I won't attack again, I step back 10 feet.",
  "Don't attack again, cast Fire Bolt instead.",
  "No more attacks but I Dash to the door.",
  "I'm ready to attack the moment it moves.",
  "I ready my crossbow.",
  "I attack the goblin again.",
]) {
  assert.equal(englishActs(text, ["Goblin", "Fire Bolt"]), true, `acts: ${text}`);
  assert.equal(word([line(text)]).declares, true, text);
}
// An end in their own words ends the turn as before.
for (const text of ["I won't attack again, I end my turn.", "No more attacks. That's my turn."]) {
  assert.equal(word([line(text)]).declares, true, text);
}
// A hold that also turns an attack down is a hold: the turn may pass on it.
const noMore = word([line("I hold my ground, no more attacks.")]);
assert.deepEqual([noMore.declares, noMore.holds, noMore.why], [false, true, "held"]);
// Words before the fight that turn an attack down name nothing done in it.
assert.deepEqual([word([before("We won't attack the goblin.")]).declares, word([before("We won't attack the goblin.")]).why], [false, "before_fight"]);

// A Hand card always declares.
assert.equal(word([line("I attack the goblin.", undefined, "attack")]).declares, true);
// Nothing said is silence.
assert.deepEqual([word([]).spoke, word([]).why], [false, "silent"]);
// The silent refusal keeps its words.
assert.equal(
  unaskedRefusal("Kara", { why: "silent" }),
  "Kara has not acted: their player hasn't declared an action this turn. Nothing was spent. Don't narrate an attempt; wait for them to say what Kara does, or narrate the moment and stop.",
);

// ---- another language ----

const spanish = (lines, read) => word(lines, { english: false, read });
// The reading decides.
assert.deepEqual([spanish([before("me quedo quieta")], { acts: false, holds: true }).declares, spanish([before("me quedo quieta")], { acts: false, holds: true }).holds], [false, true]);
assert.equal(spanish([before("ataco al goblin")], { acts: true, holds: false }).declares, true);
assert.equal(spanish([line("me quedo y corto con la espada")], { acts: true, holds: true }).holds, true);
// Without a reading, a line in the fight counts as it always did, and words
// from before it wait for the player.
assert.equal(spanish([line("ataco al goblin")], null).declares, true);
assert.deepEqual([spanish([before("ataco al goblin")], null).declares, spanish([before("ataco al goblin")], null).why], [false, "before_fight"]);
assert.equal(spanish([line("¿Qué veo?")], null).declares, false);

assert.deepEqual(parseWordReading('{"acts":false,"holds":true}'), { acts: false, holds: true });
assert.deepEqual(parseWordReading('Sure: {"acts": true, "holds": false} done'), { acts: true, holds: false });
assert.equal(parseWordReading('{"acts":"yes"}'), null);
assert.equal(parseWordReading("no json"), null);

console.log("test-player-word-logic: ok");
