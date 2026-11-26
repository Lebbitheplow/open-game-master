// A DM turn does not end with nothing told when something was told, and does
// not tell again what the table already read.
//
// Four reports from one session (qwen3.6-35b as narrator, 0.39.1):
//   - Issue 1100: a fighter's killing blow was told, and the same reply had
//     the two men by the fire charge. The reply was held back for the fight
//     it announced with no start_encounter; the call the model then made was
//     refused, its last call came back with no story, and the table read "the
//     GM gave no narration". The held reply now stands when nothing better
//     follows it (turn.ts withheld).
//   - Issues 1105 and 1108: a reply that held words and no story (a
//     hand-written roll marker, a note to itself on the last call) ended the
//     turn on "The GM had no answer to that", once under three dice cards
//     and a fight that had just opened. Such a turn is now asked once more
//     for its narration, and a turn whose calls changed the table says so
//     (empty-turn.ts TABLE_CHANGED_LINE).
//   - Issues 1104 and 1109: replies that told something new and pasted the
//     paragraphs an earlier reply had closed on. A pasted paragraph is cut
//     from what the table reads (narration-tidy-logic.ts
//     withoutEarlierPassages).
//   - Issue 1109: "I sneak up behind him" was rolled as a Stealth check, and
//     again as the fight opened on the party's ambush. For a player on their
//     own dice that second card held the opening call, the fight then opened
//     with nobody asked for initiative, and the table sat on "Rolling
//     initiative" with no card. The check of the turn now decides the
//     surprise (encounter-open.ts), and a parked opening deals its initiative
//     cards when it resumes (turn.ts resumeDmTurn).
//   - Issue 1104 again: the fight was ended with its last foe hurt and
//     standing, and the story told bodies. An end that leaves foes alive
//     names them in its answer (encounter-tools.ts handleEndEncounter).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as callRoute } from "./lib/enforce-campaign.mjs";
import { aiEngine, call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-silent-turn");
const world = await openWorld({ gameSettings: { ttsEnabled: false, dicePolicy: "real_allowed" } });
const model = await fakeModel();
model.pointAt(world);
const { EMPTY_TURN_LINE, RESOLVED_TURN_LINE, TABLE_CHANGED_LINE } = await import("../src/lib/dm/empty-turn.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");

const bran = world.addHero({ name: "Bran", class: "fighter", level: 3, maxHp: 40 });
const SILENT = [EMPTY_TURN_LINE, RESOLVED_TURN_LINE, TABLE_CHANGED_LINE, "The GM had no answer to that"];
const quiet = (count) => Array.from({ length: count }, () => reply({ text: "" }));

async function turn(line, entries, claims = []) {
  model.claims(claims);
  model.script(entries);
  const message = await model.turn(world, line, bran.id, bran.userId);
  await settleQueue(world.campaignId);
  return message;
}
const told = (message) => SILENT.every((line) => !String(message?.content ?? "").includes(line));

await test("A reply held back for the fight it announced stands when the correction ends with nothing told (issue 1100)", async () => {
  const story = "The watchman folds over Bran's blade and drops into the snow. By the fire the two men are on their feet, and they charge at Bran with their axes out.";
  const message = await turn(
    "I finish the watchman.",
    [
      reply({ text: story }),
      // Sent back for the fight, the model names a creature nobody knows, and then says nothing.
      reply({ calls: [call("start_encounter", { enemies: [{ monster: "no such creature anywhere", count: 2 }], summary: "Two men by the fire" })] }),
      ...quiet(8),
    ],
    [[{ kind: "fight_start", quote: "they charge at Bran with their axes out" }]],
  );
  assert.ok(model.requests.some((request) => request.messages.some((entry) => entry.role === "user" && /start_encounter/.test(String(entry.content)) && String(entry.content).startsWith("[System]"))), "the reply was never sent back for its fight");
  assert.ok(told(message), `the table read a line for an empty turn: ${message?.content}`);
  assert.match(message?.content ?? "", /folds over Bran's blade/, "the story the turn was told is gone");
  assert.equal(world.encounter(), null);
});

await test("A reply that holds words and no story is asked once more for the narration (issues 1105 and 1108)", async () => {
  const message = await turn(
    "I search the wagon to see what all the fuss is about.",
    [
      // A roll marker written by hand rolls nothing and tells nothing.
      reply({ text: "[roll:00000000-0000-4000-8000-000000000000]" }),
      reply({ text: "Under the tarp Bran finds sacks of grain, and beneath them a crate marked with a painted eye." }),
    ],
  );
  assert.match(message?.content ?? "", /sacks of grain/, `the turn ended with nothing told: ${message?.content}`);
  assert.ok(told(message));
});

await test("A turn whose calls changed the table and told nothing says so, and does not ask the player to try again", async () => {
  const message = await turn(
    "I creep up behind him and take him out before he can shout.",
    [reply({ calls: [call("start_encounter", { enemies: [{ monster: "bandit", count: 1 }], summary: "A lone bandit in the fog" })] }), ...quiet(8)],
  );
  assert.ok(world.encounter(), "the fight never opened");
  assert.ok(String(message?.content ?? "").includes(TABLE_CHANGED_LINE), `the table read: ${message?.content}`);
  assert.doesNotMatch(message?.content ?? "", /Try again/);
  await world.invoke("end_encounter", { outcome: "victory" });
});

await test("A paragraph pasted from an earlier passage is cut from what the table reads, and what is new stays (issues 1104 and 1109)", async () => {
  const closing = "The silence that follows is heavy, broken only by the crackle of the distant fire. From the tents, voices call out, confused and wary. Boots crunch on the frozen snow as the whole camp stirs awake.";
  const first = await turn("I take the watchman's blade.", [reply({ text: `Bran pries the blade from the watchman's grip and tests its weight.\n\n${closing}` })]);
  assert.match(first?.content ?? "", /The silence that follows is heavy/);
  const second = await turn(
    "I circle the camp, keeping to the fog.",
    [reply({ text: `Bran keeps low and works his way round the camp, the fog closing behind him like a door.\n\n${closing.replace("the whole camp stirs", "the whole band stirs")}\n\nWhat do you do?` })],
  );
  assert.match(second?.content ?? "", /works his way round the camp/, "what was new was cut");
  assert.doesNotMatch(second?.content ?? "", /The silence that follows is heavy/, "the pasted paragraph reached the table");
  assert.match(second?.content ?? "", /What do you do\?/);
});

// The report's turn, for a player who rolls their own dice.
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
async function rollCards(face) {
  const cards = listOpenPendingRolls(world.campaignId);
  for (const card of cards) {
    const answered = await callRoute(submitRoute, "POST", { dice: [face] }, { campaignId: world.campaignId, pendingRollId: card.id });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    await settleQueue(world.campaignId);
  }
  return cards.map((card) => `${card.kind}:${card.detail}`);
}

await test("A Stealth check the GM asked for decides the ambush that opens the fight: one Stealth card, then the initiative card, and the order locks (issue 1109)", async () => {
  setMemberRealDice(world.campaignId, bran.userId, true);
  world.signIn({ id: bran.userId });
  try {
    const opening = call("start_encounter", { enemies: [{ monster: "bandit", count: 1 }], summary: "A lone bandit in the fog", ambush: "party" });
    model.claims([]);
    model.script([
      reply({ calls: [call("request_roll", { kind: "skill_check", characterId: bran.id, skill: "stealth", dc: 12, reason: "creeping up behind him" })] }),
      reply({ calls: [opening] }),
      reply({ text: "Bran's blade is out before the bandit turns. What do you do?" }),
    ]);
    const first = await model.turn(world, "I sneak close behind him and try to kill him before he can make a sound.", bran.id, bran.userId);
    assert.equal(first, null, "the turn did not wait on the Stealth card");
    assert.deepEqual(await rollCards(17), ["skill_check:stealth"]);
    // The fight is open, and the only card out is the initiative.
    assert.ok(world.encounter(), "the fight never opened");
    assert.deepEqual(await rollCards(12), ["initiative:initiative"], "a second Stealth card, or no initiative card");
    assert.equal(world.encounter().orderReady, true, "the fight still waits on a roll");
    const told = model.requests.flatMap((request) => model.results(request)).filter((entry) => entry.id === opening.id).at(-1)?.result;
    assert.match(String(told?.ambush ?? ""), /Bran's Stealth check of this turn stands/, JSON.stringify(told));
    assert.equal(listRecentRolls(world.campaignId, 30).filter((roll) => roll.characterId === bran.id && /lying in wait/.test(roll.detail)).length, 0, "the ambush rolled Stealth again");
  } finally {
    setMemberRealDice(world.campaignId, bran.userId, false);
    await world.invoke("end_encounter", { outcome: "victory" });
  }
});

await test("An ambush whose Stealth waits on a player's own dice still deals the initiative card when the opening resumes (issue 1109)", async () => {
  setMemberRealDice(world.campaignId, bran.userId, true);
  world.signIn({ id: bran.userId });
  try {
    const opening = call("start_encounter", { enemies: [{ monster: "bandit", count: 1 }], summary: "A bandit away from the fire", ambush: "party" });
    model.claims([]);
    model.script([reply({ calls: [opening] }), reply({ text: "The bandit never hears Bran coming. What do you do?" })]);
    const first = await model.turn(world, "I wait in the fog for him to pass.", bran.id, bran.userId);
    assert.equal(first, null);
    assert.deepEqual(await rollCards(16), ["skill_check:stealth, lying in wait"]);
    const fight = world.encounter();
    assert.ok(fight && !fight.orderReady, "the fight is not waiting on initiative");
    const cards = listOpenPendingRolls(world.campaignId);
    assert.deepEqual(cards.map((card) => card.kind), ["initiative"], "the fight opened with no initiative card for the player who rolls their own");
    assert.equal(cards[0].toolCallId, opening.id, "the card does not answer the call that opened the fight");
    assert.equal(model.served(), 1, "the GM narrated a fight whose order was not in yet");
    await rollCards(13);
    assert.equal(world.encounter().orderReady, true);
    const told = model.results(model.requests.at(-1)).filter((entry) => entry.id === opening.id);
    assert.equal(told.length, 1, `the opening call has ${told.length} answers`);
    assert.equal(told[0].result.initiativeCards?.[0]?.characterId, bran.id, JSON.stringify(told[0].result));
    assert.doesNotMatch(String(told[0].result.next ?? ""), /call request_roll with/);
  } finally {
    setMemberRealDice(world.campaignId, bran.userId, false);
    await world.invoke("end_encounter", { outcome: "victory" });
  }
});

const ai = await aiEngine(world);

await test("An end that leaves foes alive names them in its answer, so the story says what became of them; an end with every foe down says nothing of survivors (issue 1104)", async () => {
  const opened = await world.invoke("start_encounter", { enemies: [{ monster: "bandit", count: 2 }], summary: "Two bandits by the fire" });
  assert.equal(opened.ok, true, opened.error);
  ai.fresh();
  const yielded = await ai.invoke("end_encounter", { outcome: "truce", reason: "They throw down their blades." });
  assert.equal(yielded.ok, true, yielded.error);
  assert.match(String(yielded.result?.survivors ?? ""), /^Bandit 1 and Bandit 2 left this fight alive\..*tell no bodies/, JSON.stringify(yielded.result));
  assert.equal(world.encounter(), null);
  // The narrator's "victory" is still taken as sent, and still names who lives.
  const again = await world.invoke("start_encounter", { enemies: [{ monster: "bandit", count: 1 }], summary: "One more" });
  assert.equal(again.ok, true, again.error);
  ai.fresh();
  const won = await ai.invoke("end_encounter", { outcome: "victory" });
  assert.equal(won.ok, true, won.error);
  assert.match(String(won.result?.survivors ?? ""), /^Bandit left this fight alive\./, JSON.stringify(won.result));
  assert.equal(world.encounter(), null);
});

model.close();
world.close();
finish();
