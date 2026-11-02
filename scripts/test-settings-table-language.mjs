// A table's narrator voice follows its language, on create and on a change
// of table language through the settings route, unless someone picked one.
// Calls the real route handler (register-routes.mjs) against a real
// encrypted throwaway database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { standInStoryteller } from "./lib/stand-in-storyteller.mjs";

standInStoryteller();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-settings-language-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { createCampaign, getCampaignById, updateGameSettings } = await import("../src/lib/db/campaigns.ts");
const { closeDatabaseForRestore, getDatabase } = await import("../src/lib/db/core.ts");
const { getUserSettings, setCampaignDefaults } = await import("../src/lib/db/users.ts");

const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const campaignsRoute = await route("campaigns");
const settingsRoute = await route("campaigns/[campaignId]/settings");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const lead = createUser("lead", "x", { isAdmin: true });

function as(user) {
  globalThis.__odmTestToken = mintSession(user.id).token;
}

async function call(mod, method, body, params = {}) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

async function newCampaign(gameSettings) {
  as(lead);
  const created = await call(campaignsRoute, "POST", { title: "Table", gameSettings });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.campaign.id;
}

await test("a new campaign starts on its table language's narrator when it names no voice, and keeps the voice its creator picked", async () => {
  for (const [tableLanguage, voice] of [["english", "af_heart"], ["italian", "if_sara"], ["french", "ff_siwis"], ["spanish", "ef_dora"], ["portuguese", "pf_dora"], ["german", "af_heart"]]) {
    const campaignId = await newCampaign({ tableLanguage });
    assert.equal(getCampaignById(campaignId).gameSettings.ttsVoice, voice, tableLanguage);
  }
  // Another language's starting voice, picked on purpose, is a pick too.
  for (const picked of ["af_heart", "ef_dora", "bm_george"]) {
    const campaignId = await newCampaign({ tableLanguage: "italian", ttsVoice: picked });
    assert.equal(getCampaignById(campaignId).gameSettings.ttsVoice, picked, picked);
  }
});

await test("a change of table language brings that language's narrator, keeps a picked voice, and a voice sent with it wins", async () => {
  const campaignId = await newCampaign({ tableLanguage: "english" });
  const steps = [
    [{ tableLanguage: "italian" }, "if_sara"],
    [{ tableLanguage: "spanish" }, "ef_dora"],
    [{ tableLanguage: "german" }, "ef_dora"],
    [{ ttsVoice: "am_puck" }, "am_puck"],
    [{ tableLanguage: "french" }, "am_puck"],
    [{ tableLanguage: "italian", ttsVoice: "im_nicola" }, "im_nicola"],
    [{ romance: "off" }, "im_nicola"],
  ];
  for (const [patch, voice] of steps) {
    const response = await call(settingsRoute, "PATCH", patch, { campaignId });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(getCampaignById(campaignId).gameSettings.ttsVoice, voice, JSON.stringify(patch));
    assert.equal(response.json.gameSettings.ttsVoice, voice);
  }
});

await test("on an OpenAI speech backend the voice is the table's own choice, whatever the language", async () => {
  process.env.TTS_PROVIDER = "openai";
  // af_heart would become ef_dora on a Kokoro server; unsaid, the voice stays the server's default.
  const campaignId = await newCampaign({ tableLanguage: "italian" });
  assert.equal(getCampaignById(campaignId).gameSettings.ttsVoice, "af_heart");
  await call(settingsRoute, "PATCH", { tableLanguage: "spanish" }, { campaignId });
  assert.equal(getCampaignById(campaignId).gameSettings.ttsVoice, "af_heart");
  delete process.env.TTS_PROVIDER;
});

await test("an upgraded server moves each table in a Kokoro language off the English narrator it started on, once, and keeps every picked voice", async () => {
  const table = (tableLanguage, ttsVoice) => {
    const campaign = createCampaign(lead.id, { title: "Old table", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
    updateGameSettings(campaign.id, { tableLanguage, ttsVoice });
    return campaign.id;
  };
  const italian = table("italian", "af_heart");
  const spanishPicked = table("spanish", "bm_fable");
  const english = table("english", "af_heart");
  const german = table("german", "af_heart");
  const portuguese = table("portuguese", "af_heart");
  // A row written before the voice was stored at all reads as the old narrator.
  const french = table("french", "af_heart");
  getDatabase().prepare(`UPDATE campaigns SET game_settings_json = json_remove(game_settings_json, '$.ttsVoice') WHERE id = ?`).run(french);
  setCampaignDefaults(lead.id, { version: 1, savedAt: new Date().toISOString(), settings: { tableLanguage: "italian", ttsVoice: "af_heart", maxPlayers: 3 } });

  // The server restarts on the new version.
  getDatabase().prepare(`DELETE FROM app_settings WHERE key = 'narrator_language_backfill_done'`).run();
  closeDatabaseForRestore();
  const voice = (campaignId) => getCampaignById(campaignId).gameSettings.ttsVoice;
  assert.equal(voice(italian), "if_sara");
  assert.equal(voice(french), "ff_siwis");
  assert.equal(voice(portuguese), "pf_dora");
  assert.equal(voice(spanishPicked), "bm_fable", "a picked voice stays");
  assert.equal(voice(english), "af_heart");
  assert.equal(voice(german), "af_heart", "Kokoro has no German narrator to move to");
  assert.deepEqual(getUserSettings(lead.id).campaignDefaults.settings, { tableLanguage: "italian", ttsVoice: "if_sara", maxPlayers: 3 }, "saved defaults move too");

  // Once: a table that picks the English voice again keeps it after the next restart.
  updateGameSettings(italian, { ttsVoice: "af_heart" });
  closeDatabaseForRestore();
  assert.equal(voice(italian), "af_heart");
});

process.chdir(os.tmpdir());
removeTempDir(dir);
console.log(`test-settings-table-language: ${passed} passed`);
