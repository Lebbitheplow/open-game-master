// People the party already knows when the story begins (issue 731). Only an
// author's mark, with how the party knows them, opens a tie; it opens as the
// table begins, for every hero in play, at a modest standing with the
// author's line as the bond's first memory, and never once the story is
// under way. A hostile, set-aside or unmarked person opens nothing, a hero
// who joins later meets them fresh, and a module carries the mark.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const {
  KNOWN_BEFORE_APPROVAL,
  KNOWN_BEFORE_GRADES,
  KNOWN_BEFORE_MEMORY,
  readKnownBefore,
  tiesToOpen,
} = await import("../src/lib/dm/known-before-logic.ts");
const { ROMANCE_THRESHOLD, friendshipTier } = await import("../src/lib/dm/relationship-logic.ts");
const { normalizeNpcDraft, blankDraft } = await import("../src/lib/npcs/forge.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

await test("a tie opens no higher than Friendly and never on the romance ladder", () => {
  for (const grade of KNOWN_BEFORE_GRADES) {
    const approval = KNOWN_BEFORE_APPROVAL[grade];
    assert.ok(approval < ROMANCE_THRESHOLD.interested, `${grade} stays below the first romantic rung`);
    assert.ok(["neutral", "cordial", "friendly"].includes(friendshipTier(approval)), `${grade} opens at ${friendshipTier(approval)}`);
  }
  assert.equal(friendshipTier(KNOWN_BEFORE_APPROVAL.acquainted), "neutral");
  assert.equal(friendshipTier(KNOWN_BEFORE_APPROVAL.friend), "cordial");
  assert.equal(friendshipTier(KNOWN_BEFORE_APPROVAL.close), "friendly");
});

await test("no reason, no tie: a grade alone, or an unknown grade, reads as nothing", () => {
  assert.equal(readKnownBefore({ grade: "friend", how: "   " }), null);
  assert.equal(readKnownBefore({ grade: "lover", how: "they were married" }), null);
  assert.deepEqual(readKnownBefore({ grade: "close", how: "  Trained all four of you.  " }), { grade: "close", how: "Trained all four of you." });
  assert.equal(readKnownBefore({ grade: "friend", how: "x".repeat(400) }).how.length, 160);
});

await test("the form refuses a grade with no reason, drops a tie for a hostile person, and keeps one it was not sent", () => {
  const draft = (extra) => normalizeNpcDraft({ ...blankDraft(), name: "Maren Dusk", attitude: "friendly", ...extra });
  assert.match(draft({ knownBefore: { grade: "friend", how: "" } }).error, /how the party knows Maren Dusk/);
  assert.equal(draft({ attitude: "hostile", knownBefore: { grade: "friend", how: "Hired you once" } }).draft.knownBefore, null);
  // A grade picked, then the person made hostile before the line was
  // written: the editor hides the section for them, so the save goes
  // through with the tie dropped rather than asking for a field nobody sees.
  const turned = draft({ attitude: "hostile", knownBefore: { grade: "friend", how: "" } });
  assert.ok(!("error" in turned), turned.error);
  assert.equal(turned.draft.knownBefore, null);
  const sent = { ...blankDraft(), name: "Maren Dusk" };
  delete sent.knownBefore;
  assert.ok(!("knownBefore" in normalizeNpcDraft(sent).draft), "an app built before the field keeps what the record has");
  assert.equal(draft({ knownBefore: null }).draft.knownBefore, null);
});

await test("the selection skips the hostile, the set aside, the unmarked and a companion in the party", () => {
  const known = { grade: "friend", how: "Hired you twice" };
  const base = { attitude: "friendly", archived: false, knownBefore: known, behindCompanion: false };
  const ties = tiesToOpen([
    { ...base, id: "a", name: "Maren" },
    { ...base, id: "b", name: "Boss", attitude: "hostile" },
    { ...base, id: "c", name: "Gone", archived: true },
    { ...base, id: "d", name: "Escort", knownBefore: null },
    { ...base, id: "e", name: "Ally", behindCompanion: true },
  ]);
  assert.deepEqual(ties.map((tie) => [tie.name, tie.approval]), [["Maren", 15]]);
});

// A table a person runs, in its lobby: the owner holds the GM seat, two
// players a hero each, everyone ready.
async function lobby(gameSettings = {}) {
  const world = await openWorld({ gameSettings: { dmMode: "human", ...gameSettings } });
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const campaigns = await import("../src/lib/db/campaigns.ts");
  const npcs = await import("../src/lib/db/npcs.ts");
  const kara = world.addUser("kara");
  const brom = world.addUser("brom");
  const heroes = [world.addHero({ name: "Kara", user: kara }), world.addHero({ name: "Brom", user: brom })];
  campaigns.setCampaignStatus(world.campaignId, "lobby");
  getDatabase().prepare(`UPDATE campaign_members SET ready = 1 WHERE campaign_id = ?`).run(world.campaignId);
  const person = (name, extra = {}) => npcs.createNpcFromDraft(world.campaignId, { ...blankDraft(), name, attitude: "friendly", ...extra });
  const begin = async () => {
    world.signIn(world.owner);
    const route = await world.route("campaigns/[campaignId]");
    const response = await route.PATCH(new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ status: "active" }) }), {
      params: Promise.resolve({ campaignId: world.campaignId }),
    });
    assert.equal(response.status, 200, await response.clone().text());
  };
  return { world, kara, brom, heroes, person, begin, db: getDatabase(), npcs };
}

const relationships = await import("../src/lib/db/relationships.ts");
const bond = (world, hero, name) => relationships.getRelationship(world.campaignId, hero.id, name);

await test("as the table begins, every hero opens a bond with each person the party knew, at the grade, with how they know them", async () => {
  const { world, heroes, person, begin, npcs, db } = await lobby();
  person("Maren Dusk", { knownBefore: { grade: "friend", how: "She hired you twice to guard her caravans." } });
  person("Old Tam", { knownBefore: { grade: "close", how: "He taught all of you to read the stars." } });
  person("Wenna", { knownBefore: { grade: "acquainted", how: "The ferry keeper you pass every market day." } });
  person("Silent Escort");
  const boss = person("Black Spider", { attitude: "hostile" });
  db.prepare(`UPDATE npcs SET known_before_json = ? WHERE id = ?`).run(JSON.stringify({ grade: "friend", how: "a bad export" }), boss.id);
  const gone = person("Set Aside", { knownBefore: { grade: "friend", how: "An old friend" } });
  npcs.setNpcArchived(gone.id, true);
  await begin();
  for (const hero of heroes) {
    const maren = bond(world, hero, "Maren Dusk");
    assert.equal(maren.approval, 15);
    assert.deepEqual(maren.memories.map((memory) => [memory.kind, memory.text]), [[KNOWN_BEFORE_MEMORY, "She hired you twice to guard her caravans."]]);
    assert.equal(bond(world, hero, "Old Tam").approval, 30);
    assert.equal(bond(world, hero, "Wenna").approval, 0);
    for (const stranger of ["Silent Escort", "Black Spider", "Set Aside"]) {
      assert.equal(bond(world, hero, stranger), null, `${stranger} opens nothing`);
    }
  }
  assert.ok(npcs.getNpcByName(world.campaignId, "Maren Dusk").metAt, "an old friend is met: no reaction roll greets her");
  assert.ok(!npcs.getNpcByName(world.campaignId, "Black Spider").metAt);
  const { castForSeat } = await import("../src/lib/dm/cast.ts");
  assert.deepEqual(castForSeat(world.campaignId, false).map((member) => member.name).sort(), ["Maren Dusk", "Old Tam", "Wenna"]);
  // The GM reads the reason beside the standing, an acquaintance at Neutral included.
  const { relationshipRosterForPrompt } = await import("../src/lib/dm/relationship-tools.ts");
  const lines = relationshipRosterForPrompt(world.campaignId).join("\n");
  assert.match(lines, /Kara and Wenna .*history: The ferry keeper you pass every market day\./);
  assert.match(lines, /Brom and Maren Dusk .*cordial \(\+15\).*history: She hired you twice/i);
});

await test("a second pass opens nothing and leaves a moved bond alone; a hero who joins later meets them fresh", async () => {
  const { world, heroes, person, begin } = await lobby();
  person("Maren Dusk", { knownBefore: { grade: "friend", how: "She hired you twice." } });
  await begin();
  const { openPreStoryTies } = await import("../src/lib/dm/known-before.ts");
  const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
  relationships.patchRelationship(bond(world, heroes[0], "Maren Dusk").id, { approval: 42 });
  assert.deepEqual(openPreStoryTies(getCampaignById(world.campaignId)), { met: 0, opened: 0 });
  assert.equal(bond(world, heroes[0], "Maren Dusk").approval, 42);
  const late = world.addHero({ name: "Lyra", user: world.addUser("lyra") });
  const { openJoinerBonds } = await import("../src/lib/dm/party-bonds.ts");
  openJoinerBonds(getCampaignById(world.campaignId), late);
  const fresh = bond(world, late, "Maren Dusk");
  assert.equal(fresh.approval, 0);
  assert.deepEqual(fresh.memories, [], "the history was the first party's");
});

await test("once the GM has narrated, nothing opens: a module brought in mid-story does not rewrite the table's past", async () => {
  const { world, heroes, person } = await lobby();
  const campaigns = await import("../src/lib/db/campaigns.ts");
  campaigns.setCampaignStatus(world.campaignId, "active");
  world.say("dm", "The rain has not stopped for three days.");
  person("Maren Dusk", { knownBefore: { grade: "friend", how: "She hired you twice." } });
  const { openPreStoryTies } = await import("../src/lib/dm/known-before.ts");
  assert.deepEqual(openPreStoryTies(campaigns.getCampaignById(world.campaignId)), { met: 0, opened: 0 });
  assert.equal(bond(world, heroes[0], "Maren Dusk"), null);
});

await test("with bonds off the party still knows them, and no meter opens", async () => {
  const { world, heroes, person, begin, npcs } = await lobby({ relationships: "off" });
  person("Maren Dusk", { knownBefore: { grade: "friend", how: "She hired you twice." } });
  await begin();
  assert.ok(npcs.getNpcByName(world.campaignId, "Maren Dusk").metAt);
  assert.equal(bond(world, heroes[0], "Maren Dusk"), null);
});

await test("the people route offers the field only while it can matter: a workshop, or a table whose GM has not yet narrated", async () => {
  const { world, begin } = await lobby();
  const route = await world.route("campaigns/[campaignId]/dm/npcs");
  const open = async () => {
    world.signIn(world.owner);
    const response = await route.GET(new Request("http://test/api"), { params: Promise.resolve({ campaignId: world.campaignId }) });
    return (await response.json()).knownBeforeOpen;
  };
  assert.equal(await open(), true);
  await begin();
  // The lobby has no cast editor: the GM console's Cast tab, which a table
  // has once it begins, is where a GM marks someone for their own table.
  assert.equal(await open(), true, "begun, but the story has not started");
  world.say("dm", "The rain has not stopped for three days.");
  assert.equal(await open(), false);
});

await test("a GM who marks someone in the console before their first narration opens that tie at once; after it, nothing opens", async () => {
  const { world, heroes, begin, npcs } = await lobby();
  await begin();
  world.signIn(world.owner);
  const people = await world.route("campaigns/[campaignId]/dm/npcs");
  const one = await world.route("campaigns/[campaignId]/dm/npcs/[npcId]");
  const params = { params: Promise.resolve({ campaignId: world.campaignId }) };
  const draft = (name, extra = {}) => ({ ...blankDraft(), name, attitude: "friendly", ...extra });
  const created = await people.POST(
    new Request("http://test/api", { method: "POST", body: JSON.stringify({ draft: draft("Maren Dusk", { knownBefore: { grade: "friend", how: "She hired you twice." } }) }) }),
    params,
  );
  assert.equal(created.status, 201, await created.clone().text());
  for (const hero of heroes) {
    assert.equal(bond(world, hero, "Maren Dusk")?.approval, 15, `${hero.name} knows her`);
  }
  // Marked on an edit, as well as on a new record.
  const tam = npcs.createNpcFromDraft(world.campaignId, draft("Old Tam"));
  const edited = await one.PATCH(
    new Request("http://test/api", { method: "PATCH", body: JSON.stringify({ draft: draft("Old Tam", { knownBefore: { grade: "close", how: "He taught you all." } }) }) }),
    { params: Promise.resolve({ campaignId: world.campaignId, npcId: tam.id }) },
  );
  assert.equal(edited.status, 200, await edited.clone().text());
  assert.equal(bond(world, heroes[0], "Old Tam")?.approval, 30);
  world.say("dm", "The rain has not stopped for three days.");
  const late = await people.POST(
    new Request("http://test/api", { method: "POST", body: JSON.stringify({ draft: draft("Wenna", { knownBefore: { grade: "acquainted", how: "The ferry keeper." } }) }) }),
    params,
  );
  assert.equal(late.status, 201);
  assert.equal(bond(world, heroes[0], "Wenna"), null, "once the GM has narrated, nothing opens");
});

await test("a mark saved in a table's lobby waits for Begin: heroes still joining are not left out", async () => {
  const { world, heroes, begin } = await lobby();
  world.signIn(world.owner);
  const people = await world.route("campaigns/[campaignId]/dm/npcs");
  const created = await people.POST(
    new Request("http://test/api", {
      method: "POST",
      body: JSON.stringify({ draft: { ...blankDraft(), name: "Maren Dusk", attitude: "friendly", knownBefore: { grade: "friend", how: "She hired you twice." } } }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(created.status, 201);
  assert.equal(bond(world, heroes[0], "Maren Dusk"), null, "nothing opens in the lobby");
  await begin();
  assert.equal(bond(world, heroes[0], "Maren Dusk")?.approval, 15);
});

await test("a module carries the mark: imported in the issue's words, copied to a table, opened at Begin, and exported again", async () => {
  const { world, heroes, begin, npcs } = await lobby();
  const { importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
  const { workshopBundleSchema } = await import("../src/lib/workshop/bundle-schema.ts");
  const { exportWorkshopBundle } = await import("../src/lib/db/workshop-bundle-export.ts");
  const { runContentImport } = await import("../src/lib/db/content-import.ts");
  const bundle = workshopBundleSchema.parse({
    kind: "odm.workshop",
    version: 1,
    manifest: { name: "Sample module", blurb: "sample", inspiredBy: "none" },
    npcs: [
      { name: "Maren Dusk", attitude: "friendly", gender: "Female", knownAtStart: { grade: "friend", source: "Their old friend and patron hires them to escort a wagon." } },
      { name: "Hidden Boss", attitude: "hostile", gender: "Male", knownAtStart: { grade: "acquainted", source: "export error" } },
      { name: "No Reason", attitude: "friendly", knownAtStart: { grade: "close" } },
      { name: "Newer Grade", attitude: "friendly", knownAtStart: { grade: "rival", source: "a grade from a later version" } },
      // A long quote from the adventure's opening is clipped as the form
      // clips it, not dropped with the whole tie.
      { name: "Long Quote", attitude: "friendly", knownAtStart: { grade: "friend", source: `intro: ${"their old friend and patron, ".repeat(20)}` } },
    ],
  });
  const landed = importWorkshopBundle(world.owner.id, bundle);
  assert.ok(!("error" in landed), landed.error);
  const shelf = (name) => npcs.getNpcByName(landed.workshopId, name).knownBefore;
  assert.deepEqual(shelf("Maren Dusk"), { grade: "friend", how: "Their old friend and patron hires them to escort a wagon." });
  assert.equal(shelf("Hidden Boss"), null);
  assert.equal(shelf("No Reason"), null);
  assert.equal(shelf("Newer Grade"), null, "an unreadable tie is left out, the module still lands");
  assert.equal(shelf("Long Quote")?.grade, "friend", "a long reason keeps its tie");
  // Cut at a word's edge with an ellipsis, as the Bonds tab cuts every
  // memory (issue 644): a hard slice read "their ol" as a typo.
  assert.ok(shelf("Long Quote").how.length <= 160);
  assert.match(shelf("Long Quote").how, /(their|old|friend|and|patron)…$/);
  const copied = runContentImport({ sourceId: landed.workshopId, campaignId: world.campaignId, selection: ["npcs"], houseRulesMode: "replace" });
  assert.ok(!("error" in copied), copied.error);
  await begin();
  for (const hero of heroes) {
    assert.equal(bond(world, hero, "Maren Dusk").approval, 15);
    assert.equal(bond(world, hero, "Hidden Boss"), null);
  }
  const exported = exportWorkshopBundle(landed.workshopId, { name: "Sample module", blurb: "sample", inspiredBy: "none" });
  assert.ok(!("error" in exported), exported.error);
  const maren = exported.bundle.npcs.find((npc) => npc.name === "Maren Dusk");
  assert.deepEqual(maren.knownAtStart, { grade: "friend", source: "Their old friend and patron hires them to escort a wagon." });
  assert.ok(!("knownAtStart" in exported.bundle.npcs.find((npc) => npc.name === "Hidden Boss")));
});

await test("a module brought into a table that has begun but not yet heard its first narration opens its ties then", async () => {
  const { world, heroes, begin } = await lobby();
  await begin();
  const { importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
  const { workshopBundleSchema } = await import("../src/lib/workshop/bundle-schema.ts");
  const landed = importWorkshopBundle(
    world.owner.id,
    workshopBundleSchema.parse({
      kind: "odm.workshop",
      version: 1,
      manifest: { name: "Late module", blurb: "sample", inspiredBy: "none" },
      npcs: [{ name: "Maren Dusk", attitude: "friendly", knownAtStart: { grade: "close", source: "She raised all of you." } }],
    }),
  );
  world.signIn(world.owner);
  const route = await world.route("campaigns/[campaignId]/import");
  const response = await route.POST(new Request("http://test/api", { method: "POST", body: JSON.stringify({ sourceId: landed.workshopId, select: ["npcs"] }) }), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(bond(world, heroes[0], "Maren Dusk").approval, 30);
});

console.log(`${passed} known-before tests passed`);
