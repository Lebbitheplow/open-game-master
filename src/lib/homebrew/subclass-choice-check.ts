import { ALL_SKILLS } from "@/lib/content/mechanics";
import { RESERVED, RESERVED_WORDS, uniqueVariantId } from "@/lib/content/species-variants";
import type { SubclassChoice, SubclassChoiceOption } from "@/lib/content/subclass-choices";
import { DAMAGE_TYPES } from "@/lib/dm/damage-logic";
import { textKey } from "@/lib/language/text-logic";

// The save's check of a workshop subclass's choices (issue #833; the shapes
// are src/lib/content/subclass-choices.ts). Every limit is refused by name,
// never cut to fit, since the save is someone's own writing; the labels and
// option names keep the species choice's reserved words, since both are
// written into the pick's record on a sheet.

// Every name the table writes from a choice stays inside the 80 letters a
// sheet keeps of a feature's name: "Label (Name)" is 73 at most.
export const SUBCLASS_CHOICE_LIMITS = {
  choices: 3,
  minOptions: 2,
  options: 16,
  label: 30,
  name: 40,
  id: 40,
  description: 1_000,
  resistances: 3,
  skills: 2,
  languages: 2,
  language: 40,
  spellLevels: 5,
  spellsPerLevel: 4,
  spell: 80,
} as const;

const L = SUBCLASS_CHOICE_LIMITS;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The choice's damage type is written as "<label> damage type: <type>"
// (src/lib/srd/chosen-element.ts), so a label holding those words would read
// as one.
const LABEL_RESERVED = /damage\s*type/i;

type Raw = Record<string, unknown>;

const quoted = (name: string) => `"${name.length > 40 ? `${name.slice(0, 40)}...` : name}"`;
const listed = (items: readonly string[], last = "and") =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}` : (items[0] ?? "");

function textList(value: unknown, what: string, where: string): { list: string[] } | { error: string } {
  if (value == null) {
    return { list: [] };
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { error: `${where}: its ${what} are a list of names.` };
  }
  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of value as string[]) {
    const trimmed = entry.trim();
    if (trimmed && !seen.has(textKey(trimmed))) {
      seen.add(textKey(trimmed));
      list.push(trimmed);
    }
  }
  return { list };
}

const levelOf = (value: unknown): number | null => {
  const level = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(level) && level >= 1 && level <= 20 ? level : null;
};

function checkSpells(raw: unknown, where: string): { spells?: Record<string, string[]> } | { error: string } {
  if (raw == null) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `${where}: its spells are a list of spells by the class level they arrive at.` };
  }
  const out: Record<string, string[]> = {};
  for (const [key, names] of Object.entries(raw as Raw)) {
    const level = levelOf(key);
    if (level === null) {
      return { error: `${where}: spells arrive at a class level from 1 to 20, not "${key}".` };
    }
    const read = textList(names, "spells", where);
    if ("error" in read) return read;
    if (read.list.length > L.spellsPerLevel) {
      return { error: `${where} grants ${read.list.length} spells at level ${level}; a level holds ${L.spellsPerLevel}.` };
    }
    const long = read.list.find((name) => name.length > L.spell);
    if (long) {
      return { error: `${where}: the spell ${quoted(long)} is a name of ${long.length} characters.` };
    }
    if (read.list.length) {
      out[String(level)] = [...new Set([...(out[String(level)] ?? []), ...read.list])];
    }
  }
  if (Object.keys(out).length > L.spellLevels) {
    return { error: `${where} grants spells at ${Object.keys(out).length} levels; an option grants them at ${L.spellLevels} at most.` };
  }
  return Object.keys(out).length ? { spells: out } : {};
}

function checkOption(
  row: Raw,
  index: number,
  label: string,
  ids: Set<string>,
  asked: Set<string>,
  names: Set<string>,
): { option: SubclassChoiceOption } | { error: string } {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) {
    return { error: `Option ${index + 1} of ${quoted(label)} needs a name.` };
  }
  const where = quoted(name);
  if (name.length > L.name) {
    return { error: `${where} is a name of ${name.length} characters; an option's name holds ${L.name}.` };
  }
  if (RESERVED.test(name)) {
    return { error: `${where}: an option's name cannot hold ${RESERVED_WORDS}.` };
  }
  if (names.has(textKey(name))) {
    return { error: `Two options of ${quoted(label)} are called ${where}; give each its own name.` };
  }
  const sent = typeof row.id === "string" ? row.id.trim() : "";
  if (sent && (sent.length > L.id || !ID.test(sent))) {
    return { error: `${where}: its id "${sent}" is not lower-case letters and numbers joined by dashes, ${L.id} at most.` };
  }
  if (sent && ids.has(sent)) {
    return { error: `Two options of ${quoted(label)} share the id "${sent}"; each option keeps its own.` };
  }
  const id = sent || uniqueVariantId(name, [...ids, ...asked]);
  const option: SubclassChoiceOption = { id, name };

  if (row.description != null && typeof row.description !== "string") {
    return { error: `${where}: its words are text.` };
  }
  const description = typeof row.description === "string" ? row.description.trim() : "";
  if (description.length > L.description) {
    return { error: `${where}'s words run to ${description.length} characters; an option's words hold ${L.description}.` };
  }
  if (description) option.description = description;

  if (row.damageType != null && row.damageType !== "") {
    const type = typeof row.damageType === "string" ? row.damageType.trim().toLowerCase() : "";
    if (!DAMAGE_TYPES.includes(type)) {
      return { error: `${where}'s damage type is one the table knows: ${listed(DAMAGE_TYPES, "or")}.` };
    }
    option.damageType = type;
  }

  const resistances = textList(row.resistances, "resistances", where);
  if ("error" in resistances) return resistances;
  const unknownType = resistances.list.find((type) => !DAMAGE_TYPES.includes(type.toLowerCase()));
  if (unknownType) {
    return { error: `${where}: "${unknownType}" is not a damage type the table knows; pick from ${listed(DAMAGE_TYPES, "or")}.` };
  }
  if (resistances.list.length > L.resistances) {
    return { error: `${where} resists ${resistances.list.length} damage types; an option resists ${L.resistances} at most.` };
  }
  if (resistances.list.length) option.resistances = resistances.list.map((type) => type.toLowerCase());

  const skills = textList(row.skills, "skills", where);
  if ("error" in skills) return skills;
  const skillIds = skills.list.map((skill) => skill.toLowerCase().replace(/\s+/g, "_"));
  const unknownSkill = skillIds.find((skill) => !(ALL_SKILLS as readonly string[]).includes(skill));
  if (unknownSkill) {
    return { error: `${where}: "${unknownSkill}" is not a skill.` };
  }
  if (skillIds.length > L.skills) {
    return { error: `${where} grants ${skillIds.length} skills; an option grants ${L.skills} at most.` };
  }
  if (skillIds.length) option.skills = skillIds;

  const languages = textList(row.languages, "languages", where);
  if ("error" in languages) return languages;
  if (languages.list.length > L.languages) {
    return { error: `${where} grants ${languages.list.length} languages; an option grants ${L.languages} at most.` };
  }
  const long = languages.list.find((entry) => entry.length > L.language);
  if (long) {
    return { error: `${where}: the language ${quoted(long)} is a name of ${long.length} characters; a language's name holds ${L.language}.` };
  }
  if (languages.list.length) option.languages = languages.list;

  const spells = checkSpells(row.spells, where);
  if ("error" in spells) return spells;
  if (spells.spells) option.spells = spells.spells;

  ids.add(id);
  names.add(textKey(name));
  return { option };
}

function checkChoice(raw: unknown, index: number, labels: Set<string>, choiceIds: Set<string>, askedIds: Set<string>): { choice: SubclassChoice } | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `Choice ${index + 1} is a label, a level and a list of options.` };
  }
  const source = raw as Raw;
  const label = typeof source.label === "string" ? source.label.trim() : "";
  if (!label) {
    return { error: `Choice ${index + 1} needs a label, such as Bloodline or Elemental affinity.` };
  }
  if (label.length > L.label) {
    return { error: `The choice's label ${quoted(label)} is ${label.length} characters; it holds ${L.label}.` };
  }
  if (RESERVED.test(label) || LABEL_RESERVED.test(label)) {
    return { error: `The choice's label ${quoted(label)} cannot hold ${RESERVED_WORDS}, or "damage type".` };
  }
  if (labels.has(textKey(label))) {
    return { error: `Two choices are called ${quoted(label)}; give each its own label.` };
  }
  const level = levelOf(source.level ?? 1);
  if (level === null) {
    return { error: `${quoted(label)} is chosen at a class level from 1 to 20.` };
  }
  const rows = Array.isArray(source.options) ? source.options : [];
  if (rows.length < L.minOptions || rows.length > L.options) {
    return { error: `${quoted(label)} holds ${L.minOptions} to ${L.options} options; it has ${rows.length}.` };
  }
  const asked = new Set(
    rows.map((row) => (row && typeof (row as Raw).id === "string" ? String((row as Raw).id).trim() : "")).filter(Boolean),
  );
  const ids = new Set<string>();
  const names = new Set<string>();
  const options: SubclassChoiceOption[] = [];
  for (const [at, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { error: `Option ${at + 1} of ${quoted(label)} is not an option.` };
    }
    const checked = checkOption(row as Raw, at, label, ids, asked, names);
    if ("error" in checked) {
      return checked;
    }
    options.push(checked.option);
  }
  // Kept once made, as an option's id is: a sheet's pick holds it.
  const sent = typeof source.id === "string" ? source.id.trim() : "";
  if (sent && (sent.length > L.id || !ID.test(sent))) {
    return { error: `${quoted(label)}: its id "${sent}" is not lower-case letters and numbers joined by dashes, ${L.id} at most.` };
  }
  if (sent && choiceIds.has(sent)) {
    return { error: `Two choices share the id "${sent}"; each choice keeps its own.` };
  }
  const id = sent || uniqueVariantId(label, [...choiceIds, ...askedIds]);
  choiceIds.add(id);
  labels.add(textKey(label));
  return { choice: { id, label, level, options } };
}

// The choices a subclass offers, checked whole: every limit is refused by
// name, never cut to fit, since the save is someone's own writing. Empty
// when it offers none.
export function checkSubclassChoices(raw: unknown): { choices: SubclassChoice[] } | { error: string } {
  if (raw == null) {
    return { choices: [] };
  }
  if (!Array.isArray(raw)) {
    return { error: "A subclass's choices are a list of choices." };
  }
  if (raw.length > L.choices) {
    return { error: `A subclass offers ${L.choices} choices at most; this one has ${raw.length}.` };
  }
  const labels = new Set<string>();
  const choiceIds = new Set<string>();
  const askedIds = new Set(raw.map((row) => (row && typeof (row as Raw).id === "string" ? String((row as Raw).id).trim() : "")).filter(Boolean));
  const choices: SubclassChoice[] = [];
  for (const [index, row] of raw.entries()) {
    const checked = checkChoice(row, index, labels, choiceIds, askedIds);
    if ("error" in checked) {
      return checked;
    }
    choices.push(checked.choice);
  }
  // One element per subclass: Elemental Affinity reads one damage type, and
  // two choices that each named one left the order of a sheet's features to
  // decide which (issue #833 review).
  const elemental = choices.filter((choice) => choice.options.some((option) => option.damageType));
  if (elemental.length > 1) {
    return { error: `${elemental.map((choice) => quoted(choice.label)).join(" and ")} both give an element; a subclass's options name an element in one choice only, the one Elemental Affinity reads.` };
  }
  return { choices };
}

// Stored choices read back: the list, or empty when there are none or they
// no longer hold together (they were checked when they were saved).
export function readSubclassChoices(raw: unknown): SubclassChoice[] {
  const checked = checkSubclassChoices(raw);
  return "error" in checked ? [] : checked.choices;
}

