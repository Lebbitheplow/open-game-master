// The Spanish print's styled blocks (srd-es-pdf.mjs) as the rulebook's
// markdown, in the forms the English book already uses and the reader parses
// (src/lib/rulebook/markdown.ts): `**Table- Caption**` over a table, `># Title`
// for a sidebar, `###### Acciones` inside a stat block, `***Name.***` for a
// trait's lead-in. The words are the print's own; only the marks are added.
import { kindOf, mainStyle, piecesOf } from "./srd-es-pdf.mjs";

export const squeeze = (text) => text.replace(/[\s\u00a0]+/g, " ").replace(/\u00ad/g, "").trim();

// The print breaks some ninety words with a hyphen that stayed in the text
// when the line was set again («pun-tuaciones», «mágica-mente»). Every
// hyphen between two lowercase letters is such a break, but for the few
// words that are spelled with one.
const SPELLED_WITH_A_HYPHEN = /^(?:histórico-fantásticos|amarillo-verdosa|yuan-tis?|humanoide-\p{L}+|systems-reference|Urb-luu)$/u;
const mend = (text) => text.replace(/\p{L}*\p{Ll}-\p{Ll}\p{L}*/gu, (word) => (SPELLED_WITH_A_HYPHEN.test(word) ? word : word.replace("-", "")));

// A paragraph the print carries over a column or a page comes as two: the
// first stops in the middle of its sentence and the second goes on in lower
// case. Joined again.
function carriesOn(before, after) {
  if (before.split(" ").length < 8 || /[.:;!?\u2026\u201d»)\]*|]$/.test(before)) return false;
  if (/^\p{Ll}/u.test(after)) return true;
  return /^[\d(]/.test(after) && /[\p{Ll},]$/u.test(before);
}

// A piece's words with its bold and italic runs marked. `plain` leaves the
// marks out (a heading, a table's header cell: the type is the heading's own).
export function inline(piece, plain = false) {
  const parts = [];
  for (const run of piece.runs ?? [{ text: piece.raw }]) {
    const last = parts[parts.length - 1];
    // Spaces and punctuation between two runs ride with the run before them,
    // so a mark never opens or closes on a space.
    if (last && !/[\p{L}\p{N}]/u.test(run.text)) {
      last.text += run.text;
      continue;
    }
    const bold = !plain && Boolean(run.bold);
    const italic = !plain && Boolean(run.italic);
    if (last && last.bold === bold && last.italic === italic) last.text += run.text;
    else parts.push({ text: run.text, bold, italic });
  }
  let out = "";
  for (const part of parts) {
    const text = part.text.replace(/[\s\u00a0]+/g, " ").replace(/\u00ad/g, "");
    const mark = part.bold && part.italic ? "***" : part.bold ? "**" : part.italic ? "*" : "";
    const lead = /^\s*/.exec(text)[0];
    const core = text.trim();
    const tail = core ? /\s*$/.exec(text)[0] : "";
    out += mark && core ? `${lead}${mark}${core}${mark}${tail}` : text;
  }
  return mend(squeeze(out));
}

const ABILITIES = "FUE DES CON INT SAB CAR";
const SCORES = /^(?:\d+ \([+\u2212\u2013-]\d+\) ?){6}$/;

function abilityTable(scores) {
  const cells = scores.match(/\d+ \([+\u2212\u2013-]\d+\)/g);
  return [`| ${ABILITIES.split(" ").join(" | ")} |`, "|:---:|:---:|:---:|:---:|:---:|:---:|", `| ${cells.join(" | ")} |`].join("\n");
}

// A table the print breaks over a column or a page comes as two: the second
// part repeats the header row, or starts straight on a body row. Either way
// its rows go on under the first part's header.
function continues(first, second) {
  if (!first || first.rows[0].length !== second.rows[0].length) return 0;
  const header = (row) => row.map((cell) => squeeze(cell.raw)).join("|");
  if (header(first.rows[0]) === header(second.rows[0])) return 1;
  return second.rows[0].some((cell) => cell.header) && second.rows[0].every((cell, at) => cell.header === (at === 0 || first.rows[0].every((each) => each.header) === false)) ? 0 : second.rows[0].every((cell) => !cell.header) && first.rows[0].every((cell) => cell.header) ? 0.5 : 0;
}

function table(block) {
  let rows = block.rows.map((row) => row.map((cell) => inline(cell, cell.header).replace(/\|/g, "\\|")));
  const width = Math.max(...rows.map((row) => row.length));
  // A class table's header is two rows in print: the columns' names with one
  // cell spanning the spell levels («Espacios de conjuro por cada nivel de
  // conjuro»), then the levels under it. Drawn as one row, as the English
  // book has it: the names, then the levels.
  const levels = rows[1]?.filter(Boolean) ?? [];
  if (rows.length > 2 && /^\u2014.*\u2014$/.test(rows[0][rows[0].length - 1]) && rows[0].length - 1 + levels.length === width) {
    rows = [[...rows[0].slice(0, -1), ...levels.map((level) => level.replace(/\*/g, ""))], ...rows.slice(2)];
  }
  const line = (row) => `| ${Array.from({ length: width }, (_, at) => row[at] ?? "").join(" | ")} |`;
  return [line(rows[0]), `|${"---|".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
}

// A list item's bullet is the list's to draw. Where the print sets it in the
// bold of the item's first words, the bold stays.
const BULLET = /^(\*{1,3})?[\u2022\u00b7\u25aa\u25e6\uf0b7]\s*/;

function list(block) {
  return block.items
    .map((item) => inline(item).replace(BULLET, (_, marks) => marks ?? ""))
    .filter(Boolean)
    .map((text) => (/^\d+\.\s/.test(text) ? text : `- ${text}`))
    .join("\n");
}

// A sidebar's own type: Calibri at the smaller size, where the page around
// it is Cambria, or Calibri a size larger in a stat block.
function inSidebar(block) {
  const piece = piecesOf(block)[0];
  const style = piece && mainStyle(piece);
  return Boolean(style) && /Calibri/.test(style.family) && style.size === 14;
}

// The blocks of one page as chunks: `{ heading, kind, text }` for a heading
// (its level is the binder's to give) and `{ md }` for everything else.
export function chunksOf(blocks) {
  const chunks = [];
  const nextSolid = (from) => {
    let at = from;
    while (at < blocks.length && kindOf(blocks[at]) === "blank") at += 1;
    return at;
  };
  for (let at = 0; at < blocks.length; at += 1) {
    const block = blocks[at];
    const kind = kindOf(block);
    if (kind === "blank") continue;
    if (kind === "table") {
      // Parts of one table are joined before it is drawn.
      const whole = { rows: [...block.rows] };
      for (let next = nextSolid(at + 1); next < blocks.length && kindOf(blocks[next]) === "table"; next = nextSolid(at + 1)) {
        const how = continues(whole, blocks[next]);
        if (!how) break;
        whole.rows.push(...blocks[next].rows.slice(how === 1 ? 1 : 0));
        at = next;
      }
      chunks.push({ md: table(whole) });
    } else if (kind === "list") {
      const md = list(block);
      if (md) chunks.push({ md });
    } else if (kind === "SB") {
      const inner = [];
      let end = at + 1;
      for (let next = nextSolid(end); next < blocks.length && ["p", "list", "table"].includes(kindOf(blocks[next])) && inSidebar(blocks[next]); next = nextSolid(end)) {
        inner.push(blocks[next]);
        end = next + 1;
      }
      const body = chunksOf(inner).map((chunk) => chunk.md.split("\n").map((line) => `>${line}`).join("\n"));
      chunks.push({ md: [`># ${squeeze(block.raw)}`, ...body].join("\n>\n") });
      at = end - 1;
    } else if (kind === "CAP") {
      const next = nextSolid(at + 1);
      const captions = next < blocks.length && kindOf(blocks[next]) === "table";
      chunks.push({ md: captions ? `**Table- ${squeeze(block.raw)}**` : `**${squeeze(block.raw)}**` });
    } else if (kind === "p") {
      const text = squeeze(block.raw);
      const next = nextSolid(at + 1);
      if (text === ABILITIES && next < blocks.length && SCORES.test(squeeze(blocks[next].raw ?? ""))) {
        chunks.push({ md: abilityTable(squeeze(blocks[next].raw)) });
        at = next;
        continue;
      }
      const md = inline(block);
      const last = chunks[chunks.length - 1];
      if (md && last?.prose && carriesOn(last.md, md)) last.md = `${last.md} ${md}`;
      else if (md) chunks.push({ md, prose: true });
    } else {
      chunks.push({ heading: true, kind, text: mend(squeeze(block.raw)) });
    }
  }
  return chunks;
}

// The levels the print's own hierarchy gives a page's headings when the
// English page does not have the same count to borrow from.
const OWN_LEVEL = { T0: 1, T1: 1, T2: 2, T3: 3, T3m: 4, SUB: 6 };

// The page's markdown. `levels` are the English page's heading levels in
// order: the two prints set the same headings in the same order on almost
// every page, so each Spanish heading takes the level the reader already
// draws its English twin at; where they do not, `own` says the levels.
// Returns the markdown and whether the levels were borrowed.
export function render(chunks, levels, own = OWN_LEVEL) {
  const headings = chunks.filter((chunk) => chunk.heading);
  const borrowed = headings.length === levels.length;
  let nth = 0;
  const parts = chunks.map((chunk) => {
    if (!chunk.heading) return chunk.md;
    const level = borrowed ? levels[nth] : (own[chunk.kind] ?? OWN_LEVEL[chunk.kind]);
    nth += 1;
    return `${"#".repeat(level)} ${chunk.text}`;
  });
  return { md: parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim(), borrowed, headings: headings.length };
}

// An English page's heading levels, sidebars' own titles left out.
export function headingLevels(md) {
  return [...md.matchAll(/^(#{1,6}) /gm)].map((match) => match[1].length);
}
