// AI Story Setup and an imported Workshop Storyboard (issue 249). The setup
// pass ran at the start of an AI campaign whatever prep the table brought in,
// and wrote an opening scene and an outline that never read the imported
// arc; nothing warned the creator. Now: the wizard and the lobby say so with
// a way to turn the setting off, the lobby knows when an arc is waiting
// (prepArc, to whoever steers only), the import picker knows when a board
// will write one (boardArc), and the pass itself is handed the arc.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply } from "./lib/enforce-narrator.mjs";
const { storySetupWillRun, storySetupWarning, storySetupWarningComing } = await import(
  "../src/lib/dm/story-setup-logic.ts"
);
const { translate } = await import("../src/lib/messages-logic.ts");
// The warnings' words come from the dictionaries; this suite reads the English ones.
const en = (key, vars) => translate("en", key, vars);

const { test, finish } = suite("test-story-setup");

await test("The warning is for a one-time pass still to run, at a table the AI narrates.", () => {
  const base = { status: "lobby", dmMode: "ai", aiStorySetup: true, outlineWritten: false };
  assert.equal(storySetupWillRun(base), true);
  assert.equal(storySetupWillRun({ ...base, dmMode: "assisted" }), true, "an assisted table runs the pass too");
  assert.equal(storySetupWillRun({ ...base, dmMode: "human" }), false, "a human DM's table runs none");
  assert.equal(storySetupWillRun({ ...base, aiStorySetup: false }), false);
  assert.equal(storySetupWillRun({ ...base, outlineWritten: true }), false, "the pass already ran");
  assert.equal(storySetupWillRun({ ...base, status: "active" }), false, "an import after the start");
  for (const text of [storySetupWarning(en), storySetupWarningComing(en)]) {
    assert.match(text, /Turn it off/);
    assert.match(text, /the AI still narrates/);
    assert.ok(!text.includes("—"), "no em dash");
  }
});

const world = await openWorld({ status: "lobby" });
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { insertBeat } = await import("../src/lib/db/workshop-beats.ts");
const { checkBeat } = await import("../src/lib/workshop/board.ts");
const { runContentImport, boardWritesArc } = await import("../src/lib/db/content-import.ts");
const { listImportSourcesForUser } = await import("../src/lib/db/import-sources.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");

const workshop = createWorkshop(world.owner.id, { title: "The Drowned Mill" });
for (const [kind, title, body] of [
  ["backstory", "The flood", "The river took the lower village."],
  ["setting", "The mill", "Half-drowned and still turning."],
  ["hook", "A missing daughter", "The miller's girl went to the mill and did not come back."],
  ["event", "The wheel stops", "Something is jamming it."],
  ["npc_moment", "Marla confesses", "The miller's wife tells what she saw."],
  ["event", "The wheelhouse opens", "The girl is found under the wheel."],
  ["encounter", "Wolves in the yard", "Three of them, hungry."],
]) {
  insertBeat(workshop.id, checkBeat({ kind, title, body }).beat);
}

await test("The import picker knows which sources' boards write an arc.", () => {
  assert.equal(boardWritesArc(workshop.id), true);
  const empty = createWorkshop(world.owner.id, { title: "Nothing yet" });
  assert.equal(boardWritesArc(empty.id), false);
  const listed = listImportSourcesForUser(world.owner.id);
  assert.equal(listed.find((source) => source.id === workshop.id)?.boardArc, true);
  assert.equal(listed.find((source) => source.id === empty.id)?.boardArc, false);
});

const campaignRoute = await world.route("campaigns/[campaignId]");
const settingsRoute = await world.route("campaigns/[campaignId]/settings");
const get = async (user) => {
  world.signIn(user);
  const response = await campaignRoute.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  return response.json();
};

await test("Before the import the lobby has no arc waiting; after it, the lead is told and a player is not.", async () => {
  assert.equal((await get(world.owner)).prepArc, false);
  const outcome = runContentImport({ sourceId: workshop.id, campaignId: world.campaignId, selection: ["storyboard"], houseRulesMode: "replace" });
  assert.ok(!("error" in outcome), outcome.error);
  assert.ok(campaigns.getCampaignById(world.campaignId).storyArc, "the board wrote no arc");
  assert.equal((await get(world.owner)).prepArc, true);
  const player = world.addUser("player");
  campaigns.joinByInviteCode(player.id, world.campaign().inviteCode);
  const seen = await get(player);
  assert.equal(seen.prepArc, false, "a player is not the one to decide");
  assert.equal(seen.campaign.storyArc, undefined, "the arc never leaves the server");
});

await test("The setup pass is handed the imported arc to build on.", async () => {
  const { runStorySetup } = await import("../src/lib/dm/setup.ts");
  const model = await fakeModel();
  model.pointAt(world);
  model.script([reply({ text: '{"premise":"The mill has gone silent.","openingScene":"The flooded lane to the mill.","secretOutline":"1. The girl is in the wheelhouse."}' })]);
  await runStorySetup(world.campaignId);
  const sent = model.requests[0].messages;
  assert.match(sent[0].content, /prepared a story arc/);
  assert.match(sent[1].content, /build on it, do not replace it/);
  assert.match(sent[1].content, /The wheel stops|Marla confesses|The wheelhouse opens/);
  const after = campaigns.getCampaignById(world.campaignId);
  assert.ok(after.storyArc, "the arc was overwritten");
  assert.equal(after.dmOutline, "1. The girl is in the wheelhouse.");
  assert.equal((await get(world.owner)).prepArc, false, "once the pass has run there is nothing to warn about");
  model.close();
});

await test("Turning the setting off from the warning saves it, and the start runs no setup pass.", async () => {
  const fresh = await openWorld({ status: "lobby" });
  runContentImport({ sourceId: workshop.id, campaignId: fresh.campaignId, selection: ["storyboard"], houseRulesMode: "replace" });
  fresh.signIn(fresh.owner);
  const response = await settingsRoute.PATCH(
    new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ aiStorySetup: false }) }),
    { params: Promise.resolve({ campaignId: fresh.campaignId }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const saved = campaigns.getCampaignById(fresh.campaignId);
  assert.equal(saved.gameSettings.aiStorySetup, false);
  assert.equal(saved.gameSettings.dmMode, "ai", "AI narration stays on");
  const { runStorySetup } = await import("../src/lib/dm/setup.ts");
  const model = await fakeModel();
  model.pointAt(fresh);
  await runStorySetup(fresh.campaignId);
  assert.equal(model.requests.length, 0, "the pass called the model with the setting off");
  assert.equal(campaigns.getCampaignById(fresh.campaignId).dmOutline, "");
  assert.ok(campaigns.getCampaignById(fresh.campaignId).storyArc, "the imported arc stays for the DM");
  model.close();
  fresh.close();
});

world.close();
finish();
