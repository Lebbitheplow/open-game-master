// Romantic moves and kindnesses read from the story (issue 641): the claims
// reader reads a bond claim (a flirt, a confession, an ask, a proposal, the
// answer to one, help, a defence) from the players' words and the narration
// in the read it already makes, and the engine settles each pair the GM
// recorded nothing for. A flirt or a kindness the character's own player
// declared is recorded through relationship_beat with every limit it keeps;
// a step is never taken from a reading: an ask nobody answered, an answer no
// roll decided and an answer the story told the other way become a note the
// GM reads next turn. Mid-fight an ask goes to the hold's seam and a
// kindness waits for the fight's end. A connected agent program's narration
// is held to the same, and its deeds are noted as the storyteller's are.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-story-moves");
const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: true } });
const model = await fakeModel();
model.pointAt(world);

const logic = await import("../src/lib/dm/story-moves-logic.ts");
const { checkClaims, claimKindsFor, readerSystem, renderReaderInput } = await import("../src/lib/dm/claims-logic.ts");
const { settleStoryMoves } = await import("../src/lib/dm/story-moves-settle.ts");
const { readAgentNarration } = await import("../src/lib/dm/agent-turn.ts");
const { AGENT_MARK } = await import("../src/lib/dm/agent-mark.ts");
const relationships = await import("../src/lib/db/relationships.ts");
const npcs = await import("../src/lib/db/npcs.ts");
const facts = await import("../src/lib/db/facts.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const { heldStepOf } = await import("../src/lib/db/romance-held.ts");

const bram = world.addHero({ name: "Bram", gender: "Male", abilities: { cha: 16 }, proficiencies: TRAINED });
const EVEN = { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 };
for (const name of ["Lyra", "Old Pike"]) {
  const set = await world.invoke("set_npc", { name, gender: name === "Lyra" ? "Female" : "Male", location: "Highmoor" });
  assert.equal(set.ok, true, set.error);
  npcs.patchNpcAgency(npcs.getNpcByName(world.campaignId, name).id, { personality: EVEN });
}
const bond = (name) => relationships.getRelationship(world.campaignId, bram.id, name);
const setBond = (name, patch) => {
  const row = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: bram.id, characterName: "Bram", subjectKind: "npc", subjectName: name });
  relationships.patchRelationship(row.id, patch);
};
// The ref the request gives each tracked NPC, as claims.ts numbers the cast.
const ref = (name) => `n${npcs.listCastNpcs(world.campaignId).filter((npc) => !npc.archived).findIndex((npc) => npc.name === name) + 1}`;
const note = (name) => facts.listActiveFacts(world.campaignId).find((fact) => fact.subject === `story move bram and ${name.toLowerCase()}`);
const storyCalls = () => {
  const latest = turns.getDmTurn(turns.getLatestDmTurnId(world.campaignId));
  return latest.conversation.flatMap((message) => (message.tool_calls ?? []).filter((entry) => entry.id.startsWith("story_")));
};
const flirt = (quote) => ({ kind: "bond", move: "flirt", by: bram.id, to: ref("Lyra"), quote });

// ---- the reading ----

await test("The bond kind is asked only where relationships are tracked, and listed only on a read that asks it", () => {
  const gate = { guard: true, attacks: false, creatures: false, numbers: false, party: true, rollAsk: false, fightStart: false, unrolled: false, speech: false };
  assert.ok(claimKindsFor({ ...gate, bonds: true }).includes("bond"));
  assert.ok(!claimKindsFor({ ...gate, bonds: false }).includes("bond"));
  assert.ok(!claimKindsFor({ ...gate, guard: false, bonds: true }).includes("bond"), "the outcome check off reads none");
  // Every other read sends what it did before.
  assert.equal(readerSystem([], false), readerSystem([], false, false, null));
  assert.doesNotMatch(readerSystem([], false), /"kind":"bond"/);
  const romance = readerSystem([], false, true, "romance");
  assert.match(romance, /"kind":"bond".*confess \(says they love or desire them\), court \(asks to court them.*help \(does them a real service/);
  assert.match(romance, /anything inside quoted dialogue, numbers included \(a bond excepted: a move or an answer made in words counts\)/);
  assert.match(romance, /"Player's words" holds what each player wrote this turn, after their character's name: it is read only for turn_over and bond/);
  assert.match(romance, /target, caster, by, to and character are a ref/);
  const kindness = readerSystem([], false, true, "kindness");
  assert.match(kindness, /MOVE is one of: help/, "with romance off only the kindnesses are asked");
  assert.doesNotMatch(kindness, /flirt/);
  const input = renderReaderInput(["bond"], { creatures: [], party: [{ ref: "c1", name: "Bram" }], speakers: [], spent: [], people: [{ ref: "n1", name: "Lyra" }] }, "Lyra smiles.", "Narration", "Bram: I wink at Lyra.");
  assert.match(input, /^People refs: "n1" for Lyra$/m);
  assert.match(input, /Player's words:\n<<<\nBram: I wink at Lyra\.\n>>>\n\nNarration:\n<<<\nLyra smiles\.\n>>>/);
  assert.doesNotMatch(renderReaderInput(["hit"], { creatures: [], party: [], speakers: [], spent: [], people: [{ ref: "n1", name: "Lyra" }] }, "x", "Narration", "Bram: hi"), /People refs|Player's words/);
});

await test("A bond claim names two listed people and quotes the narration or a player's words; a kindness only the narration", () => {
  const context = {
    kinds: ["bond", "hit"],
    text: '"Yes," Lyra whispers. Bram hauls the nets for Old Pike.',
    attackRefs: new Set(),
    creatureRefs: new Set(),
    party: new Map([[bram.id, "Bram"]]),
    leveledSpells: new Set(),
    normalizeSpell: (name) => name,
    skills: new Set(),
    spent: new Map(),
    speakers: new Map(),
    companions: new Set(),
    people: new Map([["n1", "Lyra"], ["n2", "Old Pike"]]),
    words: [{ characterId: bram.id, name: "Bram", text: "Lyra, I want us to be together." }],
  };
  const kept = checkClaims(
    [
      { kind: "bond", move: "accept", by: "n1", to: bram.id, quote: "Yes" },
      { kind: "bond", move: "court", by: bram.id, to: "n1", quote: "I want us to be together" },
      { kind: "bond", move: "help", by: bram.id, to: "n2", quote: "Bram hauls the nets for Old Pike" },
      // Invented: a quote neither passage holds, an unlisted ref, one person.
      { kind: "bond", move: "flirt", by: bram.id, to: "n1", quote: "Bram kisses her hand" },
      { kind: "bond", move: "flirt", by: bram.id, to: "n9", quote: "Yes" },
      { kind: "bond", move: "flirt", by: "n1", to: "n1", quote: "Yes" },
      // A kindness only a player's words tell is a plan.
      { kind: "bond", move: "help", by: bram.id, to: "n1", quote: "I want us to be together" },
      // Another kind may not quote the players' words.
      { kind: "hit", target: "goblin", quote: "I want us to be together" },
    ],
    context,
  );
  assert.deepEqual(
    kept.map((claim) => `${claim.move}:${claim.by.name}>${claim.to.name}:${claim.said === bram.id ? "said" : "told"}`),
    ["accept:Lyra>Bram:told", "court:Bram>Lyra:said", "help:Bram>Old Pike:told"],
  );
});

await test("The pair rules: a step is never taken from a reading, and a beat only from the player's own declaration", () => {
  const pair = { characterId: "c1", character: "Bram", subject: "Lyra" };
  const none = { recorded: false, step: null, npcMove: false };
  const courting = { romance: "courting", status: "active", openToAdvances: false };
  const calm = { fight: false, romance: true, record: true };
  const on = (move, extra = {}) => ({ move, byCharacter: true, quote: "q", declared: true, ...extra });
  assert.deepEqual(logic.settlePair(pair, [on("flirt")], none, courting, calm), [{ kind: "record", beat: "flirt", quote: "q" }]);
  assert.equal(logic.settlePair(pair, [on("flirt", { declared: false })], none, courting, calm)[0].kind, "note", "undeclared: a note");
  assert.equal(logic.settlePair(pair, [on("flirt")], none, courting, { ...calm, record: false })[0].kind, "note", "where the engine does not own the turn: a note");
  assert.deepEqual(logic.settlePair(pair, [on("flirt")], { ...none, recorded: true }, courting, calm), [], "the GM recorded the pair");
  assert.deepEqual(logic.settlePair(pair, [on("flirt")], none, courting, { ...calm, romance: false }), [], "romance off");
  assert.deepEqual(logic.settlePair(pair, [on("defend"), on("flirt")], none, courting, calm).map((entry) => entry.beat), ["defended"], "one beat a pair, the weightier");
  const ask = logic.settlePair(pair, [on("propose")], none, courting, calm);
  assert.equal(ask.length, 1);
  assert.match(ask[0].text, /^Bram proposed to Lyra, and no romance_advance answered it\. The next step is together\. From openly courting that is not yet a betrothal\./);
  assert.deepEqual(logic.settlePair(pair, [on("court")], none, { ...courting, status: "ended" }, calm), [], "a finished bond takes nothing");
  const fight = logic.settlePair(pair, [on("court"), on("defend")], none, courting, { ...calm, fight: true });
  assert.deepEqual(fight.map((entry) => `${entry.kind}:${entry.to ?? entry.afterFight}`), ["hold:together", "note:true"]);
  const npcMove = logic.settlePair(pair, [{ move: "confess", byCharacter: false, quote: "q", declared: false }], none, courting, calm);
  assert.match(npcMove[0].text, /has not opened Bram to advances, so no NPC makes that move/);
});

// ---- at an AI table ----

await test("A flirt the player declared and the GM left unrecorded is recorded by the engine, with its roll, and the GM is told next turn", async () => {
  setBond("Lyra", { approval: 30, romance: "none" });
  const before = bond("Lyra").approval;
  model.script([reply({ text: "Lyra laughs, a bright and surprised sound, and tucks a strand of hair behind her ear." })]);
  model.claims([[flirt("Your laugh is the best sound in Highmoor")]]);
  world.dice(15);
  await model.turn(world, 'I grin at Lyra. "Your laugh is the best sound in Highmoor."', bram.id);
  world.clearDice();
  const asked = model.readerRequests[0]?.messages.at(-1)?.content ?? "";
  assert.match(asked, /^Ask: .*\bbond\b/m, "the reply's read asks for bonds");
  assert.match(asked, new RegExp(`^People refs: "${ref("Lyra")}" for Lyra$`, "m"));
  assert.match(asked, /Player's words:\n<<<\nBram: I grin at Lyra\./);
  assert.match(model.readerRequests[0].messages[0].content, /"kind":"bond"/);
  assert.equal(storyCalls().length, 1, "one relationship_beat, beside the turn's own calls");
  assert.ok(bond("Lyra").approval > before, "the flirt landed on the meter");
  assert.match(note("Lyra")?.fact ?? "", /^No tool recorded it, so the server did, from the story \(persuasion 1\d against DC \d+: \w+\): Bram flirted with Lyra\./);
  assert.equal(note("Lyra").knownBy, "dm");
});

await test("An ask the GM narrated around is a note naming the step, and no step is taken; last turn's note expires", async () => {
  const flirted = note("Lyra");
  setBond("Lyra", { approval: 74, romance: "courting" });
  model.script([reply({ text: "Lyra's eyes go wide, and she squeezes your hand without a word." })]);
  model.claims([[{ kind: "bond", move: "court", by: bram.id, to: ref("Lyra"), quote: "I want us to be together" }]]);
  await model.turn(world, "Lyra, I want us to be together.", bram.id);
  assert.equal(bond("Lyra").romance, "courting", "a reading never moves a bond a rung");
  assert.equal(facts.getFactById(flirted.id).status, "retired", "the flirt's note had its turn");
  assert.match(note("Lyra")?.fact ?? "", /^Bram asked Lyra for more between them, and no romance_advance answered it\. The next step is together\..*call romance_advance for Bram and Lyra \(to: together\) before narrating it/);
});

await test("Answering the ask through the tool settles the note; a yes the dice refused but the story told is flagged", async () => {
  setBond("Lyra", { approval: 74, romance: "courting", lastShiftTurn: "" });
  model.script([
    reply({ calls: [call("romance_advance", { characterId: bram.id, subject: "Lyra", to: "together" })] }),
    reply({ text: '"Yes," Lyra breathes. "Yes, I want that too."' }),
  ]);
  model.claims([[{ kind: "bond", move: "accept", by: ref("Lyra"), to: bram.id, quote: "Yes, I want that too." }]]);
  world.dice(1);
  await model.turn(world, "I wait for her answer.", bram.id);
  world.clearDice();
  assert.equal(bond("Lyra").romance, "courting", "the die said no");
  assert.match(note("Lyra")?.fact ?? "", /^romance_advance did not take Bram and Lyra further \(Lyra said no\), but the narration had Lyra say yes\. Nothing changed between them/);
});

await test("A yes no roll decided is flagged, and the bond stays where it was", async () => {
  setBond("Lyra", { approval: 74, romance: "courting", lastShiftTurn: "" });
  model.script([reply({ text: 'Lyra kisses you softly. "Yes. Partners, then."' })]);
  model.claims([[{ kind: "bond", move: "accept", by: ref("Lyra"), to: bram.id, quote: "Yes. Partners, then." }]]);
  await model.turn(world, "Lyra, will you be my partner?", bram.id);
  assert.equal(bond("Lyra").romance, "courting");
  assert.match(note("Lyra")?.fact ?? "", /^The narration had Lyra say yes to Bram, but no romance_advance ran, so nothing changed between them: that answer is the server's\. Call romance_advance for Bram and Lyra \(to: together\)/);
});

await test("Help the player declared is recorded once a turn, and repeating it counts for less", async () => {
  setBond("Old Pike", { approval: 10 });
  const deltas = [];
  for (let round = 0; round < 3; round += 1) {
    const before = bond("Old Pike").approval;
    model.script([reply({ text: "You and Old Pike haul the dripping nets up the shingle together, and he grunts his thanks." })]);
    model.claims([[{ kind: "bond", move: "help", by: bram.id, to: ref("Old Pike"), quote: "You and Old Pike haul the dripping nets up the shingle together" }]]);
    await model.turn(world, "I help Old Pike haul his nets up the shingle.", bram.id);
    deltas.push(bond("Old Pike").approval - before);
  }
  assert.deepEqual(deltas, [6, 4, 2], "relationship_beat's repeats, as a recorded beat");
  assert.match(note("Old Pike")?.fact ?? "", /Bram helped Old Pike\./);
});

await test("A flirt only the narration shows is a note, and a pair the GM recorded is left alone", async () => {
  setBond("Lyra", { approval: 40, romance: "interested", lastShiftTurn: "" });
  const before = bond("Lyra").approval;
  model.script([reply({ text: "Bram leans on the bar and winks at Lyra, who rolls her eyes and smiles anyway." })]);
  model.claims([[flirt("winks at Lyra")]]);
  await model.turn(world, "I wander over to the bar.", bram.id);
  assert.equal(bond("Lyra").approval, before, "an undeclared flirt moves nothing");
  assert.equal(storyCalls().length, 0);
  assert.match(note("Lyra")?.fact ?? "", /^The story showed Bram flirt with Lyra, and no relationship_beat recorded it\./);

  model.script([reply({ calls: [call("relationship_beat", { characterId: bram.id, subject: "Lyra", beat: "compliment" })] }), reply({ text: "Lyra flushes at the compliment and looks away, smiling." })]);
  model.claims([[flirt("I tell Lyra she is the finest sight in Highmoor")]]);
  world.dice(15);
  await model.turn(world, "I tell Lyra she is the finest sight in Highmoor.", bram.id);
  world.clearDice();
  assert.equal(storyCalls().length, 0, "the GM's own beat stands alone");
  assert.equal(note("Lyra"), undefined, "nothing to say");
});

await test("Mid-fight an ask is held for its answer after the fight (issue 640), and a defence waits for the fight to end, then for one exchange", async () => {
  setBond("Lyra", { approval: 74, romance: "courting", lastShiftTurn: "" });
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  const turn = turns.createDmTurn(world.campaignId, [], "ai");
  const claims = [
    { kind: "bond", move: "defend", by: { ref: bram.id, name: "Bram", side: "pc" }, to: { ref: ref("Lyra"), name: "Lyra", side: "npc" }, quote: "Bram throws himself between the goblin and Lyra", said: null },
    { kind: "bond", move: "court", by: { ref: bram.id, name: "Bram", side: "pc" }, to: { ref: ref("Lyra"), name: "Lyra", side: "npc" }, quote: "marry me when this is over", said: bram.id },
  ];
  settleStoryMoves(world.campaign(), { turn, sheets: world.sheets(), claims, record: true });
  const waiting = () => facts.listActiveFacts(world.campaignId).find((fact) => fact.subject === "story move after the fight bram and lyra");
  const held = heldStepOf(bond("Lyra").id);
  assert.equal(held?.to, "together", "the ask is held on the bond, as one the GM recorded would be");
  assert.equal(held?.source, "claim");
  assert.equal(held?.note, "marry me when this is over");
  assert.doesNotMatch(waiting()?.fact ?? "", /asked Lyra/, "a held ask needs no note of its own");
  assert.match(waiting()?.fact ?? "", /stood up for Lyra mid-fight, and relationship_beat takes only deeds until the fight is over/);
  settleStoryMoves(world.campaign(), { turn: turns.createDmTurn(world.campaignId, [], "ai"), sheets: world.sheets(), claims: [], record: true });
  assert.ok(waiting(), "kept while the fight runs");
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.match(ended.result.answerOwed ?? "", /Lyra/, "the fight's end tells the GM the held ask is owed its answer");
  settleStoryMoves(world.campaign(), { turn: turns.createDmTurn(world.campaignId, [], "ai"), sheets: world.sheets(), claims: [], record: true });
  assert.equal(waiting(), undefined);
  assert.match(note("Lyra")?.fact ?? "", /mid-fight/, "written again for the exchange after the fight");
  settleStoryMoves(world.campaign(), { turn: turns.createDmTurn(world.campaignId, [], "ai"), sheets: world.sheets(), claims: [], record: true });
  assert.equal(note("Lyra"), undefined, "and gone after it");
});

// ---- a connected agent program ----

await test("An agent program's narration notes the deeds it shows and the moves nobody recorded", async () => {
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", alignment: "LG", personality: "Stern.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  setBond("Lyra", { approval: 40, romance: "interested", lastShiftTurn: "" });
  turns.createDmTurn(world.campaignId, [{ role: "user", content: AGENT_MARK }]);
  model.claims([
    [
      { kind: "deed", actor: bram.id, deed: "freed_captives", quote: "Bram cuts the ropes from the prisoners" },
      { kind: "bond", move: "accept", by: ref("Lyra"), to: bram.id, quote: "Lyra says yes" },
    ],
  ]);
  const read = await readAgentNarration(world.campaign(), "Bram cuts the ropes from the prisoners while Seren keeps watch. Later, by the fire, Lyra says yes.");
  assert.equal(read.problem, null);
  assert.ok(facts.listActiveFacts(world.campaignId).some((fact) => fact.subject === "unrecorded deed bram"), "the deed the agent showed is noted");
  assert.match(note("Lyra")?.fact ?? "", /^The narration had Lyra say yes to Bram, but no romance_advance ran/);
});

model.close();
finish();
