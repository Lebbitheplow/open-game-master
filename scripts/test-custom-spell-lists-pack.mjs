// The content pack's side of a workshop class's own spell list (issue #833),
// on a pack of this suite's own, so it runs (and holds) whether or not the
// real pack is installed: CI runs without it.
//
// - "Start from" a pack's own caster (a class whose list no SRD class has)
//   copies that class's list from the pack's spells. It used to borrow the
//   wizard's: the copy asked a pool that drops every pack row no workshop
//   list names, so it found nothing and fell back.
// - The GM's learn_spell refuses a pack spell that names no class, as the
//   save's check does: a spell on no list is on no caster's list.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-833-pack-"));
const packPath = path.join(dir, "open5e.sqlite");
// Before anything reads the pack's path (src/lib/content/db.ts).
process.env.CONTENT_DB_PATH = packPath;

const { openDatabase } = await import("../src/lib/db/driver.ts");
const pack = openDatabase(packPath);
// The pack's own tables, empty but for the spells below (the importer's
// schema, scripts/import-open5e.mjs), so every reader finds what it asks for.
for (const sql of [
  "CREATE TABLE spells ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, level INTEGER NOT NULL, school TEXT NOT NULL, classes_csv TEXT NOT NULL, ritual INTEGER NOT NULL, concentration INTEGER NOT NULL, aliases_csv TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL )",
  "CREATE TABLE feats ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, aliases_csv TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL )",
  "CREATE TABLE conditions ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, data_json TEXT NOT NULL )",
  "CREATE TABLE backgrounds ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, skills_csv TEXT NOT NULL, data_json TEXT NOT NULL )",
  "CREATE TABLE races ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, is_subrace INTEGER NOT NULL, parent_slug TEXT NOT NULL, data_json TEXT NOT NULL )",
  "CREATE TABLE classes ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, hit_die INTEGER NOT NULL, data_json TEXT NOT NULL )",
  "CREATE TABLE archetypes ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, class_slug TEXT NOT NULL, data_json TEXT NOT NULL )",
  "CREATE TABLE items ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('weapon','armor','gear','magic_item')), rarity TEXT NOT NULL, cost TEXT NOT NULL, category TEXT NOT NULL, weight REAL NOT NULL DEFAULT 0, data_json TEXT NOT NULL )",
  "CREATE TABLE monsters ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, document_slug TEXT NOT NULL, cr REAL NOT NULL, type TEXT NOT NULL, data_json TEXT NOT NULL )",
  "CREATE TABLE documents ( slug TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, license TEXT NOT NULL, author TEXT NOT NULL, url TEXT NOT NULL, data_json TEXT NOT NULL )",
  "CREATE TABLE readings ( kind TEXT NOT NULL, slug TEXT NOT NULL, document_slug TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('hand-written', 'parsed', 'missing')), checked INTEGER NOT NULL, unread_json TEXT NOT NULL, mechanics_json TEXT, PRIMARY KEY (kind, slug) )",
  "CREATE TABLE entry_needs ( kind TEXT NOT NULL, slug TEXT NOT NULL, document_slug TEXT NOT NULL, needs_json TEXT NOT NULL, PRIMARY KEY (kind, slug) )",
  "CREATE TABLE pack_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
]) {
  pack.exec(sql);
}
const row = (slug, name, level, classes, desc) =>
  pack
    .prepare(`INSERT INTO spells VALUES (?, ?, 'fixture-tinkering', ?, 'transmutation', ?, 0, 0, '', ?)`)
    .run(slug, name, level, classes, JSON.stringify({ desc, casting_time: "1 action", range: "30 feet", components: "V, S", duration: "Instantaneous" }));
row("gizmo-spark", "Gizmo Spark", 0, "artificer", "A spark jumps from your tools.");
row("clockwork-ward", "Clockwork Ward", 1, "artificer,wizard", "Gears turn a blow aside.");
row("hollow-rune", "Hollow Rune", 1, "", "A rune nobody's list carries.");
pack.close();

const { test, finish } = suite("test-custom-spell-lists-pack");
// The world first: it points the server's database at this suite's own.
const { openWorld } = await import("./lib/enforce-world.mjs");
const world = await openWorld();
const { searchSpells } = await import("../src/lib/content/index.ts");
const { contentPackInstalled } = await import("../src/lib/content/db.ts");
const { checklistSpellsOn } = await import("../src/lib/srd/spell-lists.ts");
const { withMechanics } = await import("../src/lib/workshop/catalog-mechanics.ts");

await test("the suite's own pack is the one the server reads", () => {
  assert.equal(contentPackInstalled(), true);
  const found = searchSpells({ classSlug: "artificer", limit: 200 }).map((spell) => spell.name);
  for (const name of ["Clockwork Ward", "Gizmo Spark"]) assert.ok(found.includes(name), `${name} missing: ${found.join(", ")}`);
});

await test("a caster whose list no SRD class has is copied with its list as the pack files it", () => {
  // The pack's artificer row: copied from the bundled table, its list
  // read from the checklist and the pack together.
  const [copied] = withMechanics("classes", [{ name: "Artificer", slug: "artificer", source: "open5e", data: { desc: "" } }]);
  assert.ok(copied.table, "the class came with no table to copy");
  assert.equal(copied.table.spellListFrom, "custom", `the copy borrowed the ${copied.table.spellListFrom} list`);
  for (const name of ["Gizmo Spark", "Clockwork Ward", ...checklistSpellsOn("artificer").map((spell) => spell.name)]) {
    assert.ok(copied.table.spellList.includes(name), `${name} is missing from the copy's list`);
  }
});

await test("a search names another author's workshop class and reads nothing of its list", async () => {
  const homebrew = await world.route("homebrew");
  world.signIn(world.owner);
  const response = await homebrew.POST(
    new Request("http://test/", {
      method: "POST",
      body: JSON.stringify({
        kind: "class",
        name: "Cogwright",
        data: {
          desc: "",
          hitDie: 8,
          saves: ["con", "int"],
          skillChoices: { count: 2, from: ["arcana", "history", "investigation"] },
          armor: [],
          weapons: ["simple"],
          tools: [],
          casterType: "full",
          spellAbility: "int",
          spellListFrom: "custom",
          spellList: ["Clockwork Ward"],
          subclassLevel: 3,
          levels: {},
        },
      }),
    }),
  );
  const made = await response.json();
  assert.equal(response.status, 201, JSON.stringify(made));
  const classId = `homebrew-${made.entry.id}`;
  assert.deepEqual(searchSpells({ classSlug: classId, userIds: [world.owner.id], limit: 50 }).map((spell) => spell.name), ["Clockwork Ward"]);
  const stranger = world.addUser("stranger");
  assert.deepEqual(searchSpells({ classSlug: classId, userIds: [stranger.id], limit: 50 }).map((spell) => spell.name), [], "another author's search read the class's list out of the pack");
});

await test("learn_spell refuses a pack spell that names no class, as the save's check does", async () => {
  const hero = world.addHero({
    name: "Ilvane",
    class: "wizard",
    gold: 100,
    level: 3,
    abilities: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], prepared: ["Shield"], cantrips: ["Fire Bolt"], spellbook: ["Shield"] },
  });
  const refused = await world.invoke("learn_spell", { characterId: hero.id, spell: "Hollow Rune", action: "add" });
  assert.equal(refused.refused, "rules", JSON.stringify(refused));
  const taught = await world.invoke("learn_spell", { characterId: hero.id, spell: "Clockwork Ward", action: "add" });
  assert.equal(taught.ok, true, JSON.stringify(taught));
  world.close();
});

// The pack stays open in src/lib/content/db.ts for the life of this process,
// and Windows refuses to remove an open SQLite file (EPERM). The directory is
// inside the runner's own scratch directory, which the runner removes.
finish();
