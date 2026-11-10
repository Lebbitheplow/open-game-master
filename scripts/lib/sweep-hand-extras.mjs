// The characters of the Hand sweep's extras suites: one per feat, one per
// species, one per item that casts a spell, each beside a baseline without
// it, so only the cards the feat, the species or the item deals are judged
// (scripts/lib/sweep-hand-run.mjs walkBuilds).
import fs from "node:fs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../../src/lib/srd/${name}`, import.meta.url), "utf8"));

// The states that change what a granted card may do; the full matrix is
// walked for every class (test-enforce-sweep-hand-<class>).
export const EXTRA_STATES = ["fresh", "action-spent", "bonus-spent", "reaction-spent", "zero-hp", "silenced", "foe-30ft", "foe-100ft", "out-of-fight", "hit-on-hero", "hit-on-ally", "failed-save"];

const FIGHTER = { classId: "fighter", subclass: "Champion", level: 20 };
const WIZARD = { classId: "wizard", subclass: "School of Evocation", level: 20 };

export const FEAT_BASELINE = { ...FIGHTER, key: "no feat" };
export function featBuilds() {
  const feats = read("authored-feats.json").feats;
  return feats.map((feat) => ({ ...FIGHTER, key: `feat ${feat.name}`, extra: { feats: [feat.name] } }));
}

export const SPECIES_BASELINE = { ...FIGHTER, key: "human" };
export function speciesBuilds() {
  return read("races.json").races.filter((race) => race.id !== "human").map((race) => ({ ...FIGHTER, key: `species ${race.id}`, extra: { race: race.id } }));
}

// Every item the item-spell table names (src/lib/srd/item-spells.ts), read
// from the table's own keys and kept when the table answers for the name;
// then scrolls and a Ring of Spell Storing, which hold what is put in them.
export const ITEM_BASELINE = { ...WIZARD, key: "no item" };
const BASE_GEAR = [{ name: "Quarterstaff", qty: 1, equipped: true }, { name: "Component pouch", qty: 1 }];
export async function itemBuilds() {
  const { itemSpellsOf } = await import(new URL("../../src/lib/srd/item-spells.ts", import.meta.url).href);
  const source = fs.readFileSync(new URL("../../src/lib/srd/item-spells.ts", import.meta.url), "utf8");
  // Each row is keyed by a pattern (/^wand of magic missiles?$/i): a name it
  // matches is made from the pattern itself, and kept only when the table
  // answers for it.
  const made = [...source.matchAll(/\{ item: \/\^?(.+?)\$?\/i,/g)].map((match) =>
    match[1]
      .replace(/\\([()'.])/g, "$1")
      .replace(/\((?:\?:)?([^|()]*)\|[^()]*\)\??/g, "$1")
      .replace(/\(\?:([^()]*)\)\?/g, "")
      .replace(/\[([a-z])[^\]]*\]/g, "$1")
      .replace(/\\s[*+]?/g, " ")
      .replace(/\.\*|[?+*]/g, "")
      .replace(/\s+/g, " ")
      .trim());
  const names = [...new Set(made)].filter((name) => itemSpellsOf(name).length > 0);
  itemBuilds.unreached = made.filter((name) => itemSpellsOf(name).length === 0);
  const title = (name) => name.replace(/(^|[\s(-])([a-z])/g, (all, lead, letter) => `${lead}${letter.toUpperCase()}`).replace(/\b(Of|The|And)\b/g, (word) => word.toLowerCase());
  const builds = names.map((name) => ({ ...WIZARD, key: `item ${title(name)}`, extra: { equipment: [...BASE_GEAR, { name: title(name), qty: 1, attuned: true, equipped: true }] } }));
  const scroll = (spell) => ({ name: `Spell Scroll (${spell})`, qty: 1, tags: ["consumable", "scroll", "carried"], spell });
  for (const spell of ["Fireball", "Cure Wounds", "Shield", "Hold Person", "Bless", "Web"]) {
    builds.push({ ...WIZARD, key: `scroll ${spell}`, extra: { equipment: [...BASE_GEAR, scroll(spell)] } });
  }
  const stored = (spell, level) => ({ spell, level, saveDc: 15, attackBonus: 7, abilityMod: 4, by: "Mage" });
  builds.push({ ...WIZARD, key: "Ring of Spell Storing", extra: { equipment: [...BASE_GEAR, { name: "Ring of Spell Storing", qty: 1, equipped: true, attuned: true, storedSpells: [stored("Hold Person", 2), stored("Fireball", 3), stored("Shield", 1), stored("Cure Wounds", 1)] }] } });
  return builds;
}
