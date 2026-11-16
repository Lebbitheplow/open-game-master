// Whether the embedding model the server runs reads a table's language
// (issue #919): the probe sentences cover every table language, a model is
// judged by where it puts each sentence beside its English translation, never
// by its name, a model that did not load is reported and asked again, the
// check route answers about a language and never a campaign, the admin page
// learns which campaigns play in another language, and the warning says the
// same fix everywhere. Stub embedders throughout, so no model is loaded.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-embedding-language-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

const { TABLE_LANGUAGES } = await import("../src/lib/schemas/game-settings-options.ts");
const { PROBE_ENGLISH, PROBE_SENTENCES } = await import("../src/lib/language/probe-sentences.ts");
const { PROBE_MATCHES_NEEDED, readsBesideEnglish, seesEmbeddingWarning } = await import(
  "../src/lib/embedding-language-logic.ts"
);
const { embeddingWarning } = await import("../src/lib/embedding-language-text.ts");
const { EMBEDDING_DIM } = await import("../src/lib/embeddings.ts");
const { embeddingVerdict } = await import("../src/lib/embedding-language.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { createCampaign, listCampaignLanguages, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const languageRoute = await import("../src/app/api/embeddings/language/route.ts");
const adminSettingsRoute = await import("../src/app/api/admin/settings/route.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const PROBED = TABLE_LANGUAGES.filter((language) => language !== "english");

function oneHot(slot) {
  const vector = new Float32Array(EMBEDDING_DIM);
  vector[slot] = 1;
  return vector;
}

// Every text the stub embedders were handed, for counting probes.
let embedded = [];

// A model that reads every language: a sentence and its translation get the
// same vector, slot = the sentence's place in the probe.
function sentenceSlot(text) {
  const english = PROBE_ENGLISH.indexOf(text);
  if (english >= 0) {
    return english;
  }
  for (const sentences of Object.values(PROBE_SENTENCES)) {
    if (sentences.includes(text)) {
      return sentences.indexOf(text);
    }
  }
  throw new Error(`Not a probe sentence: ${text}`);
}

// A model that sees only spelling: every distinct text lands somewhere of its
// own, so no sentence is nearer its translation than any other.
const spellings = new Map();
function spellingSlot(text) {
  if (!spellings.has(text)) {
    spellings.set(text, spellings.size % EMBEDDING_DIM);
  }
  return spellings.get(text);
}

function useEmbedder(slotOf) {
  globalThis.__odmEmbedderFailure = undefined;
  globalThis.__odmEmbedderPromise = Promise.resolve((texts) => {
    embedded.push(...texts);
    return Promise.resolve({ tolist: () => texts.map((text) => Array.from(oneHot(slotOf(text)))) });
  });
}

// A model that failed to load, inside its retry window (src/lib/embeddings.ts).
function useBrokenEmbedder() {
  globalThis.__odmEmbedderPromise = undefined;
  globalThis.__odmEmbedderFailure = {
    at: Date.now(),
    failures: 1,
    permanent: false,
    error: new Error("the embedding model failed to load"),
  };
}

function forgetVerdicts() {
  globalThis.__odmEmbeddingVerdicts = undefined;
  embedded = [];
}

function as(user) {
  globalThis.__odmTestToken = user ? mintSession(user.id).token : undefined;
}

async function askLanguage(language) {
  const query = language === undefined ? "" : `?language=${encodeURIComponent(language)}`;
  const response = await languageRoute.GET(new Request(`http://test/api/embeddings/language${query}`));
  return { status: response.status, json: await response.json() };
}

await test("every table language but English has the probe's sentences, one for each English one", () => {
  assert.deepEqual(Object.keys(PROBE_SENTENCES).sort(), [...PROBED].sort());
  assert.equal(PROBE_ENGLISH.length, 8);
  assert.ok(PROBE_MATCHES_NEEDED > PROBE_ENGLISH.length / 2 && PROBE_MATCHES_NEEDED <= PROBE_ENGLISH.length);
  for (const sentences of [PROBE_ENGLISH, ...Object.values(PROBE_SENTENCES)]) {
    assert.equal(sentences.length, PROBE_ENGLISH.length);
    assert.ok(sentences.every((sentence) => sentence.trim().length > 0));
    assert.equal(new Set(sentences).size, sentences.length);
  }
});

await test("a model reads the language when enough sentences land nearest their own translation", () => {
  const english = PROBE_ENGLISH.map((_, index) => oneHot(index));
  const landing = (matched) => english.map((_, index) => oneHot(index < matched ? index : (index + 1) % english.length));
  assert.equal(readsBesideEnglish(landing(8), english), true);
  assert.equal(readsBesideEnglish(landing(PROBE_MATCHES_NEEDED), english), true);
  assert.equal(readsBesideEnglish(landing(PROBE_MATCHES_NEEDED - 1), english), false);
  assert.equal(readsBesideEnglish(landing(0), english), false);
});

await test("the running model is judged by what it does with the sentences, in every language", async () => {
  useEmbedder(sentenceSlot);
  forgetVerdicts();
  for (const language of PROBED) {
    assert.equal(await embeddingVerdict(language), "reads", language);
  }
  useEmbedder(spellingSlot);
  forgetVerdicts();
  for (const language of PROBED) {
    assert.equal(await embeddingVerdict(language), "english_only", language);
  }
});

await test("each language is probed once, however many pages ask at the same time", async () => {
  useEmbedder(sentenceSlot);
  forgetVerdicts();
  const asked = await Promise.all([embeddingVerdict("italian"), embeddingVerdict("italian"), embeddingVerdict("italian")]);
  assert.deepEqual(asked, ["reads", "reads", "reads"]);
  assert.equal(embedded.length, PROBE_ENGLISH.length * 2);
  assert.equal(await embeddingVerdict("italian"), "reads");
  assert.equal(embedded.length, PROBE_ENGLISH.length * 2);
  // The probe text is fixed: nothing else is embedded for it.
  assert.deepEqual(embedded, [...PROBE_SENTENCES.italian, ...PROBE_ENGLISH]);
});

await test("a model that did not load is reported, and asked again once it does", async () => {
  forgetVerdicts();
  useBrokenEmbedder();
  const logged = console.error;
  console.error = () => {};
  const verdict = await embeddingVerdict("french");
  console.error = logged;
  assert.equal(verdict, "unavailable");
  useEmbedder(sentenceSlot);
  assert.equal(await embeddingVerdict("french"), "reads");
});

await test("the check route answers about a language, to anyone signed in, and nothing else", async () => {
  useEmbedder(spellingSlot);
  forgetVerdicts();
  const player = createUser(`player-${randomBytes(3).toString("hex")}`, "x");
  as(null);
  assert.equal((await askLanguage("italian")).status, 401);
  as(player);
  for (const bad of ["english", "klingon", "", undefined]) {
    assert.equal((await askLanguage(bad)).status, 400, String(bad));
  }
  const answer = await askLanguage("italian");
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.json, { language: "italian", verdict: "english_only" });
});

await test("the admin page learns which campaigns still in play read another language, and only the admin", async () => {
  const admin = createUser(`admin-${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
  const player = createUser(`player-${randomBytes(3).toString("hex")}`, "x");
  const base = { description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" };
  const italian = createCampaign(admin.id, { ...base, title: "Il drago", gameSettings: { tableLanguage: "italian" } }).id;
  createCampaign(admin.id, { ...base, title: "The dragon", gameSettings: { tableLanguage: "english" } });
  const ended = createCampaign(admin.id, { ...base, title: "Le dragon", gameSettings: { tableLanguage: "french" } }).id;
  setCampaignStatus(ended, "ended");
  assert.deepEqual(listCampaignLanguages(), [{ id: italian, title: "Il drago", language: "italian" }]);

  as(player);
  assert.equal((await adminSettingsRoute.GET()).status, 403);
  as(admin);
  const response = await adminSettingsRoute.GET();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).tableLanguageCampaigns, [{ id: italian, title: "Il drago", language: "italian" }]);
});

await test("the session and lobby warn whoever can fix it: the story's authority and the admins", () => {
  assert.equal(seesEmbeddingWarning({ steersStory: true, isAdmin: false }), true);
  assert.equal(seesEmbeddingWarning({ steersStory: false, isAdmin: true }), true);
  assert.equal(seesEmbeddingWarning({ steersStory: false, isAdmin: false }), false);
});

await test("the warning names the languages and gives one fix, and says nothing when the model reads them", () => {
  assert.equal(embeddingWarning([{ language: "italian", verdict: "reads" }]), null);
  assert.equal(embeddingWarning([]), null);
  const englishOnly = embeddingWarning([{ language: "italian", verdict: "english_only" }]);
  assert.match(englishOnly.title, /cannot read Italian$/);
  assert.match(englishOnly.body, /playing in Italian /);
  assert.match(englishOnly.body, /Admin > Settings > Language/);
  assert.match(englishOnly.body, /EMBEDDING_MODEL in .env.server wins over the language: set it to Xenova\/multilingual-e5-small/);
  assert.match(englishOnly.body, /\.env\.server/);
  assert.deepEqual(englishOnly.languages, ["italian"]);

  // The admin page asks about every campaign's language in one warning: only
  // the unread ones are named.
  const several = embeddingWarning([
    { language: "italian", verdict: "english_only" },
    { language: "german", verdict: "reads" },
    { language: "french", verdict: "english_only" },
    { language: "spanish", verdict: "english_only" },
  ]);
  assert.match(several.title, /cannot read Italian, French or Spanish$/);
  assert.match(several.body, /playing in Italian, French or Spanish /);
  assert.deepEqual(several.languages, ["italian", "french", "spanish"]);

  // A model that did not load reads none of them, whatever else was answered.
  const unavailable = embeddingWarning([
    { language: "italian", verdict: "english_only" },
    { language: "french", verdict: "unavailable" },
  ]);
  assert.match(unavailable.body, /did not load/);
  assert.match(unavailable.body, /npm run fetch-model/);
  assert.deepEqual(unavailable.languages, ["italian", "french"]);
});

console.log(`\n${passed} embedding-language tests passed`);
process.chdir(os.tmpdir());
removeTempDir(dir);
