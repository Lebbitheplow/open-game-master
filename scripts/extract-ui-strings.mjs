#!/usr/bin/env node
// Lists the interface's English text, for the catalog the interface is
// translated from (docs/specs/ogm-italian-ui.md): every JSX text, every
// string a translated attribute holds, and every other string literal in
// src/app and src/components that reads as words. Text built at run time is
// listed apart, as a pattern ("{name}, their turn").
//
//   node scripts/extract-ui-strings.mjs            counts, and what the catalog lacks
//   node scripts/extract-ui-strings.mjs --missing  the missing texts, as JSON
//   node scripts/extract-ui-strings.mjs --patterns the missing patterns, as JSON
//   node scripts/extract-ui-strings.mjs --check    fails when the catalog holds a text no source has
//
// Over-listing costs nothing (an entry no text matches is never used); the
// filter only keeps class names, keys and paths out of the work.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.join(import.meta.dirname, "..");
const SOURCES = ["src/app", "src/components"];
const CATALOG = path.join(ROOT, "src/lib/language/ui-it.json");
const PATTERNS = path.join(ROOT, "src/lib/language/ui-it.patterns.json");

// Attributes whose value is never shown.
const HIDDEN_ATTRIBUTES = new Set(["className", "key", "href", "src", "id", "type", "role", "name", "htmlFor", "rel", "target", "method", "action", "autoComplete", "inputMode", "lang", "dir", "translate", "style", "viewBox", "d", "fill", "stroke", "xmlns", "accept", "pattern", "form", "value", "defaultValue", "variant", "size", "icon", "glyph", "as", "kind", "tone", "side", "align", "mode"]);
// Calls whose string arguments are never shown.
const HIDDEN_CALLS = new Set(["require", "import", "fetch", "cn", "clsx", "querySelector", "querySelectorAll", "closest", "matches", "getItem", "setItem", "removeItem", "addEventListener", "removeEventListener", "getAttribute", "setAttribute", "useRouter", "push", "replace", "get", "has", "delete", "startsWith", "endsWith", "includes", "split", "join", "localeCompare", "toLocaleString", "Intl", "createElement", "postMessage", "dispatchEvent", "Error", "console"]);

// Spoken words, not a token: a letter and either a space or a capital first.
function readsAsWords(text) {
  if (!/\p{L}/u.test(text) || text.length > 2000) {
    return false;
  }
  if (/^[a-z0-9_.:\-/#@[\]%!*=&?]+$/.test(text)) {
    return false; // a key, slug, path, class or selector
  }
  if (/^(https?:|\/|\.\/|@\/|data:|mailto:)/.test(text)) {
    return false;
  }
  const words = text.split(/\s+/);
  if (words.length > 1 && words.every((word) => /^[a-z0-9:\-[\]/.%!#_]+$/.test(word) && /[-:[]/.test(word))) {
    return false; // a class list
  }
  return /\s/.test(text) || /^\p{Lu}/u.test(text);
}

// The entities JSX text may spell out, as the page shows them.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019", larr: "\u2190", rarr: "\u2192", uarr: "\u2191", darr: "\u2193", middot: "\u00b7", hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", times: "\u00d7", lsaquo: "\u2039", rsaquo: "\u203a", laquo: "\u00ab", raquo: "\u00bb", bull: "\u2022", copy: "\u00a9", deg: "\u00b0", minus: "\u2212", plusmn: "\u00b1", check: "\u2713" };
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) => {
    if (name[0] === "#") {
      return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    }
    return ENTITIES[name] ?? whole;
  });
}

// How React shows a JSX text: lines trimmed where they meet, blank lines
// dropped, the rest joined by a space; a text only of space and newlines is
// no text at all.
function jsxSpacing(raw) {
  if (/^\s*$/.test(raw) && raw.includes("\n")) {
    return "";
  }
  return decode(
    raw
      .split(/\r?\n/)
      .map((line, index, lines) => {
        let out = line;
        if (index > 0) out = out.trimStart();
        if (index < lines.length - 1) out = out.trimEnd();
        return out;
      })
      .filter((line, index, lines) => line.length || lines.length === 1)
      .join(" "),
  );
}
function jsxText(raw) {
  return jsxSpacing(raw).trim();
}

// An expression that shows a value, not an element: a slot in a pattern.
function slotName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isCallExpression(expression) && !/\.map$/.test(expression.expression.getText()) && /^(String|Number|format\w*|\w*(Label|Name|Text|Count|Number)\w*|Math\.\w+)$/.test(expression.expression.getText().split(".").pop() ?? "")) return "value";
  if (ts.isTemplateExpression(expression) || ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) return "value";
  if (ts.isElementAccessExpression(expression)) return "value";
  return null;
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return files(full);
    }
    return /\.(tsx|ts)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

function hiddenContext(node) {
  for (let from = node, up = node.parent; up; from = up, up = up.parent) {
    if (ts.isJsxAttribute(up)) {
      return HIDDEN_ATTRIBUTES.has(up.name.getText()) || up.name.getText().startsWith("data-");
    }
    if (ts.isImportDeclaration(up) || ts.isExportDeclaration(up) || ts.isLiteralTypeNode(up) || ts.isElementAccessExpression(up)) {
      return true;
    }
    if (ts.isCallExpression(up) || ts.isNewExpression(up)) {
      const callee = up.expression.getText().split(/[.(]/).filter(Boolean);
      if (callee.some((part) => HIDDEN_CALLS.has(part))) {
        return true;
      }
      return false;
    }
    if (ts.isBinaryExpression(up) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(up.operatorToken.kind)) {
      return true; // compared, not shown
    }
    if (ts.isCaseClause(up)) {
      return true;
    }
    if (ts.isPropertyAssignment(up) && up.name === from) {
      return true; // an object key, not its value ("content: play ? `...` : ...")
    }
    if (ts.isStatement(up) || ts.isJsxElement(up) || ts.isJsxSelfClosingElement(up)) {
      return false;
    }
  }
  return false;
}

// A lone lowercase word or article is a piece of a sentence split by markup
// ("anyone with a <b>character</b> here"): translated alone it would put an
// Italian word inside an English sentence, so it is left as it is.
function fragment(text) {
  return /^[a-z][\w'-]*$/.test(text) || /^(The|A|An)$/.test(text);
}

// The server's own lines in the chronicle (src/lib: a turn passing, the pack,
// a poison at midnight) are often several sentences put together from
// pieces, so they are listed sentence by sentence, as the page reads them in
// a system line (ui-translator.ts): a sentence's leading pieces that are only
// slots (another sentence put in front) are cut off.
export const SERVER_SOURCES = ["src/lib/dm", "src/lib/workshop", "src/lib/campaign-types.ts"];
// The same cut as src/lib/language/ui-translate-logic.ts SENTENCE_END.
export const SENTENCE_END = /(?<=[.!?:])\s+(?=[\p{Lu}{(«"“])/u;

function sentences(text) {
  return text
    .split(SENTENCE_END)
    // A slot standing for a sentence before or after this one: "{dying} It is
    // now", "turn.{extra}". "{name} ends their turn" keeps its name.
    .map((piece) => piece.replace(/^(?:\{\w+\}\s*)+(?=\p{Lu})/u, "").replace(/(?<=[.!?:])(?:\{\w+\})+$/, "").trim())
    .filter((piece) => piece.length <= MAX_LINE && /\p{L}{2}/u.test(piece.replace(/\{\w+\}/g, "")));
}

// What the model reads and the player never sees: tool definitions, prompts
// and the claims a narration is read for. A table line is short.
const MODEL_ONLY = /(tool-defs|prompt|claims-logic|-guide|instructions)/;
const MAX_LINE = 240;

export function serverFiles() {
  return SERVER_SOURCES.flatMap((entry) => {
    const full = path.join(ROOT, entry);
    return fs.statSync(full).isDirectory() ? files(full) : [full];
  }).filter((file) => !MODEL_ONLY.test(path.basename(file)));
}

export function extractServer(sourceFiles = serverFiles()) {
  const { texts, patterns } = extract(sourceFiles);
  const sentenceTexts = new Set();
  const sentencePatterns = new Set();
  for (const text of texts) {
    for (const piece of sentences(text)) {
      (/\{\w+\}/.test(piece) ? sentencePatterns : sentenceTexts).add(piece);
    }
  }
  for (const pattern of patterns) {
    for (const piece of sentences(pattern)) {
      (/\{\w+\}/.test(piece) ? sentencePatterns : sentenceTexts).add(piece);
    }
  }
  return { texts: [...sentenceTexts].sort(), patterns: [...sentencePatterns].sort() };
}

export function extract(sourceFiles = SOURCES.flatMap((dir) => files(path.join(ROOT, dir)))) {
  const texts = new Set();
  const patterns = new Set();
  for (const file of sourceFiles) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    // Texts read as part of a pattern, not on their own.
    const inPattern = new Set();
    const visit = (node) => {
      if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && !hiddenContext(node)) {
        const children = node.children.filter((child) => !(ts.isJsxText(child) && !jsxSpacing(child.text)));
        const expressions = children.filter((child) => ts.isJsxExpression(child) && child.expression);
        if (expressions.length && children.every((child) => ts.isJsxText(child) || ts.isJsxExpression(child))) {
          const used = new Map();
          let pattern = "";
          let ok = true;
          for (const child of children) {
            if (ts.isJsxText(child)) {
              pattern += jsxSpacing(child.text);
            } else if (child.expression) {
              const base = slotName(child.expression);
              if (!base) {
                ok = false;
                break;
              }
              const count = (used.get(base) ?? 0) + 1;
              used.set(base, count);
              pattern += `{${count === 1 ? base : `${base}${count}`}}`;
            }
          }
          const words = pattern.replace(/\{\w+\}/g, "");
          if (ok && /\p{L}{2}/u.test(words)) {
            patterns.add(pattern.trim());
            children.forEach((child) => inPattern.add(child));
          }
        }
      }
      if (ts.isJsxText(node) && inPattern.has(node)) {
        // read whole above
      } else if (ts.isJsxText(node)) {
        const text = jsxText(node.text);
        if (text && /\p{L}/u.test(text) && !fragment(text)) {
          texts.add(text);
        }
      } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !hiddenContext(node)) {
        const text = node.text.trim();
        if (readsAsWords(text) && !fragment(text)) {
          texts.add(text);
        }
      } else if (ts.isTemplateExpression(node) && !hiddenContext(node)) {
        let pattern = node.head.text;
        const used = new Map();
        for (const span of node.templateSpans) {
          const base = ts.isIdentifier(span.expression)
            ? span.expression.text
            : ts.isPropertyAccessExpression(span.expression)
              ? span.expression.name.text
              : "value";
          // Each slot its own name: a pattern copies every one into place.
          const count = (used.get(base) ?? 0) + 1;
          used.set(base, count);
          pattern += `{${count === 1 ? base : `${base}${count}`}}${span.literal.text}`;
        }
        pattern = pattern.trim();
        if (readsAsWords(pattern.replace(/\{\w+\}/g, "")) && /\p{L}{2}/u.test(pattern.replace(/\{\w+\}/g, ""))) {
          patterns.add(pattern);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { texts: [...texts].sort(), patterns: [...patterns].sort() };
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ui = extract();
  const server = extractServer();
  const texts = [...new Set([...ui.texts, ...server.texts])].sort();
  const patterns = [...new Set([...ui.patterns, ...server.patterns])].sort();
  const catalog = readJson(CATALOG);
  const known = readJson(PATTERNS);
  const missing = texts.filter((text) => !Object.hasOwn(catalog, text));
  const missingPatterns = patterns.filter((pattern) => !Object.hasOwn(known, pattern));
  if (process.argv.includes("--missing")) {
    console.log(JSON.stringify(missing, null, 2));
  } else if (process.argv.includes("--patterns")) {
    console.log(JSON.stringify(missingPatterns, null, 2));
  } else {
    const covered = texts.length - missing.length;
    console.log(`texts: ${texts.length}, translated ${covered} (${texts.length ? Math.round((covered / texts.length) * 100) : 100}%), missing ${missing.length}`);
    console.log(`patterns: ${patterns.length}, translated ${patterns.length - missingPatterns.length}, missing ${missingPatterns.length}`);
    console.log(`catalog entries: ${Object.keys(catalog).length}`);
    if (process.argv.includes("--check")) {
      const bad = Object.entries(catalog).filter(([english, italian]) => typeof italian !== "string" || !italian.trim() || english !== english.trim());
      if (bad.length) {
        console.error(`entries that are empty or not trimmed: ${bad.map(([english]) => JSON.stringify(english)).join(", ")}`);
        process.exit(1);
      }
    }
  }
}
