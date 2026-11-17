// Whether the one-time AI Story Setup pass is still to run, and when it meets
// prep the table brought in (issue 249). Pure, and free of alias imports so
// the wizard, the lobby and scripts/test-story-setup.mjs all ask the same.
//
// The pass (src/lib/dm/setup.ts) runs when the adventure begins, at a table
// the AI narrates (an assisted table included), with the setting on and no
// secret outline written yet. A Workshop Storyboard imported before that
// writes the table's story arc; the pass then writes a premise, an opening
// scene and an outline of its own beside it. The arc is not overwritten
// (the arc planner skips a table that has one, and the DM prompt prefers
// it), but the opening scene goes into every prompt alongside the arc.

export type StorySetupInput = {
  status: string;
  dmMode: string;
  aiStorySetup: boolean;
  // The secret outline exists: the pass ran already, or never will.
  outlineWritten: boolean;
};

export function storySetupWillRun(input: StorySetupInput): boolean {
  return input.status === "lobby" && input.dmMode !== "human" && input.aiStorySetup && !input.outlineWritten;
}

// The warning's words, the same in the wizard and the lobby; the caller binds
// the language (the tests an English-bound one).
type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function storySetupWarning(t: Translate): string {
  return t("AI Story Setup is on, and this campaign has a story arc from your Storyboard. When the adventure begins, Story Setup writes its own premise, opening scene and secret outline. It is given your arc to build from, but its opening can still differ from the one you prepared. Turn it off to begin from your imported story; the AI still narrates.");
}

export function storySetupWarningComing(t: Translate): string {
  return t("This Storyboard writes the campaign's story arc, and AI Story Setup is on. When the adventure begins, Story Setup writes its own premise, opening scene and secret outline. It is given your arc to build from, but its opening can still differ from the one you prepared. Turn it off to begin from your imported story; the AI still narrates.");
}

// Where the lobby remembers that a creator chose to keep it on, per table.
export function storySetupKeptKey(campaignId: string): string {
  return `odm.storySetupKept.${campaignId}`;
}
