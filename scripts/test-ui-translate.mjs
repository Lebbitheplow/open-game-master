// The interface in Italian (docs/specs/ogm-italian-ui.md): a catalog keyed by
// the English text, in the shape an Italian table already uses (upstream
// issue #919), matched whole; patterns for text built at run time; the
// browser's language by default; and an extractor that lists what the page
// shows, entities and JSX spacing as React renders them.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-ui-translate");
const { uiTranslator, resolveUiLanguage, isUiLanguageChoice } = await import("../src/lib/language/ui-translate-logic.ts");
const { extract } = await import("./extract-ui-strings.mjs");

const catalog = { Save: "Salva", "Widen the panel": "Allarga il pannello", "Your turn.": "Tocca a te." };
const patterns = { "{name}'s turn": "Turno di {name}", "{count} of {total} left": "{count} su {total} rimasti" };
const translate = uiTranslator(catalog, patterns);

await test("a catalog entry matches only the whole text, its outer spaces kept", () => {
  assert.equal(translate("Save"), "Salva");
  assert.equal(translate("  Save \n"), "  Salva \n");
  assert.equal(translate("Save all"), null);
  assert.equal(translate("save"), null);
  assert.equal(translate("Your turn."), "Tocca a te.");
  assert.equal(translate("   "), null);
  // An entry's own key from Object.prototype is no entry.
  assert.equal(translate("constructor"), null);
});

await test("a pattern copies what its slots matched, in the Italian order", () => {
  assert.equal(translate("Kara's turn"), "Turno di Kara");
  assert.equal(translate("3 of 5 left"), "3 su 5 rimasti");
  assert.equal(translate("'s turn"), null);
  // The catalog wins over a pattern.
  assert.equal(uiTranslator({ "Kara's turn": "Kara gioca" }, patterns)("Kara's turn"), "Kara gioca");
});

await test("an entry whose Italian is the English changes nothing", () => {
  assert.equal(uiTranslator({ Menu: "Menu" })("Menu"), null);
});

await test("the browser's language decides unless the reader chose", () => {
  assert.equal(resolveUiLanguage("auto", ["it-IT", "en"]), "italian");
  assert.equal(resolveUiLanguage("auto", ["en-US", "it"]), "english");
  assert.equal(resolveUiLanguage("auto", []), "english");
  assert.equal(resolveUiLanguage("english", ["it-IT"]), "english");
  assert.equal(resolveUiLanguage("italian", ["en-US"]), "italian");
  assert.equal(isUiLanguageChoice("italian"), true);
  assert.equal(isUiLanguageChoice("french"), false);
});

await test("the extractor lists what React shows, and leaves out keys, classes and paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-ui-extract-"));
  const file = path.join(dir, "Sample.tsx");
  fs.writeFileSync(
    file,
    `export function Sample({ name, count }: { name: string; count: number }) {
  const status = "ready";
  if (status === "Done now") return null;
  return (
    <div className="flex gap-2 text-stone-400" data-kind="Some Kind">
      <button type="button" aria-label="Widen the panel" title={"Open the map"}>
        Don&apos;t
        stop
      </button>
      <p>{name}&apos;s turn</p>
      <span>{count} of {total} left</span>
      <img alt="A dragon" src="/art/dragon.png" />
      {label("Pick a spell")}
    </div>
  );
}
`,
  );
  const { texts, patterns: found } = extract([file]);
  for (const text of ["Don't stop", "Widen the panel", "Open the map", "A dragon", "Pick a spell"]) {
    assert.ok(texts.includes(text), `missing ${text}: ${JSON.stringify(texts)}`);
  }
  for (const text of ["flex gap-2 text-stone-400", "Some Kind", "button", "/art/dragon.png", "ready", "Done now", "'s turn"]) {
    assert.ok(!texts.includes(text), `listed ${text}`);
  }
  assert.ok(found.includes("{name}'s turn"), JSON.stringify(found));
  assert.ok(found.includes("{count} of {total} left"), JSON.stringify(found));
});

await test("the catalog is the flat shape, every entry trimmed and filled", () => {
  for (const file of ["ui-it.json", "ui-it.patterns.json"]) {
    const entries = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../src/lib/language", file), "utf8"));
    for (const [english, italian] of Object.entries(entries)) {
      assert.equal(typeof italian, "string", english);
      assert.equal(english, english.trim(), `${file}: "${english}" has outer spaces`);
      assert.ok(italian.trim(), `${file}: "${english}" is empty`);
    }
  }
});

finish();
