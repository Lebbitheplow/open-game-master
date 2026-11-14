// A character's personality: one trait, one ideal, one bond and one flaw,
// the four short lines a 2014 background suggests. The builder offers the
// chosen background's own suggestions for each (a content-pack background's
// tables read from its text, the bundled thirteen's from persona-data.ts)
// and any line of the player's own; a background with none of its own
// offers a general list. The sheet stores the four lines as written
// (src/lib/schemas/sheet.ts personaSchema), and the GM reads them beside
// the backstory (src/lib/dm/prompt.ts). Pure: no React, no database.

import { BUNDLED_PERSONA, GENERAL_PERSONA, type PersonaLists } from "@/lib/backgrounds/persona-data";
import { PERSONA_ENTRY_MAX, type Persona } from "@/lib/schemas/sheet";

export type { PersonaLists };

export const PERSONA_KEYS = ["trait", "ideal", "bond", "flaw"] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export const PERSONA_LABELS: Record<PersonaKey, string> = {
  trait: "Personality trait",
  ideal: "Ideal",
  bond: "Bond",
  flaw: "Flaw",
};

// What each line is for, in plain words, under its label.
export const PERSONA_HINTS: Record<PersonaKey, string> = {
  trait: "A habit or manner people notice about them.",
  ideal: "What they believe in and strive for.",
  bond: "A person, place or promise they hold dear.",
  flaw: "A weakness others could use against them.",
};

export const EMPTY_PERSONA: Persona = { trait: "", ideal: "", bond: "", flaw: "" };

// A pack background's headings name the table: "Personality Trait", "Ideal",
// "Bond", "Flaw" (the SRD's Acolyte and Tome of Heroes write them so).
const HEADINGS: Array<[RegExp, PersonaKey]> = [
  [/^personality traits?$/i, "trait"],
  [/^ideals?$/i, "ideal"],
  [/^bonds?$/i, "bond"],
  [/^flaws?$/i, "flaw"],
];

const cleanCell = (cell: string) =>
  cell
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PERSONA_ENTRY_MAX);

// The suggested tables of a content-pack background's text ("| d8 |
// Personality Trait |" and its numbered rows), or null when it holds none
// (a Level Up row's list of mementos is not one).
export function parseSuggestedCharacteristics(text: string): PersonaLists | null {
  const lists: PersonaLists = { trait: [], ideal: [], bond: [], flaw: [] };
  let current: PersonaKey | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) {
      current = line ? null : current;
      continue;
    }
    const cells = line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (/^d\d+$/i.test(cells[0] ?? "")) {
      current = HEADINGS.find(([pattern]) => pattern.test(cells[1] ?? ""))?.[1] ?? null;
      continue;
    }
    if (!current || !/^\d+$/.test(cells[0] ?? "")) {
      continue;
    }
    const entry = cleanCell(cells.slice(1).join(" "));
    if (entry && !lists[current].includes(entry)) {
      lists[current].push(entry);
    }
  }
  return PERSONA_KEYS.some((key) => lists[key].length) ? lists : null;
}

// The 2014 variant backgrounds suggest what the backgrounds they vary do.
const VARIANT_OF: Record<string, string> = {
  knight: "noble",
  pirate: "sailor",
  spy: "criminal",
  gladiator: "entertainer",
  guild_merchant: "guild_artisan",
};

// What the builder offers for each line: the background's own lists where
// it has them, the general list for any line it does not. `fromBackground`
// says whether the picker may name the background as their source.
export function personaSuggestionsFor(
  background: { id: string; persona?: PersonaLists | null } | null | undefined,
): { lists: PersonaLists; fromBackground: boolean } {
  const own = background
    ? (BUNDLED_PERSONA[background.id] ?? BUNDLED_PERSONA[VARIANT_OF[background.id] ?? ""] ?? background.persona ?? null)
    : null;
  if (!own) {
    return { lists: GENERAL_PERSONA, fromBackground: false };
  }
  const lists = Object.fromEntries(
    PERSONA_KEYS.map((key) => [key, own[key]?.length ? own[key] : GENERAL_PERSONA[key]]),
  ) as PersonaLists;
  return { lists, fromBackground: true };
}

// The four lines trimmed, or undefined when every one is blank: a blank
// panel sends nothing, and a sheet without the field reads the same.
export function personaOrNothing(persona: Partial<Persona> | null | undefined): Persona | undefined {
  if (!persona) {
    return undefined;
  }
  const trimmed: Persona = {
    trait: (persona.trait ?? "").trim(),
    ideal: (persona.ideal ?? "").trim(),
    bond: (persona.bond ?? "").trim(),
    flaw: (persona.flaw ?? "").trim(),
  };
  return PERSONA_KEYS.some((key) => trimmed[key]) ? trimmed : undefined;
}

// The GM's line: each given entry named and quoted, in the sheet's order.
export function personaLine(persona: Partial<Persona> | null | undefined): string {
  const given = personaOrNothing(persona);
  if (!given) {
    return "";
  }
  return PERSONA_KEYS.filter((key) => given[key])
    .map((key) => `${key} "${given[key]}"`)
    .join("; ");
}
