"use client";

import { useEffect, useState } from "react";
import type { EmbeddingLanguageCheck, ProbedLanguage } from "@/lib/embedding-language-logic";
import { embeddingWarning, type EmbeddingWarning } from "@/lib/embedding-language-text";
import type { TableLanguage } from "@/lib/schemas/game-settings-options";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";

// The warning that this server's embedding model cannot read a table's
// language, for every place that shows it (under Table language, above the
// composer, in the lobby, on the admin page). null for English, while the
// server is still finding out (the first time, that includes loading the
// model) and when the model reads every language asked about: nothing is shown
// until there is something to say, and it appears without a reload. The server
// probes each language once, so asking again costs a lookup.
//
// An app's screens opened on an older host, which has no check route, ask
// nothing (SERVER_FEATURES embeddingLanguage in src/lib/capabilities.ts).
export function useEmbeddingWarning(languages: readonly TableLanguage[]): EmbeddingWarning | null {
  const offered = hostOffers(useCapabilities(), "embeddingLanguage");
  // A string, so a new array with the same languages asks nothing again.
  const asked = JSON.stringify(
    offered ? languages.filter((language): language is ProbedLanguage => language !== "english") : [],
  );
  const [known, setKnown] = useState<{ asked: string; checks: EmbeddingLanguageCheck[] } | null>(null);
  useEffect(() => {
    const probed = JSON.parse(asked) as ProbedLanguage[];
    if (probed.length === 0) {
      return;
    }
    let live = true;
    void Promise.all(
      probed.map(async (language) => {
        const response = await fetch(`/api/embeddings/language?language=${language}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`The embedding language check failed (${response.status}).`);
        }
        return (await response.json()) as EmbeddingLanguageCheck;
      }),
    )
      .then((checks) => {
        if (live) {
          setKnown({ asked, checks });
        }
      })
      // A server restarting or out of reach: the page around this says so
      // already, and the warning is asked again on the next visit.
      .catch((error: unknown) => console.error("[embeddings] could not ask which languages the embedding model reads", error));
    return () => {
      live = false;
    };
  }, [asked]);
  // Checks for the languages asked before these say nothing about them.
  return known?.asked === asked ? embeddingWarning(known.checks) : null;
}
