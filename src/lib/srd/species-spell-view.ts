// The spells a character's species gives, as the sheet's spell tab shows
// them (issue #833): a tiefling fighter's hellish rebuke and a Topaz
// ancestry's misty step had no place on the sheet, since the tab drew only
// the class's lists, and a character with no Spellcasting showed no tab.
// Each with what it costs: at will, or its free uses and the rest that
// brings them back, and whether a spell slot casts it too.
//
// Pure: src/components/sheet/SheetSpells.tsx draws it, the tests read it.
import { innateSpellsFor } from "@/lib/srd/racial-grants";
import { textKey } from "@/lib/language/text-logic";
import type { Ability } from "@/lib/schemas/sheet";

const ABILITY_WORDS: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

export type SpeciesSpellEntry = { name: string; level: number; note: string };

type SpellLists = { cantrips?: string[]; known: string[]; prepared: string[] };

export type SpeciesSpellSheet = {
  race: string;
  level: number;
  features?: ReadonlyArray<{ name: string; variant?: string }>;
  racialChoices?: { variant?: string | null } | null;
  resources?: Record<string, { max: number; used: number }>;
  spellcasting?: (SpellLists & { casters?: SpellLists[] }) | null;
};

// The species' spells at the character's level, but for one a class's
// list already holds (a tiefling wizard's thaumaturgy, written there at
// creation), which the class's book shows.
export function speciesSpellsShown(sheet: SpeciesSpellSheet): SpeciesSpellEntry[] {
  const casting = sheet.spellcasting;
  const listed = new Set(
    [casting, ...(casting?.casters ?? [])]
      .flatMap((entry) => (entry ? [...(entry.cantrips ?? []), ...entry.known, ...entry.prepared] : []))
      .map(textKey),
  );
  return innateSpellsFor(sheet.race, sheet.level, undefined, { variant: sheet.racialChoices?.variant, features: sheet.features })
    .filter((spell) => !listed.has(textKey(spell.name)))
    .map((spell) => {
      const ability = spell.ability ? ` · ${ABILITY_WORDS[spell.ability]}` : "";
      if (spell.castAt === 0) {
        return { name: spell.name, level: 0, note: `Cantrip, at will${ability}` };
      }
      const state = spell.counterId ? sheet.resources?.[spell.counterId] : undefined;
      const higher = spell.castAt > spell.circle ? `As a level ${spell.castAt} spell, ` : "";
      const times = spell.uses === 1 ? "once" : `${spell.uses} times`;
      // Read at the spell's own count, as the cast guard reads it.
      const left = ` (${spell.uses - Math.min(state?.used ?? 0, spell.uses)} left)`;
      const slots = spell.slotsToo ? ", or with a spell slot" : "";
      const words = `${higher}${times} a ${spell.rest} rest${left}${slots}${ability}`;
      return { name: spell.name, level: spell.circle, note: words.charAt(0).toUpperCase() + words.slice(1) };
    });
}
