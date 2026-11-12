import type { Block } from "./layout-logic.ts";
import type { OutlineItem } from "./reading.ts";

// The book as a tree of sections: every heading of levels 1 to 3 opens one,
// and a section holds the blocks up to the next heading at its level or
// above. Run-in titles (level 4) stay inside as bold lines. The bookmarks,
// when the book has them, settle how deep a heading sits: a title that is
// also a top bookmark is a chapter whatever its size. Pure.

export type Section = {
  id: number;
  title: string;
  level: number;
  parent: number | null;
  // Titles from the chapter down, this one last.
  path: string[];
  pageStart: number;
  pageEnd: number;
  // The heading that opened it (absent for the front matter): a monster's
  // name is its section's heading, and its stat block starts there.
  heading?: Block;
  blocks: Block[];
};

const clean = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const key = (text: string) => clean(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function sectionsOf(blocks: Block[], outline: OutlineItem[] = []): Section[] {
  const outlineDepth = new Map<string, number>();
  for (const item of outline) {
    const k = key(item.title);
    if (k && !outlineDepth.has(k)) outlineDepth.set(k, item.depth);
  }
  const sections: Section[] = [];
  const front: Section = { id: 0, title: "Front matter", level: 0, parent: null, path: [], pageStart: blocks[0]?.page ?? 1, pageEnd: blocks[0]?.page ?? 1, blocks: [] };
  sections.push(front);
  const open: Section[] = [front];
  for (const block of blocks) {
    const heading = block.kind === "heading" && block.level >= 1 && block.level <= 3;
    if (heading) {
      const depth = outlineDepth.get(key(block.text));
      const level = depth !== undefined ? Math.min(3, depth + 1) : block.level;
      while (open.length > 1 && open[open.length - 1].level >= level) open.pop();
      const parent = open[open.length - 1];
      const title = clean(block.text).slice(0, 200);
      const section: Section = {
        id: sections.length,
        title,
        level,
        parent: parent.id,
        path: [...parent.path, title],
        pageStart: block.page,
        pageEnd: block.page,
        heading: block,
        blocks: [],
      };
      sections.push(section);
      open.push(section);
      continue;
    }
    for (const holder of open) holder.pageEnd = Math.max(holder.pageEnd, block.page);
    open[open.length - 1].blocks.push(block);
  }
  return sections.filter((section) => section.id === 0 ? section.blocks.length > 0 : true);
}

// A section's own words as plain text the GM and the model can read:
// run-in titles bold, boxed text quoted, tables as rows. `skip` leaves out
// blocks already lifted into records (stat blocks), each replaced by one
// line saying what stood there.
export function sectionText(section: Section, skip: Map<Block, string> = new Map()): string {
  const out: string[] = [];
  const noted = new Set<string>();
  for (const block of section.blocks) {
    const replaced = skip.get(block);
    if (replaced !== undefined) {
      if (replaced && !noted.has(replaced)) {
        out.push(replaced);
        noted.add(replaced);
      }
      continue;
    }
    if (block.kind === "heading") out.push(`**${clean(block.text)}**`);
    else if (block.kind === "boxed") out.push(block.text.split("\n").map((line) => `> ${line}`).join("\n"));
    else out.push(block.text);
  }
  return out.join("\n\n").trim();
}

// The sections under one (its children, grandchildren and so on).
export function descendants(sections: Section[], id: number): Section[] {
  const out: Section[] = [];
  const parents = new Set([id]);
  for (const section of sections) {
    if (section.parent !== null && parents.has(section.parent)) {
      out.push(section);
      parents.add(section.id);
    }
  }
  return out;
}
