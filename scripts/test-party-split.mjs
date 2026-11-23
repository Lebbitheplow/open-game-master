// The party split up, kept as a state (issue 951): who is where after each
// move_party, which lines a turn at the scene reads and which wait, when the
// scene cuts to the others, what a call may reach, and what is said.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  awayIdsOf,
  cutDue,
  inScene,
  moveGroups,
  moveNote,
  normalizeAway,
  parseParting,
  partingBlock,
  partingReading,
  PARTING_PROMPT_START,
  normalizeCut,
  placeAway,
  restCredit,
  sceneLines,
  sceneRefusal,
  settleAway,
  splitStateBlock,
  tableLine,
  unanswered,
} = await import("../src/lib/dm/party-split-logic.ts");
const { emptyParty, normalizeParty } = await import("../src/lib/dm/party-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const roster = [
  { id: "k", name: "Kael" },
  { id: "m", name: "Mira" },
  { id: "b", name: "Bram" },
  { id: "t", name: "Tovin" },
];
const members = roster.map((sheet) => sheet.id);
const move = (input) => moveGroups({ away: [], members, from: "The Docks", to: "The Old Mill", named: null, heard: 10, now: 600, ...input });
const docks = { place: "The Docks", ids: ["b", "t"], heard: 10, left: 600 };

test("a party together has nobody away, and a stored party keeps its groups", () => {
  assert.deepEqual(emptyParty().away, []);
  assert.equal(emptyParty().cut, null);
  assert.deepEqual(normalizeParty({}).away, []);
  const stored = normalizeParty({ away: [docks], cut: { at: 12, from: { b: 10 }, behind: 480, clock: 1080 } });
  assert.deepEqual(stored.away, [docks]);
  assert.deepEqual(stored.cut, { at: 12, from: { b: 10 }, behind: 480, clock: 1080 });
});

test("what is unreadable reads as nobody away, and nobody is in two places", () => {
  assert.deepEqual(normalizeAway("nonsense"), []);
  assert.deepEqual(normalizeAway([{ place: "A" }, null, { place: "B", ids: [] }]), []);
  assert.deepEqual(normalizeAway([{ place: "A", ids: ["k", "k"] }, { place: "B", ids: ["k", "m"] }]), [
    { place: "A", ids: ["k"], heard: 0, left: 0 },
    { place: "B", ids: ["m"], heard: 0, left: 0 },
  ]);
  assert.equal(normalizeCut(null), null);
  assert.equal(normalizeCut({ from: { b: 3 } }), null, "a cut with no note is none");
});

test("naming some of a party that is together splits it: the rest stay where the scene was", () => {
  const out = move({ named: ["k", "m"] });
  assert.deepEqual(out.away, [docks]);
  assert.deepEqual(out.went, ["k", "m"]);
  assert.deepEqual(out.stayed, ["b", "t"]);
  assert.deepEqual(out.arrived, {});
  assert.equal(out.followed, true);
  assert.deepEqual(out.emptied, [], "someone is still at the docks, so whoever travels with the party stays");
  assert.equal(out.wasSplit, false);
  assert.equal(out.split, true);
});

test("naming everyone, or nobody while together, is the whole party moving", () => {
  for (const named of [null, [], members]) {
    const out = move({ named });
    assert.deepEqual(out.away, []);
    assert.equal(out.split, false);
    assert.deepEqual(out.emptied, ["The Docks"]);
  }
});

test("while split, a move with no names moves those in the scene and leaves the others where they are", () => {
  const out = move({ away: [docks], from: "The Old Mill", to: "The Mill Cellar" });
  assert.deepEqual(out.went, ["k", "m"]);
  assert.deepEqual(out.stayed, []);
  assert.deepEqual(out.away, [docks]);
  assert.deepEqual(out.emptied, ["The Old Mill"]);
  assert.equal(out.split, true);
});

test("going where the others wait joins them: the split is over", () => {
  const out = move({ away: [docks], from: "The Old Mill", to: "the docks" });
  assert.deepEqual(out.away, []);
  assert.deepEqual(out.arrived, { b: 10, t: 10 });
  assert.equal(out.followed, true);
  assert.equal(out.behind, 0, "those the scene was with are still in it");
  assert.equal(out.wasSplit, true);
  assert.equal(out.split, false);
});

test("naming those elsewhere, at their own place, cuts the scene to them: nobody walked", () => {
  const out = move({ away: [docks], from: "The Old Mill", to: "The Docks", named: ["b", "t"], heard: 20, now: 1080 });
  assert.deepEqual(out.away, [{ place: "The Old Mill", ids: ["k", "m"], heard: 20, left: 1080 }]);
  assert.deepEqual(out.arrived, { b: 10, t: 10 });
  assert.equal(out.followed, false);
  assert.equal(out.behind, 480, "the scene was away from them for eight hours");
  assert.deepEqual(out.emptied, [], "a cut takes nobody along");
  assert.equal(out.origin, null);
});

test("whoever walks on leaves the rest owed what they said since the GM last spoke; a cut leaves the group it was answering", () => {
  const split = move({ named: ["k", "m"], heard: 10, heardHere: 14 });
  assert.equal(split.away[0].heard, 10, "a move the stayers made in this beat still waits");
  const cut = move({ away: [docks], from: "The Old Mill", to: "The Docks", named: ["b", "t"], heard: 20, heardHere: 24 });
  assert.equal(cut.away[0].heard, 24, "the reply being written read every line of theirs");
});

test("naming those elsewhere with the scene's own place brings them here", () => {
  const out = move({ away: [docks], from: "The Old Mill", to: "The Old Mill", named: ["b", "t"] });
  assert.deepEqual(out.away, []);
  assert.deepEqual(out.stayed, []);
  assert.deepEqual(out.arrived, { b: 10, t: 10 });
  assert.equal(out.followed, true);
  assert.deepEqual(out.emptied, ["The Docks"]);
});

test("a move that only afterwards says who came leaves the rest where the scene had just come from", () => {
  // The whole party was moved to the mill; the next call names Kael alone, at the mill.
  const out = move({ from: "The Old Mill", to: "The Old Mill", named: ["k"], back: "The Docks" });
  assert.deepEqual(out.away, [{ place: "The Docks", ids: ["m", "b", "t"], heard: 10, left: 600 }]);
  assert.deepEqual(out.stayed, ["m", "b", "t"]);
  assert.equal(out.stayedAt, "The Docks");
  assert.equal(out.followed, true);
  assert.equal(tableLine(out, "The Old Mill", out.stayedAt, ["k"], roster), "The party splits up: Kael goes to The Old Mill, and Mira, Bram and Tovin stay at The Docks.");
  // Not once the walk is old news, nor when everyone here is named.
  assert.equal(move({ from: "The Old Mill", to: "The Old Mill", named: ["k"] }).split, false);
  assert.equal(move({ from: "The Old Mill", to: "The Old Mill", named: members, back: "The Docks" }).split, false);
  // Nor when the call names someone elsewhere: that brings them here.
  const brought = move({ away: [docks], from: "The Old Mill", to: "The Old Mill", named: ["k", "b"], back: "The Crossroads" });
  assert.deepEqual(brought.away.map((group) => [group.place, group.ids]), [["The Docks", ["t"]]]);
  assert.deepEqual(brought.stayed, []);
});

test("a group elsewhere going somewhere new set out from where it was", () => {
  const out = move({ away: [docks], from: "The Old Mill", to: "The Lighthouse", named: ["b", "t"] });
  assert.equal(out.followed, false);
  assert.equal(out.origin, "The Docks");
  assert.deepEqual(out.emptied, ["The Docks"]);
  assert.deepEqual(out.away.map((group) => [group.place, group.ids]), [["The Old Mill", ["k", "m"]]]);
});

test("one of two away may be named alone, and a third place makes a third group", () => {
  const out = move({ away: [docks], from: "The Old Mill", to: "The Lighthouse", named: ["k", "b"] });
  assert.deepEqual(out.away.map((group) => [group.place, group.ids]), [["The Docks", ["t"]], ["The Old Mill", ["m"]]]);
  assert.deepEqual(out.arrived, { b: 10 });
  assert.equal(out.followed, true);
  assert.equal(out.origin, null);
});

test("stragglers left at a place someone already waits at join that group", () => {
  const out = move({ away: [{ place: "The Old Mill", ids: ["t"], heard: 4, left: 100 }], from: "The Old Mill", to: "The Docks", named: ["k"] });
  assert.deepEqual(out.away, [{ place: "The Old Mill", ids: ["t", "m", "b"], heard: 4, left: 100 }]);
});

test("someone dead, benched or gone holds no place, and a split nobody is left in is over", () => {
  assert.deepEqual(settleAway([docks], ["k", "m", "t"]), [{ ...docks, ids: ["t"] }]);
  assert.deepEqual(settleAway([docks], ["k", "m"]), []);
  const out = move({ away: [docks], members: ["k", "m"], from: "The Old Mill", to: "The Mill Cellar" });
  assert.equal(out.wasSplit, false);
  assert.equal(out.split, false);
});

test("what a spell made is where its maker is", () => {
  const sheets = [...roster, { id: "f", name: "Familiar", summon: { casterId: "b" } }];
  assert.deepEqual([...awayIdsOf([docks], sheets)].sort(), ["b", "f", "t"]);
  assert.deepEqual(inScene([docks], sheets).map((sheet) => sheet.id), ["k", "m"]);
  assert.equal(inScene([], sheets), sheets, "the same list while the party is together");
  assert.equal(placeAway([docks], "f", sheets), "The Docks");
  assert.equal(placeAway([docks], "k", sheets), null);
});

const line = (seq, authorType, characterId, content = "x") => ({ seq, authorType, characterId, content });

test("a move by someone elsewhere, made since the scene left them, is not this turn's to read", () => {
  const history = [line(9, "player", "b", "before the split"), line(10, "dm", null), line(11, "player", "k", "I search the mill."), line(12, "player", "b", "I pick the lock.")];
  const read = sceneLines(history, [docks], null);
  assert.deepEqual(read.lines.map((entry) => entry.seq), [9, 10, 11]);
  assert.deepEqual(read.held.map((entry) => entry.seq), [12]);
  assert.deepEqual(unanswered(read.lines).map((entry) => entry.seq), [11]);
});

test("table talk is answered wherever the scene is", () => {
  const history = [line(10, "dm", null), line(11, "player", "b", "(ooc) how long is a short rest?")];
  assert.deepEqual(sceneLines(history, [docks], null).held, []);
});

test("after a cut, the moves that waited are read after its note, as the newest lines", () => {
  const mill = { place: "The Old Mill", ids: ["k", "m"], heard: 13, left: 600 };
  const cut = { at: 14, from: { b: 10, t: 10 }, behind: 0, clock: 600 };
  const history = [line(10, "dm", null), line(11, "player", "k"), line(12, "player", "b", "I pick the lock."), line(13, "dm", null), line(14, "system", null, "Meanwhile, at The Docks: Bram and Tovin.")];
  const read = sceneLines(history, [mill], cut);
  assert.deepEqual(read.lines.map((entry) => entry.seq), [10, 11, 13, 14, 12]);
  assert.deepEqual(unanswered(read.lines).map((entry) => entry.seq), [12]);
  // Once the reply has come, the transcript reads in the order it was written.
  const answered = [...history, line(15, "dm", null)];
  assert.deepEqual(sceneLines(answered, [mill], cut).lines.map((entry) => entry.seq), [10, 11, 12, 13, 14, 15]);
});

test("a line that came in after the cut stays after the moves that waited", () => {
  const cut = { at: 14, from: { b: 10 }, behind: 0, clock: 600 };
  const history = [line(12, "player", "b"), line(13, "dm", null), line(14, "system", null), line(15, "player", "t")];
  assert.deepEqual(sceneLines(history, [], cut).lines.map((entry) => entry.seq), [13, 14, 12, 15]);
});

test("the scene cuts to the group whose move has waited longest, once those it is with have nothing waiting", () => {
  const table = { fight: false, present: 2 };
  const waiting = [line(10, "dm", null), line(12, "player", "b")];
  assert.equal(cutDue(waiting, [docks], null, table), docks);
  assert.equal(cutDue([line(10, "dm", null)], [docks], null, table), null, "nobody elsewhere has moved");
  assert.equal(cutDue(waiting, [], null, table), null);
  // Those in the scene moved too, since the same reply: they are answered first.
  const both = [line(10, "dm", null), line(11, "player", "k"), line(12, "player", "b")];
  assert.equal(cutDue(both, [docks], null, table), null);
  // Their move has already sat through a reply: it does not wait for another.
  const starved = [line(10, "dm", null), line(12, "player", "b"), line(13, "dm", null), line(14, "player", "k")];
  assert.equal(cutDue(starved, [docks], null, table), docks);
});

test("a fight keeps the scene where it is, and a scene nobody is left in goes to whoever is", () => {
  const waiting = [line(10, "dm", null), line(12, "player", "b")];
  assert.equal(cutDue(waiting, [docks], null, { fight: true, present: 2 }), null);
  assert.equal(cutDue([line(10, "dm", null)], [docks], null, { fight: false, present: 0 }), docks);
});

test("the table reads the split, the cut and the reunion as lines of their own", () => {
  const split = move({ named: ["k", "m"] });
  assert.equal(tableLine(split, "The Old Mill", "The Docks", ["k", "m"], roster), "The party splits up: Kael and Mira go to The Old Mill, and Bram and Tovin stay at The Docks.");
  const scout = move({ named: ["k"] });
  assert.equal(tableLine(scout, "The Old Mill", "The Docks", ["k"], roster), "The party splits up: Kael goes to The Old Mill, and Mira, Bram and Tovin stay at The Docks.");
  const cut = move({ away: [docks], from: "The Old Mill", to: "The Docks", named: ["b", "t"] });
  assert.equal(tableLine(cut, "The Docks", "The Old Mill", ["b", "t"], roster), "Meanwhile, at The Docks: Bram and Tovin.");
  const joined = move({ away: [docks], from: "The Old Mill", to: "The Docks" });
  assert.equal(tableLine(joined, "The Docks", "The Old Mill", members, roster), "The party is together again at The Docks.");
  const some = move({ away: [{ ...docks, ids: ["b"] }, { place: "The Lighthouse", ids: ["t"], heard: 2, left: 5 }], from: "The Old Mill", to: "The Docks" });
  assert.equal(tableLine(some, "The Docks", "The Old Mill", ["k", "m", "b"], roster), "Bram joins the others at The Docks.");
  // A room-to-room move of those in the scene says nothing.
  assert.equal(tableLine(move({ away: [docks], from: "The Old Mill", to: "The Mill Cellar" }), "The Mill Cellar", "The Old Mill", ["k", "m"], roster), "");
  assert.equal(tableLine(move({}), "The Old Mill", "The Docks", members, roster), "");
});

test("the storyteller is told who went, who is elsewhere and that the scene cuts by itself", () => {
  const split = moveNote(move({ named: ["k", "m"] }), "The Old Mill", ["k", "m"], roster);
  assert.match(split, /^The party has split up: Kael and Mira went to The Old Mill, and Bram and Tovin stayed behind\. The scene follows those who went\./);
  assert.match(split, /Elsewhere now: Bram and Tovin at The Docks\. Narrate only this scene; the scene cuts to the others by itself when they act, and going where they are joins them\./);
  const cut = moveNote(move({ away: [docks], from: "The Old Mill", to: "The Docks", named: ["b", "t"] }), "The Docks", ["b", "t"], roster, ["[Bram] I pick the lock."]);
  assert.match(cut, /^The scene has cut to The Docks, with Bram and Tovin\. Elsewhere now: Kael and Mira at The Old Mill\./);
  assert.match(cut, /Waiting on an answer here: \[Bram\] I pick the lock\.$/);
  assert.equal(moveNote(move({ away: [docks], from: "The Old Mill", to: "The Docks" }), "The Docks", members, roster), "The party is back together at The Docks: everyone is in this scene again.");
  assert.equal(moveNote(move({}), "The Old Mill", members, roster), "");
});

test("GAME STATE says who the scene is with only while the party is split", () => {
  assert.equal(splitStateBlock({ here: members, place: "The Docks", away: [], roster }), "");
  const block = splitStateBlock({ here: ["k", "m"], place: "The Old Mill", away: [docks], roster });
  assert.match(block, /^The party is split up\. In this scene, at The Old Mill: Kael and Mira\. Elsewhere: Bram and Tovin at The Docks\./);
  assert.match(block, /Never narrate what the others do: the scene cuts to them by itself when they act\./);
  assert.doesNotMatch(block, /was away from/);
  // What it costs every turn of a split party: well under a hundred tokens
  // at the prompt's four characters a token (context-budget.ts).
  assert.ok(block.length / 4 < 110, `${Math.ceil(block.length / 4)} tokens`);
  const back = splitStateBlock({ here: ["b", "t"], place: "The Docks", away: [{ place: "The Old Mill", ids: ["k", "m"], heard: 1, left: 1 }], roster, behind: 480 });
  assert.match(back, /The scene was away from Bram and Tovin for 8 hours: say briefly how they spent it\. A rest they took in that time passes no more of it\.$/);
  assert.doesNotMatch(splitStateBlock({ here: ["b"], place: "X", away: [docks], roster, behind: 20 }), /was away from/);
});

const elsewhere = [
  { id: "b", name: "Bram", place: "The Docks" },
  { id: "t", name: "Tovin", place: "The Docks" },
];

test("a call that names someone who is not in the scene is refused with the way through", () => {
  const refused = sceneRefusal("request_roll", { characterId: "b", kind: "skill_check" }, elsewhere, "The Old Mill");
  assert.match(refused, /^Bram is not in this scene: the party is split up, and they are at The Docks\. A call reaches only who is in the scene\./);
  assert.match(refused, /cut the scene first with move_party \(name "The Docks", characterIds b\); if they have come here, move_party with name "The Old Mill" and the same characterIds\. Nothing was rolled or spent\.$/);
  // By name, in a list, and in the entries of a list.
  assert.match(sceneRefusal("heal", { casterId: "k", characterId: "Tovin" }, elsewhere, "The Old Mill"), /^Tovin is not in this scene/);
  assert.match(sceneRefusal("cast_buff", { characterId: "k", targetCharacterIds: ["m", "b", "t"] }, elsewhere, "The Old Mill"), /^Bram and Tovin are not in this scene/);
  assert.match(sceneRefusal("heal", { casterId: "k", targets: [{ characterId: "m" }, { characterId: "t" }] }, elsewhere, "The Old Mill"), /^Tovin is not in this scene/);
});

test("a call for those in the scene passes, and so does the bookkeeping that reaches nowhere", () => {
  assert.equal(sceneRefusal("request_roll", { characterId: "k" }, elsewhere, "The Old Mill"), null);
  assert.equal(sceneRefusal("pass_time", { hours: 2 }, elsewhere, "The Old Mill"), null);
  assert.equal(sceneRefusal("request_roll", { characterId: "b" }, [], "The Old Mill"), null, "nobody is elsewhere");
  for (const name of ["move_party", "party_award", "award_xp", "send_whisper", "request_player_input", "update_sheet"]) {
    assert.equal(sceneRefusal(name, { characterId: "b", characterIds: ["b", "t"] }, elsewhere, "The Old Mill"), null, name);
  }
});

test("a rest fits in the time the scene was away until the clock has moved past it", () => {
  const cut = { at: 14, from: {}, behind: 480, clock: 1080 };
  assert.equal(restCredit(cut, 1080), 480);
  assert.equal(restCredit(cut, 1200), 360);
  assert.equal(restCredit(cut, 2000), 0);
  assert.equal(restCredit(null, 1080), 0);
});

const party = roster;
const said = "Bram stays on the quay to keep watch. I leave him there and slip off alone to the chandler's warehouse.";

test("the players' words are asked whether the party parts, in few words", () => {
  const [system, user] = partingReading({ party: ["Avery", "Bram"], place: "The Quay", words: [`[Avery] ${said}`] });
  assert.ok(system.content.startsWith(PARTING_PROMPT_START));
  assert.match(system.content, /When in doubt, nobody parts\./);
  assert.equal(user.content, `The party: Avery, Bram\nThey are at: The Quay\nThe players' words:\n[Avery] ${said}`);
  assert.ok((system.content.length + user.content.length) / 4 < 330, `${Math.ceil((system.content.length + user.content.length) / 4)} tokens: a small read`);
});

test("who stays is held to the party and to words the players wrote, and the place to one they are not at", () => {
  const reply = (stays, to = "") => JSON.stringify({ stays, to });
  assert.deepEqual(parseParting(reply([{ name: "Bram", quote: "Bram stays on the quay" }], "the chandler's warehouse."), party, said, "The Quay"), { ids: ["b"], to: "The chandler's warehouse" });
  assert.deepEqual(parseParting(`Here: ${reply([{ name: "bram", quote: "I leave him there" }])}`, party, said, "The Quay"), { ids: ["b"], to: "" });
  assert.equal(parseParting(reply([]), party, said, "The Quay"), null);
  assert.equal(parseParting(reply([{ name: "Bram", quote: "Bram waits outside" }]), party, said, "The Quay"), null, "words nobody wrote");
  assert.equal(parseParting(reply([{ name: "The innkeeper", quote: "Bram stays on the quay" }]), party, said, "The Quay"), null, "nobody of the party");
  assert.equal(parseParting("not json", party, said, "The Quay"), null);
  assert.equal(parseParting(reply(party.map((sheet) => ({ name: sheet.name, quote: "slip off alone" }))), party, said, "The Quay"), null, "somebody has to go");
  assert.deepEqual(parseParting(reply([{ name: "Bram", quote: "Bram stays on the quay" }], "the quay"), party, said, "The Quay"), { ids: ["b"], to: "" }, "the place they are leaving is no destination");
});

test("the storyteller is told who is not going, and the call that says so", () => {
  const block = partingBlock({ ids: ["b"], to: "", at: 0 }, [party[0], party[2]]);
  assert.equal(
    block,
    `By the players' own words the party parts ways this turn: Bram does not go with Kael. When that one goes anywhere, your first call is move_party with the place and characterIds ["k"]: the server keeps Bram where they are. Narrate only those who go; the scene comes back to the others when they act.`,
  );
  assert.equal(partingBlock({ ids: ["b"], to: "", at: 0 }, [party[0]]), "", "the one it names is not here");
  assert.deepEqual(normalizeParty({ parting: { ids: ["b"], to: "The Warehouse", at: 12 } }).parting, { ids: ["b"], to: "The Warehouse", at: 12 });
  assert.equal(normalizeParty({ parting: { ids: [] } }).parting, null);
});

console.log(`party-split: ${passed} tests passed`);
