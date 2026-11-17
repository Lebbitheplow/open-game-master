// How big a context window the storyteller needs, measured through the
// request fitter (src/lib/dm/request-fit.ts): the first call of a turn, with
// the compact tool set whole and the reply's 1,024 tokens, over a party of
// one to four heroes, exploring and in a fight
// (scripts/test-enforce-sweep-modelio-schema.mjs budget rows, 2026-11-09):
//
//   exploring  lone level 1 fighter 15,353; lone level 3 fighter 15,806;
//              lone level 5 wizard 18,707 (the casting rules); fighter and
//              wizard 18,997; four level 5 heroes 19,720
//   fighting   lone level 1 fighter 24,369; lone level 3 fighter 25,043;
//              fighter and wizard 28,480; four level 5 heroes 29,678 (the
//              fight's rules and turn order are about 6K on their own)
//
// So 24K narrates, explores and checks for a party of four, and 40K runs
// its fights. These were 16K and 24K, measured on a lone level 1 fighter:
// every other party fell to the four essential tools on a 16K window, and
// every fight measured on a 24K one (gap sweep 2026-11-09). The fight floor
// is 40K, not the 32K the four heroes' 29,678 would clear: the figures are
// the budget's estimate (characters over four, context-budget.ts), not a
// tokenizer's count, and 32K left about 2,000 tokens spare, which a tokenizer
// 7% over the estimate, the later calls of a turn, a fifth hero or a
// campaign's own history use up (the review of #906). 48K plays on
// the trimmed set, with recent turns in view (src/lib/dm/model-tuning-
// logic.ts). The README, the guided setup, the model pickers and the
// window-too-small refusal all quote these, and scripts/test-story-window.mjs
// keeps the docs saying the same.
//
// Round thousands, as the model catalog counts them, so a model sold as
// "24K" (24,000 tokens) is not told it is short of 24K; the llama-server
// commands the docs give (-c 24576, 40960, 49152) clear each one.
import { translate } from "./messages-logic.ts";

// The shape of a translator, as the pure sentence builders take it.
type T = (key: string, vars?: Record<string, string | number>) => string;
export const MIN_NARRATION_WINDOW = 24_000;
export const MIN_COMBAT_WINDOW = 40_000;
export const RECOMMENDED_WINDOW = 48_000;
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

// The window sizes the requirement sentence quotes, from the constants.
const needsVars = () => ({
  min: windowLabel(MIN_NARRATION_WINDOW),
  combat: windowLabel(MIN_COMBAT_WINDOW),
  recommended: windowLabel(RECOMMENDED_WINDOW),
});

// English-bound, for the const the docs and reports quote.
const enT: T = (key, vars) => translate("en", key, vars);

// The one sentence every surface uses for the requirement itself, English
// by source: the README and the guides quote it, and the report and the
// request fitter's refusals carry it to places no table language reaches.
export const STORY_WINDOW_NEEDS = enT("The storyteller needs a context window of at least {min} tokens to narrate and {combat} to run fights; {recommended} or more is recommended.", needsVars());

// The same sentence in the reader's language: the surfaces that show it
// pass their own translator, as storyWindowVerdict does. (STORY_WINDOW_NEEDS
// stays the docs' and reports' pinned English.)
export function storyNeeds(t: T): string {
  return t("The storyteller needs a context window of at least {min} tokens to narrate and {combat} to run fights; {recommended} or more is recommended.", needsVars());
}

export type StoryWindowLevel = "short" | "no-fights" | "tight" | "ok";

// What a table can do in a window, worded for the admin choosing a model.
// Empty text when the window is enough for everything.
export function storyWindowVerdict(t: T, tokens: number): { level: StoryWindowLevel; text: string };
export function storyWindowVerdict(tokens: number): { level: StoryWindowLevel; text: string };
export function storyWindowVerdict(tOrTokens: T | number, maybeTokens?: number): { level: StoryWindowLevel; text: string } {
  const t = typeof tOrTokens === "function" ? tOrTokens : enT;
  const tokens = typeof tOrTokens === "number" ? tOrTokens : (maybeTokens ?? 0);
  const size = aWindow(t, tokens);
  if (tokens < MIN_NARRATION_WINDOW) {
    return {
      level: "short",
      text: t("{size} window is too small to narrate: the GM's instructions and tools leave no room for the story. {needs}", { size, needs: t("The storyteller needs a context window of at least {min} tokens to narrate and {combat} to run fights; {recommended} or more is recommended.", needsVars()) }),
    };
  }
  if (tokens < MIN_COMBAT_WINDOW) {
    return {
      level: "no-fights",
      text: t("{size} window narrates and explores, but fights need {combat}: below that a fight turn can be refused for room. {recommended} or more is recommended.", {
        size,
        combat: windowLabel(MIN_COMBAT_WINDOW),
        recommended: windowLabel(RECOMMENDED_WINDOW),
      }),
    };
  }
  if (tokens < RECOMMENDED_WINDOW) {
    return {
      level: "tight",
      text: t("{size} window plays, fights included, but keeps only the last few turns in view; {recommended} or more is recommended.", { size, recommended: windowLabel(RECOMMENDED_WINDOW) }),
    };
  }
  return { level: "ok", text: "" };
}
