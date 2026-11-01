// Issue 643, through the engine the way the GM reaches it: a romance paced
// by more than the player.
//   - A rung needs story time after the last, on every road that steps one:
//     romance_advance from the AI and from the console (marriage included),
//     an NPC's first move as it is made and as the server rolls for it, and
//     the answer to one; the refusal says when the next step can come.
//   - A companion's values swing wears with each deed that honoured the same
//     value: the fourth mercy before a paladin moves nothing.
//   - The other side starts a scene at each rung: the engine picks it after a
//     narration, the AI is handed a director note and a person running the
//     table reads it on the Bonds tab, a narration where they come to the
//     character plays it and the bond remembers it; one at a time, never in
//     a fight, nothing where romance is off.
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-romance-pace-643");
const relationships = await import("../src/lib/db/relationships.ts");
const npcs = await import("../src/lib/db/npcs.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const proposals = await import("../src/lib/db/item-proposals.ts");
const { readPacing } = await import("../src/lib/db/romance-pacing.ts");
const { advanceClock } = await import("../src/lib/db/clock.ts");
const { setOpenToAdvances } = await import("../src/lib/db/sheets.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { settleNpcAdvance } = await import("../src/lib/dm/npc-advance.ts");
const { tickAdvances } = await import("../src/lib/dm/advance-tick.ts");
const { readRomanceScene, romanceSceneNotes } = await import("../src/lib/dm/romance-scenes.ts");
const { SCENE_COOLDOWN } = await import("../src/lib/dm/romance-scene-logic.ts");

const EVEN = { drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0 };

// A hero and an NPC who adores them, so every consent is certain.
async function suitor(name, gameSettings = {}) {
  const world = await openWorld({ gameSettings });
  // At a table a person runs, the hero is a player's, as an NPC's first move
  // needs (a person may make one from the console without a window).
  const hero = world.addHero({ name: "Vex", gender: "Female", ...(gameSettings.dmMode === "human" ? { user: world.addUser("vex") } : {}) });
  const set = await world.invoke("set_npc", { name, gender: "Male", location: "Highmoor", drawnTo: ["women"] });
  assert.equal(set.ok, true, set.error);
  npcs.patchNpcAgency(npcs.getNpcByName(world.campaignId, name).id, { personality: EVEN });
  const row = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: hero.id, characterName: hero.name, subjectKind: "npc", subjectName: name });
  relationships.patchRelationship(row.id, { approval: 100 });
  const pair = () => relationships.getRelationship(world.campaignId, hero.id, name);
  const step = (to) => world.invoke("romance_advance", { characterId: hero.id, subject: name, to });
  // The console's exchange ends with the GM's narration (issue 638).
  const narrate = async (text = "The evening wears on.") => {
    await wait(5);
    world.say("dm", text);
  };
  return { world, hero, pair, step, narrate };
}

await test("at the console a step asked too soon after the last is refused with when it can come, and then it comes", async () => {
  const { world, pair, step, narrate } = await suitor("Ivo");
  const first = await step("interested");
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.accepted, true, "the first rung waits on nothing");
  await narrate();
  const soon = await step("courting");
  assert.equal(soon.ok, false, "a day has not passed");
  assert.equal(
    soon.error,
    "It is too soon for Vex and Ivo to be openly courting. They became quietly interested less than an hour ago, and this step needs about a day after that. The next step can come in about a day of story time (a rest, a journey, or time moved on the clock); play what passes between them meanwhile, as Ivo wanting more time, not as a no.",
  );
  assert.equal(pair().romance, "interested", "nothing moved");
  assert.equal(pair().approval, 100, "and a rules refusal costs no regard");
  assert.equal(pair().memories.length, 1, "nor leaves a refusal on the bond");

  advanceClock(world.campaignId, 20, "hours");
  await narrate();
  const still = await step("courting");
  assert.equal(still.ok, false);
  assert.match(still.error, /The next step can come in about 4 hours of story time/);

  advanceClock(world.campaignId, 4, "hours");
  await narrate();
  const later = await step("courting");
  assert.equal(later.ok, true, later.error);
  assert.equal(pair().romance, "courting");
  assert.equal(readPacing(pair().id).steppedAt, world.campaign().clock.instant, "the step is recorded on the clock");
});

await test("the AI is told to pass time, and a marriage waits its week like every rung", async () => {
  const { world, hero, pair } = await suitor("Hollis");
  const asAi = (to) => {
    const turn = turns.createDmTurn(world.campaignId, [], "ai");
    return invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name: "romance_advance", args: { characterId: hero.id, subject: "Hollis", to } });
  };
  relationships.patchRelationship(pair().id, { romance: "together" });
  const proposal = await asAi("betrothed");
  assert.equal(proposal.ok, true, proposal.error);
  assert.equal(pair().romance, "betrothed", "a romance from before pacing was kept holds nothing back");
  const wedding = await asAi("married");
  assert.equal(wedding.ok, false);
  assert.match(wedding.error, /^It is too soon for Vex and Hollis to be married\./);
  assert.match(wedding.error, /\(travel, a rest, or pass_time\)/);
  advanceClock(world.campaignId, 6, "days");
  assert.match((await asAi("married")).error, /about a day of story time/);
  advanceClock(world.campaignId, 1, "days");
  const vows = await asAi("married");
  assert.equal(vows.ok, true, vows.error);
  assert.equal(pair().romance, "married");
});

await test("an NPC's first move waits a day after the player's own first step, and its yes is a step too", async () => {
  const { world, hero, pair, step, narrate } = await suitor("Senna", { dmMode: "human" });
  setOpenToAdvances(hero.id, true);
  assert.equal((await step("interested")).result.accepted, true);
  await narrate();
  const move = { characterId: hero.id, subject: "Senna", to: "courting", initiator: "npc", note: "Walk with me?" };
  const soon = await world.invoke("romance_advance", move);
  assert.equal(soon.ok, false, "courting needs a day after interested");
  assert.match(soon.error, /^It is too soon for Vex and Senna to be openly courting\./);
  const offers = () => proposals.listOpenItemProposals(world.campaignId).filter((offer) => offer.toolName === "romance_advance");
  assert.equal(offers().length, 0, "no offer reached the player");

  // Nor does the server open a moment for a move it would refuse.
  for (let turn = 0; turn < 40; turn += 1) {
    world.dice(1);
    tickAdvances(world.campaign(), (turn + 1) * 8, "Senna waits by the well.");
    world.clearDice();
  }
  assert.equal(pair().advanceReadyUntil, 0, "no window opened while it was too soon");

  advanceClock(world.campaignId, 1, "days");
  await narrate();
  const made = await world.invoke("romance_advance", move);
  assert.equal(made.ok, true, made.error);
  const [offer] = offers();
  const resolved = proposals.resolveItemProposal(offer.id, "approved");
  settleNpcAdvance(world.campaign(), resolved, "approved");
  assert.equal(pair().romance, "courting");
  await narrate();
  const next = await step("together");
  assert.equal(next.ok, false, "the yes was a step: together waits its three days from it");
  assert.match(next.error, /to be partners\. They became openly courting less than an hour ago/);
});

await test("a paladin's regard for mercy wears with each mercy, and the fourth moves nothing", async () => {
  const world = await openWorld({ gameSettings: { companions: "full" } });
  const kael = world.addHero({ name: "Kael", gender: "Male" });
  const added = await world.invoke("add_companion", { name: "Seren", class: "paladin", gender: "Female", alignment: "LG", personality: "Stern.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  npcs.patchNpcAgency(npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Seren").id, { personality: EVEN });
  const moved = [];
  for (let deed = 0; deed < 4; deed += 1) {
    const out = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Seren", beat: "mercy", note: "Spared the bandit." });
    assert.equal(out.ok, true, out.error);
    moved.push(out.result.approvalChange);
  }
  // Mercy is 6 with an even nature, and honours her red line for 12 more.
  assert.deepEqual(moved, [18, 11, 6, 0], "a red line honoured again wears as the deed does");
  // Freeing captives honours the same value, so it wears from where mercy left it.
  const freed = await world.invoke("relationship_beat", { characterId: kael.id, subject: "Seren", beat: "freed_captives" });
  assert.equal(freed.result.approvalChange, 8, "the deed's own read is fresh; her value's swing is spent");
  // A cost never wears.
  const cruel = [];
  for (let deed = 0; deed < 2; deed += 1) {
    cruel.push((await world.invoke("relationship_beat", { characterId: kael.id, subject: "Seren", beat: "cruelty", severity: "minor" })).result.approvalChange);
  }
  assert.equal(cruel[0], cruel[1]);
});

// A table a person runs: Kael's player, a party companion Lyra courting him,
// and the GM's narrations through the narrate route.
async function humanTable({ composure = 0, gameSettings = {}, open = false } = {}) {
  const world = await openWorld({ gameSettings: { dmMode: "human", companions: "full", ...gameSettings } });
  const player = world.addUser("kael");
  const kael = world.addHero({ user: player, name: "Kael", gender: "Male", ...(open ? { attraction: { genders: [], note: "", open: true } } : {}) });
  const added = await world.invoke("add_companion", { name: "Lyra", class: "bard", gender: "Female", personality: "Bright and restless.", kind: "party" });
  assert.equal(added.ok, true, added.error);
  npcs.patchNpcAgency(npcs.listNpcs(world.campaignId).find((npc) => npc.name === "Lyra").id, { personality: { ...EVEN, composure } });
  const lyra = () => relationships.getRelationship(world.campaignId, kael.id, "Lyra");
  relationships.patchRelationship(lyra().id, { approval: 100 });
  const narrate = async (content) => {
    await wait(2);
    world.signIn(world.owner);
    const route = await world.route("campaigns/[campaignId]/dm/narrate");
    const response = await route.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ content }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
    assert.equal(response.status, 201, await response.clone().text());
  };
  const bonds = async (user) => {
    world.signIn(user);
    const route = await world.route("campaigns/[campaignId]/relationships");
    const response = await route.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
    return (await response.json()).relationships;
  };
  const card = async (user = world.owner) => (await bonds(user)).find((entry) => entry.subjectName === "Lyra")?.scene;
  return { world, player, kael, lyra, narrate, bonds, card };
}

await test("at a table a person runs, the companion's scene comes due on the Bonds tab and the narration that plays it is remembered", async () => {
  const { world, player, kael, lyra, narrate, card } = await humanTable();
  const stepped = await world.invoke("romance_advance", { characterId: kael.id, subject: "Lyra", to: "interested" });
  assert.equal(stepped.result.accepted, true, stepped.error);
  await narrate("Lyra laughs at something Kael says and looks away.");
  assert.equal(await card(), undefined, "not on the step's heels");
  await narrate("The caravan rolls on through the hills.");
  assert.equal(
    await card(),
    "Lyra seeks Kael out alone, to talk about something they keep from the others. Play it when the scene allows: once Lyra speaks in your narration, it is recorded.",
  );
  assert.equal(await card(player), undefined, "the engine's choice is the storyteller's: Kael's player never sees it");
  await narrate("Rain drums on the wagon roof.");
  assert.ok(await card(), "still due: that passage was not it");
  await narrate("That night Lyra finds Kael by the fire, away from the others.");
  assert.equal(await card(), undefined, "played");
  assert.equal(lyra().memories.at(-1).text, "Lyra sought Kael out for a private talk");
  assert.deepEqual(readPacing(lyra().id).played, ["interested:private_talk"]);
  for (let reply = 0; reply < SCENE_COOLDOWN + 2; reply += 1) {
    await narrate("The road goes on.");
  }
  assert.equal(await card(), undefined, "each rung's scene comes once");
});

await test("a scene not taken passes, comes back once after the cooldown, and is then let go", async () => {
  const { world, kael, lyra, narrate, card } = await humanTable();
  await world.invoke("romance_advance", { characterId: kael.id, subject: "Lyra", to: "interested" });
  await narrate("Dawn.");
  await narrate("Noon.");
  assert.ok(await card());
  for (let reply = 0; reply < 3; reply += 1) {
    await narrate("The road goes on.");
  }
  assert.equal(await card(), undefined, "three passages without it: it passes");
  assert.equal(readPacing(lyra().id).lapses["interested:private_talk"], 1);
  for (let reply = 0; reply < SCENE_COOLDOWN - 1; reply += 1) {
    await narrate("The road goes on.");
  }
  assert.equal(await card(), undefined, "the table's cooldown");
  await narrate("The road goes on.");
  assert.ok(await card(), "offered again");
  for (let reply = 0; reply < 3 + SCENE_COOLDOWN + 2; reply += 1) {
    await narrate("The road goes on.");
  }
  assert.equal(await card(), undefined, "let go after passing twice");
  assert.deepEqual(readPacing(lyra().id).played, ["interested:private_talk"]);
});

await test("never in a fight: a due scene holds through one and nothing new comes due", async () => {
  const { world, kael, narrate, card } = await humanTable();
  await world.invoke("romance_advance", { characterId: kael.id, subject: "Lyra", to: "interested" });
  await narrate("Dawn.");
  await narrate("Noon.");
  assert.ok(await card());
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  assert.equal(await card(), undefined, "hidden while blades are out");
  for (let reply = 0; reply < 5; reply += 1) {
    await narrate("Steel rings in the pass.");
  }
  await world.invoke("end_encounter", { outcome: "victory" });
  assert.ok(await card(), "the fight's passages did not spend it");
});

await test("a jealous moment comes first when the character courts someone else and the companion lets a hurt show", async () => {
  const { world, kael, lyra, narrate, card } = await humanTable({ composure: -2 });
  relationships.patchRelationship(lyra().id, { romance: "courting" });
  const set = await world.invoke("set_npc", { name: "Mira", gender: "Female", location: "Highmoor" });
  assert.equal(set.ok, true, set.error);
  const mira = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: "Kael", subjectKind: "npc", subjectName: "Mira" });
  relationships.patchRelationship(mira.id, { approval: 30, beats: { flirt: 1 } });
  await narrate("Dawn.");
  await narrate("Noon.");
  assert.match(await card(), /^Lyra is stung to see Kael so close with Mira, and lets it show\./);
  await narrate('Lyra catches Kael at the well. "You and Mira," she says.');
  assert.equal(lyra().memories.at(-1).text, "Lyra was stung to see Kael close with Mira");
});

await test("no jealous moment when both of them are open to more than one partner (issue 642)", async () => {
  const { world, kael, lyra, narrate, card } = await humanTable({ composure: -2, open: true });
  await world.invoke("set_npc", { name: "Lyra", drawnTo: ["open relationships"] });
  relationships.patchRelationship(lyra().id, { romance: "courting" });
  await world.invoke("set_npc", { name: "Mira", gender: "Female", location: "Highmoor" });
  const mira = relationships.ensureRelationship({ campaignId: world.campaignId, characterId: kael.id, characterName: "Kael", subjectKind: "npc", subjectName: "Mira" });
  relationships.patchRelationship(mira.id, { approval: 30, beats: { flirt: 1 } });
  await narrate("Dawn.");
  await narrate("Noon.");
  const due = await card();
  assert.ok(due, "the courting scene still comes due");
  assert.doesNotMatch(due, /stung/, "a rival stings nobody who is open, beside an open partner");
});

await test("nothing romantic is offered where romance is off or the table's safety tools rule it out, and switching it off drops what was due", async () => {
  const off = await humanTable({ gameSettings: { romance: "off" } });
  relationships.patchRelationship(off.lyra().id, { romance: "courting" });
  for (let reply = 0; reply < 4; reply += 1) {
    await off.narrate("The road goes on.");
  }
  assert.equal(await off.card(), undefined);
  assert.equal(readPacing(off.lyra().id).due, null);

  const family = await humanTable({ gameSettings: { safety: { boundaries: "family", lines: [], veils: [] } } });
  relationships.patchRelationship(family.lyra().id, { romance: "courting" });
  for (let reply = 0; reply < 4; reply += 1) {
    await family.narrate("The road goes on.");
  }
  assert.equal(readPacing(family.lyra().id).due, null, "a family table");

  const on = await humanTable();
  relationships.patchRelationship(on.lyra().id, { romance: "courting" });
  await on.narrate("Dawn.");
  await on.narrate("Noon.");
  assert.ok(readPacing(on.lyra().id).due);
  const { updateGameSettings } = await import("../src/lib/db/campaigns.ts");
  updateGameSettings(on.world.campaignId, { romance: "off" });
  await on.narrate("Dusk.");
  assert.equal(readPacing(on.lyra().id).due, null, "switched off, what was due goes");
});

await test("at an AI table the scene is a director note, counted as handed when the prompt is built, and the reply that plays it records it", async () => {
  const world = await openWorld({ gameSettings: { companions: "full" } });
  const kael = world.addHero({ name: "Kael", gender: "Male" });
  await world.invoke("add_companion", { name: "Lyra", class: "bard", gender: "Female", personality: "Bright.", kind: "party" });
  const lyra = () => relationships.getRelationship(world.campaignId, kael.id, "Lyra");
  relationships.patchRelationship(lyra().id, { romance: "together", approval: 80 });
  const reply = (content) => readRomanceScene(world.campaign(), world.say("dm", content), { handedNow: false });
  reply("Dawn.");
  reply("Noon.");
  assert.ok(readPacing(lyra().id).due, "due after the replies a step is owed");
  reply("The road goes on.");
  assert.equal(readPacing(lyra().id).due?.handed, 0, "a reply whose prompt never carried it does not spend it");
  const [note] = romanceSceneNotes(world.campaign());
  assert.equal(
    note,
    "Lyra starts a moment of their own with Kael (partners): Lyra talks with Kael about what they want when this is over, and whether Kael is in it. If the scene allows it, play it this reply in Lyra's own voice and let Kael's player answer; never decide how Kael feels.",
  );
  assert.equal(readPacing(lyra().id).due.handed, 1);
  reply("(ooc) Yes, Lyra and Kael are partners now.");
  assert.ok(readPacing(lyra().id).due, "an out-of-character answer naming them both plays nothing");
  reply("By the river, Lyra takes Kael's hand and asks what he will do when the war ends.");
  assert.equal(readPacing(lyra().id).due, null);
  assert.equal(lyra().memories.at(-1).text, "Lyra talked with Kael about what comes after");
  assert.deepEqual(romanceSceneNotes(world.campaign()), [], "nothing more to hand");
});

finish();
