// Romance is exclusive by default (issue 642): a character with a partner is
// not courted by someone new and courts nobody new, an NPC makes no first
// move on them (nor while spoken for), unless everyone in it is open to more
// than one partner (the "Drawn to" trait); a flirt with someone else in
// front of a partner is a deed that partner judges; and an amends repairs at
// most what wrongs cost the bond, so an apology never nets a gain.
//
// The pure rules first (romance-exclusive-logic.ts, amends-logic.ts and the
// trait in attraction.ts), then the engine end to end through the tools the
// GM and the console call, with the dice under the test's control.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-romance-exclusive");
const logic = await import("../src/lib/dm/romance-exclusive-logic.ts");
const amends = await import("../src/lib/dm/amends-logic.ts");
const attraction = await import("../src/lib/attraction.ts");

// ---- the pure rules ----

const lover = (name, open = false) => ({ name, open });

await test("nobody spoken for elsewhere may court; a partner elsewhere stops it, both ways, with the reason", () => {
  assert.equal(logic.exclusiveProblem({ a: lover("Tamsin"), b: lover("Bram"), aPartners: [], bPartners: [] }), null);
  assert.equal(
    logic.exclusiveProblem({ a: lover("Tamsin"), b: lover("Bram"), aPartners: [lover("Sir Hollis")], bPartners: [] }),
    "Tamsin is with Sir Hollis; neither is open to another partner.",
  );
  assert.equal(
    logic.exclusiveProblem({ a: lover("Kit"), b: lover("Mira"), aPartners: [], bPartners: [lover("Ash")] }),
    "Mira is with Ash; neither is open to another partner.",
    "courting someone else's partner is the same refusal",
  );
  assert.match(logic.exclusiveProblem({ a: lover("Tamsin", true), b: lover("Bram"), aPartners: [lover("Sir Hollis")], bPartners: [] }), /who is not open/);
  assert.match(logic.exclusiveProblem({ a: lover("Tamsin"), b: lover("Bram"), aPartners: [lover("Sir Hollis", true)], bPartners: [] }), /Tamsin is with Sir Hollis and is not open/);
  assert.match(
    logic.exclusiveProblem({ a: lover("Tamsin", true), b: lover("Bram"), aPartners: [lover("Sir Hollis", true)], bPartners: [] }),
    /Bram is not open to a romance beside theirs/,
    "the newcomer must be open too",
  );
  assert.equal(
    logic.exclusiveProblem({ a: lover("Tamsin", true), b: lover("Bram", true), aPartners: [lover("Sir Hollis", true)], bPartners: [] }),
    null,
    "everyone open lets it start",
  );
});

await test("partners are together and beyond; a courtship binds nobody yet", () => {
  assert.equal(logic.spokenFor({ romance: "courting", status: "active" }), false);
  assert.equal(logic.spokenFor({ romance: "together", status: "active" }), true);
  assert.equal(logic.spokenFor({ romance: "married", status: "parted" }), true, "a partner away is still a partner");
  assert.equal(logic.spokenFor({ romance: "married", status: "ended" }), false);
});

await test("a partner minds a flirt elsewhere unless both of them are open", () => {
  const hollis = lover("Sir Hollis");
  assert.deepEqual(logic.partnersWhoMind(lover("Tamsin"), [hollis]), [hollis]);
  assert.deepEqual(logic.partnersWhoMind(lover("Tamsin", true), [hollis]), [hollis], "only one of them open");
  assert.deepEqual(logic.partnersWhoMind(lover("Tamsin", true), [lover("Sir Hollis", true)]), []);
  assert.equal(logic.unfaithfulSeverity("married"), "serious");
});

await test("an amends repairs at most what is owed, and spends it", () => {
  assert.equal(amends.amendsDelta(6, 8), 6);
  assert.equal(amends.amendsDelta(6, 2), 2, "never past the loss");
  assert.equal(amends.amendsDelta(6, 0), 0, "nothing owed, nothing gained");
  assert.equal(amends.amendsDelta(-1, 0), -1, "a cost passes untouched");
  assert.equal(amends.owedAfter(0, -8), 8);
  assert.equal(amends.owedAfter(8, 6, true), 2);
  assert.equal(amends.owedAfter(8, 5), 8, "a gift is not a repair");
  assert.equal(amends.owedAfter(195, -25), amends.OWED_MAX);
});

await test("open to more than one partner is kept only when on, and the GM's word sets it", async () => {
  assert.deepEqual(attraction.normalizeAttraction({ genders: ["Male"], note: "", open: true }), { genders: ["Male"], note: "", open: true });
  assert.deepEqual(attraction.normalizeAttraction({ genders: ["Male"], note: "", open: false }), { genders: ["Male"], note: "" }, "absent is exclusive");
  assert.equal(attraction.attractionJson({ genders: [], note: "", open: true }), '{"genders":[],"note":"","open":true}', "open alone still stores");
  assert.equal(attraction.attractionJson({ genders: [], note: "" }), "");
  assert.deepEqual(attraction.attractionFromTold(["men", "open relationships"]), { genders: ["Male"], note: "", open: true });
  assert.ok(attraction.TOLD_ATTRACTION.includes(attraction.TOLD_OPEN), "the DM's tools offer the word");
  const kept = attraction.keptAttraction({ genders: ["Male"], note: "" }, { genders: ["Female"], note: "", open: true });
  assert.deepEqual(kept, { genders: ["Male"], note: "", open: true }, "who they are drawn to stays; openness may still turn on");
  assert.deepEqual(attraction.keptAttraction({ genders: [], note: "", open: true }, { genders: ["Female"], note: "" }), { genders: ["Female"], note: "", open: true });
  // The builder's save and the sheet routes read it through this schema.
  const { attractionSchema } = await import("../src/lib/schemas/sheet.ts");
  assert.equal(attractionSchema.parse({ genders: ["Male"], open: true }).open, true);
});

// ---- the engine ----

const world = await openWorld();
const relationships = await import("../src/lib/db/relationships.ts");
const sheetsDb = await import("../src/lib/db/sheets.ts");
const npcs = await import("../src/lib/db/npcs.ts");
const proposals = await import("../src/lib/db/item-proposals.ts");
const advances = await import("../src/lib/db/advances.ts");
const { tickAdvances, advanceDirectorNotes } = await import("../src/lib/dm/advance-tick.ts");
const { exclusiveLinesForPrompt, unfaithfulMove } = await import("../src/lib/dm/romance-exclusive.ts");
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const { npcRosterForPrompt } = await import("../src/lib/dm/social-tools.ts");

const tamsin = world.addHero({ name: "Tamsin", gender: "Female", abilities: { cha: 16 } });
const kit = world.addHero({ name: "Kit", gender: "Male", abilities: { cha: 16 } });
const ash = world.addHero({ name: "Ash", gender: "Female" });

for (const [name, gender] of [["Sir Hollis", "Male"], ["Bram", "Male"], ["Mira", "Female"], ["Orrin", "Male"], ["Wren", "Female"]]) {
  await world.invoke("set_npc", { name, gender, location: "Highmoor" });
}
const pair = (sheet, subject) => relationships.getRelationship(world.campaignId, sheet.id, subject);
function bond(sheet, subject, approval, romance = "none") {
  const row = relationships.ensureRelationship({
    campaignId: world.campaignId,
    characterId: sheet.id,
    characterName: sheet.name,
    subjectKind: "npc",
    subjectName: subject,
  });
  return relationships.patchRelationship(row.id, { approval, romance });
}
const advance = (sheet, subject, to = "interested", initiator = "player") => world.invoke("romance_advance", { characterId: sheet.id, subject, to, initiator });
const beat = (sheet, subject, name, extra = {}) => world.invoke("relationship_beat", { characterId: sheet.id, subject, beat: name, ...extra });

bond(tamsin, "Sir Hollis", 80, "married");
bond(ash, "Mira", 75, "together");

await test("a married character courts nobody new: the step is refused with who and why", async () => {
  bond(tamsin, "Bram", 60);
  const step = await advance(tamsin, "Bram");
  assert.equal(step.ok, false, "refused");
  assert.equal(step.refused, "rules");
  assert.match(step.error, /Tamsin is with Sir Hollis; neither is open to another partner/);
  assert.equal(pair(tamsin, "Bram").romance, "none");
});

await test("nobody courts someone else's partner, NPC or companion", async () => {
  bond(kit, "Mira", 60);
  const step = await advance(kit, "Mira");
  assert.equal(step.ok, false);
  assert.match(step.error, /Mira is with Ash; neither is open to another partner/);
  assert.equal(pair(kit, "Mira").romance, "none");
});

await test("a partner's own romance still goes on", async () => {
  bond(ash, "Mira", 95, "together");
  const step = await advance(ash, "Mira", "betrothed");
  assert.equal(step.ok, true, step.error);
  assert.equal(pair(ash, "Mira").romance, "betrothed");
});

await test("no NPC is offered a first move on a married character, and the GM's move is refused", async () => {
  sheetsDb.setOpenToAdvances(tamsin.id, true);
  relationships.patchRelationship(pair(tamsin, "Bram").id, { advanceCooldownUntil: 0, advanceReadyUntil: 0 });
  while (advances.getAiTurns(world.campaignId) < 8) {
    advances.bumpAiTurns(world.campaignId);
  }
  world.clearDice();
  world.dice(1, 1, 1);
  tickAdvances(world.campaign(), 8, "Bram waits by the well.");
  world.clearDice();
  assert.equal(pair(tamsin, "Bram").advanceReadyUntil, 0, "the roll never offers it");
  // A window opened before she was spoken for: the cue goes, and the move is refused.
  relationships.patchRelationship(pair(tamsin, "Bram").id, { advanceReadyUntil: 11 });
  assert.ok(!advanceDirectorNotes(world.campaign()).some((note) => note.includes("Bram")), "no cue for Bram");
  const move = await advance(tamsin, "Bram", "courting", "npc");
  assert.equal(move.ok, false);
  assert.match(move.error, /Tamsin is with Sir Hollis; neither is open to another partner/);
  assert.equal(proposals.listOpenItemProposals(world.campaignId).filter((row) => row.toolName === "romance_advance").length, 0);
});

await test("a partnered NPC makes no first move on anyone", async () => {
  sheetsDb.setOpenToAdvances(kit.id, true);
  relationships.patchRelationship(pair(kit, "Mira").id, { advanceReadyUntil: 11 });
  const move = await advance(kit, "Mira", "courting", "npc");
  assert.equal(move.ok, false);
  assert.match(move.error, /Mira is with Ash/);
});

await test("the GM is told who is spoken for, briefly, and who is open", async () => {
  const [line] = exclusiveLinesForPrompt(world.campaignId);
  assert.match(line, /^Spoken for, and exclusive: /);
  assert.match(line, /Tamsin \(with Sir Hollis\)/);
  assert.match(line, /Ash \(with Mira\)/);
  assert.match(line, /a flirt with anyone else in front of their partner is a deed that partner judges/);
});

await test("a flirt in front of a partner is a deed the partner judges; out of sight it is not", async () => {
  const before = pair(tamsin, "Sir Hollis").approval;
  world.dice(15);
  const seen = await beat(tamsin, "Orrin", "flirt", { witnesses: ["Sir Hollis"] });
  world.clearDice();
  assert.equal(seen.ok, true, seen.error);
  assert.match(seen.result.note, /Sir Hollis saw Tamsin flirt with Orrin, and it hurts/);
  assert.equal(seen.result.partners?.[0]?.subject, "Sir Hollis");
  const after = pair(tamsin, "Sir Hollis");
  assert.equal(after.approval, before - 8, "a serious deed against their marriage");
  assert.equal(after.owed, 8, "and something to make amends for");

  // Named in what the table was just told, they are there too.
  world.say("player", "Tamsin leans close to Wren and laughs, while Sir Hollis looks on from the bar.", world.sheet(tamsin.id));
  world.dice(15);
  const told = await beat(tamsin, "Wren", "flirt");
  world.clearDice();
  assert.equal(told.ok, true, told.error);
  assert.equal(pair(tamsin, "Sir Hollis").approval, before - 16);

  // A new narration where he is not: he did not see it.
  world.say("dm", "The market is loud and bright.");
  world.dice(15);
  const unseen = await beat(tamsin, "Orrin", "flirt");
  world.clearDice();
  assert.equal(unseen.ok, true, unseen.error);
  assert.match(unseen.result.note, /Tamsin is with Sir Hollis, who did not see it/);
  assert.equal(pair(tamsin, "Sir Hollis").approval, before - 16);
});

await test("the seam says who would mind before anything lands", async () => {
  const move = unfaithfulMove(world.campaign(), world.sheet(tamsin.id), "Orrin", { narration: "Sir Hollis is right there." });
  assert.equal(move.unfaithful, true);
  assert.deepEqual(move.mind.map((entry) => [entry.name, entry.present]), [["Sir Hollis", true]]);
  assert.equal(unfaithfulMove(world.campaign(), world.sheet(tamsin.id), "Sir Hollis").unfaithful, false, "a move toward the partner is no infidelity");
});

await test("an amends repairs the loss and no more, so the episode never comes out ahead", async () => {
  const start = pair(tamsin, "Sir Hollis");
  relationships.patchRelationship(start.id, { owed: 8, beats: {} });
  const first = await beat(tamsin, "Sir Hollis", "amends");
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.approvalChange, 6);
  const second = await beat(tamsin, "Sir Hollis", "amends");
  assert.equal(second.result.approvalChange, 2, "only what was still owed");
  const third = await beat(tamsin, "Sir Hollis", "amends");
  assert.equal(third.result.approvalChange, 0);
  assert.match(third.result.note, /the amends changes nothing/);
  assert.equal(pair(tamsin, "Sir Hollis").approval, start.approval + 8, "back where the flirt found them, never past it");
});

await test("an apology with nothing to apologise for buys nothing", async () => {
  bond(kit, "Orrin", 20);
  const apology = await beat(kit, "Orrin", "amends");
  assert.equal(apology.ok, true, apology.error);
  assert.equal(apology.result.approvalChange, 0);
  assert.equal(pair(kit, "Orrin").approval, 20);
});

await test("an insult then amends nets nothing above where it started", async () => {
  bond(kit, "Bram", 30);
  await beat(kit, "Bram", "insult");
  const fixed = await beat(kit, "Bram", "amends");
  assert.equal(fixed.ok, true, fixed.error);
  assert.ok(pair(kit, "Bram").approval <= 30, `at most where it started, got ${pair(kit, "Bram").approval}`);
});

await test("everyone open lets a second romance start, and nobody minds the flirt", async () => {
  const pip = world.addHero({ name: "Pip", gender: "Female", attraction: { genders: [], note: "", open: true } });
  assert.equal(world.sheet(pip.id).attraction.open, true, "the trait is kept on the sheet");
  assert.match(describeSheet(world.sheet(pip.id), "pip", false, { romance: true }), /Open to more than one partner/);
  await world.invoke("set_npc", { name: "Corin", gender: "Male", drawnTo: ["women"] });
  await world.invoke("set_npc", { name: "Corin", drawnTo: ["women", "open relationships"] });
  assert.deepEqual(npcs.getNpcByName(world.campaignId, "Corin").attraction, { genders: ["Female"], note: "", open: true }, "openness added after the first answer");
  assert.match(npcRosterForPrompt(world.campaignId, { romance: true }).find((npc) => npc.name === "Corin").identity, /open to more than one partner/);
  bond(pip, "Corin", 80, "together");
  bond(pip, "Bram", 60);
  const closed = await advance(pip, "Bram");
  assert.match(closed.error ?? "", /Pip is with Corin, and Bram is not open to a romance beside theirs/, "Bram is not open yet");
  await world.invoke("set_npc", { name: "Bram", drawnTo: ["open relationships"] });
  const open = await advance(pip, "Bram");
  assert.equal(open.ok, true, open.error);
  assert.equal(pair(pip, "Bram").romance, "interested");
  const before = pair(pip, "Corin").approval;
  world.dice(15);
  const flirt = await beat(pip, "Bram", "flirt", { witnesses: ["Corin"] });
  world.clearDice();
  assert.equal(flirt.ok, true, flirt.error);
  assert.equal(pair(pip, "Corin").approval, before, "both open: Corin does not mind");
  assert.match(exclusiveLinesForPrompt(world.campaignId)[0], /Open to more than one partner, both of them: Pip and Corin/);
});

await test("the partner's reaction is the server's: no tool offers it", async () => {
  const sent = await beat(kit, "Bram", "unfaithful");
  assert.equal(sent.ok, false);
  assert.match(sent.error, /Unknown beat|must be one of/);
  assert.doesNotMatch(sent.error, /unfaithful/, "and it is not listed");
});

world.close();
finish();
