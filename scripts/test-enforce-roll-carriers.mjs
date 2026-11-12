// A held roll carrier is spent by the roll it rides, on every roll path.
//
// SRD 5.1: a Bardic Inspiration die is added to one ability check, attack
// roll or saving throw and is then gone; the Help action gives advantage on
// the next ability check; Guidance adds a d4 to one ability check. ODM holds
// each as a condition on the sheet ("bardic inspiration (d8)", "helped",
// "guidance"), and resolveRollExpression folds it into the roll and names it
// in spendInspiration. The first repair spent it on request_roll and
// group_check; the other doors that roll a character's check or save rolled
// the die and kept the carrier, so one die rode every roll after it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-roll-carriers");
const world = await openWorld();

const profs = (skills = []) => ({
  saves: [], skills, expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [],
});
const INSPIRED = "bardic inspiration (d8)";
const hold = (id, condition = INSPIRED) => world.patch(id, { conditions: [condition], conditionMeta: {} });
const holds = (id, condition = INSPIRED) => world.sheet(id).conditions.includes(condition);
const d8Rolled = () => world.diceLog().some((die) => die.sides === 8);
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
// A held die is the holder's to add once the d20 is rolled (SRD 5.1, Bardic
// Inspiration: "can wait until after it rolls the d20 before deciding to use
// the Bardic Inspiration die"), so a roll it could carry waits on its player's
// card (src/lib/dm/character-roll.ts), and the player adds it: a natural 20
// keeps it, and a d20 one short of the DC takes the d8's 8 and spends it. It
// was added for them, unasked, before every check tool held its call for the
// card (the 2026-11-09 gap sweep, findings dice-afterroll-*).
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { call } = await import("./lib/enforce-campaign.mjs");
const afterRoll = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
async function addHeldDie(id) {
  const sheet = world.sheet(id);
  const card = listOpenPendingRolls(world.campaignId).find((pending) => pending.userId === sheet.userId && pending.thrown?.options.some((option) => option.id === "bardic"));
  assert.ok(card, "the roll the die could carry waits on its player");
  world.signIn({ id: sheet.userId });
  const added = await call(afterRoll, "POST", { use: "bardic" }, { campaignId: world.campaignId, pendingRollId: card.id });
  assert.equal(added.status, 200, JSON.stringify(added.json));
}
async function settles(id, run) {
  hold(id);
  world.dice(20);
  const passed = await run();
  world.clearDice();
  assert.equal(passed.ok, true, passed.error);
  assert.ok(holds(id), "a roll that passes keeps the die");
  const first = listRecentRolls(world.campaignId, 40)
    .filter((roll) => roll.characterId === id && roll.dc !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const face = first.dc - (first.total - 20) - 1;
  assert.ok(face >= 2 && face <= 19, `a d20 one short of DC ${first.dc} (${face})`);
  hold(id);
  world.diceLog();
  world.dice(face, 8);
  const carried = await run();
  assert.equal(carried.ok, true, carried.error);
  await addHeldDie(id);
  world.clearDice();
  assert.ok(d8Rolled(), "the inspiration die did not ride the check");
  assert.equal(holds(id), false, "the die is still held after the check it carried");
}

const bard = world.addHero({ class: "bard", level: 5, abilities: { cha: 16 }, proficiencies: profs(["persuasion", "medicine"]) });

await test("A Bardic Inspiration die held by a character is spent by the social_check it carries, and kept by one that passes.", async () => {
  // A won check warms the captain, which lowers the next DC: each throw
  // meets them indifferent.
  await settles(bard.id, async () => {
    await world.invoke("set_npc", { name: "Guard Captain", attitude: "indifferent" });
    return world.invoke("social_check", { characterId: bard.id, npc: "Guard Captain", approach: "persuade" });
  });
});

await test("A Bardic Inspiration die held by a character is spent by the haggling check it carries, and kept by one that passes.", async () => {
  // One try at each counter: each throw haggles at a stall of its own.
  let stall = 0;
  await settles(bard.id, async () => {
    stall += 1;
    const opened = await world.invoke("open_shop", { name: `Marla's Sundries ${stall}`, kind: "general", size: "town" });
    assert.equal(opened.ok, true, opened.error);
    return world.invoke("haggle", { characterId: bard.id, shop: `Marla's Sundries ${stall}` });
  });
});

await test("A Bardic Inspiration die held by a character is spent by the relationship beat's check it carries, and kept by one that passes.", async () => {
  await settles(bard.id, () => world.invoke("relationship_beat", { characterId: bard.id, subject: "Guard Captain", beat: "gift" }));
});

await test("A Bardic Inspiration die held by the healer is spent by the Medicine check it carries to stabilize a dying friend, and kept by one that passes.", async () => {
  const fallen = world.addHero({ class: "fighter", level: 5 });
  const down = () => world.patch(fallen.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
  await settles(bard.id, () => {
    down();
    return world.invoke("stabilize", { characterId: fallen.id, healerId: bard.id, method: "check" });
  });
});

await test("A Bardic Inspiration die held by a traveller is spent by the first forced-march save it rides.", async () => {
  const walker = world.addHero({ class: "fighter", level: 3 });
  hold(walker.id);
  world.diceLog();
  world.dice(15, 8, 15, 15, 15);
  await world.invoke("travel", { hours: 12, pace: "normal", characterIds: [walker.id] });
  if (listOpenPendingRolls(world.campaignId).some((pending) => pending.thrown)) {
    await addHeldDie(walker.id);
  }
  world.clearDice();
  assert.ok(d8Rolled());
  assert.equal(holds(walker.id), false);
});

await test("a held Help is spent by the social check it rides, and not by the one after", async () => {
  hold(bard.id, "helped");
  world.dice(3, 3);
  await world.invoke("social_check", { characterId: bard.id, npc: "Guard Captain", approach: "persuade" });
  world.clearDice();
  assert.equal(holds(bard.id, "helped"), false);
});

world.close();
finish();
