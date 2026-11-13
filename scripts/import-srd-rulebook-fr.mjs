// Builds the French rulebook (src/lib/rulebook/srd-5.1-fr.json): the same
// book as srd-5.1.json — same page ids, same order, same chapters and parts —
// with the pages, titles and meta lines of the official French print,
// Wizards of the Coast's « Document de Référence du Système 5.1 »
// (SRD_CC_v5.1_FR.pdf, CC-BY-4.0; see docs/LICENSES.md).
//
// The French text comes from the extraction waves (the two-column PDF parsed
// page by page and verified structurally against the English book, page for
// page):
//
//   <tools>/waves/phb/*.md                 chapters I-IX (41 pages)
//   <tools>/waves/spells/*.md              spellcasting + 319 spells (321)
//   <tools>/waves/items/*.md               the 239 magic items
//   <tools>/waves/monsters/{monsters,creatures,npcs,rules}/*.md
//                                          chapters XII-XVII (329)
//
// where <tools> is the rulebook-fr extraction workspace beside the repo
// (../tools/rulebook-fr; override with ODM_RULEBOOK_FR_DIR). The per-page
// alignment (EN page id → FR printed title, FR pdf page) is
// <tools>/data/manifest-alignment.tsv; the 239 item titles come from the
// verified pairs in scripts/data/fr-names/magic-items-fr.json.
//
// Every English page has a French print: the magic items chapter's three
// rules pages (`magic-items`, `sentient-magic-items`, `artifacts`; FR pdf
// pp. 225-227, 278-280) were extracted after the main waves and live in
// waves/monsters/rules/ beside the other rules pages. The loader
// (src/lib/rulebook/book.ts) still falls back to the English page were a
// wave file ever to go missing, in the same binding position, so folios,
// bookmarks and neighbours never move. The script refuses to run if the
// waves' coverage differs from the manifest.
//
// Page markdown keeps the print as extracted; the `<!-- CHECK -->` comments
// the waves carry (missing FR table captions, print quirks — ~80 sites) stay
// in the wave sources and are stripped here, their EN-title behavior being
// the agreed one. Unlike the English import there is no ERRATA list: the
// French prose is quoted, not re-converted.
//
// Usage: node scripts/import-srd-rulebook-fr.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const enPath = join(root, "src", "lib", "rulebook", "srd-5.1.json");
const outPath = join(root, "src", "lib", "rulebook", "srd-5.1-fr.json");
const tools = process.env.ODM_RULEBOOK_FR_DIR || join(root, "..", "tools", "rulebook-fr");
const tsvPath = join(tools, "data", "manifest-alignment.tsv");
const waves = join(tools, "waves");

// The wave folder each EN page's French print lives in, in the order the
// folders are tried (a page filed as rules rather than as an entry — the
// half-dragon template, customizing-npcs — is found by the second candidate).
function waveFolderFor(enId, chapter, kind) {
  const rules = ["monsters/rules"];
  switch (chapter) {
    case "magic-items":
      return kind === "item" ? ["items", ...rules] : rules;
    case "monsters":
      return ["monsters/monsters", ...rules];
    case "creatures":
      return ["monsters/creatures", ...rules];
    case "npcs":
      return ["monsters/npcs", ...rules];
    case "running-the-game":
    case "appendix":
      return rules;
    case "spellcasting":
    case "spells":
      return ["spells"];
    default:
      // Chapters I-IX: the phb wave (races, classes, equipment, ...).
      return ["phb"];
  }
}

// The TSV's fr_printed_title column quotes the print, but a few rows append
// the locator's own note. These ten are the printed titles, read off the PDF:
// the five art chapters' names are the official French SRD naming
// (vector art carries no text; « Aventure » and « Combat » are confirmed by
// the print's own cross-references on FR pdf p. 2), the annexes keep the
// printed « Annexe … » forms, and the rest are the printed section headings.
const TITLE_FIX = {
  backgrounds: "Historiques",
  coinage: "Pièces de monnaie",
  armor: "Armures",
  weapons: "Armes",
  adventuring: "Aventure",
  combat: "Combat",
  "monster-statistics": "Monstres",
  "nonplayer-characters": "Personnages non-joueurs",
  "legal-information": "Informations juridiques",
  // The chapter-opening rules page; the TSV row annotates its sections.
  "magic-items": "Objets magiques",
};

// The book's chapters, as the FR print names them. Chapter ids, numerals,
// page lists and the part binding stay the English book's exactly.
const CHAPTER_TITLES = {
  races: "Races", // printed, FR pdf p. 2
  classes: "Classes", // vector art; the official French SRD naming
  "beyond-1st-level": "Au-delà du niveau 1", // printed, p. 59
  personality: "Personnalité et historique", // vector art; official naming
  equipment: "Équipement", // printed, p. 66
  feats: "Dons", // printed, p. 82
  "ability-scores": "Utiliser les valeurs de caractéristique", // printed, p. 83
  adventuring: "Aventure", // vector art; confirmed by the print's own cross-reference (« Aventure »), p. 2
  combat: "Combat", // vector art; confirmed by the print's own cross-reference (« Combat »), p. 2
  spellcasting: "Sorts", // printed, p. 110
  spells: "Description des sorts", // printed, p. 124
  "running-the-game": "Conduite du jeu", // vector art; official naming
  "magic-items": "Objets magiques", // printed, p. 225
  monsters: "Monstres", // printed, p. 281
  creatures: "Créatures diverses", // printed « Annexe MdM-A : Créatures diverses », p. 405
  npcs: "Personnages non-joueurs", // printed « Annexe MdM-B : Personnages non-joueurs », p. 437
  appendix: "Annexes", // the FR print binds these as « Annexe MdJ-A/B/C » and the legal page; no single title is printed
};

// The three books' French words: the parts are this app's own binding (the
// FR PDF prints no part titles), so they carry the French the book's chrome
// already reads — the rulebook.part.* message values' text.
const PART_TITLES = { players: "Joueurs", "dungeon-master": "Le maître du jeu", monsters: "Monstres" };
const PART_BLURBS = {
  players: "Le Manuel des joueurs, pour tout ce que le SRD en ouvre : créer un héros, jouer, et tous les sorts.",
  "dungeon-master": "Le Guide du Maître, pour tout ce que le SRD en ouvre : les pièges à mener et tous les objets magiques.",
  monsters: "Le Manuel des monstres, pour tout ce que le SRD en ouvre : tous les blocs de stats, les bêtes, et les gens du monde.",
};

// The spells chapter groups by level, cantrips first, as the print names
// them (« Sorts mineurs (niveau 0) », « 2e niveau »).
const LEVEL_GROUPS_FR = ["Sorts mineurs", "Niveau 1", "Niveau 2", "Niveau 3", "Niveau 4", "Niveau 5", "Niveau 6", "Niveau 7", "Niveau 8", "Niveau 9"];
const LEVEL_GROUPS_EN = ["Cantrips", "1st Level", "2nd Level", "3rd Level", "4th Level", "5th Level", "6th Level", "7th Level", "8th Level", "9th Level"];

// No page is missing any more: the magic-items chapter's three rules pages
// (`magic-items`, `sentient-magic-items`, `artifacts`; FR pdf pp. 225-227,
// 278-280) were extracted after the waves, and the loader keeps the English
// fallback for a page only if its file is absent.
const KNOWN_MISSING = [];

// The first italic line of an entry: « Invocation du 9e niveau »,
// « Humanoïde (gobelin) de taille P, neutre mauvais »,
// « Armure (intermédiaire ou lourde, sauf armure de peaux), peu courante ».
function metaLine(markdown) {
  const match = /^\*([^*\n]+)\*\s*$/m.exec(markdown);
  return match ? match[1].trim() : undefined;
}

function spellLevel(meta) {
  if (/sort mineur/i.test(meta)) return 0;
  const match = /\bdu\s+(\d)\s*(?:er|e|è?me)?\s*niveau/i.exec(meta);
  return match ? Number(match[1]) : undefined;
}

// The wave markdown, cleaned for the book: the `<!-- CHECK … -->` comments
// stay in the wave sources only, no line keeps its trailing spaces, and no
// three blank lines in a row. The prose itself is quoted as extracted.
function tidy(markdown) {
  return markdown
    .replace(/<!--\s*CHECK[\s\S]*?-->\n?/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const en = JSON.parse(readFileSync(enPath, "utf8"));
const enById = new Map(en.pages.map((page) => [page.id, page]));

const itemNames = JSON.parse(readFileSync(join(root, "scripts", "data", "fr-names", "magic-items-fr.json"), "utf8"));

const tsv = readFileSync(tsvPath, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .slice(1)
  .map((line) => line.split("\t"));
if (tsv.length !== en.pages.length) {
  throw new Error(`alignment TSV has ${tsv.length} rows, the EN book has ${en.pages.length} pages`);
}
const rowsById = new Map(tsv.map((row) => [row[0], row]));
for (const page of en.pages) {
  if (!rowsById.has(page.id)) throw new Error(`alignment TSV has no row for EN page ${page.id}`);
}

const pages = [];
const missing = [];
const noMeta = [];
for (const enPage of en.pages) {
  const { id, chapter, kind } = enPage;
  let path = null;
  for (const folder of waveFolderFor(id, chapter, kind)) {
    const candidate = join(waves, folder, `${id}.md`);
    try {
      const md = tidy(readFileSync(candidate, "utf8"));
      path = { folder, md };
      break;
    } catch {
      // no print in this folder; try the next
    }
  }
  if (!path) {
    if (!KNOWN_MISSING.includes(id)) {
      throw new Error(`no French print for ${id} (${chapter}, ${kind}) and it is not a known missing page`);
    }
    missing.push(id);
    continue;
  }

  // The title: the print's (the alignment TSV's, item titles from the
  // verified pairs), never the English page's.
  let title;
  if (kind === "item") {
    title = itemNames[id];
    if (!title) throw new Error(`no French name for magic item ${id}`);
  } else {
    const printed = rowsById.get(id)[5].trim();
    title = TITLE_FIX[id] ?? printed;
    if (TITLE_FIX[id] === undefined && /(intro|ouverture|art vectoriel|\(table|avec l'|le FR)/i.test(printed)) {
      throw new Error(`printed title for ${id} looks annotated and has no fix: ${printed}`);
    }
  }

  const page = { id, chapter, title, kind, md: path.md };
  const meta = metaLine(path.md);
  if (meta && (kind === "spell" || kind === "monster" || kind === "item")) {
    // Only the entry kinds carry the print's italic first line, as the
    // English book does (a rules page's italic prerequisite line is body text).
    page.meta = meta;
  } else if (enPage.meta) {
    noMeta.push(id);
  }

  // The contents' grouping: the spells chapter groups by level in French;
  // the entry chapters keep the English book's letter groups, which follow
  // the binding order the two books share.
  if (enPage.group) {
    if (kind === "spell") {
      const level = meta ? spellLevel(meta) : undefined;
      if (level === undefined) throw new Error(`no level in the French meta of ${id}: ${meta}`);
      page.group = LEVEL_GROUPS_FR[level];
    } else {
      page.group = enPage.group;
    }
  }
  if (enPage.family) page.family = enPage.family;
  pages.push(page);
}

if (missing.join(",") !== KNOWN_MISSING.join(",")) {
  throw new Error(`missing pages are ${missing.join(", ") || "none"}, expected ${KNOWN_MISSING.join(", ")}`);
}
if (pages.length !== en.pages.length - KNOWN_MISSING.length) {
  throw new Error(`assembled ${pages.length} French pages, expected ${en.pages.length - KNOWN_MISSING.length}`);
}

// The chapters and parts: the English book's binding with the print's
// French titles. The chapter blurbs keep the English book's words — the FR
// print opens every chapter straight into its first section, printing no
// blurb; the three parts (this book's own binding) carry the French the
// reader already shows for them.
const chapters = en.chapters.map((chapter) => ({
  ...chapter,
  title: CHAPTER_TITLES[chapter.id] ?? chapter.title,
  pages: chapter.pages,
}));

const parts = en.parts.map((part) => ({
  ...part,
  title: PART_TITLES[part.id] ?? part.title,
  blurb: PART_BLURBS[part.id] ?? part.blurb,
}));

const book = {
  source: {
    title: "Document de Référence du Système 5.1",
    publisher: "Wizards of the Coast LLC",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/legalcode.fr",
    conversion: "https://dnd.wizards.com/fr/resources/systems-reference-document",
  },
  parts,
  chapters,
  pages,
};

writeFileSync(outPath, `${JSON.stringify(book)}\n`);
const counts = Object.fromEntries(chapters.map((chapter) => [chapter.id, chapter.pages.length]));
console.log(`Wrote ${pages.length} French pages to ${outPath.slice(root.length + 1)} (${missing.length} English fallbacks: ${missing.join(", ")})`);
console.log("per-chapter page lists:", counts);
if (noMeta.length) console.log(`${noMeta.length} entries keep no FR meta line where the EN page has one: ${noMeta.join(", ")}`);
