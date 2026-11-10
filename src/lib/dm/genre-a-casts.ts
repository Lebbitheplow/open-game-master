// The cyberpunk and horror capstones whose use is a spell cast without a
// slot (WAVE2 D5: the genre text is the rule):
//   Singularity (esper 20): "cast a psionic of 5th level or lower without a
//     slot at two targets";
//   Author of the Unwritten (occultist 20): "cast any warlock spell of 5th
//     level or lower without a slot, twinned to two targets";
//   Apocrypha (occultist 13) and Seventh Seal (occultist 17): "Learn one 6th-
//     (7th-) level warlock spell; cast it 1/long rest without a slot".
// Before this each was a counter whose spend moved the counter and cast
// nothing, and the spell's tool asked for a slot.
//
// Two shapes. A capstone that would otherwise take every cast it fits (a 5th
// level spell has a slot to pay for it) is chosen first: its use_resource
// spend lays its mark (authored-effects-genre-a.ts), and the next spell it
// fits, cast while the mark holds, costs no slot and clears the mark. Its
// second target is the twin the mark switches on (authored-reaper.ts, any
// distance). A 6th or 7th level spell has no slot of the occultist's to pay
// for it, so Apocrypha and Seventh Seal pay as Mystic Arcanum does
// (counter-cast-arcanum.ts): the cast spends the counter, which is passive to
// use_resource.
//
// The cast guard (src/lib/dm/cast-guard.ts) asks genreFreeCast before a slot.
// Pure.
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { isConditionNamed } from "@/lib/srd/feature-names";

// `atMaximum`: the spell the mark pays for deals its maximum damage (Their
// Power, Your Hands: "without a slot at its maximum effect").
type GenreCast = { counter: string; feature: string } & ({ mark: string; maxLevel: number; atMaximum?: boolean } | { level: number });

export const GENRE_A_CASTS: GenreCast[] = [
  { counter: "cyberpunk_singularity", feature: "Singularity", mark: "singularity", maxLevel: 5 },
  { counter: "horror_author_of_the_unwritten", feature: "Author of the Unwritten", mark: "author of the unwritten", maxLevel: 5 },
  // Their Power, Your Hands (apostate 20): "cast one stigmata of 5th level or
  // lower without a slot at its maximum effect".
  { counter: "horror_their_power_your_hands", feature: "Their Power, Your Hands", mark: "their power, your hands", maxLevel: 5, atMaximum: true },
  // Bleeding Power (apostate 2): "1/rest, cast a 1st-level stigmata without a
  // slot", and Deeper Scars (11): "can cast up to 3rd-level stigmata". The
  // spend lays the mark of the holder's level (genre-a-horror-casts.ts).
  { counter: "horror_bleeding_power", feature: "Deeper Scars", mark: "bleeding power (deeper scars)", maxLevel: 3 },
  { counter: "horror_bleeding_power", feature: "Bleeding Power", mark: "bleeding power", maxLevel: 1 },
  { counter: "horror_apocrypha", feature: "Apocrypha", level: 6 },
  { counter: "horror_seventh_seal", feature: "Seventh Seal", level: 7 },
];

export type GenreFreeCast = { row: GenreCast; note: string };

// The capstone that pays for this cast, or null when none does (a slot pays).
// `named`: the slot level the call asked for; a free cast is cast at the
// spell's own level, so a higher one is no free cast.
export function genreFreeCast(
  sheet: Pick<CharacterSheet, "resources" | "conditions" | "name">,
  facts: SpellFacts | null,
  named: number | undefined,
): GenreFreeCast | null {
  if (!facts || facts.level < 1 || (named !== undefined && named !== facts.level)) {
    return null;
  }
  for (const row of GENRE_A_CASTS) {
    if ("mark" in row) {
      if (facts.level <= row.maxLevel && sheet.conditions.some((entry) => isConditionNamed(entry, row.mark))) {
        return { row, note: `${facts.name} is cast through ${row.feature}, with no spell slot.` };
      }
      continue;
    }
    const state = sheet.resources?.[row.counter];
    if (facts.level === row.level && state && state.used < state.max) {
      return { row, note: `${facts.name} is cast through ${row.feature}, with no spell slot: once until a long rest.` };
    }
  }
  return null;
}

// The feature that casts a spell of this level at its maximum: a mark held
// whose row says so, read before the cast clears it (cast-at-enemy.ts,
// aoe-spell.ts), or null.
export function genreCastsAtMaximum(sheet: Pick<CharacterSheet, "conditions">, level: number): string | null {
  for (const row of GENRE_A_CASTS) {
    if ("mark" in row && row.atMaximum && level >= 1 && level <= row.maxLevel && sheet.conditions.some((entry) => isConditionNamed(entry, row.mark))) {
      return row.feature;
    }
  }
  return null;
}

// What the free cast writes: the mark cleared, or the counter spent.
export function genreFreeCastPatch(
  sheet: Pick<CharacterSheet, "resources" | "conditions">,
  cast: GenreFreeCast,
  resources: CharacterSheet["resources"],
): FullPatchSheetInput {
  const { row } = cast;
  if ("mark" in row) {
    return { conditions: sheet.conditions.filter((entry) => !isConditionNamed(entry, row.mark)) };
  }
  const state = resources?.[row.counter];
  return { resources: { ...(resources ?? {}), [row.counter]: { max: state?.max ?? 1, used: (state?.used ?? 0) + 1 } } };
}
