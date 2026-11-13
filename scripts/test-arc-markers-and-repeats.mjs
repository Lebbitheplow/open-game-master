// Issues 941 and 942, both from Qwen3.6-35B on a desktop world:
// - 941: a scene ended on the story arc's bookkeeping, "[waypoint=3]" and
//   "The [NOW] beat is complete.", copied out of the GM's secret arc block;
// - 942: after two rolls the tools-closed narration was, word for word, the
//   GM's passage from four replies back (the loot of a body searched long
//   before), and one of the rolls was a custom "1d20+3" for "Dexterity
//   (Physical)" that read nothing of the sheet.
// The texts below are the reporter's, from the reports' transcripts. Pure
// helpers first, then the real turn machine against a fake
// OpenAI-compatible server on a throwaway database.
//
// Usage: node scripts/test-arc-markers-and-repeats.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { answerReader, isReaderRequest } from "./lib/claims-reader.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-arc-repeat-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "65536";

register("./lib/register-alias.mjs", import.meta.url);

const { ARC_MARKER } = await import("../src/lib/dm/tool-text.ts");
const { withoutAsides } = await import("../src/lib/dm/claims-logic.ts");
const { repeatsEarlierNarration, tableNarrationParts, withoutToolTalk } = await import("../src/lib/dm/narration-tidy-logic.ts");
const { createStreamingArtifactFilter } = await import("../src/lib/story-prompt.ts");
const { customRollIsCheck } = await import("../src/lib/dm/rolls.ts");
const { buildOneShotDirective } = await import("../src/lib/dm/director-logic.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { getDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { startDmTurn, MAX_MODEL_CALLS } = await import("../src/lib/dm/turn.ts");

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
};

// Issue 941's last GM passage, as the table read it.
const JOURNAL_SCENE =
  "With the journal secured and the survivor walking close behind, you stand in the moonlit chamber. The sealed door is open, the journal is in your hands, and the temple stretches out before you.\n\n[waypoint=3]\n\nThe [NOW] beat is complete. What do you do next?";
const JOURNAL_CLEAN =
  "With the journal secured and the survivor walking close behind, you stand in the moonlit chamber. The sealed door is open, the journal is in your hands, and the temple stretches out before you.\n\nWhat do you do next?";
// Issue 942: the passage the rescue wrote again, and the three after it.
const LOOT =
  "You crouch beside the massive corpse, your fingers working through the tattered leathers and heavy cloak. The Butcher's hands are calloused and stained with old blood. You find a heavy iron key tucked inside a leather pouch at his belt.\n\nThe key is old, rusted, and heavy, clearly meant for a lock of significant size. You also find a few copper pieces, a pouch of dried meat, and a crude map of the temple grounds, marked with several X's leading toward the sealed door.\n\nThe key glints in the moonlight as you hold it up. The sealed door at the end of the corridor awaits.\n\nWhat do you do next?";
const DOOR =
  "You slide the heavy iron key into the rusted lock. It meets resistance for a moment, then turns with a grinding screech that echoes through the corridor. In the center stands a stone pedestal, and on it rests a single, unassuming object: a leather-bound journal.";
const PLEA =
  "\"I can't go back to the village,\" he says, his voice trembling. The journal sits heavy in your hand, its pages fluttering in the draft. The survivor waits, hope and fear warring in his expression.";
const DEAL =
  "The survivor nods eagerly, relief washing over his face. He steps closer, still clutching his crude knife, his eyes scanning the shadows of the corridor. You hold the journal, feeling its worn cover beneath your fingers.";
const NARRATION =
  "The journal's last pages are a list of names in a cramped hand, each one crossed out but the final three. A loose page slips free and drifts to the stone. What do you do?";

// ---- the pure helpers --------------------------------------------------------
await check("the arc's markers are found, and story brackets are not", () => {
  for (const marked of ["[waypoint=3]", "The [NOW] beat is complete.", "[ahead] the gate", "waypoint 2 is done", "waypoint: 3", "1. [x] Find the key"]) {
    assert.ok(ARC_MARKER.test(marked), marked);
  }
  for (const story of ["A [faded] sign hangs crooked.", "The next waypoint on the old road is a ruined tower.", "Now is the time.", "\"[Now] then,\" she says"]) {
    assert.equal(ARC_MARKER.test(story), false, story);
  }
});

await check("a sentence holding an arc marker is cut from the reply, at any table", () => {
  for (const language of ["english", "italian"]) {
    // A cut leaves the next sentence's own space at the line's start; the
    // turn's tidy takes it (the turn checks below read the posted text).
    assert.equal(withoutAsides(JOURNAL_SCENE, [], language).replace(/^[ \t]+/gm, "").trim(), JOURNAL_CLEAN);
  }
  // A reply that was only the bookkeeping keeps nothing.
  assert.equal(withoutAsides("[waypoint=3]\n\nThe [NOW] beat is complete.", [], "english"), "");
});

await check("the turn's tidy cuts the same sentences (a reroll, a continued scene)", () => {
  assert.equal(withoutToolTalk(JOURNAL_SCENE).trim(), JOURNAL_CLEAN);
  assert.deepEqual(tableNarrationParts([JOURNAL_SCENE], [], "english"), [JOURNAL_CLEAN]);
});

await check("the draft never shows a bracketed arc marker as it streams", () => {
  const filter = createStreamingArtifactFilter();
  const chunks = ["The temple stretches out before you.\n\n[way", "point=3]\n\nThe [N", "OW] beat is complete."];
  const streamed = chunks.map((chunk) => filter.push(chunk)).join("") + filter.flush();
  assert.ok(!/\[waypoint|\[NOW\]/.test(streamed), streamed);
});

await check("an earlier passage said again is found, not only the newest", () => {
  const recent = [LOOT, DOOR, PLEA, DEAL];
  assert.equal(repeatsEarlierNarration(LOOT, recent), true);
  assert.equal(repeatsEarlierNarration(NARRATION, recent), false);
  // A reply that shares one line with a passage is new.
  assert.equal(repeatsEarlierNarration(`${NARRATION} The key glints in the moonlight as you hold it up.`, recent), false);
});

await check("a custom d20 that is a check is told apart from a table roll", () => {
  assert.equal(customRollIsCheck({ kind: "custom", expression: "1d20+3", reason: "Dexterity (Physical)" }), true);
  assert.equal(customRollIsCheck({ kind: "custom", expression: "1d20", reason: "Dexterity (Physical)" }), true);
  assert.equal(customRollIsCheck({ kind: "custom", expression: "1d20 - 1", reason: "dodge the falling stones" }), true);
  assert.equal(customRollIsCheck({ kind: "custom", expression: "1d20", reason: "Sleight of Hand to palm the key" }), true);
  assert.equal(customRollIsCheck({ kind: "custom", expression: "1d20", reason: "which trinket is in the pouch" }), false);
  assert.equal(customRollIsCheck({ kind: "custom", expression: "2d6+1", reason: "Dexterity" }), false);
  assert.equal(customRollIsCheck({ kind: "damage", expression: "1d20+3", reason: "falling" }), false);
  assert.equal(customRollIsCheck({ kind: "custom", expression: "1d100", reason: "wild table" }), false);
});

await check("the Combat cue starts a fight on the board", () => {
  assert.match(buildOneShotDirective("combat"), /start_encounter/);
});

// ---- the turn machine ----------------------------------------------------------
const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
let script = [];
let calls = 0;
let requests = [];
let sheetId = "";
function sse(res, deltas) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}
const toolCall = (name, args) => ({
  tool_calls: [{ index: 0, id: `call_${name}_${calls}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
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
    requests.push(body);
    const reply = script[calls] ?? "narrate";
    if (reply === "empty") {
      sse(res, []);
    } else if (reply === "loot") {
      sse(res, [{ content: LOOT }]);
    } else if (reply === "journal") {
      sse(res, [{ content: JOURNAL_SCENE }]);
    } else if (reply === "unknown-tool") {
      sse(res, [toolCall("dance_wildly", { style: "jig" })]);
    } else if (reply === "custom-dex") {
      sse(res, [toolCall("request_roll", { characterId: sheetId, kind: "custom", expression: "1d20+3", reason: "Dexterity (Physical)" })]);
    } else if (reply === "trinket") {
      sse(res, [toolCall("request_roll", { characterId: sheetId, kind: "custom", expression: "1d20", reason: "which trinket is in the pouch" })]);
    } else {
      sse(res, [{ content: NARRATION }]);
    }
    calls += 1;
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

function table(title, earlier) {
  const campaign = createCampaign(lead.id, {
    title,
    description: "A test of the arc markers and earlier passages.",
    theme: "ruined temple",
    maxPlayers: 2,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  updateStorySettings(campaign.id, {
    textProvider: "custom",
    customBaseUrl: baseUrl,
    customModel: "fake",
    imageGenerationEnabled: false,
    autoImages: false,
  });
  setCampaignStatus(campaign.id, "active");
  const sheet = createSheet(
    campaign.id,
    lead.id,
    1,
    createSheetSchema.parse({
      name: "Jason",
      race: "human",
      class: "fighter",
      abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      maxHp: 12,
      ac: 16,
      hitDice: { die: "d10", total: 1, spent: 0 },
      proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
    }),
  );
  sheetId = sheet.id;
  for (const passage of earlier) {
    insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: sheet.id, content: "I go on." });
    insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "dm", content: passage, speech: [] });
  }
  insertCampaignMessage({
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    authorType: "player",
    userId: lead.id,
    characterId: sheet.id,
    content: "Before progressing, I look in the journal in case there's something I need to be aware of that's ahead of us.",
  });
  return campaign;
}

async function run(title, replies, earlier = [LOOT, DOOR, PLEA, DEAL]) {
  script = replies;
  calls = 0;
  requests = [];
  const campaign = table(title, earlier);
  await startDmTurn(campaign.id);
  const messages = listRecentMessages(campaign.id, 40);
  const dm = messages.filter((m) => m.authorType === "dm");
  return { campaign, newest: dm.at(-1)?.content ?? "", dm, messages, calls, requests };
}
const asked = (request, pattern) => request.messages.some((m) => m.role === "user" && pattern.test(String(m.content)));
const toolResults = (request) => new Map(request.messages.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, JSON.parse(m.content)]));

await check("issue 941: a reply that ticks the arc in words is sent back once to make the calls", async () => {
  const result = await run("Arc markers", ["journal", "narrate"]);
  assert.equal(result.newest, NARRATION);
  assert.equal(result.calls, 2);
  const told = result.requests[1].messages.at(-1).content;
  assert.match(told, /story arc's bookkeeping/);
  assert.match(told, /"\[waypoint=3\]"/, "the model is shown its own marked sentence");
  assert.match(told, /grant_item for a thing gained/);
  assert.match(told, /complete_beat/);
});

await check("issue 941: a second reply with the markers reaches the table without them", async () => {
  const result = await run("Arc markers twice", ["journal", "journal"]);
  assert.equal(result.calls, 2, "sent back once, not in a loop");
  assert.equal(result.newest, JOURNAL_CLEAN);
});

await check("issue 942: a passage from four replies back is sent back once, not posted", async () => {
  const result = await run("Earlier passage", ["loot", "narrate"]);
  assert.equal(result.newest, NARRATION);
  assert.equal(result.calls, 2);
  assert.ok(asked(result.requests[1], /repeats one of your earlier narrations/), "the second call says why");
});

await check("issue 942: the tools-closed narration that copies an earlier passage is asked once more, told so", async () => {
  const result = await run("Rescue copies", ["empty", "empty", "loot", "narrate"]);
  assert.equal(result.newest, NARRATION, `got: ${result.newest}`);
  assert.equal(result.calls, 4);
  assert.ok(asked(result.requests[3], /repeated one of your earlier narrations word for word/), "the second rescue says why");
  assert.equal(result.dm.filter((m) => m.content === LOOT).length, 1, "the copy was never posted");
});

await check("issue 942: a rescue that copies twice stops the turn for a retry, with nothing posted", async () => {
  const result = await run("Rescue copies twice", ["empty", "empty", "loot", "loot"]);
  assert.equal(result.calls, 4, "one more ask, no loop");
  assert.equal(result.dm.filter((m) => m.content === LOOT).length, 1, "the copy was never posted");
  const notice = result.messages.find((m) => m.authorType === "system" && /repeated an earlier passage/.test(m.content));
  assert.ok(notice, "the table is told why");
  assert.equal(getDmTurn(notice.dmTurnId)?.status, "failed", "the turn can be retried");
});

await check("issue 942: a forced last call that copies an earlier passage gets the narration asked for anew", async () => {
  const result = await run("Last call copies", [...Array(MAX_MODEL_CALLS - 1).fill("unknown-tool"), "loot", "narrate"]);
  assert.equal(result.requests[MAX_MODEL_CALLS - 1].tool_choice, "none", "the copy was the forced last call");
  assert.equal(result.newest, NARRATION, `got: ${result.newest}`);
  assert.ok(asked(result.requests[MAX_MODEL_CALLS], /repeated one of your earlier narrations/));
});

await check("issue 942: a custom d20 check for a party character is refused and nothing is rolled", async () => {
  const result = await run("Custom check", ["custom-dex", "narrate"]);
  const answer = toolResults(result.requests[1]).get("call_request_roll_0");
  assert.match(answer?.error ?? "", /rolls it from their sheet/);
  assert.equal(answer?.retry, true);
  assert.equal(listRecentRolls(result.campaign.id).length, 0, "no roll was made");
});

await check("a bare d20 to roll on a table still rolls", async () => {
  const result = await run("Table roll", ["trinket", "narrate"]);
  const answer = toolResults(result.requests[1]).get("call_request_roll_0");
  assert.equal(answer?.error, undefined, JSON.stringify(answer));
  assert.equal(listRecentRolls(result.campaign.id).length, 1);
});

server.close();
removeTempDir(dir);
console.log(`PASS: ${passed} checks: the arc's markers never reach the table, earlier passages are not posted again, a custom d20 check is refused.`);
