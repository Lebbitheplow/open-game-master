import { finish } from "./slices-logic.ts";
import type { Box, ReadFont, ReadPage, Run } from "./reading.ts";

// A book's pages in reading order: runs become lines, lines become
// paragraphs, and each paragraph knows whether it is a heading (and how
// deep), body text, a tinted box (read-aloud text, a sidebar) or a table.
// Two-column pages, full-width chapter titles between them, running heads
// and page numbers are what adventure books are made of, so they are what
// this handles. Pure.

export type BlockKind = "heading" | "text" | "boxed" | "table";

export type Block = {
  page: number;
  kind: BlockKind;
  // 1 is a chapter, 4 a bold run-in title at body size. 0 for non-headings.
  level: number;
  text: string;
  // A table's cells, row by row.
  rows?: string[][];
  // Which tinted box on its page holds it (boxed blocks only).
  box?: number;
  size: number;
  bold: boolean;
  italic: boolean;
  // Where it sits on its page (top-left points), for the pictures beside it.
  x: number;
  y: number;
  w: number;
  h: number;
};

type Segment = {
  runs: Run[];
  x: number;
  right: number;
  y: number;
  size: number;
};

type Line = {
  cells: Segment[];
  x: number;
  right: number;
  y: number;
  size: number;
  text: string;
  bold: boolean;
  italic: boolean;
  lead: string;
  box: number;
  allCaps: boolean;
};

const round1 = (value: number) => Math.round(value * 2) / 2;

// The size most of the book's letters are set in.
export function bodySize(pages: ReadPage[]): number {
  const weight = new Map<number, number>();
  for (const page of pages) {
    for (const run of page.runs) {
      const size = round1(run.z);
      weight.set(size, (weight.get(size) ?? 0) + run.s.length);
    }
  }
  let best = 10;
  let bestWeight = -1;
  for (const [size, total] of weight) {
    if (total > bestWeight) {
      best = size;
      bestWeight = total;
    }
  }
  return best;
}

const furnitureKey = (text: string) => text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

// Running heads and feet: short lines in the top or bottom margin that
// repeat on several pages once their numbers are set aside, and page
// numbers on their own.
export function furnitureLines(pages: ReadPage[]): Set<string> {
  return finish(furnitureWork(pages));
}

function* furnitureWork(pages: ReadPage[]): Generator<void, Set<string>> {
  const seen = new Map<string, Set<number>>();
  for (const page of pages) {
    yield;
    for (const segment of segmentsOf(page.runs)) {
      if (segment.y > page.h * 0.08 && segment.y < page.h * 0.93) continue;
      const key = `${segment.y < page.h / 2 ? "t" : "b"}:${furnitureKey(textOf(segment.runs))}`;
      const pagesWith = seen.get(key) ?? new Set<number>();
      pagesWith.add(page.n);
      seen.set(key, pagesWith);
    }
  }
  const out = new Set<string>();
  for (const [key, pagesWith] of seen) {
    if (pagesWith.size >= Math.min(3, Math.max(2, Math.ceil(pages.length / 4)))) out.add(key);
  }
  return out;
}

function isFurniture(page: ReadPage, segment: Segment, furniture: Set<string>): boolean {
  if (segment.y > page.h * 0.08 && segment.y < page.h * 0.93) return false;
  const text = textOf(segment.runs).trim();
  if (/^(page\s+)?\d{1,4}$/i.test(text)) return true;
  return furniture.has(`${segment.y < page.h / 2 ? "t" : "b"}:${furnitureKey(text)}`);
}

// Runs on one baseline that touch become a segment; a wide gap (a column's
// gutter, a table's cell break) starts another.
function segmentsOf(runs: Run[]): Segment[] {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Run[][] = [];
  for (const run of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - run.y) <= Math.max(1.5, Math.min(row[0].z, run.z) * 0.35)) row.push(run);
    else rows.push([run]);
  }
  const out: Segment[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let current: Run[] = [];
    let right = -Infinity;
    for (const run of row) {
      const gap = run.x - right;
      if (current.length && gap > Math.max(run.z * 1.2, 9)) {
        out.push(segmentFrom(current));
        current = [];
      }
      current.push(run);
      right = Math.max(right, run.x + run.w);
    }
    if (current.length) out.push(segmentFrom(current));
  }
  return out;
}

function segmentFrom(runs: Run[]): Segment {
  const x = Math.min(...runs.map((run) => run.x));
  const right = Math.max(...runs.map((run) => run.x + run.w));
  const y = runs.reduce((sum, run) => sum + run.y, 0) / runs.length;
  let size = 0;
  let longest = -1;
  for (const run of runs) {
    if (run.s.length > longest) {
      longest = run.s.length;
      size = run.z;
    }
  }
  return { runs, x, right, y, size };
}

function textOf(runs: Run[]): string {
  let out = "";
  let right = -Infinity;
  for (const run of runs) {
    const gap = run.x - right;
    if (out && gap > run.z * 0.15 && !out.endsWith(" ") && !run.s.startsWith(" ")) out += " ";
    out += run.s;
    right = run.x + run.w;
  }
  // Soft hyphens and the odd hyphen pair a typesetter leaves behind.
  return out.replace(/\u00ad/g, "").replace(/-\u2010|\u2010/g, "-").replace(/\s+/g, " ").trim();
}

// Tinted panels that hold text: not white, not the page's own backdrop, not
// a hairline. Read-aloud boxes and sidebars are drawn this way.
function panelsOf(page: ReadPage): Box[] {
  return page.boxes.filter((box) => {
    const area = box.w * box.h;
    // Under two lines tall is a table's row stripe or a rule, not a panel.
    if (area > page.w * page.h * 0.85 || box.w < 60 || box.h < 28) return false;
    const r = parseInt(box.c.slice(1, 3), 16);
    const g = parseInt(box.c.slice(3, 5), 16);
    const b = parseInt(box.c.slice(5, 7), 16);
    const light = (r + g + b) / 3;
    // White is the page; near black is ink (a rule, a shadow).
    return light < 250 && light > 40;
  });
}

function panelOf(panels: Box[], x: number, y: number): number {
  let best = -1;
  let bestArea = Infinity;
  panels.forEach((box, index) => {
    if (x >= box.x - 1 && x <= box.x + box.w + 1 && y >= box.y - 1 && y <= box.y + box.h + 1) {
      const area = box.w * box.h;
      if (area < bestArea) {
        best = index;
        bestArea = area;
      }
    }
  });
  return best;
}

// The x-ranges no segment of a band crosses, wide enough to be a gutter and
// away from the margins: where one column ends and the next begins.
function columnsOf(segments: Segment[]): Array<[number, number]> {
  if (!segments.length) return [];
  const left = Math.floor(Math.min(...segments.map((segment) => segment.x)));
  const right = Math.ceil(Math.max(...segments.map((segment) => segment.right)));
  const width = right - left;
  if (width < 80) return [[left, right]];
  const cover = new Uint16Array(width + 1);
  for (const segment of segments) {
    for (let x = Math.max(0, Math.floor(segment.x) - left); x <= Math.min(width, Math.ceil(segment.right) - left); x += 1) cover[x] += 1;
  }
  const cuts: number[] = [];
  let start = -1;
  for (let x = 0; x <= width; x += 1) {
    if (cover[x] === 0) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      const gapWidth = x - start;
      const middle = (start + x) / 2;
      if (gapWidth >= 8 && middle > width * 0.18 && middle < width * 0.82) cuts.push(left + middle);
      start = -1;
    }
  }
  const out: Array<[number, number]> = [];
  let from = left;
  for (const cut of cuts) {
    out.push([from, cut]);
    from = cut;
  }
  out.push([from, right]);
  return out;
}

function lineFrom(cells: Segment[], fonts: ReadFont[], panels: Box[]): Line {
  const runs = cells.flatMap((cell) => cell.runs);
  const text = cells.map((cell) => textOf(cell.runs)).join(" ").trim();
  let boldChars = 0;
  let italicChars = 0;
  let total = 0;
  for (const run of runs) {
    const font = fonts[run.f];
    total += run.s.length;
    if (font?.bold) boldChars += run.s.length;
    if (font?.italic) italicChars += run.s.length;
  }
  // A bold label opening a line that is not bold throughout: "Mace." in a
  // stat block, "1. The Gate." in a keyed area.
  let lead = "";
  if (boldChars && boldChars < total) {
    const leading: Run[] = [];
    for (const run of runs) {
      if (!fonts[run.f]?.bold) break;
      leading.push(run);
    }
    lead = textOf(leading);
  }
  const x = Math.min(...cells.map((cell) => cell.x));
  const right = Math.max(...cells.map((cell) => cell.right));
  const y = cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;
  // The size most of the line's letters are set in, so one big initial
  // does not make a heading of a paragraph's first line.
  const bySize = new Map<number, number>();
  for (const run of runs) bySize.set(round1(run.z), (bySize.get(round1(run.z)) ?? 0) + run.s.length);
  const size = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? cells[0].size;
  const letters = text.replace(/[^A-Za-z]/g, "");
  return {
    cells,
    x,
    right,
    y,
    size,
    text,
    bold: total > 0 && boldChars / total >= 0.6,
    italic: total > 0 && italicChars / total >= 0.6,
    lead,
    box: panelOf(panels, (x + right) / 2, y - size / 3),
    allCaps: letters.length >= 3 && letters === letters.toUpperCase(),
  };
}

// Each page's lines, in reading order: bands split by lines that run the
// width of the text, each band read column by column, top to bottom.
function orderedLines(page: ReadPage, fonts: ReadFont[], furniture: Set<string>): Line[] {
  const segments = segmentsOf(page.runs).filter((segment) => !isFurniture(page, segment, furniture));
  if (!segments.length) return [];
  const panels = panelsOf(page);
  const left = Math.min(...segments.map((segment) => segment.x));
  const right = Math.max(...segments.map((segment) => segment.right));
  const span = Math.max(1, right - left);
  const sorted = [...segments].sort((a, b) => a.y - b.y || a.x - b.x);
  const bands: Segment[][] = [];
  let band: Segment[] = [];
  for (const segment of sorted) {
    const wide = (segment.right - segment.x) / span > 0.62;
    if (wide) {
      if (band.length) bands.push(band);
      bands.push([segment]);
      band = [];
    } else band.push(segment);
  }
  if (band.length) bands.push(band);

  const out: Line[] = [];
  for (const group of bands) {
    const columns = columnsOf(group);
    for (const [from, to] of columns) {
      const inColumn = group.filter((segment) => {
        const middle = (segment.x + segment.right) / 2;
        return middle >= from && middle < to + 0.01;
      });
      // Segments on one baseline in one column are one line (table cells).
      const rows: Segment[][] = [];
      for (const segment of inColumn.sort((a, b) => a.y - b.y || a.x - b.x)) {
        const row = rows[rows.length - 1];
        // A big title beside body text on one baseline is not one line with it.
        const alike = row && Math.abs(row[0].size - segment.size) <= Math.max(row[0].size, segment.size) * 0.25;
        if (row && alike && Math.abs(row[0].y - segment.y) <= Math.max(1.5, Math.min(row[0].size, segment.size) * 0.35)) row.push(segment);
        else rows.push([segment]);
      }
      for (const row of rows) out.push(lineFrom(row.sort((a, b) => a.x - b.x), fonts, panels));
    }
  }
  return out;
}

const STATBLOCK_WORDS = /^(actions|reactions|bonus actions|legendary actions|lair actions|regional effects|mythic actions)$/i;

// The heading sizes of the book, biggest first: each distinct size set
// clearly above the body is a level.
function headingLevels(lines: Array<Line & { page: number }>, body: number): Map<number, number> {
  const sizes = new Map<number, { count: number; pages: Set<number> }>();
  for (const line of lines) {
    if (line.size >= body * 1.18 && line.text.length <= 120) {
      const size = Math.round(line.size);
      const seen = sizes.get(size) ?? { count: 0, pages: new Set<number>() };
      seen.count += 1;
      seen.pages.add(line.page);
      sizes.set(size, seen);
    }
  }
  // A size set only on the first two pages is the cover's (the book's title
  // in huge letters): a chapter title is still level 1 below it.
  const lastPage = Math.max(0, ...lines.map((line) => line.page));
  const cover = new Set([...sizes].filter(([, seen]) => lastPage > 3 && [...seen.pages].every((page) => page <= 2)).map(([size]) => size));
  const ranked = [...sizes.keys()].filter((size) => !cover.has(size)).sort((a, b) => b - a);
  const out = new Map<number, number>();
  // A run of many big sizes collapses into three levels.
  ranked.forEach((size, index) => out.set(size, Math.min(3, index + 1)));
  for (const size of cover) out.set(size, 1);
  return out;
}

function isHeadingLine(line: Line, body: number): boolean {
  // A scan's text layer reads specks and drop capitals as letters: a
  // heading has at least three of them.
  if (line.text.length > 120 || (line.text.match(/[A-Za-z]/g) ?? []).length < 3) return false;
  if (line.size >= body * 1.18) return true;
  // A run-in title at body size: bold throughout, short, not a sentence.
  if (line.bold && !line.lead && line.text.length <= 70 && !/[.,;:]$/.test(line.text) && line.cells.length === 1) return true;
  return false;
}

// Rows that line up in cells: three or more lines in a row with two or
// more cells, their cell starts in step.
function tableRun(lines: Line[], from: number): number {
  let end = from;
  while (end < lines.length && lines[end].cells.length >= 2) end += 1;
  if (end - from < 3) return from;
  return end;
}

export function* layoutWork(pages: ReadPage[], fonts: ReadFont[]): Generator<void, Block[]> {
  const body = bodySize(pages);
  const furniture = yield* furnitureWork(pages);
  const perPage: Array<{ page: ReadPage; lines: Line[] }> = [];
  for (const page of pages) {
    perPage.push({ page, lines: orderedLines(page, fonts, furniture) });
    yield;
  }
  const levels = headingLevels(
    perPage.flatMap((entry) => entry.lines.map((line) => ({ ...line, page: entry.page.n }))),
    body,
  );
  const blocks: Block[] = [];
  for (const { page, lines } of perPage) {
    yield;
    let index = 0;
    let open: { block: Block; last: Line } | null = null;
    const close = () => {
      if (open) blocks.push(open.block);
      open = null;
    };
    while (index < lines.length) {
      const line = lines[index];
      const tableEnd = tableRun(lines, index);
      if (tableEnd > index) {
        close();
        const rows = lines.slice(index, tableEnd).map((row) => row.cells.map((cell) => textOf(cell.runs)));
        const first = lines[index];
        const last = lines[tableEnd - 1];
        blocks.push({
          page: page.n,
          kind: "table",
          level: 0,
          text: rows.map((row) => row.join(" | ")).join("\n"),
          rows,
          size: first.size,
          bold: false,
          italic: false,
          x: Math.min(...lines.slice(index, tableEnd).map((row) => row.x)),
          y: first.y - first.size,
          w: Math.max(...lines.slice(index, tableEnd).map((row) => row.right)) - first.x,
          h: last.y - first.y + first.size,
        });
        index = tableEnd;
        continue;
      }
      const heading = isHeadingLine(line, body) && !STATBLOCK_WORDS.test(line.text);
      const kind: BlockKind = heading ? "heading" : line.box >= 0 ? "boxed" : "text";
      const level = heading ? (line.size >= body * 1.18 ? (levels.get(Math.round(line.size)) ?? 3) : 4) : 0;
      const current = open as { block: Block; last: Line } | null;
      if (current) {
        const previous = current.last;
        const gap = line.y - previous.y;
        const leading = Math.max(previous.size, line.size) * 1.65;
        const sameKind = current.block.kind === kind && current.block.level === level && (kind !== "boxed" || current.block.box === line.box);
        const indented = line.x > previous.x + line.size * 0.8 && previous.x <= current.block.x + 1;
        // A bold label opens a new paragraph: "Mace.", "Treasure:", and a
        // key in brackets ("(2)") or numbered ("2.").
        const startsLabel = Boolean(line.lead) && (/[.:]$/.test(line.lead) || /^\(?[A-Z]{0,2}\d{1,3}[a-z]?\)?$/.test(line.lead.trim()));
        const continues =
          sameKind &&
          gap > 0 &&
          gap <= leading &&
          Math.abs(line.size - previous.size) < 0.6 &&
          !indented &&
          (kind === "heading" || !startsLabel) &&
          // A stat block's labels ("Armor Class", "Hit Points") each open a line.
          !(line.lead && /^(armor class|hit points|speed|saving throws|skills|senses|languages|challenge|damage|condition)/i.test(line.lead));
        if (continues) {
          const joined = joinLines(current.block.text, line);
          current.block.text = joined;
          current.block.w = Math.max(current.block.x + current.block.w, line.right) - Math.min(current.block.x, line.x);
          current.block.x = Math.min(current.block.x, line.x);
          current.block.h = line.y - current.block.y;
          current.last = line;
          index += 1;
          continue;
        }
      }
      close();
      open = {
        block: {
          page: page.n,
          kind,
          level,
          text: lineText(line),
          ...(kind === "boxed" ? { box: line.box } : {}),
          size: line.size,
          bold: line.bold,
          italic: line.italic,
          x: line.x,
          y: line.y - line.size,
          w: line.right - line.x,
          h: line.size * 1.2,
        },
        last: line,
      };
      index += 1;
    }
    close();
  }
  return mergeAcrossPages(blocks);
}

export function layoutBlocks(pages: ReadPage[], fonts: ReadFont[]): Block[] {
  return finish(layoutWork(pages, fonts));
}

// The line's words, with a bold label kept as **Label.** so the readers
// downstream (stat blocks, keyed areas, the model) can see it.
function lineText(line: Line): string {
  if (line.lead && line.text.startsWith(line.lead)) return `**${line.lead}** ${line.text.slice(line.lead.length).trim()}`.trim();
  return line.text;
}

function joinLines(previous: string, line: Line): string {
  const next = lineText(line);
  // "trea-" then "sure": one word again. "half-" then "Orc" keeps its hyphen.
  if (/[A-Za-z]-$/.test(previous) && /^[a-z]/.test(next)) return previous.slice(0, -1) + next;
  return `${previous} ${next}`;
}

// A paragraph that runs off the bottom of one page (or column) onto the
// next: the next block of the same kind starting lowercase is its rest.
function mergeAcrossPages(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const previous = out[out.length - 1];
    if (
      previous &&
      block.kind === "text" &&
      previous.kind === "text" &&
      /^[a-z]/.test(block.text) &&
      !/[.!?:"”]$/.test(previous.text) &&
      Math.abs(previous.size - block.size) < 0.6
    ) {
      previous.text = /[A-Za-z]-$/.test(previous.text) ? previous.text.slice(0, -1) + block.text : `${previous.text} ${block.text}`;
      continue;
    }
    out.push(block);
  }
  return out;
}
