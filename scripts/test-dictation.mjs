// Dictation: how spoken words join what is already written, the take's
// limits, the recorder format the button asks for, the level meter, and
// which engine the server listens with.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs, { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

// The Whisper model is a saved setting, so the transcript checks read a
// throwaway database, never the developer's own.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-dictation-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
for (const name of ["STT_URL", "STT_MODEL", "STT_OPENAI_MODEL"]) {
  delete process.env[name];
}

register("./lib/register-alias.mjs", import.meta.url);

const {
  DICTATION_BITRATE,
  DICTATION_MAX_MS,
  DICTATION_WARN_MS,
  appendDictation,
  dictationFileName,
  formatElapsed,
  levelFromWaveform,
  pickDictationEngine,
  pickRecorderType,
} = await import("../src/lib/dictation.ts");
const { decodeWav, encodeWav, splitForUpload, SPEECH_CHUNK_SECONDS, SPEECH_SAMPLE_RATE } = await import("../src/lib/speech-wav.ts");
const { pickSttBackend, sttWantsWav, whisperNeedsModel, whisperSwitchedOff } = await import("../src/lib/stt-logic.ts");
const { sttAvailable, sttInputs, transcribeAudio } = await import("../src/lib/stt.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { forgetSoleModelsForTests } = await import("../src/lib/model-registry/discovery.ts");
const { capabilitiesSnapshot, sttProbeUrl } = await import("../src/lib/capabilities.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("an empty field takes the words as said", () => {
  assert.equal(appendDictation("", "The mill burned."), "The mill burned.");
  assert.equal(appendDictation("   ", "  The mill burned.  "), "The mill burned.");
});

test("words join what is there with one space", () => {
  assert.equal(appendDictation("They reached the abbey.", "Aldric met them."), "They reached the abbey. Aldric met them.");
  assert.equal(appendDictation("They reached the abbey.  ", "Aldric met them."), "They reached the abbey. Aldric met them.");
});

test("a new line in the field is kept as the join", () => {
  assert.equal(appendDictation("Ask at the mill\n", "Search the weir"), "Ask at the mill\nSearch the weir");
});

test("nothing said leaves the field alone", () => {
  assert.equal(appendDictation("Kept as typed ", ""), "Kept as typed ");
  assert.equal(appendDictation("Kept", "   "), "Kept");
});

test("the field's limit holds, since code slips past maxLength", () => {
  const joined = appendDictation("a".repeat(295), "and then some more words", 300);
  assert.equal(joined.length, 300);
  assert.ok(joined.startsWith("a".repeat(295)));
  assert.equal(appendDictation("short", "words", 0), "short words");
});

test("the timer reads minutes and seconds", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(7_400), "0:07");
  assert.equal(formatElapsed(272_000), "4:32");
  assert.equal(formatElapsed(DICTATION_MAX_MS), "10:00");
  assert.equal(formatElapsed(-50), "0:00");
});

test("a full take fits the route and the tunnel", () => {
  // /api/stt refuses anything over 8 MB.
  const bytes = (DICTATION_BITRATE / 8) * (DICTATION_MAX_MS / 1000);
  assert.ok(bytes < 8 * 1024 * 1024, `${bytes} bytes`);
  assert.ok(DICTATION_WARN_MS < DICTATION_MAX_MS);
  assert.ok(DICTATION_MAX_MS - DICTATION_WARN_MS >= 10_000);
});

test("the recorder asks for Opus first and falls back", () => {
  assert.equal(pickRecorderType(() => true), "audio/webm;codecs=opus");
  assert.equal(pickRecorderType((type) => type === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecorderType(() => false), "");
  assert.equal(
    pickRecorderType(() => {
      throw new Error("no");
    }),
    "",
  );
});

test("the file name matches the container", () => {
  assert.equal(dictationFileName("audio/webm;codecs=opus"), "speech.webm");
  assert.equal(dictationFileName("audio/mp4"), "speech.m4a");
  assert.equal(dictationFileName("audio/ogg;codecs=opus"), "speech.ogg");
  assert.equal(dictationFileName(""), "speech.webm");
});

test("the meter reads silence as zero and speech as a level", () => {
  assert.equal(levelFromWaveform(new Uint8Array(64).fill(128)), 0);
  assert.equal(levelFromWaveform([]), 0);
  const speech = Array.from({ length: 64 }, (_, index) => 128 + Math.round(Math.sin(index / 3) * 30));
  const level = levelFromWaveform(speech);
  assert.ok(level > 0.3 && level <= 1, String(level));
  assert.equal(levelFromWaveform(Array.from({ length: 64 }, (_, index) => (index % 2 ? 255 : 0))), 1);
});

test("the capability probe asks Whisper for its model list", () => {
  assert.equal(sttProbeUrl("http://127.0.0.1:8870"), "http://127.0.0.1:8870/v1/models");
  assert.equal(sttProbeUrl("http://stt.lan:8870/"), "http://stt.lan:8870/v1/models");
});

test("the server's engine: Whisper, then built-in, then OpenAI", () => {
  const base = { explicitWhisperUrl: "", whisperReachable: false, whisperModel: "large-v3", builtinInstalled: false, openAiKey: "", openAiModel: "my-ears" };
  assert.equal(pickSttBackend(base), "none");
  assert.equal(pickSttBackend({ ...base, openAiKey: "sk-test" }), "openai");
  assert.equal(pickSttBackend({ ...base, openAiKey: "  " }), "none");
  assert.equal(pickSttBackend({ ...base, openAiKey: "sk-test", builtinInstalled: true }), "builtin");
  assert.equal(pickSttBackend({ ...base, builtinInstalled: true, whisperReachable: true }), "whisper");
  // An address an admin typed is trusted: other Whisper servers may not
  // answer the model-list probe.
  assert.equal(pickSttBackend({ ...base, explicitWhisperUrl: "http://stt.lan:9000", builtinInstalled: true }), "whisper");
  assert.equal(whisperSwitchedOff("off"), true);
  assert.equal(whisperSwitchedOff(" OFF "), true);
  assert.equal(whisperSwitchedOff("http://127.0.0.1:8870"), false);
  assert.equal(whisperSwitchedOff(""), false);
  assert.equal(sttWantsWav("builtin"), true);
  assert.equal(sttWantsWav("whisper"), false);
  assert.equal(sttWantsWav("openai"), false);
});

test("an engine with no model picked is skipped for the next one", () => {
  const base = { explicitWhisperUrl: "", whisperReachable: true, whisperModel: "", builtinInstalled: false, openAiKey: "", openAiModel: "" };
  assert.equal(pickSttBackend({ ...base, builtinInstalled: true }), "builtin", "a Whisper that answers, with no model: built-in");
  assert.equal(pickSttBackend({ ...base, explicitWhisperUrl: "http://stt.lan:9000", openAiKey: "sk-test", openAiModel: "my-ears" }), "openai", "then OpenAI");
  assert.equal(pickSttBackend({ ...base, openAiKey: "sk-test" }), "none", "OpenAI with no model is skipped too");
  assert.equal(pickSttBackend({ ...base, openAiKey: "sk-test", openAiModel: "  " }), "none");
  assert.equal(pickSttBackend(base), "none");
  assert.equal(whisperNeedsModel(base), true, "the admin panel is told the server needs its model");
  assert.equal(whisperNeedsModel({ ...base, whisperModel: "large-v3" }), false);
  assert.equal(whisperNeedsModel({ ...base, whisperReachable: false }), false, "no server, nothing to pick");
});

// The Whisper service's model: the one picked (saved, else STT_MODEL), else
// the only one the service lists. STT_URL names the service for the
// voice-chat transcript and for push-to-talk alike.
process.env.STT_URL = "http://stt.test:8870";
const realFetch = globalThis.fetch;
let listed = ["large-v3", "small"];
let listings = 0;
const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/v1/models")) {
    listings += 1;
    if (!listed) throw new TypeError("fetch failed");
    return Response.json({ data: listed.map((id) => ({ id })) });
  }
  sent.push({ url: String(url), model: init.body.get("model") });
  return Response.json({ text: "The bridge is out." });
};
// The capability probe's cached answer: an address the admin named counts
// as there either way, but only one the probe heard is asked for its list.
const answers = async () => true;
const silent = async () => false;
saveGlobalConfig({ speech: { sttModel: "" } });
assert.equal(await sttAvailable(), false, "two models and none picked: transcription is not configured");
assert.deepEqual(await transcribeAudio(new Blob(["ring"]), "ring.webm", null), { error: "This server has no transcription service configured." });
assert.equal(sent.length, 0, "nothing was sent without a model");
assert.equal(pickSttBackend(await sttInputs(answers)), "none", "push-to-talk skips it too");
assert.equal(whisperNeedsModel(await sttInputs(answers)), true);
assert.equal(listings, 1, "the service's answer, several models, is remembered, not asked again on every check");
// A few minutes later (the memory cleared), the service runs one model.
forgetSoleModelsForTests();
listed = ["large-v3"];
assert.equal(await sttAvailable(), true, "the service's only model is used");
assert.deepEqual(await transcribeAudio(new Blob(["ring"]), "ring.webm", null), { text: "The bridge is out." });
assert.deepEqual(sent.at(-1), { url: "http://stt.test:8870/v1/audio/transcriptions", model: "large-v3" });
assert.equal(pickSttBackend(await sttInputs(answers)), "whisper");
// A named service the probe did not hear is not asked for its list: the
// listing waits up to 12 s and is not the probe's to cache.
forgetSoleModelsForTests();
listings = 0;
const unheard = await sttInputs(silent);
assert.equal(listings, 0, "a service the probe did not hear was asked for its models");
assert.equal(unheard.whisperReachable, true, "a named address still counts as there");
assert.equal(unheard.whisperModel, "");
process.env.STT_MODEL = "env-model";
assert.equal(pickSttBackend(await sttInputs(async () => assert.fail("a named address with its model picked is not probed"))), "whisper");
await transcribeAudio(new Blob(["ring"]), "ring.webm", null);
assert.equal(sent.at(-1).model, "env-model", "STT_MODEL is picked over the listed one");
saveGlobalConfig({ speech: { sttModel: "saved-model" } });
await transcribeAudio(new Blob(["ring"]), "ring.webm", null);
assert.equal(sent.at(-1).model, "saved-model", "the saved model wins");
delete process.env.STT_MODEL;
saveGlobalConfig({ speech: { sttModel: "" } });
passed += 1;

// A Whisper box that does not answer: the transcript has no probe of its
// own, so the failed listing is remembered for the probe's half minute
// instead of costing a listing timeout on every ring.
forgetSoleModelsForTests();
listed = null;
listings = 0;
assert.equal(await sttAvailable(), false);
assert.deepEqual(await transcribeAudio(new Blob(["ring"]), "ring.webm", null), { error: "This server has no transcription service configured." });
assert.equal(await sttAvailable(), false);
assert.equal(listings, 1, "a service that did not answer was asked again straight away");
passed += 1;

// The transcript sends to the address push-to-talk uses, the admin's before
// STT_URL, so the model picked from that service's list reaches it.
forgetSoleModelsForTests();
listed = ["large-v3"];
saveGlobalConfig({ speech: { sttUrl: "http://admin-stt.test:9000/" } });
await transcribeAudio(new Blob(["ring"]), "ring.webm", null);
assert.equal(sent.at(-1).url, "http://admin-stt.test:9000/v1/audio/transcriptions", "the transcript went to STT_URL, not the admin's address");
// Off in the admin panel is off for the transcript too.
saveGlobalConfig({ speech: { sttUrl: "off" } });
assert.equal(await sttAvailable(), false);
// With nothing named, the transcript stays off: it never dials the default
// address push-to-talk probes.
saveGlobalConfig({ speech: { sttUrl: "" } });
delete process.env.STT_URL;
const before = sent.length;
listings = 0;
assert.equal(await sttAvailable(), false);
assert.deepEqual(await transcribeAudio(new Blob(["ring"]), "ring.webm", null), { error: "This server has no transcription service configured." });
assert.equal(sent.length, before);
assert.equal(listings, 0, "the default address was asked for its models");
globalThis.fetch = realFetch;
passed += 1;

test("the page's engine follows the server, then the device", () => {
  assert.equal(pickDictationEngine(null, true), "upload");
  assert.equal(pickDictationEngine(undefined, false), "upload");
  assert.equal(pickDictationEngine({ configured: true }, true), "upload");
  assert.equal(pickDictationEngine({ configured: true, wantsWav: true }, true), "upload-wav");
  assert.equal(pickDictationEngine({ configured: false }, true), "native");
  assert.equal(pickDictationEngine({ configured: false }, false), "none");
});

// With no engine at all, both mic buttons stay hidden, as Admin > Speech
// tells the admin. DictateField always did; the composer's push-to-talk
// showed a mic that could only fail.
test("both mic buttons hide when there is no engine", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(read("src/lib/use-dictation.ts"), /available: engine !== "none"/);
  assert.match(read("src/components/DictateField.tsx"), /const shown = dictation\.available;/);
  const pushToTalk = read("src/app/campaigns/[campaignId]/PushToTalk.tsx");
  assert.match(pushToTalk, /\bavailable \} = useDictation\(/);
  assert.match(pushToTalk, /if \(!available\) \{\s*return null;\s*\}/);
  // Admin > Speech says so, without promising it of the Android app, whose
  // native engine keeps the mics on the phone's recognizer.
  assert.match(read("src/app/admin/BuiltinSpeechCard.tsx"), /none: "nothing yet, so the mic buttons are hidden \(the Android app uses the phone's own recognizer\)"/);
});

// Voice-chat transcription asks the transcript route's own question
// (sttAvailable): a server that cannot write anything down holds the table's
// switch off, and the call neither records rings nor tells everyone it is
// being transcribed. A server that does not say is taken at its word.
const { transcribesVoice } = await import("../src/lib/use-capabilities.ts");
test("transcription waits on a server that can write it down", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.equal(transcribesVoice(null), true);
  assert.equal(transcribesVoice({ voice: { enabled: true, mode: "auto" } }), true, "an older server's answer hid the switch");
  assert.equal(transcribesVoice({ voice: { enabled: true, mode: "auto", transcribes: false } }), false);
  assert.match(read("src/lib/capabilities.ts"), /transcribes: Boolean\(dictation\.explicitWhisperUrl && dictation\.whisperModel\)/);
  const panel = read("src/app/campaigns/[campaignId]/GameSettingsGroups.tsx");
  assert.match(panel, /on=\{settings\.voice\.transcribe && transcribes\}\s*disabled=\{!transcribes\}/);
  assert.match(read("src/app/campaigns/[campaignId]/SessionView.tsx"), /const transcribe = Boolean\(voiceSettings\?\.transcribe\) && transcribesVoice\(capabilities\);/);
  assert.match(read("src/app/campaigns/[campaignId]/Lobby.tsx"), /campaign\.gameSettings\.voice\.transcribe && transcribes \? \(/);
});

// A take still live when the engine goes (a capabilities refresh that finds
// no speech-to-text) is ended by the hook: the button it would be released
// on hides with the engine, and the recorder would run to its time limit.
test("a live take ends when the engine goes away", () => {
  const hook = readFileSync(new URL("../src/lib/use-dictation.ts", import.meta.url), "utf8");
  assert.match(
    hook,
    /subscribeCapabilities\(\(next\) => \{\s*if \(activeRef\.current && pickDictationEngine\(next\?\.stt, hasNativeDictation\(\)\) === "none"\) \{\s*cancel\(\);/,
  );
});

test("WAV goes out and comes back as the same samples", () => {
  const samples = Float32Array.from({ length: 1600 }, (_, index) => Math.sin(index / 7) * 0.5);
  const bytes = encodeWav(samples);
  assert.equal(bytes.length, 44 + samples.length * 2);
  const back = decodeWav(bytes);
  assert.ok(back);
  assert.equal(back.sampleRate, SPEECH_SAMPLE_RATE);
  assert.equal(back.samples.length, samples.length);
  for (let index = 0; index < samples.length; index += 97) {
    assert.ok(Math.abs(back.samples[index] - samples[index]) < 1e-3, `sample ${index}`);
  }
  // Loud values clip rather than wrap.
  const loud = decodeWav(encodeWav(Float32Array.of(2, -2)));
  assert.ok(loud.samples[0] > 0.99 && loud.samples[1] < -0.99);
});

test("stereo and float WAV read as mono; anything else is refused", () => {
  const frames = 4;
  const bytes = new Uint8Array(44 + frames * 2 * 4);
  const view = new DataView(bytes.buffer);
  const text = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + frames * 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 48000 * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  text(36, "data"); view.setUint32(40, frames * 8, true);
  for (let frame = 0; frame < frames; frame += 1) {
    view.setFloat32(44 + frame * 8, 0.5, true);
    view.setFloat32(48 + frame * 8, -0.1, true);
  }
  const read = decodeWav(bytes);
  assert.equal(read.sampleRate, 48000);
  assert.equal(read.samples.length, frames);
  assert.ok(Math.abs(read.samples[0] - 0.2) < 1e-6);
  assert.equal(decodeWav(new TextEncoder().encode("not a wav file at all, just some text here....")), null);
  assert.equal(decodeWav(new Uint8Array(10)), null);
});

test("a long take goes up in parts, cut at a pause", () => {
  const rate = SPEECH_SAMPLE_RATE;
  const short = new Float32Array(rate * 30);
  assert.equal(splitForUpload(short).length, 1);
  // Five minutes of "speech" with one silent half second near each limit.
  const long = Float32Array.from({ length: rate * 300 }, (_, index) => Math.sin(index / 5) * 0.4);
  const pauseAt = rate * (SPEECH_CHUNK_SECONDS - 3);
  long.fill(0, pauseAt, pauseAt + rate / 2);
  const parts = splitForUpload(long);
  assert.equal(parts.reduce((sum, part) => sum + part.length, 0), long.length);
  assert.ok(parts.every((part) => part.length <= rate * SPEECH_CHUNK_SECONDS));
  assert.ok(parts.length >= 3);
  // The first cut lands inside the pause, not at the hard limit.
  assert.ok(parts[0].length >= pauseAt && parts[0].length <= pauseAt + rate / 2, String(parts[0].length / rate));
  // Every part fits /api/stt's 8 MB as WAV.
  assert.ok(encodeWav(parts[0]).length < 8 * 1024 * 1024);
});

// A named Whisper box that takes the connection and never answers (a GPU
// machine switched off behind a firewall that drops, not refuses): the
// first capabilities read pays the probe's short timeout, and the next is
// answered from the probe's cache instead of a 12 s model listing each time.
{
  const sockets = [];
  const hole = net.createServer((socket) => sockets.push(socket));
  await new Promise((resolve) => hole.listen(0, "127.0.0.1", resolve));
  const saved = Object.fromEntries(["STT_URL", "KOKORO_URL", "COMFYUI_URL", "OPENAI_COMPAT_BASE_URL"].map((name) => [name, process.env[name]]));
  process.env.STT_URL = `http://127.0.0.1:${hole.address().port}`;
  // Everything else the snapshot asks refuses at once.
  process.env.KOKORO_URL = "http://127.0.0.1:9";
  process.env.COMFYUI_URL = "http://127.0.0.1:9";
  process.env.OPENAI_COMPAT_BASE_URL = "http://127.0.0.1:9/v1";
  saveGlobalConfig({ speech: { sttUrl: "", sttModel: "" } });
  forgetSoleModelsForTests();
  try {
    const timed = async () => {
      const started = Date.now();
      await capabilitiesSnapshot();
      return Date.now() - started;
    };
    const first = await timed();
    const second = await timed();
    assert.ok(first < 8_000, `the first snapshot took ${first} ms`);
    assert.ok(second < 1_500, `the second snapshot took ${second} ms`);
  } finally {
    for (const socket of sockets) socket.destroy();
    hole.close();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  passed += 1;
}

removeTempDir(dir);
console.log(`dictation: ${passed} checks passed`);
