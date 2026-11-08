import type { Block } from "./layout-logic.ts";

// Roll tables and keyed areas, the two structures an adventure prints in a
// shape that can be read without a model. Pure.

export type RollEntry = { min: number; max: number; text: string };
export type FoundRollTable = { name: string; die: number; entries: RollEntry[]; page: number; block: Block };

const DIE_HEADER = /^(?:1?d(4|6|8|10|12|20|100)|d%|%)$/i;
const RANGE = /^(\d{1,3})(?:\s*[–—-]\s*(\d{1,3}))?$/;
const plain = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

function rangeOf(cell: string, die: number): { min: number; max: number } | null {
  const value = cell.trim().replace(/[–—]/g, "-");
  // "00" on a d100 is the hundred.
  if (value === "00" && die === 100) return { min: 100, max: 100 };
  const match = RANGE.exec(value);
  if (!match) return null;
  const read = (text: string) => (text === "00" && die === 100 ? 100 : Number(text));
  const min = read(match[1]);
  const max = match[2] ? read(match[2]) : min;
  return min >= 1 && max >= min && max <= 1_000 ? { min, max } : null;
}

// A table block whose first column is a die header ("d6", "d100") and die
// ranges ("1", "2–3", "01–05"), or one with no header whose ranges run from
// 1 up to a die's size. The table's name is the title printed just above it.
export function rollTableOf(block: Block, title: string): FoundRollTable | null {
  const rows = sideBySide(block.rows ?? []);
  if (rows.length < 3) return null;
  let die = 0;
  let body = rows;
  const header = DIE_HEADER.exec(plain(rows[0][0] ?? ""));
  if (header) {
    die = header[1] ? Number(header[1]) : 100;
    body = rows.slice(1);
  }
  const entries: RollEntry[] = [];
  for (const row of body) {
    const range = rangeOf(plain(row[0] ?? ""), die || 100);
    const text = plain(row.slice(1).join(" | "));
    if (!range) {
      // A wrapped row: its words belong to the entry above.
      const last = entries[entries.length - 1];
      const words = plain(row.join(" "));
      if (last && words) last.text = `${last.text} ${words}`.trim();
      continue;
    }
    if (!text) continue;
    entries.push({ ...range, text: text.slice(0, 300) });
  }
  if (entries.length < 3) return null;
  const top = Math.max(...entries.map((entry) => entry.max));
  if (!die) {
    die = [4, 6, 8, 10, 12, 20, 100].find((size) => size >= top) ?? 0;
    // Without a header, the rows must start at 1 and reach the die's size,
    // or this is a level table or a price list.
    if (!die || entries[0].min !== 1 || top !== die) return null;
  }
  const name = plain(title || (header ? plain(rows[0].slice(1).join(" ")) : "")) || `d${die} table`;
  return { name: name.slice(0, 120), die, entries: entries.slice(0, 100), page: block.page, block };
}

// Two short tables printed side by side ("d10 | Damage | d10 | Damage")
// read as one table of twice the rows.
function sideBySide(rows: string[][]): string[][] {
  const head = rows[0] ?? [];
  const half = head.length / 2;
  if (head.length < 4 || head.length % 2 || !DIE_HEADER.test(plain(head[0] ?? "")) || !DIE_HEADER.test(plain(head[half] ?? ""))) return rows;
  const left = rows.map((row) => row.slice(0, half));
  const right = rows.slice(1).map((row) => row.slice(half)).filter((row) => row.some((cell) => cell.trim()));
  return [...left, ...right];
}

// The title above a block: the nearest run-in heading or short bold line
// before it in the same section.
export function titleAbove(blocks: Block[], index: number): string {
  for (let back = index - 1; back >= 0 && back >= index - 3; back -= 1) {
    const block = blocks[back];
    if (block.kind === "heading") return plain(block.text);
    if (block.bold && plain(block.text).length <= 80) return plain(block.text);
    if (block.kind === "text" && plain(block.text).length > 80) break;
  }
  return "";
}

export type FoundArea = {
  key: string;
  name: string;
  // The area's own blocks, title first.
  blocks: Block[];
  page: number;
};

// "1. Entrance", "A3. Guard Post", "12a. Pool": the keyed areas of a site.
const AREA_TITLE = /^([A-Z]{0,2}\d{1,3}[a-z]?)\.\s+(.{2,80}?)\.?$/;
const AREA_LEAD = /^\*\*([A-Z]{0,2}\d{1,3}[a-z]?)\.\s+([^*]{2,80}?)\.?\*\*/;
// "(1) Outdoors. Grass and shrubs.": the key in brackets, the room's name
// its first sentence.
const AREA_BRACKET = /^\*{0,2}\(([A-Z]{0,2}\d{1,3}[a-z]?)\)\*{0,2}\s+([^.]{2,60})\./;

export function areaTitle(block: Block): { key: string; name: string } | null {
  if (block.kind === "heading") {
    const match = AREA_TITLE.exec(plain(block.text));
    return match ? { key: match[1], name: match[2].trim() } : null;
  }
  const lead = AREA_LEAD.exec(block.text.trim());
  if (lead) return { key: lead[1], name: lead[2].trim() };
  const bracket = AREA_BRACKET.exec(block.text.trim());
  return bracket ? { key: bracket[1], name: bracket[2].trim() } : null;
}

// The keyed areas in a run of blocks: each from its title to the next.
// Two or more make a keyed site; one alone is a numbered paragraph.
export function findAreas(blocks: Block[]): FoundArea[] {
  const out: FoundArea[] = [];
  let current: FoundArea | null = null;
  for (const block of blocks) {
    const title = areaTitle(block);
    if (title) {
      current = { key: title.key, name: title.name, blocks: [block], page: block.page };
      out.push(current);
      continue;
    }
    if (current && block.kind === "heading" && block.level <= 3) current = null;
    else if (current) current.blocks.push(block);
  }
  return out.length >= 2 ? out : [];
}
