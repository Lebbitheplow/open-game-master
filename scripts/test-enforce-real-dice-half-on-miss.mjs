// Acid Arrow's half damage on a miss, on real dice. SRD 5.1: "On a miss, the
// arrow splashes the target with acid for half as much of the initial damage and
// no damage at the end of its next turn." On the server's dice the miss rolls
// the damage and lands half (pc-attack-resolve.ts missDamage). At the table the
// player rolls those dice, and the server halves what they enter.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-real-dice-half-on-miss");
const world = await openWorld({ gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { patchEnemyHp } = await import("../src/lib/db/encounters.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getRoll } = await import("../src/lib/db/rolls.ts");
const { guardOutcomes, ruleClaims } = await import("../src/lib/dm/engine-boundary.ts");
const { pendingRollAnswer } = await import("../src/lib/dm/turn.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

// Spell attacks at +6, so a d20 of 7 is a 13 against the dummy's AC 13.
const mage = world.addHero({
  class: "wizard", level: 5, maxHp: 300, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 2: { max: 30, used: 0 }, 3: { max: 9, used: 0 } }, prepared: ["Acid Arrow"], known: [], cantrips: ["Fire Bolt"] },
});

const SHIELD = { dc: 15, ability: "int", casterLevel: 9, spells: [{ name: "Shield", level: 1 }], slots: { 1: 3 } };

async function stage(stats = {}, { realDice = true } = {}) {
  setMemberRealDice(world.campaignId, mage.userId, false);
  await kit.endFight();
  world.patch(mage.id, { currentHp: 300, conditions: [], conditionMeta: {} });
  await kit.fight(1, { heroFaces: { [mage.id]: 19 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, stats });
  kit.place(mage.id, 5, 5);
  kit.place(enemy.id, 5, 9);
  assert.equal(kit.current().characterId, mage.id);
  setMemberRealDice(world.campaignId, mage.userId, realDice);
  return kit.enemy(enemy.id);
}

async function land(pending, faces) {
  world.signIn({ id: mage.userId });
  const out = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  return getPendingRoll(pending.id).combatNote ?? "";
}

const open = (kind) => listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === kind);

// The to-hit roll entered at the table, leaving whatever it parks next.
async function cast(enemy, face, args = {}) {
  const parked = await world.invoke("pc_attack", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Acid Arrow", ...args });
  assert.equal(parked.ok, true, parked.error);
  const [pending] = open("attack");
  assert.ok(pending, "the to-hit roll is parked");
  return land(pending, [face]);
}

await test("With real dice, Acid Arrow's miss asks for its damage dice, and half of what they show lands", async () => {
  const enemy = await stage();
  const note = await cast(enemy, 2);
  assert.match(note, /rolled 8 vs AC 13: MISS/, note);
  assert.match(note, /half/, note);
  const [damage] = open("damage");
  assert.ok(damage, "the damage roll is parked");
  assert.equal(damage.expression, "4d4");
  assert.match(damage.detail, /half on a miss/);
  const landed = await land(damage, [4, 4, 4, 3]);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7, "half of 15, rounded down");
  assert.match(landed, /half of this 15 damage/, landed);
  assert.equal(open("damage").length, 0, "nothing is left to roll");
});

await test("With real dice, the GM may say the half that landed: the narration guard finds it, and not a figure no roll made", async () => {
  const enemy = await stage();
  const args = { characterId: mage.id, targetEnemyId: enemy.id, spell: "Acid Arrow" };
  await cast(enemy, 2);
  const [damage] = open("damage");
  await land(damage, [4, 4, 4, 3]);
  const landed = getPendingRoll(damage.id);
  const answer = pendingRollAnswer(landed, getRoll(landed.rollId));
  assert.equal(answer.damage, 7);
  const outcomes = guardOutcomes([
    { role: "system", content: "system prompt" },
    { role: "user", content: "[Hero | attempt] I loose the arrow." },
    { role: "assistant", content: "", tool_calls: [{ id: "call-0", type: "function", function: { name: "pc_attack", arguments: JSON.stringify(args) } }] },
    { role: "tool", tool_call_id: "call-0", content: JSON.stringify(answer) },
  ], null, "english");
  const says = (value) => ruleClaims([{ kind: "amount", value, of: "acid damage", quote: `${value} acid damage` }], outcomes);
  assert.deepEqual(says(7), []);
  assert.equal(says(99).length, 1);
});

await test("A roll that is not a half on a miss adds no figure to the GM's answer", async () => {
  const enemy = await stage();
  await cast(enemy, 12);
  const [damage] = open("damage");
  await land(damage, [4, 4, 4, 3]);
  const landed = getPendingRoll(damage.id);
  assert.equal(pendingRollAnswer(landed, getRoll(landed.rollId)).damage, undefined);
});

await test("With real dice, the miss leaves no second burn", async () => {
  const enemy = await stage();
  await cast(enemy, 2);
  await land(open("damage")[0], [1, 1, 1, 1]);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 2, "half of 4");
  assert.ok(!kit.enemy(enemy.id).conditions.includes("acid arrow"), "no burn to come");
});

await test("With real dice, the higher slot's dice are halved too", async () => {
  const enemy = await stage();
  await cast(enemy, 2, { level: 3 });
  const [damage] = open("damage");
  assert.equal(damage.expression, "5d4");
  await land(damage, [2, 2, 2, 2, 2]);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 5);
});

await test("With real dice, a hit from a Shield's raise turned to a miss still deals half", async () => {
  const enemy = await stage({ spellcasting: SHIELD });
  const note = await cast(enemy, 7);
  assert.match(note, /casts Shield/, note);
  assert.match(note, /MISS/, note);
  await land(open("damage")[0], [2, 2, 2, 2]);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 4);
});

await test("With real dice, Acid Arrow's hit still deals the whole damage and its burn", async () => {
  const enemy = await stage();
  const note = await cast(enemy, 12);
  assert.match(note, /HIT/, note);
  const [damage] = open("damage");
  assert.doesNotMatch(damage.detail, /half/);
  const landed = await land(damage, [4, 4, 4, 3]);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 15);
  assert.doesNotMatch(landed, /half/, landed);
  assert.ok(kit.enemy(enemy.id).conditions.includes("acid arrow"), "the burn waits");
});

// A natural 1 is a miss, and Acid Arrow's miss deals half: the maintainer's
// decision R1 of the 2026-11-09 gap sweep ("A natural 1 is a miss: it deals
// half"), overturning #825's rule call that it dealt nothing.
await test("With real dice, a natural 1 misses and still asks for the half a miss deals", async () => {
  const enemy = await stage();
  const note = await cast(enemy, 1);
  assert.match(note, /MISS/, note);
  assert.match(note, /half/, note);
  const [damage] = open("damage");
  assert.ok(damage, "the damage dice are asked for");
  await land(damage, [3, 3, 3, 3]);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 6, "half of 12");
});

await test("With real dice, another attack spell's miss still asks for nothing", async () => {
  const enemy = await stage();
  const note = await cast(enemy, 2, { spell: "Fire Bolt" });
  assert.match(note, /MISS/, note);
  assert.doesNotMatch(note, /half/, note);
  assert.equal(open("damage").length, 0);
});

await test("With real dice, a miss on a creature gone by then asks for nothing", async () => {
  const enemy = await stage();
  const parked = await world.invoke("pc_attack", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Acid Arrow" });
  assert.equal(parked.ok, true, parked.error);
  patchEnemyHp(enemy.id, 0, "dead");
  const note = await land(open("attack")[0], [2]);
  assert.match(note, /MISS/, note);
  assert.doesNotMatch(note, /half/, note);
  assert.equal(open("damage").length, 0);
});

await test("With real dice, half the damage meets the creature's resistance as a hit's would", async () => {
  const enemy = await stage({ resist: "acid" });
  await cast(enemy, 2);
  await land(open("damage")[0], [4, 4, 4, 4]);
  // Half of 16 is 8, and the resistance halves that.
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 4);
});

await test("A curse's die rides the half too, and only half of the whole total lands, on either dice", async () => {
  const cursed = () => ({ conditions: ["cursed (necrotic)"], conditionMeta: { "cursed (necrotic)": { source: mage.id } } });
  const real = await stage();
  kit.setEnemy(real.id, cursed());
  await cast(real, 2);
  const [damage] = open("damage");
  assert.equal(damage.expression, "4d4+1d8");
  await land(damage, [4, 4, 4, 4, 8]);
  assert.equal(kit.enemy(real.id).currentHp, 400 - 12, "half of 24");

  const server = await stage({}, { realDice: false });
  kit.setEnemy(server.id, cursed());
  await kit.swing(mage.id, server.id, [2, 4, 4, 4, 4, 8], { spell: "Acid Arrow" });
  assert.equal(kit.enemy(server.id).currentHp, 400 - 12, "half of 24");
});

await test("On the server's dice, Acid Arrow's miss lands the same half", async () => {
  const enemy = await stage({}, { realDice: false });
  const blow = await kit.swing(mage.id, enemy.id, [2, 4, 4, 4, 3], { spell: "Acid Arrow" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, false);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7);
});

await finish();
