// The cast sheet (docs/specs/ogm-npc-cast-sheet.md, src/lib/db/cast-sheets.ts):
// a first-tier NPC keeps its things on a real sheet that no list of heroes
// and companions ever returns, and the item tools move a thing between a hero
// and that NPC in one server step.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-npc-cast-sheet");
const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true, npcStage: true } });
const { upsertNpc, getNpcByName, setNpcState } = await import("../src/lib/db/npcs.ts");
const minds = await import("../src/lib/db/npc-minds.ts");
const sheets = await import("../src/lib/db/sheets.ts");
const cast = await import("../src/lib/db/cast-sheets.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const events = await import("../src/lib/events.ts");

const brakk = world.addHero({ name: "Brakk", race: "half-orc", class: "barbarian" });
const bare = { custody: "free", heldBy: "", restraint: "none", condition: "up", withParty: true, disarmed: false, carries: [] };
const npc = (name, state = {}) => {
  const row = upsertNpc({ campaignId: world.campaignId, name });
  minds.setNpcTier(row.id, "primary");
  setNpcState(row.id, { ...bare, ...state });
  return getNpcByName(world.campaignId, name);
};
const namesOf = (sheet) => sheet.equipment.map((item) => item.name);

await test("a first-tier NPC's things move onto a cast sheet no list of heroes returns", () => {
  const volodar = npc("Volodar", { carries: ["la chiave del barile d'acqua", "una balestra"] });
  const sheet = cast.castSheetFor(volodar);
  assert.deepEqual(namesOf(sheet), ["la chiave del barile d'acqua", "una balestra"], "the words became items");
  assert.deepEqual(getNpcByName(world.campaignId, "Volodar").state.carries, [], "and the list is emptied");
  assert.equal(getNpcByName(world.campaignId, "Volodar").castSheetId, sheet.id, "the row points at its sheet");
  assert.equal(cast.castSheetFor(getNpcByName(world.campaignId, "Volodar")).id, sheet.id, "asked again, the same sheet");
  assert.deepEqual(sheets.listSheets(world.campaignId).map((entry) => entry.id), [brakk.id], "listSheets: the heroes and companions only");
  assert.deepEqual(sheets.listCastSheets(world.campaignId).map((entry) => entry.id), [sheet.id]);
  assert.ok(sheets.getSheetById(sheet.id), "found by id");
  assert.match(sheet.userId, /^cast_/, "owned by a cast bot");
  assert.deepEqual(cast.npcThings(getNpcByName(world.campaignId, "Volodar")), ["la chiave del barile d'acqua", "una balestra"]);
});

await test("a cast sheet is never sent to the table as a character", () => {
  const sheet = cast.castSheetFor(getNpcByName(world.campaignId, "Volodar"));
  const sent = () => getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaign_events WHERE campaign_id = ? AND type = 'sheet_updated'`).get(world.campaignId).n;
  const before = sent();
  events.publishPersisted(world.campaignId, "sheet_updated", { sheet });
  assert.equal(sent(), before, "no sheet_updated for a cast sheet");
  events.publishPersisted(world.campaignId, "sheet_updated", { sheet: sheets.getSheetById(brakk.id) });
  assert.equal(sent(), before + 1, "a hero's still goes out");
});

await test("the key: a first-tier NPC hands a hero a thing in one server step, by name", async () => {
  const out = await world.invoke("handle_item", { characterId: "Volodar", action: "hand", item: "la chiave del barile d'acqua", toCharacterId: brakk.id });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(namesOf(world.sheet(brakk.id)).includes("la chiave del barile d'acqua"), "the key is on Brakk's sheet");
  const volodar = getNpcByName(world.campaignId, "Volodar");
  assert.deepEqual(cast.npcThings(volodar), ["una balestra"], "and gone from Volodar's");
  const again = await world.invoke("handle_item", { characterId: "Volodar", action: "hand", item: "la chiave del barile d'acqua", toCharacterId: brakk.id });
  assert.ok(again.error, "a thing the giver no longer has is refused");
  assert.deepEqual(cast.npcThings(getNpcByName(world.campaignId, "Volodar")), ["una balestra"], "and nothing changed");  const { npcStateWords } = await import("../src/lib/dm/npc-state-logic.ts");
  assert.match(npcStateWords(cast.stateWithThings(getNpcByName(world.campaignId, "Volodar"))), /carries una balestra/, "the roster reads the sheet");
});

await test("the rum: a hero hands a first-tier NPC a thing back, the NPC made a sheet on the spot", async () => {
  const mairon = npc("Mairon", { carries: ["una bottiglia di rum"] });
  assert.equal(mairon.castSheetId, "", "no sheet yet");
  const given = await world.invoke("handle_item", { characterId: "Mairon", action: "hand", item: "una bottiglia di rum", toCharacterId: "Brakk" });
  assert.equal(given.ok, true, JSON.stringify(given));
  const back = await world.invoke("handle_item", { characterId: brakk.id, action: "hand", item: "una bottiglia di rum", toCharacterId: "Mairon" });
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.deepEqual(cast.npcThings(getNpcByName(world.campaignId, "Mairon")), ["una bottiglia di rum"], "the rum is Mairon's, one");
  assert.ok(!namesOf(world.sheet(brakk.id)).some((name) => /rum/.test(name)), "and not Brakk's");
});

await test("grant_item and remove_item reach a cast sheet; no other tool does, and npc_state carries is refused for first tier", async () => {
  const found = await world.invoke("grant_item", { characterId: "Mairon", item: "Pesce", reason: "pescato" });
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.ok(cast.npcThings(getNpcByName(world.campaignId, "Mairon")).includes("Pesce"));
  const lost = await world.invoke("remove_item", { characterId: "Mairon", item: "Pesce", reason: "in mare" });
  assert.equal(lost.ok, true, JSON.stringify(lost));
  assert.ok(!cast.npcThings(getNpcByName(world.campaignId, "Mairon")).includes("Pesce"));
  const healed = await world.invoke("heal", { characterId: "Mairon", amount: 3 });
  assert.ok(healed.error, "a heal never lands on a cast sheet");
  const listed = await world.invoke("npc_state", { name: "Mairon", carries: ["un remo"] });
  assert.ok(listed.error && /handle_item/.test(listed.error), "carries for a first-tier NPC points to the item tools");
  assert.deepEqual(sheets.listSheets(world.campaignId).map((entry) => entry.id), [brakk.id], "the heroes' list never grew");
});

await test("deleting the campaign takes the cast bots with it", async () => {
  const { deleteCampaign } = await import("../src/lib/db/campaigns.ts");
  const owner = sheets.listCastSheets(world.campaignId)[0].userId;
  deleteCampaign(world.campaignId);
  assert.equal(getDatabase().prepare(`SELECT COUNT(*) AS n FROM users WHERE id = ?`).get(owner).n, 0);
});

world.close();
finish();
