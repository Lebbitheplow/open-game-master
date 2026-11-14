// Issue 942: a turn on a local Qwen3.6 narrator read its whole 54K-token
// prompt again, six minutes on a 16 GB card, before its first word. The
// narrator's cache restarts at a message boundary (Qwen's hybrid layers), so
// any change to the first message (the rules and the tool list) costs the
// whole prompt, and the warm-up that reads it ahead (src/lib/dm/turn-warmup.ts)
// ran only when a turn ended. A change made between turns was never read
// ahead: a hero opened to advances (the relationship rules' line and
// relationship_scheme, the report's exact signature), the lead's narration
// length, a prepared fight saved, and a narrator that held nothing after a
// restart. Real turns against a fake OpenAI-compatible server, which records
// what the warm-up sends and what the next turn's first call sends.
//
// Usage: node scripts/test-turn-warmup-between-turns.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { answerReader, isReaderRequest } from "./lib/claims-reader.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-warmup-between-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "65536";
// The suites' setup turns the warm-up off; this suite is about it.
process.env.DM_TURN_WARMUP = "1";
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, updateStorySettings, updateGameSettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { createSheet, setOpenToAdvances } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { publishPersisted, subscribe } = await import("../src/lib/events.ts");
const { setDmStatus } = await import("../src/lib/dm/status.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
};

const NARRATION = "The corridor stretches on into the dark, the survivor close behind. What do you do?";
let log = [];
let sheetId = "";
const sse = (res, deltas) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
};
const isWarmup = (body) => body.messages?.length === 2 && /The table is reading/.test(String(body.messages[1].content));
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (isReaderRequest(body)) {
      answerReader(res);
      return;
    }
    log.push({ kind: isWarmup(body) ? "warmup" : "call", body });
    sse(res, [{ content: isWarmup(body) ? "." : NARRATION }]);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });

function table(title, gameSettings = {}) {
  const campaign = createCampaign(lead.id, {
    title,
    description: "Warm-up between turns.",
    theme: "ruined temple",
    maxPlayers: 2,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false, ...gameSettings },
  });
  // A local llama.cpp narrator under the report's model, so the turn takes
  // the full profile and the warm-up runs.
  updateStorySettings(campaign.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "qwen3.6-35b", imageGenerationEnabled: false, autoImages: false });
  setCampaignStatus(campaign.id, "active");
  const sheet = createSheet(campaign.id, lead.id, 1, createSheetSchema.parse({
    name: "Jason",
    race: "human",
    class: "fighter",
    abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    maxHp: 12,
    ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
  }));
  sheetId = sheet.id;
  return campaign;
}
const say = (campaign, content) =>
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: sheetId, content });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const headOf = (body) => JSON.stringify([body.messages[0].content, body.tools ?? []]);
// The warm-up check waits a moment after a change (turn-warmup.ts SETTLE_MS).
async function warmupsAfter(mark, { atLeast = 1, ms = 4_000 } = {}) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const sent = log.slice(mark).filter((entry) => entry.kind === "warmup");
    if (sent.length >= atLeast) {
      return sent;
    }
    await sleep(100);
  }
  return log.slice(mark).filter((entry) => entry.kind === "warmup");
}

// One turn, a change between turns, then the next turn: the narrator must
// already hold what that turn's first call sends.
async function betweenTurns(name, change, gameSettings) {
  log = [];
  const campaign = table(name, gameSettings);
  say(campaign, "I search the body.");
  await startDmTurn(campaign.id);
  await sleep(2_000);
  const before = headOf(log.find((entry) => entry.kind === "call").body);
  const mark = log.length;
  await change(campaign);
  const warmed = await warmupsAfter(mark);
  const next = log.length;
  say(campaign, "Before progressing, I look in the journal.");
  await startDmTurn(campaign.id);
  const first = log.slice(next).find((entry) => entry.kind === "call");
  return { before, warmed, after: headOf(first.body) };
}

await check("a hero opened to advances between turns is read ahead (the report's signature)", async () => {
  const result = await betweenTurns(
    "Opened to advances",
    () => {
      const saved = setOpenToAdvances(sheetId, true);
      publishPersisted(saved.campaignId, "sheet_updated", { sheet: saved });
    },
    { relationships: "on", romance: "on" },
  );
  assert.notEqual(result.after, result.before, "the change rewrote the first message");
  assert.equal(result.warmed.length, 1, "one warm-up was sent");
  assert.equal(headOf(result.warmed[0].body), result.after, "the narrator holds what the next turn sends");
  assert.ok(result.warmed[0].body.tools.some((tool) => tool.function.name === "relationship_scheme"));
});

await check("the lead's narration length changed between turns is read ahead", async () => {
  const result = await betweenTurns("Narration length", (campaign) => {
    updateGameSettings(campaign.id, { narrationLength: "short" });
    publishPersisted(campaign.id, "campaign_updated", {});
  });
  assert.notEqual(result.after, result.before);
  assert.equal(result.warmed.length, 1);
  assert.equal(headOf(result.warmed[0].body), result.after);
});

await check("a prepared fight saved between turns is read ahead, with no event of its own", async () => {
  const result = await betweenTurns("Prepared fight", (campaign) => {
    insertEncounterTemplate({ campaignId: campaign.id, name: "Crypt ambush", enemies: [{ monster: "giant-rat", count: 2 }], battlefield: "", map: {}, notes: "", createdByUserId: lead.id });
  });
  assert.notEqual(result.after, result.before);
  assert.equal(result.warmed.length, 1);
  assert.equal(headOf(result.warmed[0].body), result.after);
  assert.ok(result.warmed[0].body.tools.some((tool) => tool.function.name === "run_prepared_encounter"));
});

await check("an event that changes nothing of the first message sends nothing", async () => {
  const result = await betweenTurns("Nothing changed", (campaign) => {
    publishPersisted(campaign.id, "campaign_updated", {});
  });
  assert.equal(result.after, result.before);
  assert.equal(result.warmed.length, 0, "the narrator already held it");
});

await check("someone sitting down at a table the narrator holds nothing of (a restart) is read ahead", async () => {
  log = [];
  const campaign = table("After a restart");
  say(campaign, "I search the body.");
  await startDmTurn(campaign.id);
  await sleep(2_000);
  // What a restart forgets: what the narrator was last sent.
  globalThis.__odmTurnHeads?.clear();
  const mark = log.length;
  const leave = subscribe(campaign.id, () => {}, lead.id);
  const warmed = await warmupsAfter(mark);
  leave();
  const next = log.length;
  say(campaign, "Before progressing, I look in the journal.");
  await startDmTurn(campaign.id);
  const first = log.slice(next).find((entry) => entry.kind === "call");
  assert.equal(warmed.length, 1);
  assert.equal(headOf(warmed[0].body), headOf(first.body));
});

await check("a change while a turn runs waits for the turn's own end", async () => {
  log = [];
  const campaign = table("Mid-turn change", { relationships: "on", romance: "on" });
  say(campaign, "I search the body.");
  await startDmTurn(campaign.id);
  await sleep(2_000);
  setDmStatus(campaign.id, "thinking");
  const mark = log.length;
  const saved = setOpenToAdvances(sheetId, true);
  publishPersisted(campaign.id, "sheet_updated", { sheet: saved });
  assert.equal((await warmupsAfter(mark, { ms: 2_500 })).length, 0, "nothing is sent beside a running turn");
  setDmStatus(campaign.id, "idle");
});

server.close();
removeTempDir(dir);
console.log(`PASS: ${passed} checks: a change between turns, or a table sat down at, is read ahead before the next turn.`);
