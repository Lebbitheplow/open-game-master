// Issue 685, gaps 2 and 3: who sits where at a test fight
// (src/lib/workshop/test-fight.ts, src/lib/workshop/test-seats-logic.ts).
//
// Gap 3, allies: a test forced companions off and refused a library
// companion, so a fight written around an ally could not be tested. The
// author's companions now fight beside either party as companions, copies
// like the heroes: whoever runs the test plays them, unless the author takes
// command of one on its card.
//
// Gap 2, the GM console at an AI-run test: nobody held a GM seat there, so
// the author steered only through Direct. The author now sits in the
// steering seat: the console is theirs, the AI still narrates and runs the
// enemies, and an enemy's own card is refused from the author's seat so the
// two never play the same monster. The AI still waits for each hero's word.

import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-test-fight-seats");
const world = await openWorld({ status: "lobby" });
const campaigns = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { createCharacter, getCharacter } = await import("../src/lib/db/characters.ts");
const { listSheets, patchSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
const { getActiveEncounter, listEnemies, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { getBattleMapForEncounter, getTokenByRef, moveToken } = await import("../src/lib/db/battle-maps.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { aiPlaysSheet, gmCompanionTurn } = await import("../src/lib/dm/companion-command.ts");
const { characterAwaitingPlayer } = await import("../src/lib/dm/player-word.ts");
const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { AI_RUNS_FOES, AI_RUNS_TURNS, enemyActsIn, testCompanionsSetting } = await import("../src/lib/workshop/test-seats-logic.ts");

const route = {
  test: await world.route("workshops/[workshopId]/test-fight"),
  characters: await world.route("characters"),
  table: await world.route("campaigns/[campaignId]"),
  invoke: await world.route("campaigns/[campaignId]/dm/invoke"),
  initiative: await world.route("campaigns/[campaignId]/dm/initiative"),
  actions: await world.route("campaigns/[campaignId]/actions"),
  command: await world.route("campaigns/[campaignId]/companions/[characterId]"),
  companions: await world.route("campaigns/[campaignId]/companions/create"),
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

// A workshop built for two heroes at level 1, and one goblin to fight.
const workshop = createWorkshop(author.id, { title: "The Old Mill", targetParty: { size: 2, level: 1 } });
const at = { workshopId: workshop.id };
const fight = insertEncounterTemplate({
  campaignId: workshop.id,
  name: "A goblin at the mill",
  enemies: [{ monster: "goblin", count: 1 }],
  battlefield: "",
  map: { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
  notes: "",
  extras: {},
  createdByUserId: author.id,
});

const hero = createCharacter(author.id, 1, { ...LEGAL_FIGHTER, name: "Thessaly", portrait: PORTRAIT }, "pc");
const pip = createCharacter(author.id, 1, { ...LEGAL_FIGHTER, name: "Pip", portrait: PORTRAIT, backstory: "Cheerful, loyal, talks too much." }, "companion");
const pipBefore = JSON.stringify(getCharacter(pip.id));

async function start(party, runner) {
  world.signIn(author);
  const out = await call(route.test, "POST", { templateId: fight.id, party, ...(runner ? { runner } : {}) }, at);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  return campaigns.getCampaignById(out.json.campaignId);
}

// The GM's last line at a test table: nobody has spoken since.
const gmSays = (campaignId, content) => insertCampaignMessage({ campaignId, seq: campaigns.allocateSeq(campaignId), authorType: "dm", content });

const allyOf = (tableId) => listSheets(tableId).find((sheet) => sheet.isCompanion);

// `first` up, the goblin next, the rest after: a known turn with the floor on it.
function turnTo(tableId, first) {
  const encounter = getActiveEncounter(tableId);
  assert.ok(encounter?.orderReady, "the opening rolled everyone's initiative");
  const lead = encounter.order.find((entry) => entry.kind === "pc" && entry.characterId === first.id);
  const order = [lead, ...encounter.order.filter((entry) => entry !== lead)].map((entry, index) => ({ ...entry, initiative: 30 - index }));
  const legendary = { ...encounter.legendary };
  delete legendary.due;
  saveEncounter({ ...encounter, order, turnIndex: 0, turnBudget: null, legendary });
  campaigns.setFloor(tableId, { mode: "initiative", encounterId: encounter.id, userIds: [lead.userId], currentName: first.name, round: encounter.round });
  const goblin = listEnemies(encounter.id)[0];
  const board = getBattleMapForEncounter(encounter.id);
  const spot = getTokenByRef(board.id, first.id);
  moveToken(getTokenByRef(board.id, goblin.id).id, spot.x + 1 > board.width - 1 ? spot.x - 1 : spot.x + 1, spot.y, 0);
  return goblin;
}

await test("the host offers allies, and the picker's data carries the companions the author keeps, filed as allies", async () => {
  assert.equal(SERVER_FEATURES.testFightAllies, true);
  const out = await call(route.characters, "GET", undefined, {});
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const roles = Object.fromEntries(out.json.characters.map((character) => [character.name, character.role]));
  assert.equal(roles.Pip, "companion");
  assert.equal(roles.Thessaly, "pc");
});

let aiTable = null;
await test("an AI-run test seats an ally as a companion copy beside the stand-ins, the author in the steering seat, the AI playing the ally", async () => {
  aiTable = await start({ kind: "stand-ins", allyIds: [pip.id] });
  assert.equal(aiTable.kind, "playtest");
  assert.equal(aiTable.gameSettings.dmMode, "steered");
  assert.equal(aiTable.dmUserId, author.id, "the author holds the GM seat beside the AI");
  // The workshop's own setting rides through (a workshop's default is Auto).
  assert.equal(aiTable.gameSettings.companions, workshop.gameSettings.companions);
  assert.equal(aiTable.gameSettings.companions, "auto");
  const ally = allyOf(aiTable.id);
  assert.ok(ally, "no ally was seated");
  assert.equal(ally.name, "Pip");
  assert.equal(ally.companionKind, "party");
  assert.match(ally.userId, /^comp_/, "an ally sits in a seat of its own, as every companion does");
  assert.equal(ally.libraryCharacterId ?? null, null, "the copy is tied to no library row");
  assert.equal(ally.commandedBy ?? null, null, "nobody commands the ally until the author takes command");
  assert.equal(aiPlaysSheet(aiTable, ally), true);
  // The heroes are the stand-ins, and the ally is in the fight beside them.
  assert.equal(listSheets(aiTable.id).filter((sheet) => !sheet.isCompanion).length, 2);
  const encounter = getActiveEncounter(aiTable.id);
  assert.ok(encounter.order.some((entry) => entry.kind === "pc" && entry.characterId === ally.id), "the ally has no place in the order");
  assert.ok(getTokenByRef(getBattleMapForEncounter(encounter.id).id, ally.id), "the ally has no token on the board");
  const said = getDatabase().prepare(`SELECT content FROM campaign_messages WHERE campaign_id = ? AND author_type = 'system'`).all(aiTable.id);
  assert.ok(said.some((row) => /with Pip beside them/.test(row.content)), JSON.stringify(said));
});

await test("at an AI-run test the author's console sets the board up, and an enemy's own card is refused from their seat", async () => {
  const [stand] = listSheets(aiTable.id).filter((sheet) => !sheet.isCompanion);
  const goblin = turnTo(aiTable.id, stand);
  world.signIn(author);
  const params = { campaignId: aiTable.id };
  const hurt = await call(route.invoke, "POST", { name: "apply_damage", args: { enemyId: goblin.id, amount: 1 } }, params);
  assert.equal(hurt.status, 200, JSON.stringify(hurt.json));
  const before = listRecentRolls(aiTable.id, 50).length;
  for (const card of [
    { name: "enemy_attack", args: { enemyId: goblin.id, targetCharacterId: stand.id } },
    { name: "cast_at_player", args: { characterId: stand.id, casterEnemyId: goblin.id, saveAbility: "dex", dc: 12, damage: "1d6" } },
    { name: "take_action", args: { enemyId: goblin.id, action: "dodge" } },
  ]) {
    const out = await call(route.invoke, "POST", card, params);
    assert.equal(out.status, 409, `${card.name}: ${JSON.stringify(out.json)}`);
    assert.equal(out.json.error, AI_RUNS_FOES);
  }
  assert.equal(listRecentRolls(aiTable.id, 50).length, before, "a refused card rolled something");
  // Nor the tracker's buttons that play the enemies' or an ally's turn.
  for (const body of [{ op: "enemies", play: true }, { op: "companion" }]) {
    const out = await call(route.initiative, "POST", body, params);
    assert.equal(out.status, 409, JSON.stringify(out.json));
    assert.equal(out.json.error, AI_RUNS_TURNS);
  }
});

await test("at an AI-run test the AI still waits for each hero's word, and the author's Do from the GM seat is that word", async () => {
  const [stand] = listSheets(aiTable.id).filter((sheet) => !sheet.isCompanion);
  const goblin = turnTo(aiTable.id, stand);
  gmSays(aiTable.id, `The goblin snarls. ${stand.name}, it's your turn.`);
  assert.equal(characterAwaitingPlayer(aiTable.id)?.id, stand.id);
  const turn = createDmTurn(aiTable.id, []);
  const silent = await invokeEngine(campaigns.getCampaignById(aiTable.id), { kind: "ai", turnId: turn.id }, { name: "pc_attack", args: { characterId: stand.id, targetEnemyId: goblin.id } });
  assert.equal(silent.ok, false);
  assert.match(silent.error, new RegExp(`${stand.name} has not acted: their player hasn't declared an action this turn`));
  world.signIn(author);
  const posted = await call(route.actions, "POST", { content: `${stand.name} swings at the goblin.`, kind: "do", characterId: stand.id }, { campaignId: aiTable.id });
  assert.equal(posted.status, 202, JSON.stringify(posted.json));
  const row = getDatabase().prepare(`SELECT author_type, character_id FROM campaign_messages WHERE id = ?`).get(posted.json.messageId);
  assert.deepEqual([row.author_type, row.character_id], ["player", stand.id]);
  assert.equal(characterAwaitingPlayer(aiTable.id), null, "the author's line was not the hero's word");
});

await test("at an AI-run test the AI plays the ally until the author takes command of them on their card; then the ally waits on the author too", async () => {
  const ally = allyOf(aiTable.id);
  turnTo(aiTable.id, ally);
  gmSays(aiTable.id, "Pip readies a blade.");
  assert.equal(characterAwaitingPlayer(aiTable.id), null, "an ally nobody commands is the AI's to play");
  // The tracker offers no button to play it twice.
  world.signIn(author);
  const view = await call(route.table, "GET", undefined, { campaignId: aiTable.id });
  assert.equal(view.json.encounter?.companionTurn, undefined);
  const commanded = await call(route.command, "PATCH", { commandedBy: author.id }, { campaignId: aiTable.id, characterId: ally.id });
  assert.equal(commanded.status, 200, JSON.stringify(commanded.json));
  assert.equal(getSheetById(ally.id).commandedBy, author.id);
  assert.equal(campaigns.getFloor(aiTable.id).userIds?.[0], author.id, "the ally's turn is the author's now");
  assert.equal(characterAwaitingPlayer(aiTable.id)?.id, ally.id);
});

await test("a person-run test seats the ally the same way, and the author plays its turn from the GM seat with its cards", async () => {
  const table = await start({ kind: "characters", characterIds: [hero.id], allyIds: [pip.id] }, "person");
  assert.equal(table.gameSettings.dmMode, "human");
  assert.equal(table.dmUserId, author.id);
  const ally = allyOf(table.id);
  assert.ok(ally, "no ally was seated");
  assert.equal(ally.libraryCharacterId ?? null, null);
  assert.equal(ally.commandedBy ?? null, null);
  const goblin = turnTo(table.id, ally);
  assert.equal(gmCompanionTurn(campaigns.getCampaignById(table.id), author.id)?.id, ally.id, "the ally's turn is not the GM's to play");
  world.signIn(author);
  // A natural 1: the swing is rolled and misses, so the goblin is still up
  // for its own card below (a lucky hit could fell it first).
  world.dice(1);
  const out = await call(route.actions, "POST", {
    content: "Pip attacks the goblin.",
    kind: "do",
    characterId: ally.id,
    intent: { card: "attack", targetKind: "enemy", targetId: goblin.id, targetName: goblin.displayName },
  }, { campaignId: table.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.resolved, true);
  assert.ok(listRecentRolls(table.id, 10).some((roll) => roll.kind === "attack" && roll.characterId === ally.id), "the ally's attack was not rolled");
  world.clearDice();
  // A person-run test is unchanged: the enemies' cards are the author's.
  const theirs = await call(route.invoke, "POST", { name: "enemy_attack", args: { enemyId: goblin.id, targetCharacterId: ally.id } }, { campaignId: table.id });
  assert.notEqual(theirs.json.error, AI_RUNS_FOES);
  assert.equal(theirs.status, 200, JSON.stringify(theirs.json));
});

await test("nothing the test does reaches the library: the ally's row is as it was after the fight and after the test ends", async () => {
  const table = await start({ kind: "stand-ins", allyIds: [pip.id] }, "person");
  const ally = allyOf(table.id);
  patchSheet(ally.id, { currentHp: 0 });
  assert.equal(JSON.stringify(getCharacter(pip.id)), pipBefore);
  const ended = await call(route.test, "DELETE", undefined, at);
  assert.equal(ended.status, 200);
  assert.equal(campaigns.getCampaignById(table.id), null);
  assert.equal(JSON.stringify(getCharacter(pip.id)), pipBefore);
});

// The Party panel's companion doors are open mid-test now that allies are:
// one brought from the library or built at the test sits unlinked, as the
// seats the test opens with do, and no library entry is made for it.
await test("a companion brought or built mid-test sits with no library entry behind it", async () => {
  const table = await start({ kind: "stand-ins" }, "person");
  campaigns.updateGameSettings(table.id, { companions: "full" });
  const bo = createCharacter(author.id, 1, { ...LEGAL_FIGHTER, name: "Bo", portrait: PORTRAIT, backstory: "Quiet." }, "companion");
  const boBefore = JSON.stringify(getCharacter(bo.id));
  const libraryCount = () => getDatabase().prepare(`SELECT COUNT(*) AS n FROM library_characters WHERE user_id = ?`).get(author.id).n;
  const before = libraryCount();
  const brought = await call(route.companions, "POST", { libraryCharacterId: bo.id }, { campaignId: table.id });
  assert.equal(brought.status, 201, JSON.stringify(brought.json));
  assert.equal(brought.json.sheet.libraryCharacterId ?? null, null, "the brought companion is tied to its library row");
  const built = await call(route.companions, "POST", { sheet: { ...LEGAL_FIGHTER, name: "Wren", portrait: PORTRAIT } }, { campaignId: table.id });
  assert.equal(built.status, 201, JSON.stringify(built.json));
  assert.equal(built.json.sheet.libraryCharacterId ?? null, null);
  assert.equal(libraryCount(), before, "building a companion at a test filed it in the library");
  assert.equal(JSON.stringify(getCharacter(bo.id)), boBefore);
});

await test("a workshop with companions off keeps them off with no ally, and seats a picked ally with them on", async () => {
  campaigns.updateGameSettings(workshop.id, { companions: "off" });
  const bare = await start({ kind: "stand-ins" }, "person");
  assert.equal(bare.gameSettings.companions, "off");
  const allied = await start({ kind: "stand-ins", allyIds: [pip.id] }, "person");
  assert.equal(allied.gameSettings.companions, "full");
  assert.ok(allyOf(allied.id));
  campaigns.updateGameSettings(workshop.id, { companions: "auto" });
  assert.equal(testCompanionsSetting("guests", 1), "guests");
  assert.equal(testCompanionsSetting("off", 0), "off");
});

await test("what the allies refuse: a hero in the allies' list, an ally in the heroes', and more allies than a test seats", async () => {
  const before = getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE kind = 'playtest'`).get().n;
  world.signIn(author);
  const heroAsAlly = await call(route.test, "POST", { templateId: fight.id, party: { kind: "stand-ins", allyIds: [hero.id] } }, at);
  assert.equal(heroAsAlly.status, 422);
  assert.match(heroAsAlly.json.error, /Thessaly is a hero, not an ally/);
  const allyAsHero = await call(route.test, "POST", { templateId: fight.id, party: { kind: "characters", characterIds: [pip.id] } }, at);
  assert.equal(allyAsHero.status, 422);
  assert.match(allyAsHero.json.error, /Pip is an ally the GM plays, not a hero: pick them among the allies/);
  const crowd = await call(route.test, "POST", { templateId: fight.id, party: { kind: "stand-ins", allyIds: ["a", "b", "c", "d", "e"] } }, at);
  assert.equal(crowd.status, 400);
  assert.equal(getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE kind = 'playtest'`).get().n, before);
});

await test("the calls an enemy acts in are told from the calls that only touch one, whatever name they come by", () => {
  assert.equal(enemyActsIn("enemy_attack", { enemyId: "e1", targetCharacterId: "c1" }), true);
  assert.equal(enemyActsIn("aoe_damage", { casterEnemyId: "e1", characterIds: ["c1"] }), true);
  assert.equal(enemyActsIn("take_action", { escapingEnemyId: "e1", action: "escape" }), true, "the retired field name");
  assert.equal(enemyActsIn("teleport_token", { token: "e1", x: 1, y: 1, casterEnemyId: "e1" }), true, "the retired tool name");
  assert.equal(enemyActsIn("lair_action", { action: "The floor tilts" }), true);
  assert.equal(enemyActsIn("legendary_resist", { enemyId: "e1" }), true);
  assert.equal(enemyActsIn("apply_damage", { enemyId: "e1", amount: 3 }), false);
  assert.equal(enemyActsIn("set_condition", { enemyId: "e1", condition: "prone" }), false);
  assert.equal(enemyActsIn("take_action", { characterId: "c1", action: "dodge" }), false);
  assert.equal(enemyActsIn("move_token", { token: "e1", x: 2, y: 2 }), false);
});

world.close();
finish();
