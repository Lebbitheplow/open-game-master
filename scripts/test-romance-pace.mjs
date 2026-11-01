// A romance paced by more than the player (issue 643), the pure half: the
// in-game time each rung needs after the last, deeds honouring the same value
// wearing as the personality read does, and the scenes the other side starts
// (which one each rung opens, when one comes due, how a narration plays it).
// Two playtests on 0.31.1 found a companion whose values matched the party's
// deeds went from nothing to devoted in seven deeds, and every step came from
// the player.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const pace = await import("../src/lib/dm/romance-pace-logic.ts");
const scenes = await import("../src/lib/dm/romance-scene-logic.ts");
const rel = await import("../src/lib/dm/relationship-logic.ts");
const values = await import("../src/lib/dm/companion-values-logic.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const DAY = 24 * 60;

// ---- time between rungs ----

test("each rung after the first needs its story time, eighteen days from interest to marriage", () => {
  assert.deepEqual(pace.STEP_WAIT_MINUTES, { none: 0, interested: 0, courting: DAY, together: 3 * DAY, betrothed: 7 * DAY, married: 7 * DAY });
  const total = ["courting", "together", "betrothed", "married"].reduce((sum, stage) => sum + pace.STEP_WAIT_MINUTES[stage], 0);
  assert.equal(total, 18 * DAY);
});

test("the wait left runs from the last step, and a step never recorded holds nothing back", () => {
  assert.equal(pace.stepWaitLeft("together", null, 0), 0, "a romance from before this was recorded");
  assert.equal(pace.stepWaitLeft("interested", 100, 100), 0, "the first rung waits on nothing");
  assert.equal(pace.stepWaitLeft("together", 1000, 1000), 3 * DAY);
  assert.equal(pace.stepWaitLeft("together", 1000, 1000 + DAY), 2 * DAY);
  assert.equal(pace.stepWaitLeft("together", 1000, 1000 + 3 * DAY), 0);
  assert.equal(pace.stepWaitLeft("married", 1000, 1000 + 30 * DAY), 0);
  assert.equal(pace.stepWaitLeft("courting", 5000, 4000), DAY, "a clock wound back past the step counts no time as passed");
});

test("a wait reads as a person says it", () => {
  assert.equal(pace.waitWords(DAY), "about a day");
  assert.equal(pace.waitWords(20 * 60), "about a day");
  assert.equal(pace.waitWords(3 * DAY), "about 3 days");
  assert.equal(pace.waitWords(2 * DAY + 300), "about 2 days");
  assert.equal(pace.waitWords(61), "about an hour");
  assert.equal(pace.waitWords(5 * 60), "about 5 hours");
  assert.equal(pace.waitWords(10), "less than an hour");
});

test("too soon says when the next step can come, in the console's words or the model's", () => {
  const ai = pace.tooSoonError("Kael", "Lyra", "courting", "together", 300, 3 * DAY - 300, false);
  assert.equal(
    ai,
    "It is too soon for Kael and Lyra to be partners. They became openly courting about 5 hours ago, and this step needs about 3 days after that. The next step can come in about 3 days of story time (travel, a rest, or pass_time); play what passes between them meanwhile, as Lyra wanting more time, not as a no.",
  );
  const human = pace.tooSoonError("Kael", "Lyra", "betrothed", "married", 10, 7 * DAY - 10, true);
  assert.match(human, /^It is too soon for Kael and Lyra to be married\. They became betrothed less than an hour ago/);
  assert.match(human, /\(a rest, a journey, or time moved on the clock\)/);
  assert.doesNotMatch(ai + human, /—/);
});

// ---- deeds honouring the same value ----

const paladin = values.defaultValues("paladin", "LG");

test("a deed honouring a value already honoured counts what came before, whichever deed it was", () => {
  assert.deepEqual(paladin.map((held) => held.value).sort(), ["keeps_oaths", "protects_innocent"]);
  assert.equal(pace.honourRepeats(paladin, {}, "mercy"), 0);
  assert.equal(pace.honourRepeats(paladin, { mercy: 1 }, "mercy"), 1);
  assert.equal(pace.honourRepeats(paladin, { mercy: 1, defended: 1 }, "freed_captives"), 2, "all three protect the innocent");
  assert.equal(pace.honourRepeats(paladin, { mercy: 2 }, "kept_word"), 0, "keeping a word honours another value");
  assert.equal(pace.honourRepeats(paladin, { mercy: 3 }, "laid_to_rest"), 0, "a deed that honours nothing they hold");
  const loyal = values.normalizeValues([{ value: "faction_loyalty", strength: "cares", faction: "The Wardens" }]);
  assert.equal(pace.honourRepeats(loyal, { mercy: 2 }, "mercy", "The Wardens"), 2, "a faction loyalty reads the deed's own count");
  assert.equal(pace.honourRepeats(loyal, { mercy: 2 }, "mercy"), 0, "and honours nothing with no faction named");
});

test("the values swing wears on the repeat table, and a cost never does", () => {
  assert.deepEqual([0, 1, 2, 3, 5].map((repeats) => pace.fadedValueSwing(12, repeats)), [12, 7, 4, 0, 0]);
  assert.equal(pace.fadedValueSwing(-8, 3), -8);
  assert.equal(pace.fadedValueSwing(0, 1), 0);
});

// A paladin companion who admires kindness (empathy +2) watching a run of
// deeds, landed the way beat-landing.ts lands them: the personality read worn
// by the beat's own count, plus the values swing (faded or not).
function watch(beats, { fade }) {
  const personality = { drive: 0, diligence: 1, boldness: 0, warmth: 1, empathy: 2, composure: 0 };
  let approval = 0;
  let counts = {};
  for (const beat of beats) {
    const weighed = rel.beatDelta(beat, null, { approval, repeats: counts[beat] ?? 0, personality, hostile: false });
    const swing = values.deedVerdict(paladin, beat, "serious").approval;
    approval = rel.applyApproval(approval, weighed + (fade ? pace.fadedValueSwing(swing, pace.honourRepeats(paladin, counts, beat)) : swing));
    counts = rel.bumpBeatCount(counts, beat);
  }
  return { approval, counts };
}

test("seven mercies no longer take a companion who holds to them from nothing to devoted", () => {
  const seven = new Array(7).fill("mercy");
  assert.ok(watch(seven, { fade: false }).approval >= 85, "what the playtest saw: devoted in seven deeds");
  const now = watch(seven, { fade: true }).approval;
  assert.equal(rel.friendshipTier(now), "friendly", `seven of one deed stop at friendly (${now})`);
  // Seven kind deeds that all protect the innocent: to the paladin the same
  // value honoured, so the swing for it wears out by the third; the deeds'
  // own personality read wears beat by beat, as it always did.
  const kind = ["mercy", "freed_captives", "defended", "mercy", "freed_captives", "defended", "mercy"];
  assert.ok(watch(kind, { fade: false }).approval >= 85);
  const mixed = watch(kind, { fade: true }).approval;
  assert.equal(mixed, 70, "close, a trusted friend, and not yet devoted");
});

test("a romance stays possible: deeds across chapters still reach devoted, as the counts halve", () => {
  let approval = 0;
  let counts = {};
  let chapters = 0;
  const personality = { drive: 0, diligence: 1, boldness: 0, warmth: 1, empathy: 2, composure: 0 };
  while (approval < 85 && chapters < 10) {
    chapters += 1;
    for (const beat of ["mercy", "freed_captives", "kept_word"]) {
      const weighed = rel.beatDelta(beat, null, { approval, repeats: counts[beat] ?? 0, personality, hostile: false });
      const swing = pace.fadedValueSwing(values.deedVerdict(paladin, beat, "serious").approval, pace.honourRepeats(paladin, counts, beat));
      approval = rel.applyApproval(approval, weighed + swing);
      counts = rel.bumpBeatCount(counts, beat);
    }
    counts = rel.decayBeatCounts(counts);
  }
  assert.ok(chapters <= 3, `three good deeds a chapter reach devoted within three chapters (took ${chapters})`);
});

// ---- the scenes ----

const pair = (overrides = {}) => ({
  relationshipId: "r1",
  character: "Kael",
  subject: "Lyra",
  romance: "interested",
  approval: 50,
  pacing: scenes.NO_PACING,
  present: true,
  sinceStep: 5,
  composure: 0,
  openRelationship: false,
  rival: "",
  ...overrides,
});

test("each rung opens its own scene, once", () => {
  assert.deepEqual(scenes.STAGE_SCENE, { interested: "private_talk", courting: "asks_help", together: "future", betrothed: "family", married: "home" });
  assert.equal(scenes.sceneOwed(pair({ romance: "none" })), null);
  assert.deepEqual(scenes.sceneOwed(pair()), { kind: "private_talk", stage: "interested", rival: "" });
  assert.deepEqual(scenes.sceneOwed(pair({ romance: "courting" })), { kind: "asks_help", stage: "courting", rival: "" });
  const played = { ...scenes.NO_PACING, played: ["interested:private_talk"] };
  assert.equal(scenes.sceneOwed(pair({ pacing: played })), null, "played at this rung");
  assert.deepEqual(scenes.sceneOwed(pair({ romance: "courting", pacing: played })).kind, "asks_help", "the next rung opens its own");
});

test("a jealous moment comes first where a rival and their nature say so", () => {
  const stung = pair({ romance: "courting", rival: "Mira", composure: -1 });
  assert.deepEqual(scenes.sceneOwed(stung), { kind: "jealous", stage: "courting", rival: "Mira" });
  assert.equal(scenes.sceneOwed({ ...stung, composure: 0 }).kind, "asks_help", "a composed person keeps it in");
  assert.equal(scenes.sceneOwed({ ...stung, openRelationship: true }).kind, "asks_help", "the seam for issue 642's open relationship");
  assert.equal(scenes.sceneOwed({ ...stung, rival: "" }).kind, "asks_help", "no rival, nothing to be jealous of");
  assert.equal(scenes.sceneOwed({ ...stung, romance: "interested" }).kind, "private_talk", "nothing said yet that a rival threatens");
  assert.equal(scenes.sceneOwed({ ...stung, pacing: { ...scenes.NO_PACING, played: ["courting:jealous"] } }).kind, "asks_help", "once per rung");
  assert.equal(scenes.jealousyShows(-1, false), true);
  assert.equal(scenes.jealousyShows(-1, true), false);
});

test("one scene at a time, after the cooldown, and only to a pair in the scene whose step has had its replies", () => {
  const due = { ...scenes.NO_PACING, due: { kind: "private_talk", stage: "interested", rival: "", handed: 0 } };
  assert.equal(scenes.pickScene([pair(), pair({ relationshipId: "r2", subject: "Bran", pacing: due })], null), null, "another is due");
  assert.equal(scenes.pickScene([pair()], scenes.SCENE_COOLDOWN - 1), null, "the cooldown has not run");
  assert.equal(scenes.pickScene([pair()], scenes.SCENE_COOLDOWN).relationshipId, "r1");
  assert.equal(scenes.pickScene([pair()], null).scene.kind, "private_talk", "no scene yet at this table");
  assert.equal(scenes.pickScene([pair({ sinceStep: scenes.SCENE_AFTER_STEP - 1 })], null), null, "the step's own replies");
  assert.equal(scenes.pickScene([pair({ present: false })], null), null, "not in the scene");
  const warmer = pair({ relationshipId: "r2", subject: "Bran", approval: 70 });
  assert.equal(scenes.pickScene([pair(), warmer], null).subject, "Bran", "the one who feels most");
  assert.equal(scenes.pickScene([pair({ subject: "Zed" }), pair({ relationshipId: "r2", subject: "Ada" })], null).subject, "Ada", "then by name");
  assert.deepEqual([scenes.SCENE_AFTER_STEP, scenes.SCENE_COOLDOWN, scenes.SCENE_WINDOW, scenes.SCENE_LAPSES], [2, 8, 3, 2]);
});

test("a narration plays the scene when the subject speaks in it or a paragraph names them both", () => {
  const lyra = { name: "Lyra Dawn", ids: ["sheet-lyra", "npc-lyra"] };
  assert.equal(scenes.sceneTaken({ content: "Rain.", speech: [{ speaker: { kind: "pc", id: "sheet-lyra", name: "Lyra Dawn" } }] }, lyra, "Kael"), true);
  assert.equal(scenes.sceneTaken({ content: "Rain.", speaker: { kind: "npc", id: "npc-lyra", name: "Lyra Dawn" } }, lyra, "Kael"), true);
  assert.equal(scenes.sceneTaken({ content: "Later, Lyra draws Kael aside by the wagons." }, lyra, "Kael"), true, "a first name for a longer one");
  assert.equal(scenes.sceneTaken({ content: "Lyra checks the horses.\n\nKael counts the coin." }, lyra, "Kael"), false, "named apart, not together");
  assert.equal(scenes.sceneTaken({ content: "The road winds on.", speech: [{ speaker: { kind: "npc", id: "npc-bran", name: "Bran" } }] }, lyra, "Kael"), false);
});

test("a due scene waits until handed, plays when taken, and passes when its window runs out", () => {
  const due = (handed) => ({ kind: "asks_help", stage: "courting", rival: "", handed });
  assert.equal(scenes.readDue(due(0), true), "waiting", "nobody was handed it yet");
  assert.equal(scenes.readDue(due(1), true), "played");
  assert.equal(scenes.readDue(due(scenes.SCENE_WINDOW - 1), false), "waiting");
  assert.equal(scenes.readDue(due(scenes.SCENE_WINDOW), false), "lapsed");
  const pacing = { ...scenes.NO_PACING, due: due(3) };
  const once = scenes.afterLapse(pacing, 40);
  assert.equal(once.due, null);
  assert.equal(once.endedSeq, 40, "a pass starts the table's cooldown too");
  assert.deepEqual(once.played, [], "it can come again");
  const twice = scenes.afterLapse({ ...once, due: due(3) }, 60);
  assert.deepEqual(twice.played, ["courting:asks_help"], "let go after passing twice");
  const played = scenes.afterPlayed({ ...scenes.NO_PACING, due: due(1) }, 70);
  assert.deepEqual(played.played, ["courting:asks_help"]);
  assert.equal(played.endedSeq, 70);
});

test("what a pair keeps reads back as it was written, and nothing else", () => {
  const kept = { steppedAt: 4320, steppedSeq: 12, played: ["interested:private_talk"], lapses: { "courting:asks_help": 1 }, due: { kind: "jealous", stage: "courting", rival: "Mira", handed: 2 }, endedSeq: 9 };
  assert.deepEqual(scenes.parsePacing(JSON.stringify(kept)), kept);
  assert.deepEqual(scenes.parsePacing(""), scenes.NO_PACING);
  assert.deepEqual(scenes.parsePacing("{nope"), scenes.NO_PACING);
  assert.equal(scenes.parsePacing(JSON.stringify({ ...kept, due: { kind: "serenade", stage: "courting" } })).due, null);
  assert.equal(scenes.parsePacing(JSON.stringify({ steppedAt: "soon" })).steppedAt, null);
});

test("the GM's note, the Bonds tab's line and the bond's memory say who starts what", () => {
  const note = scenes.sceneNote("Lyra", "Kael", "courting", { kind: "asks_help", rival: "" });
  assert.equal(
    note,
    "Lyra starts a moment of their own with Kael (openly courting): Lyra asks Kael for help with something of their own (an old debt, a letter home, a grave, a rival), small and personal. If the scene allows it, play it this reply in Lyra's own voice and let Kael's player answer; never decide how Kael feels.",
  );
  assert.match(scenes.sceneCard("Lyra", "Kael", { kind: "jealous", rival: "Mira" }), /^Lyra is stung to see Kael so close with Mira, and lets it show\. Play it when the scene allows: once Lyra speaks in your narration, it is recorded\.$/);
  const memories = scenes.SCENE_KINDS.map((kind) => scenes.sceneMemory("Lyra", "Kael", { kind, rival: "Mira" }));
  assert.equal(memories[0], "Lyra sought Kael out for a private talk");
  assert.ok(memories.every((line) => line.length <= 160), "fits a bond's memory");
  assert.doesNotMatch([note, ...memories].join(" "), /—/);
});

console.log(`test-romance-pace: ${passed} passed`);
