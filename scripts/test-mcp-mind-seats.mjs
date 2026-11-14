// Mind seats through the MCP workbench (docs/specs/ogm-mind-seats.md): the
// lead opens a seat that names no one, another account's agent claims it,
// waits for its mind's question and answers it; the lead takes it back.
// workbenchCall drives the real route handlers.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-mcp-mind-seats-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-routes.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { workbenchCall } = await import("../src/lib/agents/workbench.ts");
const { seatForMind } = await import("../src/lib/db/mind-seats.ts");
const { askSeatHolder } = await import("../src/lib/dm/mind-seat-relay.ts");

const routes = {
  seats: await import("../src/app/api/campaigns/[campaignId]/mind-seats/route.ts"),
  seat: await import("../src/app/api/campaigns/[campaignId]/mind-seats/[seatId]/route.ts"),
  claim: await import("../src/app/api/mind-seats/claim/route.ts"),
  questions: await import("../src/app/api/mind-seats/questions/route.ts"),
  answer: await import("../src/app/api/mind-seats/answer/route.ts"),
};

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const lead = createUser("seats-lead", "x");
const member = createUser("seats-member", "x");
const friend = createUser("seats-friend", "x");
const campaign = createCampaign(lead.id, { title: "The Gallows Road", description: "", theme: "", maxPlayers: 2, startingLevel: 2, difficulty: "normal" });
joinByInviteCode(member.id, campaign.inviteCode);
setCampaignStatus(campaign.id, "active");

const grant = (userId, scopes, campaignId) => createConnectionGrant({ userId, name: "agent", scopes, campaignId: campaignId ?? null }).grant;
const leadGrant = grant(lead.id, ["read", "campaigns"]);
const memberGrant = grant(member.id, ["read", "campaigns"]);
const friendGrant = grant(friend.id, ["play"]);
const pinnedGrant = grant(friend.id, ["play"], campaign.id);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url);
  globalThis.__odmTestToken = (new Headers(init.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const method = init.method ?? "GET";
  const request = new Request(target, { method, headers: init.headers, body: init.body });
  let match;
  if ((match = /^\/api\/campaigns\/([^/]+)\/mind-seats$/.exec(target.pathname))) {
    return routes.seats[method](request, { params: Promise.resolve({ campaignId: match[1] }) });
  }
  if ((match = /^\/api\/campaigns\/([^/]+)\/mind-seats\/([^/]+)$/.exec(target.pathname))) {
    return routes.seat[method](request, { params: Promise.resolve({ campaignId: match[1], seatId: match[2] }) });
  }
  if ((match = /^\/api\/mind-seats\/(claim|questions|answer)$/.exec(target.pathname))) {
    return routes[match[1]][method](request);
  }
  assert.fail(`unexpected path ${target.pathname}`);
};

const json = (outcome) => JSON.parse(outcome.text);

try {
  let seat;
  await test("only the lead opens a seat, and its code names no one", async () => {
    const refused = await workbenchCall(memberGrant, "odm_mind_seat_create", { campaignId: campaign.id });
    assert.equal(refused.isError, true);
    const opened = await workbenchCall(leadGrant, "odm_mind_seat_create", { campaignId: campaign.id });
    assert.equal(opened.isError, false, opened.text);
    seat = json(opened);
    assert.match(seat.code, /^[A-Z2-9]{10}$/);
    const listed = json(await workbenchCall(leadGrant, "odm_mind_seats", { campaignId: campaign.id }));
    assert.deepEqual(listed.seats.map((entry) => entry.status), ["free"]);
  });

  await test("a pinned connection cannot hold seats; an unpinned one claims it", async () => {
    const pinned = await workbenchCall(pinnedGrant, "odm_mind_seat_claim", { code: seat.code });
    assert.equal(pinned.isError, true);
    const claimed = await workbenchCall(friendGrant, "odm_mind_seat_claim", { code: seat.code });
    assert.equal(claimed.isError, false, claimed.text);
    assert.equal(json(claimed).campaignId, campaign.id);
    const listed = json(await workbenchCall(leadGrant, "odm_mind_seats", { campaignId: campaign.id }));
    assert.equal(listed.seats[0].holder, "seats-friend");
    assert.equal(listed.seats[0].status, "claimed");
  });

  await test("the holder waits for their mind's question and answers it", async () => {
    const held = seatForMind(campaign.id, "npc-prisoner");
    assert.equal(held.id, seat.id);
    const asked = askSeatHolder({ userId: friend.id, campaignId: campaign.id, seatId: held.id, character: "The Prisoner", instructions: "Be them.", prompt: "Brakk asks your name." }, 5000);
    const waited = json(await workbenchCall(friendGrant, "odm_mind_wait", { waitSec: 2 }));
    assert.equal(waited.questions.length, 1);
    assert.equal(waited.questions[0].character, "The Prisoner");
    const empty = await workbenchCall(friendGrant, "odm_mind_answer", { requestId: waited.questions[0].requestId });
    assert.equal(empty.isError, true, "an answer says or does something");
    const answered = await workbenchCall(friendGrant, "odm_mind_answer", { requestId: waited.questions[0].requestId, speech: "Names are for the hanged.", intent: "" });
    assert.equal(answered.isError, false, answered.text);
    assert.deepEqual(await asked, { speech: "Names are for the hanged.", intent: "", conclusion: "", lie: false });
    const again = await workbenchCall(friendGrant, "odm_mind_answer", { requestId: waited.questions[0].requestId, speech: "Twice." });
    assert.equal(again.isError, true);
    const listed = json(await workbenchCall(leadGrant, "odm_mind_seats", { campaignId: campaign.id }));
    assert.equal(listed.seats[0].status, "playing");
    assert.equal(JSON.stringify(listed).includes("npc-prisoner"), false, "the lead never learns whom");
  });

  await test("the lead takes the seat back, and its waiting question goes to the server's mind", async () => {
    const asked = askSeatHolder({ userId: friend.id, campaignId: campaign.id, seatId: seat.id, character: "The Prisoner", instructions: "", prompt: "?" }, 5000);
    const released = await workbenchCall(leadGrant, "odm_mind_seat_release", { campaignId: campaign.id, seatId: seat.id });
    assert.equal(released.isError, false, released.text);
    assert.equal(await asked, null);
    assert.equal(seatForMind(campaign.id, "npc-prisoner"), null);
  });

  console.log(`${passed} MCP mind seat tests passed`);
} finally {
  globalThis.fetch = originalFetch;
  removeTempDir(dir);
}
