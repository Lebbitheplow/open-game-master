// Issue 668: the "Previously" recap that opens a session was posted as a
// system line and took the faint italic system style, lighter than the
// narration, so it was easy to miss. It stays a system line (the recap
// filter, the export and the voice read it as one) but the table draws it
// as a card at narration weight under a "Previously" heading.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);

const { SystemMessage } = await import("../src/app/campaigns/[campaignId]/MessageParts.tsx");
const { RECAP_PREFIX, systemNoteWords } = await import("../src/lib/campaign-types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const recap = `${RECAP_PREFIX}You crossed the ford at dusk and the miller's daughter vanished from the mill.`;

test("the recap is drawn as its own card under a Previously heading", () => {
  const html = renderToStaticMarkup(createElement(SystemMessage, { content: recap, glyph: "cue-bell" }));
  assert.match(html, /session-recap/);
  assert.match(html, /aria-label="Previously"/);
  assert.match(html, />Previously</, "a visible heading");
  assert.match(html, /session-recap-text/);
  assert.match(html, /You crossed the ford at dusk/);
  assert.doesNotMatch(html, /Previously: You crossed/, "the prefix is the heading, not printed twice");
  assert.doesNotMatch(html, /session-sysline/, "not the faint system line");
});

test("any other system line keeps the system style", () => {
  const html = renderToStaticMarkup(createElement(SystemMessage, { content: "Seren walked out on the party.", glyph: "system-party" }));
  assert.match(html, /session-sysline/);
  assert.doesNotMatch(html, /session-recap/);
});

test("the recap keeps the words a stored line has always had", () => {
  // Older app shells draw it as a plain line; its text is unchanged.
  assert.equal(RECAP_PREFIX, "Previously: ");
  assert.equal(systemNoteWords(recap), recap);
});

// A system line reads as the server wrote it in English, and in French as
// the same facts (translateSystemNote). "1 hour passes:" lost its "es" in
// English when the French sync matched both verbs with one key.
const { translateSystemNote } = await import("../src/app/campaigns/[campaignId]/MessageParts.tsx");
const { translate } = await import("../src/lib/i18n/translate.ts");
await import("../src/lib/i18n/fr-catalog.ts");
const en = (key, vars) => translate("en", key, vars);
const fr = (key, vars) => translate("fr", key, vars);
const lines = [
  "1 hour passes: The storm blows itself out. It is now Firstday 3 Thaw, year 1492, morning, spring.",
  "10 minutes pass: They wait. It is now Firstday 3 Thaw, year 1492, morning, spring.",
  "1 hour passes. It is now Firstday 3 Thaw, year 1492, morning, spring.",
  "Mira death save: rolled 12, success (1 success, 2 failures).",
  "The party splits up: Bram goes to The Docks, and Mira and Tovin stay behind.",
  "Meanwhile, at The Docks: Bram, Mira and Tovin.",
  "Bram and Mira join the others at The Inn.",
  "The goblin boss is knocked out of the saddle; Wolf stays.",
  "Bram is knocked prone and falls from Riding Horse.",
  "Bram is thrown from Riding Horse.",
  "Wolf goes down; The goblin boss jumps clear and lands on its feet.",
  "Riding Horse goes down; Bram jumps clear and lands on their feet.",
  "Riding Horse goes down and Bram falls with it.",
];

test("an English table reads every system line exactly as the server wrote it", () => {
  for (const line of lines) {
    assert.equal(translateSystemNote(en, line), line);
  }
});

test("a French table reads the clock, a death save, a split party and a fall from the saddle in French", () => {
  const said = (line) => translateSystemNote(fr, line);
  assert.match(said(lines[0]), /^1 heure s’écoule : /, "one hour, singular");
  assert.match(said(lines[1]), /^10 minutes s’écoulent : /);
  assert.match(said(lines[2]), /^1 heure s’écoule\. Nous sommes/, "no reason given");
  assert.equal(said(lines[3]), "Jet de sauvegarde contre la mort de Mira : 12, réussite (1 réussite, 2 échecs).");
  assert.equal(said(lines[4]), "Le groupe se sépare. Vers The Docks : Bram. Restés en arrière : Mira et Tovin.");
  assert.equal(said(lines[5]), "Pendant ce temps, à The Docks : Bram, Mira et Tovin.");
  assert.equal(said(lines[6]), "Rejoignent les autres à The Inn : Bram et Mira.");
  assert.equal(said(lines[7]), "The goblin boss vide les étriers ; Wolf reste sur place.");
  assert.equal(said(lines[8]), "Bram tombe de Riding Horse et se retrouve à terre.");
  assert.equal(said(lines[9]), "Riding Horse désarçonne Bram.");
  assert.equal(said(lines[10]), "Wolf s’effondre ; The goblin boss saute à temps et retombe sur ses pieds.");
  assert.equal(said(lines[12]), "Riding Horse s’effondre et Bram tombe avec sa monture.");
});

console.log(`system lines: ${passed} checks passed`);
