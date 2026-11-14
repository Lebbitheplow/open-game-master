// What the guided setup suggests for pictures and narration, from what the
// admin already chose for the storyteller and what the scan found running
// here. The one rule underneath: reuse what is already set up. An agent
// that narrates and can paint paints too, on the same sign-in; an OpenAI key
// given for the story covers pictures, narration and dictation; a ComfyUI or
// Kokoro already running on this machine is free and private. Suggestions
// only mark a card and fill an unanswered step: nothing is saved until the
// admin presses Continue, and "Skip for now" saves nothing at all.
// Pure, so scripts/test-setup-wizard.mjs checks each one.
import { PAINTING_AGENTS, type HarnessChoiceId } from "./patches.ts";

export type SuggestInput = {
  story: "local" | "key" | "agent" | "none" | "";
  agentId: HarnessChoiceId | "";
  storyIsOpenAi: boolean;
  comfyFound: boolean;
  kokoroFound: boolean;
};

export type PicturesSuggestion = { pick: "agent" | "openai" | "comfyui" | "none"; reason: string };
export type NarrationSuggestion = { pick: "kokoro" | "openai" | "off"; reason: string };

export const AGENT_LABELS: Record<HarnessChoiceId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
  grok: "Grok Build",
  pi: "Pi",
};

export function suggestPictures(input: SuggestInput): PicturesSuggestion {
  if (input.story === "agent" && input.agentId && PAINTING_AGENTS.includes(input.agentId)) {
    const name = AGENT_LABELS[input.agentId];
    return {
      pick: "agent",
      reason: `${name} narrates your tables, and it can paint too, on the same sign-in and plan. One test map first, so the tables only get a painter that works.`,
    };
  }
  if (input.storyIsOpenAi) {
    return { pick: "openai", reason: "The OpenAI key you gave the storyteller paints pictures too. Nothing more to paste." };
  }
  if (input.comfyFound) {
    return { pick: "comfyui", reason: "ComfyUI is already running on this computer: free pictures that never leave it." };
  }
  return {
    pick: "none",
    reason: "Nothing that paints is running here yet. Tables play well with painted placeholders, and a ComfyUI started later is picked up on its own.",
  };
}

export function suggestNarration(input: SuggestInput): NarrationSuggestion {
  if (input.storyIsOpenAi) {
    return { pick: "openai", reason: "The OpenAI key you gave the storyteller can read the story aloud too, and take dictation." };
  }
  if (input.kokoroFound) {
    return { pick: "kokoro", reason: "Kokoro is already running on this computer: free narration, and the text never leaves it." };
  }
  return {
    pick: "off",
    reason: "Nothing that speaks is running here yet. Kokoro is one command away (below); until then the story is read on screen.",
  };
}

// Whether to fill an unanswered step with the suggestion. "None" and "off"
// are never filled in: they would be saved as a deliberate choice, and
// leaving a service unanswered is not the same as switching it off.
export function fillsStep(pick: PicturesSuggestion["pick"] | NarrationSuggestion["pick"]): boolean {
  return pick !== "none" && pick !== "off";
}
