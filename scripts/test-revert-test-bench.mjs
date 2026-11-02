// "Revert this turn" at a test fight and at a table a person runs (issue 685):
//   - a test table's forced faces the turn spent go back in the queue where
//     they stood, and the seed back where the turn found it, so the turn
//     played again rolls the same;
//   - an event a player's End Turn brought on is a turn of its own, its
//     newcomers' initiative rolled under it;
//   - the test fight's turn trace reads the reverted turn as taken back, and
//     the stand-in turns opened inside it with it;
//   - a card the GM resolved as played goes back to "Waiting on you", and the
//     action it spent comes back with the fight's turn, so it can be
//     resolved again; a later spend on that turn is asked about first;
//   - the event log offers the revert for a turn that kept such a change.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-revert-test-bench");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { deployTemplate } = await import("../src/lib/dm/encounter-templates.ts");
const { listRecentMessages, getCampaignMessage } = await import("../src/lib/db/messages.ts");
const { listLiveTurnChangeViews, liveTurnChanges } = await import("../src/lib/db/turn-changes.ts");
const scripts = await import("../src/lib/db/dice-scripts.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { runInUsageScope } = await import("../src/lib/usage/scope.ts");
const { turnTracePage } = await import("../src/lib/dm/turn-trace.ts");
const { setDmMode, setFloor } = await import("../src/lib/db/campaigns.ts");
const { initiativeFloorFor } = await import("../src/lib/dm/encounter-tools.ts");
const { queuedIntents } = await import("../src/lib/dm/intent-queue.ts");
const { buildFeed, revertableTurns } = await import("../src/app/campaigns/[campaignId]/event-log-logic.ts");
const { runInTurnScope } = await import("../src/lib/dm/job-control.ts");
const { createDmTurn, openStandInTurn, closeStandInTurn } = await import("../src/lib/db/dm-turns.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { endOwnTurn, skipCurrentTurn } = await import("../src/lib/dm/encounter-tools.ts");
const { keepNew, REVERT_WINDOW_TURNS } = await import("../src/lib/db/turn-rows.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const MAP = { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null };
const FRESH = { successes: 0, failures: 0, stable: false, dead: false };

async function revertTurn(world, turnId, confirm = false) {
  world.signIn(world.owner);
  const handler = await world.route("campaigns/[campaignId]/audit/revert-turn");
  const response = await handler.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, ...(confirm ? { confirm: true } : {}) }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

// ---- a test table's dice ----

const bench = await openWorld({ campaign: { kind: "playtest" } });
const benchKit = conditionsKit(bench);
const fighter = bench.addHero(FIGHTER);

await test("a forced face the reverted turn spent goes back in the queue, so the turn played again rolls it again", async () => {
  benchKit.reset(fighter.id, { currentHp: 0, deathSaves: { ...FRESH, failures: 1 } });
  scripts.setDiceScript(bench.campaignId, { seed: null, queue: [{ roller: "hero", kind: "death_save", face: 1 }, { roller: "enemy", kind: "attack", face: 20 }] });
  const out = await benchKit.withDice([15], "pass_time", { amount: 1, unit: "minutes" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(bench.sheet(fighter.id).deathSaves.dead, true);
  assert.equal(scripts.getDiceScript(bench.campaignId).queue.length, 1);

  const back = await revertTurn(bench, out.outcome.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.deepEqual(bench.sheet(fighter.id).deathSaves, { ...FRESH, failures: 1 });
  const script = scripts.getDiceScript(bench.campaignId);
  assert.deepEqual(script.queue, [{ roller: "hero", kind: "death_save", face: 1 }, { roller: "enemy", kind: "attack", face: 20 }], "the spent face did not go back where it stood");
  assert.deepEqual(script.used, [], "the face still reads as spent");

  const again = await benchKit.withDice([15], "pass_time", { amount: 1, unit: "minutes" });
  assert.equal(again.outcome.ok, true, again.outcome.error);
  assert.equal(again.unused, 1, "the replay rolled the harness's die, not the script's");
  assert.equal(bench.sheet(fighter.id).deathSaves.dead, true, "the replay did not roll the same");
  benchKit.reset(fighter.id);
  scripts.clearDiceScript(bench.campaignId);
});

await test("the seed goes back where the turn found it, so the replay rolls the same seeded dice; rolled on since, it stays, and the lead is told", async () => {
  benchKit.reset(fighter.id, { currentHp: 0, deathSaves: { ...FRESH } });
  scripts.setDiceScript(bench.campaignId, { seed: 31337, queue: [] });
  const start = scripts.getDiceScript(bench.campaignId).seededRolls;
  const out = await bench.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(out.ok, true, out.error);
  assert.ok(scripts.getDiceScript(bench.campaignId).seededRolls > start, "the seed rolled nothing");
  const track = bench.sheet(fighter.id).deathSaves;

  const back = await revertTurn(bench, out.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(scripts.getDiceScript(bench.campaignId).seededRolls, start, "the seed did not go back");
  const replay = await bench.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(replay.ok, true, replay.error);
  assert.deepEqual(bench.sheet(fighter.id).deathSaves, track, "the replay rolled other seeded dice");

  // Rolled on since (a die the table rolled outside any turn): the seed
  // stays where it is, and the lead is asked first.
  runInUsageScope({ campaignId: bench.campaignId }, () => rollExpression("1d20"));
  const moved = scripts.getDiceScript(bench.campaignId).seededRolls;
  const asked = await revertTurn(bench, replay.turnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /seed has rolled on since/.test(line)), JSON.stringify(asked.json));
  const done = await revertTurn(bench, replay.turnId, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(scripts.getDiceScript(bench.campaignId).seededRolls, moved);
  benchKit.reset(fighter.id);
  scripts.clearDiceScript(bench.campaignId);
});

await test("the test fight's turn trace reads a reverted turn as taken back, its calls still listed, and the stand-in turns opened inside it with it", async () => {
  benchKit.reset(fighter.id, { currentHp: 0, deathSaves: { ...FRESH } });
  const out = await bench.invoke("pass_time", { amount: 1, unit: "minutes" });
  assert.equal(out.ok, true, out.error);
  // A stand-in opened inside the turn, as a zone's save or an opportunity
  // strike opens one, with a roll on it.
  const standIn = runInTurnScope(out.turnId, () => {
    const turn = openStandInTurn(bench.campaignId);
    turn.rollIds.push("stand-in-roll");
    closeStandInTurn(turn);
    return turn;
  });
  const read = (id) => turnTracePage(bench.campaignId, 30, null).turns.find((turn) => turn.id === id);
  assert.equal(read(out.turnId)?.revertedAt, null);
  assert.equal(read(standIn.id)?.revertedAt, null);
  const back = await revertTurn(bench, out.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const trace = read(out.turnId);
  assert.ok(trace?.revertedAt, "the trace reads the reverted turn as standing");
  assert.ok(trace.rows.some((row) => row.kind === "call" && row.tool === "pass_time"), "the reverted turn's calls were dropped");
  assert.ok(read(standIn.id)?.revertedAt, "the stand-in opened inside the reverted turn reads as standing");
  benchKit.reset(fighter.id);
});

await test("reinforcements a player's End Turn brought in at a seeded test fight roll their initiative under the event's own turn, and its revert gives the seed back", async () => {
  benchKit.reset(fighter.id);
  const benchCombat = await combatKit(bench);
  // The goblin goes first, so the hero's own End Turn closes the round: the
  // event fires there, where no turn runs.
  const template = insertEncounterTemplate({
    campaignId: bench.campaignId,
    name: "Seeded ambush",
    enemies: [{ monster: "goblin", count: 1 }],
    battlefield: "",
    map: MAP,
    notes: "",
    extras: { entry: { x: 2, y: 2 }, events: [{ trigger: { kind: "round", round: 2 }, actions: [{ kind: "reinforce", enemies: [{ monster: "goblin", count: 1 }], at: "entry" }] }] },
    createdByUserId: bench.owner.id,
  });
  bench.clearDice();
  bench.dice(20, 1);
  assert.equal((await deployTemplate(bench.campaign(), bench.owner.id, template)).ok, true);
  bench.clearDice();
  assert.equal(bench.encounter().order.at(-1)?.characterId, fighter.id, "the hero does not close the round");
  scripts.setDiceScript(bench.campaignId, { seed: 4040, queue: [] });
  const before = bench.enemies().length;
  let rolls = scripts.getDiceScript(bench.campaignId).seededRolls;
  for (let step = 0; step < 8 && bench.encounter().round < 2; step += 1) {
    rolls = scripts.getDiceScript(bench.campaignId).seededRolls;
    benchCombat.endTurn(fighter.userId);
  }
  assert.equal(bench.enemies().length, before + 1);
  const fired = listLiveTurnChangeViews(bench.campaignId).find((change) => change.kind === "fight_event");
  assert.ok(fired, "the reinforcement was kept under no turn");
  assert.ok(
    liveTurnChanges(bench.campaignId, fired.turnId).some((change) => change.kind === "dice_seed"),
    "the newcomer's initiative was rolled under no turn, so no revert gives the seed back",
  );
  const back = await revertTurn(bench, fired.turnId, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(bench.enemies().length, before);
  assert.ok(scripts.getDiceScript(bench.campaignId).seededRolls <= rolls, "the seed the newcomer's initiative spent stayed spent");
  await bench.invoke("end_encounter", { outcome: "truce" });
  scripts.clearDiceScript(bench.campaignId);
});

await test("a player's End Turn or the lead's skip that brings on an event is one turn with the round it began: its revert puts the round back, and the event waits for the round to come round again; one that brings on nothing leaves no turn behind", async () => {
  benchKit.reset(fighter.id);
  const benchCombat = await combatKit(bench);
  const template = insertEncounterTemplate({
    campaignId: bench.campaignId,
    name: "Round three",
    enemies: [{ monster: "goblin", count: 1 }],
    battlefield: "",
    map: MAP,
    notes: "",
    extras: { entry: { x: 2, y: 2 }, events: [{ trigger: { kind: "round", round: 3 }, actions: [{ kind: "say", text: "The drums start." }] }] },
    createdByUserId: bench.owner.id,
  });
  bench.clearDice();
  bench.dice(20, 1);
  assert.equal((await deployTemplate(bench.campaign(), bench.owner.id, template)).ok, true);
  bench.clearDice();
  const drums = () => listRecentMessages(bench.campaignId, 100).filter((message) => message.content === "The drums start.").length;
  // The lead hands the goblin's turn on, and the hero closes the round with
  // their own End Turn.
  const views = () => listLiveTurnChangeViews(bench.campaignId).length;
  const turns = () => getDatabase().prepare(`SELECT COUNT(*) AS n FROM dm_turns WHERE campaign_id = ?`).get(bench.campaignId).n;
  const closeRound = (move) => {
    benchCombat.handOnEnemies();
    benchCombat.giveTurn(fighter.id);
    const before = { changes: views(), turns: turns() };
    assert.equal(move(), true, "the move was refused");
    return { changes: views() - before.changes, turns: turns() - before.turns };
  };
  const endTurn = () => endOwnTurn(bench.campaignId, fighter.userId);
  const skip = () => skipCurrentTurn(bench.campaignId);
  const takeBack = async (word) => {
    const fired = listLiveTurnChangeViews(bench.campaignId).find((change) => change.kind === "fight_event" && /drums/.test(change.line));
    assert.ok(fired, `the event ${word} brought on was kept under no turn`);
    const back = await revertTurn(bench, fired.turnId);
    assert.equal(back.status, 200, JSON.stringify(back.json));
    assert.equal(bench.encounter().round, 2, `the round ${word} began stayed`);
    assert.equal(drums(), 0, "the chronicle still reads the event as standing");
  };
  assert.deepEqual(closeRound(endTurn), { changes: 0, turns: 0 }, "an End Turn that brought on nothing left a turn behind");
  assert.equal(bench.encounter().round, 2);
  assert.ok(closeRound(endTurn).changes > 0);
  assert.equal(bench.encounter().round, 3);
  assert.equal(drums(), 1);
  await takeBack("the End Turn");
  // A call in round 2 fires nothing; the round coming round again does.
  assert.equal((await bench.invoke("set_enemy_condition", { enemyId: bench.enemies()[0].id, condition: "prone" })).ok, true);
  assert.equal(drums(), 0, "the event fired again before its round came round");
  assert.ok(closeRound(skip).changes > 0);
  assert.equal(bench.encounter().round, 3);
  assert.equal(drums(), 1);
  await takeBack("the lead's skip");
  await bench.invoke("end_encounter", { outcome: "truce" });
});

await test("what a revert keeps reaches the table's last turns only: a turn past them has nothing kept and is refused in words, and the pruning runs as a turn's work is done", async () => {
  const old = createDmTurn(bench.campaignId, [], "human_dm");
  runInTurnScope(old.id, () => keepNew("active_effects", "effect-long-gone", bench.campaignId));
  const kept = (table) => getDatabase().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE turn_id = ?`).get(old.id).n;
  assert.ok(kept("turn_rows") > 0 && kept("turn_changes") > 0, "the old turn kept nothing to prune");
  // Long ago, and a full window of turns since.
  const db = getDatabase();
  for (const table of ["dm_turns", "turn_rows", "turn_changes"]) {
    db.prepare(`UPDATE ${table} SET created_at = '2001-01-01T00:00:00.000Z' WHERE ${table === "dm_turns" ? "id" : "turn_id"} = ?`).run(old.id);
  }
  for (let made = 0; made < REVERT_WINDOW_TURNS; made += 1) {
    createDmTurn(bench.campaignId, [], "human_dm");
  }
  assert.ok(kept("turn_rows") > 0, "pruned before any turn's work was done");
  runInTurnScope(createDmTurn(bench.campaignId, [], "human_dm").id, () => {});
  assert.equal(kept("turn_rows"), 0, "rows kept for a turn out of reach stayed");
  assert.equal(kept("turn_changes"), 0, "changes kept for a turn out of reach stayed");
  const refused = await revertTurn(bench, old.id);
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.match(refused.json.error, /too far back to revert/);
});

// ---- a card resolved as played ----

const table = await openWorld({ gameSettings: { multiCharacter: "all_active", ttsEnabled: false } });
const tableKit = await combatKit(table);
table.addHero({ name: "Vex", class: "wizard", level: 5, maxHp: 30, abilities: { int: 17 } });
const iris = table.addHero({
  name: "Iris",
  class: "wizard",
  level: 5,
  maxHp: 27,
  abilities: { int: 16 },
  equipment: [{ name: "Dagger", qty: 1 }],
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, known: [], prepared: ["Detect Thoughts"], cantrips: [], spellbook: ["Detect Thoughts"] },
});
// The GM's own fighter, for the action economy a swing spends.
const brakka = table.addHero({
  user: table.owner,
  name: "Brakka",
  class: "fighter",
  level: 5,
  maxHp: 44,
  abilities: { str: 16 },
  proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
setDmMode(table.campaignId, "human", table.owner.id);

async function post(name, body, userId) {
  const handler = await table.route(`campaigns/[campaignId]/${name}`);
  table.signIn({ id: userId });
  const response = await handler.POST(new Request(`http://odm.test/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ campaignId: table.campaignId }),
  });
  return { status: response.status, body: await response.json() };
}
const resolve = (messageId) => post("dm/resolve-card", { messageId }, table.owner.id);
const waiting = () => queuedIntents(listRecentMessages(table.campaignId, 40), []).map((row) => row.messageId);

await test("a card the GM resolved as played waits again once the turn it was resolved in is reverted, its action given back, and can be resolved again", async () => {
  await tableKit.fight(1);
  tableKit.giveTurn(iris.id);
  tableKit.freshTurn();
  setFloor(table.campaignId, initiativeFloorFor(table.campaignId));
  const played = await post("actions", { kind: "do", content: "I cast Detect Thoughts using a level 2 slot.", characterId: iris.id, intent: { card: "spell", spell: "Detect Thoughts", slotLevel: 2 } }, iris.userId);
  assert.equal(played.status, 202, JSON.stringify(played.body));
  const card = played.body.messageId;
  const pressed = await resolve(card);
  assert.equal(pressed.status, 200, JSON.stringify(pressed.body));
  assert.equal(table.sheet(iris.id).spellcasting.slots[2].used, 1);
  assert.ok(!waiting().includes(card));
  const kept = listLiveTurnChangeViews(table.campaignId).find((change) => change.kind === "card");
  assert.ok(kept, "the card was kept under no turn");

  const back = await revertTurn(table, kept.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(table.sheet(iris.id).spellcasting.slots[2].used, 0, "the slot stayed spent");
  assert.equal(getCampaignMessage(card).cardResolvedAt, undefined, "the card still reads as answered");
  assert.ok(waiting().includes(card), "the card is not back in Waiting on you");
  const again = await resolve(card);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(table.sheet(iris.id).spellcasting.slots[2].used, 1);
});

await test("a turn's revert gives back the attack it spent while it is still that creature's turn; spent more by a later turn, the lead is asked first", async () => {
  const [dummy] = table.enemies();
  tableKit.openField();
  tableKit.place(brakka.id, 4, 4);
  tableKit.place(dummy.id, 5, 4);
  tableKit.setEnemy(dummy.id, { maxHp: 200, currentHp: 200 });
  tableKit.giveTurn(brakka.id);
  tableKit.freshTurn();
  const swing = async () => {
    table.clearDice();
    table.dice(15, 4);
    const out = await table.invoke("pc_attack", { characterId: brakka.id, enemyId: dummy.id, targetEnemyId: dummy.id, weapon: "Longsword" });
    table.clearDice();
    assert.equal(out.ok, true, out.error);
    return out;
  };
  const made = () => table.encounter().turnBudget?.attacksMade ?? 0;
  const first = await swing();
  assert.equal(made(), 1);
  const back = await revertTurn(table, first.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(made(), 0, "the swing the revert took back stayed spent");
  const again = await swing();
  await swing();
  assert.equal(made(), 2);
  const asked = await revertTurn(table, again.turnId);
  assert.equal(asked.status, 409, JSON.stringify(asked.json));
  assert.ok(asked.json.warnings.some((line) => /order of turns.* changed again/.test(line)), JSON.stringify(asked.json));
  const done = await revertTurn(table, again.turnId, true);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(made(), 0);
});

await test("the reactions a reverted turn spent come back; one a later turn spent as well is asked about first", async () => {
  const spendIn = (turn, id) =>
    runInTurnScope(turn.id, () => {
      const encounter = table.encounter();
      encounter.reactionsUsed = [...encounter.reactionsUsed, id];
      saveEncounter(encounter);
    });
  const before = table.encounter().reactionsUsed;
  const earlier = createDmTurn(table.campaignId, [], "human_dm");
  spendIn(earlier, iris.id);
  spendIn(createDmTurn(table.campaignId, [], "human_dm"), brakka.id);
  assert.equal((await revertTurn(table, earlier.id)).status, 409);
  const back = await revertTurn(table, earlier.id, true);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.deepEqual(table.encounter().reactionsUsed, before);
});

// ---- the event log's reading ----

await test("the event log offers the revert for a turn whose one sheet change came with a kept change, and lists the change, not a seed's run", () => {
  const audit = [{ id: "a1", characterId: "c", turnId: "t1", kind: "apply_damage", delta: {}, reason: "", seq: 3, undoable: true, revertedAt: null, patchKeys: ["currentHp"] }];
  const changes = [
    { id: "x1", turnId: "t1", seq: 4, kind: "fight_event", line: "Horns sound." },
    { id: "x2", turnId: "t2", seq: 5, kind: "dice_seed", line: "" },
  ];
  assert.equal(revertableTurns(audit).has("t1"), false, "one sheet change alone is the row's own undo");
  const offered = revertableTurns(audit, [], changes);
  assert.equal(offered.get("t1"), 1);
  assert.ok(offered.has("t2"));
  const feed = buildFeed(audit, [], [], changes);
  assert.deepEqual(feed.filter((item) => item.type === "change").map((item) => item.change.id), ["x1"]);
});

finish();
