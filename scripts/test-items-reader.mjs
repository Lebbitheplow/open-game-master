// The items reader (docs/specs/ogm-domain-owners.md slice 3,
// src/lib/dm/items-reader.ts): at a staged table the story's moves of things
// are read once, at the turn's end, and made by the items owner. The model is
// scripted; what is pinned is what the server does with what it names.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-items-reader");
const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true, npcStage: true, tableLanguage: "italian" } });
const model = await fakeModel();
model.pointAt(world);
const logic = await import("../src/lib/dm/items-reader-logic.ts");
const reader = await import("../src/lib/dm/items-reader.ts");
const { upsertNpc, getNpcByName, setNpcState } = await import("../src/lib/db/npcs.ts");
const minds = await import("../src/lib/db/npc-minds.ts");
const cast = await import("../src/lib/db/cast-sheets.ts");
const sheets = await import("../src/lib/db/sheets.ts");
const { writeItems } = await import("../src/lib/owners/items.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { listDroppedItems } = await import("../src/lib/db/dropped-items.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const { applyDmMutation } = await import("../src/lib/dm/mutations.ts");
const { withoutLeadingStopWords } = await import("../src/lib/language/language.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const italian = (word) => withoutLeadingStopWords(textKey(word), "italian");

const brakk = world.addHero({ name: "Brakk", race: "half-orc", class: "barbarian" });
const row = upsertNpc({ campaignId: world.campaignId, name: "Kaku" });
minds.setNpcTier(row.id, "primary");
setNpcState(row.id, { custody: "free", heldBy: "", restraint: "none", condition: "up", withParty: true, disarmed: false, carries: ["una lenza"] });
cast.castSheetFor(getNpcByName(world.campaignId, "Kaku"));
writeItems(brakk.id, { equipment: [{ name: "Pesce", qty: 2 }, { name: "una bussola d'ottone", qty: 1 }] });

const json = (value) => reply({ text: JSON.stringify(value) });
const brakkHas = () => sheets.getSheetById(brakk.id).equipment.map((item) => `${item.name}${(item.qty ?? 1) > 1 ? ` x${item.qty}` : ""}`);
const kakuHas = () => cast.npcThings(getNpcByName(world.campaignId, "Kaku"));
async function endOfTurn(moves, narration = "Il racconto del turno.", heroLines = [], before = () => {}) {
  model.items([json({ moves })]);
  const turn = createDmTurn(world.campaignId, []);
  return runInTurnScope(turn.id, async () => {
    before(turn);
    return reader.recordStoryItems(getCampaignById(world.campaignId), turn, heroLines, narration);
  });
}

await test("pure rules: who takes part, the ground, loss, and nothing made", () => {
  const people = [{ name: "Brakk", hero: true, carries: ["Pesce"] }, { name: "Kaku", hero: false, carries: [] }];
  assert.deepEqual(logic.planItemMove({ thing: "pesce", from: "Brakk", to: "Kaku" }, people, italian), { kind: "hand", thing: "pesce", from: "Brakk", to: "Kaku" });
  assert.equal(logic.planItemMove({ thing: "pesce", from: "Brakk", to: "ground" }, people, italian).kind, "drop");
  assert.equal(logic.planItemMove({ thing: "pesce", from: "terra", to: "Kaku" }, people, italian).kind, "pickup", "the table's own word for the ground");
  assert.equal(logic.planItemMove({ thing: "pesce", from: "Brakk", to: "" }, people, italian).kind, "lose");
  assert.equal(logic.planItemMove({ thing: "un tesoro", from: "", to: "Brakk" }, people, italian).kind, "refused", "nothing is made by the record");
  assert.equal(logic.planItemMove({ thing: "pesce", from: "Brakk", to: "Ugo" }, people, italian).kind, "refused", "only people here");
  assert.equal(logic.parseItemMoves("niente").ok, false);
  assert.deepEqual(logic.parseItemMoves('{"moves":[{"thing":"","from":"a","to":"b"}]}'), { ok: true, moves: [] }, "a move without a thing is dropped");
  assert.match(logic.renderItemsReaderPrompt({ people, ground: ["una lenza"], heroLines: [{ name: "Brakk", text: "Do il pesce a Kaku." }], narration: "Brakk porge il pesce.", stage: "", recorded: ["Brakk: use Pesce"] }), /On the ground here: una lenza[\s\S]*- Brakk: Do il pesce a Kaku\.[\s\S]*Already recorded this turn:\n- Brakk: use Pesce/);
});

await test("a hand-over the story told reaches both sheets, read once at the turn's end", async () => {
  const out = await endOfTurn([{ thing: "il pesce", from: "Brakk", to: "Kaku" }], "Brakk porge un pesce a Kaku.", [{ name: "Brakk", text: "Do un pesce a Kaku." }]);
  assert.deepEqual(out.refused, []);
  assert.deepEqual(brakkHas(), ["Pesce", "una bussola d'ottone"]);
  assert.deepEqual(kakuHas(), ["una lenza", "Pesce"]);
  const read = model.itemsRequests.at(-1).messages.map((message) => message.content).join("\n");
  assert.match(read, /- Brakk \(hero\): Pesce x2; una bussola/, "the reader sees what each holds");
  assert.match(read, /- Brakk: Do un pesce a Kaku\./, "and the hero's own words");
});

await test("a thing put down lies on the ground here, and is picked up from it", async () => {
  await endOfTurn([{ thing: "la lenza", from: "Kaku", to: "ground" }], "Kaku posa la lenza sulle assi.");
  assert.deepEqual(kakuHas(), ["Pesce"]);
  assert.deepEqual(listDroppedItems(world.campaignId).map((item) => item.item.name), ["una lenza"], "it lies here, not gone");
  await endOfTurn([{ thing: "una lenza", from: "ground", to: "Brakk" }], "Brakk raccoglie la lenza.");
  assert.ok(brakkHas().includes("una lenza"));
  assert.deepEqual(listDroppedItems(world.campaignId), []);
});

await test("a thing used up is lost once: the rules' use_item and the story's telling are one loss", async () => {
  const out = await endOfTurn([{ thing: "Pesce", from: "Kaku", to: "" }], "Kaku divora il pesce.");
  assert.deepEqual(out.applied.length, 1);
  assert.deepEqual(kakuHas(), []);
  writeItems(brakk.id, { equipment: [...sheets.getSheetById(brakk.id).equipment, { name: "Pane", qty: 2 }] });
  await endOfTurn([{ thing: "il pane", from: "Brakk", to: "" }], "Brakk mangia un pane.", [], (turn) => {
    const all = sheets.listSheets(world.campaignId);
    applyDmMutation(getCampaignById(world.campaignId), turn.id, "remove_item", JSON.stringify({ characterId: brakk.id, item: "Pane", qty: 1, reason: "eaten" }), all, new Map(all.map((sheet) => [sheet.id, sheet])));
  });
  assert.equal(sheets.getSheetById(brakk.id).equipment.find((item) => item.name === "Pane")?.qty ?? 1, 1, "one bread eaten, not two");
});

await test("what the story cannot have done is refused, and nothing is made", async () => {
  const before = brakkHas();
  const out = await endOfTurn([{ thing: "una spada d'oro", from: "", to: "Brakk" }, { thing: "la bussola d'ottone", from: "Kaku", to: "Brakk" }], "Kaku dà a Brakk una bussola e una spada d'oro.");
  assert.equal(out.applied.length, 0);
  assert.equal(out.refused.length, 2);
  assert.deepEqual(brakkHas(), before);
});

await test("a few biscuits eaten never take the sack, and a drink never takes the skin", async () => {
  assert.equal(logic.wholeThingNamed(["il sacco delle gallette"], "gallette", italian), null, "fewer words than the line: not the whole thing");
  assert.equal(logic.wholeThingNamed(["una bottiglia di rum"], "la bottiglia di rum", italian), "una bottiglia di rum", "the whole thing, with its article, is found");
  assert.equal(logic.wholeThingNamed(["Pane", "Pane di segale"], "pane", italian), "Pane", "the exact line wins over a longer one");
  assert.match(logic.ITEMS_READER_SYSTEM, /Drinking from a skin, bottle or barrel, or taking some out of a sack or a box, moves nothing/);
  writeItems(brakk.id, { equipment: [...sheets.getSheetById(brakk.id).equipment, { name: "il sacco delle gallette", qty: 1 }] });
  const out = await endOfTurn([{ thing: "gallette", from: "Brakk", to: "" }], "Brakk apre il sacco e mangia due gallette.");
  assert.equal(out.applied.length, 0);
  assert.ok(brakkHas().includes("il sacco delle gallette"), "the sack is still Brakk's");
});

await test("only what the turn names moves: no fish for water, no sack for its biscuits, one biscuit of a count", async () => {
  assert.equal(logic.storyNamesThing("Quarto di pesce crudo", "Mairon beve un sorso d'acqua.", italian), false, "water is not the fish");
  assert.equal(logic.storyNamesThing("il sacco delle gallette", "Brakk passa due gallette a Kaku.", italian), false, "the biscuits are not the sack");
  assert.equal(logic.storyNamesThing("il sacco delle gallette", "Brakk consegna il sacco a Kaku.", italian), true, "the sack named is the sack");
  assert.equal(logic.storyNamesThing("Waterskin", "Gruoch passa l'otre a Brakk.", italian, "Otre"), true, "the Italian name counts");
  writeItems(brakk.id, { equipment: [...sheets.getSheetById(brakk.id).equipment, { name: "Quarto di pesce crudo", qty: 1 }, { name: "Galletta", qty: 6 }] });
  const swapped = await endOfTurn([{ thing: "Quarto di pesce crudo", from: "Brakk", to: "Kaku" }], "Brakk dà da bere a Kaku dalla sua acqua.");
  assert.equal(swapped.applied.length, 0);
  assert.match(swapped.refused[0], /never names/);
  const sack = await endOfTurn([{ thing: "il sacco delle gallette", from: "Brakk", to: "Kaku" }], "Brakk prende due gallette e le dà a Kaku.");
  assert.equal(sack.applied.length, 0, "the sack stays");
  assert.ok(brakkHas().includes("il sacco delle gallette"));
  const one = await endOfTurn([{ thing: "Galletta", from: "Brakk", to: "Kaku" }], "Brakk dà una galletta a Kaku.");
  assert.equal(one.applied.length, 1);
  assert.ok(brakkHas().includes("Galletta x5"), "one of six handed");
  assert.ok(kakuHas().some((thing) => /galletta/i.test(thing)));
});

await test("things lying aboard travel with the raft; walking away leaves them", async () => {
  const { handleLocationCall } = await import("../src/lib/dm/turn.ts");
  const { insertDroppedItem } = await import("../src/lib/db/dropped-items.ts");
  const campaign = getCampaignById(world.campaignId);
  handleLocationCall(campaign, "move_party", JSON.stringify({ name: "Banco delle Croci", visionClear: true }), false);
  insertDroppedItem({ campaignId: world.campaignId, mapId: null, x: null, y: null, place: "Banco delle Croci", item: { name: "una bussola d'ottone", qty: 1 }, droppedBy: "Mairon", heldByEnemy: null });
  const moved = handleLocationCall(campaign, "move_party", JSON.stringify({ name: "Spiaggia delle Secche", visionClear: true, aboard: true }), false);
  assert.match(moved.note, /1 thing\(s\) lying aboard came along/);
  assert.equal(listDroppedItems(world.campaignId).find((item) => item.item.name === "una bussola d'ottone")?.place, "Spiaggia delle Secche");
  handleLocationCall(campaign, "move_party", JSON.stringify({ name: "La duna", visionClear: true }), false);
  assert.equal(listDroppedItems(world.campaignId).find((item) => item.item.name === "una bussola d'ottone")?.place, "Spiaggia delle Secche", "on foot it stays");
});

model.close();
finish();
