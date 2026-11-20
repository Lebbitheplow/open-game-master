// The one window Open Game Master supports for the storyteller: the full
// rules with the full tool set. The tool set alone is about 28K tokens on a
// four-hero campaign, and the turn chooses the full set only when it leaves
// at least 32K of the window for the rules, the story and the reply
// (src/lib/dm/model-tuning-logic.ts MIN_STORY_ROOM_TOKENS). 64K clears that
// with room for a bigger campaign's tools, and it is the window the docs'
// llama-server commands and the apps start with (-c 65536).
//
// Below it the turn still runs, on the trimmed or the compact tool set and
// the rules that ride with it, but Open Game Master does not support, test
// or recommend that: the model pickers leave such models off their lists
// (src/lib/model-registry/catalog-logic.ts assessModel), and they can only
// be typed in by hand. The two floors below are where the compact profile
// was last measured (scripts/test-enforce-sweep-modelio-schema.mjs budget
// rows, 2026-11-09), kept so the request fitter's tests can hold them:
//
//   exploring  lone level 1 fighter 15,353; four level 5 heroes 19,720
//   fighting   lone level 1 fighter 24,369; four level 5 heroes 29,678
//
// The README, the guided setup, the model pickers and the window-too-small
// refusal all quote FULL_RULES_WINDOW, and scripts/test-story-window.mjs
// keeps the docs saying the same.
//
// Round thousands, as the model catalog counts them, so a model sold as
// "64K" (64,000 tokens) is not told it is short of 64K; -c 65536 clears it.
import { translate } from "./messages-logic.ts";

// The shape of a translator, as the pure sentence builders take it.
type T = (key: string, vars?: Record<string, string | number>) => string;
export const FULL_RULES_WINDOW = 64_000;
// The compact profile's measured floors (unsupported; see above).
export const MIN_NARRATION_WINDOW = 24_000;
export const MIN_COMBAT_WINDOW = 40_000;
// The window the docs' llama-server commands start with (-c 65536): the
// full tool set with a long transcript. The app asks Ollama for no more than
// this unless LOCAL_TEXT_CONTEXT says otherwise (model-client.ts
// localContextTokens).
export const DEFAULT_WINDOW = 65_536;

// llama-server's -c counts in 1,024s (65536 is "64K"), the catalog in
// thousands (128000 is "128K"); each size is named the way it was set.
export function windowLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / (tokens % 1_000 !== 0 && tokens % 1_024 === 0 ? 1_024 : 1_000))}K`;
}

// "A 16K window", "An 8K window" — and "Une fenêtre de 16K" in French,
// where no article changes before a digit. English keeps its two forms;
// the size's own digits decide which.
export function aWindow(t: T, tokens: number): string;
export function aWindow(tokens: number): string;
export function aWindow(tOrTokens: T | number, maybeTokens?: number): string {
  const t = typeof tOrTokens === "function" ? tOrTokens : enT;
  const tokens = typeof tOrTokens === "number" ? tOrTokens : (maybeTokens ?? 0);
  const size = windowLabel(tokens);
  return t(/^(8|11|18)/.test(size) ? "An {size}" : "A {size}", { size });
}

// The value to start llama-server with (-c) for at least this many tokens:
// the same count of K in 1,024s (48,000 is -c 49152, the "48K" a server
// runs, not the 48,128 that merely clears it). A count already in 1,024s is
// its own flag.
export function windowFlag(tokens: number): number {
  return tokens % 1_024 === 0 ? tokens : Math.ceil(tokens / 1_000) * 1_024;
}

// The window size the requirement sentence quotes, from the constant.
const needsVars = () => ({ full: windowLabel(FULL_RULES_WINDOW) });

// English-bound, for the const the docs and reports quote.
const enT: T = (key, vars) => translate("en", key, vars);

// The one sentence every surface uses for the requirement itself, English
// by source: the README and the guides quote it, and the report and the
// request fitter's refusals carry it to places no table language reaches.
export const STORY_WINDOW_NEEDS = enT("The storyteller needs a context window of at least {full} tokens to play the full rules; smaller windows are not supported.", needsVars());

// The same sentence in the reader's language: the surfaces that show it
// pass their own translator, as storyWindowVerdict does. (STORY_WINDOW_NEEDS
// stays the docs' and reports' pinned English.)
export function storyNeeds(t: T): string {
  return t("The storyteller needs a context window of at least {full} tokens to play the full rules; smaller windows are not supported.", needsVars());
}

// "short": too small even to narrate. "reduced": plays only on a cut tool
// set and rules, which Open Game Master does not support or test. "ok": the
// full rules.
export type StoryWindowLevel = "short" | "reduced" | "ok";

// What a table can do in a window, worded for the admin choosing a model.
// Empty text when the window plays the full rules.
export function storyWindowVerdict(t: T, tokens: number): { level: StoryWindowLevel; text: string };
export function storyWindowVerdict(tokens: number): { level: StoryWindowLevel; text: string };
export function storyWindowVerdict(tOrTokens: T | number, maybeTokens?: number): { level: StoryWindowLevel; text: string } {
  const t = typeof tOrTokens === "function" ? tOrTokens : enT;
  const tokens = typeof tOrTokens === "number" ? tOrTokens : (maybeTokens ?? 0);
  const size = aWindow(t, tokens);
  const needs = t("The storyteller needs a context window of at least {full} tokens to play the full rules; smaller windows are not supported.", needsVars());
  if (tokens < MIN_NARRATION_WINDOW) {
    return {
      level: "short",
      text: t("{size} window is too small to narrate: the GM's instructions and tools leave no room for the story. {needs}", { size, needs }),
    };
  }
  if (tokens < FULL_RULES_WINDOW) {
    return {
      level: "reduced",
      text: t("{size} window is too small for the full rules: the GM would play on a cut tool set and rules, which Open Game Master does not support or test. {needs}", { size, needs }),
    };
  }
  return { level: "ok", text: "" };
}
