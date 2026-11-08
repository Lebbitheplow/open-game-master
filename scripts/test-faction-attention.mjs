// Factions move because the GM is told when and which (issue 870: one table,
// 10 chapters, 589 GM turns, 12 factions, adjust_reputation called 0 times).
//   - the GM's factions block says when standing moves and by how much;
//   - a faction named in recent play since its standing last moved, by its
//     name or a member's, is marked in the block and listed first;
//   - a chapter that closes having dealt with a faction whose standing never
//     moved asks the next GM turn, once, to settle it;
//   - the factions tools are offered unasked while one is in play, at a
//     table in any language (the English word "faction" no longer has to
//     appear);
//   - a step of 0 is refused instead of being recorded as standing that fell.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-faction-attention");
const world = await openWorld({ campaign: { maxPlayers: 4 }, gameSettings: { ttsEnabled: false } });
const { insertFaction, listFactions } = await import("../src/lib/db/factions.ts");
const { createNpcFromDraft } = await import("../src/lib/db/npcs.ts");
const { blankDraft } = await import("../src/lib/npcs/forge.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const { renderFactionsForPrompt, FACTION_RULE } = await import("../src/lib/dm/faction-logic.ts");
const { factionAttention, factionsInPlay, recordFactionReview } = await import("../src/lib/dm/faction-attention.ts");
const { handleAdjustReputation } = await import("../src/lib/dm/faction-tools.ts");
const { autoGroups } = await import("../src/lib/dm/tool-profiles.ts");
const { profileSignals } = await import("../src/lib/dm/turn.ts");

const court = insertFaction(world.campaignId, { name: "The Reed Court", goal: "Own the ferry", attitude: "wary", power: 2, tags: [] });
const guild = insertFaction(world.campaignId, { name: "Lantern Guild", goal: "", attitude: "neutral", power: 3, tags: [] });
createNpcFromDraft(world.campaignId, { ...blankDraft(), name: "Marla", factionId: guild.id });
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
const block = () => renderFactionsForPrompt(listFactions(world.campaignId), getParty(world.campaignId).reputation, true, factionAttention(world.campaignId));
const adjust = (faction, delta) => handleAdjustReputation(world.campaign(), JSON.stringify({ faction, delta, reason: "test" }));

await test("The GM's block says when standing moves; the players' view does not carry it.", () => {
  assert.match(block(), new RegExp(`^FACTIONS\\. ${FACTION_RULE.slice(0, 40).replace(/[()+-]/g, "\\$&")}`));
  assert.match(FACTION_RULE, /keeps or breaks a bargain/);
  assert.match(FACTION_RULE, /ordinary talk moves nothing/);
  const players = renderFactionsForPrompt(listFactions(world.campaignId), {}, false);
  assert.doesNotMatch(players, /ordinary talk/);
});

await test("A faction named in recent play since its standing last moved is marked and listed first, by a member's name too, and the tools are offered unasked.", async () => {
  assert.equal(factionsInPlay(world.campaignId), false);
  assert.equal(autoGroups(profileSignals(world.campaign(), world.sheets(), false)).has("factions"), false);
  world.say("dm", "Marla of the lanterns waves you over to the stall.");
  world.say("dm", "Marla lowers her voice: the guild needs a courier tonight.");
  assert.equal(factionAttention(world.campaignId).named.get(guild.id), 2);
  assert.match(block(), /\n- Lantern Guild .*\| named in 2 recent lines since its standing last moved/);
  assert.ok(block().indexOf("Lantern Guild") < block().indexOf("The Reed Court"), "the faction in play comes first");
  assert.equal(factionsInPlay(world.campaignId), true);
  assert.equal(autoGroups(profileSignals(world.campaign(), world.sheets(), false)).has("factions"), true);
  // Once its standing moves, what was said before no longer counts.
  await pause();
  assert.equal(adjust("Lantern Guild", 1).ok, true);
  assert.equal(factionAttention(world.campaignId).named.has(guild.id), false);
  assert.doesNotMatch(block(), /named in/);
});

await test("A step of 0 is refused: it moved nothing and was recorded as standing that fell.", () => {
  const before = getParty(world.campaignId).reputation[court.id] ?? 0;
  const out = adjust("The Reed Court", 0);
  assert.equal(out.retry, true);
  assert.match(out.error, /delta is 0/);
  assert.equal(getParty(world.campaignId).reputation[court.id] ?? 0, before);
});

await test("A closed chapter that dealt with a faction whose standing never moved asks the next GM turn to settle it, once.", async () => {
  await pause();
  const chapterStart = new Date().toISOString();
  await pause();
  const transcript = "The party sank the Reed Court's ferry and blamed the toll-keepers. Marla paid them for the lantern run.";
  recordFactionReview(world.campaignId, transcript, chapterStart, new Date().toISOString());
  // The Lantern Guild moved before this chapter began, so it is asked too;
  // the Reed Court never moved.
  assert.deepEqual(new Set(getParty(world.campaignId).factionReview.ids), new Set([court.id, guild.id]));
  assert.match(block(), /The chapter that just closed dealt with .*The Reed Court.*, and the party's standing with them did not move\. Settle each once now with adjust_reputation/);
  assert.equal(autoGroups(profileSignals(world.campaign(), world.sheets(), false)).has("factions"), true);
  // Settling one drops it from the ask.
  assert.equal(adjust("The Reed Court", -1).ok, true);
  assert.deepEqual(getParty(world.campaignId).factionReview.ids, [guild.id]);
  // Once the GM has narrated, the ask is gone.
  await pause();
  world.say("dm", "Night falls over the river.");
  assert.doesNotMatch(block(), /chapter that just closed/);
  // A chapter that dealt with nobody clears it.
  recordFactionReview(world.campaignId, "A quiet road.", new Date().toISOString(), new Date().toISOString());
  assert.equal(getParty(world.campaignId).factionReview, null);
});

await test("Names are read in any table language: a faction named in Spanish narration is in play.", async () => {
  await pause();
  assert.equal(adjust("Lantern Guild", 1).ok, true);
  await pause();
  world.say("dm", "Los mensajeros de Lantern Guild cruzan el puente.");
  world.say("dm", "Marla te mira desde la orilla.");
  assert.equal(factionAttention(world.campaignId).named.get(guild.id), 2);
});

await finish();
world.close?.();
