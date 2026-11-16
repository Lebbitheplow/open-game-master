// Whether the running embedding model reads a table's language, judged from
// what it does with the fixed probe sentences (src/lib/language/
// probe-sentences.ts), never from its name: a model reads the language when
// each sentence lands nearest its own English translation. Pure, so the test
// script loads it directly; the embedding itself is src/lib/embedding-language.ts.

import type { TableLanguage } from "./schemas/game-settings-options.ts";

// "unavailable": the model did not load, so retrieval runs on keyword
// matching alone, whatever the language.
export type EmbeddingLanguageVerdict = "reads" | "english_only" | "unavailable";

export type ProbedLanguage = Exclude<TableLanguage, "english">;

// What the language check route answers.
export type EmbeddingLanguageCheck = { language: ProbedLanguage; verdict: EmbeddingLanguageVerdict };

// Measured on the eight probe sentences in all 14 other table languages:
// all-MiniLM-L6-v2, which reads English only, matched at most 4 (French; most
// languages 0 to 2), and multilingual-e5-small at least 7 (Irish; 8 in the
// rest). Six leaves a margin of two on either side. It counts matches rather
// than comparing a similarity with a fixed value, which differs from one model
// to the next.
export const PROBE_MATCHES_NEEDED = 6;

// Unit-normalized vectors, so the dot product is the cosine.
function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    sum += a[index] * b[index];
  }
  return sum;
}

// `table[i]` and `english[i]` are the same sentence in the two languages.
export function readsBesideEnglish(table: Float32Array[], english: Float32Array[]): boolean {
  let matches = 0;
  for (const [index, vector] of table.entries()) {
    let nearest = 0;
    for (let other = 1; other < english.length; other += 1) {
      if (dot(vector, english[other]) > dot(vector, english[nearest])) {
        nearest = other;
      }
    }
    if (nearest === index) {
      matches += 1;
    }
  }
  return matches >= PROBE_MATCHES_NEEDED;
}

// Who is warned in the session and the lobby: whoever can switch the table's
// language (story authority, the settings route's gate) and the admins, who
// can set the server's model. The other players could do nothing about it.
export function seesEmbeddingWarning(viewer: { steersStory: boolean; isAdmin: boolean }): boolean {
  return viewer.steersStory || viewer.isAdmin;
}
