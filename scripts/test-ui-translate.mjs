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
const { uiTranslator, sentenceTranslator, resolveUiLanguage, isUiLanguageChoice } = await import("../src/lib/language/ui-translate-logic.ts");
const { extract, extractServer } = await import("./extract-ui-strings.mjs");

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

await test("a server's line with no entry whole is read sentence by sentence; a sentence with none stays", () => {
  const bySentence = sentenceTranslator(
    uiTranslator(
      { "The party is assembled and the adventure begins.": "Il gruppo è riunito e l'avventura comincia." },
      { "{name} ends their turn.": "{name} termina il suo turno.", "It is now {name}'s turn (round {round}).": "Ora è il turno di {name} (round {round})." },
    ),
  );
  assert.equal(bySentence("The party is assembled and the adventure begins."), "Il gruppo è riunito e l'avventura comincia.");
  assert.equal(
    bySentence("Kara ends their turn. It is now Brann's turn (round 2). Bandito 1 acts first."),
    "Kara termina il suo turno. Ora è il turno di Brann (round 2). Bandito 1 acts first.",
  );
  assert.equal(bySentence("Nothing here. Nor here."), null);
  // A pattern open at both ends with a word or two fixed reads nowhere, and
  // a slot never swallows another sentence.
  const loose = sentenceTranslator(uiTranslator({}, { "{value} and {value2}": "{value} e {value2}", "{name} acts.": "{name} agisce." }));
  assert.equal(loose("Bandito 1 and Bandito 2 act before Brann."), null);
  assert.equal(loose("Kara rests. Brann acts."), "Kara rests. Brann agisce.");
  assert.equal(loose("Brann closes in on them acts."), null);
  assert.equal(loose("Potion of Healing acts."), "Potion of Healing agisce.");
  assert.equal(loose("Bandito 1 and Bandito 2 acts."), "Bandito 1 and Bandito 2 agisce.");
  // Prose in a slot reads on its own, or the whole match falls.
  const nested = uiTranslator({}, { "{name} attacks with {attack} ({summary}).": "{name} attacca con {attack} ({summary}).", "{value} vs AC {value2}: miss": "{value} contro CA {value2}: mancato" });
  assert.equal(nested("Bandito 2 attacks with Scimitar (18 vs AC 19: miss)."), "Bandito 2 attacca con Scimitar (18 contro CA 19: mancato).");
  assert.equal(nested("Bandito 2 attacks with Scimitar (it went wide of the mark)."), null);
  // The pattern with the most fixed words wins, whatever the catalog's order.
  const specific = uiTranslator({}, { "{name} attacks {value}.": "{name} attacca {value}.", "{name} attacks {target} with {attack}.": "{name} attacca {target} con {attack}." });
  assert.equal(specific("Bandito 3 attacks Brann with Scimitar."), "Bandito 3 attacca Brann con Scimitar.");
  // A slot glued to a word or another slot may be empty.
  const glued = uiTranslator({}, { "{value} act{value2} before {name}.": "Prima di {name} tocca a {value}.", "{value} vs AC {value2}:": "{value} contro CA {value2}:", "HIT for {value3}{value4}": "COLPITO per {value3}{value4}", "{name} attacks with {attack} ({summary}).": "{name} attacca con {attack} ({summary})." });
  assert.equal(glued("Bandito 1 and Bandito 2 act before Brann."), "Prima di Brann tocca a Bandito 1 and Bandito 2.");
  assert.equal(glued("Bandito 1 acts before Brann."), "Prima di Brann tocca a Bandito 1.");
  assert.equal(glued("Bandito 3 attacks with Scimitar (21 vs AC 19: HIT for 6)."), "Bandito 3 attacca con Scimitar (21 contro CA 19: COLPITO per 6).");
  assert.equal(
    sentenceTranslator(glued)("Bandito 3 attacks with Scimitar (21 vs AC 19: HIT for 6). Bandito 1 acts before Brann."),
    "Bandito 3 attacca con Scimitar (21 contro CA 19: COLPITO per 6). Prima di Brann tocca a Bandito 1.",
  );
});

await test("the server's chronicle lines are listed sentence by sentence, a sentence put in front cut off", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-ui-server-"));
  const file = path.join(dir, "turns.ts");
  fs.writeFileSync(
    file,
    `export function pass(opening: string, dying: string, next: { name: string }, name: string, notes: string[]) {
  const line = \`\${opening}\${dying} It is now \${next.name}'s turn.\`;
  const auto = \`\${name}'s turn resolves automatically: \${notes.join(" ")}\`;
  return [line, auto, \`\${name} ends their turn.\`, "The party is assembled and the adventure begins."];
}
`,
  );
  const { texts, patterns: found } = extractServer([file]);
  assert.ok(texts.includes("The party is assembled and the adventure begins."), JSON.stringify(texts));
  for (const pattern of ["It is now {name}'s turn.", "{name}'s turn resolves automatically:", "{name} ends their turn."]) {
    assert.ok(found.includes(pattern), `missing ${pattern}: ${JSON.stringify(found)}`);
  }
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
