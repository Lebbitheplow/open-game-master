"use client";

import type { TableLanguage } from "@/lib/schemas/game-settings-options";

// The table language of each campaign page this tab has open, for the
// phone's own recognizer (src/lib/use-dictation.ts): it listens on the
// device and must be told the language there, where the server's engines
// look the campaign up from the id a clip carries (src/app/api/stt/route.ts).
// The campaign page notes it as its settings arrive and change.
const languages = new Map<string, TableLanguage>();

export function noteTableLanguage(campaignId: string, language: TableLanguage): void {
  languages.set(campaignId, language);
}

export function tableLanguageOf(campaignId: string | undefined): TableLanguage | null {
  return campaignId ? (languages.get(campaignId) ?? null) : null;
}
