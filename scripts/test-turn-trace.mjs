// The test fight's turn trace (issue 685, gap 6): "a turn trace for the
// test's author, listing each tool call and each refusal, would show why a
// swing 'was never rolled'". The reading of a stored turn
// (src/lib/dm/turn-trace-logic.ts) against the conversations the turn loop,
// the direct cards, the corrections and a person's console calls leave; the
// person's call kept on their turn at a test table only (src/lib/dm/invoke.ts);
// and the route (src/app/api/campaigns/[campaignId]/turn-trace/route.ts),
// which answers a test table's author alone.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-turn-trace");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const { traceTurn, isQuietTrace, keptAnswer, PERSON_CALL_ID_PREFIX } = await import("../src/lib/dm/turn-trace-logic.ts");
const { DIRECT_CALL_ID_PREFIX, INTENT_CORRECTION_MARK } = await import("../src/lib/dm/intent-logic.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");

// ---- the pure reading ------------------------------------------------------

const IRIS = "11111111-aaaa-4aaa-8aaa-111111111111";
const GOBLIN = "22222222-bbbb-4bbb-8bbb-222222222222";
const names = new Map([
  [IRIS, "Iris"],
  [GOBLIN, "Goblin 1"],
]);

const assistant = (calls, content = "") => ({
  role: "assistant",
  content,
  tool_calls: calls.map(([id, name, args]) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } })),
});
const answer = (id, result) => ({ role: "tool", ...(id ? { tool_call_id: id } : {}), content: JSON.stringify(result) });

// An AI turn as the turn loop stores it: the prompt (rules, the transcript,
// the moment), then the turn's own calls and results.
function aiTurn(own, extra = {}) {
  const prompt = [
    { role: "system", content: "rules" },
    { role: "assistant", content: "The goblin snarls from the doorway." },
    { role: "user", content: "[Iris | attempt] I cast Magic Missile at the goblin." },
    { role: "user", content: "the moment" },
  ];
  return {
    id: "turn-1",
    actor: "ai",
    status: "done",
    callIndex: 2,
    conversation: [...prompt, ...own],
    narrationParts: ["Three darts of light strike the goblin. [roll:aaaaaaaa-0000-0000-0000-000000000000]"],
    rollIds: [],
    contextTrace: { shape: { historyStart: 1, historyEnd: 3, promptMessages: prompt.length } },
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:09.000Z",
    ...extra,
  };
}

const calls = (trace) => trace.rows.filter((row) => row.kind === "call");

await test("a refusal reads as refused, with the rules' sentence, its kind, the names its ids hold, and that the turn never called it again", () => {
  const trace = traceTurn(
    aiTurn([
      assistant([["call_1", "cast_at_enemy", { characterId: IRIS, spell: "Magic Missile", targetEnemyId: GOBLIN }]]),
      answer("call_1", { error: "Iris has no 1st-level slot left.", refused: "rules" }),
    ]),
    { names, durationMs: 9000 },
  );
  assert.equal(trace.by, "ai");
  assert.equal(trace.status, "done");
  assert.equal(trace.durationMs, 9000);
  assert.deepEqual(trace.answered, ["[Iris | attempt] I cast Magic Missile at the goblin."], "the line after the GM last spoke");
  const [cast] = calls(trace);
  assert.equal(cast.tool, "cast_at_enemy");
  assert.equal(cast.source, "model");
  assert.equal(cast.outcome, "refused");
  assert.equal(cast.refusal, "rules");
  assert.equal(cast.sentence, "Iris has no 1st-level slot left.");
  assert.equal(cast.calledAgain, false);
  assert.deepEqual(cast.names, ["Iris", "Goblin 1"]);
  assert.match(cast.summary, /characterId: Iris; spell: Magic Missile; targetEnemyId: Goblin 1/);
  assert.match(cast.args, /"Goblin 1 \(22222222\)"/);
  // The chronicle's roll markers are not the GM's words.
  assert.equal(trace.narration, "Three darts of light strike the goblin.");
  // The prompt's transcript is not the turn's: no reply row for the GM's past line.
  assert.ok(!trace.rows.some((row) => row.kind === "reply"));
});

await test("a call sent back for a retry reads as sent back, and the same call made again later reads as done, even under a reused id", () => {
  // A local model numbers each reply's calls from zero: call_0 twice.
  const trace = traceTurn(
    aiTurn([
      assistant([["call_0", "pc_attack", { characterId: IRIS, targetEnemyId: "goblin" }]], "Iris lunges."),
      answer("call_0", { error: 'Unknown targetEnemyId "goblin". Use one of: Goblin 1 (22222222).', retry: true }),
      assistant([["call_0", "pc_attack", { characterId: IRIS, targetEnemyId: GOBLIN }]]),
      answer("call_0", { hit: true, damage: 4 }),
    ]),
    { names },
  );
  const [first, second] = calls(trace);
  assert.equal(first.outcome, "retry");
  assert.equal(first.refusal, null);
  assert.match(first.sentence, /Unknown targetEnemyId/);
  assert.equal(first.calledAgain, true);
  assert.equal(second.outcome, "ok");
  assert.match(second.answer, /"hit":true/);
  // The model's words beside its call are kept apart from the narration.
  assert.deepEqual(trace.rows[0], { kind: "reply", text: "Iris lunges." });
});

await test("a card the engine played before the model was asked is the engine's, and its pass is not counted as a model call", () => {
  const id = `${DIRECT_CALL_ID_PREFIX}abc123def456`;
  const trace = traceTurn(
    aiTurn([assistant([[id, "pc_attack", { characterId: IRIS, targetEnemyId: GOBLIN, weapon: "Dagger" }]]), answer(id, { hit: false })], { callIndex: 2 }),
    { names },
  );
  const [card] = calls(trace);
  assert.equal(card.source, "card");
  assert.equal(card.outcome, "ok");
  assert.equal(trace.modelCalls, 1, "two passes of the loop, one of them the engine's");
});

await test("the engine's correction is a note of its own, and the call that answers it is marked as made after it", () => {
  const trace = traceTurn(
    aiTurn([
      assistant([["call_1", "use_spell_slot", { characterId: IRIS, level: 1 }]]),
      answer("call_1", { ok: true }),
      { role: "user", content: `[System] Iris played Magic Missile from their hand, ${INTENT_CORRECTION_MARK}: no cast_at_enemy call this turn carried it out, so it has not happened.` },
      assistant([["call_2", "cast_at_enemy", { characterId: IRIS, spell: "Magic Missile", targetEnemyId: GOBLIN }]]),
      answer("call_2", { ok: true, damage: 9 }),
    ]),
    { names },
  );
  const [slot, cast] = calls(trace);
  assert.equal(slot.afterCorrection, false);
  assert.equal(cast.afterCorrection, true);
  assert.equal(cast.source, "model");
  const note = trace.rows.find((row) => row.kind === "note");
  assert.equal(note.correction, true);
  assert.match(note.text, /nothing resolved it/);
  assert.deepEqual(trace.rows.map((row) => row.kind), ["call", "note", "call"]);
});

await test("a person's console calls read as theirs, done or refused, with the refusal kept without the engine's other fields", () => {
  const kept = keptAnswer({ error: "It is not Iris's turn.", refused: "rules", why: { stop: "turn" } });
  assert.deepEqual(JSON.parse(kept), { error: "It is not Iris's turn.", refused: "rules" });
  const trace = traceTurn({
    id: "turn-2",
    actor: "human_dm",
    status: "done",
    callIndex: 0,
    conversation: [
      assistant([[`${PERSON_CALL_ID_PREFIX}0`, "apply_damage", { characterId: IRIS, amount: 3 }]]),
      { role: "tool", tool_call_id: `${PERSON_CALL_ID_PREFIX}0`, content: keptAnswer({ ok: true }) },
      assistant([[`${PERSON_CALL_ID_PREFIX}2`, "pc_attack", { characterId: IRIS, targetEnemyId: GOBLIN }]]),
      { role: "tool", tool_call_id: `${PERSON_CALL_ID_PREFIX}2`, content: kept },
    ],
    narrationParts: [],
    rollIds: [],
    contextTrace: null,
    createdAt: "2026-11-01T10:01:00.000Z",
    updatedAt: "2026-11-01T10:01:00.000Z",
  }, { names });
  assert.equal(trace.by, "person");
  assert.equal(trace.modelCalls, 0);
  assert.deepEqual(trace.answered, []);
  const [damage, swing] = calls(trace);
  assert.equal(damage.source, "person");
  assert.equal(damage.outcome, "ok");
  assert.equal(swing.source, "person");
  assert.equal(swing.outcome, "refused");
  assert.equal(swing.sentence, "It is not Iris's turn.");
});

await test("a call parked on a player's dice reads as waiting on a roll; one a finished turn never answered reads as no answer", () => {
  const own = [assistant([["call_1", "pc_attack", { characterId: IRIS, targetEnemyId: GOBLIN }]])];
  assert.equal(calls(traceTurn(aiTurn(own, { status: "awaiting_rolls" }), { names }))[0].outcome, "waiting");
  assert.equal(traceTurn(aiTurn(own, { status: "awaiting_rolls" })).status, "waiting");
  assert.equal(calls(traceTurn(aiTurn(own), { names }))[0].outcome, "unanswered");
  assert.equal(traceTurn(aiTurn(own, { status: "failed" })).status, "halted");
});

await test("a turn stored before the prompt's size was kept is read from its first call: the transcript is never taken for the turn's words", () => {
  const turn = aiTurn([assistant([["call_1", "pc_attack", { characterId: IRIS, targetEnemyId: GOBLIN }]]), answer("call_1", { hit: true })], { contextTrace: null });
  const trace = traceTurn(turn, { names });
  assert.deepEqual(trace.rows.map((row) => row.kind), ["call"]);
  assert.deepEqual(trace.answered, []);
});

await test("a person's turn the engine closed with nothing on it is left out; one with rolls on it is kept", () => {
  const empty = { id: "t", actor: "human_dm", status: "done", callIndex: 0, conversation: [], narrationParts: [], rollIds: [], contextTrace: null, createdAt: "", updatedAt: "" };
  assert.equal(isQuietTrace(traceTurn(empty)), true);
  assert.equal(isQuietTrace(traceTurn({ ...empty, rollIds: ["r1"] })), false);
});

// ---- the table -------------------------------------------------------------

const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
const route = await world.route("campaigns/[campaignId]/turn-trace");

async function read(query = "", user = world.owner) {
  world.signIn(user);
  const response = await route.GET(new Request(`http://test/api/campaigns/${world.campaignId}/turn-trace${query}`), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

const personTurns = () =>
  getDatabase().prepare(`SELECT conversation_json AS c FROM dm_turns WHERE campaign_id = ? AND actor = 'human_dm'`).all(world.campaignId);

// Someone else at the table, seated while it was still a campaign: a test
// fight takes nobody once it is one.
const stranger = world.addUser("stranger");
campaigns.setCampaignStatus(world.campaignId, "lobby");
assert.ok(!("error" in campaigns.joinByInviteCode(stranger.id, world.campaign().inviteCode)));
campaigns.setCampaignStatus(world.campaignId, "active");

await kit.fight(1);
const [enemy] = world.enemies();
kit.setEnemy(enemy.id, { maxHp: 200 });
kit.place(kara.id, 5, 5);
kit.place(enemy.id, 5, 6);

await test("at a live table the trace is refused with a plain sentence, and a person's calls there keep no conversation", async () => {
  const out = await read();
  assert.equal(out.status, 403);
  assert.match(out.json.error, /Only a test fight shows its turn trace/);
  assert.ok(personTurns().length > 0, "the fight's opening ran as a person's call");
  assert.ok(personTurns().every((row) => row.c === "[]"), "a live table's person turn kept a conversation");
});

// The table becomes a test fight, as src/lib/workshop/test-fight.ts makes one.
getDatabase().prepare(`UPDATE campaigns SET kind = 'playtest' WHERE id = ?`).run(world.campaignId);

await test("at a test fight someone other than its author is refused", async () => {
  const out = await read("", stranger);
  assert.equal(out.status, 403);
  assert.match(out.json.error, /Only the person who started this test fight/);
});

await test("after an AI turn with one call done and one refused, the author reads both: the tool, the names, the engine's sentence", async () => {
  kit.giveTurn(kara.id);
  model.script([
    reply({
      calls: [
        call("pc_attack", { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" }),
        call("pc_attack", { characterId: kara.id, targetEnemyId: enemy.id, weapon: "Longsword" }),
      ],
    }),
    reply({ text: "Kara's blade bites; her second swing finds no opening." }),
  ]);
  await model.turn(world, "Kara attacks the goblin with her longsword.", kara.id, kara.userId);
  // What the engine answered each call, as the next request carried it.
  const sent = model.results(model.requests[1]);
  assert.equal(sent.length, 2, JSON.stringify(sent));
  assert.equal(typeof sent[0].result.error, "undefined", `the first swing was refused: ${JSON.stringify(sent[0].result)}`);
  assert.equal(typeof sent[1].result.error, "string", "the second swing was not refused");

  const out = await read();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const turn = out.json.turns.find((entry) => entry.by === "ai");
  assert.ok(turn, JSON.stringify(out.json.turns.map((entry) => entry.by)));
  assert.equal(out.json.turns[0].id, turn.id, "newest first");
  assert.equal(turn.status, "done");
  assert.ok(turn.answered.some((line) => /Kara attacks the goblin/.test(line)), JSON.stringify(turn.answered));
  const [first, second] = turn.rows.filter((row) => row.kind === "call");
  assert.equal(first.tool, "pc_attack");
  assert.equal(first.source, "model");
  assert.equal(first.outcome, "ok");
  assert.deepEqual(first.names, ["Kara", enemy.displayName]);
  assert.ok(second.outcome === "refused" || second.outcome === "retry", second.outcome);
  assert.equal(second.sentence, sent[1].result.error);
  assert.match(turn.narration, /blade bites/);
});

await test("at a test fight a person's console call is kept on their turn, and the trace reads it as theirs with the engine's answer", async () => {
  const out = await world.invoke("pc_attack", { characterId: kara.id, targetEnemyId: "nobody-here", weapon: "Longsword" });
  assert.equal(out.ok, false, "the swing at nobody was not refused");
  const page = await read();
  assert.equal(page.status, 200);
  const [newest] = page.json.turns;
  assert.equal(newest.by, "person");
  const [swing] = newest.rows.filter((row) => row.kind === "call");
  assert.equal(swing.tool, "pc_attack");
  assert.equal(swing.source, "person");
  assert.ok(swing.outcome === "refused" || swing.outcome === "retry", swing.outcome);
  assert.equal(swing.sentence, out.error);
});

await test("the trace pages back by turn, and refuses a count it does not serve or a turn that is not this table's", async () => {
  const one = await read("?limit=1");
  assert.equal(one.status, 200);
  assert.equal(one.json.turns.length <= 1, true);
  assert.ok(one.json.before, "no way back to the earlier turns");
  const back = await read(`?limit=5&before=${one.json.before}`);
  assert.equal(back.status, 200);
  assert.ok(back.json.turns.some((turn) => turn.by === "ai"), "the AI turn is before the person's call");
  assert.ok(!back.json.turns.some((turn) => one.json.turns.some((seen) => seen.id === turn.id)));
  assert.equal((await read("?limit=0")).status, 400);
  assert.equal((await read("?limit=31")).status, 400);
  assert.equal((await read("?before=not-a-turn")).status, 404);
});

await test("the host flags the trace, and the test fight's banner asks for the flag before it shows the button", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  assert.match(read("src/lib/capabilities.ts"), /^\s*turnTrace: true,$/m);
  assert.match(read("src/lib/use-capabilities.ts"), /features\?: \{[^}]*turnTrace\?: boolean/);
  assert.match(read("src/app/campaigns/[campaignId]/TurnTraceSheet.tsx"), /hostOffers\(useCapabilities\(\), "turnTrace"\)/);
  assert.match(read("src/app/campaigns/[campaignId]/TestFightBanner.tsx"), /<TurnTraceButton campaignId=\{campaignId\} \/>/);
  // It reads again as the GM's turn runs and ends: the stream says so.
  assert.match(read("src/app/campaigns/[campaignId]/useCampaignStream.ts"), /announceDmStatus\(campaignId, payload\.state\)/);
});

model.close();
world.close();
finish();
