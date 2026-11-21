// A readability check on authored prose (issue #302).
//
// Text that arrives with its spaces gone ("the mill.The miller") may have
// been written that way, pasted from a PDF that lost its layout, or mangled
// somewhere nobody can see. Nothing here decides which: it reports what
// LOOKS compressed, names a sample, and leaves the words exactly as written.
// Pure, so the storyboard editor, the lore editor, the bundle preview and the
// import planner all read the same heuristic, and so it is testable.

export type ProseWarning = {
  kind: "joined-sentences" | "long-run" | "few-spaces";
  message: string;
  samples: string[];
};

// A lowercase letter, sentence punctuation, then a capital with no space:
// "road.The". Two or more is a pattern; one may be an initialism.
const JOINED = /\p{Ll}[.!?]{1,3}\p{Lu}\p{Ll}/gu;
// Letters only, this long, with no space: not a word in any language the
// table plays in, and not a URL (those carry punctuation).
const LONG_RUN = /\p{L}{28,}/gu;
const MIN_JOINED = 2;
const FEW_SPACES_MIN_LENGTH = 200;
// Ordinary prose has a space every five or six characters.
const FEW_SPACES_RATIO = 1 / 14;

function around(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 12);
  const end = Math.min(text.length, index + length + 12);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "..." : ""}`;
}

export function checkProse(text: string): ProseWarning[] {
  const warnings: ProseWarning[] = [];
  if (!text || !text.trim()) {
    return warnings;
  }
  const joined = [...text.matchAll(JOINED)];
  if (joined.length >= MIN_JOINED) {
    warnings.push({
      kind: "joined-sentences",
      message: `${joined.length} places read as a missing space after a sentence.`,
      samples: joined.slice(0, 3).map((match) => around(text, match.index ?? 0, match[0].length)),
    });
  }
  const runs = [...text.matchAll(LONG_RUN)];
  if (runs.length) {
    warnings.push({
      kind: "long-run",
      message: `${runs.length} stretch${runs.length === 1 ? "" : "es"} of ${LONG_RUN.source.match(/\d+/)?.[0]} or more letters with no space.`,
      samples: runs.slice(0, 3).map((match) => around(text, match.index ?? 0, Math.min(match[0].length, 40))),
    });
  }
  if (text.length >= FEW_SPACES_MIN_LENGTH) {
    const spaces = (text.match(/\s/g) ?? []).length;
    if (spaces / text.length < FEW_SPACES_RATIO && !runs.length) {
      warnings.push({
        kind: "few-spaces",
        message: "Unusually few spaces for prose of this length.",
        samples: [around(text, 0, 60)],
      });
    }
  }
  return warnings;
}

// The shape of a translator, as the pure sentence builders take it: the
// editor that shows the words passes its own.
type T = (key: string, vars?: Record<string, string | number>) => string;

// The same check, worded in the reader's language (workshop.prose.*).
export function checkProseT(t: T, text: string): ProseWarning[] {
  return checkProse(text).map((warning) => ({
    ...warning,
    message:
      warning.kind === "joined-sentences"
        ? t("{count} places read as a missing space after a sentence.", { count: JOINED_COUNT(text) })
        : warning.kind === "long-run"
          ? t("{count} stretches of 28 or more letters with no space.", { count: LONG_RUN_COUNT(text) })
          : t("Unusually few spaces for prose of this length."),
  }));
}

// The counts the English messages embed, re-derived for the translated ones.
function JOINED_COUNT(text: string): number {
  return [...text.matchAll(JOINED)].length;
}
function LONG_RUN_COUNT(text: string): number {
  return [...text.matchAll(LONG_RUN)].length;
}

// The cap's account, in the reader's words: the label (already translated by
// the caller), the lengths, and the tail that would be lost.
export function overflowLineT(t: T, label: string, text: string, max: number): string {
  if (text.length <= max) {
    return "";
  }
  const lost = text.slice(max).trim();
  const shown = lost.length > 60 ? `${lost.slice(0, 60).trimEnd()}...` : lost;
  return t("{label} is {count} characters; the limit is {max}. The last {lostCount} would be lost{tail}.", {
    label,
    count: text.length.toLocaleString("en-US"),
    max: max.toLocaleString("en-US"),
    lostCount: (text.length - max).toLocaleString("en-US"),
    tail: shown ? `: "${shown}"` : "",
  });
}

// One line for a list of items: the editor shows the warnings in full, the
// import preview says which card and why. English-pinned: the bundle and the
// import planner quote it beside the file's own data.
export function proseWarningLine(warnings: ProseWarning[]): string {
  if (!warnings.length) {
    return "";
  }
  const sample = warnings[0].samples[0] ? ` (${warnings[0].samples[0]})` : "";
  return `${warnings.map((warning) => warning.message).join(" ")}${sample} It may have been written this way; the text is kept as it is.`;
}

// An exact account of what a cap would cut (issue #302), for the message
// that goes beside the field or in the plan: the lengths, and the tail that
// would be lost.
export function overflowLine(label: string, text: string, max: number): string {
  if (text.length <= max) {
    return "";
  }
  const lost = text.slice(max).trim();
  const shown = lost.length > 60 ? `${lost.slice(0, 60).trimEnd()}...` : lost;
  return `${label} is ${text.length.toLocaleString("en-US")} characters; the limit is ${max.toLocaleString("en-US")}. The last ${(text.length - max).toLocaleString("en-US")} would be lost${shown ? `: "${shown}"` : ""}.`;
}
