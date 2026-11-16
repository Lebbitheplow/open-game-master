"use client";

import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import type { EmbeddingWarning } from "@/lib/embedding-language-text";
import type { TableLanguage } from "@/lib/schemas/game-settings-options";
import { useEmbeddingWarning } from "@/lib/use-embedding-warning";

// A table playing in a language this server's embedding model cannot read,
// said above the composer and in the lobby (issue #919: two tables played for
// weeks that way, and the GM seemed to forget what the players described).
// Only for those who can fix it (seesEmbeddingWarning). Like the
// AudioWaitingBanner there is nothing to dismiss: it stays until the fix, a
// multilingual model on the server or the table back in English, which the
// campaign's live settings carry to useEmbeddingWarning. `onChangeLanguage`
// is the way to the Table language setting, for whoever may change it.
export function EmbeddingLanguageBanner({
  warning,
  onChangeLanguage,
}: {
  warning: EmbeddingWarning;
  onChangeLanguage?: () => void;
}) {
  return (
    <SessionBanner
      glyph="system-lore"
      title={warning.title}
      actions={
        onChangeLanguage ? (
          <button type="button" className={bannerButtonClass(true)} onClick={onChangeLanguage}>
            Table language
          </button>
        ) : undefined
      }
    >
      <span role="status" className="block break-words">
        {warning.body}
      </span>
    </SessionBanner>
  );
}

// The banner where its place holds nothing else (the lobby): asks the server
// itself and takes no room until there is something to say.
export function EmbeddingLanguageNotice({
  language,
  className,
  onChangeLanguage,
}: {
  language: TableLanguage;
  className?: string;
  onChangeLanguage?: () => void;
}) {
  const warning = useEmbeddingWarning([language]);
  if (!warning) {
    return null;
  }
  return (
    <div className={className}>
      <EmbeddingLanguageBanner warning={warning} onChangeLanguage={onChangeLanguage} />
    </div>
  );
}
