// A short rest's hit dice are the player's own (issue 902).
//
// SRD 5.1, Short Rest: "For each Hit Die spent in this way, the player rolls
// the die and adds the character's Constitution modifier to it." A seat on
// physical dice is told it rolls its own dice (src/lib/dice/held-rolls.ts
// REAL_DICE_SCOPE), and the server rolled every hit die it spent: the button
// on the sheet rolled at once, and so did the GM's own spend for it.
//
// Held here:
//   - the sheet's route tells a seat on physical dice what its next hit die
//     rolls, and tells a seat on the server's dice nothing more than before;
//   - the faces that seat sends heal it, are on record as physical, and are
//     not thrown again on the stage;
//   - a spend that sends no faces is rolled by the server, for any seat;
//   - typed faces from a seat that is not on physical dice are refused, and a
//     roll that no longer fits what was asked for spends nothing;
//   - the Song of Rest die is in what the sheet asks for, and asking does not
//     spend it;
//   - a Chef's meal adds its die to a player's own spend, once a rest, as it
//     always did to the GM's;
//   - the GM at the console spending for a player who is at the table waits
//     for that player's dice, and the server rolls for one who is away.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-hit-dice-real-dice");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed" } });
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { listEventsSince, subscribe } = await import("../src/lib/events.ts");
const { getClock } = await import("../src/lib/db/clock.ts");
const hitDice = await world.route("campaigns/[campaignId]/sheet/hit-dice");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

const FIGHTER = { class: "fighter", level: 4, maxHp: 40, abilities: { con: 14 } };
// The GM's own character holds the first seat; the players are the rest.
world.addHero({ ...FIGHTER, name: "Gim" });
const roller = world.addUser("roller");
const tapper = world.addUser("tapper");
const absent = world.addUser("absent");
const hero = world.addHero({ ...FIGHTER, name: "Brakk", user: roller });
const digital = world.addHero({ ...FIGHTER, name: "Tam", user: tapper });
const away = world.addHero({ ...FIGHTER, name: "Ode", user: absent });
setMemberRealDice(world.campaignId, roller.id, true);
setMemberRealDice(world.campaignId, absent.id, true);
// At the table: their event streams are open. Ode's player is not.
const leaving = [subscribe(world.campaignId, () => {}, roller.id), subscribe(world.campaignId, () => {}, tapper.id)];

const params = { campaignId: world.campaignId };
const HEROES = [hero, digital, away];
const rollMark = () => new Set(listRecentRolls(world.campaignId, 60).map((roll) => roll.id));
const rollsSince = (mark) => listRecentRolls(world.campaignId, 60).filter((roll) => !mark.has(roll.id));
const lastSeq = () => listEventsSince(world.campaignId, 0, 5000).at(-1)?.seq ?? 0;
const announced = (seq, rollId) =>
  listEventsSince(world.campaignId, seq, 500).find((event) => event.type === "roll_result" && event.payload?.roll?.id === rollId)?.payload;

function hurt() {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  for (const one of HEROES) {
    world.patch(one.id, { currentHp: 10, hitDice: { die: "d10", total: 4, spent: 0 } });
  }
  world.clearDice();
}

// A short rest that leaves the players at the table choosing their own dice.
async function rest(spend) {
  hurt();
  const rested = await world.invoke("take_rest", { kind: "short", ...(spend ? { spend } : {}) });
  assert.equal(rested.ok, true, rested.error);
  return rested;
}

async function ask(user, sheet) {
  world.signIn(user);
  return call(hitDice, "GET", undefined, params, `http://test/?characterId=${sheet.id}`);
}

async function spend(user, sheet, faces) {
  world.signIn(user);
  return call(hitDice, "POST", { dice: 1, characterId: sheet.id, ...(faces ? { faces } : {}) }, params);
}

await test("the sheet tells a seat on physical dice what its next hit die rolls, and a seat on the server's dice only that the rest is open", async () => {
  await rest();
  const mine = await ask(roller, hero);
  assert.equal(mine.status, 200);
  assert.equal(mine.json.open, true);
  assert.deepEqual(mine.json.roll, { expression: "1d10+2", extras: [] }, "the die and Constitution's 2");
  const theirs = await ask(tapper, digital);
  assert.deepEqual(theirs.json, { open: true }, "a seat the server rolls for is asked for no dice");
});

await test("the die a player on physical dice enters heals them, is on record as theirs, and is not thrown again on the stage", async () => {
  await rest();
  const mark = rollMark();
  const seq = lastSeq();
  const reply = await spend(roller, hero, [7]);
  assert.equal(reply.status, 200, reply.json.error);
  assert.equal(reply.json.healed, 9, "7 on the d10 and Constitution's 2");
  assert.equal(world.sheet(hero.id).currentHp, 19);
  assert.equal(world.sheet(hero.id).hitDice.spent, 1);
  const rolls = rollsSince(mark);
  assert.equal(rolls.length, 1, `one roll on record, not ${rolls.length}`);
  assert.equal(rolls[0].total, 9);
  assert.equal(rolls[0].characterId, hero.id);
  assert.match(rolls[0].detail, /^short rest: 1 hit die \(physical\)$/);
  assert.equal(announced(seq, rolls[0].id)?.source, "physical", "the table was told to throw a die the player had already rolled");
});

await test("a spend that sends no dice is rolled by the server, for a seat on physical dice too", async () => {
  await rest();
  const mark = rollMark();
  const seq = lastSeq();
  world.dice(4);
  const reply = await spend(roller, hero);
  assert.equal(reply.status, 200, reply.json.error);
  assert.equal(world.sheet(hero.id).currentHp, 16, "4 on the server's d10 and 2");
  const [roll] = rollsSince(mark);
  assert.equal(roll.detail, "short rest: 1 hit die", "the server's die is marked physical");
  assert.equal(announced(seq, roll.id)?.source, "digital");
  // A die the screen marked for the server to draw is the same.
  world.dice(6);
  const drawn = await spend(roller, hero, ["digital"]);
  assert.equal(drawn.status, 200, drawn.json.error);
  assert.equal(world.sheet(hero.id).currentHp, 24, "6 on the server's d10 and 2");
});

await test("typed dice from a seat that is not on physical dice are refused, and nothing is spent", async () => {
  await rest();
  const reply = await spend(tapper, digital, [10]);
  assert.equal(reply.status, 403, JSON.stringify(reply.json));
  assert.match(reply.json.error, /rolled by the server/);
  assert.equal(world.sheet(digital.id).currentHp, 10);
  assert.equal(world.sheet(digital.id).hitDice.spent, 0);
});

await test("dice that do not fit the roll spend nothing: one die too many, and a face the die does not have", async () => {
  await rest();
  const many = await spend(roller, hero, [7, 3]);
  assert.equal(many.status, 409, JSON.stringify(many.json));
  assert.match(many.json.error, /1d10\+2/, "the refusal says what to roll now");
  const high = await spend(roller, hero, [11]);
  assert.equal(high.status, 400, JSON.stringify(high.json));
  assert.match(high.json.error, /1 to 10/);
  assert.equal(world.sheet(hero.id).currentHp, 10);
  assert.equal(world.sheet(hero.id).hitDice.spent, 0);
});

await test("the GM at the console spending for a player at the table waits for their dice; the server rolls for one who is away", async () => {
  hurt();
  const before = getClock(world.campaignId).instant;
  const mark = rollMark();
  world.dice(3);
  const rested = await world.invoke("take_rest", {
    kind: "short",
    spend: [{ characterId: away.id, dice: 1 }, { characterId: hero.id, dice: 2 }],
  });
  world.clearDice();
  assert.equal(rested.ok, true, rested.error);
  assert.equal(rested.result.parked, true, `the rest did not wait: ${JSON.stringify(rested.result).slice(0, 200)}`);
  const open = listOpenPendingRolls(world.campaignId);
  assert.equal(open.length, 1, "one card, for the player at the table");
  const [pending] = open;
  assert.equal(pending.userId, roller.id, "the card went to the wrong seat");
  assert.equal(pending.parkedFor, "real_dice");
  assert.equal(pending.expression, "2d10+4");
  assert.match(pending.detail, /short rest: 2 hit dice/);
  // Nothing of the rest stands while it waits.
  assert.equal(getClock(world.campaignId).instant, before, "the hour passed before the dice were in");
  assert.equal(world.sheet(hero.id).hitDice.spent, 0);
  assert.equal(world.sheet(away.id).hitDice.spent, 0);
  assert.equal(rollsSince(mark).length, 0, "a roll went on record before the rest could finish");

  world.signIn(roller);
  const seq = lastSeq();
  const landed = await call(submitRoute, "POST", { dice: [3, 4] }, { ...params, pendingRollId: pending.id });
  assert.equal(landed.status, 200, `the dice were not taken: ${JSON.stringify(landed.json).slice(0, 200)}`);
  assert.equal(world.sheet(hero.id).currentHp, 21, "3 and 4 on the d10s and 2 for each heal 11");
  assert.equal(world.sheet(hero.id).hitDice.spent, 2);
  assert.equal(world.sheet(away.id).currentHp, 15, "the server's 3 and 2 for the player who is away");
  assert.ok(getClock(world.campaignId).instant > before, "the rest never finished");
  const rolls = rollsSince(mark);
  assert.equal(rolls.length, 2, `one roll each, not ${rolls.length}: ${rolls.map((roll) => roll.detail).join("; ")}`);
  const mine = rolls.find((roll) => roll.characterId === hero.id);
  assert.match(mine.detail, /\(physical\)$/);
  assert.equal(announced(seq, mine.id)?.source, "physical");
  assert.equal(listOpenPendingRolls(world.campaignId).length, 0);
});

for (const leave of leaving) {
  leave();
}
world.close();

// ---- a song and a meal ---------------------------------------------------------

const camp = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed" } });
camp.addHero({ class: "bard", level: 2, maxHp: 15, name: "Lira" });
const guest = camp.addUser("guest");
const diner = camp.addUser("diner");
const sung = camp.addHero({ ...FIGHTER, name: "Brakk", user: guest });
const fed = camp.addHero({ ...FIGHTER, name: "Tam", user: diner });
setMemberRealDice(camp.campaignId, guest.id, true);
const campLeaving = [subscribe(camp.campaignId, () => {}, guest.id), subscribe(camp.campaignId, () => {}, diner.id)];
const campParams = { campaignId: camp.campaignId };

async function campRest() {
  for (const one of [sung, fed]) {
    camp.patch(one.id, { currentHp: 5, hitDice: { die: "d10", total: 4, spent: 0 } });
  }
  camp.clearDice();
  const rested = await camp.invoke("take_rest", { kind: "short" });
  assert.equal(rested.ok, true, rested.error);
}

await test("the Song of Rest die is in what the sheet asks for, asking does not spend it, and it rides one spend a rest", async () => {
  await campRest();
  camp.signIn(guest);
  const url = `http://test/?characterId=${sung.id}`;
  const first = await call(hitDice, "GET", undefined, campParams, url);
  assert.deepEqual(first.json.roll, { expression: "1d10+2+1d6", extras: [{ die: "d6", from: "Song of Rest" }] });
  const again = await call(hitDice, "GET", undefined, campParams, url);
  assert.equal(again.json.roll.expression, "1d10+2+1d6", "showing the song's die spent it");

  const reply = await call(hitDice, "POST", { dice: 1, characterId: sung.id, faces: [5, 3] }, campParams);
  assert.equal(reply.status, 200, reply.json.error);
  assert.equal(camp.sheet(sung.id).currentHp, 15, "5 on the d10, 2, and 3 on the song's d6");
  const next = await call(hitDice, "GET", undefined, campParams, url);
  assert.deepEqual(next.json.roll, { expression: "1d10+2", extras: [] }, "the song's die came round twice in one rest");
  // The faces of the roll as it was: the song's die is gone, so they no
  // longer fit, and nothing is spent on a guess.
  const stale = await call(hitDice, "POST", { dice: 1, characterId: sung.id, faces: [5, 3] }, campParams);
  assert.equal(stale.status, 409, JSON.stringify(stale.json));
  assert.equal(camp.sheet(sung.id).hitDice.spent, 1);
});

// "Who can hear your performance": the GM's spend leaves the song's die out
// for a deafened listener (rest-tools.ts hearsSong), and the player's own
// spend gave it to them all the same.
await test("a deafened player's own hit die hears no Song of Rest, as the GM's spend does not", async () => {
  await campRest();
  camp.patch(sung.id, { conditions: ["deafened"] });
  camp.signIn(guest);
  const asked = await call(hitDice, "GET", undefined, campParams, `http://test/?characterId=${sung.id}`);
  assert.deepEqual(asked.json.roll, { expression: "1d10+2", extras: [] }, "the sheet asked a deafened player for the song's die");
  const reply = await call(hitDice, "POST", { dice: 1, characterId: sung.id, faces: [5] }, campParams);
  assert.equal(reply.status, 200, reply.json.error);
  assert.equal(camp.sheet(sung.id).currentHp, 12, "5 on the d10 and 2, with no song");
  camp.patch(sung.id, { conditions: [] });
});

await test("a Chef's meal adds its die to a player's own hit dice, once a rest", async () => {
  camp.patch(camp.sheets()[0].id, { feats: ["Chef"] });
  await campRest();
  camp.signIn(diner);
  // The d10, the song's d6 and the meal's d8.
  camp.dice(5, 3, 8);
  const reply = await call(hitDice, "POST", { dice: 1, characterId: fed.id }, campParams);
  assert.equal(reply.status, 200, reply.json.error);
  assert.equal(camp.sheet(fed.id).currentHp, 5 + 5 + 2 + 3 + 8, "the meal's d8 was left out of the player's own spend");
  camp.dice(5);
  const second = await call(hitDice, "POST", { dice: 1, characterId: fed.id }, campParams);
  assert.equal(second.status, 200, second.json.error);
  assert.equal(camp.sheet(fed.id).currentHp, 23 + 5 + 2, "the meal's die came round twice in one rest");
});

for (const leave of campLeaving) {
  leave();
}
camp.close();
finish();
