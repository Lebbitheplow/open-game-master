import { configValue, getGlobalConfig } from "@/lib/app-config";
import { soleListedModel } from "@/lib/model-registry/discovery";
import { openAiSpeechConfig } from "@/lib/openai-images";
import { builtinSpeechInstalled } from "@/lib/stt-builtin";
import { whisperSwitchedOff, type SttInputs } from "@/lib/stt-logic";

// Speech to text (docs/vtt-parity-implementation-plan.md 13.3): a
// faster-whisper server speaking the OpenAI transcription shape, named in
// Admin > Speech or by STT_URL, with the model picked for it there, or the
// one model it lists. Off when either is missing; nothing here ever runs
// without an operator choosing it.

// Where dictation's Whisper service is: the admin's address, STT_URL, or
// odm-stt's usual one.
export function whisperUrl(): string {
  return configValue(getGlobalConfig().speech.sttUrl, "STT_URL", "http://127.0.0.1:8870");
}

// The model the Whisper service at `base` is asked for, push-to-talk
// (src/app/api/stt/route.ts) and the voice-chat transcript alike: the one
// picked, else the only one the service lists (a Whisper service usually
// loads one), else none and the service is skipped.
export async function whisperModelFor(base: string): Promise<string> {
  return pickedWhisperModel() || (await soleListedModel({ provider: "speech", baseUrl: base }));
}

function pickedWhisperModel(): string {
  return configValue(getGlobalConfig().speech.sttModel, "STT_MODEL");
}

// What the pure rule in stt-logic.ts decides from. `reachable` says whether
// a Whisper service answers at an address (the capability probe's cached
// answer, src/lib/capabilities.ts), passed in so this module stays below
// that one.
export async function sttInputs(reachable: (url: string) => Promise<boolean>): Promise<SttInputs> {
  const configured = configValue(getGlobalConfig().speech.sttUrl, "STT_URL");
  const off = whisperSwitchedOff(configured);
  const explicitWhisperUrl = off ? "" : configured;
  const picked = off ? "" : pickedWhisperModel();
  // An address the admin or STT_URL named counts as there, answering or not
  // (some Whisper servers do not answer the probe's model list), and with
  // its model picked nothing more is asked. Without one, the service is
  // asked for its list only when the probe heard it: the probe is cached for
  // half a minute and a listing is not, so a named box that is switched off
  // costs one short probe per window instead of a 12 s listing on every
  // capabilities read.
  const answering = off || (explicitWhisperUrl && picked) ? false : await reachable(whisperUrl());
  const openAi = openAiSpeechConfig();
  return {
    explicitWhisperUrl,
    whisperReachable: Boolean(explicitWhisperUrl) || answering,
    whisperModel: picked || (answering ? await whisperModelFor(whisperUrl()) : ""),
    builtinInstalled: builtinSpeechInstalled(),
    openAiKey: openAi.apiKey,
    openAiModel: openAi.model,
  };
}

// The voice-chat transcript's Whisper service: the one push-to-talk uses
// (whisperUrl), so the model picked from that service's list is sent to that
// service. Only an address the admin or STT_URL named, never the default
// one, which the transcript has never dialled on its own.
export function sttUrl(): string {
  const configured = configValue(getGlobalConfig().speech.sttUrl, "STT_URL");
  // "off" is the dictation switch for "no Whisper here" (stt-logic.ts).
  return whisperSwitchedOff(configured) ? "" : configured.replace(/\/+$/, "");
}

export async function sttAvailable(): Promise<boolean> {
  const base = sttUrl();
  return Boolean(base) && Boolean(await whisperModelFor(base));
}

// `language` is Whisper's code for the ring's table (whisperLanguageCode),
// null to let it guess.
export async function transcribeAudio(audio: Blob, filename: string, language: string | null): Promise<{ text: string } | { error: string }> {
  const base = sttUrl();
  const model = base ? await whisperModelFor(base) : "";
  if (!base || !model) {
    return { error: "This server has no transcription service configured." };
  }
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);
  form.append("response_format", "json");
  if (language) {
    form.append("language", language);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${base}/v1/audio/transcriptions`, { method: "POST", body: form, signal: controller.signal });
    if (!response.ok) {
      return { error: `The transcriber answered ${response.status}.` };
    }
    const data = (await response.json().catch(() => ({}))) as { text?: string };
    return { text: String(data.text ?? "") };
  } catch {
    return { error: "The transcriber could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}
