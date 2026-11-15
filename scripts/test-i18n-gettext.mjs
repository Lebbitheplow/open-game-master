import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-routes.mjs", import.meta.url);

const { translate, translatePlural } = await import("../src/lib/i18n/translate.ts");
const { localeFromAcceptLanguage, resolveLocale, resolveRequestLocale } = await import("../src/lib/i18n/locale.ts");
const frCatalog = JSON.parse(fs.readFileSync(new URL("../src/lib/i18n/fr.json", import.meta.url), "utf8"));

// 1. English returns the source string verbatim with interpolation
assert.equal(translate("en", "Loading…"), "Loading…");
assert.equal(translate("en", "Level {level}", { level: 5 }), "Level 5");

// 2. French resolves from fr.json catalog and falls back to English for unknown strings
assert.equal(translate("fr", "Loading…"), "Chargement…");
assert.equal(translate("fr", "Some brand new untranslated UI string"), "Some brand new untranslated UI string");

// 3. Context disambiguation resolves collisions cleanly
assert.equal(translate("fr", "On"), "Allumé");
assert.equal(translate("fr", "On", { context: "workshop.homebrew.spellMore.on" }), "Sur");

// 4. Pluralization follows EN (count === 1) vs FR (count <= 1)
assert.equal(translatePlural("en", "{count} round", "{count} rounds", { count: 0 }), "0 rounds");
assert.equal(translatePlural("en", "{count} round", "{count} rounds", { count: 1 }), "1 round");
assert.equal(translatePlural("fr", "{count} day", "{count} days", { count: 0 }), "0 jour");
assert.equal(translatePlural("fr", "{count} day", "{count} days", { count: 2 }), "2 jours");

// 5. Server-side locale resolution priority: saved > cookie > Accept-Language > en
assert.equal(resolveLocale({ savedLocale: "fr", cookieHeader: "odm_locale=en", acceptLanguage: "en-US" }), "fr");
assert.equal(resolveLocale({ cookieHeader: "foo=1; odm_locale=fr", acceptLanguage: "en-US" }), "fr");
assert.equal(resolveLocale({ acceptLanguage: "fr-CA,fr;q=0.9,en;q=0.8" }), "fr");
assert.equal(localeFromAcceptLanguage("de-DE,es;q=0.8"), "en");
assert.equal(localeFromAcceptLanguage("en-US;q=0.5,fr;q=0.9"), "fr");
assert.equal(localeFromAcceptLanguage("fr;q=0,en;q=0.8"), "en");
assert.equal(
  resolveRequestLocale(
    new Request("http://localhost/", {
      headers: { cookie: "odm_locale=invalid", "accept-language": "fr-FR,fr;q=0.9" },
    }),
  ),
  "fr",
);
assert.equal(translate("fr", "On", { context: "unknown.context" }), "Allumé");

// 6. Catalog integrity: every French entry preserves the English {placeholders}
// (omitting English-only {article} where French uses no indefinite article).
const varsOf = (s) =>
  [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((m) => m[1])
    .filter((v) => v !== "article")
    .sort();
for (const [en, fr] of Object.entries(frCatalog.messages)) {
  assert.deepEqual(varsOf(fr), varsOf(en), `Placeholder mismatch in messages for: ${en}`);
}
for (const [en, ctxMap] of Object.entries(frCatalog.contexts)) {
  for (const [ctx, fr] of Object.entries(ctxMap)) {
    assert.deepEqual(varsOf(fr), varsOf(en), `Placeholder mismatch in contexts[${ctx}] for: ${en}`);
  }
}
for (const [key, pair] of Object.entries(frCatalog.plurals)) {
  assert.ok(Array.isArray(pair) && pair.length === 2, `Expected [one, other] tuple for plural: ${key}`);
  const [enOne, enOther] = key.split("\0");
  assert.deepEqual(varsOf(pair[0]), varsOf(enOne), `Placeholder mismatch in plural[0] for: ${key}`);
  assert.deepEqual(varsOf(pair[1]), varsOf(enOther), `Placeholder mismatch in plural[1] for: ${key}`);
}

console.log("test-i18n-gettext: all assertions and catalog placeholder checks passed");
