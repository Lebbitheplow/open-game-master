// The conditions the horror classes' counters lay (src/lib/dm/genre-a-horror-spends.ts
// and the rows of src/lib/srd/authored-effects-genre-a-horror.ts), as rows of
// the condition effects registry: src/lib/srd/genre-a-conditions.ts spreads
// them in, so the three genre branches never append to the same array.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

export const GENRE_A_HORROR_CONDITIONS: ConditionEffectRow[] = [
  { id: "binding_words", match: ["binding words"], summary: "Binding Words: the exorcist's next Rite of Repulsion also restrains, for a minute, the first creature it takes hold of." },
  { id: "terminal_focus", match: ["terminal focus"], summary: "Terminal Focus: the survivor's second full turn of the first round." },
  { id: "observed", match: ["observed"], summary: "Observer Effect: forced into its true visible form for a minute; it cannot turn invisible or change shape while it lasts." },
];
