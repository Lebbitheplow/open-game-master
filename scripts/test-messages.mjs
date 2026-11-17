// The translation layer's rules: English strings pass through unchanged,
// French looks up in fr.json and falls back to English when untranslated,
// every plural pair has both one/other forms, and the plural rules each
// locale keeps are the real ones (English counts "0 days", French writes
// "0 jour"). Pure: no React, no storage, no server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const catalog = JSON.parse(readFileSync(new URL("../src/lib/i18n/fr.json", import.meta.url), "utf8"));
const { translate, translatePlural, formatMessage, pluralCategory, localeTag } = await import("../src/lib/messages-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("English passes through as-is", () => {
  assert.equal(translate("en", "Settings"), "Settings");
  assert.equal(translate("en", "Signed in as {name}", { name: "Kael" }), "Signed in as Kael");
});

test("French answers in French and falls back to English when untranslated", () => {
  assert.equal(translate("fr", "Settings"), catalog.messages["Settings"]);
  assert.equal(translate("fr", "Untranslated line for test"), "Untranslated line for test");
});

test("a plural pair in fr.json is never half-written", () => {
  for (const [key, forms] of Object.entries(catalog.plurals)) {
    assert.ok(Array.isArray(forms) && forms.length === 2, `fr.json plural "${key}" must be a 2-element tuple`);
    assert.ok(typeof forms[0] === "string" && forms[0].length > 0, `fr.json plural "${key}" missing singular`);
    assert.ok(typeof forms[1] === "string" && forms[1].length > 0, `fr.json plural "${key}" missing plural`);
  }
});

test("each locale counts zero its own way", () => {
  assert.equal(pluralCategory("en", 0), "other");
  assert.equal(pluralCategory("en", 1), "one");
  assert.equal(pluralCategory("en", 2), "other");
  assert.equal(pluralCategory("fr", 0), "one");
  assert.equal(pluralCategory("fr", 1), "one");
  assert.equal(pluralCategory("fr", 2), "other");
});

test("translatePlural picks its form by the locale's rule and fills the count", () => {
  const one = "{count} day";
  const other = "{count} days";
  assert.equal(translatePlural("en", one, other, { count: 1 }), "1 day");
  assert.equal(translatePlural("en", one, other, { count: 14 }), "14 days");
  assert.equal(translatePlural("en", one, other, { count: 0 }), "0 days");
  assert.match(translatePlural("fr", one, other, { count: 1 }), /\b1 jour\b/);
  assert.match(translatePlural("fr", one, other, { count: 14 }), /\b14 jours\b/);
  assert.match(translatePlural("fr", one, other, { count: 0 }), /\b0 jour\b/);
});

test("placeholders fill, and a missing variable stays visible", () => {
  assert.equal(formatMessage("Signed in as {name}", { name: "Kael" }), "Signed in as Kael");
  assert.equal(formatMessage("Signed in as {name}", {}), "Signed in as {name}");
  assert.equal(formatMessage("No slots here", { name: "Kael" }), "No slots here");
});

test("the locale's tag formats a date the locale's way", () => {
  assert.equal(localeTag("en"), "en-US");
  assert.equal(localeTag("fr"), "fr-FR");
  const iso = "2026-03-07T12:00:00Z";
  const english = new Date(iso).toLocaleDateString(localeTag("en"), { month: "long", day: "numeric" });
  const french = new Date(iso).toLocaleDateString(localeTag("fr"), { month: "long", day: "numeric" });
  assert.match(english, /March/);
  assert.match(french, /mars/);
});

console.log(`test-messages: ${passed} tests, all passed.`);
