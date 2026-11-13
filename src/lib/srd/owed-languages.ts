// What a character's species and background leave to the player and the
// sheet never recorded: the bonus languages ("two of your choice", an
// acolyte's) and, for the class's skill count, the skills those grants give
// outright, which are no class picks.
//
// The sheet's "Choices owed" read the class's skill picks off every skill on
// the class's list, so a soldier fighter's Athletics and Intimidation (the
// background's) stood for both class picks, and the languages a species or
// background leaves open were never asked for (owed-choices.ts). Pure: the
// bundled and setting species and backgrounds only; a content pack's row the
// server does not carry here owes nothing, so a stored sheet built from one
// is never told it owes what it already chose.
import { srdBackgroundOptions, srdClassOptions, srdRaceOptions } from "@/lib/characters/options";
import { textKey } from "@/lib/language/text-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The name the sheet's owed training pick goes by (owed-picks-logic.ts).
export const LANGUAGES_TO_CHOOSE = "Languages to choose";

type LanguageSheet = Pick<CharacterSheet, "proficiencies"> &
  Partial<Pick<CharacterSheet, "race" | "background" | "class" | "classes">> & {
    // The picks a builder-made sheet records (createSheetSchema).
    racialChoices?: { skills?: string[] } | null;
    backgroundChoices?: { skills?: string[] } | null;
  };

const keyOf = (id: string) => textKey(id).replace(/[^a-z0-9]+/g, "_");
let races: ReturnType<typeof srdRaceOptions> | null = null;
let backgrounds: ReturnType<typeof srdBackgroundOptions> | null = null;
let classes: ReturnType<typeof srdClassOptions> | null = null;

function raceOf(id: string | undefined) {
  races ??= srdRaceOptions();
  return id ? races.find((race) => keyOf(race.id) === keyOf(id)) ?? null : null;
}
function backgroundOf(id: string | undefined) {
  backgrounds ??= srdBackgroundOptions();
  return id ? backgrounds.find((row) => keyOf(row.id) === keyOf(id)) ?? null : null;
}
export function classOptionOf(id: string | undefined) {
  classes ??= srdClassOptions();
  return id ? classes.find((row) => keyOf(row.id) === keyOf(id)) ?? null : null;
}

// The skills the species and background give, fixed or picked: none of them
// is one of the class's picks.
export function grantedSkillsOf(sheet: LanguageSheet): Set<string> {
  const race = raceOf(sheet.race);
  const background = backgroundOf(sheet.background);
  return new Set(
    [
      ...(race?.skills ?? []),
      ...(background?.skills ?? []),
      ...(sheet.racialChoices?.skills ?? []),
      ...(sheet.backgroundChoices?.skills ?? []),
    ].map(keyOf),
  );
}

// How many languages of the player's choice the species and background give
// that the sheet does not hold: their count, less the languages held beyond
// the ones they, the class or anything else names outright. Null when the
// species or the background is one this module does not know.
export function bonusLanguagesOwed(sheet: LanguageSheet): number {
  const race = raceOf(sheet.race);
  const background = backgroundOf(sheet.background);
  if (!race || !background) {
    return 0;
  }
  const slots = (race.bonusLanguages ?? 0) + (background.languages ?? 0);
  if (slots <= 0) {
    return 0;
  }
  const classIds = [sheet.class ?? "", ...(sheet.classes ?? []).map((entry) => entry.id)].filter(Boolean);
  const named = new Set(
    [...race.languages, ...(background.knownLanguages ?? []), ...classIds.flatMap((id) => classOptionOf(id)?.languages ?? [])].map(textKey),
  );
  const chosen = new Set(sheet.proficiencies.languages.map(textKey).filter((language) => language && !named.has(language)));
  return Math.max(0, slots - chosen.size);
}
