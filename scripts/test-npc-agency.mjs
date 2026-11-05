// NPC agency logic: parsing tolerance, personality derivation and drift,
// bond/relation shifts, goal advancement with injected dice, collisions,
// pressure counters, and roster fragment bounds.
import assert from "node:assert/strict";
import {
  advanceSessionGoal,
  agencyFragment,
  clampAxis,
  derivePersonality,
  driftPersonality,
  parseBonds,
  parseGoals,
  parsePersonality,
  parsePressure,
  parseRelations,
  pressureState,
  repairSkewedPersonality,
  shiftRelation,
  tickPressure,
} from "../src/lib/dm/npc-logic.ts";
import { RELATIONSHIP_BEATS, beatDelta } from "../src/lib/dm/relationship-logic.ts";
import { textKey } from "../src/lib/language/text-logic.ts";
import { detectGoalCollisions } from "../src/lib/dm/npc-goal-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("clampAxis bounds and rounds", () => {
  assert.equal(clampAxis(5), 3);
  assert.equal(clampAxis(-9), -3);
  assert.equal(clampAxis(1.6), 2);
  assert.equal(clampAxis(Number.NaN), 0);
});

test("parsers tolerate empty and garbage", () => {
  assert.equal(parsePersonality(""), null);
  assert.equal(parsePersonality("not json"), null);
  assert.deepEqual(parseGoals(""), {});
  assert.deepEqual(parseGoals("garbage"), {});
  assert.deepEqual(parseRelations("wat"), []);
  assert.deepEqual(parseBonds(""), []);
  assert.deepEqual(parsePressure(""), { ignored: 0, engaged: 0 });
});

test("parsers clamp and bound real payloads", () => {
  const personality = parsePersonality(
    JSON.stringify({ drive: 9, warmth: -9, boldness: 1 }),
  );
  assert.equal(personality.drive, 3);
  assert.equal(personality.warmth, -3);
  assert.equal(personality.empathy, 0);
  const goals = parseGoals(
    JSON.stringify({ session: { text: "seize the mill", progress: -2, target: 99 } }),
  );
  assert.equal(goals.session.progress, 0);
  assert.equal(goals.session.target, 6);
});

test("derived personality is deterministic and attitude-leaning", () => {
  const a = derivePersonality("Marla", "friendly", "fence");
  const b = derivePersonality("Marla", "friendly", "fence");
  assert.deepEqual(a, b);
  const hostile = derivePersonality("Marla", "hostile", "fence");
  assert.ok(a.warmth > hostile.warmth);
});

// A spread of ordinary names, about half of whose seeds pass 2^31.
const NAMES = ["Daran", "Sildar", "Toblen", "Linene", "Halia", "Qelline", "Harbin", "Garaele", "Elmar", "Gundren", "Reidoth", "Agatha", "Mira", "Bren", "Ostrava", "Kell", "Talia", "Varis", "Oren", "Pell", "Ysolde", "Corin", "Maren", "Orla"]
  .flatMap((first) => ["Edermath", "Hallwinter", "Stonehill", "Graywind", "Thornton", "Alderleaf", "Dusk", "Vane", "Marsh", "Holt"].map((last) => `${first} ${last}`));
const KINDNESSES = Object.keys(RELATIONSHIP_BEATS).filter((beat) => RELATIONSHIP_BEATS[beat].base > 0);

// What derivePersonality gave before issue 732: `>>` read a seed past 2^31
// as negative. Written out here so the repair is tested against the real
// old output, not against its own copy.
function skewed(name, attitude, trait) {
  let hash = 5381;
  const key = `${textKey(name)}|${textKey(trait)}`;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 33) ^ key.charCodeAt(index);
  }
  const seed = hash >>> 0;
  const axis = (index) => ((seed >> (index * 4)) % 3) - 1;
  const lean = attitude === "friendly" ? 1 : attitude === "hostile" ? -1 : 0;
  return {
    drive: clampAxis(axis(0)),
    diligence: clampAxis(axis(1)),
    boldness: clampAxis(axis(2)),
    warmth: clampAxis(axis(3) + lean * 2),
    empathy: clampAxis(axis(4) + lean),
    composure: clampAxis(axis(5)),
  };
}
const SKEWED_NAMES = NAMES.filter((name) => JSON.stringify(skewed(name, "friendly", "")) !== JSON.stringify(derivePersonality(name, "friendly", "")));

test("the name spreads every axis over -1..1 before the attitude's lean (issue 732)", () => {
  assert.ok(SKEWED_NAMES.length > NAMES.length / 4, "the sample holds names the old shift skewed");
  for (const name of NAMES) {
    for (const [attitude, lean] of [["friendly", 1], ["indifferent", 0], ["hostile", -1]]) {
      const personality = derivePersonality(name, attitude, "");
      for (const axis of ["drive", "diligence", "boldness", "composure"]) {
        assert.ok(Math.abs(personality[axis]) <= 1, `${name} ${axis} ${personality[axis]}`);
      }
      assert.ok(Math.abs(personality.warmth - lean * 2) <= 1, `${name} warmth ${personality.warmth} (${attitude})`);
      assert.ok(Math.abs(personality.empathy - lean) <= 1, `${name} empathy ${personality.empathy} (${attitude})`);
    }
  }
});

test("a kindness never lands as an irritation on a friendly or indifferent NPC by their name alone (issue 732)", () => {
  const context = (personality) => ({ approval: 0, repeats: 0, hostile: false, personality });
  // The issue's own case: helped landed as -3.
  assert.ok(beatDelta("helped", null, context(derivePersonality("Daran Edermath", "friendly", ""))) > 0);
  for (const name of NAMES) {
    for (const attitude of ["friendly", "indifferent"]) {
      const personality = derivePersonality(name, attitude, "");
      for (const beat of KINDNESSES) {
        assert.ok(beatDelta(beat, null, context(personality)) > 0, `${beat} toward ${name} (${attitude})`);
      }
    }
  }
});

test("a personality saved from the skewed hash moves onto the corrected spread, keeping its drift (issue 732)", () => {
  const name = SKEWED_NAMES[0];
  const seeds = [{ name, trait: "" }];
  const fixed = derivePersonality(name, "friendly", "");
  assert.deepEqual(repairSkewedPersonality(skewed(name, "friendly", ""), seeds, "friendly"), fixed);
  // Registered hostile, befriended since: the hostile spread is still found.
  assert.deepEqual(repairSkewedPersonality(skewed(name, "hostile", ""), seeds, "friendly"), derivePersonality(name, "hostile", ""));
  // A social check warmed them a step: the step stays.
  const warmed = driftPersonality(skewed(name, "friendly", ""), "persuade", "up");
  const repaired = repairSkewedPersonality(warmed, seeds, "friendly");
  assert.equal(repaired.warmth, clampAxis(fixed.warmth + warmed.warmth - skewed(name, "friendly", "").warmth));
  assert.equal(repaired.drive, fixed.drive);
  // Never moved twice, and nothing to do for a hand-set personality, an
  // unseeded name, or a seed the old shift read correctly.
  assert.equal(repairSkewedPersonality(fixed, seeds, "friendly"), null);
  assert.equal(repairSkewedPersonality({ drive: 2, diligence: 2, boldness: 2, warmth: 2, empathy: 2, composure: 2 }, seeds, "friendly"), null);
  assert.equal(repairSkewedPersonality(skewed(name, "friendly", ""), [{ name: "Someone Else", trait: "" }], "friendly"), null);
  const straight = NAMES.find((entry) => !SKEWED_NAMES.includes(entry));
  assert.equal(repairSkewedPersonality(derivePersonality(straight, "friendly", ""), [{ name: straight, trait: "" }], "friendly"), null);
  // Seeded under an old name the NPC still answers to.
  assert.deepEqual(repairSkewedPersonality(skewed(name, "friendly", "fence"), [{ name: "New Name", trait: "fence" }, { name, trait: "fence" }], "friendly"), derivePersonality(name, "friendly", "fence"));
});

test("a hand-set personality that play could not have reached from the skewed spread stays as it was set (issue 732)", () => {
  // An author's timid, idle sort whose drive, diligence and boldness happen
  // to read like the old spread of their name, but whose composure sits
  // above it: play only ever lowers composure (driftPersonality), so this
  // was set by hand, not seeded and drifted.
  for (const name of SKEWED_NAMES) {
    const old = skewed(name, "friendly", "");
    const authored = { ...old, composure: clampAxis(old.composure + 2) };
    assert.equal(repairSkewedPersonality(authored, [{ name, trait: "" }], "friendly"), null, name);
  }
});

test("a personality on a corrected spread is never moved again, whichever name it answers to (issue 732)", () => {
  // One name whose corrected spread puts drive, diligence, boldness and
  // composure at -1, and a second name the same person answers to whose old
  // spread reads the same there: the second name must not move a
  // personality the first one already put right.
  const first = "Agatha Thornton";
  const second = "Garaele Graywind";
  const low = (personality) => ["drive", "diligence", "boldness", "composure"].every((axis) => personality[axis] === -1);
  const settled = derivePersonality(first, "friendly", "");
  assert.ok(low(settled), "the first name's corrected spread sits at -1");
  assert.ok(low(skewed(second, "friendly", "")), "the second name's old spread sits at -1 too");
  assert.notDeepEqual(skewed(second, "friendly", ""), derivePersonality(second, "friendly", ""), "the old shift skewed the second name");
  assert.equal(repairSkewedPersonality(settled, [{ name: first, trait: "" }, { name: second, trait: "" }], "friendly"), null);
});

test("drift moves the right axes and clamps", () => {
  const base = { drive: 0, diligence: 0, boldness: 0, warmth: 3, empathy: 0, composure: -3 };
  const warmed = driftPersonality(base, "persuade", "up");
  assert.equal(warmed.warmth, 3);
  assert.equal(warmed.empathy, 1);
  const cowed = driftPersonality(base, "intimidate", "down");
  assert.equal(cowed.composure, -3);
  assert.equal(cowed.warmth, 2);
});

// How an NPC feels about an individual character is no longer a bond on the
// NPC row; it is the approval meter (scripts/test-relationships.mjs).

test("relation shift is directed and noted", () => {
  let relations = shiftRelation([], "Brekk", -1, "rival");
  assert.deepEqual(relations, [{ npcName: "Brekk", score: -1, note: "rival" }]);
  relations = shiftRelation(relations, "brekk", -1);
  assert.equal(relations[0].score, -2);
});

test("goal advancement respects the DC and personality modifier", () => {
  const goal = { text: "seize the mill", progress: 0, target: 2 };
  const stall = advanceSessionGoal(goal, null, 11);
  assert.equal(stall.advanced, false);
  assert.equal(stall.goal.progress, 0);
  const driven = { drive: 3, diligence: 0, boldness: 2, warmth: 0, empathy: 0, composure: 0 };
  const push = advanceSessionGoal(goal, driven, 8);
  assert.equal(push.advanced, true);
  assert.equal(push.completed, false);
  const done = advanceSessionGoal(push.goal, driven, 20);
  assert.equal(done.completed, true);
});

test("collisions need a shared significant word", () => {
  const goals = [
    { name: "Marla", goalText: "seize the Dunfall mill" },
    { name: "Brekk", goalText: "buy the mill at Dunfall" },
    { name: "Aldous", goalText: "translate the codex" },
  ];
  const collisions = detectGoalCollisions(goals, "english", goals.map((goal) => goal.goalText));
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].a, "Marla");
  assert.equal(collisions[0].b, "Brekk");
  const apart = [
    { name: "A", goalText: "win the tourney" },
    { name: "B", goalText: "rob the vault" },
  ];
  assert.deepEqual(detectGoalCollisions(apart, "english", apart.map((goal) => goal.goalText)), []);
});

test("each table language's function words never make a collision, its nouns do, plurals included", () => {
  const cases = [
    ["italian", "conquistare la torre della strega", "trovare il tesoro della gilda", "comprare i mulini di Dunfall", "bruciare il mulino"],
    ["french", "cacher le trésor dans la crypte", "trouver un allié dans la ville", "acheter les moulins", "brûler le moulin"],
    ["spanish", "robar oro para la cofradía", "buscar ayuda para el viaje", "comprar los molinos", "quemar el molino"],
    ["german", "seiner Familie Gold bringen", "seiner Gilde Rache schwören", "die Mühlen kaufen", "die Mühle verbrennen"],
  ];
  for (const [language, functionA, functionB, nounA, nounB] of cases) {
    const apart = [
      { name: "A", goalText: functionA },
      { name: "B", goalText: functionB },
    ];
    assert.deepEqual(detectGoalCollisions(apart, language, apart.map((goal) => goal.goalText)), [], language);
    const rivals = [
      { name: "C", goalText: nounA },
      { name: "D", goalText: nounB },
    ];
    const found = detectGoalCollisions(rivals, language, rivals.map((goal) => goal.goalText));
    assert.equal(found.length, 1, language);
  }
});

test("what most of the campaign's goals say is no rivalry; a word only two goals share is", () => {
  const pool = [
    "help the party find the relic",
    "betray the party to the duke",
    "hide from the party",
    "sell the party a map",
    "seize the Dunfall mill",
    "buy the mill at Dunfall",
  ];
  const sharedOnlyParty = [
    { name: "A", goalText: pool[0] },
    { name: "B", goalText: pool[1] },
  ];
  assert.deepEqual(detectGoalCollisions(sharedOnlyParty, "english", pool), []);
  const millRivals = [
    { name: "C", goalText: pool[4] },
    { name: "D", goalText: pool[5] },
  ];
  const [collision] = detectGoalCollisions(millRivals, "english", pool);
  // The rivalry is reported with the goal's own word, not a stem.
  assert.ok(["Dunfall", "mill"].includes(collision.over), collision.over);
});

test("a place the campaign knows is where two NPCs stand, not their prize, unless they share another word", () => {
  // The goals of a playtest's chapter close, where the ford made two
  // strangers rivals. The party stood at the Lower Ford.
  const pool = [
    "gather enough help to bring down the party Dame Seraphine Vale left",
    "gather enough help to bring down the party Brother Aldous Penn left",
    "gather enough help to bring down the party Tamsin Greybrook left",
    "Shelter the stranded pilgrims and keep golden briars out of her tavern.",
    "Find a carter willing to bring Mara Fen and her son back from the high bank above the Lower Ford.",
    "Get her family and their stuck cart safely out of the ford.",
    "Leave the ford with the stolen strongbox.",
  ];
  const places = ["Lower Ford", "Briar Road"];
  const atTheFord = [
    { name: "Mara Fen", goalText: pool[5] },
    { name: "Briar-road Raider Captain", goalText: pool[6] },
  ];
  assert.deepEqual(detectGoalCollisions(atTheFord, "english", pool, places), []);
  // Two goals alone at the ford are no rivals either.
  assert.deepEqual(detectGoalCollisions(atTheFord, "english", [pool[5], pool[6]], places), []);
  const strongbox = [...pool, "Take the strongbox from the raiders at the ford."];
  const rivals = [
    { name: "Briar-road Raider Captain", goalText: strongbox[6] },
    { name: "Osric Fen", goalText: strongbox[7] },
  ];
  const [collision] = detectGoalCollisions(rivals, "english", strongbox, places);
  assert.equal(collision?.over, "strongbox", "named by the prize, not the place");
});

test("three NPCs after one prize are rivals for it, however many goals name it", () => {
  const pool = [
    "Steal the strongbox before the caravan leaves.",
    "Guard the strongbox until the reeve comes.",
    "Recover the strongbox for her guild.",
    "Shelter the stranded pilgrims.",
    "Win the archery contest.",
    "Find a cure for the river fever.",
    "Marry into the Thorne family.",
  ];
  const after = pool.slice(0, 3).map((goalText, index) => ({ name: `Rival ${index}`, goalText }));
  const found = detectGoalCollisions(after, "english", pool, ["Lower Ford"]);
  assert.equal(found.length, 3, JSON.stringify(found));
  assert.ok(found.every((entry) => entry.over === "strongbox"), JSON.stringify(found));
});

test("pressure ticks, resets on engagement, and caps", () => {
  let pressure = { ignored: 0, engaged: 0 };
  pressure = tickPressure(pressure, false);
  assert.equal(pressureState(pressure), null);
  pressure = tickPressure(pressure, false);
  assert.equal(pressureState(pressure), "ignored");
  pressure = tickPressure(pressure, true);
  assert.equal(pressure.ignored, 0);
  for (let index = 0; index < 12; index += 1) {
    pressure = tickPressure(pressure, true);
  }
  assert.equal(pressure.engaged, 9);
  assert.equal(pressureState(pressure), "engaged");
});

test("roster fragment is informative and bounded", () => {
  const fragment = agencyFragment({
    personality: { drive: 3, diligence: 0, boldness: -2, warmth: 2, empathy: 0, composure: 0 },
    goals: { session: { text: "seize the mill", progress: 1, target: 3 } },
    relations: [{ npcName: "Brekk", score: -2 }],
    bonds: [],
    pressure: { ignored: 3, engaged: 0 },
  });
  assert.ok(fragment.includes("driven"));
  assert.ok(fragment.includes("not bold"));
  assert.ok(fragment.includes("seize the mill (1/3)"));
  assert.ok(fragment.includes("Brekk -2"));
  assert.ok(fragment.includes("ignored"));
  assert.ok(fragment.length <= 400);
});

test("empty agency renders an empty fragment", () => {
  const fragment = agencyFragment({
    personality: null,
    goals: {},
    relations: [],
    bonds: [],
    pressure: { ignored: 0, engaged: 0 },
  });
  assert.equal(fragment, "");
});

console.log(`${passed} npc agency tests passed`);
