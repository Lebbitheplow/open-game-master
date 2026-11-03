// What the table reads of a turn the model narrated over several calls
// (src/lib/dm/turn.ts finalize): the fight's bookkeeping taken out of the
// story, and a sentence the turn already said not said again.
//
// Dependency-free so scripts/test-narration-tidy.mjs can import it directly.

import { textKey } from "../language/text-logic.ts";
import { DM_TOOL_NAME_PATTERN, withoutRollMarkers } from "./tool-text.ts";
import type { TableLanguage } from "../schemas/game-settings-options.ts";

// A sentence shorter than this may be said twice on purpose: a shouted
// "Run!", a chant, a name called again.
const MIN_REPEAT_CHARS = 30;

const SENTENCE = /[^.!?\n]+(?:[.!?]+["'”’)\]]*)?\s*|\s+/g;

function tidyBlankLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Each sentence once, in the order the turn first said it: a later call
// repeating an earlier call's prose (Qwen3.6-35B at Q2 printed a paragraph
// twice), or one reply repeating itself. A part left with nothing is dropped.
export function withoutRepeatedSentences(parts: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    let out = "";
    for (const piece of part.match(SENTENCE) ?? [part]) {
      const key = textKey(piece);
      if (key.length >= MIN_REPEAT_CHARS) {
        if (seen.has(key)) {
          out += /\s*$/.exec(piece)?.[0] ?? "";
          continue;
        }
        seen.add(key);
      }
      out += piece;
    }
    const tidy = tidyBlankLines(out);
    if (tidy) {
      kept.push(tidy);
    }
  }
  return kept;
}

// The DM's tools whose names no story uses: the ones with an underscore
// ("move_token", "pc_attack"); "heal", "travel" and "lift" are words too.
const TOOL_NAME = new RegExp(`\\b(?:${DM_TOOL_NAME_PATTERN.split("|").filter((name) => name.includes("_")).join("|")})\\b`);

// A sentence naming one of those tools is the model reasoning aloud ("the
// correct next step is to call move_token for Bram", gpt-oss-20b), never the
// story.
export function withoutToolTalk(text: string): string {
  if (!TOOL_NAME.test(text)) {
    return text;
  }
  let out = "";
  for (const piece of text.match(SENTENCE) ?? [text]) {
    out += TOOL_NAME.test(piece) ? (/\s*$/.exec(piece)?.[0] ?? "") : piece;
  }
  return tidyBlankLines(out);
}

// A line of nothing but the closers of an aside or a quote nobody opened:
// ")*", "]*", ")_", ")*_" (issue 744). The table read a stray ")*" above the
// paragraph. A model can clip its own aside this way, and withoutSentences
// (claims-logic.ts) cannot see that one. A closer beside any other word is
// the sentence's own, so only a whole line goes; ":)" has a colon, and "(like
// this)*" opens what it closes. A line that does close a bracket still open
// above it ends a multi-line aside, and stays; a "(" that never closed earlier
// in the text keeps a stray line too, which beats unclosing an aside.
const ORPHAN_CLOSERS = /^[ \t]*[)\]]+[*_]+[ \t]*(?:\r?\n|$)/gm;

// A closer with nothing open cancels nothing: an orphan above an aside must
// not hide that aside's opener.
function leftOpen(text: string, open: string, close: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === open) {
      depth += 1;
    } else if (char === close && depth > 0) {
      depth -= 1;
    }
  }
  return depth > 0;
}

function closesOpen(before: string, line: string): boolean {
  return (line.includes(")") && leftOpen(before, "(", ")")) || (line.includes("]") && leftOpen(before, "[", "]"));
}

export function withoutOrphanClosers(text: string): string {
  const out = text.replace(ORPHAN_CLOSERS, (line: string, at: number) => (closesOpen(text.slice(0, at), line) ? line : ""));
  return out === text ? text : tidyBlankLines(out);
}

// The same lines as the reply streams to the table's draft (turn.ts): a line
// that so far is only closers and markers is held until it ends, then shown
// or dropped by the rule above. Without it the table watched a ")*" arrive
// and then vanish when the stored passage replaced the draft.
const ORPHAN_LINE = /^[ \t]*[)\]]+[*_]+[ \t\r]*$/;
const MAY_BE_ORPHAN = /^[ \t]*[)\]]*[*_]*[ \t\r]*$/;

export function createOrphanCloserFilter() {
  let shown = "";
  let held = "";
  const drops = (line: string, before: string) => ORPHAN_LINE.test(line) && !closesOpen(before, line);
  return {
    push(chunk: string): string {
      let text = held + chunk;
      held = "";
      let out = "";
      while (text) {
        const before = shown + out;
        const atLineStart = !before || before.endsWith("\n");
        const end = text.indexOf("\n");
        if (end < 0) {
          if (atLineStart && MAY_BE_ORPHAN.test(text)) {
            held = text;
          } else {
            out += text;
          }
          break;
        }
        if (!atLineStart || !drops(text.slice(0, end), before)) {
          out += text.slice(0, end + 1);
        }
        text = text.slice(end + 1);
      }
      shown += out;
      return out;
    },
    flush(): string {
      const out = held && !drops(held, shown) ? held : "";
      held = "";
      shown += out;
      return out;
    },
  };
}

// What the table reads of a turn's parts (turn.ts finalize), and what a
// reroll keeps of the parts before its own take (renarrate.ts). One tidy for
// both: a reroll that reassembled the raw parts brought back the closer
// lines, tool talk and fight bookkeeping the table never read.
export function tableNarrationParts(parts: readonly string[], names: readonly string[], language: TableLanguage): string[] {
  return withoutRepeatedSentences(parts.map((part) => withoutOrphanClosers(withoutToolTalk(withoutCombatBookkeeping(withoutRollMarkers(part), names, language)))));
}

// Whether a reply is mostly the last turn's narration said again: a player
// who repeats a line ("I attack it") got back the paragraph the model wrote
// last time, with no tool, so the new action never happened (gpt-oss-20b and
// Qwen3.6-35B both did it in a fight of identical lines). Two sentences at
// least, most of them the last narration's.
export function repeatsNarration(text: string, previous: string): boolean {
  const keys = (value: string) =>
    (value.match(SENTENCE) ?? []).map((piece) => textKey(piece)).filter((key) => key.length >= MIN_REPEAT_CHARS);
  const now = keys(text);
  if (now.length < 2) {
    return false;
  }
  const before = new Set(keys(previous));
  return now.filter((key) => before.has(key)).length / now.length >= 0.6;
}

// The question a narration ends on: its last sentence, when that asks one.
export function closingQuestion(text: string): string | null {
  const last = (text.trim().match(SENTENCE) ?? []).map((piece) => piece.trim()).filter(Boolean).at(-1);
  return last && /\?["'”’)\]]*$/.test(last) ? last : null;
}

// The line the newest narrations all ended on, word for word, when at least
// `runs` in a row did: a table heard "What does <hero> do?" at the end of
// five replies running (2026-10-23), and read it as the DM stuck in a loop.
export function repeatedClosing(narrations: readonly string[], runs = 2): string | null {
  const recent = narrations.slice(-runs);
  if (recent.length < runs) {
    return null;
  }
  const endings = recent.map(closingQuestion);
  const first = endings[0];
  if (!first) {
    return null;
  }
  const key = textKey(first);
  return endings.every((ending) => ending !== null && textKey(ending) === key) ? first : null;
}

// Read after the transcript, with the moment, so the cached prompt ahead of
// it is untouched.
export function closingVarietyNote(line: string): string {
  return `[Variety] Your last replies all ended on the same line ("${line}"). End this one another way: on what someone says or does, a sound, or the choice in front of the party, without that line.`;
}

export const REPEATED_NARRATION_PROMPT =
  "[System] That reply repeats your previous narration almost word for word. The player has acted again, and this is a new moment. Resolve what they just did with the tools (in a fight: the attack, move or spell they declared, on their turn), then narrate only what is new.";

// An English bold heading for a turn, a round or the fight itself, read only
// at an English table: "**Bram's Turn**", "**Round 1:**", "**Combat
// begins.**", "**End of Avery's Turn.**".
const ENGLISH_COMBAT_HEADING = /\*\*[^*\n]{0,40}?\b(?:turn|round|combat|initiative)\b[^*\n]{0,30}?\*\*[ \t]*[.:!]?/gi;
// An item number alone on its line: what cutting a sentence that quoted a
// board square leaves of "1. Shadow 1 (moves to (7,13))" (dm/claims-logic.ts
// metaQuotes, at every table). It counts as an item of the order it sat in.
const LONE_NUMBER = /^[ \t]*\d{1,2}\.[ \t]*\n/gm;
const BARE_ITEM = /^\d{1,2}\.[ \t]*(?=\n)/;
// What is left of a recited order once its names went: "1. 2. **Avery** **Bram**".
const NUMBERS_LEFT = /(?:^|(?<=\s))\d{1,2}\.(?:\s+\d{1,2}\.)+(?:\s+\*\*[^*\n]{1,40}\*\*)*/g;
// A bulleted line in a fight is a summary of it, not the story: "* **Masked
// Thug 1 attacks Bram.**".
const BULLET_LINE = /^[ \t]*[*•-][ \t]+(.+)$/gm;
const ITEM_NUMBER = /^\d{1,2}\.[ \t]*(?:\*\*)?[ \t]*/;
const ITEM_TAIL = /^(?:\*\*)?(?:[ \t]*\([^)\n]{1,12}\))?(?:\*\*)?/;

// Where an item of a recited order ends and whether it names one of the
// fight's own combatants ("2. **Silent Cultist 2** (CURRENT)"), or null. A
// lone number is an item with no name.
function itemEnd(text: string, at: number, names: readonly string[]): { end: number; named: boolean } | null {
  const bare = BARE_ITEM.exec(text.slice(at));
  if (bare) {
    return { end: at + bare[0].length, named: false };
  }
  const end = namedItemEnd(text, at, names);
  return end < 0 ? null : { end, named: true };
}

function namedItemEnd(text: string, at: number, names: readonly string[]): number {
  const number = ITEM_NUMBER.exec(text.slice(at));
  if (!number) {
    return -1;
  }
  const start = at + number[0].length;
  const name = names.find((candidate) => textKey(text.slice(start, start + candidate.length)) === textKey(candidate));
  if (!name) {
    return -1;
  }
  const end = start + name.length;
  return end + (ITEM_TAIL.exec(text.slice(end))?.[0].length ?? 0);
}

// The turn order recited as a numbered list of the fight's own names, on its
// own lines or run together: "1. Avery (14) 2. Silent Cultist 2 3. Bram (9)".
function withoutNamedRuns(text: string, names: readonly string[]): string {
  let out = "";
  let from = 0;
  while (from < text.length) {
    const found = text.slice(from).search(/\d{1,2}\./);
    if (found < 0) {
      out += text.slice(from);
      break;
    }
    const start = from + found;
    let item = itemEnd(text, start, names);
    let items = 0;
    let named = 0;
    let runEnd = start;
    while (item) {
      items += 1;
      named += item.named ? 1 : 0;
      runEnd = item.end;
      const gap = /^\s*/.exec(text.slice(runEnd))?.[0].length ?? 0;
      item = itemEnd(text, runEnd + gap, names);
    }
    if (items >= 2 && named >= 1) {
      // The clause that introduced the list goes with it: "The updated
      // order is:", or a bold heading of its own, "**Ordine di iniziativa:**".
      out = (out + text.slice(from, start)).replace(/[^.!?\n]*:(?:\*\*)?\s*$/, "");
      from = runEnd;
    } else {
      out += text.slice(from, start + 1);
      from = start + 1;
    }
  }
  return out;
}

// The fight's bookkeeping written into the story while a fight runs: the
// recited order and a bulleted summary, found by the fight's own names at
// every table, and the English headings above at an English table only. The
// board and the turn strip show both; Qwen3.6-35B at Q2 wrote them in most
// fights. `names` are the fight's combatants; none means no fight, and the
// text is left as it is.
export function withoutCombatBookkeeping(text: string, names: readonly string[], language: TableLanguage): string {
  const known = [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 2))].sort((a, b) => b.length - a.length);
  if (!known.length) {
    return text;
  }
  const keys = known.map((name) => textKey(name));
  const unbulleted = text.replace(BULLET_LINE, (line, body: string) => (keys.some((key) => ` ${textKey(body)} `.includes(` ${key} `)) ? "" : line));
  // The order goes by its names before the English headings do: a bold
  // "**Avery (your turn)**" item is a heading's shape and, cut first, would
  // break the run it sits in.
  const unlisted = withoutNamedRuns(unbulleted, known).replace(LONE_NUMBER, "");
  const stripped = (language === "english" ? unlisted.replace(ENGLISH_COMBAT_HEADING, "") : unlisted).replace(NUMBERS_LEFT, "");
  return tidyBlankLines(stripped.replace(/\*\*\s*\*\*/g, ""));
}
