// A casting out of a Ring of Spell Storing that holds several rays, darts or
// targets (Scorching Ray stored at 2nd: three rays; Hold Person stored at 3rd: two
// creatures) is one casting, as SRD 5.1 has it for a slot. The ring card shares
// them out (src/lib/battlemap/hand-ring.ts), and the cast guard keeps the rest of
// the casting open on the turn after the first call takes the ring's credit
// (src/lib/dm/cast-guard.ts openItemShares). The later calls once met a fighter's
// "cannot cast spells" and a wizard's own slot. A ring's attack-roll spell also
// names the dice of the level it was stored at (pc-attack-plan.ts).
import assert from "node:assert/strict";
import { clearDice, dice, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-hand-ring-shares");
const world = await openWorld({ campaign: { maxPlayers: 20 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
const { intentBody } = await import("../src/lib/battlemap/hand-play.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
const { intentRefusal } = await import("../src/lib/dm/intent-check.ts");
const { directContextFor } = await import("../src/lib/dm/direct-context.ts");
const { directCardCalls, parseMessageIntent } = await import("../src/lib/dm/intent-logic.ts");
const { getCampaignById, setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");

const RING = "Ring of Spell Storing";
const stored = (spell, level) => ({ spell, level, saveDc: 15, attackBonus: 7, abilityMod: 4, by: "Mage" });
const ring = (spells) => ({ name: RING, qty: 1, equipped: true, attuned: true, storedSpells: spells });

const brute = world.addHero({ name: "Brute", class: "fighter", level: 5, maxHp: 40, ac: 12, acOverride: true, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [] });
const wizard = world.addHero({
  name: "Wizard",
  class: "wizard",
  level: 9,
  maxHp: 40,
  ac: 12,
  acOverride: true,
  abilities: { int: 18 },
  equipment: [],
  spellcasting: { ability: "int", slots: { 2: { max: 3, used: 0 } }, known: [], prepared: ["Scorching Ray"], cantrips: [], spellbook: ["Scorching Ray"] },
});

async function stage(who, equipment, foes = 1) {
  await kit.endFight();
  world.patch(who.id, { equipment, currentHp: 40, conditions: [], conditionMeta: {}, concentratingOn: null });
  await kit.fight(foes, { heroFaces: { [who.id]: 20 } });
  const enemies = world.enemies();
  for (const [index, enemy] of enemies.entries()) {
    kit.setEnemy(enemy.id, { maxHp: 500, currentHp: 500 });
    kit.place(enemy.id, 9 + index, 5);
  }
  kit.place(who.id, 5, 5);
  kit.giveTurn(who.id);
  return world.enemies();
}

const aimAt = (enemy) => ({ id: enemy.id, name: enemy.displayName, kind: "enemy" });
const ringCard = (who) => deriveHand(world.sheet(who.id), turnFromEncounter(activePublicEncounter(world.campaignId), world.sheet(who.id), { myTurn: true })).find((card) => card.intent.item);

async function play(who, card, aim, choices = {}) {
  const intent = parseMessageIntent(intentBody(card, aim, [], choices));
  assert.equal(intentRefusal(getCampaignById(world.campaignId), world.sheet(who.id), intent), null);
  const calls = directCardCalls(intent, who.id, directContextFor(world.campaignId, intent, [], who.id));
  assert.ok(calls, "the engine takes the card whole");
  const results = [];
  for (const call of calls) results.push({ name: call.name, result: await world.invoke(call.name, call.args) });
  return results;
}

// One entry per ray or target of the call that resolved the casting.
const entries = ({ result: { result } }) => result.attacks ?? result.targets ?? [result];

for (const [who, label] of [[brute, "a fighter with no Spellcasting"], [wizard, "a wizard with the spell on their own list"]]) {
  await test(`Scorching Ray stored at 2nd throws all three rays for ${label}, at the ring's +7, and spends no slot`, async () => {
    const [goblin] = await stage(who, [ring([stored("Scorching Ray", 2)])]);
    const card = ringCard(who);
    assert.equal(card.shares?.count, 3, "the card offers the three rays");
    // Each ray: d20 15 (+7 is 22), then 2d6 of 6.
    dice(15, 6, 6, 15, 6, 6, 15, 6, 6);
    const results = await play(who, card, aimAt(goblin));
    clearDice();
    const rays = entries(results.at(-1));
    assert.equal(rays.length, 3);
    for (const ray of rays) {
      assert.notEqual(ray.ok, false, JSON.stringify(ray));
      assert.equal(ray.rolled, 22, "the stored caster's +7");
    }
    assert.equal(world.enemies()[0].currentHp, 500 - 36, "three rays of 12");
    if (who === wizard) assert.equal(world.sheet(who.id).spellcasting.slots["2"].used, 0, "no slot of their own");
  });
}

await test("Hold Person stored at 3rd holds both creatures the card names, the second taking nothing more", async () => {
  const [first, second] = await stage(brute, [ring([stored("Hold Person", 3)])], 2);
  const card = ringCard(brute);
  assert.equal(card.shares?.count, 2);
  dice(1, 1);
  const results = await play(brute, card, aimAt(first), { shares: [{ ...aimAt(second), count: 1 }] });
  clearDice();
  for (const target of entries(results.at(-1))) assert.notEqual(target.ok, false, JSON.stringify(target));
  assert.deepEqual(world.enemies().map((enemy) => enemy.conditions.includes("paralyzed")), [true, true]);
});

await test("A ring's Guiding Bolt stored at 2nd names the 5d6 it rolls, not its base level's 4d6, on both dice paths", async () => {
  const [goblin] = await stage(brute, [ring([stored("Guiding Bolt", 2)])]);
  dice(15, 6, 6, 6, 6, 6);
  const [, cast] = await play(brute, ringCard(brute), aimAt(goblin));
  clearDice();
  const notes = cast.result.result.conditionEffects ?? [];
  assert.equal(cast.result.result.damage, 30, "5d6 of 6");
  // The pack's words ("upcast to level 2: 5d6") or the bundled ones ("5d6 from a
  // level 2 slot"), never the base level's.
  assert.ok(notes.some((note) => /\b5d6\b/.test(note)), notes.join(" | "));
  assert.ok(!notes.some((note) => /\b4d6\b|base level/.test(note)), notes.join(" | "));

  const [again] = await stage(brute, [ring([stored("Guiding Bolt", 2)])]);
  setMemberRealDice(world.campaignId, brute.userId, true);
  try {
    const earlier = new Set(listOpenPendingRolls(world.campaignId).map((roll) => roll.id));
    await play(brute, ringCard(brute), aimAt(again));
    const parked = listOpenPendingRolls(world.campaignId).find((roll) => !earlier.has(roll.id) && roll.kind === "attack");
    assert.equal(parked.expression, "1d20+7");
    assert.equal(parked.attack.damageExpression, "5d6");
  } finally {
    setMemberRealDice(world.campaignId, brute.userId, false);
  }
});

await test("On real dice each ray of a ring's Scorching Ray is parked at the ring's +7", async () => {
  const [goblin] = await stage(brute, [ring([stored("Scorching Ray", 2)])]);
  setMemberRealDice(world.campaignId, brute.userId, true);
  try {
    const earlier = new Set(listOpenPendingRolls(world.campaignId).map((roll) => roll.id));
    const results = await play(brute, ringCard(brute), aimAt(goblin));
    for (const entry of entries(results.at(-1))) assert.notEqual(entry.ok, false, JSON.stringify(entry));
    // Each ray is parked once the one before it has landed (pc-attack-parts.ts
    // afterToHitLanded), as the server's dice make them in turn: a 1 on each
    // misses, and the next ray comes up at the ring's +7 too.
    const submit = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
    const seen = [];
    for (let ray = 0; ray < 3; ray += 1) {
      const open = listOpenPendingRolls(world.campaignId).filter((roll) => !earlier.has(roll.id) && roll.kind === "attack");
      assert.equal(open.length, 1, `ray ${ray + 1}: ${open.length} to-hit rolls open at once`);
      seen.push(open[0].expression);
      earlier.add(open[0].id);
      world.signIn({ id: brute.userId });
      const landed = await call(submit, "POST", { dice: [1] }, { campaignId: world.campaignId, pendingRollId: open[0].id });
      assert.equal(landed.status, 200, JSON.stringify(landed.json));
    }
    assert.deepEqual(seen, ["1d20+7", "1d20+7", "1d20+7"]);
  } finally {
    setMemberRealDice(world.campaignId, brute.userId, false);
  }
});

finish();
