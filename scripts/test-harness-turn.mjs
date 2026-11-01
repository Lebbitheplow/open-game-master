// End to end: an agent program narrates a real DM turn through ODM's MCP
// endpoint, over real HTTP, and is held to the same rules as the built-in
// storyteller. The program is the scripted fake (src/lib/harness/adapters/
// fake.ts), which calls tools over MCP exactly as Claude Code or opencode do.
// Also covers the MCP door itself: who may knock, from where, with what.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-turn-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_API_KEY = "sk-server-secret-never-leaks-1234";
process.env.HARNESS_FAKE = "1";
process.env.HARNESS_FAKE_SCRIPT = path.join(dir, "script.json");
process.env.DM_THINKING = "0";
register("./lib/register-alias.mjs", import.meta.url);

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createUser, getSessionUser, deleteSessionsForUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, updateStorySettings, allocateSeq } = await import(
  "../src/lib/db/campaigns.ts"
);
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, getLatestDmMessage } = await import("../src/lib/db/messages.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { handleMcpRequest } = await import("../src/lib/agents/mcp-server.ts");
const { activeBridgeSessions, requestHarnessMessage, releaseHarnessConversation, NARRATE_NOW } = await import(
  "../src/lib/harness/bridge.ts"
);
const { HARNESS_PREAMBLE } = await import("../src/lib/harness/render.ts");
const { createConnectionGrant, revokeConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { recentAgentActivity } = await import("../src/lib/agents/activity.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

// One loopback server: /api/mcp is ODM's real handler; everything else
// stands in for the web routes a connected agent's tools call, recording the
// bearer each one arrived with.
const routeHits = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  if (req.url === "/api/mcp") {
    const response = await handleMcpRequest(
      new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  routeHits.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? "", body: body.toString() });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ campaigns: [{ id: "c-pinned", title: "Pinned" }, { id: "c-other", title: "Other" }] }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
process.env.HARNESS_MCP_URL = `http://127.0.0.1:${port}/api/mcp`;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

function script(turns) {
  fs.writeFileSync(process.env.HARNESS_FAKE_SCRIPT, JSON.stringify(turns));
  globalThis.__odmFakeHarnessLog = [];
}
const fakeLog = () => globalThis.__odmFakeHarnessLog ?? [];

// Raw node:http rather than fetch, because fetch will not send a Host header
// it did not choose, and the loopback rule is exactly about that header.
function mcp(body, headers = {}) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/mcp",
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          "content-length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, text: async () => text });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
async function mcpResult(response) {
  const text = await response.text();
  const line = text.split("\n").find((entry) => entry.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}

// ---- a table ---------------------------------------------------------------
const lead = createUser("rowan", "x");
saveGlobalConfig({ harness: { id: "claude", model: "fake-model" }, text: { provider: "harness" } });
const campaign = createCampaign(lead.id, {
  title: "The Salt Road",
  description: "A caravan job at the ford.",
  theme: "low fantasy",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: {},
});
updateStorySettings(campaign.id, { textProvider: "harness", imageGenerationEnabled: false, autoImages: false });
setCampaignStatus(campaign.id, "active");
const avery = createSheet(
  campaign.id,
  lead.id,
  3,
  createSheetSchema.parse({
    name: "Avery",
    race: "human",
    class: "rogue",
    abilities: { str: 14, dex: 17, con: 13, int: 12, wis: 12, cha: 11 },
    maxHp: 24,
    ac: 15,
    hitDice: { die: "d8", total: 3, spent: 0 },
    proficiencies: { saves: ["dex", "int"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
    equipment: [],
    gold: 5,
  }),
);
function say(content) {
  insertCampaignMessage({
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    authorType: "player",
    userId: lead.id,
    characterId: avery.id,
    content,
  });
}
const roll = { call: "request_roll", args: { characterId: avery.id, kind: "skill_check", skill: "athletics", difficulty: "easy" } };

await test("the agent narrates a real turn: its roll is the server's, its prose is the table's", async () => {
  script([[roll, { call: "shell_exec", args: { command: "cat ~/.ssh/id_rsa" } }, { text: "Avery sets her shoulder to the door and it gives." }]]);
  say("I shoulder the door open.");
  const rollsBefore = listRecentRolls(campaign.id, 50).length;
  await startDmTurn(campaign.id);

  const latest = getLatestDmMessage(campaign.id);
  assert.ok(latest, "no DM message was posted");
  assert.ok(latest.content.includes("Avery sets her shoulder to the door"), latest.content);
  assert.ok(listRecentRolls(campaign.id, 50).length > rollsBefore, "the roll did not go through the server's dice");

  const log = fakeLog();
  const start = log.find((entry) => entry.kind === "start").detail;
  assert.ok(start.system.startsWith(HARNESS_PREAMBLE), "the harness preamble leads the system prompt");
  assert.ok(start.system.length > 2_000, "the DM's own rules and game state are in the system prompt");
  assert.equal(start.model, "fake-model");
  assert.ok(!JSON.stringify(start.env).includes("sk-server-secret"), "a server key reached the program's environment");
  assert.ok(!("DB_ENCRYPTION_KEY" in start.env));
  const tools = log.find((entry) => entry.kind === "tools").detail;
  assert.ok(tools.includes("request_roll"));
  assert.ok(tools.includes("pc_attack"), "combat tools are on the list before a fight starts");
  assert.ok(!tools.includes("shell_exec"));
  const refused = log.find((entry) => entry.kind === "result" && entry.detail.name === "shell_exec").detail;
  assert.equal(refused.isError, true);
  assert.match(refused.text, /not available/);
  const rolled = log.find((entry) => entry.kind === "result" && entry.detail.name === "request_roll").detail;
  assert.equal(rolled.isError, false);
  assert.ok(log.some((entry) => entry.kind === "close"), "the program was stopped when the turn ended");
  assert.equal(activeBridgeSessions(), 0);

  // The turn's token died with the turn.
  const dead = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { authorization: `Bearer ${start.token}` });
  assert.equal(dead.status, 401);
  assert.ok(recentAgentActivity({ limit: 20 }).some((row) => row.tool === "request_roll" && row.grantKind === "turn"));
});

await test("the agent works under the same call budget: the last call is narration only", async () => {
  script([[roll, roll, roll, roll, { text: "The door holds, then holds no more." }]]);
  say("I try again. And again.");
  await startDmTurn(campaign.id);
  const results = fakeLog().filter((entry) => entry.kind === "result" && entry.detail.name === "request_roll");
  assert.equal(results.length, 4);
  assert.deepEqual(results.slice(0, 3).map((entry) => entry.detail.isError), [false, false, false]);
  assert.equal(results[3].detail.isError, true, "a fourth round of tools must be refused");
  assert.equal(results[3].detail.text, NARRATE_NOW);
  // The refused call is said not to have happened, so it is not narrated as done.
  assert.match(NARRATE_NOW, /did not happen/);
  assert.ok(getLatestDmMessage(campaign.id).content.includes("The door holds, then holds no more."));
});

// A call refused for narration only did not happen: what the program wrote
// before it may tell it as done, or be a draft it rewrites after the refusal.
await test("what the program writes after a refused call is the narration; what came before it is dropped", async () => {
  script([[roll, roll, roll, { text: "Now she steps back 20 feet." }, roll, { text: "The door holds, then holds no more." }]]);
  say("I try again, then step back.");
  await startDmTurn(campaign.id);
  const content = getLatestDmMessage(campaign.id).content;
  assert.ok(content.includes("The door holds, then holds no more."), content);
  assert.ok(!content.includes("steps back"), "the text before the refused call reached the players");
});

await test("a program that writes nothing after the refused call keeps its latest draft", async () => {
  script([[roll, roll, roll, { text: "The door holds, then holds no more." }, roll]]);
  say("I try again.");
  await startDmTurn(campaign.id);
  assert.ok(getLatestDmMessage(campaign.id).content.includes("The door holds, then holds no more."));
});

await test("several takes around refused calls leave the last one alone", async () => {
  script([[roll, roll, roll, { text: "First take." }, roll, { text: "Second take." }, roll, { text: "Third take." }]]);
  say("I try once more.");
  await startDmTurn(campaign.id);
  const content = getLatestDmMessage(campaign.id).content;
  assert.ok(content.includes("Third take."), content);
  assert.ok(!content.includes("First take.") && !content.includes("Second take."), content);
});

// Grok Build reports each tool call it starts, its own or ODM's
// (tool_round). Played as the storyteller, it wrote a note on the scene
// before calling a tool, and the note reached the table; text before one of
// its own tools ran into the text after it ("the village.Mother Hesk").
await test("a note written before a tool call is not the narration: the table reads what came after", async () => {
  script([[{ text: "Mother Hesk is already on the green, and Kara has asked her outright." }, { round: true }, roll, { text: "\"Three nights ago,\" Mother Hesk says. \"The bell stayed still.\"" }]]);
  say("Mother Hesk? What happened to the bell?");
  await startDmTurn(campaign.id);
  const content = getLatestDmMessage(campaign.id).content;
  assert.ok(content.includes("Three nights ago"), content);
  assert.ok(!content.includes("already on the green"), "the note before the tool call reached the players");
});

await test("text before and after one of the program's own tools does not run together", async () => {
  script([[{ text: "Kara is calling for whoever runs the village." }, { round: true }, { text: "Mother Hesk turns from the green and lifts a hand." }]]);
  say("Hello? Who's in charge here?");
  await startDmTurn(campaign.id);
  const content = getLatestDmMessage(campaign.id).content;
  assert.ok(!content.includes("village.Mother"), content);
  assert.ok(content.includes("Mother Hesk turns from the green"), content);
  assert.ok(!content.includes("Kara is calling"), content);
});

await test("a program that writes nothing after its tool call keeps what it wrote before", async () => {
  script([[{ text: "The fog lifts off the river, and the chapel hill stands silent." }, { round: true }]]);
  say("I look around.");
  await startDmTurn(campaign.id);
  assert.ok(getLatestDmMessage(campaign.id).content.includes("The fog lifts off the river"));
});

await test("a signed-out program halts the turn with a message the table can act on", async () => {
  const { probeHarness } = await import("../src/lib/harness/status.ts");
  assert.equal((await probeHarness("claude", { refresh: true })).auth.state, "ready");
  script([[{ fail: "signed-out", message: "OAuth session expired and could not be refreshed" }]]);
  say("I look around.");
  await startDmTurn(campaign.id);
  const latest = getLatestDmMessage(campaign.id);
  const { listRecentMessages } = await import("../src/lib/db/messages.ts");
  const system = listRecentMessages(campaign.id, 5).filter((message) => message.authorType === "system").pop();
  assert.ok(system && /signed out/i.test(system.content), `expected a signed-out halt, got ${system?.content}`);
  assert.ok(!latest.content.includes("I look around"), "no narration was invented");
  assert.equal(activeBridgeSessions(), 0);
  // The admin page reads the cached status: the halted turn makes it say
  // "Sign in needed" at once, not "Ready" until the cache runs out (#713).
  assert.equal((await probeHarness("claude")).auth.state, "signed-out");
});

await test("the admin page asks the saved program again on every load; the others keep their cached answer", async () => {
  const { probeAllHarnesses, probeHarness } = await import("../src/lib/harness/status.ts");
  const before = await probeHarness("codex");
  const saved = (await probeHarness("claude")).checkedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const statuses = await probeAllHarnesses({ fresh: "claude" });
  const claude = statuses.find((status) => status.id === "claude");
  assert.ok(claude.checkedAt > saved, "the saved program was asked again");
  assert.equal(claude.auth.state, "ready", "and a sign-in that came back reads Ready");
  assert.equal(statuses.find((status) => status.id === "codex").checkedAt, before.checkedAt, "the others stay cached");
});

// The program's text goes through the same loop guard as a model's stream
// (src/lib/stream-repetition.ts).
const PASSAGE =
  "Avery braces against the door as the hinges shriek, and somewhere beyond it a bell begins to toll, slow and heavy, counting out the hours left before the tide comes in.";
const LOOP = (PASSAGE + "\n\n").repeat(6);
const appearances = (text) => text.split(PASSAGE).length - 1;

await test("a program that starts repeating itself while it may still call tools is stopped, and the turn halts with the notice", async () => {
  script([[{ text: LOOP }, roll]]);
  say("I listen at the door.");
  const before = getLatestDmMessage(campaign.id)?.id;
  await startDmTurn(campaign.id);
  const { listRecentMessages } = await import("../src/lib/db/messages.ts");
  const system = listRecentMessages(campaign.id, 5).filter((message) => message.authorType === "system").pop();
  assert.ok(system && /repeating the same long passage/.test(system.content), `expected the repetition halt, got ${system?.content}`);
  assert.equal(getLatestDmMessage(campaign.id)?.id, before, "the loop was posted as narration");
  assert.ok(!fakeLog().some((entry) => entry.kind === "call"), "the program went on to call a tool");
  assert.ok(fakeLog().some((entry) => entry.kind === "close"), "the program was not stopped");
  assert.equal(activeBridgeSessions(), 0);
});

await test("a program that loops in the narration-only last call keeps the first copy as the narration", async () => {
  script([[roll, roll, roll, roll, { text: LOOP }]]);
  say("I try the door until it gives.");
  await startDmTurn(campaign.id);
  const content = getLatestDmMessage(campaign.id).content;
  assert.equal(appearances(content), 1, content);
  assert.equal(activeBridgeSessions(), 0);
});

await test("a completion that loops is settled with its first copy and the program stopped", async () => {
  script([[{ text: LOOP }]]);
  let shown = "";
  const messages = [{ role: "system", content: "s" }, { role: "user", content: "Continue the scene." }];
  const streamed = await requestHarnessMessage(messages, { toolChoice: "none", onDelta: (text) => (shown += text) }, { role: "story" });
  assert.equal(streamed.message.content, PASSAGE);
  assert.equal(streamed.finishReason, "repetition");
  assert.equal(shown, "", "the looping delta reached the table");
  assert.ok(fakeLog().some((entry) => entry.kind === "close"));

  // Bookkeeping, which streams nothing and is not narration, is left as it came.
  script([[{ text: LOOP }]]);
  const summary = await requestHarnessMessage(messages, {}, { role: "utility" });
  assert.equal(summary.message.content, LOOP.trim());
});

await test("an admins-only server refuses the agent to a campaign a player leads", async () => {
  const player = createUser("bram", "x");
  const theirs = createCampaign(player.id, {
    title: "Bram's table",
    description: "",
    theme: "",
    maxPlayers: 2,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: {},
  });
  saveGlobalConfig({ harness: { campaigns: "admins" } });
  script([[{ text: "should never run" }]]);
  const result = await requestHarnessMessage(
    [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    { tools: [], toolChoice: "none" },
    { role: "story", campaignId: theirs.id },
  );
  assert.ok(result.error, "expected a refusal");
  const body = await result.error.json();
  assert.match(body.error, /administrator leads/);
  assert.equal(fakeLog().length, 0, "the program was never started");
  saveGlobalConfig({ harness: { campaigns: "all" } });
});

await test("a turn token works only from this machine and only while its turn lives", async () => {
  script([[{ wait: 1500 }, { text: "done" }]]);
  const messages = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
  const pending = requestHarnessMessage(messages, { tools: [roll && { type: "function", function: { name: "request_roll", parameters: { type: "object" } } }] }, { role: "story" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const token = fakeLog().find((entry) => entry.kind === "start").detail.token;
  const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
  const remote = await mcp(list, { authorization: `Bearer ${token}`, host: "dungeon.example.org" });
  assert.equal(remote.status, 403, "a turn token from a non-loopback host must be refused");
  const browser = await mcp(list, { authorization: `Bearer ${token}`, origin: "https://evil.example" });
  assert.equal(browser.status, 403, "a browser origin must be refused");
  const local = await mcp(list, { authorization: `Bearer ${token}` });
  assert.equal(local.status, 200);
  assert.deepEqual((await mcpResult(local)).result.tools.map((tool) => tool.name), ["request_roll"]);
  const answer = await pending;
  assert.equal(answer.message.content, "done");
  releaseHarnessConversation(messages);
  assert.equal((await mcp(list, { authorization: `Bearer ${token}` })).status, 401);
});

await test("the door is shut without a token and to unknown ones", async () => {
  const list = { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} };
  assert.equal((await mcp(list)).status, 401);
  assert.equal((await mcp(list, { authorization: "Bearer odm_nope" })).status, 401);
  assert.equal((await mcp(list, { authorization: `Bearer ${randomBytes(32).toString("base64url")}` })).status, 401);
  const get = await fetch(`http://127.0.0.1:${port}/api/mcp`, { method: "GET" });
  assert.ok(get.status === 401 || get.status === 405);
});

await test("a connected agent sees only the tool groups its player ticked", async () => {
  const { grant, token } = createConnectionGrant({ userId: lead.id, name: "Claude on the laptop", scopes: ["read"], campaignId: null });
  const auth = { authorization: `Bearer ${token}` };
  const listed = await mcpResult(await mcp({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }, auth));
  const names = listed.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("odm_whoami"));
  assert.ok(names.includes("odm_list_campaigns"));
  assert.ok(!names.includes("odm_take_action"), "play tools without the play scope");
  assert.ok(!names.includes("odm_dm_invoke"), "DM tools without the dm scope");
  assert.ok(!names.some((name) => /key|password|admin|backup/.test(name)));

  const acted = await mcpResult(
    await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "odm_take_action", arguments: { campaignId: campaign.id, content: "x" } } }, auth),
  );
  assert.equal(acted.result.isError, true);

  // A tool runs as the player through the web route, on a short-lived
  // session that belongs to that player and nobody else.
  routeHits.length = 0;
  const read = await mcpResult(
    await mcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "odm_list_campaigns", arguments: {} } }, auth),
  );
  assert.equal(read.result.isError, undefined);
  assert.equal(routeHits[0].url, "/api/campaigns");
  const bearer = routeHits[0].authorization.replace(/^Bearer /, "");
  assert.notEqual(bearer, token, "the agent's own token is never used as a login");
  assert.equal(getSessionUser(createHash("sha256").update(bearer).digest("hex"))?.id, lead.id);

  revokeConnectionGrant(lead.id, grant.id);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }, auth)).status, 401);
  assert.equal(getSessionUser(createHash("sha256").update(bearer).digest("hex")), null, "its web session went with it");
});

await test("a connection pinned to one campaign cannot reach another, and path ids are checked", async () => {
  const { token } = createConnectionGrant({ userId: lead.id, name: "pinned", scopes: ["read"], campaignId: campaign.id });
  const auth = { authorization: `Bearer ${token}` };
  const other = await mcpResult(
    await mcp({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "odm_get_campaign", arguments: { campaignId: "c-other" } } }, auth),
  );
  assert.equal(other.result.isError, true);
  assert.match(other.result.content[0].text, /different campaign/);
  const traversal = await mcpResult(
    await mcp({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "odm_get_character", arguments: { characterId: "../../admin/settings" } } }, auth),
  );
  assert.equal(traversal.result.isError, true);
  assert.match(traversal.result.content[0].text, /not valid/);
});

await test("signing a player out everywhere disconnects their agents", async () => {
  const { token } = createConnectionGrant({ userId: lead.id, name: "to be reset", scopes: ["read"], campaignId: null });
  deleteSessionsForUser(lead.id);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 10, method: "tools/list", params: {} }, { authorization: `Bearer ${token}` })).status, 401);
});

server.close();
removeTempDir(dir);
// ---- a program inside a container (issue #132) ------------------------------
// The Docker image cannot start programs on its host, but one installed
// inside the container (npm install -g @openai/codex) is local to it. The
// container verdict therefore stands only when nothing is found inside.
{
  const { probeHarness, forgetHarnessStatus } = await import("../src/lib/harness/status.ts");
  process.env.ODM_IN_CONTAINER = "1";
  try {
    forgetHarnessStatus();
    // HARNESS_FAKE resolves the binary to this node, i.e. "found inside".
    const found = await probeHarness("codex", { refresh: true });
    assert.equal(found.availability, "ok", found.message);
    assert.equal(found.installed, true);
    passed += 1;

    // Nothing inside: the container message, worded so the admin knows a
    // program installed inside would be used.
    process.env.HARNESS_FAKE = "0";
    saveGlobalConfig({ harness: { id: "codex", binaryPath: path.join(dir, "no-such-program") } });
    forgetHarnessStatus();
    const missing = await probeHarness("codex", { refresh: true });
    assert.equal(missing.availability, "container");
    assert.equal(missing.installed, false);
    assert.match(missing.message, /installed inside the container is found/);
    passed += 1;
    console.log("ok: a program installed inside a container counts as available; none inside keeps the container verdict");
  } finally {
    process.env.HARNESS_FAKE = "1";
    delete process.env.ODM_IN_CONTAINER;
    saveGlobalConfig({ harness: { id: "claude", binaryPath: "" } });
    forgetHarnessStatus();
  }
}

console.log(`harness turn: ${passed} checks passed`);
