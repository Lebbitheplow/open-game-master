// What a player's words let the AI do with their character's turn
// (src/lib/dm/player-word-logic.ts): a hold keeps them where they stand,
// words from before the fight declare a turn only when they name something
// done in it, a line that only asks declares nothing, and a Hand card always
// declares. The 0.34.0 report: "hold still", said before the AI opened a
// fight, walked Kara 30 feet through two opportunity attacks.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { englishHold, englishActs, englishDeclines, onlyAsks, onlyAsked, askedSwayRefusal, readPlayerWord, unaskedRefusal, heldRefusal } = await import("../src/lib/dm/player-word-logic.ts");
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
// A quoted question with the words that say who asks it, and a question
// asked indirectly, only ask (0.34.1 report: a companion asked about the
// road got a Persuasion check).
for (const text of [
  '"Do you know this place?" I ask Corin.',
  'I ask Corin, "Do you know this place?"',
  '"Corin," I ask, "do you trust him?"',
  '"Is it far?" I ask, looking at the map.',
  "I ask Corin what he thinks of the plan.",
  "I ask the guard about the missing caravan.",
  "Kara quietly asks Mira whether she slept.",
]) {
  assert.equal(onlyAsks(text), true, text);
}
// Asking for something done, a second act, a bare tag, or no question at
// all is more than a question.
for (const text of [
  "I ask him to open the gate.",
  "I ask for help.",
  "I ask.",
  "I ask Corin what he thinks and then I grab the map.",
  '"Will you come with us?" I ask, and I press the coin into her hand.',
  "I try to convince her to lower the price.",
  '"Lower the price, or we walk."',
]) {
  assert.equal(onlyAsks(text), false, text);
}
// Every line must only ask, and a Hand card is an act; no line is not a
// question.
assert.equal(onlyAsked([{ content: "Do you know the road?", card: null }, { content: "Is it safe?", card: null }], true), true);
assert.equal(onlyAsked([{ content: "Do you know the road?", card: null }, { content: "Come with us, Corin.", card: null }], true), false);
assert.equal(onlyAsked([{ content: "Is it safe?", card: "help" }], true), false);
assert.equal(onlyAsked([], true), false);
// At a table in another language only the question mark is read.
assert.equal(onlyAsked([{ content: "¿Conoces este camino?", card: null }], false), true);
assert.equal(onlyAsks('"Is it far?" I ask Corin.', false), false);
assert.match(askedSwayRefusal("Kara"), /^Kara's player only asked a question, .*nothing was rolled\. Answer it in character/);

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
// The negation reaches only its own verb: a new subject or a "when", "if" or
// "let" between them starts another thought, and what follows is an act.
for (const text of ["I never miss when I attack.", "Not him I attack the archer.", "I don't think I can hit it from here, so I shove it.", "I can't let them hit Corin!"]) {
  assert.equal(englishDeclines(text), false, `declines: ${text}`);
  assert.equal(word([line(text)]).declares, true, text);
}
// A question with a negation in it only asks: it says nothing of what is not
// done, and a question about someone else's attack asks nothing of the turn.
for (const text of ["Don't you attack?", "Won't he attack us first?", '"Why don\'t they attack?" I ask Corin.']) {
  const read = word([line(text)]);
  assert.deepEqual([read.declares, read.why], [false, "asked"], text);
}
// Asking someone else not to attack, or turning the attack down to talk, is
// no act of the character's: the turn stays open.
for (const text of ["I ask Corin not to attack.", "I won't attack, I ask him what he wants."]) {
  assert.deepEqual([word([line(text)]).declares, word([line(text)]).why], [false, "declined"], text);
}
// A thing of the character's or of the scene named beside the turned-down
// attack is not a spell cast or a foe attacked, even when the sheet has a
// spell of that name or the fight a foe: "keep my shield up" with Shield
// prepared ended the turn as an act.
for (const text of ["Don't attack again this turn. I keep my shield up.", "I won't attack again, the goblin has had enough."]) {
  const read = word([line(text)], { names: ["Goblin", "Shield", "Fire Bolt"] });
  assert.deepEqual([read.declares, read.why], [false, "declined"], text);
}
// A spell named as the thing to do still is one.
assert.equal(word([line("No more attacks. Fire Bolt on the archer.")]).declares, true);
// The short ways a turn is closed close it beside a turned-down attack.
for (const text of ["No more attacks, I'm done.", "I don’t attack again. That’s all.", "I won't attack again, that’s my turn."]) {
  assert.equal(word([line(text)]).declares, true, text);
}

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
// An action turned down reads the same in every language: "no vuelvo a
// atacar" ended the turn at a Spanish table as an act until the reader said
// so (issue 761).
const noMas = spanish([line("No vuelvo a atacar.")], { acts: false, holds: false, declines: true });
assert.deepEqual([noMas.declares, noMas.why], [false, "declined"]);
assert.equal(spanish([line("No vuelvo a atacar, retrocedo.")], { acts: true, holds: false, declines: true }).declares, true);
assert.deepEqual([spanish([before("No ataco al goblin.")], { acts: false, holds: false, declines: true }).why], ["before_fight"]);
assert.equal(spanish([line("Me quedo quieta, no ataco más.")], { acts: false, holds: true, declines: true }).why, "held");
// An end in their own words still ends it, whether or not the reader also
// called it an act.
assert.equal(spanish([line("No vuelvo a atacar, termino mi turno.")], { acts: false, holds: false, declines: true, ends: true }).declares, true);

assert.deepEqual(parseWordReading('{"acts":false,"holds":true}'), { acts: false, holds: true, declines: false, ends: false });
assert.deepEqual(parseWordReading('Sure: {"acts": true, "holds": false} done'), { acts: true, holds: false, declines: false, ends: false });
assert.deepEqual(parseWordReading('{"acts":false,"holds":false,"declines":true,"ends":true}'), { acts: false, holds: false, declines: true, ends: true });
assert.equal(parseWordReading('{"acts":"yes"}'), null);
assert.equal(parseWordReading("no json"), null);

console.log("test-player-word-logic: ok");
