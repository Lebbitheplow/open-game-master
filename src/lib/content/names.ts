// An official SRD name in the reader's language, at render time.
//
// The interface's language is client state (src/lib/locale.ts) and the
// server's content routes answer in English, so a name is translated where
// it is displayed: a row's or a stored name is looked up in the official
// French SRD 5.1 names (names-fr.ts, generated from Wizards of the Coast's
// SRD_CC_v5.1_FR.pdf). English is the source and the fallback: a name the
// maps do not carry (a subrace, a homebrew entry, a genre weapon) reads as
// it always did. What reaches the engine, the protocol and the DM's prompts
// stays English: only the words on screen change, the way skillLabel
// (src/lib/srd/index.ts) already works for skills.

import { textKey } from "@/lib/language/text-logic";
type Locale = "en" | "fr";
import { srdRaceId } from "@/lib/srd/race-id";
import { FR_NAMES_BY_TABLE } from "./names-fr";
import { FR_TRANSLATED_NAMES_BY_TABLE } from "./names-fr-translated";

// The tables the maps carry, as the helper's callers name them.
export type FrNamesTable =
  | "spells"
  | "weapons"
  | "armor"
  | "gear"
  | "magicitems"
  | "conditions"
  | "feats"
  | "species"
  | "backgrounds"
  | "monsters"
  | "classes"
  | "classFeatures"
  | "speciesTraits"
  | "backgroundFeatures"
  | "subclasses";

// A content row as the API routes and the library send it, narrowed to the
// fields a name lookup reads.
export type NamedRow = {
  slug?: string;
  name: string;
  source?: string;
};

// The gear table is keyed by the SRD gear's gearKey (adventuring-gear.ts):
// the text key with the apostrophes dropped, so "Alchemist's Fire (flask)"
// is "alchemists fire flask". Kept here rather than imported so the helper
// stays light; the two must move together.
function gearKey(name: string): string {
  return textKey(name.replace(/['‘’ʼ´]/g, ""));
}

// A name as the v1 importer writes a slug: lowercase, every run of
// non-letters a hyphen ("Half Elf" is "half-elf", "half_elf" too). The
// tables' own keys are slugs of this shape (spells, monsters, species,
// backgrounds, classes, features, conditions) or the Open5e row slug
// (weapons, armor).
function slugKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// The canonical form the class-feature, species-trait, background-feature
// and subclass keys are built from, on both sides of the maps: lowercase,
// punctuation deleted (apostrophes, commas, periods, colons, parentheses, as
// a bracket note rides on many a display name), then every run of remaining
// non-alphanumeric characters one hyphen. The generated maps key these
// tables the same way (scripts/build-names-fr.mjs), so a name as it is
// displayed ("Bonus Proficiency (heavy armor)", "Invocation: Agonizing
// Blast") meets the key its table wrote for it.
function canonicalKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’,.;:!?()[\]"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The three crossbows: the app writes "Light Crossbow", Open5e's row slug
// reads "crossbow-light". Every other weapon and armor key is the plain
// slug of the name, so only these three need a bridge.
const WEAPON_KEY_OVERRIDES = new Map<string, string>(
  Object.entries({
    "light-crossbow": "crossbow-light",
    "hand-crossbow": "crossbow-hand",
    "heavy-crossbow": "crossbow-heavy",
  }),
);

// What a carried item is looked up as: the gear first (a rope, a backpack),
// then the weapon and armor tables (a Mace carried is the weapon), and at
// the end the magic items (an Adamantine Armor or a Bag of Holding, keyed by
// the SRD item slug the rulebook's item pages carry). An item the maps do
// not carry stays English.
const ITEM_TABLES: readonly FrNamesTable[] = ["gear", "weapons", "armor", "magicitems"];

// One table's names, by its key. A Map rather than the generated record
// itself: the lookup stays a data read, not a site the tables' key shape
// has to answer for.
const TABLES = new Map<string, Record<string, string>>(Object.entries(FR_NAMES_BY_TABLE));
const TRANSLATED_TABLES = new Map<string, Record<string, string>>(Object.entries(FR_TRANSLATED_NAMES_BY_TABLE));

function lookup(table: FrNamesTable, key: string): string | null {
  if (!key) {
    return null;
  }
  const names = TABLES.get(table);
  if (names) {
    if (table === "weapons") {
      const overridden = WEAPON_KEY_OVERRIDES.get(key);
      if (overridden && names[overridden]) {
        return names[overridden];
      }
    }
    if (names[key]) {
      return names[key];
    }
  }
  return TRANSLATED_TABLES.get(table)?.[key] ?? null;
}

// The keys a table tries, in order: a row's own slug first (a third-party
// document may slugify differently, and the row's slug is what its pack
// calls it: the pack's rows are homebrew or a translation the pack made,
// and neither is translated here), then the name as the tables spell it.
function keysFor(table: FrNamesTable, row: NamedRow): string[] {
  if (table === "gear") {
    // A pack row's slug ("alchemists-fire-flask") reads as a gearKey with
    // its hyphens as spaces, so both spellings are tried.
    return [
      gearKey(row.name),
      ...(row.slug ? [slugKey(row.slug).replace(/-/g, " ")] : []),
    ];
  }
  return [...(row.slug ? [slugKey(row.slug)] : []), slugKey(row.name)];
}

// An official name beside its English one. `ref` is a content row (matched
// by its slug, its English name, and never when the row is homebrew) or a
// stored English name (matched by slug or gearKey). `table` is one of the
// maps' tables, or "items" for the sheet's carried gear, which reads gear,
// weapons and armor. Returns the name unchanged unless the locale's map
// carries it.
export function contentName(
  table: FrNamesTable | "items",
  ref: NamedRow | string,
  locale: Locale,
): string {
  const row: NamedRow = typeof ref === "string" ? { name: ref } : ref;
  if (locale !== "fr" || !row.name || (row.source && row.source !== "open5e")) {
    return row.name;
  }
  const tables: readonly FrNamesTable[] = table === "items" ? ITEM_TABLES : [table];
  for (const each of tables) {
    for (const key of keysFor(each, row)) {
      const hit = lookup(each, key);
      if (hit) {
        return hit;
      }
    }
  }
  return row.name;
}

// A class feature's name ("Channel Divinity: Turn Undead", "Bonus
// Proficiency (heavy armor)") in the reader's language: the maps key a
// feature by its class and the feature's display name in the canonical form
// ("cleric:bonus-proficiency-heavy-armor"). A feature the class's map does
// not carry (an artificer's, as the French SRD does not print the class, or a
// workshop class's) stays English.
export function classFeatureName(classId: string, featureName: string, locale: Locale): string {
  if (locale !== "fr" || !featureName) {
    return featureName;
  }
  const key = `${classId.trim().toLowerCase()}:${canonicalKey(featureName)}`;
  return FR_NAMES_BY_TABLE.classFeatures[key] ?? featureName;
}

// A species trait line ("Darkvision 60 ft", "Perception proficiency (Keen
// Senses)", "+1 HP per level (Dwarven Toughness)") in the reader's language:
// the maps key a trait by its species and the trait's name
// ("wood-elf:keen-senses"), and the line's name is the whole line, the words
// before a trailing bracket note, or the note itself, whichever the map
// carries. Whatever is not the name rides along untranslated ("60 ft",
// "+1 HP per level"): it is the app's own shorthand, and only the official
// name is translated. A trait the species's map does not carry (the French
// SRD prints the subraces' own traits for some peoples only) stays English.
function localizeTraitTail(tail: string): string {
  return tail
    .replace(/\badv\. vs poison\b/gi, "avant. c/ poison")
    .replace(/\b(\d+)\s*ft\b/gi, "$1 pi")
    .replace(/\blight and medium armor\b/gi, "armures légères et intermédiaires")
    .replace(/\bbattleaxe\b/gi, "hache d’armes")
    .replace(/\bhandaxe\b/gi, "hachette")
    .replace(/\blight hammer\b/gi, "marteau léger")
    .replace(/\bwarhammer\b/gi, "marteau de guerre")
    .replace(/\blongsword\b/gi, "épée longue")
    .replace(/\bshortsword\b/gi, "épée courte")
    .replace(/\blongbow\b/gi, "arc long")
    .replace(/\bshortbow\b/gi, "arc court")
    .replace(/\brapier\b/gi, "rapière");
}

export function speciesTraitName(raceId: string, traitLine: string, locale: Locale): string {
  if (locale !== "fr" || !traitLine) {
    return traitLine;
  }
  const traits = FR_NAMES_BY_TABLE.speciesTraits;
  const extraTraits = FR_TRANSLATED_NAMES_BY_TABLE.speciesTraits ?? {};
  const species = canonicalKey(srdRaceId(raceId));
  const carries = (name: string) => {
    const k = `${species}:${canonicalKey(name)}`;
    return traits[k] ?? extraTraits[k];
  };
  const whole = carries(traitLine);
  if (whole) {
    return whole;
  }
  const bracketed = /\s*\(([^()]*)\)\s*$/.exec(traitLine);
  if (bracketed) {
    const head = traitLine.slice(0, bracketed.index);
    const after = localizeTraitTail(traitLine.slice(bracketed.index));
    const headHit = carries(head);
    if (headHit) {
      return `${headHit}${after}`;
    }
    const noted = carries(bracketed[1]);
    if (noted) {
      return `${head} (${noted})`;
    }
  }
  // A trailing measurement the trait's name does not carry
  // ("Darkvision 60 ft" is "Darkvision").
  const measured = /\s+\d[^)]*$/.exec(traitLine);
  if (measured) {
    const bare = carries(traitLine.slice(0, measured.index));
    if (bare) {
      return `${bare}${localizeTraitTail(traitLine.slice(measured.index))}`;
    }
  }
  return localizeTraitTail(traitLine);
}

// A background's granted feature as the sheet carries it ("Shelter of the
// Faithful (Acolyte)") in the reader's language: the maps key a feature by
// its background and the feature's name ("acolyte:shelter-of-the-faithful"),
// and the background's own name rides along through the backgrounds map. A
// feature the map does not carry (the French SRD prints one background as an
// example) stays English.
export function backgroundFeatureName(featureName: string, locale: Locale): string {
  if (locale !== "fr" || !featureName) {
    return featureName;
  }
  const bracketed = /\s*\(([^()]*)\)\s*$/.exec(featureName);
  if (!bracketed) {
    return featureName;
  }
  const feature = featureName.slice(0, bracketed.index);
  const background = bracketed[1];
  const bgKey = `${canonicalKey(background)}:${canonicalKey(feature)}`;
  const hit =
    FR_NAMES_BY_TABLE.backgroundFeatures[bgKey] ??
    FR_TRANSLATED_NAMES_BY_TABLE.backgroundFeatures?.[bgKey];
  if (!hit) {
    return featureName;
  }
  return `${hit} (${contentName("backgrounds", background, locale)})`;
}

// A background feature's translated name when the background is already known
// from surrounding context (e.g. BackgroundPanel).
export function backgroundFeatureLabel(backgroundName: string, feature: string, locale: Locale): string {
  if (locale !== "fr" || !feature) {
    return feature;
  }
  const bgKey = `${canonicalKey(backgroundName)}:${canonicalKey(feature)}`;
  return (
    FR_NAMES_BY_TABLE.backgroundFeatures[bgKey] ??
    FR_TRANSLATED_NAMES_BY_TABLE.backgroundFeatures?.[bgKey] ??
    feature
  );
}

// A subclass as the sheet stores it ("Life Domain", "life", "Evocation")
// in the reader's language: the maps key a subclass by its class and its
// name, whole or bare ("cleric:life-domain", "cleric:life"). A subclass the
// map does not carry (a workshop or pack archetype) stays as it was stored.
export function subclassName(classId: string, subclass: string, locale: Locale): string {
  if (locale !== "fr" || !subclass) {
    return subclass;
  }
  const key = `${classId.trim().toLowerCase()}:${canonicalKey(subclass)}`;
  return FR_NAMES_BY_TABLE.subclasses[key] ?? subclass;
}
