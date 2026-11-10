import { stripToolText } from "./dm/tool-text.ts";

// A passage as plain prose, with the Markdown emphasis the DM sometimes
// writes in stripped away: every paragraph for the table's chronicle scroll
// (browser), which shows each entry whole, and the first one trimmed at a
// sentence for the title screen's glance (server). Pure, so both can share it.
const RECAP_LIMIT = 360;

export function recapParagraphs(content: string): string[] {
  // Leaked tool text, and a card's line a passage stored before issue 900's
  // fix still carries, ids and all: the transcript never shows them
  // (MessageContent.tsx), and neither do the scroll and the glance.
  return stripToolText(content)
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((part) =>
      part
        // Inline roll markers render as cards in the transcript; here they
        // are noise (src/app/campaigns/[campaignId]/MessageContent.tsx).
        .replace(/\[roll:[^\]]+\]/g, " ")
        .replace(/[*_`#>]+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((part) => part.length > 0);
}

export function clipRecap(content: string, limit = RECAP_LIMIT): string {
  const paragraph = recapParagraphs(content)[0];
  if (!paragraph) {
    return "";
  }
  if (paragraph.length <= limit) {
    return paragraph;
  }
  const window = paragraph.slice(0, limit);
  const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentenceEnd > limit * 0.45) {
    return window.slice(0, sentenceEnd + 1);
  }
  const wordEnd = window.lastIndexOf(" ");
  return `${window.slice(0, wordEnd > 0 ? wordEnd : limit).trimEnd()}…`;
}
