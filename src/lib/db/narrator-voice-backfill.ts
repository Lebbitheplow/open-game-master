import type { SqliteDatabase } from "./driver.ts";
import { NARRATOR_DEFAULTS } from "../tts-voices.ts";
import type { TableLanguage } from "../schemas/game-settings-options.ts";

// The narrator a table in Spanish, French, Italian or Portuguese started on
// before Kokoro's voices in those languages were offered: the one English
// voice every campaign was given, which read the story with English sounds.
// Each such table that still has it (or none, which reads as it), and each
// person's saved defaults that pair such a language with it, moves once to
// its language's own narrator, as a change of table language moves it now
// (src/lib/tts-voices.ts narratorVoiceFor). Any other voice was picked and
// stays. Run once behind an app_settings marker (src/lib/db/core.ts), so a
// table that picks the English voice again afterwards keeps it.
const OLD_NARRATOR = "af_heart";

function languageNarrator(settings: Record<string, unknown>): string | null {
  const language = settings.tableLanguage;
  if (typeof language !== "string" || language === "english") {
    return null;
  }
  const narrator = NARRATOR_DEFAULTS[language as TableLanguage];
  const voice = typeof settings.ttsVoice === "string" ? settings.ttsVoice.trim() : "";
  return narrator && (voice === "" || voice === OLD_NARRATOR) ? narrator : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parsed(raw: string | null): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw ?? "");
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

// How many tables and saved defaults moved.
export function backfillNarratorVoices(db: SqliteDatabase): number {
  let moved = 0;
  const campaigns = db.prepare(`SELECT id, game_settings_json FROM campaigns`).all() as Array<{ id: string; game_settings_json: string | null }>;
  const writeCampaign = db.prepare(`UPDATE campaigns SET game_settings_json = ? WHERE id = ?`);
  for (const row of campaigns) {
    const settings = parsed(row.game_settings_json);
    const narrator = settings ? languageNarrator(settings) : null;
    if (settings && narrator) {
      writeCampaign.run(JSON.stringify({ ...settings, ttsVoice: narrator }), row.id);
      moved += 1;
    }
  }
  // A saved setup always names its voice (create-campaign/defaults.ts saves
  // every draft key), so only one that names the old narrator moves.
  const users = db.prepare(`SELECT id, settings_json FROM users WHERE settings_json IS NOT NULL`).all() as Array<{
    id: string;
    settings_json: string | null;
  }>;
  const writeUser = db.prepare(`UPDATE users SET settings_json = ? WHERE id = ?`);
  for (const row of users) {
    const settings = parsed(row.settings_json);
    const defaults = settings?.campaignDefaults;
    const saved = isRecord(defaults) && isRecord(defaults.settings) ? defaults.settings : null;
    const narrator = saved && typeof saved.ttsVoice === "string" ? languageNarrator(saved) : null;
    if (settings && isRecord(defaults) && saved && narrator) {
      writeUser.run(JSON.stringify({ ...settings, campaignDefaults: { ...defaults, settings: { ...saved, ttsVoice: narrator } } }), row.id);
      moved += 1;
    }
  }
  return moved;
}
