// "Revert this turn" (issue 685) as the turn found the table, in the cases
// the first passes missed, each a fault seen at a table:
//   - a blow the revert took back could still be answered by a reaction,
//     which healed the hero on top of the revert;
//   - a creature a turn brought in, slain by a later turn, came back as a
//     token without its creature when the later turn was reverted too;
//   - a hero given Aid and then hit stood 5 hit points over after the revert;
//   - the exploration scene a fight broke into stayed closed, with no board;
//   - a later turn's token on a board a revert took away threw halfway
//     through the next revert, with the dice given back again on each try;
//   - the revert's question named a hidden creature to a party lead;
//   - an item dropped in the turn that began a fight outlived that fight;
//   - a dissolved End Turn pushed the oldest turn in reach out a turn early,
//     and stand-ins inside a turn shortened the window;
//   - a chapter rewind left the event log offering reverts of turns it took;
//   - the event log's counts told every seat a hidden creature was touched;
//   - a turn could be reverted while it was still being played;
//   - the prepared fight a reverted turn ran lost its cue.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-revert-turn-gaps");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { getEnemy, getEncounter, createEncounter, patchEnemyHp, setEnemyInitiative } = await import("../src/lib/db/encounters.ts");
const { createDmTurn, saveDmTurn, openStandInTurn, closeStandInTurn } = await import("../src/lib/db/dm-turns.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const { setDmMode, latestSeq } = await import("../src/lib/db/campaigns.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { openHits } = await import("../src/lib/dm/last-hit.ts");
const { listLiveTurnChangeViews } = await import("../src/lib/db/turn-changes.ts");
const { listTurnChangeViews, revertWindowStart } = await import("../src/lib/db/turn-rows.ts");
const { getBattleMapForEncounter, setTokenHidden, getTokenByRef } = await import("../src/lib/db/battle-maps.ts");
const { insertDroppedItem, listDroppedItems } = await import("../src/lib/db/dropped-items.ts");
const { armFightEvents } = await import("../src/lib/db/fight-events.ts");
const { asEventTurn } = await import("../src/lib/dm/fight-events.ts");
const { ensureOpenChapter } = await import("../src/lib/db/chapters.ts");
const { captureBoundarySnapshot } = await import("../src/lib/db/snapshots.ts");
const { getEncounterTemplate, insertEncounterTemplate, setTemplateCued } = await import("../src/lib/db/encounter-templates.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function revertTurn(world, turnId, confirm = false) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/audit/revert-turn");
  try {
    const response = await handler.POST(
      new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, ...(confirm ? { confirm: true } : {}) }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    return { status: response.status, json: await response.json().catch(() => ({})) };
  } catch (error) {
    return { status: "threw", json: { error: String(error?.message ?? error) } };
  }
}

async function personTable() {
  const world = await openWorld({ gameSettings: { dmMode: "human", multiCharacter: "all_active", ttsEnabled: false } });
  const kit = await combatKit(world);
  world.addHero({ class: "fighter", level: 5, maxHp: 300 });
  setDmMode(world.campaignId, "human", world.owner.id);
  return { world, kit };
}

await test("a blow a reverted turn landed can no longer be answered: Shield after the revert gives back nothing, as the hit points are back already", async () => {
  const world = await openWorld({ gameSettings: { multiCharacter: "all_active" }, campaign: { maxPlayers: 8 } });
  const k = await combatKit(world);
  const poppy = world.addHero({ name: "Poppy", class: "rogue", level: 5, maxHp: 30, proficiencies: TRAINED });
  const mira = world.addHero({
    name: "Mira", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED, user: world.owner,
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: [] },
  });
  await k.fight(2);
  const [g1, g2] = world.enemies();
  k.saveEncounter({
    ...world.encounter(),
    order: [
      { kind: "pc", characterId: poppy.id, userId: poppy.userId, name: "Poppy", initiative: 20 },
      { kind: "pc", characterId: mira.id, userId: mira.userId, name: "Mira", initiative: 18 },
      { kind: "enemy", enemyId: g1.id, name: g1.displayName, initiative: 11 },
      { kind: "enemy", enemyId: g2.id, name: g2.displayName, initiative: 10 },
    ],
    turnIndex: 1, round: 2, surprisedIds: [], turnBudget: null, reactionsUsed: [],
  });
  tools.setInitiativeFloor(world.campaign(), world.encounter());
  world.patch(mira.id, { ac: 12, acOverride: true, currentHp: 20, tempHp: 0 });
  world.patch(poppy.id, { ac: 12, acOverride: true, currentHp: 30, tempHp: 0 });
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.say("player", "That's my turn.", world.sheet(mira.id));
  const ended = await invokeEngine(world.campaign(), ai, { name: "end_turn", args: { characterId: mira.id } });
  assert.equal(ended.ok, true, ended.error);
  k.place(mira.id, 5, 5);
  k.place(g1.id, 5, 6);
  k.place(g2.id, 4, 5);
  for (const [enemy, faces] of [[g1, [10, 3]], [g2, [11, 5]]]) {
    world.dice(...faces);
    const out = await invokeEngine(world.campaign(), ai, { name: "enemy_attack", args: { enemyId: enemy.id, targetCharacterId: mira.id } });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
  }
  assert.equal(world.sheet(mira.id).currentHp, 8, "setup: 12 damage landed");
  const back = await revertTurn(world, turn.id, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(world.sheet(mira.id).currentHp, 20, "the revert put Mira's hit points back");
  assert.equal(openHits(world.campaignId, mira.id).length, 0, "the reverted turn's hits are still open to a reaction");
  await world.invoke("use_reaction", { characterId: mira.id, feature: "Shield" });
  assert.equal(world.sheet(mira.id).currentHp, 20, `a reaction to a reverted blow changed Mira's hit points to ${world.sheet(mira.id).currentHp}`);
});

await test("a creature one turn brought in and the next slew: reverting both, out of order, brings back no token without its creature", async () => {
  const { world, kit } = await personTable();
  await kit.fight(2);
  const before = world.enemies().map((enemy) => enemy.id);
  const added = await world.invoke("add_enemies", { enemies: [{ monster: "goblin", count: 1 }] });
  assert.equal(added.ok, true, added.error);
  const [newcomer] = world.enemies().filter((enemy) => !before.includes(enemy.id));
  const killed = await world.invoke("damage_enemy", { enemyId: newcomer.id, amount: 200 });
  assert.equal(killed.ok, true, killed.error);
  assert.equal(kit.token(newcomer.id), null, "setup: the slain goblin's token is off the board");
  const first = await revertTurn(world, added.turnId, true);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(getEnemy(newcomer.id), null, "the goblin the turn brought in is gone");
  await revertTurn(world, killed.turnId, true);
  assert.equal(kit.token(newcomer.id), null, `a token came back for a goblin that no longer exists: ${JSON.stringify(kit.token(newcomer.id))}`);
});

await test("a hero given Aid and then hit in one turn stands, after its revert, where the turn found them", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "ai", ttsEnabled: false } });
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 30 });
  world.patch(hero.id, { currentHp: 25 });
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  const aid = await invokeEngine(world.campaign(), ai, { name: "set_effect", args: { characterId: hero.id, name: "Aid", field: "maxHp", mode: "add", value: 5 } });
  assert.equal(aid.ok, true, aid.error);
  assert.deepEqual([world.sheet(hero.id).currentHp, world.sheet(hero.id).maxHp], [30, 35], "setup: Aid raised both");
  world.dice(10);
  const hit = await invokeEngine(world.campaign(), ai, { name: "apply_damage", args: { characterId: hero.id, dice: "1d10", type: "slashing" } });
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  const back = await revertTurn(world, turn.id, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const now = world.sheet(hero.id);
  assert.deepEqual([now.currentHp, now.maxHp], [25, 30], `the hero stands at ${now.currentHp}/${now.maxHp}, not 25/30 as the turn found them`);
});

await test("the exploration scene a reverted fight broke into is open again", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human", ttsEnabled: false } });
  world.addHero({ class: "fighter", level: 5, maxHp: 300 });
  setDmMode(world.campaignId, "human", world.owner.id);
  const scene = createEncounter(world.campaignId, "The party explores the crypt", "scene");
  world.dice(1, 15);
  const started = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  assert.equal(getEncounter(scene.id).status, "ended", "setup: the fight closed the scene");
  const asked = await revertTurn(world, started.turnId);
  assert.ok(!JSON.stringify(asked.json).includes("ended"), `the question says a fight stays ended: ${JSON.stringify(asked.json)}`);
  const done = await revertTurn(world, started.turnId, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(world.encounter(), null, "the fight went");
  assert.equal(getEncounter(scene.id).status, "active", "the exploration scene the reverted fight closed stays closed");
});

await test("a later turn's token on a board a revert took away is left be: the next revert neither throws nor gives anything back twice", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human", ttsEnabled: false } });
  const k = await combatKit(world);
  world.addHero({ class: "fighter", level: 5, maxHp: 300 });
  setDmMode(world.campaignId, "human", world.owner.id);
  world.dice(1, 15);
  const a = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }] });
  world.clearDice();
  assert.equal(a.ok, true, a.error);
  const before = world.enemies().map((enemy) => enemy.id);
  world.dice(10);
  const c = await world.invoke("add_enemies", { enemies: [{ monster: "goblin", count: 1 }] });
  world.clearDice();
  assert.equal(c.ok, true, c.error);
  const [late] = world.enemies().filter((enemy) => !before.includes(enemy.id));
  // Every square open, so the step is never into a generated wall.
  k.openField();
  const at = k.token(late.id);
  const b = await world.invoke("move_token", { token: late.id, x: at.x, y: at.y > 0 ? at.y - 1 : at.y + 1 });
  assert.equal(b.ok, true, b.error);
  const ra = await revertTurn(world, a.turnId, true);
  assert.equal(ra.status, 200, JSON.stringify(ra.json));
  assert.equal(world.encounter(), null, "the fight went");
  const rb = await revertTurn(world, b.turnId, true);
  assert.notEqual(rb.status, "threw", `the revert of the move threw: ${rb.json.error}`);
  assert.ok(rb.status === 200 || rb.status === 400, JSON.stringify(rb));
});

await test("a party lead at an AI table is asked about a creature changed since without the name of one the GM keeps hidden", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "ai", ttsEnabled: false } });
  const k = await combatKit(world);
  world.addHero({ class: "fighter", level: 5, maxHp: 300 });
  await k.fight(2);
  const [lurker] = world.enemies();
  const map = getBattleMapForEncounter(world.encounter().id);
  setTokenHidden(getTokenByRef(map.id, lurker.id).id, true);
  const turn = createDmTurn(world.campaignId, [], "ai");
  runInTurnScope(turn.id, () => patchEnemyHp(lurker.id, getEnemy(lurker.id).currentHp - 3, "alive"));
  patchEnemyHp(lurker.id, getEnemy(lurker.id).currentHp - 2, "alive");
  const asked = await revertTurn(world, turn.id);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(/a creature/.test(JSON.stringify(asked.json)), `the lead is told something changed: ${JSON.stringify(asked.json)}`);
  assert.ok(!JSON.stringify(asked.json).includes(lurker.displayName), `the hidden ${lurker.displayName} is named to the lead`);
});

await test("an item dropped on the board of a fight the turn began goes with the fight", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "ai", ttsEnabled: false } });
  world.addHero({ class: "fighter", level: 5, maxHp: 300 });
  const turn = createDmTurn(world.campaignId, [], "ai");
  const ai = { kind: "ai", turnId: turn.id };
  world.dice(1, 15);
  const started = await invokeEngine(world.campaign(), ai, { name: "start_encounter", args: { enemies: [{ monster: "goblin", count: 1 }] } });
  world.clearDice();
  assert.equal(started.ok, true, started.error);
  const map = getBattleMapForEncounter(world.encounter().id);
  runInTurnScope(turn.id, () => insertDroppedItem({ campaignId: world.campaignId, mapId: map.id, x: 1, y: 1, place: "", item: { name: "Dagger", qty: 1 }, droppedBy: "" }));
  const back = await revertTurn(world, turn.id, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(world.encounter(), null, "the fight went");
  assert.equal(listDroppedItems(world.campaignId).length, 0, "an item dropped in the reverted turn lies on a board that no longer exists");
});

await test("an End Turn that brought on no event, dissolved, leaves the oldest turn in reach with its rows", async () => {
  const { world, kit } = await personTable();
  await kit.fight(1);
  const [gob] = world.enemies();
  armFightEvents({ campaignId: world.campaignId, encounterId: world.encounter().id, templateName: "t", events: [{ trigger: { kind: "round", round: 99 }, actions: [{ kind: "say", text: "x" }] }], slots: {}, entry: null, board: null });
  await sleep(5);
  for (let i = 0; i < 200; i += 1) createDmTurn(world.campaignId, [], "human_dm");
  await sleep(5);
  const oldest = createDmTurn(world.campaignId, [], "human_dm");
  runInTurnScope(oldest.id, () => setEnemyInitiative(gob.id, 7));
  await sleep(5);
  for (let i = 0; i < 199; i += 1) createDmTurn(world.campaignId, [], "human_dm");
  const rowsOf = (id) => getDatabase().prepare(`SELECT COUNT(*) AS n FROM turn_rows WHERE turn_id = ?`).get(id).n;
  assert.equal(rowsOf(oldest.id), 1, "setup: the oldest turn in reach kept the goblin");
  asEventTurn(world.campaignId, () => setEnemyInitiative(gob.id, 9));
  assert.equal(rowsOf(oldest.id), 1, "the turn in reach lost its rows to a turn that no longer exists");
});

await test("stand-ins opened inside a turn are part of it: two hundred of them leave the turn in reach", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "human", ttsEnabled: false } });
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  runInTurnScope(turn.id, () => {
    for (let i = 0; i < 210; i += 1) closeStandInTurn(openStandInTurn(world.campaignId));
  });
  assert.equal(revertWindowStart(world.campaignId), null, "a turn and its stand-ins filled the window");
});

await test("a chapter rewind takes the reverts of the turns it deletes off the event log", async () => {
  const { world, kit } = await personTable();
  await kit.fight(1);
  ensureOpenChapter(world.campaignId);
  captureBoundarySnapshot(world.campaignId, 1, latestSeq(world.campaignId));
  await sleep(5);
  const [gob] = world.enemies();
  const hurt = await world.invoke("damage_enemy", { enemyId: gob.id, amount: 1 });
  assert.equal(hurt.ok, true, hurt.error);
  assert.ok(listLiveTurnChangeViews(world.campaignId).some((change) => change.turnId === hurt.turnId), "setup: the call is offered");
  world.signIn(world.owner);
  const rollback = await world.route("campaigns/[campaignId]/chapters/rollback");
  const response = await rollback.POST(new Request("http://test/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chapterIndex: 1, confirm: true }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(listLiveTurnChangeViews(world.campaignId).filter((change) => change.turnId === hurt.turnId), [], "the log still offers the revert of a turn the rewind took");
});

await test("the event log's line for a turn counts only what the table can see", async () => {
  const { world, kit } = await personTable();
  await kit.fight(2);
  const [lurker] = world.enemies();
  const map = getBattleMapForEncounter(world.encounter().id);
  setTokenHidden(getTokenByRef(map.id, lurker.id).id, true);
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  runInTurnScope(turn.id, () => patchEnemyHp(lurker.id, getEnemy(lurker.id).currentHp - 3, "alive"));
  const line = listTurnChangeViews(world.campaignId).find((change) => change.turnId === turn.id)?.line ?? "";
  assert.ok(line, "setup: the turn is offered");
  assert.ok(!/creature/.test(line), `the line every seat reads counts a hidden creature: ${line}`);
});

await test("a turn still being played is not reverted until it is done", async () => {
  const { world, kit } = await personTable();
  await kit.fight(1);
  const [gob] = world.enemies();
  const turn = createDmTurn(world.campaignId, [], "human_dm");
  let during;
  await runInTurnScope(turn.id, async () => {
    patchEnemyHp(gob.id, getEnemy(gob.id).currentHp - 1, "alive");
    during = await revertTurn(world, turn.id, true);
  });
  assert.equal(during.status, 409, `a turn whose work runs was reverted: ${JSON.stringify(during)}`);
  turn.status = "awaiting_rolls";
  saveDmTurn(turn);
  const parked = await revertTurn(world, turn.id, true);
  assert.equal(parked.status, 409, `a turn waiting on its rolls was reverted: ${JSON.stringify(parked)}`);
  turn.status = "done";
  saveDmTurn(turn);
  const done = await revertTurn(world, turn.id, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
});

await test("the prepared fight a reverted turn began is the lead's cue again", async () => {
  const world = await openWorld({ gameSettings: { dmMode: "ai", ttsEnabled: false } });
  world.addHero({ class: "fighter", level: 5, maxHp: 300 });
  const template = insertEncounterTemplate({
    campaignId: world.campaignId,
    name: "Goblins at the ford",
    enemies: [{ monster: "goblin", count: 1 }],
    battlefield: "a shallow ford",
    map: { mapId: null, scene: "river", seed: null, theme: null, ambient: null, width: null, height: null },
    notes: "They want the toll.",
    extras: {},
    createdByUserId: world.owner.id,
  });
  setTemplateCued(template.id, true);
  const turn = createDmTurn(world.campaignId, [], "ai");
  const sheets = listSheets(world.campaignId);
  world.dice(10, 10);
  const ran = await runInTurnScope(turn.id, () =>
    dispatchAdjudication("run_prepared_encounter", JSON.stringify({ name: "Goblins at the ford" }), {
      campaign: world.campaign(),
      turn,
      sheets,
      sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])),
      realDiceUserIds: new Set(),
    }),
  );
  world.clearDice();
  assert.ok(!ran.error, JSON.stringify(ran));
  assert.equal(getEncounterTemplate(template.id).cued, false, "setup: the fight spent the cue");
  const back = await revertTurn(world, turn.id, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(world.encounter(), null, "the fight went");
  assert.equal(getEncounterTemplate(template.id).cued, true, "the lead's cue stayed spent on a fight the revert took away");
});

finish();
