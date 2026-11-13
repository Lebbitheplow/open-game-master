// Who spends hit dice on a short rest, and what undoing a long rest gives
// back.
//
// SRD 5.1, Short Rest: "A character can spend one or more Hit Dice at the
// end of a short rest ... the player rolls the die and adds the character's
// Constitution modifier ... The player can decide to spend an additional Hit
// Die after each roll." Decision for ODM: the player chooses; the server's
// default (spend toward half HP) applies only to a character with no player
// connected. Long Rest: one in 24 hours; a long rest the lead undoes never
// happened, so it does not hold the 24 hours shut.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-rest-choice");
const world = await openWorld();
const { subscribe } = await import("../src/lib/events.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const player = world.addUser("rester");
const hero = world.addHero({ user: player, class: "fighter", level: 4, maxHp: 40, abilities: { con: 14 } });
const bench = world.addHero({ class: "fighter", level: 4, maxHp: 40, abilities: { con: 14 } });
const sheet = () => world.sheet(hero.id);

// The player is at the table: their events stream is open.
const leave = subscribe(world.campaignId, () => {}, player.id);

let hitDice = null;
async function spend(dice, user = player) {
  hitDice ??= await world.route("campaigns/[campaignId]/sheet/hit-dice").catch(() => null);
  if (!hitDice) {
    return { status: 404, body: { error: "no route" } };
  }
  world.signIn(user);
  const response = await hitDice.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ dice }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("After a short rest a connected player chooses their own hit dice: the rest spends none for them, and each die they ask for is rolled by the server and heals them.", async () => {
  world.patch(hero.id, { currentHp: 10, hitDice: { die: "d10", total: 4, spent: 0 } });
  world.patch(bench.id, { currentHp: 10, hitDice: { die: "d10", total: 4, spent: 0 } });
  world.dice(5, 5, 5, 5, 5, 5);
  const rested = await world.invoke("take_rest", { kind: "short" });
  world.clearDice();
  assert.equal(rested.ok, true, rested.error);
  assert.equal(sheet().hitDice.spent, 0, "the rest spent the player's hit dice for them");
  assert.ok(world.sheet(bench.id).hitDice.spent > 0, "the character with no player spent nothing");
  world.dice(6);
  let reply = await spend(1);
  assert.equal(reply.status, 200, reply.body.error);
  assert.equal(sheet().hitDice.spent, 1);
  assert.equal(sheet().currentHp, 10 + 6 + 2);
  world.dice(1);
  reply = await spend(1);
  assert.equal(reply.status, 200, reply.body.error);
  assert.equal(sheet().hitDice.spent, 2);
  assert.equal(sheet().currentHp, 18 + 1 + 2);
});

await test("Outside a short rest a player cannot spend hit dice: the choice closes when the clock moves on.", async () => {
  await world.invoke("pass_time", { amount: 10, unit: "minutes" });
  const before = sheet().hitDice.spent;
  const reply = await spend(1);
  assert.equal(reply.status, 409);
  assert.equal(sheet().hitDice.spent, before);
});

await test("the player's hit dice are rolled by the server, one roll record for each spend", () => {
  const rolls = getDatabase()
    .prepare(`SELECT requested_by FROM rolls WHERE character_id = ? AND detail LIKE 'short rest:%'`)
    .all(hero.id);
  assert.deepEqual(rolls.map((row) => row.requested_by), ["player", "player"]);
});

await test("Undoing a long rest gives back the 24 hours it started: the character may take a long rest again at once.", async () => {
  world.patch(hero.id, { currentHp: 20 });
  let rested = await world.invoke("take_rest", { kind: "long" });
  assert.deepEqual(rested.result.rested.includes(sheet().name), true);
  const entry = getDatabase()
    .prepare(`SELECT id FROM sheet_audit WHERE character_id = ? AND kind = 'rest_long' ORDER BY seq DESC LIMIT 1`)
    .get(hero.id);
  const undo = await world.route("campaigns/[campaignId]/audit/[entryId]/undo");
  world.signIn(world.owner);
  const response = await undo.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId, entryId: entry.id }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  world.patch(hero.id, { currentHp: 20 });
  rested = await world.invoke("take_rest", { kind: "long" });
  assert.equal(rested.result.rested.includes(sheet().name), true, `a second long rest after the undo: ${rested.result.unaffected}`);
  assert.equal(sheet().currentHp, sheet().maxHp);
});

await test("A short rest leaves out a hero who dies in the death saves its hour rolls: the dead are not among those who choose hit dice, and cannot spend any.", async () => {
  const mourner = world.addUser("mourner");
  const dying = world.addHero({ user: mourner, class: "rogue", level: 4, maxHp: 28 });
  const away = subscribe(world.campaignId, () => {}, mourner.id);
  world.patch(dying.id, {
    currentHp: 0,
    hitDice: { die: "d8", total: 4, spent: 0 },
    deathSaves: { successes: 0, failures: 2, stable: false, dead: false },
  });
  world.patch(hero.id, { currentHp: 10 });
  // The rest's first death save fails: the third failure, and she dies.
  world.dice(5);
  const rested = await world.invoke("take_rest", { kind: "short" });
  world.clearDice();
  assert.equal(rested.ok, true, rested.error);
  assert.equal(world.sheet(dying.id).deathSaves.dead, true, "the rest did not roll her last death save");
  const result = JSON.stringify(rested.result);
  const name = world.sheet(dying.id).name;
  assert.ok(JSON.stringify(rested.result.deathSaves).includes(name), `the rest tells of her death: ${result}`);
  assert.ok(rested.result.choosing?.includes(sheet().name), `the living player still chooses: ${result}`);
  assert.ok(!rested.result.choosing.includes(name), `the dead hero is among those choosing hit dice: ${result}`);
  assert.ok(!rested.result.choosingNote.includes(name), `the note asks the dead hero to choose hit dice: ${result}`);
  assert.ok(!JSON.stringify(rested.result.results).includes(name), `the hit dice results name the dead hero: ${result}`);
  const reply = await spend(1, mourner);
  assert.notEqual(reply.status, 200, "the dead hero spent a hit die");
  assert.equal(world.sheet(dying.id).hitDice.spent, 0);
  away();
});

// #932: the player says how many in chat; the AI passes it on inside the
// rest it just took, instead of resting again and rolling a d20 check.
await test("Inside the short rest just taken, the AI spends the hit dice the player named this turn, with no more time passing and nothing refilled again.", async () => {
  const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { handleTakeRest } = await import("../src/lib/dm/rest-tools.ts");
  const { getClock } = await import("../src/lib/db/clock.ts");
  world.patch(hero.id, { currentHp: 10, hitDice: { die: "d10", total: 4, spent: 0 } });
  const rested = await world.invoke("take_rest", { kind: "short" });
  assert.equal(rested.ok, true, rested.error);
  assert.ok(rested.result.choosing?.includes(sheet().name));
  assert.match(rested.result.choosingNote, /take_rest kind short with spend/);
  assert.match(rested.result.choosingNote, /Never request_roll a hit die/);
  const clock = getClock(world.campaignId).instant;
  const sheets = world.sheets();
  const byId = new Map(sheets.map((entry) => [entry.id, entry]));
  const call = JSON.stringify({ kind: "short", spend: [{ characterId: hero.id, dice: 1 }] });

  // No word from the player this turn: the count is theirs, so nothing is spent.
  world.say("dm", "The hour passes in the quiet of the ruin.");
  const unasked = handleTakeRest(world.campaign(), createDmTurn(world.campaignId, [], "ai").id, call, sheets, byId);
  assert.equal(unasked.retry, true, JSON.stringify(unasked));
  assert.match(unasked.error, /did not say this turn how many hit dice/);
  assert.equal(sheet().hitDice.spent, 0);

  world.say("player", "I spend 1 hit die", sheet());
  world.dice(7);
  const spent = handleTakeRest(world.campaign(), createDmTurn(world.campaignId, [], "ai").id, call, sheets, byId);
  world.clearDice();
  assert.equal(spent.ok, true, spent.error);
  assert.equal(spent.inTheRestJustTaken, true);
  assert.equal(sheet().hitDice.spent, 1, "the d10 was spent");
  assert.equal(sheet().currentHp, 10 + 7 + 2, "and healed: the face plus CON");
  assert.equal(getClock(world.campaignId).instant, clock, "no second hour passed");
  const roll = getDatabase().prepare(`SELECT detail, expression FROM rolls WHERE character_id = ? ORDER BY rowid DESC LIMIT 1`).get(hero.id);
  assert.match(roll.detail, /short rest: 1 hit die/);
  assert.match(roll.expression, /^1d10\b/, "a d10, never a d20");
});

await test("The AI's request_roll for a hit die is refused before anything is rolled, pointing at take_rest.", async () => {
  const { createDmTurn, getDmTurn } = await import("../src/lib/db/dm-turns.ts");
  const { handleRequestRoll } = await import("../src/lib/dm/invoke-roll.ts");
  const sheets = world.sheets();
  const turn = getDmTurn(createDmTurn(world.campaignId, [], "ai").id);
  const before = getDatabase().prepare(`SELECT COUNT(*) AS n FROM rolls`).get().n;
  const refused = handleRequestRoll(
    world.campaign(),
    turn,
    JSON.stringify({ kind: "custom", characterId: hero.id, expression: "1d20+1", reason: "Jason spends a hit die to heal" }),
    sheets,
    new Map(sheets.map((entry) => [entry.id, entry])),
    new Set(),
    { toolCallId: "call-1" },
  );
  assert.equal(refused.retry, true, JSON.stringify(refused));
  assert.match(refused.error, /through take_rest, never request_roll/);
  assert.equal(getDatabase().prepare(`SELECT COUNT(*) AS n FROM rolls`).get().n, before, "nothing was rolled");
});

leave();
world.close();
finish();
