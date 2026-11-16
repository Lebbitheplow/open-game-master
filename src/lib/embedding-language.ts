// Whether the embedding model this server has loaded reads a table's language
// (issue #919: tables played for weeks in French and Italian on the English-
// only default, and the GM seemed to forget). Asked on demand, by a page
// showing a table in a language other than English, and never at boot: a
// server with nothing to embed does not load the model (embedding-reindex.ts).
// The probe embeds fixed sentences, never story text, on the background queue,
// so it never runs ahead of a turn's search.

import { embed } from "@/lib/embeddings";
import { readsBesideEnglish, type EmbeddingLanguageVerdict, type ProbedLanguage } from "@/lib/embedding-language-logic";
import { PROBE_ENGLISH, PROBE_SENTENCES } from "@/lib/language/probe-sentences";

// The model is fixed for the life of the process (EMBEDDING_MODEL is read at
// start), so each language is probed once. Survives dev-mode HMR, as the
// embedder does.
declare global {
  var __odmEmbeddingVerdicts: Map<ProbedLanguage, Promise<EmbeddingLanguageVerdict>> | undefined;
}

async function probe(language: ProbedLanguage): Promise<EmbeddingLanguageVerdict> {
  const sentences = PROBE_SENTENCES[language];
  let vectors: Float32Array[];
  try {
    vectors = await embed([...sentences, ...PROBE_ENGLISH], { background: true });
  } catch (error) {
    // An embedder that does not answer is the outside failure this check
    // reports, not a bug: the table is told, and the log says why. The probe
    // text is fixed, so the error carries no story text.
    console.error("[embeddings] could not check which language the embedding model reads", error);
    return "unavailable";
  }
  return readsBesideEnglish(vectors.slice(0, sentences.length), vectors.slice(sentences.length))
    ? "reads"
    : "english_only";
}

export function embeddingVerdict(language: ProbedLanguage): Promise<EmbeddingLanguageVerdict> {
  const verdicts = (globalThis.__odmEmbeddingVerdicts ??= new Map());
  const known = verdicts.get(language);
  if (known) {
    return known;
  }
  const asked = probe(language).then((verdict) => {
    // A model that did not load may load on the next attempt (embeddings.ts
    // retries with a backoff), so only a verdict on a running model is kept.
    if (verdict === "unavailable") {
      verdicts.delete(language);
    }
    return verdict;
  });
  verdicts.set(language, asked);
  return asked;
}
