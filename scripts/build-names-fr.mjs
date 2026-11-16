// The official French SRD 5.1 names: src/lib/content/names-fr.ts (the
// tables, by English key) and the item map the engines read
// (src/lib/srd/item-names-fr.ts, French item name to English row).
//
//   node scripts/build-names-fr.mjs                 rebuild the item map
//   node scripts/build-names-fr.mjs --check         fail when the item map is
//                                                   stale or a name is not in
//                                                   the French book
//   node scripts/build-names-fr.mjs --from <dir>    first rewrite names-fr.ts
//                                                   from an extraction folder
//
// In the repository names-fr.ts is the source: a name is corrected there,
// then this script rebuilds the item map from it. The tables were extracted
// from SRD_CC_v5.1_FR.pdf, Wizards of the Coast's official French translation
// of the System Reference Document 5.1 (CC-BY-4.0, docs/LICENSES.md), into one
// JSON per table outside the repository; --from <dir> merges such a folder
// (<table>-fr.json files) into names-fr.ts again. --check reads every name
// against the French book the repository ships
// (src/lib/rulebook/srd-5.1-fr.json, built from the same PDF), so a name that
// is not the print's is caught without the PDF.
//
// Keys follow each table's own convention:
//
// - spells / monsters / species / backgrounds: the row slug ("acid-arrow",
//   "adult-black-dragon");
// - weapons / armor: the Open5e row slug ("crossbow-light", "chain-mail");
// - gear: the gearKey of the SRD gear's English name
//   (src/lib/srd/adventuring-gear.ts): lowercase words, punctuation and
//   apostrophes dropped ("alchemists fire flask");
// - magicItems: the SRD 5.1 magic item's slug ("adamantine-armor"), the same
//   slug the rulebook's item pages carry (srd-5.1.json; "Ammunition, +1, +2,
//   or +3" is "ammunition-1-2-or-3") and the sheet's item rows spell;
// - conditions: the lowercase condition id ("blinded");
// - feats: the feat's slug ("grappler"), the open5e row slug and the slug
//   of the stored English name are the same slugify, so one key serves both.
//   The French SRD 5.1 prints a single feat (« Empoigneur », as the English
//   SRD 5.1 it translates has only Grappler), so the table carries that one.
//   A name from another source (the French SRD 5.2.1, the French editions of
//   the other books, a translation of a content pack's feat) is not the
//   SRD 5.1's, and --check refuses it like any other table's: a feat the
//   table does not carry keeps its English name at a French table;
// - classes: 12 bare class ids ("cleric") plus class-feature keys of the
//   canonical form the render helper slugs a display name to
//   ("cleric:bonus-proficiency-heavy-armor", "cleric:channel-divinity-1-rest",
//   "warlock:invocation-agonizing-blast"): lowercase, punctuation deleted,
//   every other run of non-alphanumeric characters one hyphen;
// - speciesTraits: "<speciesSlug>:<traitNameSlugified>" ("wood-elf:keen-senses"),
//   the species the way srdRaceId spells it, hyphenated;
// - backgroundFeatures: "<backgroundSlug>:<featureNameSlugified>"
//   ("acolyte:shelter-of-the-faithful");
// - subclasses: "<classSlug>:<subclassSlug>" ("cleric:life-domain"), whole
//   name and bare form ("cleric:life").

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const namesFile = join(root, "src", "lib", "content", "names-fr.ts");
const itemFile = join(root, "src", "lib", "srd", "item-names-fr.ts");
const args = process.argv.slice(2);
const check = args.includes("--check");
const fromAt = args.indexOf("--from");
const fromDir = fromAt >= 0 ? args[fromAt + 1] : null;
if (fromAt >= 0 && !fromDir) {
  throw new Error("--from needs the extraction folder that holds the <table>-fr.json files");
}

// table -> export name. names-fr.ts commits every table under the key the
// render helper (src/lib/content/names.ts) unions as a FrNamesTable.
const TABLES = {
  spells: "SPELL_NAMES_FR",
  weapons: "WEAPON_NAMES_FR",
  armor: "ARMOR_NAMES_FR",
  gear: "GEAR_NAMES_FR",
  magicitems: "MAGIC_ITEM_NAMES_FR",
  conditions: "CONDITION_NAMES_FR",
  feats: "FEAT_NAMES_FR",
  species: "SPECIES_NAMES_FR",
  backgrounds: "BACKGROUND_NAMES_FR",
  monsters: "MONSTER_NAMES_FR",
  classes: "CLASS_NAMES_FR",
  classFeatures: "CLASS_FEATURE_NAMES_FR",
  speciesTraits: "SPECIES_TRAIT_NAMES_FR",
  backgroundFeatures: "BACKGROUND_FEATURE_NAMES_FR",
  subclasses: "SUBCLASS_NAMES_FR",
};

const tsLiteral = (value) => JSON.stringify(value);
const record = (name, entries, type = "Record<string, string>") =>
  `export const ${name}: ${type} = {\n${Object.entries(entries)
    .map(([key, value]) => `  ${tsLiteral(key)}: ${tsLiteral(value)},`)
    .join("\n")}\n};\n`;

// The extraction folder's tables written into names-fr.ts, as the
// contributor's own pipeline does after a new extraction.
function writeNamesFrom(dir) {
  const read = (table) => JSON.parse(readFileSync(join(resolve(dir), `${table}-fr.json`), "utf8"));
  // The classes file carries the 12 bare class names beside the feature keys
  // ("cleric:..."), which the extractor wrote into one JSON; split them.
  const classes = {};
  const classFeatures = {};
  for (const [key, name] of Object.entries(read("classes"))) {
    (key.includes(":") ? classFeatures : classes)[key] = name;
  }
  const tables = {
    spells: read("spells"),
    weapons: read("weapons"),
    armor: read("armor"),
    gear: read("gear"),
    magicitems: read("magic-items"),
    conditions: read("conditions"),
    feats: read("feats"),
    species: read("species"),
    backgrounds: read("backgrounds"),
    monsters: read("monsters"),
    classes,
    classFeatures,
    speciesTraits: read("species-traits"),
    backgroundFeatures: read("background-features"),
    subclasses: read("subclasses"),
  };
  const total = Object.values(tables).reduce((sum, entries) => sum + Object.keys(entries).length, 0);
  const counts = Object.fromEntries(Object.entries(tables).map(([table, entries]) => [table, Object.keys(entries).length]));
  const header = `// NOMS OFFICIELS FRANÇAIS du Document de Référence du Système 5.1 de
// Wizards of the Coast (CC-BY-4.0), extraits de SRD_CC_v5.1_FR.pdf : la
// traduction française officielle des noms du SRD 5.1 (sorts, monstres,
// espèces, Historiques, classes et leurs aptitudes, conditions, dons, armes,
// armures, objets magiques et équipement d'aventurier), et elle seule : le
// SRD 5.1 français n'imprime qu'un don (« Empoigneur »), la table des dons
// n'en porte donc qu'un. Un don qu'elle ne porte pas (ceux des autres livres,
// ceux du paquet de contenu) garde son nom anglais à une table francophone.
// Dans le dépôt, ce fichier est la source : corriger un nom ici, puis lancer
// node scripts/build-names-fr.mjs, qui régénère src/lib/srd/item-names-fr.ts
// (--from <dossier> le réécrit depuis les tables d'extraction) ; --check
// vérifie que chaque nom, dons compris, est imprimé dans le livre français.
//
// Les clés suivent la convention de chaque table (voir le script) : le slug
// de la ligne, ou le gearKey du nom anglais, ou "<classe>:<aptitude>" pour
// les aptitudes de classe. L'aide qui les lit est src/lib/content/names.ts.
`;
  const body = [
    ...Object.entries(TABLES).map(([table, name]) => record(name, tables[table])),
    `// The combined lookup the render helper reads, one table at a time. Typed`,
    `// as a plain string-keyed record: the table names are data here, and the`,
    `// narrow union of tables lives in src/lib/content/names.ts.`,
    `export const FR_NAMES_BY_TABLE: Record<string, Record<string, string>> = {`,
    ...Object.keys(TABLES).map((table) => `  ${table}: ${TABLES[table]},`),
    `};`,
    ``,
    `// ${total.toLocaleString("en-US")} official pairs in total, by table.`,
    `export const FR_NAME_COUNTS: Record<string, number> = ${JSON.stringify(counts)};`,
  ].join("\n");
  writeFileSync(namesFile, `${header}\n${body}\n`, "utf8");
  console.log(`names-fr.ts written: ${total} pairs`);
}

if (fromDir) {
  writeNamesFrom(fromDir);
}

// The English tables load the item math, which imports the item map: a
// checkout without one starts from an empty map, which the tables never read.
if (!existsSync(itemFile)) {
  writeFileSync(itemFile, "export const ITEM_EN_BY_FR: Readonly<Record<string, string>> = {};\n", "utf8");
}
const { FR_NAMES_BY_TABLE } = await import(pathToFileURL(namesFile).href);
const { textKey } = await import("../src/lib/language/text-logic.ts");
const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { SRD_ARMOR } = await import("../src/lib/srd/armor-table.ts");
const { SRD_GEAR, SRD_GOODS, gearKey } = await import("../src/lib/srd/adventuring-gear.ts");
const itemTags = JSON.parse(readFileSync(join(root, "src", "lib", "classes", "item-tags.json"), "utf8")).items;
const pagesOf = (file) => JSON.parse(readFileSync(join(root, "src", "lib", "rulebook", file), "utf8")).pages;

// The English row each item table's key names: the weapon and armor tables
// by the slug of their names (the three crossbows are "crossbow-light" in
// Open5e and "Light Crossbow" here), the gear by gearKey, the magic items by
// their item tag row's slug or, for the +1 to +3 families no tag row
// carries, the English book's page title.
const slugKey = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const CROSSBOWS = { "crossbow-light": "light-crossbow", "crossbow-hand": "hand-crossbow", "crossbow-heavy": "heavy-crossbow" };
const weaponBySlug = new Map(SRD_WEAPONS.map((weapon) => [slugKey(weapon.name), weapon.name]));
const armorBySlug = new Map(SRD_ARMOR.map((armor) => [slugKey(armor.name), armor.name]));
const gearByKey = new Map([...SRD_GEAR, ...SRD_GOODS].map((gear) => [gearKey(gear.name), gear.name]));
const tagByGearKey = new Map(itemTags.map(([name]) => [gearKey(name), name]));
const tagBySlug = new Map(itemTags.map(([name, slug]) => [slug.replace(/^srd_/, ""), name]));
const pageTitle = new Map(pagesOf("srd-5.1.json").map((page) => [page.id, page.title]));
const ENGLISH = {
  weapons: (slug) => weaponBySlug.get(CROSSBOWS[slug] ?? slug),
  armor: (slug) => armorBySlug.get(slug),
  gear: (key) => gearByKey.get(key) ?? tagByGearKey.get(key),
  magicitems: (slug) => tagBySlug.get(slug) ?? pageTitle.get(slug),
};

// Every English item name the engines know, so a French name that is also an
// English one is left out: "Lance" is the French Spear and the English Lance,
// and at an English table it stays the Lance.
const englishByKey = new Map(
  [...itemTags.map(([name]) => name), ...SRD_WEAPONS.map((weapon) => weapon.name), ...SRD_ARMOR.map((armor) => armor.name), ...gearByKey.values()].map((name) => [textKey(name), name]),
);

const items = new Map();
const left = [];
for (const [table, englishOf] of Object.entries(ENGLISH)) {
  for (const [key, french] of Object.entries(FR_NAMES_BY_TABLE[table])) {
    const english = englishOf(key);
    if (!english) {
      // Not an item: an armor table row for a class feature or a spell
      // (Unarmored Defense, Mage Armor), the weapon table's Unarmed Strike.
      left.push(`${table} ${key}: no English item row`);
      continue;
    }
    const frenchKey = textKey(french);
    if (frenchKey === textKey(english)) {
      continue; // "Trident" is found as it is.
    }
    const clash = englishByKey.get(frenchKey);
    if (clash && textKey(clash) !== textKey(english)) {
      left.push(`${table} ${key}: "${french}" is the English "${clash}"`);
      continue;
    }
    if (items.has(frenchKey) && items.get(frenchKey) !== english) {
      left.push(`${table} ${key}: "${french}" also names "${items.get(frenchKey)}"`);
      items.set(frenchKey, null);
      continue;
    }
    items.set(frenchKey, english);
  }
}
const sorted = Object.fromEntries([...items].filter(([, english]) => english).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const itemModule = `// GENERATED by scripts/build-names-fr.mjs from src/lib/content/names-fr.ts
// (the official French SRD 5.1 names) and the English item tables. Do not edit
// by hand; correct the name in names-fr.ts and re-run the script.
//
// A French SRD item's name (its textKey) to the English row it is, which
// src/lib/srd/item-row.ts rowName reads when an item carries no srdName, so
// an "Épée longue" or a "Cotte de mailles" a French table writes is its row.
// Its own module, with no imports, because the table page loads it with the
// item math: only the ${Object.keys(sorted).length} item names, never the other tables.
// Left out: a French name that is also an English item's (the French Spear,
// « Lance », stays the English Lance), one spelled the same in both
// languages, and the armor table's rows that are no item.

${record("ITEM_EN_BY_FR", sorted, "Readonly<Record<string, string>>")}`;

const problems = [];
if (check) {
  if (!existsSync(itemFile) || readFileSync(itemFile, "utf8").replace(/\r\n/g, "\n") !== itemModule) {
    problems.push("src/lib/srd/item-names-fr.ts is not what names-fr.ts gives: run node scripts/build-names-fr.mjs");
  }
  // Every name is the French book's: a page title, or words its pages print. The two saddles are sub-rows of « Selle » in the mounts
  // table, printed as "de bât" and "d'équitation" under it.
  const PRINTED_AS_SUBROWS = new Set(["gear saddle pack", "gear saddle riding"]);
  const plain = (text) => text.normalize("NFC").replace(/[‘’ʼ]/g, "'").toLowerCase();
  const book = pagesOf("srd-5.1-fr.json");
  const print = plain(book.map((page) => `${page.title}\n${page.md ?? ""}`).join("\n"));
  const featsPage = plain(book.find((page) => page.id === "feats")?.md ?? "");
  for (const [table, names] of Object.entries(FR_NAMES_BY_TABLE)) {
    for (const [key, french] of Object.entries(names)) {
      // A feat is a heading of the book's Dons page, not a word its pages
      // use: « Mobile » and « Robuste » are printed, but as no feat.
      const printed = table === "feats" ? featsPage.includes(`## ${plain(french)}\n`) : print.includes(plain(french));
      if (!printed && !PRINTED_AS_SUBROWS.has(`${table} ${key}`)) {
        problems.push(`${table} ${key}: "${french}" is not printed in the French book (src/lib/rulebook/srd-5.1-fr.json)`);
      }
    }
  }
} else {
  writeFileSync(itemFile, itemModule, "utf8");
  console.log(`item-names-fr.ts written: ${Object.keys(sorted).length} item names`);
}
for (const line of left) {
  console.log(`left out: ${line}`);
}
if (problems.length) {
  for (const problem of problems) {
    console.error(problem);
  }
  process.exit(1);
}
