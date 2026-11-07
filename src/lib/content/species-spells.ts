import { textKey } from "@/lib/language/text-logic";

// The spells a workshop species gives, and the spells each option of its
// player's choice gives (issue #833): a Half-Dragon's Topaz ancestry knows
// Mage Hand at 1st level, Detect Thoughts at 3rd and Misty Step at 5th.
//
// A row says which spell, the character level it arrives at, and for a
// spell of 1st level or higher how often it is cast without a slot (1 to 5
// times, back after a long or a short rest) and whether the character's own
// spell slots can cast it too. A cantrip is cast at will. One spellcasting
// ability answers for a whole group, as the SRD's racial traits name one
// ("Charisma is your spellcasting ability for these spells").
//
// The rows are run by the same path as the SRD's racial spells (Infernal
// Legacy, Drow Magic): src/lib/srd/racial-grants.ts reads them, the cast
// guard, the counters, the Hand and the sheet read that. Pure: the editor,
// the normalizer, the builder and the table share it.

export type SpeciesSpellAbility = "int" | "wis" | "cha";
export type SpeciesSpellRest = "long" | "short";

export type SpeciesSpell = {
  spell: string;
  // The character level it arrives at.
  level: number;
  // The spell's own level (0 for a cantrip), as the server found the spell
  // when the species was saved: a homebrew spell no bundled list knows is
  // still told apart from a cantrip.
  circle?: number;
  // A levelled spell's free casts, and the rest that brings them back.
  uses?: number;
  rest?: SpeciesSpellRest;
  // A levelled spell the character's own spell slots can also cast.
  slots?: boolean;
  // Cast as a higher-level spell than its own (Infernal Legacy's hellish
  // rebuke "as a 2nd-level spell"); carried from a published trait.
  castAt?: number;
};

export type SpeciesSpellGroup = { ability: SpeciesSpellAbility; spells: SpeciesSpell[] };

export const SPECIES_SPELL_ABILITIES: readonly SpeciesSpellAbility[] = ["int", "wis", "cha"];
// The ability the SRD's racial spells name most (the tiefling's, the drow's,
// the aasimar's): the editor starts a group on it.
export const DEFAULT_SPECIES_SPELL_ABILITY: SpeciesSpellAbility = "cha";
export const SPECIES_SPELL_LIMITS = { spells: 8, uses: 5, name: 80 } as const;

const ABILITY_WORDS: Record<SpeciesSpellAbility, string> = { int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
export const speciesSpellAbilityWord = (ability: SpeciesSpellAbility) => ABILITY_WORDS[ability];

type Raw = Record<string, unknown>;
const L = SPECIES_SPELL_LIMITS;

const whole = (value: unknown, low: number, high: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= low && value <= high ? value : null;

// Whether a row is a cantrip, as far as the row itself says (the readers
// at the table ask the bundled spell list first, src/lib/srd/racial-grants.ts).
export const isCantripRow = (row: Pick<SpeciesSpell, "circle">) => row.circle === 0;

// One group checked whole: every limit refused by name, never cut to fit,
// as the rest of a species is (src/lib/content/species-variants.ts). Null
// when it holds no spell. `where` names the species or the option.
export function checkSpeciesSpells(raw: unknown, where: string): { group: SpeciesSpellGroup | null } | { error: string } {
  if (raw == null) {
    return { group: null };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${where}: its spells are a spellcasting ability and a list of spells.` };
  }
  const source = raw as Raw;
  const ability = source.ability ?? DEFAULT_SPECIES_SPELL_ABILITY;
  if (!(SPECIES_SPELL_ABILITIES as readonly unknown[]).includes(ability)) {
    return { error: `${where}: its spells are cast with Intelligence, Wisdom or Charisma.` };
  }
  const rows = source.spells ?? [];
  if (!Array.isArray(rows)) {
    return { error: `${where}: its spells are a list.` };
  }
  if (rows.length > L.spells) {
    return { error: `${where} gives ${rows.length} spells; it gives ${L.spells} at most.` };
  }
  const seen = new Set<string>();
  const spells: SpeciesSpell[] = [];
  for (const entry of rows) {
    const row = (entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {}) as Raw;
    const name = typeof row.spell === "string" ? row.spell.trim() : "";
    if (!name || name.length > L.name) {
      return { error: `${where}: each spell it gives is named, in ${L.name} characters at most.` };
    }
    if (seen.has(textKey(name))) {
      return { error: `${where} gives ${name} twice; keep one row for it.` };
    }
    seen.add(textKey(name));
    const level = row.level == null ? 1 : whole(row.level, 1, 20);
    if (level === null) {
      return { error: `${where}: ${name} arrives at a character level from 1 to 20.` };
    }
    const circle = row.circle == null ? null : whole(row.circle, 0, 9);
    if (row.circle != null && circle === null) {
      return { error: `${where}: ${name}'s own level is 0 (a cantrip) to 9.` };
    }
    const spell: SpeciesSpell = { spell: name, level };
    if (circle !== null) spell.circle = circle;
    // A cantrip is cast at will: uses, a rest, slots and a higher level mean
    // nothing for it, and are left off rather than refused.
    if (circle !== 0) {
      const uses = row.uses == null ? 1 : whole(row.uses, 1, L.uses);
      if (uses === null) {
        return { error: `${where}: ${name} is cast 1 to ${L.uses} times without a slot between rests.` };
      }
      if (row.rest != null && row.rest !== "long" && row.rest !== "short") {
        return { error: `${where}: ${name}'s uses come back after a long rest or a short one.` };
      }
      if (row.slots != null && typeof row.slots !== "boolean") {
        return { error: `${where}: whether spell slots can cast ${name} is yes or no.` };
      }
      const castAt = row.castAt == null ? null : whole(row.castAt, 1, 9);
      if (row.castAt != null && (castAt === null || (circle !== null && castAt < circle))) {
        return { error: `${where}: ${name} is cast at its own level or higher, up to 9th.` };
      }
      if (uses !== 1) spell.uses = uses;
      if (row.rest === "short") spell.rest = "short";
      if (row.slots === true) spell.slots = true;
      if (castAt !== null) spell.castAt = castAt;
    }
    spells.push(spell);
  }
  return spells.length ? { group: { ability: ability as SpeciesSpellAbility, spells } } : { group: null };
}

// A stored group read back, or undefined (it was checked when it was saved).
export function readSpeciesSpells(raw: unknown): SpeciesSpellGroup | undefined {
  const checked = checkSpeciesSpells(raw, "The species");
  return "error" in checked ? undefined : (checked.group ?? undefined);
}

// A spell as the server's catalog knows it: the bundled list, a pack's, an
// author's homebrew.
export type SpeciesSpellLookup = (name: string) => { name: string; level: number } | null;

// The group with every spell named as the catalog names it and its own
// level written down; a name the catalog does not know is refused, since the
// workshop's picker only offers what it knows.
export function resolveSpeciesSpells(group: SpeciesSpellGroup, where: string, spellOf: SpeciesSpellLookup): { group: SpeciesSpellGroup } | { error: string } {
  const spells: SpeciesSpell[] = [];
  for (const row of group.spells) {
    const known = spellOf(row.spell);
    if (!known) {
      return { error: `${where}: "${row.spell}" is not a spell this server knows; pick it from the spell list.` };
    }
    const resolved: SpeciesSpell = { ...row, spell: known.name, circle: known.level };
    if (known.level === 0) {
      delete resolved.uses;
      delete resolved.rest;
      delete resolved.slots;
      delete resolved.castAt;
    } else if (resolved.castAt !== undefined && resolved.castAt <= known.level) {
      delete resolved.castAt;
    }
    spells.push(resolved);
  }
  return { group: { ...group, spells } };
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

// How often a levelled row casts without a slot, in words: "once a long
// rest", "2 times a short rest".
export function speciesSpellUsesWords(row: Pick<SpeciesSpell, "uses" | "rest">): string {
  const uses = row.uses ?? 1;
  return `${uses === 1 ? "once" : `${uses} times`} a ${row.rest === "short" ? "short" : "long"} rest`;
}

// One row in plain words: "Misty Step from 5th level, once a long rest, or
// with a spell slot". A cantrip reads "Mage Hand (cantrip)".
export function speciesSpellLine(row: SpeciesSpell): string {
  const from = row.level > 1 ? ` from ${ordinal(row.level)} level` : "";
  if (isCantripRow(row)) {
    return `${row.spell} (cantrip)${from}`;
  }
  return `${row.spell}${from}, ${speciesSpellUsesWords(row)}${row.slots ? ", or with a spell slot" : ""}`;
}

// A group in one line for a summary: "Mage Hand; Detect Thoughts from 3rd
// level, once a long rest (Charisma)".
export function speciesSpellsSummary(group: SpeciesSpellGroup | undefined | null): string {
  if (!group?.spells.length) {
    return "";
  }
  return `${group.spells.map(speciesSpellLine).join("; ")} (${ABILITY_WORDS[group.ability]})`;
}
