// A first-tier mind's own model and reasoning effort (ticket 09,
// docs/tickets/ogm-npc-isolation-design/09-modello-per-personaggio.md), on
// the fake agent program (HARNESS_FAKE): it records the model and effort each
// run was started with.
//   - A companion with a choice thinks with that model and effort; one
//     without runs on the table's mind route, as before.
//   - Only what the program offers can be chosen; a model it stopped
//     offering falls back to the table's, with a line in the log.
//   - Only whoever runs the story reads or changes it, from the companion's
//     route; the narrator's own calls are untouched.
//   - Reverting a later turn, and a restart, keep the choice.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HARNESS_FAKE = "1";
const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-mind-model-"));
process.env.HARNESS_FAKE_SCRIPT = path.join(scriptDir, "script.json");
// Every run answers as a mind does.
fs.writeFileSync(
  process.env.HARNESS_FAKE_SCRIPT,
  JSON.stringify([[{ text: JSON.stringify({ speech: "Aye.", intent: "", conclusion: "", lie: false }) }]]),
);

const { openWorld } = await import("./lib/enforce-world.mjs");
const { suite } = await import("./lib/enforce-harness.mjs");
const { test, finish } = suite("test-npc-mind-model");

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { fakeAdapter } = await import("../src/lib/harness/adapters/fake.ts");
const { getDatabase, closeDatabaseForRestore } = await import("../src/lib/db/core.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { markSheetAsCompanion, setCompanionCommander, getSheetById } = await import("../src/lib/db/sheets.ts");
const { companionNpcFor } = await import("../src/lib/db/companion-npcs.ts");
const { getNpcMindModel } = await import("../src/lib/db/npc-minds.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const { revertTurn } = await import("./lib/sweep-lifecycle.mjs");
const mind = await import("../src/lib/dm/npc-mind.ts");
const { requestUtilityMessage, requestDmMessage } = await import("../src/lib/dm/model.ts");

saveGlobalConfig({
  harness: { id: "codex", model: "gpt-table", utilityModel: "", effort: "medium", campaigns: "all", maxConcurrent: 4, turnTimeoutSec: 60 },
  text: { provider: "harness" },
});
const OFFERED = [
  { id: "gpt-table", label: "Table model", efforts: ["low", "medium", "high"] },
  { id: "gpt-deep", label: "Deep model", efforts: ["low", "high", "xhigh"] },
];
let offered = OFFERED;
fakeAdapter.probe = async () => ({
  installed: true,
  version: "fake",
  auth: { state: "ready", kind: "subscription", plan: "test" },
  models: offered,
  lockdownProven: true,
});
const runs = [];
const realStart = fakeAdapter.start;
fakeAdapter.start = async (options) => {
  runs.push({ model: options.model, effort: options.effort, mcp: Boolean(options.mcp) });
  return realStart(options);
};

const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true } });
getDatabase().prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(world.owner.id);
campaigns.updateStorySettings(world.campaignId, { textProvider: "harness", imageGenerationEnabled: false, autoImages: false });
world.addHero({ name: "Aria", race: "elf", class: "ranger" });

const companion = (name) => {
  const sheet = world.addHero({ name, race: "dwarf", class: "fighter" });
  markSheetAsCompanion(sheet.id, "party", "Steady.");
  setCompanionCommander(sheet.id, null);
  companionNpcFor(getSheetById(sheet.id));
  return sheet;
};
const brann = companion("Brann");
const tobin = companion("Tobin");

const route = await import("../src/app/api/campaigns/[campaignId]/companions/[characterId]/mind/route.ts");
const params = (sheet) => ({ params: Promise.resolve({ campaignId: world.campaignId, characterId: sheet.id }) });
const patch = (sheet, body) =>
  route.PATCH(new Request("http://x/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(sheet));
const speakAs = async (name) => {
  runs.length = 0;
  const result = await mind.handleNpcSpeak(world.campaign(), JSON.stringify({ name, perceives: "The road is quiet." }));
  assert.ok(!result.error, `the mind answered: ${JSON.stringify(result)}`);
  return runs.at(-1);
};

await test("the route offers the program's models and refuses what it does not offer, only to whoever runs the story", async () => {
  world.signIn(world.owner);
  const read = await route.GET(new Request("http://x/"), params(brann));
  const body = await read.json();
  assert.equal(read.status, 200);
  assert.deepEqual(body.offer.models.map((model) => model.id), ["gpt-table", "gpt-deep"]);
  assert.equal(body.offer.tableModel, "gpt-table");
  assert.equal(body.choice, null);
  assert.equal((await patch(brann, { model: "gpt-none", effort: "" })).status, 400, "a model the program does not offer");
  assert.equal((await patch(brann, { model: "gpt-deep", effort: "medium" })).status, 400, "an effort the model does not offer");
  assert.equal((await patch(brann, { model: "gpt-deep", effort: "xhigh" })).status, 200);
  assert.deepEqual(getNpcMindModel(companionNpcFor(getSheetById(brann.id)).id), { model: "gpt-deep", effort: "xhigh" });
  const stranger = world.addUser("stranger");
  getDatabase()
    .prepare(`INSERT INTO campaign_members (campaign_id, user_id, role, ready, joined_at) VALUES (?, ?, 'player', 0, ?)`)
    .run(world.campaignId, stranger.id, new Date().toISOString());
  world.signIn(stranger);
  assert.notEqual((await patch(brann, { model: "", effort: "" })).status, 200, "a player who does not run the story cannot change it");
  world.signIn(world.owner);
});

await test("a mind with its own choice thinks with it; one without runs on the table's route, as before", async () => {
  const own = await speakAs("Brann");
  assert.deepEqual({ model: own.model, effort: own.effort }, { model: "gpt-deep", effort: "xhigh" });
  const table = await speakAs("Tobin");
  assert.deepEqual({ model: table.model, effort: table.effort }, { model: "gpt-table", effort: "medium" });
});

await test("an effort alone runs on the table's model at that effort", async () => {
  assert.equal((await patch(tobin, { model: "", effort: "high" })).status, 200);
  const run = await speakAs("Tobin");
  assert.deepEqual({ model: run.model, effort: run.effort }, { model: "gpt-table", effort: "high" });
  assert.equal((await patch(tobin, { model: "", effort: "" })).status, 200, "cleared again");
  assert.equal(getNpcMindModel(companionNpcFor(getSheetById(tobin.id)).id), null);
});

await test("a model the program stopped offering falls back to the table's, with a line in the log", async () => {
  offered = OFFERED.filter((model) => model.id !== "gpt-deep");
  const { probeHarness } = await import("../src/lib/harness/status.ts");
  await probeHarness("codex", { refresh: true });
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    const run = await speakAs("Brann");
    assert.equal(run.model, "gpt-table");
    assert.equal(run.effort, "medium", "its effort is not the table model's to take");
  } finally {
    console.warn = realWarn;
    offered = OFFERED;
    await probeHarness("codex", { refresh: true });
  }
  assert.ok(warned.some((line) => /gpt-deep" is no longer offered/.test(line)), warned.join("\n"));
});

await test("the characters' model set beside the story's is what minds without their own choice think with; a companion's own wins", async () => {
  const harness = { id: "codex", model: "gpt-table", utilityModel: "", effort: "medium", campaigns: "all", maxConcurrent: 4, turnTimeoutSec: 60 };
  saveGlobalConfig({ harness: { ...harness, mindModel: "gpt-deep", mindEffort: "high" } });
  try {
    const plain = await speakAs("Tobin");
    assert.deepEqual({ model: plain.model, effort: plain.effort }, { model: "gpt-deep", effort: "high" }, "no choice of its own: the characters' model");
    assert.equal((await patch(tobin, { model: "", effort: "low" })).status, 200);
    const effortOnly = await speakAs("Tobin");
    assert.deepEqual({ model: effortOnly.model, effort: effortOnly.effort }, { model: "gpt-deep", effort: "low" }, "its own effort on the characters' model");
    assert.equal((await patch(tobin, { model: "", effort: "" })).status, 200);
    const own = await speakAs("Brann");
    assert.deepEqual({ model: own.model, effort: own.effort }, { model: "gpt-deep", effort: "xhigh" }, "its own choice wins");
    runs.length = 0;
    await requestDmMessage(world.campaign().settings, [{ role: "user", content: "Narrate." }], {});
    assert.equal(runs.at(-1)?.model, "gpt-table", "the narrator stays on the story model");
    runs.length = 0;
    await requestUtilityMessage(world.campaign().settings, [{ role: "user", content: "Summarize." }], {});
    assert.equal(runs.at(-1)?.model, "gpt-table", "bookkeeping stays on its own model");
  } finally {
    saveGlobalConfig({ harness: { ...harness, mindModel: "", mindEffort: "" } });
  }
});

await test("Claude Code as the table's program offers its own models the same way", async () => {
  const harness = { id: "claude", model: "sonnet", utilityModel: "", effort: "", campaigns: "all", maxConcurrent: 4, turnTimeoutSec: 60 };
  saveGlobalConfig({ harness });
  offered = [
    { id: "sonnet", label: "Sonnet", efforts: ["low", "medium", "high"] },
    { id: "opus", label: "Opus", efforts: ["low", "high", "max"] },
  ];
  try {
    const answer = await (await route.GET(new Request("http://x/"), params(tobin))).json();
    assert.deepEqual(answer.offer?.models.map((model) => model.id), ["sonnet", "opus"]);
    assert.equal((await patch(tobin, { model: "opus", effort: "max" })).status, 200);
    const run = await speakAs("Tobin");
    assert.deepEqual({ model: run.model, effort: run.effort }, { model: "opus", effort: "max" });
    assert.equal((await patch(tobin, { model: "", effort: "" })).status, 200);
  } finally {
    offered = OFFERED;
    saveGlobalConfig({ harness: { ...harness, id: "codex", model: "gpt-table", effort: "medium" } });
  }
});

await test("the characters' effort lists what their model offers, and a model change drops an effort it lacks", async () => {
  const { mindEffortChoices, withOfferedEffort } = await import("../src/lib/harness/effort-choices.ts");
  const program = { models: OFFERED };
  assert.deepEqual(mindEffortChoices(program, { model: "gpt-table", utilityModel: "", mindModel: "gpt-deep" }), ["", "low", "high", "xhigh"]);
  assert.deepEqual(mindEffortChoices(program, { model: "gpt-table", utilityModel: "", mindModel: "" }), ["", "low", "medium", "high"], "blank follows the bookkeeping, here the story model");
  const moved = withOfferedEffort(program, { model: "gpt-table", utilityModel: "", effort: "", mindModel: "gpt-table", mindEffort: "xhigh" });
  assert.equal(moved.mindEffort, "");
});

await test("the narrator's own calls are untouched by a mind's choice", async () => {
  runs.length = 0;
  await requestDmMessage(world.campaign().settings, [{ role: "user", content: "Narrate." }], {});
  assert.equal(runs.at(-1)?.model, "gpt-table");
  runs.length = 0;
  await requestUtilityMessage(world.campaign().settings, [{ role: "user", content: "Summarize." }], {});
  assert.equal(runs.at(-1)?.model, "gpt-table", "upkeep without a mind's choice keeps the table's");
});

await test("reverting a later turn and a restart keep the choice", async () => {
  const npcId = companionNpcFor(getSheetById(brann.id)).id;
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  await runInTurnScope(turn.id, async () => {
    await mind.handleNpcSpeak(world.campaign(), JSON.stringify({ name: "Brann", perceives: "A cart passes." }));
  });
  await revertTurn(world, turn.id);
  assert.deepEqual(getNpcMindModel(npcId), { model: "gpt-deep", effort: "xhigh" });
  closeDatabaseForRestore();
  assert.deepEqual(getNpcMindModel(npcId), { model: "gpt-deep", effort: "xhigh" });
});

fakeAdapter.start = realStart;
finish();
