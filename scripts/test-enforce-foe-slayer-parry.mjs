// Foe Slayer against a creature's defensive reaction. Parry and Shield turn a
// hit into a miss by raising the Armor Class it has to beat, so Foe Slayer's
// bonus has to reach the raised figure, on either dice path.
//
// The rules, from SRD 5.1:
//   - Foe Slayer: once on each of your turns, add your Wisdom modifier to the
//     attack roll or the damage roll of an attack against a favored enemy,
//     before any effects of the roll are applied.
//   - Parry (Bandit Captain): adds 2 to its AC against one melee attack that
//     would hit it.
//   - Shield: +5 to AC until the start of your next turn, against the
//     triggering attack too.
//   - Stroke of Luck: if your attack misses a target within range, you can
//     turn the miss into a hit.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-foe-slayer-parry");
const world = await openWorld({ gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

const ranger = (wis, subclass) => {
  const hero = world.addHero({
    class: "fighter", ...(subclass ? { subclass } : {}), level: 5, maxHp: 300, abilities: { str: 16, wis }, proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1 }],
  });
  // addHero keeps only what the class grants: a held feature goes on afterwards.
  world.patch(hero.id, { features: [...world.sheet(hero.id).features, { name: "Foe Slayer", description: "" }, { name: "Favored Enemy: humanoids", description: "" }] });
  return hero;
};
// Foe Slayer +1, which cannot reach a raised Armor Class from a 13.
const small = ranger(12);
// Foe Slayer +3, which reaches Parry's raise from a 13 and not Shield's.
const large = ranger(16);
// Foe Slayer +1 with a critical on a 19 or 20.
const champion = ranger(12, "champion");
const heroes = [small, large, champion];
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

const PARRY = "Reaction: Parry. The captain adds 2 to its AC against one melee attack that would hit it. To do so, the captain must see the attacker and be wielding a melee weapon.";
const SHIELD = { dc: 15, ability: "int", casterLevel: 9, spells: [{ name: "Shield", level: 1 }], slots: { 1: 3 } };

// The dummy is a humanoid at AC 13, and the longsword attacks at +6: a d20 of 7
// is a 13, a hit that Parry or Shield would turn, and a 6 is a near miss.
async function stage(hero, stats = {}, patch = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { features: made.features, resources: made.resources, currentHp: made.maxHp, conditions: [] });
  }
  await kit.fight(1, { heroFaces: Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2])) });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, stats, ...patch });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return kit.enemy(enemy.id);
}

const marks = () => world.encounter().turnBudget.oncePerTurn;
const reactionSpent = (enemy) => world.encounter().reactionsUsed.includes(enemy.id);

// ---- digital dice ----

await test("A parried hit Foe Slayer cannot lift past the raised AC stays a miss, and Foe Slayer stays unspent", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  const blow = await kit.swing(small.id, enemy.id, [7, 5], { weapon: "Longsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, false, JSON.stringify(blow.result));
  assert.equal(blow.damage, null, "a parried swing deals no damage");
  assert.ok(reactionSpent(enemy), "Parry spends the reaction");
  assert.ok(!marks().includes("foe-slayer"), JSON.stringify(marks()));
  // The bonus is still there for the turn's next attack (a fighter 5 has two),
  // which meets the plain AC: the reaction has gone.
  const next = await kit.swing(small.id, enemy.id, [7, 5], { weapon: "Longsword" });
  assert.equal(next.ok, true, next.error);
  assert.equal(next.result.hit, true, JSON.stringify(next.result));
  assert.ok((next.result.conditionEffects ?? []).some((line) => /Foe Slayer: \+1 damage/.test(line)), JSON.stringify(next.result.conditionEffects));
});

// The creature's reaction is decided once, against the best total the
// attacker can reach (the roll and an unspent Foe Slayer), and only a reaction
// that turns that total is taken (gap study wave 2, L819: "Decide the
// creature's reaction once from the best total the attacker can reach ...
// choosing the smaller reaction (Parry +2 before Shield +5) that still turns
// that total"). This used to pin a Parry spent on a total Foe Slayer then
// carried past it: the reaction went for nothing.
await test("A Foe Slayer bonus that would carry past Parry's raised AC draws no Parry, and the attack hits", async () => {
  const enemy = await stage(large, { traits: [PARRY] });
  const blow = await kit.swing(large.id, enemy.id, [7, 5], { weapon: "Longsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, true, JSON.stringify(blow.result));
  assert.ok(!reactionSpent(enemy), "no Parry is spent on a total it cannot turn");
  assert.ok(blow.damage, "the hit rolls damage");
});

await test("Shield's +5 holds against a Foe Slayer bonus that would have beaten Parry's +2", async () => {
  const enemy = await stage(large, { spellcasting: SHIELD });
  const blow = await kit.swing(large.id, enemy.id, [7, 5], { weapon: "Longsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, false, JSON.stringify(blow.result));
  assert.equal(blow.damage, null);
  assert.ok(kit.enemy(enemy.id).conditions.includes("shielded"), "the creature cast Shield");
  assert.ok(!marks().includes("foe-slayer"), JSON.stringify(marks()));
});

await test("A near miss with no reaction to meet it is still Foe Slayer's to rescue", async () => {
  const enemy = await stage(small);
  const blow = await kit.swing(small.id, enemy.id, [6, 5], { weapon: "Longsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, true, JSON.stringify(blow.result));
  assert.ok(marks().includes("foe-slayer"), JSON.stringify(marks()));
});

await test("A near miss Foe Slayer lifts to a hit meets the reaction too: a better roll never misses where a worse one hits", async () => {
  // Foe Slayer +1 reaches Parry's 15 from a 14, a d20 of 8, and +3 reaches
  // Shield's 18 from a 15, a d20 of 9. Below that every roll misses.
  for (const [hero, stats, first] of [[small, { traits: [PARRY] }, 8], [large, { spellcasting: SHIELD }, 9]]) {
    for (let face = 3; face <= 12; face += 1) {
      const enemy = await stage(hero, stats);
      const blow = await kit.swing(hero.id, enemy.id, [face, 5], { weapon: "Longsword" });
      assert.equal(blow.ok, true, blow.error);
      assert.equal(blow.result.hit, face >= first, `a d20 of ${face}: ${JSON.stringify(blow.result.conditionEffects)}`);
    }
  }
});

await test("A near miss that a reaction turns spends both the reaction and Foe Slayer, which cannot lift the turn's next attack", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  const blow = await kit.swing(small.id, enemy.id, [6, 5], { weapon: "Longsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, false, JSON.stringify(blow.result));
  assert.ok(reactionSpent(enemy), "Parry spends the reaction");
  assert.ok(marks().includes("foe-slayer"), JSON.stringify(marks()));
  assert.ok((blow.result.conditionEffects ?? []).some((line) => /Foe Slayer: \+1 lifted 12 to 13/.test(line)), JSON.stringify(blow.result.conditionEffects));
  const next = await kit.swing(small.id, enemy.id, [6, 5], { weapon: "Longsword" });
  assert.equal(next.ok, true, next.error);
  assert.equal(next.result.hit, false, JSON.stringify(next.result));
});

await test("A roll that misses even with Foe Slayer draws no reaction", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  const blow = await kit.swing(small.id, enemy.id, [5, 5], { weapon: "Longsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, false, JSON.stringify(blow.result));
  assert.ok(!reactionSpent(enemy), "the reaction stays");
});

await test("A natural 1 draws no reaction however large Foe Slayer's bonus", async () => {
  // A 7, which +3 would lift past AC 9.
  const enemy = await stage(large, { traits: [PARRY] }, { ac: 9 });
  const blow = await kit.swing(large.id, enemy.id, [1, 5], { weapon: "Longsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, false, JSON.stringify(blow.result));
  assert.ok(!reactionSpent(enemy), "the reaction stays");
});

await test("A critical hit draws no reaction, on a natural 20 and on a widened critical range", async () => {
  const enemy = await stage(small, { traits: [PARRY] }, { ac: 26 });
  const twenty = await kit.swing(small.id, enemy.id, [20, 5, 5], { weapon: "Longsword" });
  assert.equal(twenty.ok, true, twenty.error);
  assert.equal(twenty.result.crit, true, JSON.stringify(twenty.result));
  assert.ok(!reactionSpent(enemy), "the reaction stays");
  const other = await stage(champion, { traits: [PARRY] }, { ac: 25 });
  const nineteen = await kit.swing(champion.id, other.id, [19, 5, 5], { weapon: "Longsword" });
  assert.equal(nineteen.ok, true, nineteen.error);
  assert.equal(nineteen.result.crit, true, JSON.stringify(nineteen.result));
  assert.ok(!reactionSpent(other), "the reaction stays");
});

await test("A declared Stroke of Luck still turns a parried hit that Foe Slayer cannot save", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  world.patch(small.id, {
    features: [...base.get(small.id).features, { name: "Stroke of Luck", description: "" }],
    resources: { ...base.get(small.id).resources, stroke_of_luck: { max: 1, used: 0 } },
  });
  const blow = await kit.swing(small.id, enemy.id, [7, 5], { weapon: "Longsword", strokeOfLuck: true });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, true, JSON.stringify(blow.result));
  assert.equal(world.sheet(small.id).resources.stroke_of_luck.used, 1, "the use is spent");
  assert.ok(!marks().includes("foe-slayer"), "Stroke of Luck did the saving, not Foe Slayer");
});

// ---- physical dice ----

// One attack with the dice entered at the table. Returns the to-hit roll's note
// for the turn, and the damage roll it parked, if any.
async function tableSwing(hero, enemy, face) {
  setMemberRealDice(world.campaignId, hero.userId, true);
  try {
    // An earlier test's damage roll may still wait, unrolled, on its own fight.
    const earlier = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
    const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, weapon: "Longsword" });
    assert.equal(parked.ok, true, parked.error);
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === "attack" && !earlier.has(entry.id));
    assert.ok(pending, "the to-hit roll is parked");
    world.signIn({ id: hero.userId });
    const out = await call(submitRoute, "POST", { dice: [face] }, { campaignId: world.campaignId, pendingRollId: pending.id });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return {
      note: getPendingRoll(pending.id).combatNote ?? "",
      damage: listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === "damage" && !earlier.has(entry.id)) ?? null,
    };
  } finally {
    setMemberRealDice(world.campaignId, hero.userId, false);
  }
}

await test("With real dice, a parried hit Foe Slayer cannot lift past the raised AC stays a miss, and Foe Slayer stays unspent", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  const { note, damage } = await tableSwing(small, enemy, 7);
  assert.match(note, /MISS/, note);
  assert.equal(damage, null, note);
  assert.ok(reactionSpent(enemy), "Parry spends the reaction");
  assert.ok(!marks().includes("foe-slayer"), JSON.stringify(marks()));
});

// As on the server's dice above (L819): no Parry on a total it cannot turn.
await test("With real dice, a Foe Slayer bonus that would carry past Parry's raised AC draws no Parry, and the attack hits", async () => {
  const enemy = await stage(large, { traits: [PARRY] });
  const { note, damage } = await tableSwing(large, enemy, 7);
  assert.match(note, /HIT/, note);
  assert.ok(damage, note);
  assert.ok(!reactionSpent(enemy), note);
});

await test("With real dice, Shield's +5 holds against a Foe Slayer bonus that would have beaten Parry's +2", async () => {
  const enemy = await stage(large, { spellcasting: SHIELD });
  const { note, damage } = await tableSwing(large, enemy, 7);
  assert.match(note, /MISS/, note);
  assert.equal(damage, null, note);
  assert.ok(kit.enemy(enemy.id).conditions.includes("shielded"));
  assert.ok(!marks().includes("foe-slayer"), JSON.stringify(marks()));
});

await test("With real dice, a near miss with no reaction to meet it is still Foe Slayer's to rescue", async () => {
  const enemy = await stage(small);
  const { note, damage } = await tableSwing(small, enemy, 6);
  assert.match(note, /HIT/, note);
  assert.ok(damage, note);
  assert.ok(marks().includes("foe-slayer"), JSON.stringify(marks()));
});

await test("With real dice, a better roll never misses where a worse one hits", async () => {
  for (const [hero, stats, first] of [[small, { traits: [PARRY] }, 8], [large, { spellcasting: SHIELD }, 9]]) {
    for (let face = 3; face <= 12; face += 1) {
      const enemy = await stage(hero, stats);
      const { note, damage } = await tableSwing(hero, enemy, face);
      assert.equal(Boolean(damage), face >= first, `a d20 of ${face}: ${note}`);
    }
  }
});

await test("With real dice, a near miss that a reaction turns spends both the reaction and Foe Slayer, and the note says so", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  const { note, damage } = await tableSwing(small, enemy, 6);
  assert.match(note, /MISS/, note);
  assert.equal(damage, null, note);
  assert.ok(reactionSpent(enemy), "Parry spends the reaction");
  assert.ok(marks().includes("foe-slayer"), JSON.stringify(marks()));
  assert.match(note, /Foe Slayer: \+1 lifted 12 to 13/, note);
});

await test("With real dice, a natural 1 draws no reaction however large Foe Slayer's bonus", async () => {
  const enemy = await stage(large, { traits: [PARRY] }, { ac: 9 });
  const { note } = await tableSwing(large, enemy, 1);
  assert.match(note, /MISS/, note);
  assert.ok(!reactionSpent(enemy), "the reaction stays");
});

await test("With real dice, a critical hit draws no reaction, on a natural 20 and on a widened critical range", async () => {
  const enemy = await stage(small, { traits: [PARRY] }, { ac: 26 });
  const twenty = await tableSwing(small, enemy, 20);
  assert.match(twenty.note, /CRITICAL/, twenty.note);
  assert.ok(!reactionSpent(enemy), "the reaction stays");
  const other = await stage(champion, { traits: [PARRY] }, { ac: 25 });
  const nineteen = await tableSwing(champion, other, 19);
  assert.match(nineteen.note, /CRITICAL/, nineteen.note);
  assert.ok(!reactionSpent(other), "the reaction stays");
});

await test("With real dice, a turn whose budget has gone leaves a declared Stroke of Luck to do the saving", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  world.patch(small.id, {
    features: [...base.get(small.id).features, { name: "Stroke of Luck", description: "" }],
    resources: { ...base.get(small.id).resources, stroke_of_luck: { max: 1, used: 0 } },
  });
  setMemberRealDice(world.campaignId, small.userId, true);
  try {
    const earlier = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
    const parked = await world.invoke("pc_attack", { characterId: small.id, targetEnemyId: enemy.id, weapon: "Longsword", strokeOfLuck: true });
    assert.equal(parked.ok, true, parked.error);
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === "attack" && !earlier.has(entry.id));
    kit.saveEncounter({ ...world.encounter(), turnBudget: null });
    world.signIn({ id: small.userId });
    const out = await call(submitRoute, "POST", { dice: [6] }, { campaignId: world.campaignId, pendingRollId: pending.id });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    const note = getPendingRoll(pending.id).combatNote ?? "";
    assert.match(note, /Stroke of Luck: the miss becomes a hit/, note);
    assert.ok(!reactionSpent(enemy), "the spent bonus drew no reaction");
  } finally {
    setMemberRealDice(world.campaignId, small.userId, false);
  }
});

await test("With real dice, a roll that misses even with Foe Slayer draws no reaction", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  const { note } = await tableSwing(small, enemy, 5);
  assert.match(note, /MISS/, note);
  assert.ok(!reactionSpent(enemy), "the reaction stays");
});

await test("With real dice, a Foe Slayer an earlier part of the attack spent draws no reaction, and leaves a declared Stroke of Luck to do the saving", async () => {
  const enemy = await stage(small, { traits: [PARRY] });
  world.patch(small.id, {
    features: [...base.get(small.id).features, { name: "Stroke of Luck", description: "" }],
    resources: { ...base.get(small.id).resources, stroke_of_luck: { max: 1, used: 0 } },
  });
  setMemberRealDice(world.campaignId, small.userId, true);
  try {
    const earlier = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
    const part = { targetEnemyId: enemy.id, weapon: "Longsword", strokeOfLuck: true };
    const parked = await world.invoke("pc_attack", { characterId: small.id, attacks: [part, part] });
    assert.equal(parked.ok, true, parked.error);
    const open = () => listOpenPendingRolls(world.campaignId).filter((entry) => !earlier.has(entry.id));
    const answer = async (pending, face) => {
      world.signIn({ id: small.userId });
      const out = await call(submitRoute, "POST", { dice: [face] }, { campaignId: world.campaignId, pendingRollId: pending.id });
      assert.equal(out.status, 200, JSON.stringify(out.json));
      return getPendingRoll(pending.id).combatNote ?? "";
    };
    // The second part waits behind the first (pc-attack-parts.ts
    // afterToHitLanded): made once the first has landed with its damage.
    const [first, early] = open().filter((entry) => entry.kind === "attack");
    assert.ok(first && !early, "the second part is parked before the first has landed");
    // A 19 is past Parry's raise, so the first part leaves the reaction free
    // and spends Foe Slayer on its damage.
    await answer(first, 13);
    assert.ok(marks().includes("foe-slayer"), JSON.stringify(marks()));
    assert.ok(!reactionSpent(enemy), "the first part drew no reaction");
    const [blow] = open().filter((entry) => entry.kind === "damage" && entry.status === "pending");
    assert.ok(blow, "the first part's hit parks its damage");
    await answer(blow, 1);
    const [second] = open().filter((entry) => entry.kind === "attack" && entry.id !== first.id);
    assert.ok(second, "the second part was not made once the first had landed");
    // A 12: a near miss Foe Slayer could have lifted, had it not gone.
    const note = await answer(second, 6);
    assert.ok(!reactionSpent(enemy), `the spent bonus drew a reaction: ${note}`);
    assert.match(note, /Stroke of Luck: the miss becomes a hit/, note);
    assert.equal(world.sheet(small.id).resources.stroke_of_luck.used, 1, "the use is spent");
  } finally {
    setMemberRealDice(world.campaignId, small.userId, false);
  }
});

await kit.endFight();
world.close();
finish();
