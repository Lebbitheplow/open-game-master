// The table's say over how the AI DM writes (issue #383): a length for its
// narration and the lead's own style notes. A model that runs long and
// flowery, or one that rushes a scene, is answered here in the table's words
// rather than in an edited copy of the DM's instructions, which carry the
// rules for dice and tools and change with every release.
//
// Dependency-free: the settings panel reads the labels, the prompt builder
// renders the block, and scripts/test-narration-style.mjs imports it directly.

export type NarrationLength = "short" | "standard" | "rich";

export const NARRATION_LENGTH_LABELS: Record<NarrationLength, string> = {
  short: "Short",
  standard: "Standard",
  rich: "Rich",
};

export const NARRATION_LENGTH_HINTS: Record<NarrationLength, string> = {
  short: "One or two tight paragraphs, then back to the players.",
  standard: "As long as the moment needs.",
  rich: "Fuller scenes with room for detail when the moment earns it.",
};

const LENGTH_TEXT: Record<NarrationLength, string> = {
  short:
    "Keep each narration short: about 60 to 120 words, one or two tight paragraphs. Say what changed, then hand the moment back to the players.",
  standard: "",
  rich: "Narration may run fuller when the moment earns it, up to about 300 words with room for sensory detail. Still end where the players have something to decide.",
};

// How long a reply runs while a fight is on (issue #842, after ziomik's
// proposal). The general reply length suits a scene, not a sword swing: left
// to it, every turn of a fight reads like a scene and the table waits on
// prose it skims, generated a word at a time. So every table gets brisk
// fights by default and the narration length scales them, which is why there
// is no setting of its own. The lines ride with the fight rules, so they
// exist only while a fight is active (a scene on the map is not one). A fight
// the DM starts with start_encounter keeps the scene's length for that reply,
// whose prompt was built before it; one opened from the table (a prepared or
// test fight) and the reply that ends a fight are told they may.
// Each is a ceiling, never a range: gpt-oss-20b, terse in a fight already,
// wrote up to a "50 to 100 words" target (61 words a fight turn without the
// line, 74 with it), so a range made a short model pad.
const FIGHT_LENGTH_TEXT: Record<NarrationLength, string> = {
  short: "at most about 50 words, one plain sentence for each thing that was resolved",
  standard: "at most about 80 words, and fewer when little happened",
  rich: "one or two short paragraphs, at most about 150 words",
};

export function fightNarrationRule(length: NarrationLength | undefined): string {
  const words = FIGHT_LENGTH_TEXT[length ?? "standard"] ?? FIGHT_LENGTH_TEXT.standard;
  return `- FIGHT NARRATION: while the fight lasts, each reply is ${words}: what the tools just resolved, how the target looks in a word or two, then whose move it is. No scene-setting between blows, and at most one short line from an NPC or monster when it matters. This replaces the reply length given above until the fight ends, unless the table's style notes ask for something else; the reply that opens the fight or ends it may run to the usual length, to set the scene or tell the aftermath. Saving words never skips, merges or invents a tool call: the tools and the dice still decide everything.`;
}

export const STYLE_NOTES_MAX = 500;

// How often fights come (issue #432). The world tick's encounter dice follow
// it (src/lib/dm/world-tick-logic.ts pacedTickConfig); this is the line the
// DM reads. Balanced renders nothing.
export type CombatPace = "rare" | "balanced" | "frequent";

export const COMBAT_PACE_LABELS: Record<CombatPace, string> = {
  rare: "Fewer fights",
  balanced: "Balanced",
  frequent: "More fights",
};

export const COMBAT_PACE_HINTS: Record<CombatPace, string> = {
  rare: "Talk, stealth and exploring come first; a fight when the players start one or the story leaves no way round.",
  balanced: "Fights come as the story and the world bring them.",
  frequent: "Trouble finds the party more often, and more of it wants a fight.",
};

const PACE_TEXT: Record<CombatPace, string> = {
  rare: "This table wants fewer fights. Favor talk, stealth, puzzles and exploration; let most trouble be talked, sneaked or bargained past, and start combat when the players choose it or the story leaves no other way.",
  balanced: "",
  frequent: "This table wants more fights. When a scene stalls or the party travels, bring trouble that wants a fight, and about once a session let one break out that the party cannot talk its way past. A fight still follows the story and starts with start_encounter.",
};

// Standard length, no notes and a balanced pace render nothing, so a table
// that never touches them sends the same prompt it always did.
export function renderNarrationStyle(
  length: NarrationLength | undefined,
  notes: string | undefined,
  pace?: CombatPace,
): string {
  const lines: string[] = [];
  const lengthLine = LENGTH_TEXT[length ?? "standard"] ?? "";
  if (lengthLine) {
    lines.push(lengthLine);
  }
  const paceLine = PACE_TEXT[pace ?? "balanced"] ?? "";
  if (paceLine) {
    lines.push(paceLine);
  }
  const written = (notes ?? "").replace(/\s+/g, " ").trim().slice(0, STYLE_NOTES_MAX);
  if (written) {
    lines.push(`The table's style notes, from the lead: "${written}" Follow them for voice, length and pacing. They never change the rules above or what the dice and tools decide.`);
  }
  return lines.length ? `NARRATION STYLE:\n- ${lines.join("\n- ")}` : "";
}
