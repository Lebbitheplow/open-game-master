import type { HomebrewKind } from "@/lib/schemas/homebrew";
import type { SheetRenamer } from "@/lib/homebrew/sheet-refs";

// The other Homebrew entries one entry names inside its own data, by name:
// a subclass's always-prepared spells, the spells a magic item casts, the
// kit lines a background hands out. (A subclass's class is held by id,
// src/lib/homebrew/class-data.ts, and travels apart.)
//
// The same three callers as the sheet's list (src/lib/homebrew/sheet-refs.ts)
// read these: a rename carries them, a bundle's renamed arrivals are named
// through them, and "only what this workshop uses" follows them, so a
// subclass that grants a spell at level 5 brings the spell along.

type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : []);

// The spells each option of a subclass's choices grants (issue #833), by
// class level as the subclass's own are.
const choiceOptions = (data: Rec): Rec[] =>
  (Array.isArray(data.choices) ? data.choices.filter(isRec) : []).flatMap((choice) => (Array.isArray(choice.options) ? choice.options.filter(isRec) : []));

// A subclass's spells by level: the always-prepared ones and the ones it
// adds to its class's list (issue #833).
const SUBCLASS_SPELL_FIELDS = ["spells", "expanded"] as const;

// A species' spell groups (issue #833): its own and each option's, every
// row naming its spell.
function raceSpellGroups(data: Rec): Rec[] {
  const options = isRec(data.variants) && Array.isArray(data.variants.options) ? data.variants.options.filter(isRec) : [];
  return [data.spells, ...options.map((option) => option.spells)].filter(isRec);
}
const groupSpells = (group: Rec): string[] =>
  Array.isArray(group.spells) ? group.spells.filter(isRec).flatMap((row) => (typeof row.spell === "string" ? [row.spell] : [])) : [];

export function homebrewDataRefs(kind: HomebrewKind, data: Rec): { spell: string[]; item: string[] } {
  if (kind === "race") {
    return { spell: [...new Set(raceSpellGroups(data).flatMap(groupSpells))], item: [] };
  }
  if (kind === "archetype") {
    const tables = [
      ...SUBCLASS_SPELL_FIELDS.flatMap((field) => (isRec(data[field]) ? [data[field] as Rec] : [])),
      ...choiceOptions(data).flatMap((option) => (isRec(option.spells) ? [option.spells] : [])),
    ];
    return { spell: [...new Set(tables.flatMap((table) => Object.values(table).flatMap(strings)))], item: [] };
  }
  // A class's list of its own names its spells, homebrew ones among them.
  if (kind === "class" && Array.isArray(data.spellList)) {
    return { spell: [...new Set(strings(data.spellList))], item: [] };
  }
  if (kind === "item" && Array.isArray(data.spells)) {
    return { spell: [...new Set(data.spells.filter(isRec).flatMap((entry) => (typeof entry.spell === "string" ? [entry.spell] : [])))], item: [] };
  }
  if (kind === "background" && isRec(data.grants)) {
    return { spell: [], item: [...new Set(strings(data.grants.equipment))] };
  }
  return { spell: [], item: [] };
}

// The data with every name the renamer changes written under its new name,
// and whether anything changed. A background's prose kit line is written
// from its grants, so the caller normalizes the data again after a change
// (src/lib/homebrew/gear.ts normalizeHomebrewData).
export function renameHomebrewDataRefs(kind: HomebrewKind, data: Rec, rename: SheetRenamer): { data: Rec; changed: boolean } {
  let changed = false;
  const to = (refKind: "spell" | "item", name: string) => {
    const next = rename(refKind, name);
    if (next !== name) changed = true;
    return next;
  };
  if (kind === "race") {
    const renamed = (group: unknown) =>
      isRec(group) && Array.isArray(group.spells)
        ? { ...group, spells: group.spells.map((row) => (isRec(row) && typeof row.spell === "string" ? { ...row, spell: to("spell", row.spell) } : row)) }
        : group;
    const next: Rec = { ...data, ...(data.spells !== undefined ? { spells: renamed(data.spells) } : {}) };
    if (isRec(data.variants) && Array.isArray(data.variants.options)) {
      next.variants = { ...data.variants, options: data.variants.options.map((option) => (isRec(option) && option.spells !== undefined ? { ...option, spells: renamed(option.spells) } : option)) };
    }
    return changed ? { data: next, changed } : { data, changed };
  }
  if (kind === "archetype") {
    const byLevel = (table: Rec) =>
      Object.fromEntries(
        Object.entries(table).map(([level, names]) => [level, Array.isArray(names) ? names.map((name) => (typeof name === "string" ? to("spell", name) : name)) : names]),
      );
    const next: Rec = { ...data };
    for (const field of SUBCLASS_SPELL_FIELDS) {
      if (isRec(data[field])) next[field] = byLevel(data[field] as Rec);
    }
    if (Array.isArray(data.choices)) {
      next.choices = data.choices.map((choice) =>
        isRec(choice) && Array.isArray(choice.options)
          ? { ...choice, options: choice.options.map((option) => (isRec(option) && isRec(option.spells) ? { ...option, spells: byLevel(option.spells) } : option)) }
          : choice,
      );
    }
    return changed ? { data: next, changed } : { data, changed };
  }
  if (kind === "class" && Array.isArray(data.spellList)) {
    const spellList = data.spellList.map((name) => (typeof name === "string" ? to("spell", name) : name));
    return changed ? { data: { ...data, spellList }, changed } : { data, changed };
  }
  if (kind === "item" && Array.isArray(data.spells)) {
    const spells = data.spells.map((entry) => (isRec(entry) && typeof entry.spell === "string" ? { ...entry, spell: to("spell", entry.spell) } : entry));
    return changed ? { data: { ...data, spells }, changed } : { data, changed };
  }
  if (kind === "background" && isRec(data.grants) && Array.isArray(data.grants.equipment)) {
    const equipment = data.grants.equipment.map((line) => (typeof line === "string" ? to("item", line) : line));
    return changed ? { data: { ...data, grants: { ...data.grants, equipment } }, changed } : { data, changed };
  }
  return { data, changed: false };
}

// A hand-built monster's spells, by name: the list its stat block prints and
// the spellcasting block's own (src/lib/bestiary/monster-draft.ts), so a
// creature that casts a homebrew spell brings the spell and follows it.
export function monsterStatsSpells(stats: unknown): string[] {
  if (!isRec(stats)) return [];
  const casting = isRec(stats.spellcasting) && Array.isArray(stats.spellcasting.spells) ? stats.spellcasting.spells.filter(isRec) : [];
  return [...new Set([...strings(stats.spells), ...casting.flatMap((spell) => (typeof spell.name === "string" ? [spell.name] : []))])];
}

export function renameMonsterStatsSpells<T>(stats: T, rename: SheetRenamer): { stats: T; changed: boolean } {
  if (!isRec(stats)) return { stats, changed: false };
  let changed = false;
  const to = (name: string) => {
    const next = rename("spell", name);
    if (next !== name) changed = true;
    return next;
  };
  const next: Rec = { ...stats };
  if (Array.isArray(next.spells)) next.spells = next.spells.map((name) => (typeof name === "string" ? to(name) : name));
  if (isRec(next.spellcasting) && Array.isArray(next.spellcasting.spells)) {
    next.spellcasting = {
      ...next.spellcasting,
      spells: next.spellcasting.spells.map((spell) => (isRec(spell) && typeof spell.name === "string" ? { ...spell, name: to(spell.name) } : spell)),
    };
  }
  return changed ? { stats: next as T, changed } : { stats, changed: false };
}
