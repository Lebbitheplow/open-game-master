// The server's own language: the one its tables are expected to play in.
// An admin picks it in the setup wizard or under Admin > Settings, and it
// does two things. New campaigns start in it (a person's saved defaults and
// the creator's own choice still win), and it picks the embedding model the
// GM's memory search reads the story with: English keeps the small English
// model, any other language takes a multilingual one (issue #919: tables
// played for weeks in French and Italian on the English-only default, and
// the GM seemed to forget). An EMBEDDING_MODEL the operator set in
// .env.server always wins, so a server that chose its own model keeps it.
//
// Pure: src/lib/embeddings.ts reads it under plain Node, and
// scripts/test-server-language.mjs pins it.

import type { TableLanguage } from "../schemas/game-settings-options.ts";

export type EmbeddingModelChoice = {
  id: string;
  dtype: string;
  // "env": EMBEDDING_MODEL in .env.server named it; "language": the server's
  // language picked it.
  source: "env" | "language";
};

export const ENGLISH_EMBEDDING_MODEL = { id: "Xenova/all-MiniLM-L6-v2", dtype: "fp32" } as const;
// The model docs/install.md recommends for a table in another language: 384
// dimensions like MiniLM, so stored vectors keep their size, and the q8
// weights keep it as quick on a CPU as the English one.
export const MULTILINGUAL_EMBEDDING_MODEL = { id: "Xenova/multilingual-e5-small", dtype: "q8" } as const;

// `pinned`: EMBEDDING_MODEL and EMBEDDING_DTYPE as the operator wrote them
// ("" when unset). A dtype set alone still applies to the model the language
// picks, as it did before the language existed.
export function embeddingModelFor(
  language: TableLanguage,
  pinned: { model: string; dtype: string },
): EmbeddingModelChoice {
  const model = pinned.model.trim();
  const dtype = pinned.dtype.trim();
  if (model) {
    return { id: model, dtype: dtype || "fp32", source: "env" };
  }
  const picked = language === "english" ? ENGLISH_EMBEDDING_MODEL : MULTILINGUAL_EMBEDDING_MODEL;
  return { id: picked.id, dtype: dtype || picked.dtype, source: "language" };
}

// The flag shown beside each language (src/components/ui/LanguageFlag.tsx).
// A flag stands for a country, not a language; each is the one most players
// of that language will look for, by ISO 3166 code.
export const LANGUAGE_FLAGS: Record<TableLanguage, string> = {
  english: "gb",
  danish: "dk",
  dutch: "nl",
  finnish: "fi",
  french: "fr",
  german: "de",
  hungarian: "hu",
  indonesian: "id",
  irish: "ie",
  italian: "it",
  norwegian: "no",
  portuguese: "pt",
  russian: "ru",
  spanish: "es",
  swedish: "se",
};

// A table language from a BCP 47 tag ("fr-FR", "nb"), for the setup wizard's
// first guess on a fresh server: the admin's own browser language, when it
// is one the server can play in. null for any other.
const BY_CODE: Record<string, TableLanguage> = {
  en: "english", da: "danish", nl: "dutch", fi: "finnish", fr: "french", de: "german",
  hu: "hungarian", id: "indonesian", ga: "irish", it: "italian", no: "norwegian",
  nb: "norwegian", nn: "norwegian", pt: "portuguese", ru: "russian", es: "spanish", sv: "swedish",
};

export function languageFromLocale(tag: string | null | undefined): TableLanguage | null {
  const code = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return Object.hasOwn(BY_CODE, code) ? BY_CODE[code] : null;
}
