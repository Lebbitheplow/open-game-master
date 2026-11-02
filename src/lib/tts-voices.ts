import type { TableLanguage } from "./schemas/game-settings-options.ts";

// Kokoro voices exposed in campaign settings. The service on :8880 accepts
// any installed voice id; this curated list keeps the picker sane. Kokoro
// speaks five of the table languages: a voice reads in its own language
// (the first letter of its id), so the picker offers the table's own first.
// Its Portuguese voices are Brazilian.
export const TTS_VOICES = [
  { id: "af_heart", label: "Heart (warm female)", language: "english" },
  { id: "af_bella", label: "Bella (bright female)", language: "english" },
  { id: "af_aoede", label: "Aoede (calm female)", language: "english" },
  { id: "af_nicole", label: "Nicole (soft female)", language: "english" },
  { id: "am_michael", label: "Michael (warm male)", language: "english" },
  { id: "am_fenrir", label: "Fenrir (deep male)", language: "english" },
  { id: "am_puck", label: "Puck (lively male)", language: "english" },
  { id: "bf_emma", label: "Emma (British female)", language: "english" },
  { id: "bm_george", label: "George (British male)", language: "english" },
  { id: "bm_fable", label: "Fable (British narrator)", language: "english" },
  { id: "ef_dora", label: "Dora (Spanish female)", language: "spanish" },
  { id: "em_alex", label: "Alex (Spanish male)", language: "spanish" },
  { id: "ff_siwis", label: "Siwis (French female)", language: "french" },
  { id: "if_sara", label: "Sara (Italian female)", language: "italian" },
  { id: "im_nicola", label: "Nicola (Italian male)", language: "italian" },
  { id: "pf_dora", label: "Dora (Portuguese female)", language: "portuguese" },
  { id: "pm_alex", label: "Alex (Portuguese male)", language: "portuguese" },
] as const satisfies ReadonlyArray<{ id: string; label: string; language: TableLanguage }>;

// The narrator a table in each Kokoro language starts with. A language not
// here has no Kokoro voice, and its table keeps whichever voice it has.
export const NARRATOR_DEFAULTS: Partial<Record<TableLanguage, string>> = {
  english: "af_heart",
  spanish: "ef_dora",
  french: "ff_siwis",
  italian: "if_sara",
  portuguese: "pf_dora",
};

const DEFAULT_VOICES = new Set(Object.values(NARRATOR_DEFAULTS));

// Kokoro ids are <language><f|m>_<name>; the language letters of the table
// languages it speaks (a and b are American and British English).
const KOKORO_ID = /^([a-z])[fm]_[a-z0-9]+$/;
const KOKORO_LANGUAGES: Record<string, TableLanguage> = { a: "english", b: "english", e: "spanish", f: "french", i: "italian", p: "portuguese" };

// The table language a Kokoro voice reads in; null for a voice that is not
// a Kokoro id (an OpenAI voice, a blend, a custom one) or reads another one.
export function kokoroLanguage(voice: string): TableLanguage | null {
  const letter = KOKORO_ID.exec(voice)?.[1];
  return letter ? (KOKORO_LANGUAGES[letter] ?? null) : null;
}

// The narrator voice for a table now playing in `language`. A voice nobody
// chose (none, or some language's starting voice) follows the language; a
// voice someone picked is theirs and is kept. Only Kokoro voices speak by
// language: on an OpenAI backend the voice is left as it is.
export function narratorVoiceFor(language: TableLanguage, current: string, openAiBackend: boolean): string {
  if (openAiBackend || (current.trim() && !DEFAULT_VOICES.has(current))) {
    return current;
  }
  return NARRATOR_DEFAULTS[language] ?? current;
}

// Whether a GM personality's voice can narrate this table: any voice at a
// table Kokoro has no voice for, else one in the table's language (or not a
// Kokoro id at all). An English preset voice at an Italian table would read
// the story with English sounds, so there the table keeps its narrator.
export function personalityVoiceFits(language: TableLanguage, presetVoice: string): boolean {
  const presetLanguage = kokoroLanguage(presetVoice);
  return !NARRATOR_DEFAULTS[language] || !presetLanguage || presetLanguage === language;
}

// A picker's voices with the table's own language first, so a table in
// Italian sees its Italian voices at the top; the rest follow as listed.
export function voicesFirstIn<T extends { id: string }>(language: TableLanguage, voices: readonly T[]): T[] {
  return [...voices.filter((voice) => kokoroLanguage(voice.id) === language), ...voices.filter((voice) => kokoroLanguage(voice.id) !== language)];
}
