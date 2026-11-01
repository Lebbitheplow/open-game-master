// A kindness lands as one whatever an NPC is called (issue 732). The name
// hash that seeds a personality read about half of all seeds as negative,
// which put every axis of those names at -3..-1, so helping a friendly NPC
// could cost regard by their name alone. Registering an NPC saves that
// personality, so the rows already played carry the skew: the repair moves
// them onto the corrected spread, at upgrade, at a rewind to an older
// chapter and when a module exported before the fix is imported.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const world = await openWorld();
const { getDatabase } = await import("../src/lib/db/core.ts");
const { getNpcByName } = await import("../src/lib/db/npcs.ts");
const { getRelationship } = await import("../src/lib/db/relationships.ts");
const { derivePersonality, clampAxis } = await import("../src/lib/dm/npc-logic.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const { repairSkewedPersonalities } = await import("../src/lib/db/npc-personality-repair.ts");
const { restoreSnapshot } = await import("../src/lib/db/snapshots.ts");
const { importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { workshopBundleSchema } = await import("../src/lib/workshop/bundle-schema.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// What derivePersonality gave before the fix, written out so the repair is
// checked against the real old output.
function skewed(name, attitude, trait = "") {
  let hash = 5381;
  const key = `${textKey(name)}|${textKey(trait)}`;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 33) ^ key.charCodeAt(index);
  }
  const seed = hash >>> 0;
  const axis = (index) => ((seed >> (index * 4)) % 3) - 1;
  const lean = attitude === "friendly" ? 1 : attitude === "hostile" ? -1 : 0;
  return {
    drive: clampAxis(axis(0)),
    diligence: clampAxis(axis(1)),
    boldness: clampAxis(axis(2)),
    warmth: clampAxis(axis(3) + lean * 2),
    empathy: clampAxis(axis(4) + lean),
    composure: clampAxis(axis(5)),
  };
}

const db = getDatabase();
const save = (id, personality) => db.prepare(`UPDATE npcs SET personality_json = ? WHERE id = ?`).run(JSON.stringify(personality), id);
const saved = (id) => JSON.parse(db.prepare(`SELECT personality_json FROM npcs WHERE id = ?`).get(id).personality_json);

const hero = world.addHero({ name: "Kael", gender: "Male" });

await test("helping a friendly NPC raises their regard, whatever their name (the issue's case)", async () => {
  const registered = await world.invoke("set_npc", { name: "Daran Edermath", gender: "Male", attitude: "friendly" });
  assert.ok(registered.ok, registered.error);
  const daran = getNpcByName(world.campaignId, "Daran Edermath");
  assert.deepEqual(daran.agency.personality, derivePersonality("Daran Edermath", "friendly", ""), "registration saves the corrected spread");
  assert.ok(daran.agency.personality.empathy >= 0);
  const beat = await world.invoke("relationship_beat", { characterId: hero.id, subject: "Daran Edermath", beat: "helped" });
  assert.ok(beat.ok, beat.error);
  assert.ok(getRelationship(world.campaignId, hero.id, "Daran Edermath").approval > 0);
});

await test("a row saved from the skewed hash moves onto the corrected spread; a hand-set one stays", async () => {
  await world.invoke("set_npc", { name: "Halia Thornton", gender: "Female", attitude: "indifferent", trait: "guild agent" });
  await world.invoke("set_npc", { name: "Toblen Stonehill", gender: "Male", attitude: "friendly" });
  const halia = getNpcByName(world.campaignId, "Halia Thornton");
  const toblen = getNpcByName(world.campaignId, "Toblen Stonehill");
  save(halia.id, skewed("Daran Edermath", "indifferent"));
  // Saved skewed under the name she had, then renamed: the old name is an alias.
  db.prepare(`UPDATE npcs SET aliases_json = ? WHERE id = ?`).run(JSON.stringify(["Daran Edermath"]), halia.id);
  db.prepare(`UPDATE npcs SET trait = '' WHERE id = ?`).run(halia.id);
  const handSet = { drive: 3, diligence: -3, boldness: 2, warmth: -1, empathy: 1, composure: 0 };
  save(toblen.id, handSet);
  assert.ok(repairSkewedPersonalities(db, world.campaignId) >= 1);
  assert.deepEqual(saved(halia.id), derivePersonality("Daran Edermath", "indifferent", ""));
  assert.deepEqual(saved(toblen.id), handSet);
  assert.equal(repairSkewedPersonalities(db, world.campaignId), 0, "a repaired row is never moved twice");
  assert.ok(db.prepare(`SELECT 1 FROM app_settings WHERE key = 'npc_personality_repair_done'`).get(), "the upgrade ran its one pass");
});

await test("a lasting companion's row, seeded from the sheet's name and personality text, is repaired too", async () => {
  const personality = "Dry wit, quick to forgive, slow to trust strangers who talk too much.";
  const added = await world.invoke("add_companion", { name: "Linene Graywind", class: "fighter", gender: "Male", personality, kind: "party" });
  assert.ok(added.ok, added.error);
  const row = db.prepare(`SELECT id FROM npcs WHERE campaign_id = ? AND companion_sheet_id != ''`).get(world.campaignId);
  assert.ok(row, "the companion has a row behind it");
  assert.deepEqual(saved(row.id), derivePersonality("Linene Graywind", "friendly", personality));
  assert.notDeepEqual(skewed("Linene Graywind", "friendly", personality), saved(row.id), "the old shift skewed this seed");
  save(row.id, skewed("Linene Graywind", "friendly", personality));
  repairSkewedPersonalities(db, world.campaignId);
  assert.deepEqual(saved(row.id), derivePersonality("Linene Graywind", "friendly", personality));
});

await test("a rewind to a chapter saved before the fix repairs what it brings back", async () => {
  await world.invoke("set_npc", { name: "Sildar Hallwinter", gender: "Male", attitude: "friendly" });
  const sildar = getNpcByName(world.campaignId, "Sildar Hallwinter");
  save(sildar.id, skewed("Sildar Hallwinter", "friendly"));
  const rows = db.prepare(`SELECT * FROM npcs WHERE campaign_id = ?`).all(world.campaignId);
  db.transaction(() => restoreSnapshot(world.campaignId, { tables: { npcs: rows } }))();
  assert.deepEqual(saved(sildar.id), derivePersonality("Sildar Hallwinter", "friendly", ""));
});

await test("a module exported before the fix lands with its NPCs repaired", async () => {
  const bundle = workshopBundleSchema.parse({
    kind: "odm.workshop",
    version: 1,
    manifest: { name: "Old export", blurb: "sample", inspiredBy: "none" },
    npcs: [{ name: "Daran Edermath", attitude: "friendly", gender: "Male", personality: JSON.stringify(skewed("Daran Edermath", "friendly")) }],
  });
  const landed = importWorkshopBundle(world.owner.id, bundle);
  assert.ok(!("error" in landed), landed.error);
  assert.deepEqual(getNpcByName(landed.workshopId, "Daran Edermath").agency.personality, derivePersonality("Daran Edermath", "friendly", ""));
});

console.log(`${passed} npc personality repair tests passed`);
