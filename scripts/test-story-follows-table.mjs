// The plan follows the table. A table reported a four-act saga whose acts
// were four stages of one errand: it solved the lot in act 1, villain
// included, and the GM spent act 2 steering it at objectives that no longer
// made sense, because a chapter-close refresh could only annotate, skip and
// rewrite two beats, and was told to pull play back to the plan; a sequel
// was plotted only after every planned act had been played.
//
// 1. pure: the course check's facts and the verdict they add up to, a saga
//    concluded early, the rest of a saga plotted again, the spacing between
//    two turns, a saga plotted as a plan and then its opening act, the
//    shape of both, and the bosses a plan is still saving;
// 2. with a database and a scripted model: the reported table end to end
//    (the villain falls in act 1, the sequel is plotted at that close), an
//    overtaken plan re-plotted, a boss killed early closing the chapter, and
//    a misshapen saga plotted once more.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-story-follows-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "32768";
register("./lib/register-alias.mjs", import.meta.url);

const {
  actTransition,
  activeBeatNumber,
  applyActDetail,
  applyReplot,
  applySagaChain,
  arcExhausted,
  completeBeat,
  concludeSaga,
  courseFromCheck,
  courseMayChange,
  fallenBosses,
  lengthProfile,
  nextSketchAct,
  normalizeStoryArc,
  openingActProblems,
  parseActDetailJson,
  parseArcJson,
  parseCourseCheckJson,
  parseOpeningActJson,
  parseReplotJson,
  parseSagaJson,
  parseSagaPlanJson,
  plannedBossesAhead,
  renderArcForPrompt,
  renderPlanForCourseCheck,
  renderPlanForReplot,
  renderSagaPlan,
  sagaComplete,
  sagaPlanProblems,
  sagaShapeProblems,
  sagaWithOpeningAct,
} = await import("../src/lib/dm/arc-logic.ts");

const { parseJsonLeniently } = await import("../src/lib/dm/lenient-json.ts");

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`ok: ${name}`);
}

const standard = lengthProfile("standard");
const step = (kind, text) => ({ kind, text });
const boss = (name, detail = "x") => ({ name, detail });

// A saga's plan as a planner writes it: four acts, each somewhere of its
// own with a boss of its own, and the villain last. No beats: act 1's are a
// second reply.
const actPlan = [
  { title: "The Quiet Parish", place: "The Quiet Parish", milestone: "The party uncovers the abductions", boss: boss("The Undercroft Warden", "A flesh-bound gate guardian"), allies: [], hooks: [] },
  { title: "The Sealed Gates", place: "The temple district gates", milestone: "The first heartbeat shatters the temple district", boss: boss("Captain Ivry", "Turned, holding the sealed gates"), allies: [], hooks: [] },
  { title: "The Broken Seal", place: "The reliquary vaults", milestone: "The seal fragments are reforged", boss: boss("The Reliquary Echo", "A memory of the god given teeth"), allies: [], hooks: [] },
  { title: "The Sunken Sanctum", place: "The sunken sanctum", milestone: "Descent to still the heart", boss: boss("Vicar Osseth Ascendant", "Half-merged with the waking god"), allies: [], hooks: [] },
];
const plan = {
  title: "The Drowned Crown",
  premise: "A dead god's heart is waking beneath the city.",
  stakes: "If it beats again, the city drowns in divine fire.",
  antagonist: "Vicar Osseth, who wants the god reborn.",
  actPlan,
  finale: "Still or wake the heart in the sunken sanctum.",
  finaleBoss: boss("Vicar Osseth Ascendant", "Half-merged with the waking god"),
  cast: [{ name: "Sexton Marl", role: "the only witness", agenda: "survive and be believed" }],
  subArcs: [{ name: "The Missing Sexton", goal: "Find the sexton before the next tremor", hook: "He saw the vicar's face", beats: ["Search the parish", "Follow the tunnel"] }],
};
// Act 1, as the reply written from that plan.
const opening = {
  beats: [
    { text: "The party notices the tremors and the missing clergy", waypoints: [step("place", "The Quiet Parish"), step("npc", "Sexton Marl")] },
    { text: "They trace the disappearances to the undercroft", waypoints: [step("place", "The undercroft stair")] },
    { text: "The Undercroft Warden bars the way down", waypoints: [step("fight", "The Undercroft Warden")] },
  ],
  events: [
    { kind: "ally", name: "Marl offers to guide them", detail: "He knows the abductors' tunnel", trigger: "the first night in the parish", actHint: 1 },
    { kind: "betrayal", name: "The gate captain turns", detail: "The captain seals the party inside the district", trigger: "when the party reaches the gates", actHint: 2 },
  ],
};
const text = (value) => JSON.stringify(value);
const assemble = (planChanges = {}, openingChanges = {}) =>
  sagaWithOpeningAct(parseSagaPlanJson(text({ ...plan, ...planChanges }), standard), parseOpeningActJson(text({ ...opening, ...openingChanges })), standard);

// The sequel a model plots once the saga above is over, and its act 1.
const sequelPlan = {
  title: "The Salt Regency",
  premise: "With the vicar gone, the city's regent claims the dead god's relics.",
  stakes: "The regent's relic trade arms every petty tyrant on the coast.",
  antagonist: "Regent Halvard, who sells what the temple buried.",
  actPlan: [
    { title: "The Relic Market", place: "The night market", milestone: "The party finds the relics on sale", boss: boss("Broker Senn", "Runs the night market"), allies: [], hooks: [] },
    { title: "The Coast Road", place: "The coast road", milestone: "The convoys are stopped", boss: boss("The Tithe Knight", "Guards the convoys"), allies: [], hooks: [] },
    { title: "The Salt Court", place: "The salt court", milestone: "The court turns on the regent", boss: boss("Magistrate Oule", "The regent's law"), allies: [], hooks: [] },
    { title: "The Regent's Vault", place: "The regent's vault", milestone: "The vault is emptied", boss: boss("Regent Halvard", "Armed with the last relic"), allies: [], hooks: [] },
  ],
  finale: "Empty the vault or take the regent's place.",
  finaleBoss: boss("Regent Halvard", "Armed with the last relic"),
  cast: [{ name: "Broker Senn", role: "relic broker", agenda: "sell before the temple notices" }],
  subArcs: [],
};
const sequelOpening = {
  beats: [
    { text: "A relic of the dead god turns up in a pawnshop", waypoints: [step("place", "The night market")] },
    { text: "The seller names the broker", waypoints: [step("npc", "Broker Senn")] },
    { text: "The broker's guards close the market", waypoints: [step("fight", "Broker Senn")] },
  ],
  events: [{ kind: "discovery", name: "The ledger", detail: "It lists every buyer", trigger: "when the party searches the broker's stall", actHint: 1 }],
};
const sequelArc = () => sagaWithOpeningAct(parseSagaPlanJson(text(sequelPlan), standard), parseOpeningActJson(text(sequelOpening)), standard);

// The rest of the saga plotted again: the heart is gone, the vicar is not.
const replotReply = {
  stakes: "The vicar's surviving faithful will drown the marsh villages to raise a new heart.",
  antagonist: "Vicar Osseth, hunted, gathering the faithful in the salt marsh.",
  actPlan: [
    { title: "The Salt Marsh", place: "The salt marsh", milestone: "The party tracks the faithful into the marsh", boss: boss("The Marsh Prophet", "Speaks for the vicar"), allies: [], hooks: [] },
    { title: "The Drowned Villages", place: "The drowned villages", milestone: "The villages are warned or lost", boss: boss("Sister Calla", "Leads the drowning rite"), allies: [], hooks: [] },
    { title: "The Last Vigil", place: "The lighthouse isle", milestone: "The vicar is run to ground", boss: boss("Vicar Osseth Unbound", "Without the heart, with nothing to lose"), allies: [], hooks: [] },
  ],
  finale: "End the vicar's vigil before the tide rite.",
  finaleBoss: boss("Vicar Osseth Unbound", "Without the heart, with nothing to lose"),
  keepEvents: ["ev1"],
  newCast: [{ name: "Ferrier Dask", role: "marsh guide", agenda: "get his family out" }],
};
// The act-detail pass's reply for the first of those acts.
const marshDetail = {
  beats: [
    { text: "Refugees from the marsh bring word of a prophet", waypoints: [step("place", "The marsh causeway")] },
    { text: "The causeway shrine shows where the faithful went", waypoints: [step("place", "The causeway shrine")] },
    { text: "The prophet's camp is found at the tide line", waypoints: [step("place", "The tide camp"), step("fight", "The Marsh Prophet")] },
  ],
  title: "The Salt Marsh",
  milestone: "The party tracks the faithful into the marsh",
  finale: "End the vicar's vigil before the tide rite.",
  bossEvent: { kind: "setpiece", name: "The Marsh Prophet", detail: "Speaks for the vicar from a drowned pulpit", trigger: "when the party reaches the tide camp", actHint: 2 },
  newEvents: [],
  newCast: [],
};

// Act 1 in play: its first beat done, the second [NOW].
function inAct1() {
  return completeBeat(assemble(), 1).arc;
}

// ---- pure: the course check ---------------------------------------------------------
{
  const arc = inAct1();
  const asked = renderPlanForCourseCheck(arc);
  assert.match(asked, /^Antagonist: Vicar Osseth, who wants the god reborn\.$/m);
  assert.match(asked, /^Stakes: If it beats again/m);
  assert.match(asked, /^Act 2: The first heartbeat shatters the temple district \| at: The temple district gates \| boss: Captain Ivry$/m);
  assert.doesNotMatch(asked, /^Act 1:/m, "the act in play is not asked about: the refresh settles its beats");

  const check = (reply) => parseCourseCheckJson(text(reply));
  const verdict = (reply) => courseFromCheck(arc, check(reply));
  assert.equal(parseCourseCheckJson("the plan is fine"), null);
  assert.deepEqual(check({}), { antagonistDefeated: false, stakesSettled: false, acts: [], note: "" }, "a reply that answers nothing says nothing changed");
  assert.equal(verdict({}), "holds");
  assert.equal(verdict({ antagonist: "weakened", stakes: "mostly settled", acts: [{ act: 2, state: "in doubt" }] }), "holds", "only the exact words count");
  assert.equal(verdict({ antagonist: " Defeated ", stakes: "SETTLED", note: "They slew the vicar." }), "concluded", "the villain beaten and the stakes settled: the saga is over, whatever act it is");
  assert.equal(check({ antagonist: "defeated", note: "They slew the vicar." }).note, "They slew the vicar.");
  assert.equal(verdict({ antagonist: "defeated", stakes: "open" }), "overtaken", "a finale with no villain cannot run as written");
  assert.equal(verdict({ antagonist: "at large", stakes: "settled" }), "overtaken", "nor a villain with nothing left to threaten");
  assert.equal(verdict({ acts: [{ act: 2, state: "done" }] }), "holds", "one spent act of three is the refresh's to revise");
  assert.equal(verdict({ acts: [{ act: 2, state: "done" }, { act: 3, state: "moot" }] }), "overtaken", "most of what is ahead already done or pointless");
  assert.equal(verdict({ acts: [{ act: 1, state: "done" }, { act: 9, state: "done" }, { act: 2, state: "done" }, { act: 2, state: "moot" }] }), "holds", "an act that is not ahead, or named twice, counts for nothing");
  const nobody = normalizeStoryArc({ ...arc, antagonist: "" });
  assert.equal(courseFromCheck(nobody, check({ antagonist: "defeated", stakes: "settled" })), "overtaken", "a saga that names no antagonist cannot have beaten one");
  ok("the course check's facts add up to a verdict, and a garbled answer changes nothing");
}

// ---- pure: a saga the table ended early ---------------------------------------------
{
  const arc = inAct1();
  const carded = normalizeStoryArc({
    ...arc,
    events: [...arc.events, { id: "ev9", kind: "setpiece", name: "The author's set piece", detail: "From a storyboard card", trigger: "at the gates", actHint: 2, cardId: "card-1", status: "pending" }],
  });
  const ended = concludeSaga(carded, "The party slew Vicar Osseth in the undercroft and stilled the heart.", 3);
  assert.deepEqual(ended.beats.map((beat) => beat.status), ["done", "skipped", "skipped"], "what was played stays played; what was planned is settled as never played");
  assert.equal(arc.beats[1].status, "active", "the arc it was given is untouched");
  assert.ok(arcExhausted(ended));
  assert.equal(nextSketchAct(ended), null, "the acts ahead are let go");
  assert.ok(sagaComplete(ended), "which is what lets the same close plot the sequel");
  assert.deepEqual(ended.saga.sketches.map((sketch) => [sketch.act, sketch.status]), [[1, "done"]]);
  assert.equal(ended.saga.plannedActs, 1);
  assert.equal(ended.saga.turnedAt, 3);
  assert.deepEqual(
    ended.events.map((event) => [event.id, event.status]),
    [["ev1", "dropped"], ["ev2", "dropped"], ["ev9", "pending"]],
    "the old plan's moments go with it; one a person wrote on a board stays",
  );
  const stored = normalizeStoryArc(JSON.parse(text(ended)));
  assert.equal(stored.saga.concluded, ended.saga.concluded, "how it ended survives the round trip to storage");
  assert.equal(stored.saga.turnedAt, 3);

  const render = renderArcForPrompt(ended);
  assert.match(render, /ended this saga's central conflict ahead of the plan: The party slew Vicar Osseth/);
  assert.doesNotMatch(render, /^Antagonist:/m, "a beaten antagonist is no longer named as the one to play");
  assert.doesNotMatch(render, /^Stakes:/m);
  assert.doesNotMatch(render, /^Finale:/m, "nor a finale that never came");
  assert.doesNotMatch(render, /Captain Ivry|Reliquary Echo/, "nor the bosses of acts nobody will play");
  assert.match(render, /sooner than planned; a sequel saga will be planned at the chapter break/);
  assert.match(render, /The \[skipped\] beats never happened/);

  const chained = applySagaChain(ended, sequelArc(), "");
  assert.equal(chained.saga.sagaIndex, 2);
  assert.equal(chained.saga.priorSagas[0].resolution, ended.saga.concluded, "the sequel records how the table ended it, not the finale that was planned");
  assert.equal(chained.saga.turnedAt, 3, "and inherits the spacing from the turn that began it");
  const transition = actTransition(arc, chained);
  assert.equal(transition.ended.sagaEnded, true, "the table hears the act and the saga close");
  assert.equal(transition.began.act, 1);
  assert.equal(transition.began.sagaTitle, "The Salt Regency");

  // An arc with no saga tier has its beats settled and nothing else.
  const plain = parseArcJson(text({ premise: "A plain arc.", beats: ["One", "Two", "Three"] }));
  const plainEnded = concludeSaga(plain, "Done early.");
  assert.equal(plainEnded.saga, null);
  assert.ok(arcExhausted(plainEnded));
  ok("a saga the table ended early is settled, leaves the GM nothing stale to steer by, and chains into its sequel");
}

// ---- pure: the rest of a saga plotted again ----------------------------------------
{
  const arc = inAct1();
  assert.equal(parseReplotJson("not json", 3), null);
  assert.equal(parseReplotJson(text({ ...replotReply, actPlan: [] }), 3), null, "a re-plot that plans no act is no re-plot");
  assert.equal(parseReplotJson(text(replotReply), 1).sketches.length, 1, "it plans no more acts than the saga has room for");

  // What the re-plot is shown: the old plan as what to move on from.
  const shown = renderPlanForReplot(arc, [{ act: 2, state: "done" }, { act: 3, state: "moot" }]);
  assert.match(shown, /^Beats the party played:\n- The party notices the tremors and the missing clergy$/m);
  assert.match(shown, /^Beats planned for the act in play that the party never played, having gone another way:\n- They trace the disappearances to the undercroft\n- The Undercroft Warden bars the way down$/m);
  assert.match(shown, /^The acts the OLD plan had ahead, which the table has overtaken:$/m);
  assert.match(shown, /^- Act 2: .* \| boss: Captain Ivry \[ALREADY DONE by the party: finished, never to be planned again\]$/m);
  assert.match(shown, /^- Act 3: .* \[no longer possible as written\]$/m);
  assert.match(shown, /^- Act 4: .* \[not reached, and may not happen as written\]$/m);
  assert.match(shown, /^- \[ev2\] The gate captain turns: /m, "the planned moments are listed by the ids the reply keeps them by");
  assert.doesNotMatch(shown, /\[NOW\]|steer scenes/, "it is not the GM's render: nothing in it says to steer at the old plan");

  const turned = applyReplot(arc, parseReplotJson(text(replotReply), 3), 4);
  assert.deepEqual(turned.beats.map((beat) => beat.status), ["done", "skipped", "skipped"], "the act in play ends where the table left it");
  assert.equal(turned.acts, 1);
  assert.ok(arcExhausted(turned), "with nothing left to steer at until the next act is written");
  assert.deepEqual(
    turned.saga.sketches.map((sketch) => [sketch.act, sketch.status, sketch.place, sketch.boss?.name]),
    [
      [1, "done", "The Quiet Parish", "The Undercroft Warden"],
      [2, "sketch", "The salt marsh", "The Marsh Prophet"],
      [3, "sketch", "The drowned villages", "Sister Calla"],
      [4, "sketch", "The lighthouse isle", "Vicar Osseth Unbound"],
    ],
    "the act played is a record; the acts ahead are the new ones",
  );
  assert.equal(nextSketchAct(turned).act, 2, "which is the state the act-detail pass writes into beats");
  assert.equal(turned.saga.plannedActs, 4);
  assert.equal(turned.saga.sagaIndex, 1, "it is still the same saga");
  assert.equal(turned.saga.title, "The Drowned Crown");
  assert.equal(turned.saga.finaleBoss.name, "Vicar Osseth Unbound");
  assert.equal(turned.saga.turnedAt, 4);
  assert.match(turned.antagonist, /hunted/);
  assert.match(turned.stakes, /marsh villages/);
  assert.match(turned.finale, /vigil/);
  assert.deepEqual(
    turned.events.map((event) => [event.name, event.status]),
    [["Marl offers to guide them", "pending"], ["The gate captain turns", "dropped"]],
    "a moment the new plan asked to keep stays; the rest of the old plan's go",
  );
  assert.ok(turned.cast.some((npc) => npc.name === "Ferrier Dask"));
  const waiting = renderArcForPrompt(turned);
  assert.doesNotMatch(waiting, /Captain Ivry|Reliquary Echo|Ascendant/, "nothing of the plan the table overtook is in front of the GM");
  assert.match(waiting, /Act 3 \(ahead, sketch only\): The villages are warned or lost \| at: The drowned villages \| planned boss: Sister Calla/);
  assert.match(waiting, /The current act is complete; the next act will be planned at the chapter break/);

  // The act-detail pass lands the first new act, as it lands every act.
  const landed = applyActDetail(turned, parseActDetailJson(text(marshDetail)));
  assert.deepEqual(landed.beats.map((beat) => beat.status), ["done", "skipped", "skipped", "active", "pending", "pending"]);
  assert.equal(activeBeatNumber(landed), 4, "[NOW] is the first beat of the new plan");
  assert.deepEqual(landed.saga.sketches.map((sketch) => sketch.status), ["done", "detailed", "sketch", "sketch"]);
  const transition = actTransition(arc, landed);
  assert.equal(transition.ended.act, 1);
  assert.equal(transition.ended.sagaEnded, false);
  assert.deepEqual([transition.began.act, transition.began.title], [2, "The Salt Marsh"]);

  const plain = parseArcJson(text({ premise: "A plain arc.", beats: ["One", "Two", "Three"] }));
  assert.equal(applyReplot(plain, parseReplotJson(text(replotReply), 3), 4), plain, "an arc with no saga tier has nothing to re-plot");
  ok("an overtaken plan is plotted again: the act ends, the acts ahead are new, and the old plan leaves the prompt");
}

// ---- pure: how often the plan may turn ----------------------------------------------
{
  const arc = inAct1();
  assert.equal(courseMayChange(arc, 1), true, "a first saga may turn at any close");
  const turned = applyReplot(arc, parseReplotJson(text(replotReply), 3), 4);
  assert.equal(courseMayChange(turned, 5), false, "not again at the very next close");
  assert.equal(courseMayChange(turned, 6), true, "but two chapters on it may");
  const afterEarlyEnd = applySagaChain(concludeSaga(arc, "Ended early.", 7), sequelArc(), "");
  assert.equal(courseMayChange(afterEarlyEnd, 8), false, "a sequel begun by an early ending cannot be ended at its first close");
  const authored = normalizeStoryArc({ ...arc, beats: arc.beats.map((beat, index) => (index === 2 ? { ...beat, cardId: "card-7" } : beat)) });
  assert.equal(courseMayChange(authored, 9), false, "and a plan a person wrote on a storyboard is never turned for them");
  ok("the plan turns at most once every two chapters, and never over an author's unplayed beats");
}

// ---- pure: a saga plotted as a plan, then its opening act -------------------------------
{
  assert.equal(parseSagaPlanJson("nothing", standard), null);
  assert.equal(parseSagaPlanJson(text({ ...plan, actPlan: actPlan.slice(0, 1) }), standard), null, "a plan of one act is no saga");
  assert.equal(parseSagaPlanJson(text({ ...plan, premise: "" }), standard), null);
  const parsed = parseSagaPlanJson(text(plan), standard);
  assert.deepEqual(parsed.sketches.map((sketch) => [sketch.act, sketch.place]), [[1, "The Quiet Parish"], [2, "The temple district gates"], [3, "The reliquary vaults"], [4, "The sunken sanctum"]]);
  const shown = renderSagaPlan(parsed);
  assert.match(shown, /^Act 1 \(the act to write\): "The Quiet Parish": The party uncovers the abductions \| place: The Quiet Parish \| boss: The Undercroft Warden/m);
  assert.match(shown, /^Later acts \(already planned; nothing of them belongs in act 1\):$/m);
  assert.match(shown, /^Act 4: "The Sunken Sanctum": Descent to still the heart \| place: The sunken sanctum \| boss: Vicar Osseth Ascendant/m);

  assert.equal(parseOpeningActJson(text({ beats: ["Only one"] })), null, "fewer than two beats is no act");
  const wrapped = parseOpeningActJson(text({ ...opening, beats: [opening.beats[0], text(opening.beats[1]), opening.beats[2]] }));
  assert.equal(wrapped.beats[1].text, "They trace the disappearances to the undercroft", "a beat written as a string holding its own JSON is read as the beat");
  assert.equal(wrapped.beats[1].waypoints[0].text, "The undercroft stair");

  const arc = assemble();
  assert.deepEqual(arc.beats.map((beat) => [beat.act, beat.status]), [[1, "active"], [1, "pending"], [1, "pending"]]);
  assert.deepEqual(arc.saga.sketches.map((sketch) => sketch.status), ["detailed", "sketch", "sketch", "sketch"]);
  assert.deepEqual(arc.events.map((event) => event.id), ["ev1", "ev2"], "the opening act brings the saga's planned moments");
  assert.equal(arc.subArcs[0].status, "active");
  // One reply holding both, as sagas were written before, still reads.
  const whole = parseSagaJson(text({ ...plan, act1Beats: opening.beats, events: opening.events }), standard);
  assert.deepEqual({ ...whole, updatedAt: "" }, { ...arc, updatedAt: "" });
  ok("a saga is its plan and then its opening act, and the two make the arc one reply used to");
}

// ---- pure: a reply with one small slip in it still reads ------------------------------
{
  // The slips the default local model made, as it made them.
  const braceTooMany = '{"beats":[{"text":"The mine gate","waypoints":[{"kind":"item","text":"Mine Map"}]}},{"text":"The first shaft","waypoints":[]}],"events":[]}';
  assert.throws(() => JSON.parse(braceTooMany));
  assert.deepEqual(parseJsonLeniently(braceTooMany), { beats: [{ text: "The mine gate", waypoints: [{ kind: "item", text: "Mine Map" }] }, { text: "The first shaft", waypoints: [] }], events: [] });
  const commaBeforeBrace = '{"actPlan":[{"title":"One","hooks":["a hook"],},{"title":"Two","hooks":[]}],"finale":"x"}';
  assert.deepEqual(parseJsonLeniently(commaBeforeBrace), { actPlan: [{ title: "One", hooks: ["a hook"] }, { title: "Two", hooks: [] }], finale: "x" });
  const quoteBeforeClose = '{"actPlan":[{"title":"One","hooks":["a hook"],"},{"title":"Two","hooks":[]}],"finale":"x"}';
  assert.deepEqual(parseJsonLeniently(quoteBeforeClose), { actPlan: [{ title: "One", hooks: ["a hook"] }, { title: "Two", hooks: [] }], finale: "x" });
  const quoteBeforeObject = '{"cast":[{"name":"Talia","role":"Forewoman"},"{"name":"Liora","role":"Archivist"}]}';
  assert.deepEqual(parseJsonLeniently(quoteBeforeObject), { cast: [{ name: "Talia", role: "Forewoman" }, { name: "Liora", role: "Archivist" }] });
  const keyLostItsQuote = '{"beats":[{"text":"A sealed chapel.","waypoints":[]},"{text":"The pattern of disappearances.","waypoints":[{"kind":"place","text":"The chapel"}]}]}';
  assert.deepEqual(parseJsonLeniently(keyLostItsQuote), { beats: [{ text: "A sealed chapel.", waypoints: [] }, { text: "The pattern of disappearances.", waypoints: [{ kind: "place", text: "The chapel" }] }] });

  // And nothing looser.
  assert.equal(parseJsonLeniently('{"beats":[{"text":"Cut short","waypoints":[{"kind":"pl'), undefined, "a reply cut short is not closed for it");
  assert.equal(parseJsonLeniently("I would open with a storm."), undefined);
  assert.equal(parseJsonLeniently('{"title" "no colon"}'), undefined);
  const braces = { notes: ["{not an object}", "a } in prose", "[sic]"], count: -2.5e1, flag: true, none: null, text: 'a "quoted" word\n' };
  assert.deepEqual(parseJsonLeniently(text(braces)), braces, "a well-formed reply reads as itself, braces in its strings and all");

  // Through the arc's own parsers: a plan and an act with a slip each make the saga.
  const slippedPlan = text(plan).replace('"hooks":[]},{', '"hooks":[],"},{');
  assert.throws(() => JSON.parse(slippedPlan));
  const slippedAct = text(opening).replace('}]},{"text"', '}]}},{"text"');
  assert.throws(() => JSON.parse(slippedAct));
  const arc = sagaWithOpeningAct(parseSagaPlanJson(slippedPlan, standard), parseOpeningActJson(slippedAct), standard);
  assert.deepEqual({ ...arc, updatedAt: "" }, { ...assemble(), updatedAt: "" }, "and it is the saga the same replies make without the slips");
  ok("a planner's reply with a brace too many, a comma too many or a stray quote still reads, and a cut-off one still does not");
}

// ---- pure: the shape of a fresh saga ------------------------------------------------
{
  const later = (names) => actPlan.map((act, index) => ({ ...act, boss: boss(names[index]) }));
  assert.deepEqual(sagaShapeProblems(assemble()), [], "four acts, four places, four bosses, the villain last: nothing to say");

  // The reported saga: the whole of it in act 1, one beat per act, the
  // villain's fall the last of them.
  const inMiniature = [
    opening.beats[0],
    { text: "The gate captain is brought down", waypoints: [step("place", "The temple district gates"), step("fight", "Captain Ivry")] },
    { text: "The reliquary gives up the seal", waypoints: [step("fight", "The Reliquary Echo")] },
    { text: "The vicar is ended at the heart", waypoints: [step("fight", "Vicar Osseth Ascendant")] },
  ];
  const parsedPlan = parseSagaPlanJson(text(plan), standard);
  const reached = openingActProblems(parsedPlan, parseOpeningActJson(text({ beats: inMiniature })).beats);
  assert.equal(reached.length, 1, reached.join(" | "));
  assert.match(reached[0], /Act 1's beats reach past act 1: they already fight Captain Ivry \(act 2's boss\), The Reliquary Echo \(act 3's boss\), Vicar Osseth Ascendant \(act 4's boss\)/);
  assert.deepEqual(sagaShapeProblems(assemble({}, { beats: inMiniature })), reached, "the same is said of the saga once assembled");
  const seen = [opening.beats[0], { text: "Vicar Osseth is seen at the parish window", waypoints: [step("npc", "Vicar Osseth")] }, opening.beats[2]];
  assert.deepEqual(openingActProblems(parsedPlan, seen), [], "the villain seen in act 1 is foreshadowing, not a fight");
  assert.deepEqual(sagaPlanProblems(parsedPlan), []);

  const problems = (changes) => sagaPlanProblems(parseSagaPlanJson(text({ ...plan, ...changes }), standard));
  const everyDoor = problems({ actPlan: later(["Vicar Osseth", "Vicar Osseth", "Vicar Osseth", "Vicar Osseth Ascendant"]) });
  assert.ok(everyDoor.some((line) => /Act 1's boss is the final boss/.test(line)), everyDoor.join(" | "));
  assert.ok(everyDoor.some((line) => /Acts 1 and 2 share a boss/.test(line)), everyDoor.join(" | "));

  const villainEarly = problems({ actPlan: later(["The Undercroft Warden", "Vicar Osseth", "The Reliquary Echo", "The Waking God"]), finaleBoss: boss("The Waking God") });
  assert.equal(villainEarly.length, 1, villainEarly.join(" | "));
  assert.match(villainEarly[0], /Act 2's boss \(Vicar Osseth\) is the antagonist/);
  const described = problems({ antagonist: "A drowned priestess who seeks to silence all worship", actPlan: later(["The Undercroft Warden", "A drowned priestess", "The Reliquary Echo", "Vicar Osseth Ascendant"]) });
  assert.deepEqual(described, [], "an antagonist line that opens on a description names nobody to look for");

  const shared = problems({ actPlan: later(["The Undercroft Warden", "Captain Ivry", "Captain Ivry", "Vicar Osseth Ascendant"]) });
  assert.deepEqual(shared.map((line) => line.slice(0, 26)), ["Acts 2 and 3 share a boss "]);

  const onePlace = problems({ actPlan: actPlan.map((act, index) => (index === 1 ? { ...act, place: "the quiet parish" } : act)) });
  assert.deepEqual(onePlace.map((line) => line.slice(0, 38)), ["Acts 1 and 2 are set in the same place"]);

  const twoEndings = problems({ finaleBoss: boss("The Waking God") });
  assert.equal(twoEndings.length, 1, twoEndings.join(" | "));
  assert.match(twoEndings[0], /The last act's boss \(Vicar Osseth Ascendant\) is not the final boss \(The Waking God\)/);
  ok("a saga that is one errand in four stages is named for what is wrong with it");
}

// ---- pure: the bosses a plan is still saving ------------------------------------------
{
  const arc = inAct1();
  assert.deepEqual(plannedBossesAhead(arc), [
    { name: "Captain Ivry", act: 2 },
    { name: "The Reliquary Echo", act: 3 },
    { name: "Vicar Osseth Ascendant", act: null },
  ]);
  assert.deepEqual(fallenBosses(arc, ["Cultist", "Vicar Osseth"]), [{ name: "Vicar Osseth Ascendant", act: null }], "the villain, by the name the fight gave him");
  assert.deepEqual(fallenBosses(arc, ["Captain Ivry the Turned"]).map((entry) => entry.act), [2]);
  assert.deepEqual(fallenBosses(arc, ["The Undercroft Warden"]), [], "this act's own boss falling is the plan");
  const guarded = assemble({ actPlan: actPlan.map((act, index) => (index === 1 ? { ...act, boss: boss("Captain of the Guard") } : act)) });
  assert.deepEqual(fallenBosses(guarded, ["Guard", "Captain"]), [], "a guard cut down at the gate is not the captain the plan is saving");
  const lastAct = normalizeStoryArc({ ...arc, saga: { ...arc.saga, sketches: arc.saga.sketches.map((sketch) => ({ ...sketch, status: "done" })) } });
  assert.deepEqual(plannedBossesAhead(lastAct), [], "in the last act the final boss falling is the finale");
  ok("a boss saved for a later act is recognised among the slain, and only then");
}

// ---- pure: what the GM is told every turn ---------------------------------------------
{
  const render = renderArcForPrompt(inAct1());
  assert.match(render, /The plan follows the table, never the reverse/);
  assert.match(render, /never steer back to it or stage it again/);
  assert.match(render, /out of reach until their acts/);
  ok("the arc's header tells the GM not to steer back to what play has already settled");
}

// ---- a scripted model -----------------------------------------------------------------
const requests = [];
const script = { refresh: {}, course: {}, plans: [], openings: [], replots: [] };
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const system = String(body.messages?.[0]?.content ?? "");
    const user = String(body.messages?.[1]?.content ?? "");
    const reply = (content) => {
      const written = typeof content === "string" ? content : text(content);
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${text({ choices: [{ index: 0, delta: { content: written }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${text({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(text({ choices: [{ message: { content: written }, finish_reason: "stop" }] }));
    };
    const kinds = [
      ["closing a chapter", "chapter"],
      ["maintain the AI GM's secret story arc", "refresh"],
      ["checking the secret story plan", "course"],
      ["Plot the SEQUEL saga", "sequel"],
      ["Plot the REST of the saga", "replot"],
      ["writing the opening act", "opening"],
      ["You plot the secret story saga", "plan"],
      ["has finished the current act", "detail"],
      ["closing an act", "recap"],
    ];
    const kind = kinds.find(([words]) => system.includes(words))?.[1] ?? "other";
    requests.push({ kind, system, user });
    const replies = {
      chapter: () => ({ title: "The Undercroft", summary: "The party went down into the undercroft and ended what waited there.", highlights: ["The party ended what waited in the undercroft."], facts: [] }),
      refresh: () => script.refresh,
      course: () => script.course,
      sequel: () => sequelPlan,
      replot: () => script.replots.shift() ?? replotReply,
      opening: () => (user.includes("This is a sequel saga") ? sequelOpening : (script.openings.shift() ?? opening)),
      plan: () => script.plans.shift() ?? plan,
      detail: () => marshDetail,
      recap: () => ({ title: "The Quiet Parish", recap: "You went down into the undercroft and came back up." }),
      other: () => "{}",
    };
    reply(replies[kind]());
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, setStoryArc, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listMessagesPage } = await import("../src/lib/db/messages.ts");
const { listChapters, ensureOpenChapter } = await import("../src/lib/db/chapters.ts");
const { createEncounter, endEncounter, insertEnemy, patchEnemyHp } = await import("../src/lib/db/encounters.ts");
const { maybeCloseChapter } = await import("../src/lib/dm/chapter-close.ts");
const { generateStoryArc } = await import("../src/lib/dm/arc.ts");

const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
function play(campaignId, sheetId, lines) {
  for (let index = 0; index < lines; index += 1) {
    insertCampaignMessage({
      campaignId,
      seq: allocateSeq(campaignId),
      authorType: index % 2 ? "dm" : "player",
      userId: index % 2 ? null : lead.id,
      characterId: index % 2 ? null : sheetId,
      content: index % 2 ? "The undercroft stair winds down into the dark." : "I go on down the stair.",
    });
  }
}
function table(title, arc) {
  const campaign = createCampaign(lead.id, { title, description: "A test of the plan.", theme: "a drowned city", maxPlayers: 2, startingLevel: 1, difficulty: "normal", gameSettings: { ttsEnabled: false } });
  updateStorySettings(campaign.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "fake", imageGenerationEnabled: false, autoImages: false });
  setCampaignStatus(campaign.id, "active");
  const sheet = createSheet(campaign.id, lead.id, 1, createSheetSchema.parse({
    name: "Bram", race: "human", class: "fighter", abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, maxHp: 12, ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
  }));
  if (arc) {
    setStoryArc(campaign.id, arc);
  }
  ensureOpenChapter(campaign.id);
  return { id: campaign.id, sheetId: sheet.id, arc: () => getCampaignById(campaign.id).storyArc };
}
const notes = (campaignId) =>
  listMessagesPage(campaignId, 0, 500)
    .filter((message) => message.authorType === "system")
    .map((message) => message.content);
const closed = (campaignId) => listChapters(campaignId).filter((chapter) => chapter.status === "closed").length;
const sent = (kind) => requests.filter((request) => request.kind === kind);
const ahead = { antagonist: "at large", stakes: "open", acts: [{ act: 2, state: "ahead" }, { act: 3, state: "ahead" }, { act: 4, state: "ahead" }], note: "" };

try {
  // ---- the reported table: the villain falls in act 1 -------------------------------
  {
    const game = table("Ended in act one", inAct1());
    play(game.id, game.sheetId, 20);
    requests.length = 0;
    script.refresh = {};
    script.course = { antagonist: "defeated", stakes: "settled", acts: [{ act: 2, state: "moot" }, { act: 3, state: "moot" }, { act: 4, state: "moot" }], note: "The party slew Vicar Osseth in the undercroft and stilled the heart." };
    await maybeCloseChapter(game.id, { beatCompleted: false, manual: true });

    const after = game.arc();
    assert.equal(after.saga.sagaIndex, 2, "the sequel was plotted at that close, with three acts of the old saga unplayed");
    assert.equal(after.saga.title, "The Salt Regency");
    assert.match(after.saga.priorSagas[0].resolution, /slew Vicar Osseth/);
    assert.match(after.antagonist, /Regent Halvard/);
    assert.equal(activeBeatNumber(after), 1);
    assert.equal(after.beats[0].text, "A relic of the dead god turns up in a pawnshop");
    const render = renderArcForPrompt(after);
    assert.doesNotMatch(render, /Captain Ivry|Reliquary Echo|sunken sanctum|Ascendant/i, "nothing of the unplayed acts is left for the GM to steer at");
    const asked = sent("course")[0].user;
    assert.match(asked, /^Antagonist: Vicar Osseth/m, "the check is asked about the plan");
    assert.match(asked, /Chapters played so far, oldest first:/, "with the chapters played, not one chapter alone");
    assert.match(asked, /How that chapter ended, word for word:\n(?:.|\n)*Player: I go on down the stair\./, "and with the chapter's last lines as they were played, not only its summary");
    assert.match(sent("sequel")[0].user, /ended this saga before its planned finale: The party slew Vicar Osseth/);
    assert.match(sent("sequel")[0].user, /\[skipped\]/);
    assert.match(sent("opening")[0].user, /The saga's plan:\nSaga: "The Salt Regency"/, "the sequel's act 1 is written from the sequel's plan");
    const told = notes(game.id).join("\n");
    assert.match(told, /Act I, "The Quiet Parish", comes to a close, and with it the saga of "The Drowned Crown"/);
    assert.match(told, /Act I, "The Relic Market", begins: the saga of "The Salt Regency"/);

    // The very next close cannot end the sequel too: it is not even asked.
    play(game.id, game.sheetId, 8);
    requests.length = 0;
    await maybeCloseChapter(game.id, { beatCompleted: false, manual: true });
    assert.equal(closed(game.id), 2);
    assert.equal(sent("course").length, 0, "one chapter after a turn, the check is not asked");
    assert.equal(game.arc().saga.sagaIndex, 2);
    assert.equal(game.arc().beats.some((beat) => beat.status === "skipped"), false);
    ok("the villain falls in act 1: the saga ends there, the sequel is plotted, and the table hears both");
  }

  // ---- an overtaken plan -------------------------------------------------------------
  {
    const game = table("Overtaken", inAct1());
    play(game.id, game.sheetId, 20);
    requests.length = 0;
    script.refresh = {};
    script.course = { antagonist: "at large", stakes: "settled", acts: [{ act: 2, state: "done" }], note: "The party burned the undercroft and the heart with it; the vicar fled the city." };
    // The first re-plot gives two acts one boss, and is plotted once more.
    script.replots = [{ ...replotReply, actPlan: replotReply.actPlan.map((act, index) => (index === 1 ? { ...act, boss: boss("The Marsh Prophet") } : act)) }, replotReply];
    await maybeCloseChapter(game.id, { beatCompleted: false, manual: true });

    const after = game.arc();
    assert.equal(after.saga.sagaIndex, 1);
    assert.equal(after.acts, 2);
    assert.deepEqual(after.beats.map((beat) => beat.status), ["done", "skipped", "skipped", "active", "pending", "pending"]);
    assert.equal(after.beats[3].text, "Refugees from the marsh bring word of a prophet");
    assert.match(sent("replot")[0].user, /What overtook the plan: The party burned the undercroft/);
    assert.match(sent("replot")[0].user, /Plan exactly 3 acts, the first opening where that chapter ended\./, "the saga keeps the length it was planned at");
    assert.match(sent("replot")[0].user, /The chapter that just closed, "The Undercroft":\nThe party went down into the undercroft/, "the re-plot reads what happened, not only a line about it");
    assert.match(sent("replot")[0].user, /- Act 2: .* \[ALREADY DONE by the party/, "and which of the old acts are behind the party");
    assert.equal(sent("replot").length, 2);
    assert.match(sent("replot")[1].user, /Your last plan had these problems\. Write it again, whole, without them:\n- Acts 2 and 3 share a boss \(The Marsh Prophet\)/);
    assert.deepEqual(after.saga.sketches.map((sketch) => sketch.boss.name), ["The Undercroft Warden", "The Marsh Prophet", "Sister Calla", "Vicar Osseth Unbound"], "the better re-plot is the one kept");
    assert.match(sent("detail")[0].user, /The next act's sketch:\nMilestone: The party tracks the faithful into the marsh\nPlace: The salt marsh/, "the new act's beats come from the pass that writes every act");
    assert.equal(sent("sequel").length, 0);
    const told = notes(game.id).join("\n");
    assert.match(told, /Act I, "The Quiet Parish", comes to a close\./);
    assert.match(told, /Act II, "The Salt Marsh", begins\./);
    assert.equal(listChapters(game.id).find((chapter) => chapter.status === "open").act, 2, "the chapter that opens is in the new act");
    ok("an overtaken plan: the rest of the saga is plotted again at that close, and the next act begins");
  }

  // ---- a plan that holds is left alone -----------------------------------------------
  {
    const game = table("Holds", inAct1());
    play(game.id, game.sheetId, 20);
    requests.length = 0;
    script.refresh = { beatAnnotations: [{ beat: 2, detail: "they bribed the verger for the key" }] };
    script.course = ahead;
    await maybeCloseChapter(game.id, { beatCompleted: false, manual: true });
    const after = game.arc();
    assert.deepEqual(after.beats.map((beat) => beat.status), ["done", "active", "pending"]);
    assert.equal(after.beats[1].detail, "they bribed the verger for the key");
    assert.equal(sent("course").length, 1, "the check is one call");
    assert.equal(sent("replot").length + sent("sequel").length, 0);
    assert.equal(after.saga.turnedAt, undefined);
    ok("a plan that still fits is annotated and otherwise left as written");
  }

  // ---- a boss saved for later dies: the chapter closes on it --------------------------
  {
    const game = table("Boss fell", inAct1());
    play(game.id, game.sheetId, 20);
    script.refresh = {};
    script.course = ahead;
    await maybeCloseChapter(game.id, { beatCompleted: false });
    assert.equal(closed(game.id), 0, "twenty lines with no beat landed close nothing");

    const fight = createEncounter(game.id, "The vicar at the heart", "fight");
    const stats = { ac: 15, maxHp: 60, dexMod: 1, speed: "30 ft.", attacks: [{ name: "Mace", toHit: 5, damage: "1d6+3", type: "bludgeoning" }], traits: [], resist: "", immune: "", vulnerable: "", conditionImmune: "", cr: 5, xp: 1800 };
    const cultist = insertEnemy({ encounterId: fight.id, campaignId: game.id, slug: "cultist", displayName: "Cultist", initiative: 9, stats: { ...stats, maxHp: 9 } });
    const vicar = insertEnemy({ encounterId: fight.id, campaignId: game.id, slug: "priest", displayName: "Vicar Osseth", initiative: 14, stats });
    patchEnemyHp(cultist.id, 0, "dead");
    await maybeCloseChapter(game.id, { beatCompleted: false });
    assert.equal(closed(game.id), 0, "a cultist is nobody the plan was saving");

    patchEnemyHp(vicar.id, 0, "dead");
    endEncounter(fight.id, "victory");
    requests.length = 0;
    script.course = { antagonist: "defeated", stakes: "settled", note: "The party killed Vicar Osseth at the heart." };
    await maybeCloseChapter(game.id, { beatCompleted: false });
    assert.equal(closed(game.id), 1, "the villain's death closes the chapter, with the [NOW] beat still open");
    const fell = /Foes killed in a fight this chapter that share a name with a boss the plan is still saving: Vicar Osseth Ascendant \(the saga's final boss\)/;
    assert.match(sent("course")[0].user, fell, "the check is told who fell");
    assert.match(sent("refresh")[0].user, fell, "and so is the refresh");
    assert.equal(game.arc().saga.sagaIndex, 2);
    ok("the saga's villain dies in act 1: the chapter closes on it and the refresh is told who fell");
  }

  // ---- a saga is plotted in two replies, and once more where its shape is wrong ---------
  {
    const clean = table("Clean", null);
    requests.length = 0;
    await generateStoryArc(clean.id);
    assert.deepEqual(requests.map((request) => request.kind).filter((kind) => kind === "plan" || kind === "opening"), ["plan", "opening"], "a saga with nothing wrong is its plan and then its opening act");
    assert.doesNotMatch(sent("plan")[0].system, /act1Beats|"events"/, "the plan is asked for without beats");
    assert.match(sent("opening")[0].user, /^Act 1 \(the act to write\): "The Quiet Parish"/m, "and act 1 is written from it");
    assert.deepEqual(clean.arc().beats.map((beat) => beat.text), opening.beats.map((beat) => beat.text));
    assert.equal(clean.arc().saga.sketches.length, 4);

    const waiting = boss("Vicar Osseth", "Waiting at the end of the errand");
    const errand = { ...plan, actPlan: actPlan.map((act, index) => (index < 3 ? { ...act, boss: waiting } : act)) };
    const replanned = table("Replanned", null);
    requests.length = 0;
    script.plans = [errand, plan];
    await generateStoryArc(replanned.id);
    assert.equal(sent("plan").length, 2, "one more plot was asked for");
    assert.match(sent("plan")[1].user, /Your last plan had these problems\. Write it again, whole, without them:\n- Act 1's boss is the final boss/);
    assert.deepEqual(replanned.arc().saga.sketches.map((sketch) => sketch.boss.name), ["The Undercroft Warden", "Captain Ivry", "The Reliquary Echo", "Vicar Osseth Ascendant"], "and the better plot is the one kept");

    const stubborn = table("Still an errand", null);
    requests.length = 0;
    script.plans = [errand, errand];
    await generateStoryArc(stubborn.id);
    assert.equal(sent("plan").length, 2, "one retry, never a loop");
    assert.equal(stubborn.arc().saga.sketches[0].boss.name, "Vicar Osseth", "a model that cannot fix it still leaves the table with its plan");

    // Act 1 written as the whole saga in miniature is written once more.
    const miniature = {
      ...opening,
      beats: [opening.beats[0], { text: "The gate captain is brought down", waypoints: [step("fight", "Captain Ivry")] }, { text: "The vicar is ended at the heart", waypoints: [step("fight", "Vicar Osseth Ascendant")] }],
    };
    const rewritten = table("Rewritten", null);
    requests.length = 0;
    script.plans = [];
    script.openings = [miniature, opening];
    await generateStoryArc(rewritten.id);
    assert.equal(sent("plan").length, 1);
    assert.equal(sent("opening").length, 2, "act 1 was written again");
    assert.match(sent("opening")[1].user, /Your last act had these problems\. Write it again, whole, without them:\n- Act 1's beats reach past act 1: they already fight Captain Ivry \(act 2's boss\), Vicar Osseth Ascendant \(act 4's boss\)/);
    assert.deepEqual(rewritten.arc().beats.map((beat) => beat.text), opening.beats.map((beat) => beat.text), "and the act that stays inside act 1 is the one kept");

    // A reply in the older shape, a whole arc with its beats, is still an arc.
    const older = table("Older shape", null);
    requests.length = 0;
    script.plans = [{ premise: plan.premise, antagonist: plan.antagonist, acts: [{ beats: ["The council hires the party", "The ledger is found", "The crypt gate is forced"] }, { beats: ["The cache under the chapel", "The bell is raised again"] }], finale: plan.finale }];
    await generateStoryArc(older.id);
    assert.deepEqual([sent("plan").length, sent("opening").length], [1, 0], "and it costs no second call");
    assert.deepEqual(older.arc().beats.map((beat) => beat.act), [1, 1, 1, 2, 2]);

    // A plan the model garbled is asked for once more.
    const garbled = table("Garbled", null);
    requests.length = 0;
    script.plans = [text(plan).slice(0, 400), plan];
    await generateStoryArc(garbled.id);
    assert.equal(sent("plan").length, 2);
    assert.equal(garbled.arc().saga.title, "The Drowned Crown", "a plan cut short costs one call, not the campaign's spine");

    // An opening act that cannot be read gets one more try; a plan without beats is no arc.
    const unread = table("Unread", null);
    requests.length = 0;
    script.openings = ["I would open with a storm.", opening];
    await generateStoryArc(unread.id);
    assert.equal(sent("opening").length, 2);
    assert.equal(unread.arc().beats.length, 3);
    const lost = table("Lost", null);
    script.openings = ["no", "still no"];
    await generateStoryArc(lost.id);
    assert.equal(lost.arc(), null, "two unreadable acts leave no arc, and the first chapter close plots one");
    ok("a saga is plotted as a plan and then act 1, and either is written once more when its shape is wrong");
  }

  console.log(`test-story-follows-table: ${passed} checks passed`);
} finally {
  server.close();
  removeTempDir(dir);
}
