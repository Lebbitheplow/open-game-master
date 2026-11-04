// A server with no pictures, through a real DM turn (PR 277). Setup's "No
// pictures for now" leaves ComfyUI as the fallback backend, and before this
// every new area queued a map and a scene picture against it that could only
// fail, so "Could not reach ComfyUI" followed every scene. The scripted fake
// agent (HARNESS_FAKE) moves the party somewhere new with a clear view and
// asks for a scene picture; nothing may be queued, the narration is linked to
// no map, and the picture's request ends not needed.
//
// Two tables: one made after setup said no pictures, and one made while
// ComfyUI was the admin's choice, which still holds the address it was given
// then. The second is asked where it would actually paint, not trusted for
// an address nobody names any more.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-no-pictures-turn-"));
const scriptFile = path.join(dir, "script.json");
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.HARNESS_FAKE = "1";
process.env.HARNESS_FAKE_SCRIPT = scriptFile;
process.env.DM_THINKING = "0";
process.env.TTS_PROVIDER = "off";
delete process.env.COMFYUI_URL;
register("./lib/register-alias.mjs", import.meta.url);

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, updateStorySettings, updateGameSettings, allocateSeq, getCampaignById } =
  await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, getLatestDmMessage } = await import("../src/lib/db/messages.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { handleMcpRequest } = await import("../src/lib/agents/mcp-server.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { imagesAvailable } = await import("../src/lib/capabilities.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// The fake agent reaches the table's tools through ODM's MCP route.
const mcp = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const response = await handleMcpRequest(
    new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
// Node closes an idle keep-alive socket after five seconds, and the fake
// agent's next MCP call can be written onto the socket as it closes: a turn
// whose prompt build held the event loop that long (a slow Windows runner)
// failed with "fetch failed" before any reply (test-recall-budget on #792).
// This door never closes idle sockets, as the narrator's does
// (scripts/lib/enforce-narrator.mjs).
mcp.keepAliveTimeout = 0;
await new Promise((resolve) => mcp.listen(0, "127.0.0.1", resolve));
process.env.HARNESS_MCP_URL = `http://127.0.0.1:${mcp.address().port}/api/mcp`;

// The shipped default address (127.0.0.1:8188) stands for "no ComfyUI
// here" in the table made without pictures. A machine that runs ComfyUI
// there (a developer's) would answer it and the test would be about that
// machine; the default stays dark here as it is on CI's runner.
const reachOut = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith("http://127.0.0.1:8188") ? Promise.reject(new TypeError("fetch failed")) : reachOut(input, init);
};

// An address where nothing answers: a port that was free a moment ago.
async function deadAddress() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return `http://127.0.0.1:${port}`;
}
// A ComfyUI stand-in that answers its liveness check.
const comfy = http.createServer((req, res) => {
  res.writeHead(req.url === "/system_stats" ? 200 : 404, { "Content-Type": "application/json" });
  res.end("{}");
});
await new Promise((resolve) => comfy.listen(0, "127.0.0.1", resolve));
const liveComfy = `http://127.0.0.1:${comfy.address().port}`;

try {
  const lead = createUser("rowan", "x", { isAdmin: true });
  saveGlobalConfig({ harness: { id: "claude", model: "fake-model" }, text: { provider: "harness" } });
  const table = (title) =>
    createCampaign(lead.id, {
      title,
      description: "A caravan job.",
      theme: "low fantasy",
      maxPlayers: 4,
      startingLevel: 3,
      difficulty: "normal",
      gameSettings: {},
    });

  // Made while ComfyUI was the admin's choice: it keeps that address.
  const stale = await deadAddress();
  saveGlobalConfig({ images: { defaultBackend: "comfyui", comfyUrl: stale, comfyCheckpoint: "x.safetensors" } });
  const before = table("Made with pictures");
  // Then setup's "No pictures for now" (src/lib/setup/patches.ts).
  saveGlobalConfig({ images: { defaultBackend: "", comfyUrl: "" } });
  const after = table("Made without pictures");

  const prepare = (campaign) => {
    updateStorySettings(campaign.id, { textProvider: "harness", imageGenerationEnabled: true, autoImages: true });
    updateGameSettings(campaign.id, { mapsEnabled: true });
    setCampaignStatus(campaign.id, "active");
    const sheet = createSheet(
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
    insertCampaignMessage({
      campaignId: campaign.id,
      seq: allocateSeq(campaign.id),
      authorType: "player",
      userId: lead.id,
      characterId: sheet.id,
      content: "We climb down into the crypt.",
    });
  };

  async function playNewArea(campaign) {
    const media = [];
    const off = subscribe(campaign.id, (chunk) => {
      const type = /event: (\S+)/.exec(chunk)?.[1];
      if (type === "media_status") media.push(JSON.parse(/data: (.*)/.exec(chunk)?.[1] ?? "{}"));
    });
    fs.writeFileSync(
      scriptFile,
      JSON.stringify([
        [
          {
            call: "move_party",
            args: { name: "The Drowned Crypt", layoutDescription: "A flooded nave with three side chapels.", visionClear: true },
          },
          { call: "generate_image", args: { prompt: "A flooded crypt nave lit by a single torch", reason: "new area" } },
          { text: "You descend into the drowned crypt. Water laps at the pews." },
        ],
      ]),
    );
    await startDmTurn(campaign.id);
    // A queued render would report within this window.
    await new Promise((resolve) => setTimeout(resolve, 500));
    off();
    return { media, latest: getLatestDmMessage(campaign.id) };
  }

  await test("a table made after setup said no pictures queues no map and no scene picture", async () => {
    prepare(after);
    const { media, latest } = await playNewArea(getCampaignById(after.id));
    assert.match(latest.content, /drowned crypt/i);
    assert.deepEqual(media, [], "a render was queued against a backend that is not there");
    assert.equal(latest.locationId ?? null, null, "the narration was linked to a map that will never come");
    assert.equal(latest.imageRequest?.needed ?? false, false, "the scene picture's placeholder outlived the turn");
  });

  await test("a table still holding a ComfyUI address nobody names is asked where it would paint", async () => {
    const campaign = getCampaignById(before.id);
    assert.equal(campaign.settings.comfyUrl, stale, "the table no longer holds the address it was made with");
    assert.equal(await imagesAvailable(campaign.settings), false);
    prepare(before);
    const { media, latest } = await playNewArea(getCampaignById(before.id));
    assert.deepEqual(media, [], "a render was queued against the old address");
    assert.equal(latest.locationId ?? null, null);
    assert.equal(latest.imageRequest?.needed ?? false, false);
  });

  await test("an address something answers at, or one the admin names, still paints", async () => {
    const campaign = getCampaignById(before.id);
    assert.equal(await imagesAvailable({ ...campaign.settings, comfyUrl: liveComfy }), true, "a live ComfyUI was refused");
    // Named by the admin: its failures are worth showing, so it is not
    // second-guessed by a probe.
    saveGlobalConfig({ images: { defaultBackend: "comfyui", comfyUrl: stale, comfyCheckpoint: "x.safetensors" } });
    assert.equal(await imagesAvailable(getCampaignById(before.id).settings), true, "the admin's own address was second-guessed");
    // A ComfyUI with nothing to paint with paints nothing anywhere.
    assert.equal(await imagesAvailable({ ...campaign.settings, comfyUrl: liveComfy, comfyCheckpoint: "" }), false);
  });

  console.log(`\n${passed} no-pictures turn checks passed`);
} finally {
  mcp.close();
  comfy.close();
  removeTempDir(dir);
}
