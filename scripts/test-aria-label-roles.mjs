// A label needs a role to carry it. `aria-label` and `aria-labelledby` on an
// element with no role (a div, a span, a paragraph) may be ignored by a
// screen reader: the lobby's room code was a labelled paragraph around plates
// hidden from a reader, so the code could go unread, and axe reports it as
// aria-prohibited-attr. This reads every .tsx under src/ with the TypeScript
// parser and fails on a labelled element whose tag has no role of its own and
// that sets none.
//
// What to do instead, by kind (the pull request that added this guard sorted
// every site into these):
//   - a loading placeholder: role="status" with its words inside as sr-only
//     text (LoadingBlock in src/components/PageSkeleton.tsx);
//   - a value drawn as a shape (a dot, pips, a bar): role="img" and the label;
//   - a named set of controls or tags: role="group" and the label;
//   - short text with a fuller spoken form: the full words as sr-only text
//     and the short text aria-hidden;
//   - a field wrapped by a <label>: the label goes on the field.
//
// A site that must keep a bare label goes in ALLOWED with its reason.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "..", "src");

// Tags with no role of their own, or with one that may not be named.
const ROLELESS = new Set([
  "div", "span", "p", "pre", "code", "strong", "em", "b", "i", "u", "s", "small", "sub", "sup", "del", "ins",
  "q", "samp", "abbr", "cite", "kbd", "var", "mark", "caption", "figcaption", "legend", "dt", "label",
]);

// "file:tag:label attribute text" -> why the bare label stays.
const ALLOWED = new Map([]);

function* tsxFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* tsxFiles(full);
    else if (entry.name.endsWith(".tsx")) yield full;
  }
}

const found = [];
const used = new Set();
for (const file of tsxFiles(root)) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("aria-label")) continue;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (ROLELESS.has(tag)) {
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
        const named = (name) => attrs.find((attr) => attr.name.getText(source) === name);
        const label = named("aria-label") ?? named("aria-labelledby");
        if (label && !named("role")) {
          const where = path.relative(root, file).split(path.sep).join("/");
          const key = `${where}:${tag}:${label.getText(source)}`;
          if (ALLOWED.has(key)) used.add(key);
          else found.push(`${where}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} <${tag} ${label.getText(source).slice(0, 80)}>`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

assert.deepEqual(found, [], `a label on an element with no role may never be read aloud; give it a role or say it in sr-only text (see the top of this file):\n${found.join("\n")}`);
const stale = [...ALLOWED.keys()].filter((key) => !used.has(key));
assert.deepEqual(stale, [], "an allowed site is gone; strike it off ALLOWED");

console.log("aria-label roles: every label in src/ sits on an element with a role");
