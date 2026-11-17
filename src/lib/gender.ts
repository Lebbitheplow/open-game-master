// A character's or an NPC's gender: one of the character builder's choices,
// or "" for unspecified. A fixed value rather than free text, so the voice
// cast, the stand-in face and the speech reader's pronouns read it the same
// way at every table, whatever language the table plays in. Pure and
// zod-free, so the builder and the NPC form import it.
import type { Locale } from "./messages-logic";

export const GENDERS = ["Female", "Male", "Nonbinary"] as const;
export type Gender = (typeof GENDERS)[number] | "";

// The choice lists' labels, in the reader's language (the MonsterFields
// SIZE_WORDS_FR pattern): the stored values stay the English ids; only the
// label reads the reader's language. Neither the SRD's French nor its name
// tables print these words (they are the table's own, adjectives agreeing
// with the person they describe), so the FR bank carries the wording the
// dictionary's gender questions already speak.
const GENDER_LABELS_FR: Record<string, string> = {
  Female: "Féminin",
  Male: "Masculin",
  Nonbinary: "Non binaire",
};

// A gender as the choice list prints it, or the stored word when the map
// does not know it (a free-text value read as unspecified never lands
// here). An empty gender reads as the label its picker gives it.
export function genderLabel(gender: Gender, locale: Locale): string {
  return locale === "fr" ? (GENDER_LABELS_FR[gender] ?? gender) : gender;
}

// A stored value as a choice. Sheets written through the API before the
// field was fixed may hold free text; it reads as unspecified.
export function storedGender(raw: unknown): Gender {
  return GENDERS.includes(raw as (typeof GENDERS)[number]) ? (raw as Gender) : "";
}

// The gender as "she" or "he" would stand for it: what picks a voice, and
// what the English pronouns of a speech line are matched against.
export type GenderMark = "f" | "m" | "";

export function genderMark(gender: Gender | undefined): GenderMark {
  return gender === "Female" ? "f" : gender === "Male" ? "m" : "";
}

// What the AI DM's tools and the console take when they register someone: a
// choice, or "Unknown" while the story has not shown it, stored as
// unspecified. "Unknown" never clears a gender already recorded.
export const TOLD_GENDERS = [...GENDERS, "Unknown"] as const;
export type ToldGender = (typeof TOLD_GENDERS)[number];

export function toldGender(told: ToldGender | undefined): Exclude<Gender, ""> | undefined {
  return told === "Unknown" ? undefined : told;
}

export const TOLD_GENDER_HELP = "Their gender as the story presents them, which picks their voice; Unknown until it shows.";
