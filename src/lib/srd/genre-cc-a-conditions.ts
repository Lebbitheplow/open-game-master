// The conditions the 2026-11-13 creator audit's second genre pass lays for the
// cyberpunk and dark fantasy classes, as rows of the condition effects
// registry (src/lib/srd/genre-a-conditions.ts spreads them). Pure data.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

// Sanctioned Execution: "prevent regeneration and revival for 24 hours"
// (src/lib/dm/genre-cc-a-dark-fantasy.ts lays it with the stopped Regeneration).
export const SANCTIONED = "sanctioned execution";

export const GENRE_CC_A_CONDITIONS: ConditionEffectRow[] = [
  { id: "sanctioned_execution", match: [SANCTIONED], summary: "Sanctioned Execution: for 24 hours the creature cannot regenerate and cannot be revived." },
];
