// Issue 685: a prepared fight's set-up. A test fight's author saves the
// moment on the table ("Save as set-up") and every test of that fight opens
// on it: the foes' hit points, conditions and places, the party's hit
// points, conditions and spent slots, and the initiative order. A fight
// played on the generator's map keeps that map. A live table's Deploy lays
// the foes' part only; another party at a test starts fresh. Everything here
// goes through the routes the screens call, and is read back from the rows.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-fight-setup");
const world = await openWorld({ status: "lobby" });
const campaigns = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const templates = await import("../src/lib/db/encounter-templates.ts");
const { createCharacter } = await import("../src/lib/db/characters.ts");
const { listSheets, patchSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
const { getActiveEncounter, listEnemies, patchEnemyHp, patchEnemyConditions, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { getBattleMapForEncounter, getTokenByRef, listTokens, placeToken } = await import("../src/lib/db/battle-maps.ts");
const { nearestOpenTile } = await import("../src/lib/battlemap/paint.ts");
const { occupiedTiles } = await import("../src/lib/battlemap/view.ts");
const { tileIndex } = await import("../src/lib/battlemap/types.ts");
const { getPreparedMap } = await import("../src/lib/db/prepared-maps.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { deployTemplate } = await import("../src/lib/dm/encounter-templates.ts");
const logic = await import("../src/lib/workshop/fight-setup-logic.ts");

const route = {
  test: await world.route("workshops/[workshopId]/test-fight"),
  save: await world.route("campaigns/[campaignId]/fight-setup"),
  setup: await world.route("campaigns/[campaignId]/dm/encounter-templates/[templateId]/setup"),
  list: await world.route("campaigns/[campaignId]/dm/encounter-templates"),
};

async function call(mod, method, body, params) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

const author = world.owner;
world.signIn(author);

const workshop = createWorkshop(author.id, { title: "The Old Mill", targetParty: { size: 2, level: 3 } });
const ambush = templates.insertEncounterTemplate({
  campaignId: workshop.id,
  name: "Goblins at the mill",
  enemies: [{ monster: "goblin", count: 2 }],
  battlefield: "a mill yard",
  // The generator's map: nothing saved, so a test draws a new one.
  map: { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
  notes: "",
  extras: {},
  createdByUserId: author.id,
});
const at = { workshopId: workshop.id };

const goblinsOf = (campaignId) => {
  const fight = getActiveEncounter(campaignId);
  return listEnemies(fight.id).sort((a, b) => a.displayName.localeCompare(b.displayName));
};
const tokenAt = (campaignId, refId) => {
  const board = getBattleMapForEncounter(getActiveEncounter(campaignId).id);
  const token = getTokenByRef(board.id, refId);
  return { x: token.x, y: token.y };
};
const note = (campaignId, pattern) =>
  getDatabase()
    .prepare(`SELECT content FROM campaign_messages WHERE campaign_id = ? AND author_type = 'system'`)
    .all(campaignId)
    .some((row) => pattern.test(row.content));

// ---- the shape ----

await test("a set-up's ids travel as ref tokens and come back as the new table's", () => {
  const ids = new Map([["enemy-1", logic.refToken({ kind: "slot", slot: 0 })], ["sheet-2", logic.refToken({ kind: "seat", seat: 1 })]]);
  const saved = logic.swapIds({ charmed: { source: "sheet-2", note: "kept" }, prone: { source: "enemy-1" }, other: { source: "a-zone" } }, ids);
  assert.deepEqual(saved, { charmed: { source: "@setup:seat:1", note: "kept" }, prone: { source: "@setup:slot:0" }, other: { source: "a-zone" } });
  const back = new Map([["@setup:slot:0", "enemy-9"]]);
  // A seat with nobody at the new table loses the field, not the condition.
  assert.deepEqual(logic.swapIds(saved, back), { charmed: { note: "kept" }, prone: { source: "enemy-9" }, other: { source: "a-zone" } });
  assert.equal(logic.parseFightSetup(""), null);
  assert.equal(logic.parseFightSetup({ version: 2 }), null, "another shape is no set-up");
  assert.equal(logic.samePartyAsSetup({ party: { kind: "stand-ins", size: 2, level: 3 } }, { kind: "stand-ins", size: 2, level: 3 }), true);
  assert.equal(logic.samePartyAsSetup({ party: { kind: "stand-ins", size: 2, level: 3 } }, { kind: "stand-ins", size: 3, level: 3 }), false);
  assert.equal(logic.samePartyAsSetup({ party: { kind: "characters", characterIds: ["a", "b"] } }, { kind: "characters", characterIds: ["b", "a"] }), false);
});

// ---- saving a moment ----

let first = "";
let firstNames = [];
let saved = null;
let tiles = null;
await test("a test of a fight seats the same stand-ins every time", async () => {
  const one = await call(route.test, "POST", { templateId: ambush.id, party: { kind: "stand-ins" }, runner: "person" }, at);
  assert.equal(one.status, 200, JSON.stringify(one.json));
  const names = listSheets(one.json.campaignId).map((sheet) => sheet.name);
  const two = await call(route.test, "POST", { templateId: ambush.id, party: { kind: "stand-ins" }, runner: "person" }, at);
  assert.equal(two.status, 200, JSON.stringify(two.json));
  assert.deepEqual(listSheets(two.json.campaignId).map((sheet) => sheet.name), names, "a new draw of names, gear or stats each test");
  first = two.json.campaignId;
  firstNames = names;
});

await test("Save as set-up keeps the moment on the workshop's fight, and the generator's map with it", async () => {
  const fight = getActiveEncounter(first);
  assert.ok(fight?.orderReady, "the opening rolled everyone's initiative");
  const [g1, g2] = goblinsOf(first);
  const [h1, h2] = listSheets(first);
  // The author's console work, as it leaves the rows.
  patchEnemyHp(g1.id, 2, "alive");
  patchEnemyConditions(g2.id, ["prone"], {});
  // Who each goblin is (PR 747's faces, PR 745's 3D model): a foe told no
  // gender takes a pick from its own row id, and a test's rows are new each
  // time, so the set-up keeps what the moment had. Nonbinary is no pick.
  getDatabase().prepare("UPDATE encounter_enemies SET gender = ?, race = ? WHERE id = ?").run("Nonbinary", "", g1.id);
  getDatabase().prepare("UPDATE encounter_enemies SET gender = ?, race = ? WHERE id = ?").run("Female", "half_orc", g2.id);
  const caster = listSheets(first).find((sheet) => (sheet.spellcasting?.slots?.["1"]?.max ?? 0) > 0);
  patchSheet(h1.id, { currentHp: 3, conditions: ["poisoned"] });
  if (caster) {
    patchSheet(caster.id, { spellcasting: { ...caster.spellcasting, slots: { ...caster.spellcasting.slots, 1: { ...caster.spellcasting.slots["1"], used: 1 } } } });
  }
  // Two open floor tiles nobody stands on (the generator's walls fall
  // anywhere).
  const board = getBattleMapForEncounter(fight.id);
  const taken = occupiedTiles(board, listTokens(board.id), null);
  const goblinTile = nearestOpenTile(board.terrain, board.width, board.height, { x: 1, y: 1 }, taken);
  taken.add(tileIndex(board.width, goblinTile.x, goblinTile.y));
  const heroTile = nearestOpenTile(board.terrain, board.width, board.height, { x: 2, y: 3 }, taken);
  placeToken(getTokenByRef(board.id, g1.id).id, goblinTile.x, goblinTile.y);
  placeToken(getTokenByRef(board.id, h2.id).id, heroTile.x, heroTile.y);
  tiles = { goblin: { x: goblinTile.x, y: goblinTile.y }, hero: { x: heroTile.x, y: heroTile.y } };
  // A known order: the second goblin first, then the heroes, then the first.
  const order = [
    { kind: "enemy", enemyId: g2.id, name: g2.displayName, initiative: 22 },
    { kind: "pc", characterId: h2.id, userId: author.id, name: h2.name, initiative: 18 },
    { kind: "pc", characterId: h1.id, userId: author.id, name: h1.name, initiative: 12 },
    { kind: "enemy", enemyId: g1.id, name: g1.displayName, initiative: 5 },
  ];
  saveEncounter({ ...getActiveEncounter(first), order, turnIndex: 1 });

  const out = await call(route.save, "POST", undefined, { campaignId: first });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.keptMap, true, "the generator's map was not kept");
  const fresh = templates.getEncounterTemplate(ambush.id);
  assert.ok(fresh.map.mapId, "the fight is not drawn on the kept map");
  const kept = getPreparedMap(workshop.id, fresh.map.mapId);
  assert.ok(kept, "the kept map is not in the workshop's library");
  assert.equal(kept.width, board.width);
  saved = templates.getTemplateSetup(ambush.id);
  assert.ok(saved, "no set-up on the workshop's fight");
  assert.deepEqual(saved.party, { kind: "stand-ins", size: 2, level: 3 });
  assert.equal(saved.foes.find((foe) => foe.slot === 0).hp, 2);
  assert.deepEqual(saved.foes.find((foe) => foe.slot === 1).conditions, ["prone"]);
  assert.deepEqual(saved.foes.find((foe) => foe.slot === 0).at, tiles.goblin);
  assert.equal(saved.heroes[0].currentHp, 3);
  assert.equal(saved.foes.find((foe) => foe.slot === 1).initiative, 22);
  assert.equal(saved.foes.find((foe) => foe.slot === 0).gender, "Nonbinary");
  assert.equal(saved.foes.find((foe) => foe.slot === 1).race, "half_orc");
  assert.ok(out.json.lines.some((line) => /Goblin 1 \(2 of \d+ HP\)/.test(line)), out.json.lines.join(" | "));
  // The list says so, and with what party.
  const list = await call(route.list, "GET", undefined, { campaignId: workshop.id });
  const row = list.json.templates.find((entry) => entry.id === ambush.id);
  assert.ok(row.setup?.length, "the fight's row does not show its set-up");
  assert.deepEqual(row.setupParty, { kind: "stand-ins", size: 2, level: 3 });
});

await test("the next test opens on the saved moment, on the kept map, with the same party unasked", async () => {
  const keptMapId = templates.getEncounterTemplate(ambush.id).map.mapId;
  const out = await call(route.test, "POST", { templateId: ambush.id, runner: "person" }, at);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const next = out.json.campaignId;
  assert.equal(campaigns.getCampaignById(first), null, "the test before it was not ended");
  const sheets = listSheets(next);
  assert.deepEqual(sheets.map((sheet) => sheet.name), firstNames);
  assert.equal(sheets[0].currentHp, 3);
  assert.deepEqual(sheets[0].conditions, ["poisoned"]);
  const caster = sheets.find((sheet) => (sheet.spellcasting?.slots?.["1"]?.max ?? 0) > 0);
  if (caster) assert.equal(caster.spellcasting.slots["1"].used, 1, "the spent slot came back unspent");
  const [g1, g2] = goblinsOf(next);
  assert.equal(g1.currentHp, 2);
  assert.ok(g2.conditions.includes("prone"), g2.conditions.join(", "));
  assert.deepEqual([g1.gender, g2.gender, g2.race], ["Nonbinary", "Female", "half_orc"], "the goblins came back as someone else");
  assert.deepEqual(tokenAt(next, g1.id), tiles.goblin);
  assert.deepEqual(tokenAt(next, sheets[1].id), tiles.hero);
  const fight = getActiveEncounter(next);
  assert.equal(fight.orderReady, true);
  assert.equal(fight.round, 1);
  assert.deepEqual(
    fight.order.map((entry) => [entry.name, entry.initiative]),
    [[g2.displayName, 22], [sheets[1].name, 18], [sheets[0].name, 12], [g1.displayName, 5]],
  );
  const board = getBattleMapForEncounter(fight.id);
  const kept = getPreparedMap(workshop.id, keptMapId);
  assert.equal(board.width, kept.width);
  assert.equal(board.terrain, kept.terrain, "the test is not on the kept map");
  assert.ok(note(next, /Opened from the fight's saved set-up: its initiative order replaces the opening rolls above/), "the table was not told the order is the set-up's");
  first = next;
});

// The test table's dice script rides with the moment: a scorer's scenario
// is the set-up and its dice (issue 685's first use).
await test("a test table's dice script is saved with its moment and set on the next test", async () => {
  const { getDiceScript, setDiceScript } = await import("../src/lib/db/dice-scripts.ts");
  assert.equal(setDiceScript(first, { seed: 42, queue: [{ roller: "enemy", kind: "attack", face: 20 }] }), true);
  const out = await call(route.save, "POST", undefined, { campaignId: first });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.ok(out.json.lines.some((line) => /^Dice: Seed 42/.test(line)), out.json.lines.join(" | "));
  const next = await call(route.test, "POST", { templateId: ambush.id, runner: "person" }, at);
  assert.equal(next.status, 200, JSON.stringify(next.json));
  const script = getDiceScript(next.json.campaignId);
  assert.equal(script?.seed, 42);
  assert.deepEqual(script?.queue, [{ roller: "enemy", kind: "attack", face: 20 }]);
  first = next.json.campaignId;
});

const mine = createCharacter(author.id, 3, { ...LEGAL_FIGHTER, name: "Thessaly", portrait: PORTRAIT }, "pc");

await test("another party at the test starts fresh, and is told so; the foes still start as saved", async () => {
  const out = await call(route.test, "POST", { templateId: ambush.id, party: { kind: "characters", characterIds: [mine.id] }, runner: "person" }, at);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const [seat] = listSheets(out.json.campaignId);
  assert.equal(seat.currentHp, seat.maxHp);
  assert.deepEqual(seat.conditions, []);
  const [g1] = goblinsOf(out.json.campaignId);
  assert.equal(g1.currentHp, 2);
  assert.ok(note(out.json.campaignId, /another party than the set-up was saved with/), "the table was not told");
});

// A scenario travels as a file: the workshop's bundle carries the fight's
// set-up, and a test of the imported fight opens on it.
await test("a workshop bundle carries a fight's set-up, and the imported fight's test opens on it", async () => {
  const { exportWorkshopBundle } = await import("../src/lib/db/workshop-bundle-export.ts");
  const { importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
  const { readBundle } = await import("../src/lib/workshop/bundle.ts");
  const out = exportWorkshopBundle(workshop.id, { name: "Mill fights", blurb: "Goblins at a mill.", inspiredBy: "Original work" });
  assert.ok(out.bundle, out.error);
  const read = readBundle(JSON.stringify(out.bundle));
  assert.ok(!("error" in read), read.error);
  const result = importWorkshopBundle(author.id, read.bundle);
  assert.ok(result.workshopId, result.error);
  const [fight] = templates.listEncounterTemplates(result.workshopId);
  const carried = templates.getTemplateSetup(fight.id);
  assert.ok(carried, "the set-up was left behind");
  assert.equal(carried.foes.find((foe) => foe.slot === 0).hp, 2);
  const opened = await call(route.test, "POST", { templateId: fight.id, runner: "person" }, { workshopId: result.workshopId });
  assert.equal(opened.status, 200, JSON.stringify(opened.json));
  const [g1] = goblinsOf(opened.json.campaignId);
  assert.equal(g1.currentHp, 2);
  assert.ok(note(opened.json.campaignId, /Opened from the fight's saved set-up/));
});

await test("a table's Deploy lays the foes' part only: no party, no forced order", async () => {
  const table = world.campaign();
  const hero = world.addHero({ name: "Brin", level: 3 });
  world.addHero({ name: "Oda", level: 3 });
  campaigns.setCampaignStatus(table.id, "active");
  const copy = templates.insertEncounterTemplate({
    campaignId: table.id,
    name: "Goblins at the mill",
    enemies: [{ monster: "goblin", count: 2 }],
    battlefield: "",
    map: { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
    notes: "",
    extras: {},
    createdByUserId: author.id,
  });
  templates.setTemplateSetup(copy.id, saved);
  const deployed = await deployTemplate(campaigns.getCampaignById(table.id), author.id, copy);
  assert.equal(deployed.ok, true, deployed.error);
  const [g1, g2] = goblinsOf(table.id);
  assert.equal(g1.currentHp, 2);
  assert.ok(g2.conditions.includes("prone"));
  const brin = getSheetById(hero.id);
  assert.equal(brin.currentHp, brin.maxHp, "a live table's hero took the test's wounds");
  assert.deepEqual(brin.conditions, []);
});

await test("Remove its set-up: the fight opens as its roster makes it again", async () => {
  const read = await call(route.setup, "GET", undefined, { campaignId: workshop.id, templateId: ambush.id });
  assert.equal(read.status, 200);
  assert.ok(read.json.setup && read.json.lines.length);
  const gone = await call(route.setup, "DELETE", undefined, { campaignId: workshop.id, templateId: ambush.id });
  assert.equal(gone.status, 200);
  assert.equal(templates.getTemplateSetup(ambush.id), null);
  const out = await call(route.test, "POST", { templateId: ambush.id, runner: "person" }, at);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const [g1] = goblinsOf(out.json.campaignId);
  assert.equal(g1.currentHp, g1.maxHp);
  assert.equal(note(out.json.campaignId, /Opened from the fight's saved set-up/), false);
  first = out.json.campaignId;
});

await test("what Save as set-up refuses: another's test, a table that is no test, a fight not yet in order", async () => {
  const stranger = world.addUser("stranger");
  world.signIn(stranger);
  assert.equal((await call(route.save, "POST", undefined, { campaignId: first })).status, 404, "a stranger reached the test table");
  world.signIn(author);
  const live = await call(route.save, "POST", undefined, { campaignId: world.campaignId });
  assert.equal(live.status, 409);
  assert.match(live.json.error, /test fight's author/);
  const fight = getActiveEncounter(first);
  saveEncounter({ ...fight, orderReady: false });
  const early = await call(route.save, "POST", undefined, { campaignId: first });
  assert.equal(early.status, 409);
  assert.match(early.json.error, /every initiative is in/);
  assert.equal(templates.getTemplateSetup(ambush.id), null, "a refused save wrote a set-up");
});

// ---- a connected agent's bench ----
//
// The report: test tables are hidden from odm_list_campaigns and no tool
// listed workshops or started a test fight, so an agent could play one only
// if it already knew its id. The tools below go through the same routes.

const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { workbenchCall, workbenchTools } = await import("../src/lib/agents/workbench.ts");
const agentRoutes = {
  workshops: await world.route("workshops"),
  dice: await world.route("campaigns/[campaignId]/dice-script"),
  trace: await world.route("campaigns/[campaignId]/turn-trace"),
};

await test("an agent lists the workshops and their fights, opens a test, saves its moment and reads the set-up back", async () => {
  const grant = createConnectionGrant({ userId: author.id, name: "bench agent", scopes: ["read", "campaigns"] }).grant;
  const names = workbenchTools(grant).map((tool) => tool.name);
  for (const name of ["odm_list_workshops", "odm_list_prepared_fights", "odm_get_fight_setup", "odm_start_test_fight", "odm_save_fight_setup", "odm_remove_fight_setup", "odm_end_test_fight", "odm_get_dice_script", "odm_set_dice_script", "odm_turn_trace"]) {
    assert.ok(names.includes(name), `${name} is not offered`);
  }
  const reader = createConnectionGrant({ userId: author.id, name: "reader", scopes: ["read"] }).grant;
  assert.equal(workbenchTools(reader).some((tool) => tool.name === "odm_start_test_fight"), false, "a read-only agent may open tables");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(url);
    globalThis.__odmTestToken = (new Headers(init.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const request = new Request(target, { method: init.method ?? "GET", headers: init.headers, body: init.body });
    const parts = target.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const method = request.method;
    if (target.pathname === "/api/workshops") return agentRoutes.workshops[method](request);
    if (parts[1] === "workshops" && parts[3] === "test-fight") return route.test[method](request, { params: Promise.resolve({ workshopId: parts[2] }) });
    if (parts[3] === "fight-setup") return route.save[method](request, { params: Promise.resolve({ campaignId: parts[2] }) });
    if (parts[3] === "dice-script") return agentRoutes.dice[method](request, { params: Promise.resolve({ campaignId: parts[2] }) });
    if (parts[3] === "turn-trace") return agentRoutes.trace[method](request, { params: Promise.resolve({ campaignId: parts[2] }) });
    if (parts[6] === "setup") return route.setup[method](request, { params: Promise.resolve({ campaignId: parts[2], templateId: parts[5] }) });
    if (parts[4] === "encounter-templates") return route.list[method](request, { params: Promise.resolve({ campaignId: parts[2] }) });
    throw new Error(`unexpected path ${target.pathname}`);
  };
  try {
    const run = async (name, args = {}) => {
      const out = await workbenchCall(grant, name, args);
      assert.equal(out.isError, false, `${name}: ${out.text.slice(0, 300)}`);
      return JSON.parse(out.text);
    };
    const { workshops } = await run("odm_list_workshops");
    assert.ok(workshops.some((entry) => entry.id === workshop.id), "the workshop is not listed");
    const { templates: fights } = await run("odm_list_prepared_fights", { workshopId: workshop.id });
    assert.ok(fights.some((entry) => entry.id === ambush.id));
    const opened = await run("odm_start_test_fight", { workshopId: workshop.id, templateId: ambush.id, runner: "person" });
    assert.ok(campaigns.getCampaignById(opened.campaignId)?.kind === "playtest");
    const [g1] = goblinsOf(opened.campaignId);
    patchEnemyHp(g1.id, 4, "alive");
    await run("odm_set_dice_script", { campaignId: opened.campaignId, seed: 7, queue: [{ roller: "any", kind: "death_save", face: 1 }] });
    assert.equal((await run("odm_get_dice_script", { campaignId: opened.campaignId })).script.seed, 7);
    const refused = await workbenchCall(grant, "odm_set_dice_script", { campaignId: world.campaignId, seed: 7, queue: [] });
    assert.equal(refused.isError, true, "a live table took a dice script");
    const trace = await run("odm_turn_trace", { campaignId: opened.campaignId, limit: 5 });
    assert.ok(Array.isArray(trace.turns), JSON.stringify(trace).slice(0, 200));
    const savedOut = await run("odm_save_fight_setup", { campaignId: opened.campaignId });
    assert.ok(savedOut.lines.length);
    const read = await run("odm_get_fight_setup", { workshopId: workshop.id, templateId: ambush.id });
    assert.equal(read.setup.foes.find((foe) => foe.slot === 0).hp, 4);
    assert.equal(read.setup.dice.seed, 7, "the set-up lost its dice");
    await run("odm_end_test_fight", { workshopId: workshop.id });
    assert.equal(campaigns.getCampaignById(opened.campaignId), null, "the test table outlived its end");
    await run("odm_remove_fight_setup", { workshopId: workshop.id, templateId: ambush.id });
    assert.equal(templates.getTemplateSetup(ambush.id), null);
  } finally {
    globalThis.fetch = originalFetch;
    world.signIn(author);
  }
});

// A foe's saved state lands on the creature it was saved from, by its kind
// and its number among that kind, whatever the roster puts before it since:
// keyed by slot number, Goblin 1's "dead" landed on the wolf an author put
// first, and Goblin 1 came back fresh, at the next test and a table's Deploy.
const edit = await world.route("campaigns/[campaignId]/dm/encounter-templates/[templateId]");
const { endEncounter } = await import("../src/lib/db/encounters.ts");
const foesOf = (campaignId) =>
  Object.fromEntries(listEnemies(getActiveEncounter(campaignId).id).map((enemy) => [enemy.displayName, `${enemy.status} ${enemy.currentHp}/${enemy.maxHp}`]));
const raid = templates.insertEncounterTemplate({
  campaignId: workshop.id,
  name: "Raid on the mill",
  enemies: [{ monster: "goblin", count: 2 }],
  battlefield: "",
  map: { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
  notes: "",
  extras: {},
  createdByUserId: author.id,
});

await test("a roster edited after the save: a wolf put first starts fresh, and the goblins start as they were saved, at the next test and at a table's Deploy", async () => {
  world.signIn(author);
  const tested = await call(route.test, "POST", { templateId: raid.id, party: { kind: "stand-ins" }, runner: "person" }, at);
  assert.equal(tested.status, 200, JSON.stringify(tested.json));
  const [g1, g2] = goblinsOf(tested.json.campaignId);
  patchEnemyHp(g1.id, 0, "dead");
  patchEnemyHp(g2.id, 3, "alive");
  const kept = await call(route.save, "POST", undefined, { campaignId: tested.json.campaignId });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  const edited = await call(edit, "PATCH", { enemies: "wolf\ngoblin x2" }, { campaignId: workshop.id, templateId: raid.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.setupNote, undefined, "both goblins are still in the fight: nothing was dropped");
  const next = await call(route.test, "POST", { templateId: raid.id, runner: "person" }, at);
  assert.equal(next.status, 200, JSON.stringify(next.json));
  const tested2 = foesOf(next.json.campaignId);
  assert.match(tested2.Wolf ?? "", /^alive (\d+)\/\1$/, `the wolf starts fresh: ${JSON.stringify(tested2)}`);
  assert.match(tested2["Goblin 1"] ?? "", /^dead 0\//, `Goblin 1 starts as saved: ${JSON.stringify(tested2)}`);
  assert.match(tested2["Goblin 2"] ?? "", /^alive 3\//, `Goblin 2 starts as saved: ${JSON.stringify(tested2)}`);
  // A table's Deploy of its copy, as an import brings it.
  const table = world.campaign();
  const running = getActiveEncounter(table.id);
  if (running) endEncounter(running.id, "aborted");
  const fresh = templates.getEncounterTemplate(raid.id);
  const copy = templates.insertEncounterTemplate({ campaignId: table.id, name: fresh.name, enemies: fresh.enemies, battlefield: "", map: fresh.map, notes: "", extras: {}, createdByUserId: author.id });
  templates.setTemplateSetup(copy.id, templates.getTemplateSetup(raid.id));
  const deployed = await deployTemplate(campaigns.getCampaignById(table.id), author.id, copy);
  assert.equal(deployed.ok, true, deployed.error);
  const live = foesOf(table.id);
  assert.match(live.Wolf ?? "", /^alive (\d+)\/\1$/, `the wolf starts fresh at the table: ${JSON.stringify(live)}`);
  assert.match(live["Goblin 1"] ?? "", /^dead 0\//, JSON.stringify(live));
  assert.match(live["Goblin 2"] ?? "", /^alive 3\//, JSON.stringify(live));
});

await test("a roster that loses a creature drops its saved state from the set-up, keeps the rest, and the author is told which", async () => {
  world.signIn(author);
  const edited = await call(edit, "PATCH", { enemies: "wolf\ngoblin" }, { campaignId: workshop.id, templateId: raid.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.match(edited.json.setupNote ?? "", /no longer holds Goblin 2: the roster has no such creature now\. The rest of the set-up is kept\./);
  const setup = templates.getTemplateSetup(raid.id);
  assert.deepEqual(setup.foes.map((foe) => [foe.monster, foe.nth, foe.status]), [["goblin", 0, "dead"]], "the first goblin's state is kept");
  const read = await call(route.setup, "GET", undefined, { campaignId: workshop.id, templateId: raid.id });
  assert.ok(read.json.lines.some((line) => /Goblin 1 down/.test(line)) && !read.json.lines.some((line) => /Goblin 2/.test(line)), JSON.stringify(read.json.lines));
});

// A set-up saved from a test with the author's own library characters names
// them: their ids and their names. In a bundle, or copied into a table where
// anyone with prep authority reads it (a party lead at an AI-run table), it
// goes without them; the foes and the dice travel.
await test("a set-up saved with library characters leaves their ids and names behind in a bundle and in a copy into a table, and keeps its foes", async () => {
  world.signIn(author);
  const weir = templates.insertEncounterTemplate({
    campaignId: workshop.id,
    name: "Ambush at the weir",
    enemies: [{ monster: "goblin", count: 2 }],
    battlefield: "",
    map: { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
    notes: "",
    extras: {},
    createdByUserId: author.id,
  });
  const tested = await call(route.test, "POST", { templateId: weir.id, party: { kind: "characters", characterIds: [mine.id] }, runner: "person" }, at);
  assert.equal(tested.status, 200, JSON.stringify(tested.json));
  const [g1] = goblinsOf(tested.json.campaignId);
  patchEnemyHp(g1.id, 2, "alive");
  const kept = await call(route.save, "POST", undefined, { campaignId: tested.json.campaignId });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.equal(templates.getTemplateSetup(weir.id).party.kind, "characters", "the author's own set-up keeps the party");
  const leaks = (label, value) => {
    const text = JSON.stringify(value);
    return [text.includes(mine.id) ? `${label}: the character's id` : null, text.includes("Thessaly") ? `${label}: the character's name` : null].filter(Boolean);
  };
  const { exportWorkshopBundle } = await import("../src/lib/db/workshop-bundle-export.ts");
  const out = exportWorkshopBundle(workshop.id, { name: "Mill fights", blurb: "Goblins at a mill.", inspiredBy: "Original work" });
  assert.ok(out.bundle, out.error);
  const carried = out.bundle.encounters.find((entry) => entry.name === "Ambush at the weir")?.setup;
  const { runContentImport } = await import("../src/lib/db/content-import.ts");
  const table = world.campaign();
  const imported = runContentImport({ sourceId: workshop.id, campaignId: table.id, selection: ["encounters"], houseRulesMode: "append" });
  assert.ok(!("error" in imported), imported.error);
  const copy = templates.listEncounterTemplates(table.id).find((entry) => /Ambush at the weir/.test(entry.name));
  const copied = templates.getTemplateSetup(copy.id);
  const listed = await call(route.list, "GET", undefined, { campaignId: table.id });
  const row = listed.json.templates.find((entry) => entry.id === copy.id);
  assert.deepEqual([...leaks("the bundle", carried), ...leaks("the table's copy", copied), ...leaks("the table's prep list", row)], [], "the author's character travelled");
  assert.equal(carried.foes.find((foe) => foe.nth === 0)?.hp, 2, "the bundle keeps the foes");
  assert.equal(copied.foes.find((foe) => foe.nth === 0)?.hp, 2, "the copy keeps the foes");
  assert.equal(copied.party.kind, "elsewhere");
  assert.equal(row.setupParty, null, "the Test sheet is offered no party from another table");
});

finish();
