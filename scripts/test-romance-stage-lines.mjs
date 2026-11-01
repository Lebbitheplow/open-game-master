// Issue 640: in two playtests the table never once heard of a romance stage
// changing, a wedding included, and a romance that slipped back did so in
// silence, with nothing in the GM's note either. Every rung that moves, up or
// down, now posts a table line at AI-run and person-run tables alike, below
// the narration that caused it, and a slip tells whoever made the call. It
// follows the table's romance setting and its safety lines; a death and a
// parting move no rung and post nothing. Found beside it: a social check that
// bullied someone below a rung's grace left the romance where it stood.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-romance-stage-lines");
const relationships = await import("../src/lib/db/relationships.ts");
const npcs = await import("../src/lib/db/npcs.ts");
const messages = await import("../src/lib/db/messages.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { listRecentEventsForCampaign } = await import("../src/lib/db/character-events.ts");
const { rungChange, rungLine, cooledNote, romanceLinesAllowed } = await import("../src/lib/dm/romance-stage-logic.ts");

const NEUTRAL = { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 };

// Vex and an NPC at a rung and a meter, with no personality to bend a beat.
async function pair({ gameSettings = {}, name = "Ivo", romance = "courting", approval = 60, attitude = "friendly" } = {}) {
  const world = await openWorld({ gameSettings });
  const hero = world.addHero({ name: "Vex", gender: "Female" });
  const set = await world.invoke("set_npc", { name, gender: "Male", attitude });
  assert.equal(set.ok, true, set.error);
  npcs.patchNpcAgency(npcs.getNpcByName(world.campaignId, name).id, { personality: NEUTRAL });
  const row = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: hero.id, characterName: hero.name, subjectKind: "npc", subjectName: name });
  relationships.patchRelationship(row.id, { romance, approval });
  const bond = () => relationships.getRelationship(world.campaignId, hero.id, name);
  const lines = () => messages.listAllMessages(world.campaignId).filter((message) => message.authorType === "system").map((message) => message.content);
  return { world, hero, bond, lines };
}

// ---- the rules ----

await test("a rung that moves is up, down or over; a death, a parting and an ended bond say nothing", () => {
  const at = (romance, status = "active", died = false) => ({ romance, status, died });
  assert.deepEqual(rungChange(at("courting"), at("together")), { kind: "up", to: "together" });
  assert.deepEqual(rungChange(at("together"), at("interested")), { kind: "down", from: "together", to: "interested" });
  assert.deepEqual(rungChange(at("courting"), at("courting", "ended")), { kind: "over", from: "courting" });
  assert.equal(rungChange(at("married"), at("married", "ended", true)), null, "a death is the story's moment");
  assert.equal(rungChange(at("courting"), at("courting", "parted")), null, "a parting leaves the rung");
  assert.equal(rungChange(at("courting", "ended"), at("none", "ended")), null, "an ended bond says nothing more");
  assert.equal(rungChange(at("none"), at("none", "ended")), null, "no romance, nothing to end");
  assert.equal(rungChange(at("courting"), at("courting")), null);
});

await test("the table's words: a step as the Log words it, a slip, an end; the GM is told of a slip", () => {
  const steps = (stage) => `Vex and Ivo stepped to ${stage}`;
  assert.equal(rungLine({ kind: "up", to: "married" }, "Vex", "Ivo", steps), "Vex and Ivo stepped to married.");
  assert.equal(rungLine({ kind: "down", from: "courting", to: "interested" }, "Vex", "Ivo", steps), "Things have cooled between Vex and Ivo: they are no longer courting.");
  assert.equal(rungLine({ kind: "down", from: "interested", to: "none" }, "Vex", "Ivo", steps), "Things have cooled between Vex and Ivo: they are no longer drawn to each other.");
  assert.equal(rungLine({ kind: "over", from: "together" }, "Vex", "Ivo", steps), "The romance between Vex and Ivo is over.");
  assert.match(cooledNote({ kind: "down", from: "together", to: "courting" }, "Vex", "Ivo"), /^The romance between Vex and Ivo has cooled: they are no longer partners \(now openly courting\)\. The table was told/);
  assert.equal(cooledNote({ kind: "up", to: "together" }, "Vex", "Ivo"), null);
});

await test("lines follow the table's own settings: romance off or a safety line keep them out, a veil or a family table do not", () => {
  assert.equal(romanceLinesAllowed({}), true);
  assert.equal(romanceLinesAllowed({ romance: "off" }), false);
  assert.equal(romanceLinesAllowed({ relationships: "off" }), false);
  assert.equal(romanceLinesAllowed({ safety: { lines: ["romance"] } }), false);
  assert.equal(romanceLinesAllowed({ safety: { lines: ["spiders"], veils: ["romance"] } }), true);
  assert.equal(romanceLinesAllowed({ safety: { boundaries: "family", lines: [] } }), true);
});

// ---- at the table ----

await test("a step taken at the console is posted for the table in the Log's own words", async () => {
  const { world, hero, lines } = await pair({ approval: 80 });
  const out = await world.invoke("romance_advance", { characterId: hero.id, subject: "Ivo", to: "together" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.accepted, true);
  assert.deepEqual(lines(), ["Vex and Ivo became partners."], "the table hears it");
  const logged = [...listRecentEventsForCampaign(world.campaignId, 5).values()].flat().map((event) => event.summary);
  assert.ok(logged.includes("Vex and Ivo became partners"), `the Log keeps the same words: ${logged.join(" | ")}`);
});

await test("a step at an AI table posts too, and lands below the narration that took it", async () => {
  const { world, hero, lines } = await pair({ name: "Hollis", approval: 80 });
  const model = await fakeModel();
  model.pointAt(world);
  model.script([
    reply({ calls: [call("romance_advance", { characterId: hero.id, subject: "Hollis", to: "together" })] }),
    reply({ text: "Hollis takes her hand and does not let go. \"Yes. Together.\"" }),
  ]);
  const narration = await model.turn(world, "I ask Hollis if we can be together.", hero.id);
  model.close();
  assert.ok(narration, "the turn narrated");
  const line = messages.listAllMessages(world.campaignId).find((message) => message.content === "Vex and Hollis became partners.");
  assert.ok(line, `the line was posted: ${lines().join(" | ")}`);
  assert.ok(line.seq > narration.seq, `the line sits below the narration (${line.seq} after ${narration.seq})`);
});

await test("a beat that sinks the meter past a rung's grace posts the slip, and the GM's note says it cooled", async () => {
  const { world, hero, bond, lines } = await pair({ approval: 46 });
  const out = await world.invoke("relationship_beat", { characterId: hero.id, subject: "Ivo", beat: "insult" });
  assert.equal(out.ok, true, out.error);
  assert.equal(bond().romance, "interested", "courting no longer holds at 38");
  assert.deepEqual(lines(), ["Things have cooled between Vex and Ivo: they are no longer courting."]);
  assert.match(out.result.note, /The romance between Vex and Ivo has cooled: they are no longer courting \(now quietly interested\)\./);
  assert.equal(out.result.romanceSlipped, "courting -> interested");
});

await test("an AI turn's slip is said in the result the model reads", async () => {
  const { world, hero, lines } = await pair({ approval: 46 });
  const turn = turns.createDmTurn(world.campaignId, [], "ai");
  const out = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "relationship_beat", args: { characterId: hero.id, subject: "Ivo", beat: "insult" } });
  assert.equal(out.ok, true, out.error);
  assert.match(out.result.note, /has cooled/);
  assert.equal(lines().length, 1);
});

await test("a social check that bullies someone below a rung's grace slips the romance, as a beat does", async () => {
  const { world, hero, bond, lines } = await pair({ approval: 50 });
  // The lowest die misses by five or more: Ivo moves a step colder, and the
  // exchange costs eight on the meter, to 42, under courting's grace of 45.
  world.dice(1);
  const out = await world.invoke("social_check", { characterId: hero.id, npc: "Ivo", approach: "intimidate" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.attitudeShifted, "down");
  assert.equal(bond().approval, 42);
  assert.equal(bond().romance, "interested", "the rung follows the meter down");
  assert.deepEqual(lines(), ["Things have cooled between Vex and Ivo: they are no longer courting."]);
});

await test("a break-up posts that the romance is over; a death posts no romance line", async () => {
  const broken = await pair({ approval: 60 });
  const end = await broken.world.invoke("relationship_end", { characterId: broken.hero.id, subject: "Ivo", reason: "breakup" });
  assert.equal(end.ok, true, end.error);
  assert.deepEqual(broken.lines(), ["The romance between Vex and Ivo is over."]);

  const mourned = await pair({ name: "Bram", romance: "married", approval: 100 });
  const death = await mourned.world.invoke("relationship_end", { characterId: mourned.hero.id, subject: "Bram", reason: "death" });
  assert.equal(death.ok, true, death.error);
  assert.deepEqual(mourned.lines(), [], "the death is the GM's to narrate");
});

await test("a table with romance off, or a line drawn at romance, hears no romance line", async () => {
  const off = await pair({ gameSettings: { romance: "off" }, approval: 46 });
  const beat = await off.world.invoke("relationship_beat", { characterId: off.hero.id, subject: "Ivo", beat: "insult" });
  assert.equal(beat.ok, true, beat.error);
  assert.equal(off.bond().romance, "interested", "the old rung still slips");
  assert.deepEqual(off.lines(), [], "but nothing is said of a romance the table does not play");
  assert.doesNotMatch(beat.result.note, /cooled/);

  const lined = await pair({ gameSettings: { safety: { boundaries: "standard", lines: ["romance"], veils: [] } }, approval: 80 });
  const step = await lined.world.invoke("romance_advance", { characterId: lined.hero.id, subject: "Ivo", to: "together" });
  assert.equal(step.ok, true, step.error);
  assert.deepEqual(lined.lines(), [], "a line keeps it off the page in any form");

  const veiled = await pair({ gameSettings: { safety: { boundaries: "standard", lines: [], veils: ["romance"] } }, approval: 80 });
  await veiled.world.invoke("romance_advance", { characterId: veiled.hero.id, subject: "Ivo", to: "together" });
  assert.deepEqual(veiled.lines(), ["Vex and Ivo became partners."], "a veil allows the summary after the fact");
});

await test("a refused step and a beat that moves no rung post nothing", async () => {
  const { world, hero, lines } = await pair({ approval: 60 });
  world.dice(1);
  const refused = await world.invoke("romance_advance", { characterId: hero.id, subject: "Ivo", to: "together" });
  world.clearDice();
  assert.equal(refused.ok, false, "60 is short of together's 70");
  await world.invoke("relationship_beat", { characterId: hero.id, subject: "Ivo", beat: "helped" });
  assert.deepEqual(lines(), []);
});

finish();
