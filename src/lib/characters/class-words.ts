// A character's class and level in words, wherever a card, a row or a
// heading names them (backlog F9): one class reads as it always has, a
// split names each class's levels, the first class first ("fighter 3 /
// rogue 2"). Pure, so the builder, the lobby, the roster and the library
// all say a split the same way, and scripts/test-builder-multiclass.mjs
// reads it directly.

import { workshopClassName } from "@/lib/classes/workshop-registry";
import { contentName } from "@/lib/content/names";
import type { Locale } from "@/lib/messages-logic";

export type ClassWordsSource = {
  class: string;
  level: number;
  classes?: ReadonlyArray<{ id: string; level: number }> | null;
};

// Whether the character holds more than one class.
export function isSplit(source: Pick<ClassWordsSource, "classes">): boolean {
  return (source.classes?.length ?? 0) > 1;
}

// "Fighter 5", or "Fighter 3 / Rogue 2": the class with the level, each
// class with its own levels on a split. `nameOf` turns an id into the
// words shown; by default the class's display name (classDisplayName), never
// the raw id, which a caller that forgot to pass one put on the screen (the
// lobby's emblem tooltip read "plague_doctor 1").
export function classLevelWords(source: ClassWordsSource, nameOf: (id: string) => string = classDisplayName): string {
  return isSplit(source)
    ? (source.classes ?? []).map((entry) => `${nameOf(entry.id)} ${entry.level}`).join(" / ")
    : `${nameOf(source.class)} ${source.level}`;
}

// The class part of a line that already says the level ("Level 5 Hill
// Dwarf Fighter"): the class alone, or each class's levels on a split
// ("Level 5 Hill Dwarf Fighter 3 / Rogue 2").
export function classWordsAfterLevel(source: ClassWordsSource, nameOf: (id: string) => string = classDisplayName): string {
  return isSplit(source) ? classLevelWords(source, nameOf) : nameOf(source.class);
}

// ---- names on a card ----
//
// A sheet keeps its species and classes as ids ("bhain-kwai", "plague_doctor"),
// and a card that printed them showed the id to the table (the lobby's
// companion card, the party roster). Every card reads its words here instead,
// so the roster says what the sheet dialog and the library already say.

// An id as a name: "bhain-kwai" is "Bhain Kwai", "plague_doctor" "Plague
// Doctor". A homebrew id names nothing a reader can use, so it is "".
export function idAsName(id: string): string {
  const value = String(id ?? "").trim();
  if (/^homebrew[:-]/.test(value)) {
    return "";
  }
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}

// A class's name: a workshop class's own name, else its id as a name. Not
// called `className`: a component's `className` prop shadowed that name and
// the raw id came back.
export function classDisplayName(id: string): string {
  return workshopClassName(id) ?? idAsName(id);
}

// The id as the spaced words a stored label reads ("plague_doctor" is
// "plague doctor"), the shape the official-name lookups key.
function spaced(id: string): string {
  return id.replace(/[-_]+/g, " ").trim();
}

// A class's name in the reader's language: a workshop class's own name,
// else the official name the content maps carry (src/lib/content/names.ts),
// else its id as a name. English falls back to classDisplayName as ever.
export function classDisplayNameFor(id: string, locale: Locale = "en"): string {
  const named = workshopClassName(id);
  if (named) {
    return named;
  }
  if (locale === "fr") {
    const official = contentName("classes", spaced(id), locale);
    if (official !== spaced(id)) {
      return official;
    }
  }
  return idAsName(id);
}

// A species' name: the homebrew name the server derived, else its id as a name.
export function speciesName(source: { race: string; raceLabel?: string | null }): string {
  return source.raceLabel || idAsName(source.race);
}

// A species' name in the reader's language: the stored label or the id
// through the official-name maps, the ready page's lookup
// (src/app/characters/[characterId]/ready/page.tsx). A miss keeps the
// capitalized id the plain reading gives.
export function speciesNameFor(source: { race: string; raceLabel?: string | null }, locale: Locale = "en"): string {
  const plain = speciesName(source);
  if (locale !== "fr") {
    return plain;
  }
  const ref = source.raceLabel || spaced(source.race);
  const official = contentName("species", ref, locale);
  return official === ref ? plain : official;
}

// "Bhain Kwai Fighter 3 / Rogue 2": the species and each class with its levels,
// as a card's second line reads. In French the official names
// (« Humain », « Guerrier 3 / Roublard 2 ») read when the maps carry them.
export function speciesAndClassWords(
  source: ClassWordsSource & { race: string; raceLabel?: string | null; summon?: { form: string; creatureType: string; spell: string } | null },
  locale: Locale = "en",
): string {
  // A summoned creature is its form and the kind it was made (Find Steed's
  // fey warhorse), not the placeholder race and class its sheet carries.
  // The form and its kind are the content's own words; they keep them.
  if (source.summon) {
    return `${source.summon.form}${source.summon.creatureType ? `, ${source.summon.creatureType}` : ""}${source.summon.spell ? ` (${source.summon.spell})` : ""}`;
  }
  return [speciesNameFor(source, locale), classLevelWords(source, (id) => classDisplayNameFor(id, locale))]
    .filter(Boolean)
    .join(" ");
}
