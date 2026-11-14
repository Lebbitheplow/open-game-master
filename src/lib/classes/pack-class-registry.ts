// A content pack's own classes (Black Flag's Mechanist), as feature tables
// the engines grant by level. ODM carries tables for the SRD's classes, the
// artificer and the setting classes; a pack class had none, so a Mechanist
// was offered in the builder and stored with no class feature at any level,
// no subclass step and no Multiattack.
//
// Open5e's v2 class rows list each feature with the levels it arrives at
// (`features: [{ name, desc, levels }]`); that list is the table. The rows
// that are not features (the proficiency and equipment notes, the table's
// column data, the Ability Score Improvement, which src/lib/srd/asi.ts
// counts by level) are left out.
//
// The server registers every pack class when the pack opens
// (src/lib/content/db.ts), the browser the ones its pages were sent (the
// builder's class rows, the table's snapshot). Its own module with nothing
// heavy behind it, as workshop-registry.ts is.

import { textKey } from "@/lib/language/text-logic";

export type PackClassTable = {
  id: string;
  // The class level the subclass is chosen at.
  subclassLevel: number;
  // Feature names by the class level they arrive at.
  levels: Record<string, string[]>;
  // Each feature's words, by its name (textKey), for the sheet's help and
  // the storyteller's prompt.
  text: Record<string, string>;
};

const PACK_CLASSES = new Map<string, PackClassTable>();

// Rows of a class's feature list that are notes about the class, not
// features a character holds.
const NOT_FEATURES = /^(?:proficiency bonus|proficiencies|equipment|starting equipment|ability score improvements?|improvement|hit points)$/i;

// The feature that asks for the subclass ("Mechanist Subclass", "Marshal
// Archetype"): its level is the class's subclass level.
const SUBCLASS_STEP = /\b(?:subclass|archetype)$/i;

type RowFeature = { name?: unknown; desc?: unknown; levels?: unknown };

// A v2 class row's table, or null for a row with no levelled features.
export function packClassTableFrom(id: string, data: Record<string, unknown>): PackClassTable | null {
  const features = Array.isArray(data.features) ? (data.features as RowFeature[]) : [];
  const levels: Record<string, string[]> = {};
  const text: Record<string, string> = {};
  let subclassLevel: number | null = null;
  for (const feature of features) {
    const name = String(feature.name ?? "").trim();
    const desc = String(feature.desc ?? "").trim();
    const at = (Array.isArray(feature.levels) ? feature.levels : [])
      .map(Number)
      .filter((level) => Number.isInteger(level) && level >= 1 && level <= 20);
    if (!name || !at.length || NOT_FEATURES.test(name) || !desc || /^\[column data\]$/i.test(desc)) {
      continue;
    }
    // A feature the table repeats (Extra Attack at 5th and 11th) is held
    // once, from the first level it arrives at.
    const first = Math.min(...at);
    if (SUBCLASS_STEP.test(name)) {
      subclassLevel = subclassLevel === null ? first : Math.min(subclassLevel, first);
    }
    const key = textKey(name);
    if (text[key] !== undefined) {
      continue;
    }
    text[key] = desc;
    (levels[String(first)] ??= []).push(name);
  }
  if (!Object.keys(levels).length) {
    return null;
  }
  return { id, subclassLevel: subclassLevel ?? 3, levels, text };
}

// `replace`: the whole list (the server's, as the pack opens); otherwise
// added to what is held (the browser's, as pages send them).
export function registerPackClasses(tables: readonly PackClassTable[], options: { replace?: boolean } = {}): void {
  if (options.replace) {
    PACK_CLASSES.clear();
  }
  for (const table of tables) {
    PACK_CLASSES.set(table.id, table);
  }
}

export function packClassTable(id: string): PackClassTable | null {
  return PACK_CLASSES.get(id) ?? null;
}

// The registered ones these ids name, for a page to send on.
export function packClassTables(ids: readonly string[]): PackClassTable[] {
  return [...new Set(ids)].flatMap((id) => PACK_CLASSES.get(id) ?? []);
}

// Whether a feature's words say it is an Extra Attack under another name
// ("you can make two attacks when you take the Attack action", Black Flag's
// Multiattack): how many attacks beyond the first, or 0.
export function extraAttacksIn(desc: string): number {
  const match = /\b(?:make|attack) (two|three|four) (?:attacks|times)\b[^.]*\bAttack action\b|\bAttack action[^.]*\b(?:make|attack) (two|three|four) (?:attacks|times)\b/i.exec(desc);
  const word = (match?.[1] ?? match?.[2] ?? "").toLowerCase();
  return { two: 1, three: 2, four: 3 }[word as "two" | "three" | "four"] ?? 0;
}
