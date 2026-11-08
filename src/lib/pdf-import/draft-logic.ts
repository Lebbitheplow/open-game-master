import type { MatchAsk } from "./match-logic.ts";
import type { Block } from "./layout-logic.ts";
import { layoutWork } from "./layout-logic.ts";
import { finish, finishSliced } from "./slices-logic.ts";
import type { Reading } from "./reading.ts";
import { descendants, sectionsOf, sectionText, type Section } from "./sections-logic.ts";
import { findStatBlocks, type FoundStatBlock, type PrintedMonster } from "./statblock-text-logic.ts";
import { detectSystem, findCreatureTables, findForeignStatBlocks, type BookSystem } from "./foreign-statblock-logic.ts";
import { areaTitle, findAreas, rollTableOf, titleAbove, type RollEntry } from "./tables-logic.ts";
import type { GridGuess, PictureKind } from "./picture-logic.ts";

// What a book becomes before anyone has looked at it: a list of records,
// each with the pages it came from, the words it was read from, and what
// the GM should check. This file reads only what the book's layout says on
// its own (no model): chapters as GM lore, stat blocks, roll tables, keyed
// areas as places, maps, art and one storyboard card per chapter. The model
// pass (ai-logic.ts) adds the people, factions, treasure, fights and story
// on top. The records become a workshop bundle in bundle-logic.ts. Pure.

export const RECORD_KINDS = ["lore", "location", "npc", "faction", "monster", "item", "spell", "table", "map", "encounter", "beat", "art"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export type DraftRecord = {
  key: string;
  kind: RecordKind;
  name: string;
  pages: number[];
  // The book's own words this record was read from, short, for the review.
  source: string;
  // What the GM should look at before trusting it, in plain words.
  check: string[];
  include: boolean;
  from: "book" | "model";
  data: Record<string, unknown>;
};

// A picture the page uploaded, as the server keeps it.
export type KeptPicture = {
  id: string;
  page: number;
  kind: PictureKind;
  width: number;
  height: number;
  grid: GridGuess | null;
  keys: Array<{ key: string; fx: number; fy: number }>;
  // Words printed near it (a caption, the heading above), for naming it.
  near: string;
};

export type Draft = {
  title: string;
  // The system the book's stat blocks are written for; everything lands in
  // SRD 5.1 terms either way (equivalents.ts).
  system?: BookSystem;
  premise: string;
  party: { size: number; level: number; stated?: boolean; levelTo?: number } | null;
  records: DraftRecord[];
  // Each section's words, in order, for the model pass and the binder.
  sections: Array<{ id: number; title: string; path: string[]; level: number; pageStart: number; pageEnd: number; text: string }>;
  // Ties and secrets the model found, by name (ai-logic.ts), laid over the
  // records in the workshop's WorldForge.
  links?: Array<{ from: string; to: string; label: string }>;
  secrets?: Array<Record<string, unknown>>;
  // Whether the model read the book, and what it could not read.
  model?: { used: boolean; chunks: number; failed: number; note: string };
  // The names in fights and on people have been set beside SRD 5.1.
  settled?: boolean;
  // The creatures no name settled, each with its closest SRD 5.1
  // creatures, for the GM to confirm in the review (matches.ts).
  matches?: MatchAsk[];
};

export const LORE_MAX = 20_000;
const SOURCE_MAX = 1_200;
const LORE_LIMIT = 480;

const plain = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
export const slug = (text: string) =>
  plain(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "x";

const LORE_CATEGORIES: Array<[RegExp, string]> = [
  [/\b(history|background|legend|origins?|chronicle|past|timeline)\b/i, "history"],
  [/\b(gods?|religion|temple|church|faith|cult|pantheon|deity|shrine)\b/i, "religion"],
  [/\b(magic|spells?|arcane|artifacts?|rituals?)\b/i, "magic"],
  [/\b(factions?|guilds?|orders?|houses?|clans?|organizations?)\b/i, "factions"],
  [/\b(region|geography|lands?|map|wilderness|realm|kingdom|city|town|village|travel)\b/i, "geography"],
  [/\b(people|culture|customs|society|folk|races?)\b/i, "culture"],
];

export function loreCategory(title: string): string {
  for (const [pattern, category] of LORE_CATEGORIES) if (pattern.test(title)) return category;
  return "other";
}

// "for four to six characters of 3rd level", "for 1st-level characters",
// "levels 5-7": the party the book was written for.
// The party a book is written for. The size is 4 when the book does not
// say (a workshop needs one), and `stated` says whether it did; `levelTo`
// is the top of a range ("levels 3 to 5").
export function partyOf(text: string): { size: number; level: number; stated?: boolean; levelTo?: number } | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const level =
    /\b(\d{1,2})(?:st|nd|rd|th)[-\s]level\s+(?:player\s+)?(?:characters|adventurers|heroes|party)\b/i.exec(text) ??
    /\b(?:characters|adventurers|heroes|party)\s+of\s+(\d{1,2})(?:st|nd|rd|th)\s+level\b/i.exec(text) ??
    /\bfor\s+(?:characters\s+of\s+)?levels?\s+(\d{1,2})\s*(?:[–—-]|to)\s*(\d{1,2})\b/i.exec(text);
  if (!level) return null;
  const value = Number(level[1]);
  if (!value || value > 20) return null;
  const size = /\b(?:for\s+)?(one|two|three|four|five|six|seven|eight|\d)\s+(?:to\s+\w+\s+)?(?:player\s+)?characters\b/i.exec(text);
  const count = size ? (words[size[1].toLowerCase()] ?? Number(size[1])) : 4;
  const top = Number(level[2]);
  return { size: Math.min(10, Math.max(1, count || 4)), level: value, ...(size ? { stated: true } : {}), ...(top > value && top <= 20 ? { levelTo: top } : {}) };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n\n", max);
  return (cut > max * 0.6 ? text.slice(0, cut) : text.slice(0, max)).trim();
}

// Long text as parts that each fit, split between paragraphs.
export function parts(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Numbered paragraphs are rooms only when they read like rooms (walls,
// doors, feet across) or a map is printed beside them; otherwise they are a
// numbered list of steps.
const ROOM_WORDS = /\b(room|chamber|hall|corridor|passage|door|doors|wall|walls|ceiling|floor|stairs|feet|ft\.|north|south|east|west|cave|cavern|alcove|vault|cell)\b/i;
function looksLikeSite(texts: string[], pictures: KeptPicture[], section: Section): boolean {
  if (pictures.some((picture) => picture.kind === "map" && picture.page >= section.pageStart - 1 && picture.page <= section.pageEnd + 1)) return true;
  const roomy = texts.filter((text) => ROOM_WORDS.test(text)).length;
  return roomy >= Math.max(2, Math.ceil(texts.length / 2));
}

const pagesOf = (blocks: Block[]) => [...new Set(blocks.map((block) => block.page))].sort((a, b) => a - b);

function monsterRecord(found: FoundStatBlock, used: Set<string>): DraftRecord {
  const monster = found.monster;
  monster.name = titleCase(monster.name);
  let key = `monster:${slug(monster.name)}`;
  for (let n = 2; used.has(key); n += 1) key = `monster:${slug(monster.name)}-${n}`;
  used.add(key);
  const check: string[] = [];
  if (!monster.strength) check.push("The six ability scores were not found; the bestiary fills in defaults.");
  if (!monster.actions.length) check.push("No actions were found in this stat block.");
  return {
    key,
    kind: "monster",
    name: monster.name,
    pages: pagesOf(found.blocks),
    source: found.printed.slice(0, SOURCE_MAX),
    check,
    include: true,
    from: "book",
    data: { printed: monster, text: found.printed, ...(found.table ? { table: true } : {}) },
  };
}

// The parts of a book that are about the book, not its story: they stay
// the GM's lore and get no storyboard card.
const FRONT_MATTER = /^(maps?|contents|table of contents|foreword|preface|credits|appendi(x|ces)\b|index|treasure|encounters?$|design notes|acknowledg|legal|licen[cs]e|about the|open game|ogl|introduction$|how to use)/i;

// A stat block for a named person, not a kind of creature: a humanoid
// whose name is a proper name ("Sister Garaele", not "Bandit Captain").
const GENERIC = /\b(guard|captain|cultist|bandit|thug|priest|acolyte|mage|knight|noble|scout|spy|veteran|warrior|soldier|commoner|chief|leader|boss|champion|archer|assassin|berserker|druid|gladiator|merchant|sailor|pirate|apprentice|adept|fanatic|zombie|skeleton|hag|chieftain|shaman)\b/i;
export function isNamedPerson(monster: PrintedMonster, printed = ""): boolean {
  if (!/humanoid/i.test(monster.type)) return false;
  // "Poachers" is a band, not a person.
  const last = monster.name.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
  if (/[^s]s$/.test(last) && !/(us|is|ss)$/.test(last)) return false;
  // A kind of creature is written of as "the goblin"; a person by name.
  if (new RegExp(`\\bthe\\s+${monster.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(printed)) return false;
  const words = monster.name.split(/\s+/);
  if (words.length > 4 || GENERIC.test(monster.name)) return false;
  return words.every((word) => /^[A-Z][a-z'’-]+$/.test(word) || /^(of|the|de|von|van)$/.test(word));
}

export function* draftWork(reading: Reading, pictures: KeptPicture[]): Generator<void, Draft> {
  const blocks = yield* layoutWork(reading.pages, reading.fonts);
  const sections = sectionsOf(blocks, reading.outline);
  const system = detectSystem(blocks, reading.fileName);
  const records: DraftRecord[] = [];
  const usedKeys = new Set<string>();
  // The next number to try for each base, so a book of a thousand rooms
  // all called "Room" is not a thousand walks up the same numbers.
  const nextOf = new Map<string, number>();
  const uniqueKey = (base: string) => {
    let key = base;
    for (let n = nextOf.get(base) ?? 2; usedKeys.has(key); n += 1) {
      key = `${base}-${n}`;
      nextOf.set(base, n + 1);
    }
    usedKeys.add(key);
    return key;
  };

  // Stat blocks first: the prose around them leaves them out.
  const lifted = new Map<Block, string>();
  const monsterSections = new Map<number, string[]>();
  for (const section of sections) {
    yield;
    const run = section.heading ? [section.heading, ...section.blocks] : section.blocks;
    const tableRows = findCreatureTables(run);
    for (const found of [...findStatBlocks(run), ...findForeignStatBlocks(run, system), ...tableRows]) {
      const record = monsterRecord(found, usedKeys);
      records.push(record);
      // A creature table stays in the prose too: it is one block for many.
      if (!tableRows.includes(found)) for (const block of found.blocks) lifted.set(block, `[Stat block: ${found.monster.name}]`);
      const list = monsterSections.get(section.id) ?? [];
      list.push(record.key);
      monsterSections.set(section.id, list);
      if (isNamedPerson(found.monster, found.printed)) {
        records.push({
          key: uniqueKey(`npc:${slug(found.monster.name)}`),
          kind: "npc",
          name: found.monster.name,
          pages: record.pages,
          source: record.source,
          check: ["Read as a person from a named humanoid stat block; check who they are."],
          include: true,
          from: "book",
          data: { statBlock: record.key, trait: found.monster.alignment ? `${found.monster.alignment}.` : "" },
        });
      }
    }
  }

  // Roll tables, named by the title above them.
  for (const section of sections) {
    yield;
    section.blocks.forEach((block, index) => {
      if (block.kind !== "table" || lifted.has(block)) return;
      const table = rollTableOf(block, titleAbove(section.blocks, index) || section.title);
      if (!table) return;
      records.push({
        key: uniqueKey(`table:${slug(table.name)}`),
        kind: "table",
        name: table.name,
        pages: [table.page],
        source: (block.rows ?? []).map((row) => row.join(" | ")).join("\n").slice(0, SOURCE_MAX),
        check: [],
        include: true,
        from: "book",
        data: { die: table.die, entries: table.entries satisfies RollEntry[] },
      });
      lifted.set(block, `[Roll table: ${table.name}]`);
    });
  }

  // Keyed areas: a site's numbered rooms as places, the site as their
  // parent, each area's words as how it is laid out. A book prints a room's
  // key either as a heading of its own (each room then a section under the
  // site's) or as a bold run-in title inside the site's text; both count.
  const siteOfSection = new Map<number, string>();
  const areaSections = new Set<number>();
  const childrenOf = new Map<number, Section[]>();
  for (const child of sections) if (child.parent !== undefined && child.parent !== null) childrenOf.set(child.parent, [...(childrenOf.get(child.parent) ?? []), child]);
  for (const section of sections) {
    yield;
    const children = (childrenOf.get(section.id) ?? []).filter((child) => child.heading && areaTitle(child.heading));
    const fromChildren = children.length >= 2 ? children.map((child) => ({ ...areaTitle(child.heading!)!, blocks: [child.heading!, ...child.blocks], page: child.pageStart, section: child.id })) : [];
    const runIn = findAreas(section.blocks).map((area) => ({ ...area, section: -1 }));
    const areas = [...fromChildren, ...runIn];
    if (areas.length < 2 || !looksLikeSite(areas.map((area) => sectionText({ ...section, blocks: area.blocks }, lifted)), pictures, section)) continue;
    for (const area of fromChildren) areaSections.add(area.section);
    // The site is its section; rooms keyed in the book's opening pages, with
    // no section of their own, are under the run-in title above them
    // ("Rooms and Locations") or else the book itself.
    const firstArea = section.blocks.indexOf(areas[0].blocks[0]);
    const titleAbove = firstArea > 0 ? [...section.blocks.slice(0, firstArea)].reverse().find((block) => block.kind === "heading") : undefined;
    const siteName = titleCase(section.id !== 0 ? section.title : titleAbove ? plain(titleAbove.text) : reading.title || reading.fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
    const siteKey = uniqueKey(`location:${slug(siteName)}`);
    siteOfSection.set(section.id, siteKey);
    for (const child of children) siteOfSection.set(child.id, siteKey);
    const own = section.blocks.filter((block) => !areaTitle(block));
    records.push({
      key: siteKey,
      kind: "location",
      name: siteName,
      pages: [section.pageStart, section.pageEnd].filter((page, index, all) => all.indexOf(page) === index),
      source: clip(sectionText({ ...section, blocks: own.slice(0, 6) }, lifted), SOURCE_MAX),
      check: [],
      include: true,
      from: "book",
      data: { layoutDescription: clip(sectionText({ ...section, blocks: own.slice(0, 8) }, lifted), 4_000), partOf: "", connections: [] },
    });
    for (const area of areas) {
      const text = sectionText({ ...section, blocks: area.blocks.slice(1) }, lifted) || sectionText({ ...section, blocks: area.blocks }, lifted).replace(/^\*\*[^*]+\*\*\s*/, "");
      const name = `${area.key}. ${titleCase(area.name)}`.slice(0, 120);
      records.push({
        key: uniqueKey(`location:${slug(`${siteName}-${area.key}`)}`),
        kind: "location",
        name,
        pages: pagesOf(area.blocks),
        source: clip(text, SOURCE_MAX),
        check: [],
        include: true,
        from: "book",
        data: { layoutDescription: clip(text, 8_000), partOf: siteName, connections: [], areaKey: area.key, site: siteKey },
      });
    }
  }

  // Every section's words as the GM's lore: the book in the binder, found
  // by the GM's lore search in play. A chapter's own text heads it; long
  // ones are split into numbered parts.
  const loreCandidates: DraftRecord[] = [];
  const sectionsOut: Draft["sections"] = [];
  for (const section of sections) {
    yield;
    const text = sectionText(section, lifted);
    sectionsOut.push({ id: section.id, title: section.title, path: section.path, level: section.level, pageStart: section.pageStart, pageEnd: section.pageEnd, text });
    // A keyed room is a place now; its words are the place's.
    if (plain(text).length < 160 || areaSections.has(section.id)) continue;
    const pieces = parts(text, LORE_MAX);
    const chapter = section.path[0] ?? section.title;
    pieces.forEach((piece, index) => {
      const title = pieces.length > 1 ? `${titleCase(section.title)} (part ${index + 1})` : titleCase(section.title);
      loreCandidates.push({
        key: uniqueKey(`lore:${slug(section.path.join(" "))}${pieces.length > 1 ? `-${index + 1}` : ""}`),
        kind: "lore",
        name: title.slice(0, 200),
        pages: [section.pageStart, section.pageEnd].filter((page, at, all) => all.indexOf(page) === at),
        source: clip(piece, SOURCE_MAX),
        check: [],
        include: true,
        from: "book",
        data: { category: loreCategory(`${section.title} ${chapter}`), body: piece, tags: [chapter.slice(0, 40)].filter(Boolean), visibility: "dm", section: section.id, level: section.level },
      });
    });
  }
  records.push(...(yield* mergeLore(loreCandidates, LORE_LIMIT)));

  // Pictures: maps become battle maps (with their grid when one was found),
  // the rest art, each under the section it was printed in.
  const sectionAt = (page: number): Section | undefined =>
    [...sections].reverse().find((section) => section.id !== 0 && section.pageStart <= page && section.pageEnd >= page) ?? sections.find((section) => section.pageStart <= page);
  for (const picture of pictures) {
    yield;
    if (picture.kind === "backdrop") continue;
    const section = sectionAt(picture.page);
    const near = plain(picture.near).slice(0, 100);
    if (picture.kind === "map") {
      const name = (near || `${section?.title ?? "Map"}`).slice(0, 110);
      const check: string[] = [];
      if (!picture.grid) check.push("No grid was found on this picture; set the map's scale in the map editor.");
      else if (picture.grid.confidence < 0.4) check.push("The grid size is a guess; check the map's scale in the map editor.");
      const site = section ? (siteOfSection.get(section.id) ?? siteOfSection.get(section.parent ?? -1)) : undefined;
      records.push({
        key: uniqueKey(`map:${slug(name)}`),
        kind: "map",
        name: /map/i.test(name) ? name : `Map: ${name}`.slice(0, 120),
        pages: [picture.page],
        source: near,
        check,
        include: true,
        from: "book",
        data: { picture: picture.id, grid: picture.grid, keys: picture.keys, width: picture.width, height: picture.height, site: site ?? "" },
      });
    } else {
      records.push({
        key: uniqueKey(`art:${picture.id}`),
        kind: "art",
        name: (near || `Illustration, page ${picture.page}`).slice(0, 120),
        pages: [picture.page],
        source: near,
        check: [],
        include: true,
        from: "book",
        data: { picture: picture.id, section: section?.id ?? 0 },
      });
    }
  }

  // One storyboard card per chapter, in book order, each opening on the
  // chapter's first words and its first read-aloud text.
  // A chapter is a level-1 section with words in it: the cover's title and
  // subtitle are headings too, and no part of the story.
  const chapters: Array<{ chapter: Section; own: Section[] }> = [];
  for (const section of sections) {
    if (section.level !== 1 || FRONT_MATTER.test(section.title.trim())) continue;
    yield;
    const own = [section, ...descendants(sections, section.id)];
    if (own.some((part) => part.blocks.some((block) => block.kind !== "heading" && plain(block.text).length >= 80))) chapters.push({ chapter: section, own });
  }
  for (const { chapter, own } of chapters) {
    yield;
    const firstWords = own.flatMap((section) => section.blocks).find((block) => block.kind === "text" && !lifted.has(block) && plain(block.text).length > 80);
    const readAloud = own.flatMap((section) => section.blocks).find((block) => block.kind === "boxed");
    const body = [firstWords ? plain(firstWords.text) : "", readAloud ? `Read aloud: ${plain(readAloud.text)}` : ""].filter(Boolean).join("\n\n");
    records.push({
      key: uniqueKey(`beat:${slug(chapter.title)}`),
      kind: "beat",
      name: titleCase(chapter.title).slice(0, 120),
      pages: [chapter.pageStart],
      source: clip(body, SOURCE_MAX),
      check: [],
      include: true,
      from: "book",
      // A chapter opens the storyboard's run of its pages: a heading card.
      data: { beatKind: "setting", body: clip(body, 4_000), order: chapter.pageStart * 1_000 },
    });
  }

  // The cover and the first pages, headings included (a subtitle such as
  // "An adventure for four characters of 3rd level" is set as one).
  const front = sectionsOut.slice(0, 5).map((section) => `${section.title}\n${section.text}`).join("\n\n");
  // The opening words, without the quote marks read-aloud text carries.
  const firstText = plain((sectionsOut.find((section) => plain(section.text).length > 200)?.text ?? "").replace(/^> /gm, ""));
  return {
    title: bookTitle(reading, blocks),
    system,
    // (Without the places the layout lifted out: "[Stat block: X]".)
    premise: firstText.replace(/\s*\[(?:Stat block|Roll table): [^\]]*\]/g, "").trim().slice(0, 480),
    party: partyOf(front),
    records,
    sections: sectionsOut,
  };
}

export function buildDraft(reading: Reading, pictures: KeptPicture[]): Draft {
  return finish(draftWork(reading, pictures));
}

// The same, a slice at a time (slices-logic.ts): what the job runs.
export function buildDraftSliced(reading: Reading, pictures: KeptPicture[]): Promise<Draft> {
  return finishSliced(draftWork(reading, pictures));
}

// The book's name: its own metadata, else the cover's biggest words when
// they read as words (a scanned cover's text layer can spell "TALES FROM
// THEYAWfflffGPORTAL"), else the file's name.
function bookTitle(reading: Reading, blocks: Block[]): string {
  const fromFile = reading.fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+v?\d+(\.\d+)+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const meta = plain(reading.title);
  if (meta && readsAsWords(meta) && !/^(untitled|microsoft word|document)\b/i.test(meta)) return titleCase(meta);
  // The cover's words, when they are the book's name: a file called
  // "book.pdf" says nothing, and a cover heading that shares no word with a
  // file's real name ("Maps" on page 2) is not its title.
  const cover = coverTitle(blocks);
  const fileWords = new Set(fromFile.toLowerCase().split(/\W+/).filter((word) => word.length > 3));
  const shares = cover.toLowerCase().split(/\W+/).some((word) => fileWords.has(word));
  const genericFile = fileWords.size === 0 || /^(book|adventure|module|scan|download|untitled)\b/i.test(fromFile);
  if (cover && readsAsWords(cover) && (shares || genericFile)) return titleCase(cover);
  return fromFile || titleCase(cover) || "Imported adventure";
}

function readsAsWords(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => word.length <= 14 && !/[\ufb00-\ufb06]|[a-z][A-Z]{2}/.test(word));
}

// A title printed in capitals ("8. PRESSURE PLATE") in the case a record
// is named in ("8. Pressure Plate"); anything already in mixed case is left.
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with"]);
export function titleCase(text: string): string {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3 || letters !== letters.toUpperCase()) return text;
  return text
    .toLowerCase()
    .split(/(\s+)/)
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word) ? word : word.replace(/^([("'\[]?)([a-z])/, (_, lead: string, first: string) => lead + first.toUpperCase())))
    .join("");
}

// The biggest words on the first two pages: the cover's title.
function coverTitle(blocks: Block[]): string {
  const cover = blocks.filter((block) => block.page <= 2 && block.kind === "heading" && plain(block.text).length >= 3 && plain(block.text).length <= 80);
  cover.sort((a, b) => b.size - a.size);
  return plain(cover[0]?.text ?? "");
}

// Too many lore entries for one workshop: the smallest are folded into the
// entry before them (their neighbour in the book) until the count fits.
function* mergeLore(entries: DraftRecord[], limit: number): Generator<void, DraftRecord[]> {
  const out = [...entries];
  while (out.length > limit) {
    yield;
    let smallest = 1;
    for (let index = 2; index < out.length; index += 1) {
      if (String(out[index].data.body).length < String(out[smallest].data.body).length) smallest = index;
    }
    const into = out[smallest - 1];
    const body = `${String(into.data.body)}\n\n**${out[smallest].name}**\n\n${String(out[smallest].data.body)}`;
    if (body.length > LORE_MAX) {
      // Nothing small enough to fold: the last ones are dropped, and the
      // review says so.
      out.length = limit;
      break;
    }
    into.data = { ...into.data, body };
    into.pages = [...new Set([...into.pages, ...out[smallest].pages])].sort((a, b) => a - b);
    out.splice(smallest, 1);
  }
  return out;
}
