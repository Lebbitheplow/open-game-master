// The official Italian names of the SRD 5.1's things (spells, creatures,
// magic items, gear, rules terms), from Wizards of the Coast's own Italian
// SRD 5.1 by scripts/generate-it-srd-names.mjs. Two readers:
//
// - the glossary an Italian table's prose calls get beside the language
//   directive, so the narrator calls a Magic Missile a "Dardo incantato" every
//   turn, as the Italian books do, instead of a new translation each time;
// - the item lookup (src/lib/srd/item-tags.ts itemRow), where an official
//   Italian name, whole, finds the same row as the English one.
//
// English stays the engine's name for everything: an Italian name is only
// another way to find the English row, never a row of its own. A name two
// different English things share in Italian finds nothing, as an unknown
// name does. Pure, so scripts can load it directly.

import namesJson from "./srd-names-it.json";
import { textKey } from "./text-logic";

type Names = Record<string, string>;
const NAMES = namesJson as unknown as {
  spells: Names;
  creatures: Names;
  magicItems: Names;
  weapons: Names;
  armor: Names;
  gear: Names;
  rules: Record<string, Names>;
};

const ITEM_GROUPS: readonly Names[] = [NAMES.magicItems, NAMES.weapons, NAMES.armor, NAMES.gear];
const ALL_GROUPS: readonly Names[] = [NAMES.spells, NAMES.creatures, ...ITEM_GROUPS, ...Object.values(NAMES.rules)];

// English name -> its Italian names (more than one when two categories
// translate one English word differently).
const ITALIAN = new Map<string, string[]>();
for (const group of ALL_GROUPS) {
  for (const [english, italian] of Object.entries(group)) {
    const known = ITALIAN.get(english) ?? [];
    if (!known.includes(italian)) {
      ITALIAN.set(english, [...known, italian]);
    }
  }
}

// The same, by the English name's key: "scimitar" reads as "Scimitar".
const ITALIAN_BY_KEY = new Map<string, string[]>();
for (const [english, italian] of ITALIAN) {
  const key = textKey(english);
  const known = ITALIAN_BY_KEY.get(key) ?? [];
  ITALIAN_BY_KEY.set(key, [...known, ...italian.filter((name) => !known.includes(name))]);
}

// An item's Italian key -> its English name, or null when two English items
// share the Italian name.
const ITEM_BY_ITALIAN = new Map<string, string | null>();
for (const group of ITEM_GROUPS) {
  for (const [english, italian] of Object.entries(group)) {
    const key = textKey(italian);
    const seen = ITEM_BY_ITALIAN.get(key);
    ITEM_BY_ITALIAN.set(key, seen === undefined || seen === english ? english : null);
  }
}

// An item's English name from its official Italian name, whole: "Spada lunga"
// is the Longsword, "Spada" nothing. A magic bonus before or after the name
// stays with it ("Spada lunga +1" is "Longsword +1"). Undefined for a name the
// Italian SRD does not give, or gives two English items.
export function englishItemName(name: string): string | undefined {
  const whole = ITEM_BY_ITALIAN.get(textKey(name));
  if (whole !== undefined) {
    return whole ?? undefined;
  }
  const bonus = /^\s*(\+[1-3])\s+(.+)$/u.exec(name) ?? /^(.+?)\s+(\+[1-3])\s*$/u.exec(name);
  if (!bonus) {
    return undefined;
  }
  const [base, plus] = bonus[1].startsWith("+") ? [bonus[2], bonus[1]] : [bonus[1], bonus[2]];
  const english = ITEM_BY_ITALIAN.get(textKey(base));
  return english ? `${english} ${plus}` : undefined;
}

// A thing's official Italian name from its English one, whole, for the
// server's own lines on an Italian page: "Scimitar" is "Scimitarra", "Bandit
// 2" "Bandito 2", "Longsword +1" "Spada lunga +1". Undefined for a name the
// Italian SRD does not give or translates two ways.
export function italianName(english: string): string | undefined {
  const one = (name: string) => {
    const italian = ITALIAN_BY_KEY.get(textKey(name));
    return italian?.length === 1 ? italian[0] : undefined;
  };
  const whole = one(english);
  if (whole !== undefined) {
    return whole;
  }
  // A count or a magic bonus after the name stays with it.
  const tail = /^(.+?)(\s+(?:\+[1-3]|\d+))$/u.exec(english);
  const base = tail ? one(tail[1]) : undefined;
  return base !== undefined && tail ? base + tail[2] : undefined;
}

// Every English name with an Italian name of its own, longest first, so
// "Potion of Greater Healing" is read before "Healing".
let pattern: RegExp | null = null;
function englishNames(): RegExp {
  if (!pattern) {
    const names = [...ITALIAN.entries()]
      .filter(([english, italian]) => italian.some((name) => name !== english))
      .map(([english]) => english)
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  }
  return pattern;
}

// At most this many lines: a long prompt that names half the bestiary should
// not double in size for it.
const GLOSSARY_LIMIT = 80;

// The glossary for a prompt: the English rules names it holds, as written
// there, each with its official Italian name. Empty when it names none.
export function italianGlossary(text: string): string {
  const found: string[] = [];
  for (const match of text.matchAll(englishNames())) {
    if (!found.includes(match[0])) {
      found.push(match[0]);
    }
    if (found.length >= GLOSSARY_LIMIT) {
      break;
    }
  }
  if (!found.length) {
    return "";
  }
  const lines = found.map((english) => `- ${english} → ${(ITALIAN.get(english) ?? []).join(" / ")}`);
  return [
    "OFFICIAL ITALIAN NAMES (from the Italian SRD 5.1): in what the players read, call these things by their Italian name below. In tool arguments and every field the game matches, keep the English name.",
    ...lines,
  ].join("\n");
}
