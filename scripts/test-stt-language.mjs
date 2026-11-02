// Speech is heard in the table's language. Without a language Whisper guesses
// English, so a clip recorded at a campaign is sent with that table's
// language, as Whisper names it, to whichever engine listens: the Whisper
// service, OpenAI, or the built-in engine (where STT_LANGUAGE, the server's
// own choice for every table, still wins). The campaign is honoured only for
// one of its members; a clip from anywhere else is heard as before. Calls the
// real route handlers (register-routes.mjs) with the speech servers stubbed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-stt-language-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

const { whisperLanguageCode, builtinSpeechLanguage, deviceSpeechLanguage } = await import("../src/lib/stt-logic.ts");
const { TABLE_LANGUAGES } = await import("../src/lib/schemas/game-settings-options.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { createCampaign, updateGameSettings } = await import("../src/lib/db/campaigns.ts");

const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const sttRoute = await route("stt");
const transcriptRoute = await route("campaigns/[campaignId]/voice/transcript");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const lead = createUser("lead", "x", { isAdmin: true });
const stranger = createUser("stranger", "x");
const as = (user) => {
  globalThis.__odmTestToken = mintSession(user.id).token;
};
const tableIn = (tableLanguage) => {
  const campaign = createCampaign(lead.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  updateGameSettings(campaign.id, { tableLanguage, voice: { ...campaign.gameSettings.voice, transcribe: true } });
  return campaign.id;
};

// Every transcription request the server makes, with the language it named.
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/models")) {
    return Response.json({ data: [{ id: "whisper-1" }] });
  }
  sent.push({ url: String(url), language: init.body.get("language") });
  return Response.json({ text: "Il ponte è crollato." });
};

const clip = (campaignId) => {
  const form = new FormData();
  form.set("audio", new File(["voice"], "speech.webm", { type: "audio/webm" }));
  if (campaignId !== undefined) {
    form.set("campaignId", campaignId);
  }
  return form;
};
const dictate = async (campaignId) => {
  const response = await sttRoute.POST(new Request("http://test/api/stt", { method: "POST", body: clip(campaignId) }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return sent.at(-1).language;
};

await test("each of the 15 table languages has Whisper's code; Irish, which Whisper does not know, has none", () => {
  const codes = Object.fromEntries(TABLE_LANGUAGES.map((language) => [language, whisperLanguageCode(language)]));
  assert.deepEqual(codes, {
    danish: "da",
    dutch: "nl",
    english: "en",
    finnish: "fi",
    french: "fr",
    german: "de",
    hungarian: "hu",
    indonesian: "id",
    irish: null,
    italian: "it",
    norwegian: "no",
    portuguese: "pt",
    russian: "ru",
    spanish: "es",
    swedish: "sv",
  });
});

await test("the built-in engine hears the server's STT_LANGUAGE when it is set, else the clip's table's, else nothing", () => {
  assert.equal(builtinSpeechLanguage("italian", "de", true), "italian");
  assert.equal(builtinSpeechLanguage("", "de", true), "de");
  assert.equal(builtinSpeechLanguage("", null, true), null);
});

await test("an English-only built-in model is never handed a table's language, which transformers.js refuses for every clip", () => {
  // whisper-base.en and its kind: naming any language, English included,
  // throws "Cannot specify `task` or `language` for an English-only model".
  for (const code of ["en", "it", "de"]) {
    assert.equal(builtinSpeechLanguage("", code, false), null, code);
  }
  assert.equal(builtinSpeechLanguage("english", "it", false), "english", "the operator's own STT_LANGUAGE is theirs to set");
});

await test("the phone's own recognizer is asked for every table language as Android names it, Irish and Norwegian included; outside a campaign, for none", () => {
  const tags = Object.fromEntries(TABLE_LANGUAGES.map((language) => [language, deviceSpeechLanguage(language)]));
  assert.equal(tags.irish, "ga", "the phone may know Irish where Whisper does not");
  assert.equal(tags.norwegian, "nb", "Android's Norwegian is Bokmal");
  for (const language of TABLE_LANGUAGES) {
    assert.match(tags[language], /^[a-z]{2}$/, language);
    if (language !== "irish" && language !== "norwegian") {
      assert.equal(tags[language], whisperLanguageCode(language), language);
    }
  }
  assert.equal(deviceSpeechLanguage(null), null);
});

process.env.STT_URL = "http://stt.test:8870";
process.env.STT_MODEL = "large-v3";

await test("the Whisper service hears a member's clip in the table's language, in five languages", async () => {
  as(lead);
  for (const [language, code] of [["english", "en"], ["italian", "it"], ["french", "fr"], ["spanish", "es"], ["german", "de"]]) {
    assert.equal(await dictate(tableIn(language)), code, language);
    assert.equal(sent.at(-1).url, "http://stt.test:8870/v1/audio/transcriptions");
  }
  assert.equal(await dictate(tableIn("irish")), null, "Irish goes with no hint");
});

await test("a clip with no campaign, or one naming a campaign its sender is not a member of, is heard with no language", async () => {
  as(lead);
  assert.equal(await dictate(undefined), null);
  const italian = tableIn("italian");
  as(stranger);
  assert.equal(await dictate(italian), null, "a non-member's campaignId never applies that table's language");
  assert.equal(await dictate("no-such-campaign"), null);
});

await test("the voice-chat transcript sends its ring in the table's language", async () => {
  as(lead);
  const german = tableIn("german");
  const form = new FormData();
  form.set("audio", new Blob(["ring"], { type: "audio/webm" }));
  form.set("seconds", "30");
  const response = await transcriptRoute.POST(new Request("http://test/", { method: "POST", body: form }), { params: Promise.resolve({ campaignId: german }) });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(sent.at(-1).language, "de");
});

await test("OpenAI hears a member's clip in the table's language too", async () => {
  process.env.STT_URL = "off";
  delete process.env.STT_MODEL;
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_IMAGE_BASE_URL = "http://127.0.0.1:9/v1";
  process.env.STT_OPENAI_MODEL = "whisper-1";
  as(lead);
  assert.equal(await dictate(tableIn("spanish")), "es");
  assert.equal(sent.at(-1).url, "http://127.0.0.1:9/v1/audio/transcriptions");
  as(stranger);
  assert.equal(await dictate(tableIn("spanish")), null);
});

process.chdir(os.tmpdir());
removeTempDir(dir);
console.log(`test-stt-language: ${passed} passed`);
