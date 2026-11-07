// A class made in the workshop (homebrew kind "class"): the numbers the
// engines read for any class (src/lib/srd/srd-types.ts SrdClass) and its
// features by level, the shape the setting classes ship in
// (src/lib/classes/index.ts). Pure, so the workshop's editor, the server's
// registry and the browser's read one entry alike.
//
// A workshop class is a class to the engines from the moment it is kept:
// src/lib/classes/index.ts registers it (registerWorkshopClasses), and the
// lookups every engine makes (findClass, the feature tables, the spell list
// it borrows) answer for it as they do for the bundled ones. A feature
// borrowed from a published class or subclass keeps its name, so the engine
// runs it; one written fresh is words for the DM.

import type { CustomClass, CustomFeatureTable } from "@/lib/classes";
import type { Ability } from "@/lib/schemas/sheet";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { textKey } from "@/lib/language/text-logic";
import { HOMEBREW_DESC_MAX, HOMEBREW_NAME_MAX } from "@/lib/schemas/homebrew";

export type ClassFeatureRow = { n: string; d: string };

// What the workshop keeps for a class.
export type WorkshopClassData = {
  desc: string;
  hitDie: 6 | 8 | 10 | 12;
  saves: Ability[];
  skillChoices: { count: number; from: string[] };
  armor: string[];
  weapons: string[];
  tools: string[];
  // How it casts: like a wizard (full), a paladin (half), a warlock (pact),
  // or not at all; and from which class's list, with which ability.
  casterType: "none" | "full" | "half" | "pact";
  spellAbility: "int" | "wis" | "cha" | null;
  // A published class's list (SPELL_LISTS), or CUSTOM_SPELL_LIST for one of
  // its own (issue #833): then `spellList` names its spells and
  // `spellStyle` says whether it prepares them each day or learns a number.
  spellListFrom: string | null;
  spellList?: string[];
  spellStyle?: SpellListStyle;
  subclassLevel: number;
  levels: Record<string, ClassFeatureRow[]>;
};

export const HIT_DICE = [6, 8, 10, 12] as const;
export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
export const ARMOR_TRAINING = ["light", "medium", "heavy", "shields"] as const;
// The druid's shield training, which also keeps it out of metal armor
// (src/lib/srd/armor.ts wearsNoMetal); a copy of the druid keeps it.
export const NONMETAL_SHIELDS = "shields (nonmetal)";
const ARMOR_TERMS: readonly string[] = [...ARMOR_TRAINING, NONMETAL_SHIELDS];
export const WEAPON_TRAINING = ["simple", "martial"] as const;
export const CASTER_TYPES = ["none", "full", "half", "pact"] as const;
// The lists a workshop class may cast from: the classes that have one.
export const SPELL_LISTS = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"] as const;
// The lists whose class learns its spells for good rather than preparing
// them each day; a workshop class casting from one learns the same way.
const KNOWN_LISTS = new Set(["bard", "ranger", "sorcerer", "warlock"]);
// A list of the class's own, picked spell by spell from the SRD's and the
// table's homebrew (issue #833), instead of a published class's.
export const CUSTOM_SPELL_LIST = "custom";
// The most spells such a list holds: past the wizard's whole list in the
// SRD and a pack's, with room for the table's own.
export const CUSTOM_LIST_MAX = 400;
// How a class with its own list holds its spells: prepares from the whole
// list each day (a cleric), or learns a set number for good (a sorcerer).
export type SpellListStyle = "prepared" | "known";
export const SPELL_LIST_STYLES = ["prepared", "known"] as const;
// The published class whose tables count a custom list's cantrips and
// spells, by how the class casts and how it holds them. A borrowed list's
// own class counts it, as before; a list of the class's own has no class
// of its own to count by, so it counts as the published caster that casts
// and holds its spells the same way. Pact magic learns, as the warlock does.
export function customListRules(casterType: WorkshopClassData["casterType"], style: SpellListStyle): string | null {
  if (casterType === "pact") return "warlock";
  if (casterType === "full") return style === "known" ? "sorcerer" : "cleric";
  if (casterType === "half") return style === "known" ? "ranger" : "paladin";
  return null;
}
// The ability each list's own class casts with, the default for a new caster.
export const LIST_ABILITY: Record<(typeof SPELL_LISTS)[number], "int" | "wis" | "cha"> = {
  bard: "cha",
  cleric: "wis",
  druid: "wis",
  paladin: "cha",
  ranger: "wis",
  sorcerer: "cha",
  warlock: "cha",
  wizard: "int",
};
// The levels every class takes an Ability Score Improvement at, which a new
// workshop class starts with (the engine counts them by name).
export const ASI_LEVELS = [4, 8, 12, 16, 19];
export const ASI_FEATURE = "Ability Score Improvement";

// What a class or a subclass keeps: features at a level, and each feature's
// name and words. A save over any of them is refused by name
// (src/lib/homebrew/limits.ts) rather than cut here, so these are the one
// place the numbers live; the editor, the routes and the normalizers read them.
export const FEATURE_LIMITS = { perLevel: 8, name: 80, text: 1500 } as const;
export const CLASS_LIST_LIMITS = { tools: 8, weapons: 24 } as const;
// A subclass's always-prepared spells at one class level (a domain's five).
export const SUBCLASS_SPELLS_PER_LEVEL = 6;

// A level key as the stored tables read it: "3" and "3.0" are both level 3,
// and a level outside the game is none.
export function levelOfKey(key: string): number | null {
  const level = Math.floor(Number(key));
  return key.trim() && Number.isFinite(level) && level >= 1 && level <= 20 ? level : null;
}

// The id a workshop class is known by on a sheet and in every table: its
// entry's own id, so two people's "Spellblade" never meet.
export function workshopClassId(entryId: string): string {
  return `homebrew-${entryId}`;
}

export function isWorkshopClassId(classId: string): boolean {
  return classId.startsWith("homebrew-");
}

export function blankClassData(): WorkshopClassData {
  return {
    desc: "",
    hitDie: 8,
    saves: ["str", "con"],
    skillChoices: { count: 2, from: [...ALL_SKILLS] },
    armor: ["light"],
    weapons: ["simple"],
    tools: [],
    casterType: "none",
    spellAbility: null,
    spellListFrom: null,
    subclassLevel: 3,
    levels: Object.fromEntries(ASI_LEVELS.map((level) => [String(level), [{ n: ASI_FEATURE, d: "Raise one ability score by 2, or two by 1, or take a feat." }]])),
  };
}

const oneOf = <T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const stringList = (value: unknown, max: number, length = 60): string[] =>
  Array.isArray(value)
    ? [...new Set(value.map((entry) => String(entry ?? "").trim().slice(0, length)).filter(Boolean))].slice(0, max)
    : [];

// A list of spell names as a class keeps it: blanks dropped, each name once
// by its name key ("Shield" and "shield" are one spell), the first spelling
// kept. Uncapped, so the limits can say how far past the cap a list ran.
export function distinctSpellNames(value: unknown, length = HOMEBREW_NAME_MAX): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const name = String(entry ?? "").trim().slice(0, length);
    const key = textKey(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// The stored data read into the shape the engines need, every field held to
// what a class can be: a d6 to a d12, two different saves, skills from the
// list, a level to pick the subclass at between 1 and 3. Returns the reason
// when the draft cannot be a class at all.
export function normalizeClassData(raw: Record<string, unknown>): { data: WorkshopClassData } | { error: string } {
  const blank = blankClassData();
  const saves = stringList(raw.saves, 2).filter((entry): entry is Ability => ABILITIES.includes(entry as Ability));
  if (saves.length !== 2) {
    return { error: "A class is proficient in two saving throws: pick two different abilities." };
  }
  const skills = (raw.skillChoices ?? {}) as { count?: unknown; from?: unknown };
  const from = stringList(skills.from, ALL_SKILLS.length).filter((skill) => (ALL_SKILLS as readonly string[]).includes(skill));
  const count = Math.max(0, Math.min(6, Math.floor(Number(skills.count ?? blank.skillChoices.count)) || 0));
  if (count > from.length) {
    return { error: `The class picks ${count} skills from a list of ${from.length}: add skills to the list or pick fewer.` };
  }
  const casterType = oneOf(raw.casterType, CASTER_TYPES, "none");
  const spellListFrom = casterType === "none" ? null : oneOf(raw.spellListFrom, [...SPELL_LISTS, CUSTOM_SPELL_LIST], "wizard");
  const custom = spellListFrom === CUSTOM_SPELL_LIST;
  const spellAbility =
    casterType === "none"
      ? null
      : oneOf(raw.spellAbility, ["int", "wis", "cha"] as const, custom ? "int" : LIST_ABILITY[(spellListFrom ?? "wizard") as (typeof SPELL_LISTS)[number]]);
  // A list of its own keeps its spells by name, each once; a pact caster
  // learns its spells, as the warlock does, whatever the draft said.
  const spellList = custom ? distinctSpellNames(raw.spellList).slice(0, CUSTOM_LIST_MAX) : [];
  const spellStyle: SpellListStyle | undefined = custom
    ? casterType === "pact"
      ? "known"
      : oneOf(raw.spellStyle, SPELL_LIST_STYLES, "prepared")
    : undefined;
  if (custom && !spellList.length) {
    return { error: "The class casts from a spell list of its own: add at least one spell to it, or pick a published class's list." };
  }
  const levels: Record<string, ClassFeatureRow[]> = {};
  for (const [key, rows] of Object.entries((raw.levels ?? {}) as Record<string, unknown>)) {
    const level = levelOfKey(key);
    if (level === null || !Array.isArray(rows)) {
      continue;
    }
    const kept = rows
      .map((row) => ({
        n: String((row as ClassFeatureRow)?.n ?? "").trim().slice(0, FEATURE_LIMITS.name),
        d: String((row as ClassFeatureRow)?.d ?? "").trim().slice(0, FEATURE_LIMITS.text),
      }))
      .filter((row) => row.n);
    if (kept.length) {
      levels[String(level)] = [...(levels[String(level)] ?? []), ...kept].slice(0, FEATURE_LIMITS.perLevel);
    }
  }
  return {
    data: {
      desc: String(raw.desc ?? "").slice(0, HOMEBREW_DESC_MAX),
      hitDie: oneOf(Number(raw.hitDie), HIT_DICE, blank.hitDie),
      saves,
      skillChoices: { count, from },
      armor: stringList(raw.armor, ARMOR_TERMS.length).filter((entry) => ARMOR_TERMS.includes(entry)),
      // A category or a weapon by name ("simple", "longsword").
      weapons: stringList(raw.weapons, CLASS_LIST_LIMITS.weapons),
      tools: stringList(raw.tools, CLASS_LIST_LIMITS.tools),
      casterType,
      spellAbility,
      spellListFrom,
      ...(custom ? { spellList, spellStyle } : {}),
      subclassLevel: Math.max(1, Math.min(3, Math.floor(Number(raw.subclassLevel ?? blank.subclassLevel)) || blank.subclassLevel)),
      levels,
    },
  };
}

// The first sentence of the description, for the class picker's one line.
function blurbOf(desc: string, name: string): string {
  const first = desc.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return (first || `${name}, a class made for this table.`).slice(0, 200);
}

export type WorkshopClass = {
  klass: CustomClass;
  features: CustomFeatureTable;
  // Each feature's words, by its name (the sheet's help and the DM's prompt).
  text: Record<string, string>;
};

// A kept entry as the engines read it, or null when it is not a class.
export function workshopClassFrom(entry: { id: string; name: string; data: Record<string, unknown> }): WorkshopClass | null {
  const normalized = normalizeClassData(entry.data);
  if ("error" in normalized) {
    return null;
  }
  const data = normalized.data;
  const id = workshopClassId(entry.id);
  // A list of its own is the class's own: its id is the list the searches
  // and the checks ask for (src/lib/classes/class-spell-list.ts), and the
  // published caster that casts the same way counts it.
  const custom = data.spellListFrom === CUSTOM_SPELL_LIST;
  const style = data.spellStyle ?? "prepared";
  const text: Record<string, string> = {};
  const levels: Record<string, string[]> = {};
  for (const [level, rows] of Object.entries(data.levels)) {
    levels[level] = rows.map((row) => row.n);
    for (const row of rows) {
      text[textKey(row.n)] ??= row.d;
    }
  }
  return {
    klass: {
      id,
      name: entry.name.trim().slice(0, 60),
      hitDie: data.hitDie,
      saves: data.saves,
      casterType: data.casterType,
      spellAbility: data.spellAbility,
      armor: data.armor,
      weapons: data.weapons,
      tools: data.tools,
      skillChoices: data.skillChoices,
      genres: [],
      blurb: blurbOf(data.desc, entry.name.trim()),
      spellListFrom: custom ? id : data.spellListFrom,
      knownCaster: custom ? style === "known" : data.spellListFrom !== null && KNOWN_LISTS.has(data.spellListFrom),
      ...(custom ? { customSpells: data.spellList ?? [], spellRules: customListRules(data.casterType, style) ?? "wizard" } : {}),
      castingLabel: null,
    },
    features: { subclassLevel: data.subclassLevel, levels, subclasses: [] },
    text,
  };
}
