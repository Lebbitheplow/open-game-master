// What a race grants beyond numbers the race table states outright: the
// dragonborn's ancestry, the spells some lineages cast by nature, and the
// rule for a proficiency two grants both give.
//
// Pure and database-free, like the rest of src/lib/srd, so the builder, the
// server's creation check and the counters can all read the same answer.
import racesJson from "@/lib/srd/races.json";
import classesJson from "@/lib/srd/classes.json";
import { speciesHoldsTrait, speciesRulesFor, srdRaceId, type SpeciesRules } from "@/lib/srd/race-id";
import type { Ability } from "@/lib/schemas/sheet";
import { racialCantripsOf, type RacialCantripChoices } from "@/lib/srd/racial-cantrips";
import { textKey } from "@/lib/language/text-logic";
import { checklistSpell } from "@/lib/srd/spell-lists";
import type { SpeciesSpell, SpeciesSpellGroup } from "@/lib/content/species-spells";

// ---- Draconic Ancestry (SRD 5.1, Dragonborn) ----

export type DraconicAncestry = {
  id: string;
  dragon: string;
  damageType: string;
  area: string;
  save: "dex" | "con";
};

// The SRD's table, row for row: the dragon, the damage its breath deals and
// the dragonborn resists, and the breath's shape and saving throw.
export const DRACONIC_ANCESTRIES: DraconicAncestry[] = [
  { id: "black", dragon: "Black", damageType: "acid", area: "5 by 30 ft. line", save: "dex" },
  { id: "blue", dragon: "Blue", damageType: "lightning", area: "5 by 30 ft. line", save: "dex" },
  { id: "brass", dragon: "Brass", damageType: "fire", area: "5 by 30 ft. line", save: "dex" },
  { id: "bronze", dragon: "Bronze", damageType: "lightning", area: "5 by 30 ft. line", save: "dex" },
  { id: "copper", dragon: "Copper", damageType: "acid", area: "5 by 30 ft. line", save: "dex" },
  { id: "gold", dragon: "Gold", damageType: "fire", area: "15 ft. cone", save: "dex" },
  { id: "green", dragon: "Green", damageType: "poison", area: "15 ft. cone", save: "con" },
  { id: "red", dragon: "Red", damageType: "fire", area: "15 ft. cone", save: "dex" },
  { id: "silver", dragon: "Silver", damageType: "cold", area: "15 ft. cone", save: "con" },
  { id: "white", dragon: "White", damageType: "cold", area: "15 ft. cone", save: "con" },
];

export const DRACONIC_ANCESTRY_IDS = DRACONIC_ANCESTRIES.map((entry) => entry.id);

// An ancestry nobody chose, rolled on the table above (one d10, one row
// each), for a dragonborn the engine makes: every dragon is as likely.
export function rollDraconicAncestry(rollDie: (sides: number) => number): DraconicAncestry {
  const face = Math.max(1, Math.min(DRACONIC_ANCESTRIES.length, rollDie(DRACONIC_ANCESTRIES.length)));
  return DRACONIC_ANCESTRIES[face - 1];
}

// A stored choice read back: the id ("red"), the dragon's name ("Red") or the
// feature this module names ("Draconic Ancestry: Red (...)").
export function findDraconicAncestry(value: string | null | undefined): DraconicAncestry | null {
  const key = (value ?? "").trim().toLowerCase().replace(/^draconic ancestry:\s*/, "");
  const word = key.split(/[\s(]/)[0];
  return DRACONIC_ANCESTRIES.find((entry) => entry.id === word) ?? null;
}

// Whether this race asks for an ancestry (the bundled dragonborn under any of
// its ids).
export function takesDraconicAncestry(raceId: string, rules?: SpeciesRules | null): boolean {
  return raceRow(raceId, rules)?.ancestryChoice === "draconic";
}

// The race feature a chosen ancestry is written as. Its name carries the
// resistance in the words the damage engine reads ("resistance to fire"),
// so the sheet resists the ancestry's type wherever features are read.
export function draconicAncestryFeature(ancestry: DraconicAncestry): { name: string; source: "race" } {
  return {
    name: `Draconic Ancestry: ${ancestry.dragon} (${ancestry.damageType} breath, ${ancestry.area}, ${ancestry.save.toUpperCase()} save; resistance to ${ancestry.damageType})`,
    source: "race",
  };
}

// The ancestry a sheet holds, read from its features. Null for a dragonborn
// written before the choice existed; the breath then stays the narrated one.
export function ancestryOf(features: Array<{ name: string }>): DraconicAncestry | null {
  for (const feature of features) {
    if (/^draconic ancestry:/i.test(feature.name.trim())) {
      return findDraconicAncestry(feature.name);
    }
  }
  return null;
}

// What a breath needs to be spent: its damage, its shape and the save it
// asks for. A dragon of the table above is one; a workshop species' option
// (src/lib/content/species-variants.ts) is another, with any save.
export type BreathSpec = { damageType: string; area: string; save: Ability };

// The race feature an option's breath is written as: "Breath Weapon (fire,
// 15 ft. cone, DEX save)". The counter reads it as Breath Weapon by the name
// before its bracket note; the spend reads the note back (variantBreathOf).
export const variantBreathFeatureName = (spec: BreathSpec) =>
  `Breath Weapon (${spec.damageType}, ${spec.area}, ${spec.save.toUpperCase()} save)`;

// Only the two shapes the SRD's breaths take, so the bundled trait's own
// "Breath Weapon (2d6, DC 8 + CON mod + PB)" is never read as one.
const VARIANT_BREATH = /^breath weapon \(([a-z]+), (15 ft\. cone|5 by 30 ft\. line), (str|dex|con|int|wis|cha) save\)$/i;

// The breath an option wrote on the sheet, or null.
export function variantBreathOf(features: Array<{ name: string }>): BreathSpec | null {
  for (const feature of features) {
    const match = VARIANT_BREATH.exec(feature.name.trim());
    if (match) {
      return { damageType: match[1].toLowerCase(), area: match[2], save: match[3].toLowerCase() as Ability };
    }
  }
  return null;
}

// Breath Weapon (SRD 5.1): 2d6, 3d6 at 6th level, 4d6 at 11th, 5d6 at 16th;
// DC 8 + Constitution modifier + proficiency bonus; the save and the damage
// type are the ancestry's.
export function breathWeaponFor(
  ancestry: BreathSpec,
  level: number,
  conMod: number,
  proficiencyBonus: number,
): { dice: string; damageType: string; save: Ability; dc: number; area: string } {
  const dice = level >= 16 ? "5d6" : level >= 11 ? "4d6" : level >= 6 ? "3d6" : "2d6";
  return {
    dice,
    damageType: ancestry.damageType,
    save: ancestry.save,
    dc: 8 + conMod + proficiencyBonus,
    area: ancestry.area,
  };
}

// ---- spells a race casts by nature ----

// `rest` and `uses`: a spell that comes back on a short rest (Firbolg Magic),
// as a workshop species' row says it.
type InnateSpellRow = { name: string; level: number; castAt?: number; per?: "long"; rest?: "short" | "long"; uses?: number };
type RaceRow = {
  id: string;
  ancestryChoice?: string;
  cantripChoice?: { list?: string };
  innateSpells?: { trait: string; ability: Ability; spells: InnateSpellRow[] };
};

const RACES = (racesJson as unknown as { races: RaceRow[] }).races;
const bundledRow = (raceId: string) => RACES.find((entry) => entry.id === srdRaceId(raceId)) ?? null;

// The bundled row, or for a species the bundled list does not carry, the
// rows its traits name: a workshop copy of the Tiefling holds Infernal
// Legacy and casts its spells, a copy of the Dragonborn picks an ancestry.
function raceRow(raceId: string, rules?: SpeciesRules | null): RaceRow | null {
  const bundled = bundledRow(raceId);
  if (bundled) {
    return bundled;
  }
  const species = speciesRulesFor(raceId, rules);
  if (!species) {
    return null;
  }
  const innate = RACES.find((entry) => entry.innateSpells && speciesHoldsTrait(species, entry.innateSpells.trait));
  const draconic = speciesHoldsTrait(species, "draconic ancestry");
  return innate || draconic
    ? { id: raceId, ...(draconic ? { ancestryChoice: "draconic" } : {}), ...(innate ? { innateSpells: innate.innateSpells } : {}) }
    : null;
}

// A spell the race (or the option its player picked) casts by nature. One
// shape for every source (issue #833): the SRD's racial traits (Infernal
// Legacy, Drow Magic), a workshop species' own spells and each option's
// (src/lib/content/species-spells.ts). The cast guard, the counters, the
// Hand, the sheet and the GM's prompt all read this.
export type InnateSpell = {
  name: string;
  // Character level the spell arrives at.
  gainedAt: number;
  // The spell's own level (0 for a cantrip).
  circle: number;
  // The level it is cast at without a slot: its own, or the one the trait
  // names (hellish rebuke "as a 2nd-level spell"); 0 for a cantrip.
  castAt: number;
  // A levelled spell's counter of free casts, or null for a cantrip.
  counterId: string | null;
  // Free casts between rests (0 for a cantrip, cast at will), and the rest
  // that brings them back.
  uses: number;
  rest: "long" | "short";
  // The character's own spell slots can cast it too.
  slotsToo: boolean;
  // The ability it is cast with ("Charisma is your spellcasting ability for
  // these spells"), or null when the source names none.
  ability: Ability | null;
  // What gives it, in the table's words: "Infernal Legacy", "Draconic
  // ancestry (Topaz)", "the species".
  source: string;
};

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// A levelled racial spell's counter: "racial_misty_step" back on a long
// rest (the id every SRD tiefling's sheet already holds), and
// "racial_short_misty_step" back on a short one. The id carries the rest,
// so the counter's rule is read from its id alone (class-resources.ts).
export const RACIAL_COUNTER_PREFIX = "racial_";
const SHORT_REST_COUNTER = "racial_short_";
export function racialSpellCounterId(spell: string, rest: "long" | "short"): string {
  return `${rest === "short" ? SHORT_REST_COUNTER : RACIAL_COUNTER_PREFIX}${slug(spell)}`;
}
export function racialCounterRest(id: string): "long" | "short" {
  return id.startsWith(SHORT_REST_COUNTER) ? "short" : "long";
}
// The spell a racial counter id names, in words ("misty step").
export function racialCounterSpell(id: string): string {
  return id.replace(/^racial_(?:short_)?/, "").replace(/_/g, " ");
}

// A spell's own level: the bundled list's word first (issue #833: the
// cantrip was guessed from the level a spell arrives at, and the darkness
// a tiefling casts at 5th was a cantrip-or-1st guess), then the level the
// server wrote when a workshop species was saved, then the row's shape.
function circleOf(name: string, written: number | undefined, guess: number): number {
  return checklistSpell(name)?.level ?? written ?? guess;
}

type GroupRow = SpeciesSpell & { name?: string; per?: "long" };

function rowsFrom(group: { ability: Ability | null; spells: GroupRow[] }, source: string): InnateSpell[] {
  return group.spells.map((row) => {
    const name = row.spell ?? row.name ?? "";
    // A bundled row says "per": "long" for its once-a-day spells; a
    // workshop row says how many uses, and is levelled unless it is a cantrip.
    // A workshop row whose level nobody wrote (a hand-made file) is read as
    // a levelled spell: a counted use, never an unlimited one.
    const circle = circleOf(name, row.circle, row.per || row.uses || row.name === undefined ? 1 : 0);
    const levelled = circle > 0;
    const rest = row.rest === "short" ? "short" : "long";
    return {
      name,
      gainedAt: row.level,
      circle,
      // SRD 5.1: a racial spell is cast at its own level unless the trait
      // names a higher one ("as a 2nd-level spell"). Darkness is a 2nd-level
      // spell and was cast as a 1st.
      castAt: levelled ? Math.max(circle, row.castAt ?? circle) : 0,
      counterId: levelled ? racialSpellCounterId(name, rest) : null,
      uses: levelled ? Math.max(1, row.uses ?? 1) : 0,
      rest,
      slotsToo: levelled && row.slots === true,
      ability: group.ability,
      source,
    };
  });
}

// What a sheet holds that names its species option: the pick
// (racialChoices.variant, on a character in the builder or the library) or
// the record the option wrote among its race features, "Draconic ancestry
// (Topaz)", which a sheet at a table carries (its pick is not stored there,
// src/lib/content/species-variants.ts).
export type SpeciesSpellChoices = {
  variant?: string | null;
  features?: ReadonlyArray<{ name: string; variant?: string }> | null;
};

// The option a sheet holds, among the species' options with spells.
function heldOptionSpells(species: SpeciesRules | null, held: SpeciesSpellChoices | null | undefined) {
  const options = species?.variantSpells;
  if (!options || !held) {
    return null;
  }
  // The pick, else the id the record carries (sheet-legality.ts writes it),
  // which outlives a rename of the option or the choice; a record written
  // before the id was is found by its name.
  const picked = (held.variant ?? "").trim() || (held.features ?? []).find((feature) => feature.variant)?.variant?.trim() || "";
  if (picked) {
    return options[picked] ?? null;
  }
  const records = new Set((held.features ?? []).map((feature) => textKey(feature.name)));
  return Object.values(options).find((entry) => entry.from && records.has(textKey(entry.from))) ?? null;
}

// Every spell the race gives, at any level: the bundled race's trait, a
// workshop species' own spells (or, for one with none of its own, the
// published trait it names), and with `held` the picked option's, read from
// the option the species offers today, as the race's own are.
export function speciesSpellRows(raceId: string, rules?: SpeciesRules | null, held?: SpeciesSpellChoices | null): InnateSpell[] {
  const out: InnateSpell[] = [];
  const species = bundledRow(raceId) ? null : speciesRulesFor(raceId, rules);
  if (species?.spells?.spells.length) {
    out.push(...rowsFrom(species.spells, "the species"));
  } else {
    const row = raceRow(raceId, rules);
    if (row?.innateSpells) {
      out.push(...rowsFrom({ ability: row.innateSpells.ability, spells: row.innateSpells.spells.map((spell) => ({ ...spell, spell: spell.name })) }, row.innateSpells.trait));
    }
  }
  const option = heldOptionSpells(species, held);
  if (option?.spells.length) {
    out.push(...rowsFrom(option, option.from ?? "the species' choice"));
  }
  // A spell two sources give is cast through the first.
  const seen = new Set<string>();
  return out.filter((spell) => {
    const key = textKey(spell.name);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Every spell the race has given by this character level: Infernal Legacy's
// thaumaturgy, then hellish rebuke (as a 2nd-level spell) at 3rd and darkness
// at 5th; Drow Magic's dancing lights, faerie fire and darkness; a forest
// gnome's minor illusion; a workshop Half-Dragon's Topaz ancestry's mage
// hand, detect thoughts at 3rd and misty step at 5th. Cantrips are known
// outright and cost nothing.
export function innateSpellsFor(raceId: string, level: number, rules?: SpeciesRules | null, choices?: SpeciesSpellChoices | null): InnateSpell[] {
  return speciesSpellRows(raceId, rules, choices).filter((spell) => level >= spell.gainedAt);
}

// The ability the race's own spells are cast with (Charisma for the tiefling
// and the drow, Intelligence for the forest gnome), or null.
export function innateSpellAbility(raceId: string, rules?: SpeciesRules | null): Ability | null {
  const species = bundledRow(raceId) ? null : speciesRulesFor(raceId, rules);
  return species?.spells?.spells.length ? species.spells.ability : (raceRow(raceId, rules)?.innateSpells?.ability ?? null);
}

const CLASSES = (classesJson as unknown as { classes: Array<{ id: string; spellAbility: Ability | null }> }).classes;

// The ability a bundled race's chosen cantrip is cast with: its list's
// class's (SRD 5.1, High Elf, Cantrip: "You know one cantrip of your choice
// from the wizard spell list. Intelligence is your spellcasting ability for
// it."). Null for a species the bundled list does not carry: the class's
// ability answers then, as before.
export function racialCantripAbility(raceId: string): Ability | null {
  const list = RACES.find((entry) => entry.id === srdRaceId(raceId))?.cantripChoice?.list;
  return list ? (CLASSES.find((entry) => entry.id === textKey(list))?.spellAbility ?? null) : null;
}

// The ability a spell the race gives is cast with: the chosen cantrip's
// (a high elf's Intelligence) or the trait's (a tiefling's Charisma for
// Infernal Legacy, a Topaz ancestry's for its misty step), or null when the
// spell is not the race's or the race names no ability for it. The class's
// ability answers then, and also for a levelled spell the class knows too
// (`classHolds`): a tiefling wizard's darkness from a wizard slot is cast
// with Intelligence once Infernal Legacy's own use of it is spent.
export function racialSpellAbility(
  sheet: RacialSpellSheet,
  spell: string,
  classHolds = false,
): Ability | null {
  if (!sheet.race) {
    return null;
  }
  const wanted = textKey(spell);
  const choice = RACES.find((entry) => entry.id === srdRaceId(sheet.race ?? ""))?.cantripChoice;
  const cantripAbility = racialCantripAbility(sheet.race);
  if (choice && cantripAbility) {
    const picks = racialCantripsOf(sheet.racialChoices);
    if (picks.length ? picks.some((name) => textKey(name) === wanted) : racialCantripHeld(sheet, spell, choice.list ?? "")) {
      return cantripAbility;
    }
  }
  const innate = innateSpellsFor(sheet.race, sheet.level, undefined, { variant: sheet.racialChoices?.variant, features: sheet.features }).find((entry) => textKey(entry.name) === wanted);
  if (!innate) {
    return null;
  }
  // A spell the class holds too is cast through the race while its free use
  // is left, which the cast guard spends first (SRD 5.1, Infernal Legacy:
  // "Charisma is your spellcasting ability for these spells"), and as the
  // class's own spell, with the class's ability, once that use is gone.
  if (classHolds && innate.castAt > 0) {
    const state = innate.counterId ? sheet.resources?.[innate.counterId] : undefined;
    const left = innate.uses - Math.min(state?.used ?? 0, innate.uses);
    return left > 0 ? innate.ability : null;
  }
  return innate.ability;
}

type RacialSpellSheet = {
  race?: string;
  level: number;
  racialChoices?: (NonNullable<RacialCantripChoices> & { variant?: string | null }) | null;
  features?: ReadonlyArray<{ name: string; variant?: string }>;
  resources?: Record<string, { max: number; used: number }>;
  class?: string;
  classes?: ReadonlyArray<{ id: string }>;
  spellcasting?: { cantrips?: string[]; casters?: Array<{ cantrips?: string[] }> } | null;
};

// A sheet in play does not record which cantrip the race gave: the one it
// holds that is on the race's list and on none of its classes' lists is it
// (a high elf cleric's Fire Bolt). On a wizard it is a wizard cantrip either
// way, and the class's ability is the same.
function racialCantripHeld(sheet: RacialSpellSheet, spell: string, list: string): boolean {
  const wanted = textKey(spell);
  const casting = sheet.spellcasting;
  const held = [casting?.cantrips ?? [], ...(casting?.casters ?? []).map((entry) => entry.cantrips ?? [])].flat();
  if (!list || !held.some((name) => textKey(name) === wanted)) {
    return false;
  }
  const lists = checklistSpell(spell)?.classes ?? [];
  const classIds = [sheet.class ?? "", ...(sheet.classes ?? []).map((entry) => entry.id)].map(textKey).filter(Boolean);
  return lists.includes(textKey(list)) && !classIds.some((id) => lists.includes(id));
}

// The race's cantrips, which ride on top of any class's cantrips known. An
// option's are left out unless `choices` is given: they are read from the
// option at the table and never copied into a class's list, which an edit
// that picks another option would have to find and take out again.
export function innateCantripsFor(raceId: string, level: number, rules?: SpeciesRules | null, choices?: SpeciesSpellChoices | null): string[] {
  return innateSpellsFor(raceId, level, rules, choices)
    .filter((spell) => spell.castAt === 0)
    .map((spell) => spell.name);
}

// A published race's spells as a workshop species writes them (issue #833),
// so a workshop copy of the Tiefling started from the published row keeps
// thaumaturgy, hellish rebuke as a 2nd-level spell, and darkness.
export function bundledSpeciesSpells(raceId: string): SpeciesSpellGroup | null {
  const innate = bundledRow(raceId)?.innateSpells;
  if (!innate?.spells.length || !["int", "wis", "cha"].includes(innate.ability)) {
    return null;
  }
  return {
    ability: innate.ability as SpeciesSpellGroup["ability"],
    spells: innate.spells.map((row) => {
      const circle = checklistSpell(row.name)?.level;
      return {
        spell: row.name,
        level: row.level,
        ...(circle !== undefined ? { circle } : {}),
        ...(row.castAt && circle !== undefined && row.castAt > circle ? { castAt: row.castAt } : {}),
      };
    }),
  };
}

// Whether the race's spells can be read here: a bundled race always, any
// other once its rules are (the server's reader is registered by
// src/lib/db/sheets.ts, the browser's by the page). A counter of a race that
// cannot be read is kept as it is, never dropped and refunded later.
export function speciesSpellsReadable(raceId: string): boolean {
  return Boolean(bundledRow(raceId) || speciesRulesFor(raceId));
}

// The counters of free casts, shaped like the sheet's resources map, with
// any use already spent kept (and clamped) so a regrant never refunds one.
export function innateSpellCounters(
  raceId: string,
  level: number,
  existing?: Record<string, { max: number; used: number }>,
  rules?: SpeciesRules | null,
  choices?: SpeciesSpellChoices | null,
): Record<string, { max: number; used: number }> {
  const out: Record<string, { max: number; used: number }> = {};
  for (const spell of innateSpellsFor(raceId, level, rules, choices)) {
    if (spell.counterId) {
      out[spell.counterId] = { max: spell.uses, used: Math.min(existing?.[spell.counterId]?.used ?? 0, spell.uses) };
    }
  }
  return out;
}

// ---- the same proficiency from two grants ----

// SRD 5.1, Backgrounds: a character who would gain the same proficiency from
// two sources can choose a different proficiency of the same kind instead.
// Given the fixed grants of one kind (the race's skills, the background's
// skills, the class's tools), the names given more than once: each repeat is
// one free pick of that kind owed to the player.
export function repeatedGrants(...grants: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const list of grants) {
    for (const name of new Set((list ?? []).map((entry) => entry.trim().toLowerCase()))) {
      if (!name) {
        continue;
      }
      if (seen.has(name)) {
        repeated.push(name);
      } else {
        seen.add(name);
      }
    }
  }
  return repeated;
}
