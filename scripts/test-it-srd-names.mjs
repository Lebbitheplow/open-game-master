// The official Italian names of the SRD 5.1 (src/lib/language/srd-names-it.json,
// built by scripts/generate-it-srd-names.mjs from Wizards' Italian SRD 5.1):
// the data names only things the game knows, an Italian table's prose calls
// get the names their prompt holds, and an official Italian item name, whole,
// finds the English row. English tables are unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-it-srd-names");

const names = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../src/lib/language/srd-names-it.json"), "utf8"));
const rulebook = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../src/lib/rulebook/srd-5.1.json"), "utf8"));
const { englishItemName, italianGlossary } = await import("../src/lib/language/srd-names-it.ts");
const { withLanguage, languageDirective } = await import("../src/lib/dm/table-language-logic.ts");
const { itemRow } = await import("../src/lib/srd/item-tags.ts");
const { srdNameFor } = await import("../src/lib/dm/item-logic.ts");

const ITEM_GROUPS = ["magicItems", "weapons", "armor", "gear"];

await test("every category has names, under the licence's attribution", () => {
  assert.match(names._attribution, /System Reference Document 5\.1.*Creative Commons Attribution 4\.0/s);
  const expected = { spells: 319, creatures: 317, magicItems: 239, weapons: 37, armor: 13, gear: 133 };
  for (const [group, count] of Object.entries(expected)) {
    assert.equal(Object.keys(names[group]).length, count, `${group}: ${Object.keys(names[group]).length} names`);
  }
  for (const group of ["abilities", "skills", "conditions", "damageTypes", "classes", "races"]) {
    assert.ok(Object.keys(names.rules[group]).length > 0, `rules ${group}: empty`);
  }
});

await test("every English name is one the game knows", () => {
  const titles = (kind) => new Set(rulebook.pages.filter((page) => page.kind === kind).map((page) => page.title));
  for (const [group, kind] of [["spells", "spell"], ["creatures", "monster"], ["magicItems", "item"]]) {
    const known = titles(kind);
    for (const english of Object.keys(names[group])) {
      assert.ok(known.has(english), `${group}: "${english}" is no SRD ${kind}`);
    }
  }
  for (const group of ["weapons", "armor", "gear"]) {
    for (const english of Object.keys(names[group])) {
      assert.ok(itemRow({ name: english }), `${group}: no item row is "${english}"`);
    }
  }
});

await test("no Italian name stands for two English things in one category, nor for two items", () => {
  for (const [group, pairs] of Object.entries(names)) {
    if (group.startsWith("_") || group === "rules") continue;
    const italian = Object.values(pairs).map((name) => name.toLowerCase());
    assert.equal(new Set(italian).size, italian.length, `${group}: an Italian name twice`);
  }
  const byItalian = new Map();
  for (const group of ITEM_GROUPS) {
    for (const [english, italian] of Object.entries(names[group])) {
      const key = italian.toLowerCase();
      assert.ok(!byItalian.has(key) || byItalian.get(key) === english, `"${italian}" is both ${byItalian.get(key)} and ${english}`);
      byItalian.set(key, english);
    }
  }
});

await test("an official Italian item name, whole, finds the English row; a part of one finds nothing", () => {
  assert.equal(englishItemName("Spada lunga"), "Longsword");
  assert.equal(englishItemName("spada LUNGA"), "Longsword");
  assert.equal(englishItemName("Borsa conservante"), "Bag of Holding");
  assert.equal(englishItemName("Spada lunga +1"), "Longsword +1");
  assert.equal(englishItemName("Spada"), undefined);
  assert.equal(englishItemName("Lunga"), undefined);
  assert.equal(itemRow({ name: "Spada lunga" })?.name, itemRow({ name: "Longsword" })?.name);
  assert.equal(itemRow({ name: "Pozione di guarigione" })?.name, itemRow({ name: "Potion of Healing" })?.name);
  assert.equal(itemRow({ name: "Spada lunga +1" })?.name, itemRow({ name: "Longsword" })?.name);
  assert.equal(itemRow({ name: "Corda di Canapa (15 metri)" })?.name, itemRow({ name: "Rope, hempen (50 feet)" })?.name);
  assert.equal(itemRow({ name: "Spada" }), null);
  // An English name that is also an Italian one ("Totem") neither loops nor
  // changes.
  assert.equal(itemRow({ name: "Totem" })?.name, itemRow({ name: "Totem" })?.name);
});

await test("srdName may be the official Italian name; a partial one is refused as before", () => {
  assert.deepEqual(srdNameFor("Spada lunga", "give_item"), { srdName: itemRow({ name: "Longsword" }).name });
  assert.deepEqual(srdNameFor("Borsa conservante", "give_item"), { srdName: "Bag of Holding" });
  const refused = srdNameFor("Spada", "give_item");
  assert.equal(refused.retry, true);
  assert.match(refused.error, /no SRD or pack item is called "Spada"/);
});

await test("the glossary lists the rules names a prompt holds, and only those", () => {
  const glossary = italianGlossary("Brann casts Magic Missile at the Goblin, then drinks a Potion of Healing while Prone.");
  assert.match(glossary, /^OFFICIAL ITALIAN NAMES/);
  assert.match(glossary, /- Magic Missile → Dardo incantato/);
  assert.match(glossary, /- Potion of Healing → Pozione di guarigione/);
  assert.match(glossary, /- Prone → Prono/);
  // The same word in both languages needs no line.
  assert.doesNotMatch(glossary, /Goblin/);
  assert.doesNotMatch(glossary, /^- Healing →/m);
  assert.equal(italianGlossary("Bruno walks into the tavern."), "");
});

await test("an Italian prose call gets the glossary before the directive; other tables read as before", () => {
  const system = "Describe the room. The party's wizard knows Fireball.";
  const italian = withLanguage(system, "italian");
  assert.equal(italian, `${system}\n\n${italianGlossary(system)}\n\n${languageDirective("italian")}`);
  assert.match(italian, /- Fireball → Palla di fuoco/);
  assert.equal(withLanguage(system, "english"), system);
  assert.doesNotMatch(withLanguage(system, "spanish"), /OFFICIAL ITALIAN NAMES/);
  assert.equal(withLanguage("Nothing here.", "italian"), `Nothing here.\n\n${languageDirective("italian")}`);
});

finish();
