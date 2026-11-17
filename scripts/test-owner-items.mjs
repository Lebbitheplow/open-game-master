// The items owner (docs/specs/ogm-domain-owners.md, src/lib/owners/items.ts):
// the one writer of what a sheet carries. A write that changes equipment, gold
// or copper by any other path is refused; a hand-over is both halves in one
// step; and the same hand-over asked twice in a turn happens once, whoever
// asks the second time.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-owner-items");
const world = await openWorld({ gameSettings: { ttsEnabled: false, npcMinds: true, npcStage: true, tableLanguage: "italian" } });
const sheets = await import("../src/lib/db/sheets.ts");
const items = await import("../src/lib/owners/items.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { getCampaignById: getCampaign } = await import("../src/lib/db/campaigns.ts");
const { handleItemCall } = await import("../src/lib/dm/gear-tool.ts");
const { withoutLeadingStopWords } = await import("../src/lib/language/language.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");

const brakk = world.addHero({ name: "Brakk", race: "half-orc", class: "barbarian" });
const amleth = world.addHero({ name: "Amleth", race: "human", class: "fighter" });
const namesOf = (id) => sheets.getSheetById(id).equipment.map((item) => item.name);
const count = (id, name) => sheets.getSheetById(id).equipment.filter((item) => item.name === name).reduce((sum, item) => sum + (item.qty ?? 1), 0);

await test("a sheet's things are written by their owner only: the raw setter refuses them", () => {
  const before = sheets.getSheetById(brakk.id);
  assert.throws(() => sheets.patchSheet(brakk.id, { equipment: [] }), /outside the items owner/);
  assert.throws(() => sheets.patchSheet(brakk.id, { gold: 99 }), /outside the items owner/);
  assert.deepEqual(sheets.getSheetById(brakk.id).equipment, before.equipment, "nothing was written");
  sheets.patchSheet(brakk.id, { notes: "un barbaro" });
  assert.equal(sheets.getSheetById(brakk.id).notes, "un barbaro", "what is not a thing still writes as before");
  items.writeItems(brakk.id, { gold: 3 });
  assert.equal(sheets.getSheetById(brakk.id).gold, 3, "through the owner it writes");
});

await test("a hand-over is both halves in one step, and a second telling in the same turn moves nothing", () => {
  items.writeItems(brakk.id, { equipment: [{ name: "Quarto di pesce crudo", qty: 3 }] });
  const campaign = getCampaign(world.campaignId);
  const turn = createDmTurn(world.campaignId, []);
  const hand = () =>
    handleItemCall(
      campaign,
      JSON.stringify({ characterId: brakk.id, action: "hand", item: "Quarto di pesce crudo", qty: 1, toCharacterId: amleth.id }),
      sheets.listSheets(world.campaignId),
      new Map(sheets.listSheets(world.campaignId).map((sheet) => [sheet.id, sheet])),
      turn,
    );
  assert.equal(hand().ok, true);
  assert.equal(count(brakk.id, "Quarto di pesce crudo"), 2);
  assert.equal(count(amleth.id, "Quarto di pesce crudo"), 1);
  const again = hand();
  assert.equal(again.ok, true, "asked again it is not an error");
  assert.match(again.applied, /already/, "it says it already happened");
  assert.equal(count(brakk.id, "Quarto di pesce crudo"), 2, "Brakk did not lose a second");
  assert.equal(count(amleth.id, "Quarto di pesce crudo"), 1, "Amleth did not get a second");

  const italian = (thing) => withoutLeadingStopWords(textKey(thing), "italian");
  const from = sheets.getSheetById(brakk.id);
  assert.equal(items.handedThisTurn(world.campaignId, turn, from, "il quarto di pesce crudo", "Amleth", italian), true, "told in other words, it is the same hand-over");
  assert.equal(items.handedThisTurn(world.campaignId, turn, from, "il quarto di pesce crudo", "Volodar", italian), false, "another taker is another move");
  assert.equal(items.handedThisTurn(world.campaignId, createDmTurn(world.campaignId, []), from, "il quarto di pesce crudo", "Amleth", italian), false, "and another turn is another turn");

  const next = createDmTurn(world.campaignId, []);
  const out = handleItemCall(
    campaign,
    JSON.stringify({ characterId: brakk.id, action: "hand", item: "Quarto di pesce crudo", qty: 1, toCharacterId: amleth.id }),
    sheets.listSheets(world.campaignId),
    new Map(sheets.listSheets(world.campaignId).map((sheet) => [sheet.id, sheet])),
    next,
  );
  assert.equal(out.ok, true);
  assert.equal(count(amleth.id, "Quarto di pesce crudo"), 2, "the next turn may hand another");
  assert.ok(namesOf(brakk.id).includes("Quarto di pesce crudo"), "Brakk keeps the last");
});

await test("the owner writes things only; a change that also touches other fields is cut in two", async () => {
  assert.throws(() => items.writeItems(brakk.id, { equipment: [], currentHp: 1 }), /equipment, gold and copper only, not currentHp/);
  const { patchWithItems } = await import("../src/lib/dm/sheet-patch.ts");
  const updated = patchWithItems(brakk.id, { gold: 7, notes: "un barbaro stanco" });
  assert.equal(updated.gold, 7, "the coin through the owner");
  assert.equal(updated.notes, "un barbaro stanco", "and the rest beside it");
});

await test("a thing someone in the scene holds is not made on a hero's sheet, by any path that grants", async () => {
  const { upsertNpc, getNpcByName, setNpcState } = await import("../src/lib/db/npcs.ts");
  const minds = await import("../src/lib/db/npc-minds.ts");
  const cast = await import("../src/lib/db/cast-sheets.ts");
  const row = upsertNpc({ campaignId: world.campaignId, name: "Kranz" });
  minds.setNpcTier(row.id, "primary");
  setNpcState(row.id, { custody: "free", heldBy: "", restraint: "none", condition: "up", withParty: true, disarmed: false, carries: ["una bussola d'ottone"] });
  cast.castSheetFor(getNpcByName(world.campaignId, "Kranz"));
  const before = namesOf(brakk.id);
  const hero = sheets.getSheetById(brakk.id);
  const refused = items.grant(world.campaignId, hero, "la bussola d'ottone", [...hero.equipment, { name: "la bussola d'ottone", qty: 1 }]);
  assert.match(refused?.error ?? "", /Kranz has "una bussola d'ottone".*handle_item/);
  assert.deepEqual(namesOf(brakk.id), before, "the write itself refused it, not only the tool's check");
  assert.equal(items.grant(world.campaignId, hero, "una corda", [...hero.equipment, { name: "una corda", qty: 1 }]), null, "what nobody holds is granted");
  assert.ok(namesOf(brakk.id).includes("una corda"));
});

finish();
