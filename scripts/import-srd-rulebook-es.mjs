// Builds the Spanish rulebook (src/lib/rulebook/srd-5.1-es.json): the same
// book as srd-5.1.json (same page ids, same order, same chapters and parts),
// with the pages, titles and meta lines of the official Spanish print,
// Wizards of the Coast's «Documento de referencia del sistema 5.1»
// (SRD_CC_v5.1_ES.pdf, CC-BY-4.0; see docs/LICENSES.md).
//
// Unlike the French importer, which binds pages extracted by hand outside the
// repository, this one reads the PDF itself, so anyone with the file can
// rebuild the book:
//
//   node scripts/import-srd-rulebook-es.mjs [SRD_CC_v5.1_ES.pdf]
//
// The PDF is Wizards' own download
// (https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1_ES.pdf); without
// an argument it is looked for at ODM_SRD_ES_PDF, then beside the repository
// at ../tools/rulebook-es/SRD_CC_v5.1_ES.pdf. poppler-utils (pdfinfo,
// pdftohtml) reads it. The file is checked against the sha256 below, since
// every table here was written against that print.
//
// How a page is found. The print's order is its own (Elfo before Enano, the
// spells by their Spanish names), so nothing is bound by position:
//
// - a rules, race or class page starts at a heading named in MARKS and runs
//   to the next one;
// - a spell, a magic item or a stat block is its own heading in the print,
//   paired with its English page in scripts/data/rulebook-es/entries.json.
//   The pairs were made from what the two prints share (a stat block's Armor
//   Class, hit points, scores and challenge; a spell's level, school and
//   components; an item's kind, rarity and attunement; the dice in the
//   text), and every pair is checked against those again on every run
//   (scripts/lib/srd-es-entries.mjs). `--suggest <file>` writes the pairing
//   afresh, with the close calls listed for a reader of Spanish to settle.
//
// The words are quoted as printed. Nobody who speaks Spanish has read this
// book through in the app: the checks here are structural (every page bound,
// no paragraph of the print left out, the same dice on both sides), not a
// proofreading. A wrong word is corrected in FIXES below, never by hand in
// the JSON, which the next run would overwrite.
//
// `--cache <file>` keeps the parsed PDF between runs (a minute's work), for
// working on the tables here; `--report` prints what the checks found.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindOf, readPdf } from "./lib/srd-es-pdf.mjs";
import { chunksOf, headingLevels, render, squeeze } from "./lib/srd-es-markdown.mjs";
import { signature, suggest } from "./lib/srd-es-entries.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const enPath = join(root, "src", "lib", "rulebook", "srd-5.1.json");
const outPath = join(root, "src", "lib", "rulebook", "srd-5.1-es.json");
const entriesPath = join(root, "scripts", "data", "rulebook-es", "entries.json");
const PDF_SHA256 = "75c42a82d627fd6c85e8929985157176c699e1ddbd2ca5d2bcbb58af17254651";

const args = process.argv.slice(2);
const valued = new Set(["--cache", "--suggest"]);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const pdfPath =
  args.find((arg, at) => !arg.startsWith("--") && !valued.has(args[at - 1])) ??
  process.env.ODM_SRD_ES_PDF ??
  join(root, "..", "tools", "rulebook-es", "SRD_CC_v5.1_ES.pdf");
const report = args.includes("--report");

function loadBlocks() {
  const cache = option("--cache");
  if (cache && existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  if (!existsSync(pdfPath)) {
    throw new Error(`no PDF at ${pdfPath}: pass the path to SRD_CC_v5.1_ES.pdf (see this script's header)`);
  }
  const sum = createHash("sha256").update(readFileSync(pdfPath)).digest("hex");
  if (sum !== PDF_SHA256) {
    throw new Error(`${pdfPath} is not the print this script was written against (sha256 ${sum})`);
  }
  const read = readPdf(pdfPath);
  if (cache) writeFileSync(cache, JSON.stringify(read));
  return read;
}

// Four titles the page prints ahead of the column that ends before them, so
// the walk through the page cannot give them a font. Their type is said here.
const OUT_OF_ORDER = { Mago: "T0", Dotes: "T0", Clon: "T3", Búho: "T3m" };

// Where each page starts in the print, in the print's order: the heading's
// type (srd-es-pdf.mjs kindOf), its words, and the page it opens. "@" opens
// a run of entries. A page runs to the next mark.
const MARKS = [
  ["legal-information", "T1", "Información legal"],
  ["racial-traits", "T0", "Razas"],
  ["elf", "T1", "Elfo"], ["dwarf", "T1", "Enano"], ["human", "T1", "Humano"],
  ["halfling", "T1", "Mediano"], ["dragonborn", "T1", "Dracónido"], ["gnome", "T1", "Gnomo"],
  ["half-elf", "T1", "Semielfo"], ["half-orc", "T1", "Semiorco"], ["tiefling", "T1", "Tiefling"],
  ["barbarian", "T0", "Bárbaro"], ["bard", "T0", "Bardo"], ["warlock", "T0", "Brujo"],
  ["cleric", "T0", "Clérigo"], ["druid", "T0", "Druida"], ["ranger", "T0", "Explorador"],
  ["fighter", "T0", "Guerrero"], ["sorcerer", "T0", "Hechicero"], ["wizard", "T0", "Mago"],
  ["monk", "T0", "Monje"], ["paladin", "T0", "Paladín"], ["rogue", "T0", "Pícaro"],
  ["beyond-1st-level", "T0", "Más allá del nivel 1"],
  ["multiclassing", "T1", "Multiclase"],
  ["alignment", "T1", "Alineamiento"],
  ["languages", "T1", "Idiomas"],
  ["inspiration", "T1", "Inspiración"],
  ["backgrounds", "T1", "Trasfondos"],
  ["coinage", "T0", "Equipo"],
  ["selling-treasure", "T1", "Vender tesoros"],
  ["armor", "T1", "Armaduras"],
  ["weapons", "T1", "Armas"],
  ["adventuring-gear", "T1", "Equipo de aventureros"],
  ["tools", "T1", "Herramientas"],
  ["mounts-and-vehicles", "T1", "Monturas y vehículos"],
  ["trade-goods", "T1", "Mercancías"],
  ["expenses", "T1", "Gastos"],
  ["feats", "T0", "Dotes"],
  ["using-ability-scores", "T0", "Uso de las puntuaciones de característica"],
  ["adventuring", "T1", "Tiempo"],
  ["combat", "T1", "Estructura de un combate"],
  ["spellcasting", "T0", "Lanzamiento de conjuros"],
  ["spell-lists", "T1", "Listas de conjuros"],
  ["@spells", "T1", "Descripciones de conjuros"],
  ["traps", "T1", "Trampas"],
  ["diseases", "T1", "Enfermedades"],
  ["madness", "T1", "Locura"],
  ["objects", "T1", "Objetos"],
  ["poisons", "T1", "Venenos"],
  ["magic-items", "T0", "Objetos mágicos"],
  ["@items", "T1", "Objetos mágicos de la A a la Z"],
  ["sentient-magic-items", "T1", "Objetos mágicos conscientes"],
  ["artifacts", "T1", "Artefactos"],
  ["monster-statistics", "T0", "Monstruos"],
  ["@monsters", "T1", "Monstruos (A)"],
  ["conditions", "T0", "Apéndice MJ-A: Estados"],
  ["gods-of-the-multiverse", "T0", "Apéndice MJ-B: Panteones histórico-fantásticos"],
  ["the-planes-of-existence", "T0", "Apéndice MJ-C: Los planos de existencia"],
  ["@creatures", "T0", "Apéndice MM-A: Criaturas diversas"],
  ["@npcs", "T0", "Apéndice MM-B: Personajes no jugadores"],
];

// A page whose mark is a section of its own in the English page too, so the
// heading stays on the page instead of becoming its title.
const KEEPS_ITS_MARK = new Set(["adventuring"]);

// A page's title where it is not its mark's words: the two chapters the
// print opens straight into their first section are named by the print's own
// cross-references («Aventuras», «Combate»), and the coins, set under the
// chapter title «Equipo» with no heading, by the word their text opens on.
const TITLES = {
  coinage: "Monedas",
  adventuring: "Aventuras",
  combat: "Combate",
  "nonplayer-characters": "Personajes no jugadores",
};

// The book's chapters. The print names most of them; the four it does not
// (it opens the classes on «Bárbaro», prints no title over alignment and
// backgrounds or over traps and poisons, and binds the appendices one by
// one) are this book's own binding and carry a plain translation of the
// English chapter's name, for a reader of Spanish to better.
const CHAPTER_TITLES = {
  races: "Razas",
  classes: "Clases", // not printed
  "beyond-1st-level": "Más allá del nivel 1",
  personality: "Personalidad y trasfondo", // not printed
  equipment: "Equipo",
  feats: "Dotes",
  "ability-scores": "Uso de las puntuaciones de característica",
  adventuring: "Aventuras",
  combat: "Combate",
  spellcasting: "Lanzamiento de conjuros",
  spells: "Descripciones de conjuros",
  "running-the-game": "Dirigir el juego", // not printed
  "magic-items": "Objetos mágicos",
  monsters: "Monstruos",
  creatures: "Criaturas diversas",
  npcs: "Personajes no jugadores",
  appendix: "Apéndices", // the print binds each as «Apéndice MJ-A», «MJ-B», «MJ-C»
};

// The three books are this app's own binding (the print has no parts), so
// their names and blurbs are translations of the English book's, not quotes.
// The role keeps the name the print itself uses («tu GM»).
const PART_TITLES = { players: "Jugadores", "dungeon-master": "El Game Master", monsters: "Monstruos" };
const PART_BLURBS = {
  players: "El Manual del Jugador, hasta donde lo abre el SRD: crear un héroe, jugar la partida y todos los conjuros.",
  "dungeon-master": "La Guía del Dungeon Master, hasta donde la abre el SRD: peligros que dirigir y todos los objetos mágicos.",
  monsters: "El Manual de Monstruos, hasta donde lo abre el SRD: todos los perfiles, las bestias y la gente del mundo.",
};

// The spells chapter groups by level, as the print's own spell lists name
// the levels («Trucos (nivel 0)», «Nivel 1»).
const LEVEL_GROUPS = ["Trucos", "Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5", "Nivel 6", "Nivel 7", "Nivel 8", "Nivel 9"];

// Two pairs the prints themselves disagree on: the Spanish print gives
// Illusory Script a verbal component and the horned devil the hit points of
// the later English printings (178, where the English book here has 148).
const PRINTS_DIFFER = new Set(["illusory-script", "horned-devil"]);

// Four classes whose English page sets a heading the print does not (a
// «Barbarian Paths» over the one path): their headings take the levels the
// other eight classes' twins have.
const CLASS_LEVELS = { T1: 3, T2: 3, T3: 4 };

// A box the print sets ahead of the entry it belongs to, so that cut at the
// entries' headings it would close the entry before: the insect swarms'
// variants, printed over «Enjambre de insectos», under the ravens.
const BOXES = { "Variante: enjambres de insectos": "Enjambre de insectos" };

// A table the print sets as plain lines under a bold line of column names:
// the six levels of exhaustion. Drawn as the table it is.
const LINES_AS_TABLES = { conditions: "Nivel Efecto" };

// The spell lists print each spell on a line of its own, which the English
// book sets as a list: so does this one.
const LISTS_OF_NAMES = new Set(["spell-lists"]);

// Corrections to the print's words, by page: [page id, printed, corrected].
// Empty until a reader of Spanish finds one.
const FIXES = [];

const en = JSON.parse(readFileSync(enPath, "utf8"));
const { blocks, report: walk } = loadBlocks();
for (const block of blocks) {
  if (block.lost && OUT_OF_ORDER[squeeze(block.raw)]) block.kind = OUT_OF_ORDER[squeeze(block.raw)];
}
const kinds = blocks.map(kindOf);
const HEADINGS = ["T0", "T1", "T2", "T3", "T3m"];
const problems = [];
const notes = [];

// ---- the print cut at its marks ----
const regions = new Map();
{
  let from = 0;
  const found = MARKS.map(([target, kind, text]) => {
    const at = blocks.findIndex((block, index) => index >= from && kinds[index] === kind && squeeze(block.raw) === text);
    if (at < 0) throw new Error(`the print has no ${kind} heading «${text}» after block ${from}`);
    from = at + 1;
    return { target, at };
  });
  found.forEach(({ target, at }, nth) => {
    regions.set(target, { mark: blocks[at], blocks: blocks.slice(at + 1, found[nth + 1]?.at ?? blocks.length) });
    blocks[at].used = "mark";
  });
  if (found[0].at !== 0) throw new Error("the print does not open on its legal page");
}

const nextSolid = (list, from) => {
  let at = from;
  while (at < list.length && kindOf(list[at]) === "blank") at += 1;
  return at;
};

// A run of entries cut at its entry headings. In the stat blocks a family's
// heading («Demonios», «Dragón azul») has no text of its own and is dropped;
// one that has (the half-dragon template, the customizing of an NPC) is an
// entry too, and takes the stat block printed under it when MERGES says so.
const MERGES = { "Plantilla de semidragón": "Semidragón rojo veterano" };
function entriesOf(region, startsEntry, statBlocks) {
  const entries = [];
  const lead = [];
  let current = null;
  let merging = null;
  for (let at = 0; at < region.length; at += 1) {
    const block = region[at];
    const kind = kindOf(block);
    const title = squeeze(block.raw ?? "");
    if (kind === startsEntry) {
      if (merging && MERGES[merging.title] === title) {
        merging.blocks.push(block);
        current = merging;
        merging = null;
        continue;
      }
      current = { title, blocks: [] };
      entries.push(current);
      block.used = "entry";
      continue;
    }
    if (statBlocks && HEADINGS.includes(kind)) {
      const next = nextSolid(region, at + 1);
      const bare = next >= region.length || HEADINGS.includes(kindOf(region[next]));
      if (kind === "T1" || bare) {
        block.used = "family";
        current = null;
        continue;
      }
      current = { title, blocks: [], section: true };
      if (MERGES[title]) merging = current;
      entries.push(current);
      block.used = "entry";
      continue;
    }
    if (kind === "blank") continue;
    (current ? current.blocks : lead).push(block);
  }
  return { entries, lead };
}

const text = (list) => list.filter((block) => block.type === "text").map((block) => squeeze(block.raw)).filter(Boolean).join("\n");
const runs = {
  spells: { ...entriesOf(regions.get("@spells").blocks, "T3", false), kind: "spell", pages: en.pages.filter((page) => page.kind === "spell") },
  items: { ...entriesOf(regions.get("@items").blocks, "T3", false), kind: "item", pages: en.pages.filter((page) => page.kind === "item") },
  monsters: { ...entriesOf(regions.get("@monsters").blocks, "T3m", true), kind: "monster", pages: en.pages.filter((page) => page.chapter === "monsters" && page.kind === "monster") },
  creatures: { ...entriesOf(regions.get("@creatures").blocks, "T3m", true), kind: "monster", pages: en.pages.filter((page) => page.chapter === "creatures") },
  npcs: { ...entriesOf(regions.get("@npcs").blocks, "T3m", true), kind: "monster", pages: en.pages.filter((page) => page.chapter === "npcs" && page.kind === "monster") },
};
for (const run of Object.values(runs)) {
  for (const [box, owner] of Object.entries(BOXES)) {
    const from = run.entries.find((entry) => entry.blocks.some((block) => squeeze(block.raw ?? "") === box));
    const to = run.entries.find((entry) => entry.title === owner);
    if (!from || !to || from === to) continue;
    const at = from.blocks.findIndex((block) => squeeze(block.raw ?? "") === box);
    to.blocks.push(...from.blocks.splice(at));
  }
}
for (const [name, run] of Object.entries(runs)) {
  const titles = run.entries.map((entry) => entry.title);
  const twice = titles.filter((title, at) => titles.indexOf(title) !== at);
  if (twice.length) problems.push(`${name}: the print names two entries «${twice.join("», «")}»`);
  for (const entry of run.entries) entry.sig = signature(run.kind, `${text(entry.blocks)}\n${entry.title}`, false);
}

if (option("--suggest")) {
  const out = {};
  for (const [name, run] of Object.entries(runs)) {
    const english = run.pages.map((page) => ({ id: page.id, title: page.title, sig: signature(run.kind, `${page.md}\n${page.title}`, true) }));
    const { pairs, unpaired } = suggest(english, run.entries);
    out[name] = Object.fromEntries(pairs.map((pair) => [pair.id, pair.es]));
    const close = pairs.filter((pair) => pair.es && pair.margin < 0.1);
    console.log(`${name}: ${pairs.filter((pair) => pair.es).length} of ${english.length} paired, ${unpaired.length} print entries left over, ${close.length} close calls`);
    for (const pair of pairs.filter((each) => !each.es)) console.log(`  no pair: ${pair.id} (${pair.title})`);
    for (const title of unpaired) console.log(`  left over: ${title}`);
    for (const pair of close) console.log(`  close: ${pair.id} = ${pair.es} (${pair.margin.toFixed(3)})`);
  }
  writeFileSync(option("--suggest"), `${JSON.stringify(out, null, 1)}\n`);
  process.exit(0);
}

// ---- the pages ----
const pairs = JSON.parse(readFileSync(entriesPath, "utf8"));
const sources = new Map();
for (const [name, run] of Object.entries(runs)) {
  const byTitle = new Map(run.entries.map((entry) => [entry.title, entry]));
  const used = new Set();
  for (const page of run.pages) {
    const title = pairs[name]?.[page.id];
    const entry = title && byTitle.get(title);
    if (!entry) {
      problems.push(`${name}: ${page.id} is paired with «${title ?? ""}», which the print does not carry`);
      continue;
    }
    if (used.has(title)) problems.push(`${name}: «${title}» is paired twice`);
    used.add(title);
    const english = signature(run.kind, page.md, true);
    if (english.hard !== entry.sig.hard && !entry.section && !PRINTS_DIFFER.has(page.id)) {
      problems.push(`${name}: ${page.id} (${english.hard}) and «${title}» (${entry.sig.hard}) disagree`);
    }
    sources.set(page.id, { title, blocks: entry.blocks });
  }
  for (const entry of run.entries) {
    if (!used.has(entry.title)) problems.push(`${name}: «${entry.title}» is paired with no page`);
  }
  // The line or two that only introduce an alphabetical run are on no page
  // of the English book either.
  if (run.lead.length && name !== "npcs") notes.push(`${name}: ${run.lead.length} paragraphs before the first entry are left out («${text(run.lead).slice(0, 80)}»)`);
  for (const block of run.lead) block.used = "lead";
}

const strip = (title) => title.replace(/^Apéndice [A-Z]+-[A-Z]: /, "");
for (const [target, region] of regions) {
  if (target.startsWith("@")) continue;
  let list = region.blocks;
  let title = strip(squeeze(region.mark.raw));
  if (KEEPS_ITS_MARK.has(target)) list = [region.mark, ...list];
  if (target === "racial-traits") {
    // The chapter opens on «Atributos raciales», which is this page's title.
    const at = nextSolid(list, 0);
    title = squeeze(list[at].raw);
    list[at].used = "title";
    list = list.slice(at + 1);
  }
  if (target === "legal-information") {
    // The legal page ends where the cover's own title starts; the cover's
    // line asking for errata to be mailed to Wizards is about their PDF.
    const cover = list.findIndex((block) => squeeze(block.raw ?? "") === "Documento de referencia del sistema 5.1");
    for (const block of list.slice(cover)) block.used = "cover";
    list = list.slice(0, cover);
  }
  sources.set(target, { title: TITLES[target] ?? title, blocks: list });
}
{
  // The NPC appendix opens on a few lines and «Personalizar un PNJ», which
  // the English book binds twice: with the opening lines as the appendix's
  // own page, and alone as a page among the NPCs.
  const custom = sources.get("customizing-npcs");
  const heading = regions.get("@npcs").blocks.find((block) => squeeze(block.raw ?? "") === custom?.title);
  if (!custom || !heading) problems.push("npcs: the print's «Personalizar un PNJ» was not found");
  else sources.set("nonplayer-characters", { title: TITLES["nonplayer-characters"], blocks: [...runs.npcs.lead, heading, ...custom.blocks] });
}

const pages = [];
const unborrowed = [];
for (const enPage of en.pages) {
  const source = sources.get(enPage.id);
  if (!source) {
    problems.push(`no Spanish print for ${enPage.id} (${enPage.chapter}, ${enPage.kind})`);
    continue;
  }
  for (const block of source.blocks) block.used ??= enPage.id;
  const chunks = chunksOf(source.blocks);
  if (LISTS_OF_NAMES.has(enPage.id)) {
    for (let at = chunks.length - 1; at >= 0; at -= 1) {
      if (chunks[at].heading || chunks[at].md.includes("\n")) continue;
      chunks[at].md = `- ${chunks[at].md}`;
      if (chunks[at + 1]?.md?.startsWith("- ")) chunks.splice(at, 2, { md: `${chunks[at].md}\n${chunks[at + 1].md}` });
    }
  }
  const levels = headingLevels(enPage.md);
  const rendered = render(chunks, levels, enPage.kind === "class" ? CLASS_LEVELS : undefined);
  if (!rendered.borrowed) unborrowed.push(`${enPage.id} (EN ${levels.length}, ES ${rendered.headings})`);
  let md = rendered.md;
  if (LINES_AS_TABLES[enPage.id]) {
    const names = LINES_AS_TABLES[enPage.id].split(" ");
    const lines = new RegExp(`^(>?)\\*\\*${names.join(" ")}\\*\\*((?:\\n>?\\n>?\\d+ [^\\n]+)+)`, "m");
    if (!lines.test(md)) problems.push(`${enPage.id}: no lines under «${names.join(" ")}» to draw as a table`);
    md = md.replace(lines, (_, quote, body) => {
      const rows = [...body.matchAll(/(\d+) ([^\n]+)/g)].map((row) => `${quote}| ${row[1]} | ${row[2]} |`);
      return [`${quote}| ${names.join(" | ")} |`, `${quote}|---|---|`, ...rows].join("\n");
    });
  }
  for (const [id, printed, corrected] of FIXES) {
    if (id !== enPage.id) continue;
    if (!md.includes(printed)) problems.push(`${id}: the fix for «${printed}» finds nothing to fix`);
    md = md.replaceAll(printed, corrected);
  }
  const page = { id: enPage.id, chapter: enPage.chapter, title: source.title, kind: enPage.kind, md };
  // The entry's italic first line; a template's page reaches its stat
  // block's line further down.
  const paragraphs = md.split("\n\n");
  const first = /^\*([^*\n]+)\*$/.exec(paragraphs[0]) ?? (enPage.meta ? paragraphs.map((each) => /^\*([^*\n]+)\*$/.exec(each)).find(Boolean) : null);
  if (first && ["spell", "monster", "item"].includes(enPage.kind)) page.meta = first[1].trim();
  else if (enPage.meta) notes.push(`${enPage.id}: no meta line where the English page has one`);
  if (enPage.group) {
    if (enPage.kind === "spell") {
      const level = /truco/i.test(page.meta ?? "") ? 0 : Number(/(\d)/.exec(page.meta ?? "")?.[1] ?? NaN);
      if (Number.isNaN(level)) problems.push(`${enPage.id}: no level in «${page.meta}»`);
      page.group = LEVEL_GROUPS[level];
    } else {
      // The entry chapters keep the English book's letter groups, which
      // follow the binding order the two books share.
      page.group = enPage.group;
    }
  }
  if (enPage.family) page.family = enPage.family;
  pages.push(page);
}

// Nothing the print says is left out without a reason given above.
const unused = blocks.filter((block, at) => !block.used && kinds[at] !== "blank");
if (unused.length) {
  problems.push(`${unused.length} blocks of the print are on no page, the first: «${text(unused.slice(0, 3)).slice(0, 200)}»`);
}

if (report) {
  console.log(`the walk: ${walk.letters} letters, ${walk.unmatched} without a font, ${walk.lost.length} pieces out of order`);
  console.log(`${unborrowed.length} pages set their own heading levels:\n  ${unborrowed.join("\n  ")}`);
  for (const note of notes) console.log(`note: ${note}`);
}
if (problems.length) {
  for (const problem of problems) console.error(problem);
  if (!report) process.exit(1);
}

const book = {
  source: {
    title: "Documento de referencia del sistema 5.1",
    publisher: "Wizards of the Coast LLC",
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/legalcode.es",
    conversion: "https://dnd.wizards.com/es/resources/systems-reference-document",
  },
  parts: en.parts.map((part) => ({ ...part, title: PART_TITLES[part.id] ?? part.title, blurb: PART_BLURBS[part.id] ?? part.blurb })),
  // The chapter blurbs keep the English book's words: the print opens every
  // chapter straight into its first section and prints none.
  chapters: en.chapters.map((chapter) => ({ ...chapter, title: CHAPTER_TITLES[chapter.id] ?? chapter.title })),
  pages,
};
if (problems.length) process.exit(1);
writeFileSync(outPath, `${JSON.stringify(book)}\n`);
console.log(`Wrote ${pages.length} Spanish pages to ${outPath.slice(root.length + 1)}`);
