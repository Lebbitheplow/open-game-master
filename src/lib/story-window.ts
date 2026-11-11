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

// "A 16K window", "An 8K window".
export function aWindow(tokens: number): string {
  const size = windowLabel(tokens);
  return `${/^(8|11|18)/.test(size) ? "An" : "A"} ${size}`;
}

// The value to start llama-server with (-c) for at least this many tokens:
// the same count of K in 1,024s (48,000 is -c 49152, the "48K" a server
// runs, not the 48,128 that merely clears it). A count already in 1,024s is
// its own flag.
export function windowFlag(tokens: number): number {
  return tokens % 1_024 === 0 ? tokens : Math.ceil(tokens / 1_000) * 1_024;
}

// The one sentence every surface uses for the requirement itself.
export const STORY_WINDOW_NEEDS = `The storyteller needs a context window of at least ${windowLabel(MIN_NARRATION_WINDOW)} tokens to narrate and ${windowLabel(MIN_COMBAT_WINDOW)} to run fights; ${windowLabel(RECOMMENDED_WINDOW)} or more is recommended.`;

export type StoryWindowLevel = "short" | "no-fights" | "tight" | "ok";

// What a table can do in a window, worded for the admin choosing a model.
// Empty text when the window is enough for everything.
export function storyWindowVerdict(tokens: number): { level: StoryWindowLevel; text: string } {
  const size = aWindow(tokens);
  if (tokens < MIN_NARRATION_WINDOW) {
    return {
      level: "short",
      text: `${size} window is too small to narrate: the GM's instructions and tools leave no room for the story. ${STORY_WINDOW_NEEDS}`,
    };
  }
  if (tokens < MIN_COMBAT_WINDOW) {
    return {
      level: "no-fights",
      text: `${size} window narrates and explores, but fights need ${windowLabel(MIN_COMBAT_WINDOW)}: below that a fight turn can be refused for room. ${windowLabel(RECOMMENDED_WINDOW)} or more is recommended.`,
    };
  }
  if (tokens < RECOMMENDED_WINDOW) {
    return {
      level: "tight",
      text: `${size} window plays, fights included, but keeps only the last few turns in view; ${windowLabel(RECOMMENDED_WINDOW)} or more is recommended.`,
    };
  }
  return { level: "ok", text: "" };
}
