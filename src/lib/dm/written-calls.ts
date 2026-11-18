// Calls a reply wrote out in words instead of making them (issue 1025): the
// arguments one to a line, and a tool written as a function. Dependency-free,
// like tool-text.ts, which cuts them from everything the table reads and
// hears; the turn's salvage (json-salvage.ts salvageWrittenCalls) runs them.

import { DM_TOOL_NAME_PATTERN, ID_KEYS } from "./tool-names.ts";

// A call's arguments written one to a line, as YAML or as assignments, with
// no brackets and no braces. gpt-oss-20b on llama.cpp ended a campaign's
// opening scene on
//   characterIds: ["..."]
//   prompt: "What will <the character> do next?"
// and made no call (issue 1025): the table read the lines, the narrator
// spoke them, and the floor never passed to the character. A block may sit
// under a line naming its tool ("request_player_input:") and inside a code
// fence. A key is a parameter's spelling, lower case first, so "Bram: ..." in
// a story is no key. Which blocks are calls is the salvage's to say
// (json-salvage.ts salvageWrittenCalls); without the tools,
// withoutWrittenCalls cuts the blocks no story writes: one holding an id
// key, or one under a tool's name.
const ARG_KEY = "[a-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*";
const ARG_LINE = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?(["'\`]?)(${ARG_KEY})\\1[ \\t]*[:=][ \\t]*(.*?)[ \\t]*,?[ \\t]*$`);
const ARG_ITEM = /^[ \t]+-[ \t]+(.+?)[ \t]*$/;
const TOOL_HEADER = new RegExp(`^[ \\t]*(?:\\*\\*)?(${DM_TOOL_NAME_PATTERN})(?:\\*\\*)?[ \\t]*:?[ \\t]*$`);
const FENCE_OPEN = /^[ \t]*```[\w-]*[ \t]*$/;
const FENCE_CLOSE = /^[ \t]*```[ \t]*$/;
const ID_KEY_SET: ReadonlySet<string> = new Set(ID_KEYS);

export type ArgumentLines = {
  start: number;
  end: number;
  // The tool named on the line above the block, when one is.
  tool: string | null;
  args: Record<string, unknown>;
};

// A value as the tools' JSON schemas expect it: JSON where it parses (a
// quoted string, an array, a number), else the text without its quotes.
function argumentValue(raw: string): unknown {
  const value = raw.trim();
  try {
    return JSON.parse(value);
  } catch {
    const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
    return quoted ? quoted[2] : value;
  }
}

export function findArgumentLines(text: string): ArgumentLines[] {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  for (let at = 0; at <= text.length; ) {
    const newline = text.indexOf("\n", at);
    const end = newline < 0 ? text.length : newline;
    lines.push({ text: text.slice(at, end), start: at, end });
    if (newline < 0) {
      break;
    }
    at = newline + 1;
  }
  const found: ArgumentLines[] = [];
  for (let index = 0; index < lines.length; ) {
    const args: Record<string, unknown> = {};
    let next = index;
    while (next < lines.length) {
      const line = ARG_LINE.exec(lines[next].text);
      if (!line || line[2] in args) {
        break;
      }
      next += 1;
      if (line[3]) {
        args[line[2]] = argumentValue(line[3]);
        continue;
      }
      // "key:" with the list under it, one "- item" to a line.
      const items: unknown[] = [];
      for (let item = ARG_ITEM.exec(lines[next]?.text ?? ""); item; item = ARG_ITEM.exec(lines[next]?.text ?? "")) {
        items.push(argumentValue(item[1]));
        next += 1;
      }
      if (!items.length) {
        next -= 1;
        break;
      }
      args[line[2]] = items;
    }
    if (next === index) {
      index += 1;
      continue;
    }
    let first = index;
    let last = next - 1;
    const header = first > 0 ? TOOL_HEADER.exec(lines[first - 1].text) : null;
    if (header) {
      first -= 1;
    }
    if (first > 0 && FENCE_OPEN.test(lines[first - 1].text) && last + 1 < lines.length && FENCE_CLOSE.test(lines[last + 1].text)) {
      first -= 1;
      last += 1;
    }
    found.push({ start: lines[first].start, end: lines[last].end, tool: header?.[1] ?? null, args });
    index = next;
  }
  return found;
}

// Whether a block is one no story writes, the tools unknown: it carries an id
// key ("characterIds: [...]"), or the line above it names a tool.
export function argumentLinesAreCall(block: ArgumentLines): boolean {
  return block.tool !== null || Object.keys(block.args).some((key) => ID_KEY_SET.has(key));
}

// A tool named with its arguments in parentheses, as code calls a function:
// "request_player_input(characterIds=[...], prompt=...)", or the arguments as
// one JSON object. No story writes a tool's name with a bracket after it; the
// names that are words too ("heal", "travel") are left out.
const CODE_TOOL_NAMES = DM_TOOL_NAME_PATTERN.split("|").filter((name) => name.includes("_")).join("|");
const TOOL_CALL_OPEN_SOURCE = `\\b(?:${CODE_TOOL_NAMES})[ \\t]*\\(`;

export type FunctionCallText = { start: number; end: number; tool: string; args: Record<string, unknown> | null };

// Where the bracket opening at `open` closes, skipping brackets inside
// strings: -1 when it never does, -2 when another kind closes it.
function balancedCallEnd(text: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        return char === ")" ? index + 1 : -2;
      }
    }
  }
  return -1;
}

// "key=value, key: value" split at the commas outside strings and brackets.
function callArguments(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith("{")) {
    const value = argumentValue(trimmed);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  }
  const pieces: string[] = [];
  let depth = 0;
  let quote = "";
  let from = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if ("([{".includes(char)) {
      depth += 1;
    } else if (")]}".includes(char)) {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      pieces.push(trimmed.slice(from, index));
      from = index + 1;
    }
  }
  pieces.push(trimmed.slice(from));
  const args: Record<string, unknown> = {};
  for (const piece of pieces) {
    const pair = new RegExp(`^\\s*["']?(${ARG_KEY})["']?\\s*[:=]\\s*([\\s\\S]+?)\\s*$`).exec(piece);
    if (!pair) {
      return null;
    }
    args[pair[1]] = argumentValue(pair[2]);
  }
  return args;
}

// Every tool named that way in the text; `args` is null when the bracket
// holds something no call is written as, and the text still goes.
export function findFunctionCalls(text: string): FunctionCallText[] {
  const found: FunctionCallText[] = [];
  const opener = new RegExp(`\\b(${CODE_TOOL_NAMES})[ \\t]*\\(`, "g");
  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    const open = match.index + match[0].length - 1;
    const close = balancedCallEnd(text, open);
    // One cut short runs to the end of the reply: nothing after it is story.
    // One closed by the wrong bracket loses only its name and opener.
    const end = close === -1 ? text.length : close === -2 ? open + 1 : close;
    found.push({ start: match.index, end, tool: match[1], args: close < 0 ? null : callArguments(text.slice(open + 1, close - 1)) });
    opener.lastIndex = end;
  }
  return found;
}

// The calls a reply wrote out in words, cut without knowing the tools: every
// tool named as a function, and the argument lines no story writes.
export function withoutWrittenCalls(text: string): string {
  const calls = findFunctionCalls(text);
  const spoken = calls.length ? cutSpans(text, calls) : text;
  const blocks = findArgumentLines(spoken).filter(argumentLinesAreCall);
  return blocks.length ? cutSpans(spoken, blocks) : spoken;
}

// The same as the reply streams to the table's draft (story-prompt.ts
// createStreamingArtifactFilter): where a written call starts in the text not
// yet shown, or -1. `lineStart` says whether that text opens a line; a block
// of argument lines only counts at one, as it does in the whole reply.
export function writtenCallStart(text: string, lineStart: boolean): number {
  const named = new RegExp(TOOL_CALL_OPEN_SOURCE).exec(text);
  const block = findArgumentLines(text).find((found) => argumentLinesAreCall(found) && (found.start > 0 || lineStart));
  const starts = [named?.index ?? -1, block?.start ?? -1].filter((start) => start >= 0);
  return starts.length ? Math.min(...starts) : -1;
}

// Where the lines at the end of the text that may yet become a written call
// start, to be held until they are known, or -1: a run of argument lines (and
// the tool's name or a fence above them) ending in a line still arriving that
// could be one, or a word that could be the head of a tool's name. A line of
// prose is known by its first words, so it waits for little more than one.
const ARG_LINE_HEAD = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?["'\`]?(?:${ARG_KEY})?["'\`]?(?:[ \\t]*[:=].*)?$`);
const FENCE_HEAD = /^[ \t]*`{1,3}[\w-]*[ \t]*$/;
const TOOL_NAMES_WRITTEN = CODE_TOOL_NAMES.split("|");

export function partialWrittenCallStart(text: string, lineStart: boolean): number {
  const word = /\b[a-z_]+$/.exec(text);
  const wordAt = word && TOOL_NAMES_WRITTEN.some((name) => `${name}(`.startsWith(word[0])) ? word.index : -1;
  const lines = text.split("\n");
  let at = text.length - lines[lines.length - 1].length;
  const last = lines[lines.length - 1];
  const opensLine = lines.length > 1 || lineStart;
  if (!opensLine || !(ARG_LINE_HEAD.test(last) || FENCE_HEAD.test(last) || /^[ \t]*\{/.test(last))) {
    return wordAt;
  }
  for (let index = lines.length - 2; index >= (lineStart ? 0 : 1); index -= 1) {
    const line = lines[index];
    if (!(ARG_LINE.test(line) || ARG_ITEM.test(line) || TOOL_HEADER.test(line) || FENCE_OPEN.test(line))) {
      break;
    }
    at -= line.length + 1;
  }
  return wordAt >= 0 ? Math.min(at, wordAt) : at;
}

// A code fence left with nothing inside once a call was cut from it
// ("```json" over the arguments): the table would read an empty block.
const EMPTY_FENCE = /(?:^|\n)[ \t]*```[\w-]*[ \t]*\n(?:[ \t]*\n)*[ \t]*```[ \t]*(?=\n|$)/g;

// Cuts the given spans out of the text, tidying the gap each leaves.
export function cutSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  if (!spans.length) {
    return text;
  }
  let out = "";
  let cursor = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  out += text.slice(cursor);
  return out.replace(EMPTY_FENCE, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
