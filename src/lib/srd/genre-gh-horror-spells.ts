// The horror casters' features that teach spells past their class's list or
// past its slots (cc1113 genre-c pass, WAVE2 D5: the genre text is the rule):
//   Marginalia (occultist 10), "Learn two rituals from any spell list; cast
//     them as rituals only": two picks off any list, on top of the spells
//     known, each a ritual (src/lib/srd/class-spell-grants.ts offListProblems
//     refuses another), and cast only as a ritual (src/lib/dm/cast-guard.ts
//     asks marginaliaProblem);
//   Unified Theory (parapsychologist 17), "Learn three spells from any spell
//     list; they count as wizard-list apparatus effects for you": three picks
//     off any list, held and cast as the class's own (its ability, its slots);
//   Apocrypha (occultist 13) and Seventh Seal (17), "Learn one 6th-level
//     (7th-level) warlock spell; cast it 1/long rest without a slot": the
//     occultist's list reaches that level as a warlock's Mystic Arcanum does
//     (src/lib/srd/spell-prep.ts mysticArcanumTop), and the counter pays the
//     cast (src/lib/dm/genre-a-casts.ts genreFreeCast).
// Pure and import-light: the builder, the level-up dialog and the routes read it.
import type { ClassSpellGrants } from "@/lib/srd/class-spell-grants";
import { holdsFeature, isNamed } from "@/lib/srd/feature-names";
import { textKey } from "@/lib/language/text-logic";

type GrantView = { classId: string; level: number; features?: ReadonlyArray<{ name: string }> };

const ANY_LIST = [
  { classId: "occultist", feature: "Marginalia", level: 10, count: 2, ritualsOnly: true },
  { classId: "parapsychologist", feature: "Unified Theory", level: 17, count: 3, ritualsOnly: false },
];

// The class's own feature at its level; a sheet's feature list, when one is
// passed, must hold it too (a workshop class that dropped it has none).
const holds = (view: GrantView, classId: string, feature: string, level: number) =>
  textKey(view.classId) === classId && view.level >= level && (!view.features?.length || holdsFeature({ features: view.features }, feature));

export function horrorSpellGrants(view: GrantView, none: ClassSpellGrants): ClassSpellGrants | null {
  const held = ANY_LIST.find((grant) => holds(view, grant.classId, grant.feature, grant.level));
  if (!held) {
    return null;
  }
  return {
    ...none,
    anyList: held.count,
    anyListSpells: true,
    extraSpells: held.count,
    feature: held.feature,
    sources: [{ feature: held.feature, count: held.count, onTop: true }],
    ...(held.ritualsOnly ? { ritualsOnly: true } : {}),
  };
}

const ARCANA = [
  { classId: "occultist", feature: "Apocrypha", level: 13, spellLevel: 6 },
  { classId: "occultist", feature: "Seventh Seal", level: 17, spellLevel: 7 },
];

// The highest spell level these features open to the class at this level, or
// 0. `own`: the class's own feature table (spell-prep.ts passes it).
export function horrorArcanumTop(classId: string, level: number, own: ReadonlyArray<{ name: string }>): number {
  return Math.max(0, ...ARCANA.filter((entry) => textKey(classId) === entry.classId && level >= entry.level && own.some((feature) => isNamed(feature.name, entry.feature))).map((entry) => entry.spellLevel));
}

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
