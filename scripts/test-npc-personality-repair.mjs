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
const { getNpcById, getNpcByName, updateNpcFromDraft } = await import("../src/lib/db/npcs.ts");
const { draftFrom, normalizeNpcDraft } = await import("../src/lib/npcs/forge.ts");
const { getRelationship } = await import("../src/lib/db/relationships.ts");
const { derivePersonality, clampAxis } = await import("../src/lib/dm/npc-logic.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const { repairSkewedPersonalities } = await import("../src/lib/db/npc-personality-repair.ts");
const { captureBoundarySnapshot, restoreSnapshot } = await import("../src/lib/db/snapshots.ts");
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

await test("a row whose note the story rewrote after it was seeded is found by the note it was seeded from", async () => {
  // Registered with no note, so the name alone seeded who she is.
  await world.invoke("set_npc", { name: "Agatha Holt", gender: "Female", attitude: "friendly" });
  const agatha = getNpcByName(world.campaignId, "Agatha Holt");
  save(agatha.id, skewed("Agatha Holt", "friendly"));
  // A later set_npc writes the note the seed never saw (set_npc's trait is
  // the AI's own recall note, rewritten as the story goes).
  await world.invoke("set_npc", { name: "Agatha Holt", trait: "owes the party a favour" });
  assert.equal(getNpcByName(world.campaignId, "Agatha Holt").trait, "owes the party a favour");
  // The AI's turns keep the calls it made, with their arguments.
  const call = (id, args) => ({ id, type: "function", function: { name: "set_npc", arguments: JSON.stringify(args) } });
  const conversation = [
    { role: "user", content: "We knock at the farmhouse." },
    { role: "assistant", content: "", tool_calls: [call("a", { name: "Agatha Holt", gender: "Female", attitude: "friendly" })] },
    { role: "tool", tool_call_id: "a", content: "{\"ok\":true}" },
    { role: "assistant", content: "", tool_calls: [call("b", { name: "agatha holt", trait: "owes the party a favour" })] },
  ];
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO dm_turns (id, campaign_id, status, conversation_json, created_at, updated_at) VALUES (?, ?, 'done', ?, ?, ?)`)
    .run(crypto.randomUUID(), world.campaignId, JSON.stringify(conversation), at, at);
  repairSkewedPersonalities(db, world.campaignId);
  assert.deepEqual(saved(agatha.id), derivePersonality("Agatha Holt", "friendly", ""));
});

await test("a person the GM renamed in their people panel is found by the name a rewind point kept", async () => {
  await world.invoke("set_npc", { name: "Kell Graywind", gender: "Male", attitude: "friendly" });
  const kell = getNpcByName(world.campaignId, "Kell Graywind");
  save(kell.id, skewed("Kell Graywind", "friendly"));
  // A chapter opens, and its rewind point keeps the table as it stood.
  captureBoundarySnapshot(world.campaignId, 7, 0);
  // The people panel writes the whole record (updateNpcFromDraft): a new
  // name with the alias list as the form held it, and a new note, and no
  // turn of the AI's ever named him either way.
  const outcome = normalizeNpcDraft({ ...draftFrom(getNpcById(kell.id)), name: "Kell the Grey", aliases: [], trait: "ferryman" });
  assert.ok(!("error" in outcome), outcome.error);
  assert.ok(updateNpcFromDraft(world.campaignId, kell.id, outcome.draft));
  assert.deepEqual(getNpcById(kell.id).aliases, []);
  repairSkewedPersonalities(db, world.campaignId);
  assert.deepEqual(saved(kell.id), derivePersonality("Kell Graywind", "friendly", ""));
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
