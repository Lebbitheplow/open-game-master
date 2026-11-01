// Issue 685: a test table's dice can be scripted (src/lib/db/dice-scripts.ts),
// and no other table's can. Every check here runs the server's own dice
// through the hook src/lib/dice.ts takes the script from, with the test
// harness's dice queue (scripts/lib/enforce-world.mjs) loaded with faces the
// script must beat: a forced or seeded face that came from the harness
// instead would show up as the harness's face, and as a queue left unspent.
//
//   - a forced 20 on an enemy's attack at a test table is a critical hit;
//   - a death save forced to 1 is two failures;
//   - a forced d20 is the die the roll keeps at disadvantage, and through a
//     halfling's reroll;
//   - the same row written for a live table is never read;
//   - a seed alone rolls the same faces twice, and carries on from where it
//     stopped when it is set again;
//   - the route refuses a live table in plain words and serves a test table;
//   - the row goes with its table.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-dice-script");

const scripts = await import("../src/lib/db/dice-scripts.ts");
const logic = await import("../src/lib/dice-script-logic.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { runInUsageScope } = await import("../src/lib/usage/scope.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");

const testTable = await openWorld({ campaign: { kind: "playtest" } });
const live = await openWorld();
assert.equal(testTable.campaign().kind, "playtest");
assert.equal(live.campaign().kind, "campaign");

const testKit = conditionsKit(testTable);
const liveKit = conditionsKit(live);
const hero = testTable.addHero(FIGHTER);
const liveHero = live.addHero(FIGHTER);

const FRESH = { successes: 0, failures: 0, stable: false, dead: false };

// The faces a seed gives, by the pure generator.
function seeded(seed, count, sides = 20) {
  let state = logic.seedState(seed);
  const faces = [];
  for (let index = 0; index < count; index += 1) {
    const next = logic.seededFace(state, sides);
    faces.push(next.face);
    state = next.state;
  }
  return faces;
}

// Six d20s rolled for a table, as a request for it rolls them (requireMember's
// usage scope names the table).
function sixAt(world) {
  return runInUsageScope({ campaignId: world.campaignId }, () =>
    Array.from({ length: 6 }, () => rollExpression("1d20").total),
  );
}

// ---- forced faces ----

await test("a death save forced to 1 at a test table is two failures, though the harness queued a success", async () => {
  testKit.reset(hero.id, { currentHp: 0, deathSaves: { ...FRESH, failures: 1 } });
  assert.equal(scripts.setDiceScript(testTable.campaignId, { seed: null, queue: [{ roller: "hero", kind: "death_save", face: 1 }] }), true);
  const out = await testKit.withDice([15], "pass_time", { amount: 1, unit: "minutes" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.equal(out.unused, 1, "the harness's 15 was never rolled: the script's 1 was");
  assert.equal(testTable.sheet(hero.id).deathSaves.dead, true, JSON.stringify(out.result?.deathSaves));
  const state = scripts.getDiceScript(testTable.campaignId);
  assert.deepEqual(state.queue, []);
  assert.equal(state.used.length, 1);
  assert.equal(logic.describeUsed(state.used[0]), `Hero death save, d20 = 1 (${hero.name})`);
  testKit.reset(hero.id);
  scripts.clearDiceScript(testTable.campaignId);
});

await test("an enemy's initiative forced at a test table opens the fight on that face", async () => {
  scripts.setDiceScript(testTable.campaignId, { seed: null, queue: [{ roller: "enemy", kind: "initiative", face: 2 }] });
  // The harness queues the goblins' die (20) then the hero's (20); the
  // script takes the goblins' die, so the hero takes the first 20.
  const encounter = await testTable.beginFight([{ monster: "goblin", count: 1 }], { enemyFace: 20, heroFaces: { [hero.id]: 20 } });
  testKit.offBoard();
  const [goblin] = testTable.enemies();
  const slot = encounter.order.find((entry) => entry.kind === "enemy");
  assert.equal(slot.initiative, 2 + (goblin.stats.dexMod ?? 0), JSON.stringify(encounter.order));
  assert.equal(scripts.getDiceScript(testTable.campaignId).used[0].who, goblin.displayName);
  assert.deepEqual(scripts.getDiceScript(testTable.campaignId).queue, []);
  scripts.clearDiceScript(testTable.campaignId);
});

await test("an enemy's attack forced to 20 at a test table is a critical hit, though the harness queued a 1", async () => {
  const [goblin] = testTable.enemies();
  testKit.reset(hero.id);
  scripts.setDiceScript(testTable.campaignId, {
    seed: null,
    queue: [
      // Aimed at someone else first: it waits.
      { roller: "enemy", kind: "attack", face: 1, who: "Goblin 9" },
      { roller: "enemy", kind: "attack", face: 20, who: goblin.displayName },
    ],
  });
  const out = await testKit.withDice([1, 1, 1, 1], "enemy_attack", { enemyId: goblin.id, targetCharacterId: hero.id });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  const swing = out.result.swings[0];
  assert.equal(swing.crit, true, JSON.stringify(swing));
  assert.equal(swing.hit, true);
  // Only the damage dice came from the harness: a crit's two d6, each a 1.
  assert.deepEqual(out.dice, ["d6:1", "d6:1"]);
  assert.equal(out.unused, 2);
  const state = scripts.getDiceScript(testTable.campaignId);
  assert.deepEqual(state.queue, [{ roller: "enemy", kind: "attack", face: 1, who: "Goblin 9" }]);
  assert.equal(logic.describeUsed(state.used.at(-1)), `Enemy attack roll, d20 = 20 (${goblin.displayName})`);
  scripts.clearDiceScript(testTable.campaignId);
});

await test("a forced d20 is the face the roll keeps: at disadvantage both dice show it, and a halfling's reroll keeps it", async () => {
  scripts.setDiceScript(testTable.campaignId, {
    seed: null,
    queue: [
      { roller: "hero", kind: "save", face: 20 },
      { roller: "hero", kind: "save", face: 1 },
      { roller: "enemy", kind: "damage", face: 6 },
    ],
  });
  testTable.clearDice();
  testTable.dice(3, 3, 3, 3);
  const save = { roller: "hero", kind: "save", who: hero.name };
  const [low, lucky, blow] = runInUsageScope({ campaignId: testTable.campaignId }, () => [
    rollExpression("2d20kl1+1", undefined, { purpose: save }),
    rollExpression("1d20r1", undefined, { purpose: save }),
    // A damage face is one die: the second d6 rolls on.
    rollExpression("2d6", undefined, { purpose: { roller: "enemy", kind: "damage", who: "Goblin 1" } }),
  ]);
  assert.equal(low.natural, 20);
  assert.equal(low.crit, "nat20");
  assert.deepEqual(low.terms[0].dice.map((die) => die.value), [20, 20]);
  assert.equal(lucky.natural, 1);
  assert.deepEqual(blow.terms[0].dice.map((die) => die.value), [6, 3]);
  assert.equal(testTable.clearDice(), 3, "only the second d6 came from the harness");
  scripts.clearDiceScript(testTable.campaignId);
});

// ---- a live table ----

await test("a live table refuses a script, and a row written there by hand is never read", async () => {
  assert.equal(scripts.setDiceScript(live.campaignId, { seed: 5, queue: [{ roller: "any", kind: "any", face: 20 }] }), false);
  assert.equal(scripts.getDiceScript(live.campaignId), null);
  getDatabase()
    .prepare(`INSERT INTO dice_scripts (campaign_id, seed, seed_state, queue_json, updated_at) VALUES (?, 5, 5, ?, ?)`)
    .run(live.campaignId, JSON.stringify([{ roller: "enemy", kind: "attack", face: 20 }]), new Date().toISOString());
  await live.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [liveHero.id]: 20 } });
  liveKit.offBoard();
  const [goblin] = live.enemies();
  liveKit.reset(liveHero.id);
  const out = await liveKit.withDice([1], "enemy_attack", { enemyId: goblin.id, targetCharacterId: liveHero.id });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.deepEqual(out.dice, ["d20:1"], "the live table rolled the harness's die");
  assert.equal(out.result.swings[0].hit, false);
  assert.equal(out.result.swings[0].fumble, true);
  // Neither the forced face nor the seed was touched.
  assert.equal(scripts.getDiceScript(live.campaignId).queue.length, 1);
  assert.equal(scripts.getDiceScript(live.campaignId).seededRolls, 0);
  testTable.clearDice();
  testTable.dice(4, 4, 4, 4, 4, 4);
  assert.deepEqual(sixAt(live), [4, 4, 4, 4, 4, 4]);
  scripts.clearDiceScript(live.campaignId);
});

// ---- the seed ----

await test("a seed alone rolls the same faces twice, and the same seed set again carries on", async () => {
  const expected = seeded(99, 12);
  scripts.setDiceScript(testTable.campaignId, { seed: 99, queue: [] });
  testTable.clearDice();
  testTable.dice(new Array(6).fill(1));
  const first = sixAt(testTable);
  assert.deepEqual(first, expected.slice(0, 6));
  assert.equal(testTable.clearDice(), 6, "the seed rolled every die, the harness none");
  // Set again with the same seed (an edit of the forced faces): it carries on.
  scripts.setDiceScript(testTable.campaignId, { seed: 99, queue: [] });
  assert.equal(scripts.getDiceScript(testTable.campaignId).seededRolls, 6);
  assert.deepEqual(sixAt(testTable), expected.slice(6, 12));
  // Cleared and set afresh: the run starts over, the same faces again.
  scripts.clearDiceScript(testTable.campaignId);
  scripts.setDiceScript(testTable.campaignId, { seed: 99, queue: [] });
  assert.deepEqual(sixAt(testTable), first);
  // A second test table with the same seed rolls the same run.
  const other = campaigns.createCampaign(testTable.owner.id, {
    title: "Another test",
    description: "",
    theme: "high-fantasy",
    maxPlayers: 1,
    startingLevel: 1,
    difficulty: "normal",
    kind: "playtest",
    gameSettings: {},
  });
  scripts.setDiceScript(other.id, { seed: 99, queue: [] });
  assert.deepEqual(sixAt({ campaignId: other.id }), first);
  scripts.clearDiceScript(testTable.campaignId);
  campaigns.deleteCampaign(other.id);
});

await test("a seeded test fight played twice the same way rolls the same dice", async () => {
  const [goblin] = testTable.enemies();
  const play = async () => {
    scripts.clearDiceScript(testTable.campaignId);
    scripts.setDiceScript(testTable.campaignId, { seed: 2024, queue: [] });
    testKit.reset(hero.id);
    const out = await testKit.withDice([], "enemy_attack", { enemyId: goblin.id, targetCharacterId: hero.id });
    assert.equal(out.outcome.ok, true, out.outcome.error);
    assert.deepEqual(out.dice, [], "no die came from the harness");
    return { swing: out.result.swings[0], hp: testTable.sheet(hero.id).currentHp };
  };
  const once = await play();
  const twice = await play();
  assert.deepEqual(twice, once);
  scripts.clearDiceScript(testTable.campaignId);
});

// ---- the route ----

const route = await testTable.route("campaigns/[campaignId]/dice-script");

async function call(method, campaignId, body) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await route[method](request, { params: Promise.resolve({ campaignId }) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

await test("the route refuses a live table in plain words, even to its owner", async () => {
  live.signIn(live.owner);
  for (const method of ["GET", "PUT", "DELETE"]) {
    const out = await call(method, live.campaignId, method === "PUT" ? { seed: 1, queue: [] } : undefined);
    assert.equal(out.status, 403, `${method}: ${JSON.stringify(out.json)}`);
    assert.equal(out.json.error, "Only a test fight's table can script its dice. Every other table rolls them honestly.");
  }
  assert.equal(scripts.getDiceScript(live.campaignId), null);
});

await test("the route serves a test table's author: the script, who is at the table, what was spent; and clears it", async () => {
  testTable.signIn(testTable.owner);
  const [goblin] = testTable.enemies();
  const put = await call("PUT", testTable.campaignId, {
    seed: 12,
    queue: [{ roller: "enemy", kind: "attack", face: 20, who: goblin.displayName }],
  });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.deepEqual(put.json.script, { seed: 12, queue: [{ roller: "enemy", kind: "attack", face: 20, who: goblin.displayName }] });
  assert.match(put.json.summary, /^Seed 12/);
  assert.ok(put.json.combatants.some((entry) => entry.name === hero.name && entry.roller === "hero"), JSON.stringify(put.json.combatants));
  assert.ok(put.json.combatants.some((entry) => entry.name === goblin.displayName && entry.roller === "enemy"));

  const bad = await call("PUT", testTable.campaignId, { seed: null, queue: [{ roller: "enemy", kind: "attack", face: 25 }] });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Only a damage die can show more than 20/);
  const junk = await call("PUT", testTable.campaignId, { seed: "twelve" });
  assert.equal(junk.status, 400);
  assert.equal(scripts.getDiceScript(testTable.campaignId).seed, 12, "a refused body changed nothing");

  testKit.reset(hero.id);
  await testKit.withDice([], "enemy_attack", { enemyId: goblin.id, targetCharacterId: hero.id });
  const read = await call("GET", testTable.campaignId);
  assert.equal(read.status, 200);
  assert.equal(read.json.used.at(-1).line, `Enemy attack roll, d20 = 20 (${goblin.displayName})`);
  assert.deepEqual(read.json.script.queue, []);

  const cleared = await call("DELETE", testTable.campaignId);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.json.script, { seed: null, queue: [] });
  assert.equal(cleared.json.summary, "Ordinary dice: no seed and nothing forced.");
  assert.equal(scripts.getDiceScript(testTable.campaignId), null);

  // Someone who is not at the table is not told it exists.
  testTable.signIn(testTable.addUser("stranger"));
  const stranger = await call("GET", testTable.campaignId);
  assert.equal(stranger.status, 404);
  testTable.signIn(testTable.owner);
});

await test("a test table's script goes with the table", async () => {
  const doomed = campaigns.createCampaign(testTable.owner.id, {
    title: "Doomed test",
    description: "",
    theme: "high-fantasy",
    maxPlayers: 1,
    startingLevel: 1,
    difficulty: "normal",
    kind: "playtest",
    gameSettings: {},
  });
  assert.equal(scripts.setDiceScript(doomed.id, { seed: 3, queue: [] }), true);
  campaigns.deleteCampaign(doomed.id);
  const left = getDatabase().prepare(`SELECT COUNT(*) AS n FROM dice_scripts WHERE campaign_id = ?`).get(doomed.id).n;
  assert.equal(left, 0);
});

testTable.close();
live.close();
finish();
