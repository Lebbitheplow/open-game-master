// Casting voices (issue 97): which of the server's voices a speaker without
// one is given. Deterministic, of the right sort when that is known, and as
// different from the rest of the table as the server allows.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { castingPool, pickVoice, voiceGender } = await import("../src/lib/tts-cast.ts");
const { genderMark } = await import("../src/lib/gender.ts");
const { NARRATOR_DEFAULTS, TTS_VOICES, kokoroLanguage, narratorVoiceFor, personalityVoiceFits, voicesFirstIn } = await import("../src/lib/tts-voices.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const KOKORO = ["af_heart", "af_bella", "af_v0bella", "am_michael", "am_fenrir", "am_santa", "bf_emma", "bm_george", "jf_alpha", "ef_dora", "am_adam"];

test("the pool is the narrator's language, without the narrator, old takes and novelties", () => {
  const pool = castingPool(KOKORO, "af_heart");
  assert.ok(!pool.includes("af_heart"), "nobody shares the narrator's voice");
  assert.ok(!pool.includes("af_v0bella") && !pool.includes("am_santa"));
  assert.ok(!pool.includes("jf_alpha") && !pool.includes("ef_dora"), "an English table is not cast in Japanese");
  assert.ok(pool.indexOf("af_bella") < pool.indexOf("am_adam"), "the shipped voices come first");
  assert.deepEqual(castingPool(KOKORO, "ef_dora"), [], "a Spanish narrator is cast from Spanish voices only");
  assert.deepEqual(castingPool(["alloy", "nova", "onyx"], "alloy"), ["nova", "onyx"], "a server with its own names is taken as it is");
});

// ---- the table's language ----

test("each Kokoro language a table plays in has its narrator; a table language Kokoro does not speak has none", () => {
  assert.deepEqual(NARRATOR_DEFAULTS, { english: "af_heart", spanish: "ef_dora", french: "ff_siwis", italian: "if_sara", portuguese: "pf_dora" });
  assert.equal(NARRATOR_DEFAULTS.german, undefined);
  for (const voice of TTS_VOICES) {
    assert.equal(kokoroLanguage(voice.id), voice.language, voice.id);
  }
  assert.equal(kokoroLanguage("jf_alpha"), null, "Japanese is no table language");
  assert.equal(kokoroLanguage("nova"), null);
  assert.equal(kokoroLanguage("af_heart(30)+af_bella(70)"), null);
});

test("a voice nobody chose follows the table's language; a voice someone picked is kept; an OpenAI backend is left alone", () => {
  for (const [language, voice] of [["english", "af_heart"], ["italian", "if_sara"], ["french", "ff_siwis"], ["spanish", "ef_dora"], ["portuguese", "pf_dora"]]) {
    assert.equal(narratorVoiceFor(language, "af_heart", false), voice, language);
    assert.equal(narratorVoiceFor(language, "", false), voice, `${language}: the server's default`);
    assert.equal(narratorVoiceFor(language, "if_sara", false), voice, `${language}: another language's starting voice`);
    assert.equal(narratorVoiceFor(language, "bm_george", false), "bm_george", `${language}: a picked voice`);
    assert.equal(narratorVoiceFor(language, "af_heart(30)+af_bella(70)", false), "af_heart(30)+af_bella(70)");
    assert.equal(narratorVoiceFor(language, "af_heart", true), "af_heart", `${language}: OpenAI's voices are not by language`);
  }
  assert.equal(narratorVoiceFor("german", "if_sara", false), "if_sara", "a language Kokoro has no voice for keeps the voice it has");
  assert.equal(narratorVoiceFor("german", "af_heart", false), "af_heart");
});

test("the picker offers the table's own voices first, and character casting follows the narrator's language", () => {
  const listed = TTS_VOICES.map(({ id, label }) => ({ id, label }));
  assert.deepEqual(voicesFirstIn("italian", listed).slice(0, 2).map((voice) => voice.id), ["if_sara", "im_nicola"]);
  assert.deepEqual(voicesFirstIn("spanish", listed).slice(0, 2).map((voice) => voice.id), ["ef_dora", "em_alex"]);
  assert.deepEqual(voicesFirstIn("french", listed)[0].id, "ff_siwis");
  assert.deepEqual(voicesFirstIn("portuguese", listed).slice(0, 2).map((voice) => voice.id), ["pf_dora", "pm_alex"]);
  assert.deepEqual(voicesFirstIn("german", listed), listed, "a language with no voices: the list as it was");
  const server = [...listed.map((voice) => voice.id), "em_santa", "pm_santa"];
  assert.deepEqual(castingPool(server, "if_sara"), ["im_nicola"]);
  assert.deepEqual(castingPool(server, "ef_dora"), ["em_alex"]);
  assert.deepEqual(castingPool(server, "ff_siwis"), [], "Kokoro has one French voice, the narrator's");
});

test("a GM personality's English voice narrates an English table or one Kokoro has no voice for, never an Italian one", () => {
  assert.equal(personalityVoiceFits("english", "bm_fable"), true);
  assert.equal(personalityVoiceFits("german", "bm_fable"), true);
  assert.equal(personalityVoiceFits("italian", "bm_fable"), false);
  assert.equal(personalityVoiceFits("italian", "im_nicola"), true);
  assert.equal(personalityVoiceFits("italian", "nova"), true, "not a Kokoro voice: the backend's own");
});

test("a voice says what it sounds like, and a gender field which voice it asks for", () => {
  assert.equal(voiceGender("af_heart"), "f");
  assert.equal(voiceGender("bm_george"), "m");
  assert.equal(voiceGender("onyx"), "m");
  assert.equal(voiceGender("af_heart(30)+af_bella(70)"), "");
  assert.equal(genderMark("Female"), "f");
  assert.equal(genderMark("Male"), "m");
  assert.equal(genderMark("Nonbinary"), "");
  assert.equal(genderMark(""), "");
});

test("a pick suits the speaker, is stable, and avoids voices already taken", () => {
  const pool = castingPool(KOKORO, "af_heart");
  const first = pickVoice("Old Pike", "m", pool, []);
  assert.equal(voiceGender(first), "m");
  assert.equal(pickVoice("Old Pike", "m", pool, []), first, "the same speaker is always cast the same way");
  const taken = [];
  for (const name of ["Pike", "Aldric", "Bram"]) {
    taken.push(pickVoice(name, "m", pool, taken));
  }
  assert.equal(new Set(taken).size, 3, "three men, three voices, while the server has them");
  assert.ok(taken.every((voice) => ["am_michael", "am_fenrir", "bm_george"].includes(voice)), "the named voices go first");
  assert.equal(voiceGender(pickVoice("Wren", "", pool, [])) !== "", true);
  assert.equal(pickVoice("Wren", "f", [], []), "", "a server with no voices casts no one");
  assert.equal(pickVoice("Wren", "f", ["onyx"], []), "onyx", "with nothing suitable, any voice beats none");
});

const { unvoicedSpeakers } = await import("../src/lib/tts.ts");

test("a voice is cast for whoever the stored lines say spoke, or the one the passage is spoken as", () => {
  const entry = (key, name) => ({ key, kind: "npc", name, aliases: [], portraitUrl: "", ownerUserId: "", gender: "", voice: null });
  const roster = [entry("npc:marla", "Marla"), entry("npc:pike", "Old Pike"), entry("monster:goblin", "Goblin")];
  const lines = [{ line: "We go,", speaker: { kind: "npc", id: "marla", name: "Marla" } }];
  assert.deepEqual([...unvoicedSpeakers(lines, roster, null)], ["npc:marla"], "Pike, only spoken to, has no line");
  assert.deepEqual([...unvoicedSpeakers([], roster, { kind: "monster", id: "e2", name: "Goblin 2" })], ["monster:goblin"]);
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { NarratorLanguageNote } = await import("../src/components/VoicePicker.tsx");

test("under the narrator picker, a table whose language Kokoro has no voice for is told so in that language's name", () => {
  const note = (language) => renderToStaticMarkup(createElement(NarratorLanguageNote, { language }));
  assert.match(note("german"), /Kokoro has no German voice/);
  assert.match(note("irish"), /Kokoro has no Irish voice/);
  assert.equal(note("italian"), "");
  assert.equal(note("english"), "");
});

console.log(`test-tts-cast: ${passed} passed`);
