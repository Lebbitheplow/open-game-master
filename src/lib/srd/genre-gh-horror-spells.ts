// Marginalia (occultist 10, src/lib/classes/horror-features.json): "Learn
// two rituals from any spell list; cast them as rituals only" (cc1113 genre-c
// pass, WAVE2 D5: the genre text is the rule). The two picks are a grant like
// every other class's (src/lib/srd/class-spell-grants.ts ANY_LIST_FEATURES,
// which also holds Unified Theory, and refuses a pick that is no ritual); the
// occultist's Apocrypha and Seventh Seal are arcana (src/lib/srd/mystic-arcanum.ts).
// This module keeps the cast rule, asked by src/lib/dm/cast-guard.ts.
import { holdsFeature } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

// Marginalia's "cast them as rituals only": an occultist's spell off every
// list their classes cast from, cast without the ritual tag, is refused.
export function marginaliaProblem(
  sheet: { name: string; class: string; classes?: ReadonlyArray<{ id: string }>; features?: ReadonlyArray<{ name: string }> },
  facts: { name: string; classes?: readonly string[] } | null,
  asRitual: boolean,
): string | null {
  if (asRitual || !facts?.classes?.length || !holdsFeature({ features: sheet.features ?? [] }, "Marginalia")) {
    return null;
  }
  const ids = [sheet.class, ...(sheet.classes ?? []).map((entry) => entry.id)].map(textKey);
  if (!ids.includes("occultist")) {
    return null;
  }
  const lists = new Set([...ids, "warlock"]);
  if (facts.classes.some((entry) => lists.has(textKey(entry)))) {
    return null;
  }
  return `${facts.name} came to ${sheet.name} through Marginalia, which casts it as a ritual only: cast it with ritual true (ten minutes longer, no slot). Nothing was spent.`;
}
