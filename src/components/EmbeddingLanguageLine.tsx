"use client";

import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CampaignLanguage } from "@/lib/db/campaigns";
import { TABLE_LANGUAGE_NAMES, type TableLanguage } from "@/lib/schemas/game-settings-options";
import { useEmbeddingWarning } from "@/lib/use-embedding-warning";

// The warning under Table language (the campaign creator, the table settings)
// and on the admin page when this server's embedding model cannot read the
// language: said while the language is picked, where it can still be changed,
// rather than found out in play (issue #919). The admin page asks about every
// campaign's language at once and names the campaigns concerned. Nothing for
// English, and nothing until the server knows.
export function EmbeddingLanguageLine({
  languages,
  campaigns = [],
  className,
}: {
  languages: readonly TableLanguage[];
  campaigns?: readonly CampaignLanguage[];
  className?: string;
}) {
  const warning = useEmbeddingWarning(languages);
  if (!warning) {
    return null;
  }
  const concerned = campaigns.filter((campaign) => warning.languages.includes(campaign.language));
  return (
    <p role="status" className={cn("flex items-start gap-2 text-xs text-amber-200", className)}>
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        {warning.body}
        {concerned.length
          ? ` Campaigns concerned: ${concerned.map((campaign) => `${campaign.title} (${TABLE_LANGUAGE_NAMES[campaign.language].english})`).join(", ")}.`
          : null}
      </span>
    </p>
  );
}
