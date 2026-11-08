// A creature's defensive reactions against an attack rolled on real dice, as
// the same attack on the server's dice meets them. The to-hit roll parks and
// lands later, and the parts of one attack park together, so what the creature
// has done since must count when the roll lands.
//
// The rules, from SRD 5.1:
//   - Shield: +5 to AC until the start of your next turn, against the
//     triggering attack too. It answers any attack, near or far.
//   - Parry (Bandit Captain): adds 2 to its AC against one melee attack that
//     would hit it. To do so, the captain must see the attacker.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-real-dice-reactions");
const world = await openWorld({ gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { resolvePcOpportunityAttacks } = await import("../src/lib/dm/opportunity.ts");
const { parkedTargetAc } = await import("../src/lib/dm/pc-attack-parked.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

// Attacks at +6 with the sword and the bow, so a d20 of 7 is a 13.
const fighter = world.addHero({
  class: "fighter", level: 5, maxHp: 300, abilities: { str: 16, dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }, { name: "Longbow", qty: 1 }],
});
// Fire Bolt at +6 too.
const mage = world.addHero({
  class: "wizard", level: 5, maxHp: 300, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
});
const slayer = (wis) => {
  const hero = world.addHero({
    class: "fighter", level: 5, maxHp: 300, abilities: { str: 16, wis }, proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1 }],
  });
  world.patch(hero.id, { features: [...world.sheet(hero.id).features, { name: "Foe Slayer", description: "" }, { name: "Favored Enemy: humanoids", description: "" }] });
  return hero;
};
const keen = slayer(12);
const strong = slayer(16);
const heroes = [fighter, mage, keen, strong];

const PARRY = "Reaction: Parry. The captain adds 2 to its AC against one melee attack that would hit it. To do so, the captain must see the attacker and be wielding a melee weapon.";
const SHIELD = { dc: 15, ability: "int", casterLevel: 9, spells: [{ name: "Shield", level: 1 }], slots: { 1: 3 } };

// The dummy is at AC 13, toe to toe with the hero unless the test moves it.
async function stage(hero, stats = {}, { count = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    world.patch(entry.id, { currentHp: 300, conditions: [], conditionMeta: {} });
  }
  await kit.fight(count, { heroFaces: Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2])) });
  const [enemy, ...others] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, stats });
  kit.place(hero.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return [kit.enemy(enemy.id), ...others];
}

const reactionSpent = (enemy) => world.encounter().reactionsUsed.includes(enemy.id);
const shieldUp = (enemy) => kit.enemy(enemy.id).conditions.includes("shielded");

async function withRealDice(hero, run) {
  setMemberRealDice(world.campaignId, hero.userId, true);
  try {
    return await run();
  } finally {
    setMemberRealDice(world.campaignId, hero.userId, false);
  }
}

async function land(hero, pending, faces) {
  world.signIn({ id: hero.userId });
  const out = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  return getPendingRoll(pending.id).combatNote ?? "";
}

// One attack, its to-hit roll entered at the table. Faces are the d20s it rolls.
async function tableSwing(hero, enemy, faces, args) {
  return withRealDice(hero, async () => {
    const earlier = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
    const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, ...args });
    assert.equal(parked.ok, true, parked.error);
    const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === "attack" && !earlier.has(entry.id));
    assert.ok(pending, "the to-hit roll is parked");
    return land(hero, pending, [faces].flat());
  });
}

// Two attacks declared in one call, whose to-hit rolls park together, each
// entered in turn. Returns both notes.
// `seen`: told the second part's parked roll, once its dice are entered.
async function twoParts(hero, enemy, firstFaces, secondFaces, args, between = () => {}, seen = () => {}) {
  return withRealDice(hero, async () => {
    const earlier = new Set(listOpenPendingRolls(world.campaignId).map((entry) => entry.id));
    const part = { targetEnemyId: enemy.id, ...args };
    const parked = await world.invoke("pc_attack", { characterId: hero.id, attacks: [part, part] });
    assert.equal(parked.ok, true, parked.error);
    const [first, second] = listOpenPendingRolls(world.campaignId).filter((entry) => entry.kind === "attack" && !earlier.has(entry.id));
    assert.ok(first && second, "both parts are parked");
    const firstNote = await land(hero, first, [firstFaces].flat());
    between();
    const secondNote = await land(hero, second, [secondFaces].flat());
    seen(second);
    return [firstNote, secondNote];
  });
}

// ---- a Shield that stands ----

await test("With real dice, a Shield the first part of an attack drew stands against the second part", async () => {
  const [enemy] = await stage(fighter, { spellcasting: SHIELD });
  const [first, second] = await twoParts(fighter, enemy, 7, 7, { weapon: "Longsword" });
  assert.match(first, /casts Shield/, first);
  assert.ok(shieldUp(enemy), "the creature cast Shield");
  assert.match(second, /rolled 13 vs AC 18: MISS/, second);
});

await test("With real dice, a roll that beats the standing Shield still hits", async () => {
  const [enemy] = await stage(fighter, { spellcasting: SHIELD });
  const [, second] = await twoParts(fighter, enemy, 7, 12, { weapon: "Longsword" });
  assert.match(second, /rolled 18 vs AC 18: HIT/, second);
});

await test("With real dice, the standing Shield adds to the cover the shot already had", async () => {
  const [enemy, between] = await stage(fighter, { spellcasting: SHIELD }, { count: 2 });
  kit.place(between.id, 5, 7);
  kit.place(enemy.id, 5, 9);
  // Half cover: AC 15, so a 15 draws Shield, and the next part meets 20.
  const [first, second] = await twoParts(fighter, enemy, 9, 9, { weapon: "Longbow" });
  assert.match(first, /casts Shield/, first);
  assert.match(second, /rolled 15 vs AC 20: MISS/, second);
});

await test("With real dice, Parry's raise is for one attack: the second part meets the plain AC", async () => {
  const [enemy] = await stage(fighter, { traits: [PARRY] });
  const [first, second] = await twoParts(fighter, enemy, 7, 7, { weapon: "Longsword" });
  assert.match(first, /MISS/, first);
  assert.match(second, /rolled 13 vs AC 13: HIT/, second);
});

await test("With real dice, a Bardic Inspiration die stays held when it could not beat the standing Shield", async () => {
  const [enemy] = await stage(fighter, { spellcasting: SHIELD });
  world.patch(fighter.id, { conditions: ["bardic inspiration (d4)"] });
  // A 12: the die could lift it past the plain AC 13, and not past 18.
  const [, second] = await twoParts(fighter, enemy, 7, 6, { weapon: "Longsword" });
  assert.match(second, /MISS/, second);
  assert.ok(world.sheet(fighter.id).conditions.includes("bardic inspiration (d4)"), "the die was not spent");
});

await test("With real dice, a Bardic Inspiration die still lifts a roll past a standing Shield it can reach", async () => {
  const [enemy] = await stage(fighter, { spellcasting: SHIELD });
  world.patch(fighter.id, { conditions: ["bardic inspiration (d4)"] });
  // A 16 against 18: a 4 on the die reaches it. The entered roll waits on the
  // player, who adds the die (after-roll-logic.ts afterAttackOptions).
  const choice = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
  let waiting = null;
  await twoParts(fighter, enemy, 7, 10, { weapon: "Longsword" }, () => {}, (pending) => {
    waiting = pending;
  });
  assert.deepEqual(getPendingRoll(waiting.id).thrown?.options.map((option) => option.id), ["bardic"], "the second roll waits on the die");
  world.signIn({ id: world.sheet(fighter.id).userId });
  world.dice(4);
  const spent = await call(choice, "POST", { use: "bardic" }, { campaignId: world.campaignId, pendingRollId: waiting.id });
  world.clearDice();
  assert.equal(spent.status, 200, JSON.stringify(spent.json));
  const second = getPendingRoll(waiting.id).combatNote ?? "";
  assert.match(second, /HIT/, second);
  assert.ok(!world.sheet(fighter.id).conditions.includes("bardic inspiration (d4)"), "the die was spent");
});

await test("With real dice, a change to the creature's AC after the roll parked counts both ways", async () => {
  const [enemy] = await stage(fighter);
  const [, second] = await twoParts(fighter, enemy, 15, 2, { weapon: "Longsword" }, () => kit.setEnemy(enemy.id, { ac: 8 }));
  assert.match(second, /rolled 8 vs AC 8: HIT/, second);
});

await test("With real dice, a Shield up before the roll parked counts once, and stops counting when it ends", async () => {
  const [enemy] = await stage(fighter, { spellcasting: SHIELD });
  kit.setEnemy(enemy.id, { conditions: ["shielded"] });
  const [first, second] = await twoParts(fighter, enemy, 11, 15, { weapon: "Longsword" }, () => kit.setEnemy(enemy.id, { conditions: [] }));
  assert.match(first, /rolled 17 vs AC 18: MISS/, first);
  assert.match(second, /rolled 21 vs AC 13: HIT/, second);
});

await test("With real dice, Foe Slayer's bonus has to reach a Shield an earlier part drew", async () => {
  for (const [face, hits] of [[9, true], [8, false]]) {
    const [enemy] = await stage(strong, { spellcasting: SHIELD });
    const [first, second] = await twoParts(strong, enemy, 7, face, { weapon: "Longsword" });
    assert.match(first, /casts Shield/, first);
    assert.match(second, hits ? /Foe Slayer: \+3 (to the attack roll )?turns the miss into a hit/ : /vs AC 18: MISS/, second);
  }
});

await test("With real dice, a reaction answers the AC as it stands when the roll lands", async () => {
  // A bare 8 against an AC fallen to 8: a hit, which Parry turns.
  const [enemy] = await stage(fighter, { traits: [PARRY] });
  const [, second] = await twoParts(fighter, enemy, 15, 2, { weapon: "Longsword" }, () => kit.setEnemy(enemy.id, { ac: 8 }));
  assert.match(second, /rolled 8 vs AC 8: MISS/, second);
  assert.ok(reactionSpent(enemy), "Parry answered the lowered AC");
  // A near miss of an AC fallen to 9: Foe Slayer lifts it to 9, which Parry turns.
  const [other] = await stage(keen, { traits: [PARRY] });
  const [, near] = await twoParts(keen, other, 2, 2, { weapon: "Longsword" }, () => kit.setEnemy(other.id, { ac: 9 }));
  assert.match(near, /vs AC 9: MISS/, near);
  assert.ok(reactionSpent(other), "Parry answered the lifted roll");
});

await test("A roll parked before the creature's own AC was recorded, or whose target has gone, keeps the AC it parked with", async () => {
  const [enemy] = await stage(fighter);
  kit.setEnemy(enemy.id, { ac: 8 });
  assert.equal(parkedTargetAc(world.campaignId, { targetAc: 15, targetEnemyId: enemy.id }), 15);
  assert.equal(parkedTargetAc(world.campaignId, { targetAc: 15, plainAc: 13, targetEnemyId: "no-such-creature" }), 15);
  assert.equal(parkedTargetAc(world.campaignId, { targetAc: 15, plainAc: 13, targetEnemyId: enemy.id }), 10, "the 2 of cover stays");
});

// ---- Shield at range ----

await test("With real dice, a shot at range draws Shield, as on the server's dice", async () => {
  const [enemy] = await stage(fighter, { spellcasting: SHIELD });
  kit.place(enemy.id, 5, 9);
  const note = await tableSwing(fighter, enemy, 7, { weapon: "Longbow" });
  assert.match(note, /MISS/, note);
  assert.match(note, /casts Shield/, note);
  assert.ok(shieldUp(enemy));
});

await test("With real dice, an attack spell at range draws Shield", async () => {
  const [enemy] = await stage(mage, { spellcasting: SHIELD });
  kit.place(enemy.id, 5, 9);
  const note = await tableSwing(mage, enemy, 7, { spell: "Fire Bolt" });
  assert.match(note, /MISS/, note);
  assert.ok(shieldUp(enemy));
});

await test("With real dice, a shot at range draws no Parry, which answers melee only", async () => {
  const [enemy] = await stage(fighter, { traits: [PARRY] });
  kit.place(enemy.id, 5, 9);
  const note = await tableSwing(fighter, enemy, 7, { weapon: "Longbow" });
  assert.match(note, /HIT/, note);
  assert.ok(!reactionSpent(enemy), "the reaction stays");
});

await test("With real dice, a shot Shield could not stop draws no Shield", async () => {
  const [enemy] = await stage(fighter, { spellcasting: SHIELD });
  kit.place(enemy.id, 5, 9);
  const note = await tableSwing(fighter, enemy, 12, { weapon: "Longbow" });
  assert.match(note, /HIT/, note);
  assert.ok(!reactionSpent(enemy) && !shieldUp(enemy));
});

// ---- an attacker the creature cannot see ----

// An unseen attacker rolls at advantage: two d20s.
for (const condition of ["invisible", "hidden"]) {
  await test(`With real dice, a hit by an attacker who is ${condition} draws no Parry, since the creature must see them`, async () => {
    const [enemy] = await stage(fighter, { traits: [PARRY] });
    world.patch(fighter.id, { conditions: [condition] });
    const note = await tableSwing(fighter, enemy, [7, 7], { weapon: "Longsword" });
    assert.match(note, /HIT/, note);
    assert.ok(!reactionSpent(enemy), "the reaction stays");
  });
}

for (const condition of ["invisible", "hidden"]) {
  await test(`On the server's dice, a hit by an attacker who is ${condition} draws no Parry`, async () => {
    const [enemy] = await stage(fighter, { traits: [PARRY] });
    world.patch(fighter.id, { conditions: [condition] });
    const blow = await kit.swing(fighter.id, enemy.id, [7, 7, 5], { weapon: "Longsword" });
    assert.equal(blow.ok, true, blow.error);
    assert.equal(blow.result.hit, true, JSON.stringify(blow.result));
    assert.ok(!reactionSpent(enemy), "the reaction stays");
  });
}

await test("A creature that sees the invisible still parries an invisible attacker, on either dice and on an opportunity attack", async () => {
  const seeing = async () => {
    const [enemy] = await stage(fighter, { traits: [PARRY] });
    world.patch(fighter.id, { conditions: ["invisible"] });
    kit.setEnemy(enemy.id, { conditions: ["see invisibility"] });
    return enemy;
  };
  // It sees them, so the attack has no advantage: one d20.
  const real = await seeing();
  const note = await tableSwing(fighter, real, 7, { weapon: "Longsword" });
  assert.match(note, /MISS/, note);
  assert.ok(reactionSpent(real), "real dice");
  const server = await seeing();
  const blow = await kit.swing(fighter.id, server.id, [7, 5], { weapon: "Longsword" });
  assert.equal(blow.result.hit, false, JSON.stringify(blow.result));
  assert.ok(reactionSpent(server), "the server's dice");
  const fleeing = await seeing();
  world.clearDice();
  world.dice(7);
  resolvePcOpportunityAttacks(world.campaign(), fleeing.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
  world.clearDice();
  assert.ok(reactionSpent(fleeing), "an opportunity attack");
});

await test("With real dice, a visible attacker's hit is still parried", async () => {
  const [enemy] = await stage(fighter, { traits: [PARRY] });
  const note = await tableSwing(fighter, enemy, 7, { weapon: "Longsword" });
  assert.match(note, /MISS/, note);
  assert.ok(reactionSpent(enemy));
});

await test("With real dice, an invisible attacker's hit still draws Shield, which needs no sight of them", async () => {
  const [enemy] = await stage(fighter, { spellcasting: SHIELD });
  world.patch(fighter.id, { conditions: ["invisible"] });
  const note = await tableSwing(fighter, enemy, [7, 7], { weapon: "Longsword" });
  assert.match(note, /MISS/, note);
  assert.ok(shieldUp(enemy));
});

await test("An invisible character's opportunity attack draws no Parry, and a visible one's is parried", async () => {
  for (const [conditions, faces, parried] of [[["invisible"], [7, 7, 5], false], [[], [7], true]]) {
    const [enemy] = await stage(fighter, { traits: [PARRY] });
    world.patch(fighter.id, { conditions });
    world.clearDice();
    world.dice(...faces);
    resolvePcOpportunityAttacks(world.campaign(), enemy.id, { x: 5, y: 6 }, { x: 5, y: 8 }, [{ x: 5, y: 7 }, { x: 5, y: 8 }]);
    world.clearDice();
    assert.equal(reactionSpent(enemy), parried, JSON.stringify(conditions));
  }
});

await kit.endFight();
world.close();
finish();
