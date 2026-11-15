// The one wording of the warning that the embedding model cannot read a
// table's language, shared by the banner above the composer and in the lobby,
// the line under Table language and the admin page's line, so the fix reads
// the same wherever it is met. The model it names is the one docs/install.md
// recommends for a table in another language.

import type { EmbeddingLanguageCheck, ProbedLanguage } from "./embedding-language-logic.ts";
import { TABLE_LANGUAGE_NAMES } from "./schemas/game-settings-options.ts";

// `languages`: those the warning is about, for naming the campaigns concerned.
export type EmbeddingWarning = { title: string; body: string; languages: ProbedLanguage[] };

// "Italian", "Italian or French", "Italian, French or German".
function anyOf(languages: readonly ProbedLanguage[]): string {
  const names = languages.map((language) => TABLE_LANGUAGE_NAMES[language].english);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
}

// One warning for every language checked (one under a picker, each campaign's
// on the admin page); null when the model reads them all.
export function embeddingWarning(checks: readonly EmbeddingLanguageCheck[]): EmbeddingWarning | null {
  // A model that did not load reads no language at all.
  if (checks.some((check) => check.verdict === "unavailable")) {
    return {
      title: "The GM's memory is not running",
      body:
        "This server's embedding model did not load, so the GM finds earlier scenes, lore and facts only by their " +
        "exact words. The server log says why: make sure the server can download EMBEDDING_MODEL (or run npm run " +
        "fetch-model), then restart it.",
      languages: checks.map((check) => check.language),
    };
  }
  const unread = checks.filter((check) => check.verdict === "english_only").map((check) => check.language);
  if (unread.length === 0) {
    return null;
  }
  const names = anyOf(unread);
  return {
    title: `The GM's memory cannot read ${names}`,
    body:
      `This server's embedding model reads only English, so at a table playing in ${names} the GM misses earlier ` +
      "scenes, lore and facts the players describe in other words. Set a multilingual model in .env.server " +
      "(EMBEDDING_MODEL=Xenova/multilingual-e5-small and EMBEDDING_DTYPE=q8) and restart the server, or play in English.",
    languages: unread,
  };
}
