// Subclasses the bundled tables do not carry, as tables the feature grants
// can read: a workshop subclass (homebrew_entries kind "archetype", its
// features by level as { n, d }) and a content-pack archetype written as
// prose ("##### Roar of Defiance / Beginning at 3rd level, ..."). Without
// these a character who took one got the base class's features and none of
// the subclass's (src/lib/srd/features.ts classFeaturesFor), and a workshop
// copy of a published subclass started with no features at all.
//
// They reach the grants as `extras`, per table: a homebrew subclass is its
// author's, so two DMs' "Oath of Ash" never share features (the server
// builds them for whoever runs the table, src/lib/characters/
// subclass-extras.ts; the builder from the rows it fetched). Pure.

import {
  defaultThirdCasterProfile,
  isThirdCasterProfile,
  thirdCasterProfileForFeature,
  thirdCasterProfileForPackSubclass,
  type ThirdCasterProfile,
} from "@/lib/srd/third-caster";
import { storedSubclassChoices, type SubclassChoice } from "@/lib/content/subclass-choices";

export type SubclassFeatureRow = { n: string; d: string };

export type ExtraSubclass = {
  name: string;
  levels: Record<string, SubclassFeatureRow[]>;
  // Always-prepared spells by class level (a domain's, an oath's).
  spells?: Record<string, string[]>;
  // Spells added to what the class may learn or prepare, by class level (a
  // patron's expanded list), never granted (issue #833).
  expanded?: Record<string, string[]>;
  // Casts as an Eldritch Knight or Arcane Trickster does (src/lib/srd/
  // third-caster.ts). Read only for a class that casts nothing of its own
  // (src/lib/srd/features.ts subclassCastingProfileFor).
  castingProfile?: ThirdCasterProfile;
  // Spells that hang off an option the player picks (Tome of Heroes'
  // Animal Lords: the air, earth or water column of the lord's affinity),
  // read as the bundled tables' choiceSpells are (src/lib/srd/features.ts).
  choiceSpells?: { feature: string; expanded?: boolean; options: Record<string, Record<string, string[]>> };
  // What its player picks at a class level: a bloodline, an element (src/lib/
  // content/subclass-choices.ts, issue #833). A workshop subclass's only.
  choices?: SubclassChoice[];
  source: "homebrew" | "pack";
};

// By class id.
export type SubclassExtras = Record<string, ExtraSubclass[]>;

// The subclasses the browser fetched or was sent for this person: the
// builder's and the level-up dialog's archetype rows (src/app/characters/
// builder/useBuilderOptions.ts useArchetypes) and the campaign snapshot's
// (useCampaignStream). src/lib/srd/features.ts reads them when a caller
// passes no extras of its own. Set only in the browser, where everything
// fetched is this one person's to see. Kept here, apart from features.ts,
// so the campaign page registers them without loading the class tables
// into its first load (scripts/bundle-budget.json).
const browserExtras: SubclassExtras = {};

export function registerBrowserSubclassExtras(classId: string, tables: SubclassExtras[string]): void {
  if (typeof window === "undefined") {
    return;
  }
  browserExtras[classId] = tables;
}

export function browserSubclassExtras(): SubclassExtras {
  return browserExtras;
}

const ORDINAL = /\b(?:at|beginning at|starting at|when you reach|by|upon reaching|once you reach)\s+(\d{1,2})(?:st|nd|rd|th)\s+level/i;
const LEVEL_ANYWHERE = /\b(\d{1,2})(?:st|nd|rd|th)[- ]level\b/i;

// The features a prose archetype prints under its "#####" headings, each at
// the first level its text names (the class's subclass level when it names
// none). The text kept is the feature's own paragraph, trimmed.
export function subclassLevelsFromProse(desc: string, defaultLevel = 3): Record<string, SubclassFeatureRow[]> {
  const levels: Record<string, SubclassFeatureRow[]> = {};
  // "##### Roar of Defiance", "#####Hellish Aspect" and " ##### Bloodletting
  // Focus" are all headings in the pack's markdown.
  const parts = String(desc ?? "").split(/^\s*#{3,6}\s*/m).slice(1);
  let previous: number | null = null;
  for (const part of parts) {
    const [head, ...rest] = part.split("\n");
    const name = head.replace(/[*_]/g, "").trim().slice(0, 80);
    const body = rest.join("\n").replace(/\s+/g, " ").trim();
    if (!name || !body) {
      continue;
    }
    // The level a feature arrives at is said where it starts ("Starting at
    // 9th level, ...", "When you join the college at 3rd level, ...") or at
    // the head of a sentence ("At 6th level, you can..."). A level named
    // later belongs to something inside it ("you learn another cantrip at
    // 10th level"), and a heading that names none is part of the feature
    // above it: Tome of Heroes' Soulspy prints its Spellcasting's Cantrips
    // and Spell Slots as headings, which arrived at 10th and 1st level.
    const first = body.split(/(?<=[.!?])\s+/)[0];
    const found = ORDINAL.exec(first) ?? SENTENCE_ORDINAL.exec(body);
    const named = LEVEL_ANYWHERE.exec(first);
    const fallback: number | null = previous ?? (named ? Number(named[1]) : null);
    const level: number = found ? Math.min(20, Math.max(1, Number(found[1]))) : (fallback ?? defaultLevel);
    previous = level;
    (levels[String(level)] ??= []).push({ n: name, d: body.slice(0, 500) });
  }
  return levels;
}

const SENTENCE_ORDINAL = /(?:^|[.!?]\s+)(?:at|beginning at|starting at|when you reach|by|upon reaching|once you reach)\s+(\d{1,2})(?:st|nd|rd|th)\s+level/i;

type Row = { name: string; source: string; data: Record<string, unknown> };

// A spell's name as a table cell prints it ("*find familiar* (snakes only)",
// "*longstrider,*"), in the catalog's capitals.
const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with", "without"]);
function spellCellNames(cell: string): string[] {
  return cell
    .replace(/\([^)]*\)/g, " ")
    .replace(/[*_]/g, "")
    .split(/,|;/)
    .map((name) => name.replace(/[^a-z'/ -]/gi, " ").replace(/\s+/g, " ").trim())
    .filter((name) => name && name !== "-")
    .map((name) =>
      name
        .toLowerCase()
        .split(" ")
        .map((word, index) => (index && MINOR_WORDS.has(word) ? word : word.replace(/^[a-z]/, (first) => first.toUpperCase()).replace(/\/[a-z]/, (rest) => rest.toUpperCase())))
        .join(" "),
    );
}

// The spell table a content-pack subclass prints in its prose: a domain's,
// an oath's, a circle's or a conclave's by class level ("| Cleric Level |
// Spells |", "| 3rd | *color spray*, *guiding bolt* |"), always prepared; a
// patron's by spell level ("| Spell Level | Spells |"), added to the spells
// a warlock may learn from the class level that casts that level (1st at 1,
// 2nd at 3, ...). The first spell column only: Tome of Heroes' Animal Lords
// add a column per affinity, a choice this reading cannot make. Several
// tables are a choice too (the Circle of the Land's terrains), and give
// none. A third caster's slots table ("Cantrips Known") is no spell list.
// Without this a pack domain, oath or patron granted none of its spells.
export function proseSpellTables(desc: string): {
  spells?: Record<string, string[]>;
  expanded?: Record<string, string[]>;
  choiceSpells?: ExtraSubclass["choiceSpells"];
} {
  const lines = String(desc ?? "").split("\n");
  const found: Array<{ byspell: boolean; levels: Record<string, string[]>; columns: Record<string, Record<string, string[]>> }> = [];
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
  // A table that sorts named options by an affinity ("| Animal Lord |
  // Affinity | ... |", "| Bat King | Air | ... |"): the pick the affinity
  // columns of the spell table hang off.
  let affinity: { feature: string; of: Record<string, string> } | null = null;
  for (let at = 0; at < lines.length; at += 1) {
    if (!/^\s*\|/.test(lines[at]) || !/^\s*\|[\s|:-]+$/.test(lines[at + 1] ?? "")) continue;
    const head = cells(lines[at]);
    const sorts = head.findIndex((cell, index) => index > 0 && /^affinity$/i.test(cell));
    if (sorts > 0 && head[0]) {
      const of: Record<string, string> = {};
      for (let row = at + 2; row < lines.length && /^\s*\|/.test(lines[row]); row += 1) {
        const line = cells(lines[row]);
        if (line[0] && line[sorts]) of[line[0]] = line[sorts];
      }
      affinity = { feature: head[0], of };
      continue;
    }
    if (!/\blevel\b/i.test(head[0] ?? "") || head.some((cell) => /known|slots|max\.? cr/i.test(cell))) continue;
    const column = head.findIndex((cell, index) => index > 0 && /\bspells\b/i.test(cell));
    if (column < 0) continue;
    const byspell = /^spell level$/i.test(head[0]);
    const levels: Record<string, string[]> = {};
    // Further spell columns named for an affinity ("Air Spells").
    const extra = head.flatMap((cell, index) => {
      const named = /^(\w+) spells$/i.exec(cell);
      return index > column && named ? [{ index, key: named[1].toLowerCase() }] : [];
    });
    const columns: Record<string, Record<string, string[]>> = {};
    for (let row = at + 2; row < lines.length && /^\s*\|/.test(lines[row]); row += 1) {
      const line = cells(lines[row]);
      const ordinal = /^(\d{1,2})/.exec(line[0] ?? "");
      if (!ordinal) continue;
      const level = byspell ? Number(ordinal[1]) * 2 - 1 : Number(ordinal[1]);
      if (level < 1 || level > 20) continue;
      const names = spellCellNames(line[column] ?? "");
      if (names.length) (levels[String(level)] ??= []).push(...names);
      for (const { index, key } of extra) {
        const more = spellCellNames(line[index] ?? "");
        if (more.length) ((columns[key] ??= {})[String(level)] ??= []).push(...more);
      }
    }
    if (Object.keys(levels).length) found.push({ byspell, levels, columns });
  }
  if (found.length !== 1) return {};
  const [table] = found;
  const options = affinity
    ? Object.fromEntries(Object.entries(affinity.of).flatMap(([name, kind]) => (table.columns[kind.toLowerCase()] ? [[name, table.columns[kind.toLowerCase()]]] : [])))
    : {};
  const choiceSpells = affinity && Object.keys(options).length ? { choiceSpells: { feature: affinity.feature, expanded: table.byspell, options } } : {};
  return { ...(table.byspell ? { expanded: table.levels } : { spells: table.levels }), ...choiceSpells };
}

function homebrewLevels(raw: unknown): Record<string, SubclassFeatureRow[]> {
  const out: Record<string, SubclassFeatureRow[]> = {};
  for (const [level, rows] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    const features = rows
      .map((row) => ({ n: String((row as SubclassFeatureRow)?.n ?? "").trim(), d: String((row as SubclassFeatureRow)?.d ?? "") }))
      .filter((row) => row.n);
    if (features.length) {
      out[level] = features;
    }
  }
  return out;
}

function spellLevels(raw: unknown): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const [level, names] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const list = Array.isArray(names) ? names.map((name) => String(name).trim()).filter(Boolean) : [];
    if (list.length) {
      out[level] = list;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// A workshop subclass casts as a third caster when its author said so (the
// Eldritch Knight's rules or the Arcane Trickster's), or, when they said
// nothing, when it holds either one's Spellcasting feature: a copy of
// either, or a subclass that borrowed the feature, casts without a second
// setting to find. "none" is the author turning that off; "third-caster"
// is the first spelling, the class's own.
function castingProfileOf(data: Record<string, unknown>, levels: Record<string, SubclassFeatureRow[]>): ThirdCasterProfile | undefined {
  if (isThirdCasterProfile(data.castingProfile)) {
    return data.castingProfile;
  }
  if (data.castingProfile === "third-caster") {
    return defaultThirdCasterProfile(String(data.classSlug ?? ""));
  }
  if (data.castingProfile === "none") {
    return undefined;
  }
  for (const rows of Object.values(levels)) {
    for (const row of rows) {
      const profile = thirdCasterProfileForFeature(row.n);
      if (profile) {
        return profile;
      }
    }
  }
  return undefined;
}

// The cantrips a pack subclass's features teach by name ("you learn the
// shillelagh cantrip", Tome of Heroes' Old Wood), known from the feature's
// level as a domain's list is: read only for their proficiencies, seven pack
// subclasses taught nothing their text gave. A cantrip "of your choice" is a
// pick, not read here.
const TAUGHT_CANTRIP = /\b(?:you learn|you know|you gain) the ([a-z' ]+?) cantrip\b/g;
function withTaughtCantrips(spells: Record<string, string[]> | undefined, levels: Record<string, SubclassFeatureRow[]>): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = Object.fromEntries(Object.entries(spells ?? {}).map(([level, names]) => [level, [...names]]));
  for (const [level, rows] of Object.entries(levels)) {
    for (const row of rows) {
      for (const found of row.d.toLowerCase().replace(/[*_]/g, "").matchAll(TAUGHT_CANTRIP)) {
        const [name] = spellCellNames(found[1]);
        if (name && !(out[level] ?? []).includes(name)) (out[level] ??= []).push(name);
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// One fetched archetype row as a table, or null when it says nothing a
// grant could use.
// An Open5e v2 archetype row lists its features with the levels they arrive
// at (Black Flag's Metallurgist), and its desc may be only the flavour: read
// as prose, it granted nothing, so the list is read when the prose gives no
// feature. A feature the row repeats at later levels is
// held once, from its first. Null for a row with no such list.
function levelledFeatures(raw: unknown): Record<string, SubclassFeatureRow[]> | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const levels: Record<string, SubclassFeatureRow[]> = {};
  for (const feature of raw as Array<{ name?: unknown; desc?: unknown; levels?: unknown }>) {
    const name = String(feature.name ?? "").trim().slice(0, 80);
    const at = (Array.isArray(feature.levels) ? feature.levels : []).map(Number).filter((level) => Number.isInteger(level) && level >= 1 && level <= 20);
    if (!name || !at.length) {
      continue;
    }
    (levels[String(Math.min(...at))] ??= []).push({ n: name, d: String(feature.desc ?? "").trim() });
  }
  return Object.keys(levels).length ? levels : null;
}

export function extraSubclassOf(row: Row, defaultLevel = 3): ExtraSubclass | null {
  const homebrew = row.source === "homebrew";
  const prose = homebrew ? {} : subclassLevelsFromProse(String(row.data.desc ?? ""), defaultLevel);
  const levels = homebrew
    ? homebrewLevels(row.data.levels)
    : Object.keys(prose).length
      ? prose
      : (levelledFeatures(row.data.features) ?? prose);
  const printed = homebrew ? {} : proseSpellTables(String(row.data.desc ?? ""));
  const spells = homebrew ? spellLevels(row.data.spells) : withTaughtCantrips(printed.spells, levels);
  const expanded = homebrew ? spellLevels(row.data.expanded) : printed.expanded;
  const castingProfile = homebrew ? castingProfileOf(row.data, levels) : (thirdCasterProfileForPackSubclass(row.name) ?? undefined);
  const choices = homebrew ? storedSubclassChoices(row.data.choices) : [];
  if (!Object.keys(levels).length && !spells && !expanded && !choices.length && !printed.choiceSpells) {
    if (!castingProfile) return null;
  }
  return {
    name: row.name,
    levels,
    ...(spells ? { spells } : {}),
    ...(expanded ? { expanded } : {}),
    ...(castingProfile ? { castingProfile } : {}),
    ...(choices.length ? { choices } : {}),
    ...(printed.choiceSpells ? { choiceSpells: printed.choiceSpells } : {}),
    source: homebrew ? "homebrew" : "pack",
  };
}

export function mergeExtras(...sets: SubclassExtras[]): SubclassExtras {
  const out: SubclassExtras = {};
  for (const set of sets) {
    for (const [classId, tables] of Object.entries(set)) {
      out[classId] = [...(out[classId] ?? []), ...tables];
    }
  }
  return out;
}
