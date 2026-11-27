import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-routes.mjs", import.meta.url);

const { translate, translatePlural, catalogInstalled } = await import("../src/lib/i18n/translate.ts");

// 0. A catalog is installed, never imported by the translator: imported, its
// 1 MB rode in every page's first load (scripts/bundle-budget.json). Until it
// is in, French and Spanish read English; the server's modules install them,
// a browser fetches each as its own chunk.
assert.equal(catalogInstalled("fr"), false);
assert.equal(catalogInstalled("es"), false);
assert.equal(translate("fr", "Loading…"), "Loading…", "no catalog yet: the English source");
assert.equal(translate("es", "Loading…"), "Loading…", "no catalog yet: the English source");
for (const file of ["../src/lib/i18n/translate.ts", "../src/lib/messages-logic.ts", "../src/lib/locale.tsx"]) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import[^;]*(?:fr|es)\.json/m, `${file} imports a catalog into every page`);
}
for (const locale of ["fr", "es"]) {
  assert.ok(fs.readFileSync(new URL("../src/lib/i18n/catalog-loader.ts", import.meta.url), "utf8").includes(`import("./${locale}.json")`), `the browser fetches the ${locale} catalog on demand`);
  for (const file of ["../src/lib/request-locale.ts", "../src/app/layout.tsx", "../src/instrumentation.ts"]) {
    assert.ok(fs.readFileSync(new URL(file, import.meta.url), "utf8").includes(`i18n/${locale}-catalog`), `${file} installs the ${locale} catalog on the server`);
  }
}
await import("../src/lib/i18n/fr-catalog.ts");
assert.equal(catalogInstalled("fr"), true);
assert.equal(catalogInstalled("es"), false, "one language's catalog is not another's");
await import("../src/lib/i18n/es-catalog.ts");
assert.equal(catalogInstalled("es"), true);
const { localeFromAcceptLanguage, localeOfServerLanguage, localeOfTableLanguage, resolveLocale, resolveRequestLocale } = await import("../src/lib/i18n/locale.ts");
const { localeTag } = await import("../src/lib/messages-logic.ts");
const frCatalog = JSON.parse(fs.readFileSync(new URL("../src/lib/i18n/fr.json", import.meta.url), "utf8"));
const esCatalog = JSON.parse(fs.readFileSync(new URL("../src/lib/i18n/es.json", import.meta.url), "utf8"));

// JSON.parse keeps the last of two equal keys without a word, so a key that
// two branches each add merges cleanly and one translation silently wins.
// Walk the text itself: within each object every key is said once.
for (const file of ["fr.json", "es.json"]) {
  const text = fs.readFileSync(new URL(`../src/lib/i18n/${file}`, import.meta.url), "utf8");
  const seen = [new Set()];
  const repeated = [];
  const token = /"(?:[^"\\]|\\.)*"(\s*:)?|[{}]/g;
  for (let m; (m = token.exec(text)); ) {
    if (m[0] === "{") seen.push(new Set());
    else if (m[0] === "}") seen.pop();
    else if (m[1]) {
      const key = JSON.parse(m[0].replace(/\s*:$/, ""));
      const keys = seen[seen.length - 1];
      if (keys.has(key)) repeated.push(key);
      keys.add(key);
    }
  }
  assert.deepEqual(repeated, [], `${file} says each key once within its object`);
}

// 1. English returns the source string verbatim with interpolation
assert.equal(translate("en", "Loading…"), "Loading…");
assert.equal(translate("en", "Level {level}", { level: 5 }), "Level 5");

// 2. French resolves from fr.json catalog and falls back to English for unknown strings
assert.equal(translate("fr", "Loading…"), "Chargement…");
assert.equal(translate("fr", "Some brand new untranslated UI string"), "Some brand new untranslated UI string");
// Spanish the same way, from es.json.
assert.equal(translate("es", "Loading…"), "Cargando…");
assert.equal(translate("es", "Cancel"), "Cancelar");
assert.equal(translate("es", "Some brand new untranslated UI string"), "Some brand new untranslated UI string");
assert.equal(translate("es", "Level {level}", { level: 5 }), "Nivel 5");

// 3. Context disambiguation resolves collisions cleanly
assert.equal(translate("fr", "On"), "Activé");
assert.equal(translate("fr", "On", { context: "workshop.homebrew.spellMore.on" }), "Sur");

// 4. Pluralization follows EN (count === 1) vs FR (count <= 1)
assert.equal(translatePlural("en", "{count} round", "{count} rounds", { count: 0 }), "0 rounds");
assert.equal(translatePlural("en", "{count} round", "{count} rounds", { count: 1 }), "1 round");
assert.equal(translatePlural("fr", "{count} day", "{count} days", { count: 0 }), "0 jour");
assert.equal(translatePlural("fr", "{count} day", "{count} days", { count: 2 }), "2 jours");
// Spanish counts as English does: only 1 is one.
assert.equal(translatePlural("es", "{count} day", "{count} days", { count: 0 }), "0 días");
assert.equal(translatePlural("es", "{count} day", "{count} days", { count: 1 }), "1 día");
assert.equal(translatePlural("es", "{count} day", "{count} days", { count: 2 }), "2 días");

// 5. Server-side locale resolution priority: saved > cookie > Accept-Language > en
assert.equal(resolveLocale({ savedLocale: "fr", cookieHeader: "odm_locale=en", acceptLanguage: "en-US" }), "fr");
assert.equal(resolveLocale({ cookieHeader: "foo=1; odm_locale=fr", acceptLanguage: "en-US" }), "fr");
assert.equal(resolveLocale({ acceptLanguage: "fr-CA,fr;q=0.9,en;q=0.8" }), "fr");
assert.equal(localeFromAcceptLanguage("de-DE,it;q=0.8"), "en");
// Spanish is found the same ways: the reader's choice, the cookie, a Spanish
// server, the browser's languages (whatever the country).
assert.equal(resolveLocale({ savedLocale: "es", cookieHeader: "odm_locale=fr", acceptLanguage: "en-US" }), "es");
assert.equal(resolveLocale({ cookieHeader: "odm_locale=es", acceptLanguage: "en-US" }), "es");
assert.equal(resolveLocale({ acceptLanguage: "es-419,es;q=0.9,en;q=0.8" }), "es");
assert.equal(localeFromAcceptLanguage("de-DE,es;q=0.8"), "es");
assert.equal(localeFromAcceptLanguage("es-AR"), "es");
assert.equal(localeOfServerLanguage("spanish"), "es");
assert.equal(resolveLocale({ serverLocale: localeOfServerLanguage("spanish"), acceptLanguage: "en-US" }), "es");
assert.equal(resolveLocale({ cookieHeader: "odm_locale=en", serverLocale: "es", acceptLanguage: "es-ES" }), "en");
assert.equal(localeOfTableLanguage("spanish"), "es");
assert.equal(localeOfTableLanguage("french"), "fr");
assert.equal(localeOfTableLanguage("german"), "en", "a table language the menus do not have reads English");
assert.equal(localeTag("es"), "es");
assert.equal(localeTag("fr"), "fr-FR");
// A French server opens in French for a reader who chose nothing; their own
// choice still wins, and an English server (every server's default) leaves
// it to the browser.
assert.equal(localeOfServerLanguage("french"), "fr");
assert.equal(localeOfServerLanguage("english"), null);
assert.equal(localeOfServerLanguage("italian"), null);
assert.equal(resolveLocale({ serverLocale: "fr", acceptLanguage: "en-US" }), "fr");
assert.equal(resolveLocale({ cookieHeader: "odm_locale=en", serverLocale: "fr", acceptLanguage: "fr-FR" }), "en");
assert.equal(resolveLocale({ serverLocale: localeOfServerLanguage("english"), acceptLanguage: "fr-FR" }), "fr");
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
assert.equal(translate("fr", "On", { context: "unknown.context" }), "Activé");

// 6. Catalog integrity: every entry preserves the English {placeholders}
// (omitting English-only {article} where the language uses no indefinite
// article).
const varsOf = (s) =>
  [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((m) => m[1])
    .filter((v) => v !== "article")
    .sort();
for (const [name, catalog] of [["fr.json", frCatalog], ["es.json", esCatalog]]) {
  for (const [en, said] of Object.entries(catalog.messages)) {
    assert.deepEqual(varsOf(said), varsOf(en), `${name}: placeholder mismatch in messages for: ${en}`);
  }
  for (const [en, ctxMap] of Object.entries(catalog.contexts)) {
    for (const [ctx, said] of Object.entries(ctxMap)) {
      assert.deepEqual(varsOf(said), varsOf(en), `${name}: placeholder mismatch in contexts[${ctx}] for: ${en}`);
    }
  }
  for (const [key, pair] of Object.entries(catalog.plurals)) {
    assert.ok(Array.isArray(pair) && pair.length === 2, `${name}: expected [one, other] tuple for plural: ${key}`);
    const [enOne, enOther] = key.split("\0");
    assert.deepEqual(varsOf(pair[0]), varsOf(enOne), `${name}: placeholder mismatch in plural[0] for: ${key}`);
    assert.deepEqual(varsOf(pair[1]), varsOf(enOther), `${name}: placeholder mismatch in plural[1] for: ${key}`);
  }
}

// 7. The Spanish catalog is the French one's twin: the two are filled from the
// same English strings, so a string one carries and the other does not is a
// screen that reads half in English. (A new English string lands in neither
// until its translation is added, and reads English meanwhile.)
for (const part of ["messages", "plurals"]) {
  const missing = Object.keys(frCatalog[part]).filter((key) => !Object.hasOwn(esCatalog[part], key));
  assert.deepEqual(missing.slice(0, 5), [], `es.json lacks ${missing.length} ${part} that fr.json carries`);
}
for (const [en, ctxMap] of Object.entries(frCatalog.contexts)) {
  for (const ctx of Object.keys(ctxMap)) {
    assert.ok(esCatalog.contexts[en]?.[ctx] !== undefined, `es.json lacks the ${ctx} sense of: ${en}`);
  }
}
// A word English spells one way and the game means two: the button saves,
// the rule is a saving throw.
assert.equal(translate("es", "Save"), "Guardar");
assert.equal(translate("es", "Save", { context: "workshop.bestiary.attack.save" }), "Salvación");
assert.equal(translate("es", "Cover"), "Portada", "a campaign's cover");
assert.equal(translate("es", "Cover", { context: "rulebook.quick" }), "Cobertura", "cover from an arrow");
assert.equal(translate("fr", "Cover", { context: "rulebook.quick" }), "Couverture", "French says both with one word");
assert.equal(translate("es", "Conditions"), "Estados", "the official word, as the Spanish book's appendix has it");
// No em dash where the English has none (the house style; scripts and copy
// alike).
for (const [en, said] of Object.entries(esCatalog.messages)) {
  assert.ok(en.includes("\u2014") || !said.includes("\u2014"), `es.json adds an em dash to: ${en}`);
}

console.log("test-i18n-gettext: all assertions and catalog placeholder checks passed");
