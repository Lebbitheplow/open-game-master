// Reads Wizards of the Coast's Spanish SRD 5.1 (SRD_CC_v5.1_ES.pdf) into
// styled blocks, for scripts/import-srd-rulebook-es.mjs.
//
// The PDF is tagged: its structure tree names every paragraph, table, list
// and most headings in reading order, which poppler prints with
// `pdfinfo -struct-text`. The tree carries no type: a chapter title is a
// plain paragraph in it, and nothing says which words are bold or italic.
// `pdftohtml -xml` prints the same words in the same order with each line's
// font, so the two are walked together, letter by letter, and every letter of
// the tree takes the font the page printed it in. What the tree leaves out
// (the running feet, the page numbers) is skipped on the way.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIG = { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" };

export function readPdf(pdfPath) {
  let struct;
  let xml;
  const dir = mkdtempSync(join(tmpdir(), "srd-es-"));
  try {
    struct = execFileSync("pdfinfo", ["-struct-text", pdfPath], BIG);
    execFileSync("pdftohtml", ["-xml", "-i", "-q", "-fontfullname", pdfPath, join(dir, "book")], BIG);
    xml = readFileSync(join(dir, "book.xml"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("pdfinfo and pdftohtml (poppler-utils) are needed to read the PDF");
    }
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const blocks = parseStruct(struct);
  const report = applyStyles(blocks, parseXml(xml));
  return { blocks, report };
}

// ---- the structure tree ----

// One node per line, nested by indentation: `P (block)`, `TH:` with its
// attributes on the lines below, and the text itself in quotes.
function parseStruct(text) {
  const root = { tag: "Document", children: [], indent: -1 };
  const stack = [root];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (body.startsWith("/")) continue; // an attribute of the node above
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (body.startsWith('"')) {
      parent.children.push({ text: body.slice(1, body.lastIndexOf('"')) });
      continue;
    }
    const tag = /^([A-Za-z0-9]+)/.exec(body)?.[1];
    if (!tag || tag === "Object") continue;
    const node = { tag, children: [], indent };
    parent.children.push(node);
    stack.push(node);
  }
  const blocks = [];
  collect(root, blocks);
  return blocks;
}

function textOf(node) {
  if (node.text !== undefined) return node.text;
  return node.children.map(textOf).join("");
}

// A cell's paragraphs are kept apart by a line break (the tree prints them
// as separate nodes, with nothing between).
const cell = (node) => ({ raw: node.children.map(textOf).join("\n"), header: node.tag === "TH" });

function collect(node, blocks) {
  for (const child of node.children) {
    if (child.text !== undefined) continue;
    if (/^H[1-6]$/.test(child.tag)) {
      blocks.push({ type: "text", tag: child.tag, raw: textOf(child) });
    } else if (child.tag === "P") {
      blocks.push({ type: "text", tag: "P", raw: textOf(child) });
    } else if (child.tag === "Table") {
      const rows = child.children.filter((row) => row.tag === "TR").map((row) => row.children.filter((each) => each.tag === "TH" || each.tag === "TD").map(cell));
      blocks.push({ type: "table", rows });
    } else if (child.tag === "L") {
      blocks.push({ type: "list", items: child.children.filter((item) => item.tag === "LI").map((item) => ({ raw: textOf(item) })) });
    } else {
      collect(child, blocks);
    }
  }
}

// Every piece of text a block holds, in the order the tree reads it.
export function piecesOf(block) {
  if (block.type === "text") return [block];
  if (block.type === "table") return block.rows.flat();
  return block.items;
}

// ---- the printed page ----

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text) => text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, name) => {
  if (name[0] === "#") return String.fromCodePoint(name[1] === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  return ENTITIES[name] ?? whole;
});

// The page's letters in print order, each with its font: [char, styleIndex].
function parseXml(xml) {
  const end = xml.indexOf("<outline>");
  const body = end > 0 ? xml.slice(0, end) : xml;
  const fonts = new Map();
  const styles = [];
  const styleIds = new Map();
  const chars = [];
  const styleOf = (font, bold, italic) => {
    const spec = fonts.get(font) ?? { size: 0, family: "", color: "" };
    const key = `${spec.size}|${spec.family}|${spec.color}|${bold}|${italic}`;
    let id = styleIds.get(key);
    if (id === undefined) {
      id = styles.length;
      styles.push({ size: spec.size, family: spec.family, color: spec.color, bold: bold || /Bold/.test(spec.family), italic: italic || /Italic/.test(spec.family) });
      styleIds.set(key, id);
    }
    return id;
  };
  const line = /<fontspec id="(\d+)" size="(-?\d+)" family="([^"]*)" color="([^"]*)"\/>|<text [^>]*font="(\d+)"[^>]*>(.*?)<\/text>/gs;
  for (const match of body.matchAll(line)) {
    if (match[1] !== undefined) {
      fonts.set(match[1], { size: Number(match[2]), family: match[3].replace(/^[A-Z]{6}\+/, ""), color: match[4] });
      continue;
    }
    let bold = 0;
    let italic = 0;
    for (const part of match[6].split(/(<[^>]+>)/)) {
      if (!part) continue;
      if (part[0] === "<") {
        if (part === "<b>") bold += 1;
        else if (part === "</b>") bold -= 1;
        else if (part === "<i>") italic += 1;
        else if (part === "</i>") italic -= 1;
        continue;
      }
      const style = styleOf(match[5], bold > 0, italic > 0);
      for (const char of decode(part).normalize("NFC")) {
        if (!/\s/.test(char)) chars.push([char, style]);
      }
    }
  }
  return { chars, styles };
}

// ---- the two walked together ----

// What a piece reads as when the page prints it somewhere the walk cannot
// follow (a title set at the head of the next page, ahead of the column that
// ends before it): its words, in no font.
const PLAIN = { size: 0, family: "", color: "", bold: false, italic: false };

// Gives every piece `runs`: its text cut where the font changes, each run
// { text, size, family, color, bold, italic }. A letter the page does not
// print where the tree says it (a bullet drawn in a symbol font) takes the
// font of the letter before it.
function applyStyles(blocks, page) {
  const { chars, styles } = page;
  const one = (char) => (char.length > 1 ? "\uFFFD" : char);
  const pageText = chars.map(([char]) => one(char)).join("");
  let at = 0;
  let unmatched = 0;
  let total = 0;
  let last = 0;
  const lost = [];
  for (const block of blocks) {
    for (const piece of piecesOf(block)) {
      const letters = [...piece.raw.normalize("NFC")];
      const solid = letters.filter((char) => !/\s/.test(char)).map(one).join("");
      const styleAt = [];
      let seen = 0;
      let given = false;
      for (const char of letters) {
        if (/\s/.test(char)) {
          styleAt.push(-1);
          continue;
        }
        total += 1;
        if (!given && pageText[at] !== one(char)) {
          // The tree and the page part ways here. Either the tree holds a
          // letter the page prints otherwise (skip it), or the page holds
          // words the tree leaves out (find where this piece goes on).
          let found = -1;
          let skipped = 0;
          for (let skip = 1; skip <= 3 && found < 0; skip += 1) {
            const key = solid.slice(seen + skip, seen + skip + 8);
            if (key.length >= 4 && pageText.startsWith(key, at)) {
              found = at;
              skipped = skip;
            }
          }
          for (let skip = 0; skip <= 3 && found < 0; skip += 1) {
            const key = solid.slice(seen + skip, seen + skip + 24);
            if (key.length < 5) break;
            const index = pageText.indexOf(key, at);
            if (index >= 0 && index - at < 40000) {
              found = index;
              skipped = skip;
            }
          }
          if (found < 0) {
            given = true;
            piece.lost = true;
            lost.push(piece.raw.trim().slice(0, 60));
          } else {
            at = found;
            if (skipped > 0) {
              // This letter is one the page does not print here.
              unmatched += 1;
              styleAt.push(last);
              seen += 1;
              continue;
            }
          }
        }
        if (!given && pageText[at] === one(char)) {
          last = chars[at][1];
          at += 1;
        } else {
          unmatched += 1;
        }
        styleAt.push(last);
        seen += 1;
      }
      piece.runs = piece.lost ? [{ text: letters.join(""), ...PLAIN }] : runsOf(letters, styleAt, styles);
    }
  }
  return { letters: total, unmatched, pageLetters: chars.length, pageLettersRead: at, lost };
}

function runsOf(letters, styleAt, styles) {
  const runs = [];
  let current = null;
  // A space takes the font of the letter after it, so a run never starts
  // with the tail of the one before.
  let next = -1;
  const resolved = new Array(letters.length);
  for (let index = letters.length - 1; index >= 0; index -= 1) {
    if (styleAt[index] >= 0) next = styleAt[index];
    resolved[index] = styleAt[index] >= 0 ? styleAt[index] : next;
  }
  for (let index = 0; index < letters.length; index += 1) {
    const style = resolved[index] >= 0 ? resolved[index] : (current?.style ?? 0);
    if (!current || current.style !== style) {
      current = { style, text: "" };
      runs.push(current);
    }
    current.text += letters[index];
  }
  return runs.map((run) => ({ text: run.text, ...styles[run.style] }));
}

// The font most of a piece's letters are printed in.
export function mainStyle(piece) {
  const weight = new Map();
  for (const run of piece.runs ?? []) {
    const key = `${run.size}|${run.family}|${run.color}|${run.bold}|${run.italic}`;
    const count = run.text.replace(/\s/g, "").length;
    weight.set(key, { count: (weight.get(key)?.count ?? 0) + count, run });
  }
  let best = null;
  for (const entry of weight.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.run ?? null;
}

// What a block is, by the font it is printed in: the print's own hierarchy,
// which the tags only partly carry (a chapter title is a plain paragraph in
// the tree, a monster's name an H2 like its group's).
//   T0  a chapter or class title (Calibri 39, red)
//   T1  a section (27, red)            T2  a subsection (21, red)
//   T3  an entry or a sub-subsection (18, red)
//   T3m a stat block's name (18, red, bold)
//   CAP a table's caption (18, black, bold)
//   SUB a stat block's section, "Acciones" (17, black, bold)
//   SB  a sidebar's title (17, black, tagged as a heading)
export function kindOf(block) {
  if (block.kind) return block.kind;
  if (block.type !== "text") return block.type;
  if (!block.raw.trim()) return "blank";
  const style = mainStyle(block);
  if (!style || block.lost) return "p";
  const red = /^#9[34]3634$/.test(style.color);
  const calibri = /Calibri/.test(style.family);
  if (red && style.size >= 39) return "T0";
  if (red && (style.size === 27 || style.size === 20)) return "T1";
  if (red && style.size === 21) return "T2";
  if (red && style.size === 18) return style.bold ? "T3m" : "T3";
  if (!red && calibri && style.size === 18 && style.bold) return "CAP";
  if (!red && calibri && style.size === 17 && style.bold) return "SUB";
  if (!red && calibri && style.size === 17 && /^H/.test(block.tag)) return "SB";
  return "p";
}
