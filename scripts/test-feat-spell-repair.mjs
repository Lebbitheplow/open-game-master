// The boot migration's mend of sheets written while ODM's Magic Initiate
// and Telepathic were misread (src/lib/db/feat-spell-repair.ts): a stored
// character's cantrip "It" comes off, a Telepathic character gains its free
// detect thoughts, in a table's sheets and in the library, and a rewind or a
// module's import mends its one campaign. Real database, no model.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openWorld } from "./lib/enforce-world.mjs";

const world = await openWorld();
const { getDatabase } = await import("../src/lib/db/core.ts");
const { repairFeatSpellMisreadings } = await import("../src/lib/db/feat-spell-repair.ts");
const { freeCastFeatureName } = await import("../src/lib/srd/feat-spells.ts");
const db = getDatabase();

const PHANTOM = { ability: "int", slots: {}, cantrips: ["It", "Fire Bolt", "Light"], known: ["Detect Thoughts"], prepared: [] };
const FREE = freeCastFeatureName("Detect Thoughts", "Telepathic");

// The rows as an older build wrote them.
const hero = world.addHero({ name: "Old Initiate", class: "fighter", level: 4 });
db.prepare(`UPDATE character_sheets SET feats_json = ?, spellcasting_json = ? WHERE id = ?`).run(
  JSON.stringify(["Magic Initiate", "Telepathic"]),
  JSON.stringify(PHANTOM),
  hero.id,
);
const bystander = world.addHero({ name: "Plain", class: "fighter", level: 4 });
const libraryId = randomUUID();
const now = new Date().toISOString();
db.prepare(
  `INSERT INTO library_characters (id, user_id, name, race, class, level, sheet_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(libraryId, world.owner.id, "Shelf Initiate", "human", "fighter", 4, JSON.stringify({ feats: ["Magic Initiate"], features: [], spellcasting: PHANTOM }), now, now);

const read = (id) => db.prepare(`SELECT features_json, spellcasting_json FROM character_sheets WHERE id = ?`).get(id);
const before = read(bystander.id);

// A rewind or an import mends only its own campaign.
assert.equal(repairFeatSpellMisreadings(db, world.campaignId), 1);
let row = read(hero.id);
assert.deepEqual(JSON.parse(row.spellcasting_json).cantrips, ["Fire Bolt", "Light"]);
assert.ok(JSON.parse(row.features_json).some((feature) => feature.name === FREE), "Telepathic's free cast was not added");
assert.deepEqual(read(bystander.id), before, "a sheet with neither feat was rewritten");
assert.match(db.prepare(`SELECT sheet_json FROM library_characters WHERE id = ?`).get(libraryId).sheet_json, /"It"/);

// The boot pass mends the library too, and a second pass changes nothing.
assert.equal(repairFeatSpellMisreadings(db), 1);
const shelf = JSON.parse(db.prepare(`SELECT sheet_json FROM library_characters WHERE id = ?`).get(libraryId).sheet_json);
assert.deepEqual(shelf.spellcasting.cantrips, ["Fire Bolt", "Light"]);
assert.equal(repairFeatSpellMisreadings(db), 0);
row = read(hero.id);
assert.equal(JSON.parse(row.features_json).filter((feature) => feature.name === FREE).length, 1);

console.log("ok: stored Magic Initiate and Telepathic sheets are mended once");
