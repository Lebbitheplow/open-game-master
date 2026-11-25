// What a PLAYER can do to their own counters, through the route their
// character sheet's buttons call:
// POST /api/campaigns/[campaignId]/sheet/usage.
//
// The rule (src/lib/dm/usage-rules.ts): a player SPENDS and never recovers.
// A used count goes up at the player's hand and comes down only at a rest,
// or as a correction by the DM or the party lead, who may name any sheet at
// the table. Held as tests:
//
//   a spend is stored; used is clamped into 0..max; a maximum cannot be
//   written; a malformed number is refused; a counter the sheet lacks cannot
//   be invented; a player reaches their own sheet and no other; nothing comes
//   back at a player's hand, in a fight or out of one; the lead corrects any
//   sheet; the dead spend nothing; a player spends no hit die here at all
//   (SRD 5.1: they are spent at the end of a short rest, which take_rest
//   runs); in a fight armor and attunement do not change, and a shield costs
//   the action.
//
// The first hero of a table belongs to its owner, who is the party lead, so
// every table here seats the lead first and tests a plain player after.
import assert from "node:assert/strict";
import { casting, openTable, postUsage, stored } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-usage-route");
const world = await openTable();

const fighterOf = (table, extra = {}) =>
  table.addHero({
    class: "fighter",
    level: 5,
    maxHp: 44,
    hitDice: { die: "d10", total: 5, spent: 0 },
    ...extra,
  });

async function refusedBy(table, id, body, status) {
  const before = stored(table, id);
  const response = await postUsage(table, id, body);
  if (status === "refused") {
    assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(body));
  } else {
    assert.equal(response.status, status, JSON.stringify(body));
  }
  assert.deepEqual(stored(table, id), before, `${JSON.stringify(body)} changed the sheet`);
}

await test("a player marks a use spent and the database holds it", async () => {
  const fighter = fighterOf(world);
  const response = await postUsage(world, fighter.id, { resources: { second_wind: 1 }, hitDiceSpent: 2 });
  assert.equal(response.status, 200, response.json.error);
  const sheet = world.sheet(fighter.id);
  assert.deepEqual(sheet.resources.second_wind, { max: 1, used: 1 });
  assert.deepEqual(sheet.resources.action_surge, { max: 1, used: 0 });
  assert.deepEqual(sheet.hitDice, { die: "d10", total: 5, spent: 2 });
});

await test("used is clamped to the maximum and the maximum never moves", async () => {
  const monk = world.addHero({ class: "monk", level: 4, hitDice: { die: "d8", total: 4, spent: 0 } });
  const response = await postUsage(world, monk.id, { resources: { ki: 200 } });
  assert.equal(response.status, 200, response.json.error);
  assert.deepEqual(world.sheet(monk.id).resources.ki, { max: 4, used: 4 });
  // The lead's correction of the hit dice is clamped the same way.
  const lead = await postAs(world, world.owner, { characterId: monk.id, hitDiceSpent: 20 });
  assert.equal(lead.status, 200, lead.json.error);
  assert.deepEqual(world.sheet(monk.id).hitDice, { die: "d8", total: 4, spent: 4 });
});

await test("a maximum, a negative, a fraction or an oversized number is refused", async () => {
  const monk = world.addHero({ class: "monk", level: 4 });
  for (const body of [
    { resources: { ki: { max: 99, used: 0 } } },
    { resources: { ki: -1 } },
    { resources: { ki: 1.5 } },
    { resources: { ki: 201 } },
    { resources: { ki: "0" } },
    { hitDiceSpent: -1 },
    { hitDiceSpent: 21 },
    { hitDiceSpent: 0.5 },
    { hitDice: { die: "d12", total: 20, spent: 0 } },
    { maxHp: 500 },
    {},
  ]) {
    await refusedBy(world, monk.id, body, 400);
  }
});

await test("a counter the sheet does not have cannot be invented", async () => {
  const fighter = fighterOf(world);
  await refusedBy(world, fighter.id, { resources: { rage: 0 } }, 400);
  await refusedBy(world, fighter.id, { resources: { lay_on_hands: 5 } }, 400);
  // No spellcasting, no slots.
  await refusedBy(world, fighter.id, { slots: { 1: 0 } }, 403);
  // Beside a real counter the invented one is dropped, not created.
  const mixed = await postUsage(world, fighter.id, { resources: { second_wind: 1, rage: 0 } });
  assert.equal(mixed.status, 200, mixed.json.error);
  assert.deepEqual(Object.keys(world.sheet(fighter.id).resources).sort(), ["action_surge", "second_wind"]);
});

await test("the route refuses a foreign sheet and unnamed usage still reaches the caller's sheet", async () => {
  const mine = fighterOf(world);
  const theirs = fighterOf(world);
  const before = stored(world, theirs.id);
  const response = await postUsage(world, mine.id, {
    characterId: theirs.id,
    resources: { second_wind: 1 },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(stored(world, theirs.id), before);
  assert.equal(world.sheet(mine.id).resources.second_wind.used, 0);
  const own = await postUsage(world, mine.id, { resources: { second_wind: 1 } });
  assert.equal(own.status, 200, own.json.error);
  assert.equal(own.json.sheet.id, mine.id);
  assert.equal(world.sheet(mine.id).resources.second_wind.used, 1);
});

await test("someone who is not at the table, or not signed in, changes nothing", async () => {
  const fighter = fighterOf(world);
  const before = stored(world, fighter.id);
  const route = await world.route("campaigns/[campaignId]/sheet/usage");
  const call = () =>
    route.POST(
      new Request("http://test/", { method: "POST", body: JSON.stringify({ resources: { second_wind: 1 } }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
  world.signIn(world.addUser("stranger"));
  assert.ok([403, 404].includes((await call()).status));
  globalThis.__odmTestToken = undefined;
  assert.equal((await call()).status, 401);
  assert.deepEqual(stored(world, fighter.id), before);
});

await test("in a fight nothing comes back: not a feature, not a slot, not a hit die", async () => {
  const table = await openTable();
  table.addHero({ class: "fighter", level: 1 });
  const fighter = fighterOf(table, { hitDice: { die: "d10", total: 5, spent: 3 } });
  const wizard = table.addHero({
    class: "wizard",
    level: 3,
    spellcasting: casting("int", { 1: [4, 4], 2: [2, 1] }),
  });
  table.patch(fighter.id, {
    resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 1 } },
  });
  await table.beginFight([{ monster: "goblin", count: 1 }]);
  await refusedBy(table, fighter.id, { resources: { second_wind: 0 } }, 409);
  await refusedBy(table, fighter.id, { hitDiceSpent: 2 }, 409);
  await refusedBy(table, wizard.id, { slots: { 1: 3 } }, 409);
  // One refill among honest spends refuses the whole request.
  await refusedBy(table, wizard.id, { slots: { 1: 3, 2: 2 } }, 409);
  // Spending is still bookkeeping, fight or no fight.
  const spent = await postUsage(table, wizard.id, { slots: { 2: 2 } });
  assert.equal(spent.status, 200, spent.json.error);
  assert.deepEqual(table.sheet(wizard.id).spellcasting.slots["2"], { max: 2, used: 2 });
});

// ---- a player never recovers ----

await test("a class feature comes back at its rest and never at the player's hand", async () => {
  const table = await openTable();
  table.addHero({ class: "fighter", level: 1 });
  const barbarian = table.addHero({ class: "barbarian", level: 3 });
  const paladin = table.addHero({ class: "paladin", level: 4 });
  for (let count = 0; count < 3; count += 1) {
    const rage = await table.invoke("use_resource", { characterId: barbarian.id, resource: "Rage" });
    assert.equal(rage.ok, true, rage.error);
    await table.invoke("pass_time", { amount: 1, unit: "minutes" });
  }
  // Hurt first: the pool pays only the hit points it restores (A03).
  table.patch(paladin.id, { currentHp: 5 });
  await table.invoke("use_resource", {
    characterId: paladin.id,
    resource: "Lay on Hands",
    amount: 20,
  });
  await refusedBy(table, barbarian.id, { resources: { rage: 0 } }, "refused");
  await refusedBy(table, paladin.id, { resources: { lay_on_hands: 0 } }, "refused");
  // One refill among honest spends refuses the whole request.
  await refusedBy(table, barbarian.id, { resources: { rage: 2 }, hitDiceSpent: 1 }, "refused");
});

await test("a player spends no hit die at the sheet: hit dice are spent at the end of a short rest, which the rest itself rolls", async () => {
  const table = await openTable();
  table.addHero({ class: "fighter", level: 1 });
  const fighter = fighterOf(table, { maxHp: 44 });
  table.patch(fighter.id, { currentHp: 10 });
  await refusedBy(table, fighter.id, { hitDiceSpent: 1 }, 409);
  const response = await postUsage(table, fighter.id, { hitDiceSpent: 2 });
  assert.match(response.json.error, /short rest/);
  // The rest spends them, with real rolls.
  table.clearDice();
  table.dice(5, 5);
  const rested = await table.invoke("take_rest", { kind: "short", spend: [{ characterId: fighter.id, dice: 2 }] });
  table.clearDice();
  assert.equal(rested.ok, true, rested.error);
  assert.equal(table.sheet(fighter.id).hitDice.spent, 2);
  assert.ok(table.sheet(fighter.id).currentHp > 10, "the dice healed nothing");
});

await test("spent hit dice come back at a long rest and never at the player's hand", async () => {
  const table = await openTable();
  table.addHero({ class: "fighter", level: 1 });
  const fighter = fighterOf(table, { hitDice: { die: "d10", total: 5, spent: 5 } });
  await refusedBy(table, fighter.id, { hitDiceSpent: 0 }, "refused");
  await refusedBy(table, fighter.id, { hitDiceSpent: 4 }, "refused");
});

// ---- who corrects ----

// The route as a named user calls it, for the lead and the DM.
async function postAs(table, user, body) {
  const route = await table.route("campaigns/[campaignId]/sheet/usage");
  table.signIn(user);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: table.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

await test("the party lead puts uses back, on their own sheet and on a named one, fight or no fight", async () => {
  const table = await openTable();
  const leader = fighterOf(table, { hitDice: { die: "d10", total: 5, spent: 4 } });
  const fighter = fighterOf(table, { hitDice: { die: "d10", total: 5, spent: 3 } });
  table.patch(leader.id, { resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 1 } } });
  table.patch(fighter.id, { resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 1 } } });

  const own = await postAs(table, table.owner, { resources: { second_wind: 0 } });
  assert.equal(own.status, 200, own.json.error);
  assert.equal(table.sheet(leader.id).resources.second_wind.used, 0);

  const named = await postAs(table, table.owner, {
    characterId: fighter.id,
    resources: { second_wind: 0 },
    hitDiceSpent: 1,
  });
  assert.equal(named.status, 200, named.json.error);
  assert.equal(named.json.sheet.id, fighter.id);
  assert.equal(table.sheet(fighter.id).resources.second_wind.used, 0);
  assert.equal(table.sheet(fighter.id).hitDice.spent, 1);
  // The lead's own sheet was not the one written.
  assert.equal(table.sheet(leader.id).hitDice.spent, 4);

  await table.beginFight([{ monster: "goblin", count: 1 }]);
  const inFight = await postAs(table, table.owner, {
    characterId: fighter.id,
    resources: { action_surge: 0 },
  });
  assert.equal(inFight.status, 200, inFight.json.error);
  assert.equal(table.sheet(fighter.id).resources.action_surge.used, 0);
});

await test("a correction cannot store more used than the maximum, or reach another table", async () => {
  const table = await openTable();
  fighterOf(table);
  const fighter = fighterOf(table);
  const over = await postAs(table, table.owner, { characterId: fighter.id, resources: { second_wind: 9 } });
  assert.equal(over.status, 200, over.json.error);
  assert.deepEqual(table.sheet(fighter.id).resources.second_wind, { max: 1, used: 1 });

  const elsewhere = await openTable();
  const stranger = fighterOf(elsewhere);
  const before = stored(elsewhere, stranger.id);
  const reached = await postAs(table, table.owner, { characterId: stranger.id, resources: { second_wind: 1 } });
  assert.equal(reached.status, 404);
  assert.deepEqual(stored(elsewhere, stranger.id), before);
});

await test("the DM, who plays no character, corrects a named sheet", async () => {
  const table = await openTable({ gameSettings: { dmMode: "human" } });
  const campaigns = await import("../src/lib/db/campaigns.ts");
  fighterOf(table);
  const fighter = fighterOf(table);
  table.patch(fighter.id, { resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 0 } } });
  const dm = table.addUser("dm");
  table.addHero({ class: "fighter", level: 1, user: dm });
  assert.equal(campaigns.setHumanDm(table.campaignId, dm.id), true);
  const out = await postAs(table, dm, { characterId: fighter.id, resources: { second_wind: 0 } });
  assert.equal(out.status, 200, out.json.error);
  assert.equal(table.sheet(fighter.id).resources.second_wind.used, 0);
});

// ---- the dead, and the fight's own clock ----

await test("a dead character's player spends nothing and changes no gear", async () => {
  const table = await openTable();
  fighterOf(table);
  const fighter = fighterOf(table, { equipment: [{ name: "Shield", qty: 1, equipped: false }, { name: "Longsword", qty: 1, equipped: true }] });
  table.patch(fighter.id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  await refusedBy(table, fighter.id, { resources: { second_wind: 1 } }, "refused");
  await refusedBy(table, fighter.id, { hitDiceSpent: 1 }, "refused");
  await refusedBy(table, fighter.id, { gear: { Shield: { equipped: true } } }, "refused");
});

await test("in a fight hit dice are not spent, armor does not change and nothing is attuned", async () => {
  const table = await openTable();
  fighterOf(table);
  const fighter = fighterOf(table, {
    acOverride: false,
    equipment: [
      { name: "Plate", qty: 1, equipped: false },
      { name: "Leather", qty: 1, equipped: true },
      { name: "Ring of Protection", qty: 1 },
      { name: "Longsword", qty: 1, equipped: false },
    ],
  });
  await table.beginFight([{ monster: "goblin", count: 1 }]);
  await refusedBy(table, fighter.id, { hitDiceSpent: 1 }, "refused");
  await refusedBy(table, fighter.id, { gear: { Plate: { equipped: true } } }, "refused");
  await refusedBy(table, fighter.id, { gear: { Leather: { equipped: false } } }, "refused");
  await refusedBy(table, fighter.id, { gear: { "Ring of Protection": { attuned: true } } }, "refused");
  // A weapon is drawn with the turn's free object interaction, so on the
  // character's own turn (issue #424); off it, nothing is drawn or charged.
  // scripts/test-enforce-handle-item.mjs draws on the character's turn.
  await refusedBy(table, fighter.id, { gear: { Longsword: { equipped: true } } }, "refused");
  assert.equal(table.sheet(fighter.id).equipment.find((item) => item.name === "Longsword").equipped, false);
  assert.equal(table.encounter().turnBudget, null);
});

await test("in a fight a shield goes on for the action, on the character's own turn", async () => {
  const table = await openTable();
  const first = fighterOf(table, {
    equipment: [{ name: "Shield", qty: 1, equipped: false }, { name: "Longsword", qty: 1, equipped: true }],
  });
  const second = fighterOf(table, {
    equipment: [{ name: "Shield", qty: 1, equipped: false }, { name: "Longsword", qty: 1, equipped: true }],
  });
  await table.beginFight([{ monster: "goblin", count: 1 }], {
    heroFaces: { [first.id]: 20, [second.id]: 5 },
  });
  // Not their turn: refused, nothing worn, nothing charged.
  await refusedBy(table, second.id, { gear: { Shield: { equipped: true } } }, "refused");
  assert.equal(table.encounter().turnBudget, null);

  const on = await postUsage(table, first.id, { gear: { Shield: { equipped: true } } });
  assert.equal(on.status, 200, on.json.error);
  assert.equal(table.sheet(first.id).equipment.find((item) => item.name === "Shield").equipped, true);
  assert.equal(table.encounter().turnBudget.ownerId, first.id);
  assert.equal(table.encounter().turnBudget.actionUsed, true);
  // The action is gone, so the shield stays where it is this turn.
  await refusedBy(table, first.id, { gear: { Shield: { equipped: false } } }, "refused");
});

await test("out of a fight gear changes freely", async () => {
  const table = await openTable();
  fighterOf(table);
  const fighter = fighterOf(table, {
    equipment: [{ name: "Plate", qty: 1, equipped: false }, { name: "Ring of Protection", qty: 1 }],
  });
  const out = await postUsage(table, fighter.id, {
    gear: { Plate: { equipped: true }, "Ring of Protection": { attuned: true } },
  });
  assert.equal(out.status, 200, out.json.error);
  // Attuning takes a short rest spent with the item: the ring waits for it.
  assert.equal(table.sheet(fighter.id).equipment.find((item) => item.name === "Ring of Protection").attuning, true);
  assert.equal((await table.invoke("take_rest", { kind: "short" })).ok, true);
  const gear = Object.fromEntries(table.sheet(fighter.id).equipment.map((item) => [item.name, item]));
  assert.equal(gear.Plate.equipped, true);
  assert.equal(gear["Ring of Protection"].attuned, true);
});

// Issue 1105. A two-weapon fighter on the road, a scimitar and a shortsword
// in hand by the engine's own pick, dragged a dagger onto "In hand": the
// shortsword was put away unasked, and dragging it back was refused with
// "putting one away takes your object interaction this turn" in no fight at
// all. Full hands now ask which weapon goes back in the pack wherever the
// change costs nothing, and the answer is one request.
const TWIN_PACK = () => [{ name: "Leather Armor", qty: 1 }, { name: "Scimitar", qty: 1 }, { name: "Shortsword", qty: 1 }, { name: "Dagger", qty: 1 }];
const heldBy = (table, id) => table.sheet(id).equipment.filter((item) => item.equipped === true).map((item) => item.name);
const guessedOn = (table, id) => table.sheet(id).equipment.filter((item) => item.heldGuess).map((item) => item.name);
const OLD_WORDS = /object interaction|this turn|Dropping/;

await test("out of a fight a third weapon asks which one to put away: nothing is put away unasked, the answer is taken, and the way back asks again", async () => {
  const table = await openTable({ heldDefault: true });
  fighterOf(table);
  const jason = fighterOf(table, { name: "Jason", proficiencies: TRAINED, equipment: TWIN_PACK() });
  assert.deepEqual(heldBy(table, jason.id), ["Leather Armor", "Scimitar", "Shortsword"], "the engine's pick: both light blades");
  assert.deepEqual(guessedOn(table, jason.id), ["Scimitar", "Shortsword", "Dagger"]);

  // The dagger dropped onto In hand: asked, with the sheet as it was.
  const before = stored(table, jason.id);
  const dagger = await postUsage(table, jason.id, { gear: { Dagger: { equipped: true } } });
  assert.equal(dagger.status, 409);
  assert.deepEqual(dagger.json.handsFull, { item: "Dagger", holding: ["Scimitar", "Shortsword"], swaps: [["Scimitar"], ["Shortsword"]] });
  assert.equal(dagger.json.error, "Jason's hands are full (Scimitar and Shortsword), so Dagger cannot be drawn yet. Put one of them away first: out of a fight that costs nothing.");
  assert.deepEqual(stored(table, jason.id), before, "asking put nothing away");

  // "Put away Shortsword, take up Dagger".
  const chosen = await postUsage(table, jason.id, { gear: { Shortsword: { equipped: false }, Dagger: { equipped: true } } });
  assert.equal(chosen.status, 200, chosen.json.error);
  assert.deepEqual(heldBy(table, jason.id), ["Leather Armor", "Scimitar", "Dagger"]);
  assert.deepEqual(guessedOn(table, jason.id), [], "the player's choice ends the guess");

  // The shortsword dragged back: asked again, and never told of a turn.
  const back = await postUsage(table, jason.id, { gear: { Shortsword: { equipped: true } } });
  assert.equal(back.status, 409);
  assert.deepEqual(back.json.handsFull, { item: "Shortsword", holding: ["Scimitar", "Dagger"], swaps: [["Scimitar"], ["Dagger"]] });
  assert.doesNotMatch(back.json.error, OLD_WORDS);
  assert.match(back.json.error, /out of a fight that costs nothing/);
  const returned = await postUsage(table, jason.id, { gear: { Dagger: { equipped: false }, Shortsword: { equipped: true } } });
  assert.equal(returned.status, 200, returned.json.error);
  assert.deepEqual(heldBy(table, jason.id), ["Leather Armor", "Scimitar", "Shortsword"]);
});

await test("where there is nothing to choose the first change still goes through unasked: both guessed blades for a two-handed weapon, and it says so", async () => {
  const table = await openTable({ heldDefault: true });
  fighterOf(table);
  const bran = fighterOf(table, { name: "Bran", proficiencies: TRAINED, equipment: [...TWIN_PACK(), { name: "Greatsword", qty: 1 }] });
  assert.deepEqual(heldBy(table, bran.id), ["Leather Armor", "Scimitar", "Shortsword"]);
  const great = await postUsage(table, bran.id, { gear: { Greatsword: { equipped: true } } });
  assert.equal(great.status, 200, great.json.error);
  assert.match(great.json.note, /Bran puts away Scimitar and Shortsword and takes up Greatsword, free/);
  assert.deepEqual(heldBy(table, bran.id), ["Leather Armor", "Greatsword"]);
  // The greatsword fills both hands, so a dagger has one thing to take the
  // place of: still asked, as the guess is over and nothing is automatic.
  const dagger = await postUsage(table, bran.id, { gear: { Dagger: { equipped: true } } });
  assert.equal(dagger.status, 409);
  assert.deepEqual(dagger.json.handsFull, { item: "Dagger", holding: ["Greatsword"], swaps: [["Greatsword"]] });
});

await test("out of a fight a shield in the way is not offered: the refusal says it costs nothing and carries no choice", async () => {
  const table = await openTable();
  fighterOf(table);
  const kara = fighterOf(table, {
    name: "Kara",
    equipment: [{ name: "Shield", qty: 1, equipped: true }, { name: "Longsword", qty: 1, equipped: true }, { name: "Greatsword", qty: 1, equipped: false }],
  });
  const great = await postUsage(table, kara.id, { gear: { Greatsword: { equipped: true } } });
  assert.equal(great.status, 409);
  assert.equal(great.json.handsFull, undefined);
  assert.doesNotMatch(great.json.error, OLD_WORDS);
  assert.match(great.json.error, /hands are full \(Shield and Longsword\), so Greatsword cannot be drawn yet\. Put one of them away first: out of a fight that costs nothing\./);
});

await test("in a fight the question is asked only while the hands are the engine's guess, its answer is free, and after it the turn's rule holds as before", async () => {
  const table = await openTable({ heldDefault: true });
  fighterOf(table);
  const kara = fighterOf(table, { name: "Kara", proficiencies: TRAINED, equipment: TWIN_PACK() });
  await table.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [kara.id]: 20 } });
  assert.deepEqual(heldBy(table, kara.id), ["Leather Armor", "Scimitar", "Shortsword"]);
  assert.deepEqual(guessedOn(table, kara.id), ["Scimitar", "Shortsword", "Dagger"]);

  const dagger = await postUsage(table, kara.id, { gear: { Dagger: { equipped: true } } });
  assert.equal(dagger.status, 409);
  assert.deepEqual(dagger.json.handsFull, { item: "Dagger", holding: ["Scimitar", "Shortsword"], swaps: [["Scimitar"], ["Shortsword"]] });
  assert.match(dagger.json.error, /Put one of them away first: nobody had said which weapon was out, so this first change costs nothing\./);
  assert.deepEqual(heldBy(table, kara.id), ["Leather Armor", "Scimitar", "Shortsword"]);
  assert.equal(table.encounter().turnBudget, null, "asking spent nothing");

  const chosen = await postUsage(table, kara.id, { gear: { Scimitar: { equipped: false }, Dagger: { equipped: true } } });
  assert.equal(chosen.status, 200, chosen.json.error);
  assert.deepEqual(heldBy(table, kara.id), ["Leather Armor", "Shortsword", "Dagger"]);
  assert.deepEqual(guessedOn(table, kara.id), []);
  assert.equal(table.encounter().turnBudget?.interaction, undefined, "the first change from the game's pick is free");
  assert.ok(!table.encounter().turnBudget?.actionUsed);

  // The guess is over: full hands are refused in the Hand's words, to the
  // letter, with nothing offered and nothing changed.
  const scimitar = await postUsage(table, kara.id, { gear: { Scimitar: { equipped: true } } });
  assert.equal(scimitar.status, 409);
  assert.equal(scimitar.json.error, "Kara's hands are full (Shortsword and Dagger), so Scimitar cannot be drawn yet. Dropping one is free; putting one away takes your object interaction this turn.");
  assert.deepEqual(scimitar.json.handsFull, { item: "Scimitar", holding: ["Shortsword", "Dagger"], swaps: [] });
  assert.deepEqual(heldBy(table, kara.id), ["Leather Armor", "Shortsword", "Dagger"]);
  // And a swap sent anyway costs what two changes cost: the interaction and the action.
  const paid = await postUsage(table, kara.id, { gear: { Dagger: { equipped: false }, Scimitar: { equipped: true } } });
  assert.equal(paid.status, 200, paid.json.error);
  assert.ok(table.encounter().turnBudget.interaction, "the interaction went on the first");
  assert.equal(table.encounter().turnBudget.actionUsed, true, "and the Use an Object action on the second");
});

world.close();
finish();
