// A first-tier mind's own model on a table that runs on its own model
// server (ticket 09, docs/tickets/ogm-npc-isolation-design/09-modello-per-
// personaggio.md), against a fake OpenAI-compatible server:
//   - The companion's card offers the models the server lists, without
//     efforts, and refuses one it does not list.
//   - A companion with a choice thinks with that model on the same server;
//     one without thinks with the table's.
//   - A chosen model that fails falls back to the table's for that call.
//   - The admin's characters' model (an agent program's) does not leak onto
//     a table on its own server.
import assert from "node:assert/strict";
import http from "node:http";

const { openWorld } = await import("./lib/enforce-world.mjs");
const { suite } = await import("./lib/enforce-harness.mjs");
const { test, finish } = suite("test-npc-mind-model-server");

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { markSheetAsCompanion, setCompanionCommander, getSheetById } = await import("../src/lib/db/sheets.ts");
const { companionNpcFor } = await import("../src/lib/db/companion-npcs.ts");
const mind = await import("../src/lib/dm/npc-mind.ts");

const LISTED = ["table-model", "deep-model"];
const asked = [];
let failing = new Set();
const answer = JSON.stringify({ speech: "Aye.", intent: "", conclusion: "", lie: false });
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: LISTED.map((id) => ({ id, object: "model" })) }));
      return;
    }
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    asked.push(body.model);
    if (failing.has(body.model)) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "The model fell over.", type: "server_error" } }));
      return;
    }
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }] }));
  });
});
server.keepAliveTimeout = 0;
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
process.env.OPENAI_COMPAT_CONTEXT = process.env.OPENAI_COMPAT_CONTEXT ?? "65536";

// The admin's agent program has a characters' model; this table is not on it.
saveGlobalConfig({
  harness: { id: "codex", model: "gpt-table", utilityModel: "", effort: "", mindModel: "gpt-deep", mindEffort: "high", campaigns: "all", maxConcurrent: 4, turnTimeoutSec: 60 },
});

const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true } });
getDatabase().prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(world.owner.id);
campaigns.updateStorySettings(world.campaignId, {
  textProvider: "custom",
  customBaseUrl: baseUrl,
  customModel: "table-model",
  imageGenerationEnabled: false,
  autoImages: false,
});
world.addHero({ name: "Aria", race: "elf", class: "ranger" });
const companion = (name) => {
  const sheet = world.addHero({ name, race: "dwarf", class: "fighter" });
  markSheetAsCompanion(sheet.id, "party", "Steady.");
  setCompanionCommander(sheet.id, null);
  companionNpcFor(getSheetById(sheet.id));
  return sheet;
};
const brann = companion("Brann");
companion("Tobin");

const route = await import("../src/app/api/campaigns/[campaignId]/companions/[characterId]/mind/route.ts");
world.signIn(world.owner);
const params = (sheet) => ({ params: Promise.resolve({ campaignId: world.campaignId, characterId: sheet.id }) });
const patch = (sheet, body) =>
  route.PATCH(new Request("http://x/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(sheet));
const speakAs = async (name) => {
  asked.length = 0;
  const result = await mind.handleNpcSpeak(world.campaign(), JSON.stringify({ name, perceives: "The road is quiet." }));
  assert.ok(!result.error, `the mind answered: ${JSON.stringify(result)}`);
  return [...asked];
};

await test("the card offers the models the table's server lists, without efforts", async () => {
  const answer = await (await route.GET(new Request("http://x/"), params(brann))).json();
  assert.deepEqual(answer.offer?.models.map((model) => model.id), LISTED);
  assert.ok(answer.offer.models.every((model) => model.efforts.length === 0));
  assert.equal(answer.offer.tableModel, "table-model");
  assert.equal((await patch(brann, { model: "not-listed", effort: "" })).status, 400);
  assert.equal((await patch(brann, { model: "deep-model", effort: "high" })).status, 400, "no efforts on a model server");
});

await test("a companion's own model is what it thinks with on the same server; the others think with the table's", async () => {
  assert.equal((await patch(brann, { model: "deep-model", effort: "" })).status, 200);
  assert.deepEqual(await speakAs("Brann"), ["deep-model"]);
  assert.deepEqual(await speakAs("Tobin"), ["table-model"], "the admin's agent-program characters' model does not leak here");
});

await test("a chosen model that fails falls back to the table's for that call", async () => {
  failing = new Set(["deep-model"]);
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    const models = await speakAs("Brann");
    assert.equal(models.at(-1), "table-model");
    assert.ok(models.includes("deep-model"), "it asked its own model first");
    assert.ok(warned.some((line) => line.includes("deep-model")), "the log says so");
  } finally {
    console.warn = warn;
    failing = new Set();
  }
});

server.close();
await finish();
