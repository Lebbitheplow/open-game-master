// Great Weapon Master and Tavern Brawler with the dice entered at the table: a
// blow rolled on real dice opens what the same blow on the server's dice opens,
// once its damage has landed and the kill is known.
//
// The rules, as the digital path keeps them (src/lib/dm/pc-attack-resolve.ts):
//   - Great Weapon Master: a melee weapon critical hit, or a kill with one,
//     opens a melee weapon attack as a bonus action this turn.
//   - Tavern Brawler: a hit with an unarmed strike or an improvised weapon
//     opens a grapple as a bonus action this turn.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-physical-feat-bonus");
const world = await openWorld({ gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

const GWM = "great weapon master";
const TAVERN = "tavern brawler:hit";

const greatWeapon = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 14 }, proficiencies: TRAINED,
  equipment: [{ name: "Greatsword", qty: 1 }, { name: "Longbow", qty: 1 }, { name: "Handaxe", qty: 1 }],
  feats: ["Great Weapon Master"],
});
const mage = world.addHero({
  class: "wizard", level: 5, maxHp: 44, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Shocking Grasp"] },
  feats: ["Great Weapon Master"],
});
const brawler = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  feats: ["Tavern Brawler"],
});
const plain = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Greatsword", qty: 1 }],
});
// A monk's unarmed strike rolls a die, which a plain one has none of to enter.
const monk = world.addHero({
  class: "monk", level: 5, maxHp: 44, abilities: { dex: 16, wis: 14 }, proficiencies: TRAINED,
});
const heroes = [greatWeapon, brawler, plain, mage, monk];

async function stage(hero, { count = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    world.patch(entry.id, { currentHp: 44, conditions: [] });
  }
  await kit.fight(count, { heroFaces: Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2])) });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400 });
  }
  kit.place(hero.id, 5, 5);
  kit.place(enemies[0].id, 5, 6);
  assert.equal(kit.current().characterId, hero.id);
  return enemies;
}

const marks = () => world.encounter().turnBudget.oncePerTurn;

async function answer(hero, kind, faces) {
  const pending = listOpenPendingRolls(world.campaignId).find((entry) => entry.kind === kind);
  assert.ok(pending, `no ${kind} roll is parked`);
  world.signIn({ id: hero.userId });
  const out = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  return getPendingRoll(pending.id).combatNote ?? "";
}

// An attack with real dice. Returns the notes each stage left for the turn;
// damage faces are skipped on a miss.
async function tableSwing(hero, enemy, toHit, damage, args = {}) {
  setMemberRealDice(world.campaignId, hero.userId, true);
  try {
    const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, ...args });
    if (!parked.ok) {
      return { refused: parked.error };
    }
    const hitNote = await answer(hero, "attack", [toHit].flat());
    const parkedDamage = listOpenPendingRolls(world.campaignId).some((entry) => entry.kind === "damage");
    const damageNote = parkedDamage ? await answer(hero, "damage", damage) : "";
    return { hitNote, damageNote };
  } finally {
    setMemberRealDice(world.campaignId, hero.userId, false);
  }
}

// ---- Great Weapon Master ----

await test("With real dice, a melee critical hit opens Great Weapon Master's bonus attack, and the turn can take it", async () => {
  const [enemy] = await stage(greatWeapon);
  const { damageNote } = await tableSwing(greatWeapon, enemy, 20, [3, 3, 3, 3], { weapon: "Greatsword" });
  assert.match(damageNote, /Great Weapon Master: the critical hit opens/, damageNote);
  assert.ok(marks().includes(GWM), JSON.stringify(marks()));
  const bonus = await tableSwing(greatWeapon, enemy, 10, [3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.equal(bonus.refused, undefined, bonus.refused);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("With real dice, a kill with foes left opens Great Weapon Master's bonus attack", async () => {
  const [enemy, other] = await stage(greatWeapon, { count: 2 });
  kit.setEnemy(enemy.id, { currentHp: 1 });
  kit.place(other.id, 6, 5);
  const { damageNote } = await tableSwing(greatWeapon, enemy, 15, [3, 3], { weapon: "Greatsword" });
  assert.match(damageNote, /SLAIN/, damageNote);
  assert.match(damageNote, /Great Weapon Master: the kill opens/, damageNote);
  const bonus = await tableSwing(greatWeapon, other, 10, [3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.equal(bonus.refused, undefined, bonus.refused);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("With real dice, a plain hit that kills nothing opens no bonus attack", async () => {
  const [enemy] = await stage(greatWeapon);
  const { damageNote } = await tableSwing(greatWeapon, enemy, 15, [3, 3], { weapon: "Greatsword" });
  assert.doesNotMatch(damageNote, /Great Weapon Master/, damageNote);
  assert.ok(!marks().includes(GWM), JSON.stringify(marks()));
  const bonus = await tableSwing(greatWeapon, enemy, 10, [3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.ok(bonus.refused, "the bonus attack is refused");
});

await test("With real dice, a miss opens nothing", async () => {
  const [enemy] = await stage(greatWeapon);
  const { damageNote } = await tableSwing(greatWeapon, enemy, 2, [], { weapon: "Greatsword" });
  assert.equal(damageNote, "");
  assert.ok(!marks().includes(GWM), JSON.stringify(marks()));
});

await test("With real dice, a ranged critical hit opens no Great Weapon Master bonus", async () => {
  const [enemy] = await stage(greatWeapon);
  kit.place(enemy.id, 5, 9);
  const { damageNote } = await tableSwing(greatWeapon, enemy, 20, [3, 3], { weapon: "Longbow" });
  assert.doesNotMatch(damageNote, /Great Weapon Master/, damageNote);
  assert.ok(!marks().includes(GWM), JSON.stringify(marks()));
});

await test("With real dice, a ranged weapon's critical beside the target opens no Great Weapon Master bonus", async () => {
  const [enemy] = await stage(greatWeapon);
  // A shot beside its target rolls at disadvantage: two d20s.
  const { damageNote } = await tableSwing(greatWeapon, enemy, [20, 20], [3, 3], { weapon: "Longbow" });
  assert.ok(damageNote, "the shot landed");
  assert.doesNotMatch(damageNote, /Great Weapon Master/, damageNote);
  assert.ok(!marks().includes(GWM), JSON.stringify(marks()));
});

await test("With real dice, a character without the feat opens nothing on a critical hit", async () => {
  const [enemy] = await stage(plain);
  const { damageNote } = await tableSwing(plain, enemy, 20, [3, 3, 3, 3], { weapon: "Greatsword" });
  assert.doesNotMatch(damageNote, /Great Weapon Master/, damageNote);
  assert.ok(!marks().includes(GWM), JSON.stringify(marks()));
});

// Whatever a blow wrote stays, whichever store comes after it.
await test("With real dice, the bonus's mark keeps a legendary creature's failed save", async () => {
  const [enemy] = await stage(greatWeapon);
  encounters.setEnemyConcentration(enemy.id, "Hold Person");
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, pools: { ...encounter.legendary?.pools, [enemy.id]: { actions: 0, resistances: 3 } } } });
  // The face after the damage dice is the concentration save the blow forces.
  world.dice(1);
  await tableSwing(greatWeapon, enemy, 20, [3, 3, 3, 3], { weapon: "Greatsword" });
  world.clearDice();
  assert.equal(world.encounter().legendary.failedSave?.enemyId, enemy.id, "the failed save is on record");
  assert.ok(marks().includes(GWM), JSON.stringify(marks()));
});

// One blow that ends the fight: it stays over, its XP is paid once, and the GM
// is not told to play a bonus action in a fight that has gone.
async function fightStaysOver(hero, toHit, damage, args, note) {
  const [enemy] = await stage(hero);
  kit.setEnemy(enemy.id, { currentHp: 1, stats: { xp: 1500 } });
  const before = world.sheet(hero.id).xp;
  const { damageNote } = await tableSwing(hero, enemy, toHit, damage, args);
  assert.match(damageNote, /The encounter ended/, damageNote);
  const standing = world.encounter();
  const paid = world.sheet(hero.id).xp - before;
  assert.ok(paid > 0, "the fight's XP is paid");
  const again = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(world.sheet(hero.id).xp - before, paid, "and only once");
  assert.equal(again.result?.alreadyEnded, true, JSON.stringify(again).slice(0, 300));
  assert.equal(standing, null, "the fight stays over");
  assert.doesNotMatch(damageNote, note, damageNote);
}

await test("With real dice, Great Weapon Master's kill of the last foe leaves the fight over, its XP paid once", async () => {
  await fightStaysOver(greatWeapon, 15, [3, 3], { weapon: "Greatsword" }, /Great Weapon Master/);
  await fightStaysOver(greatWeapon, 20, [3, 3, 3, 3], { weapon: "Greatsword" }, /Great Weapon Master/);
});

// A critical whose damage is still to enter when the turn moves on.
async function criticalLeftOpen(hero, enemy) {
  const parked = await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, weapon: "Greatsword" });
  assert.equal(parked.ok, true, parked.error);
  await answer(hero, "attack", [20]);
}

await test("With real dice, a damage roll that lands on the next character's turn opens nothing, whether or not they have acted", async () => {
  for (const acted of [false, true]) {
    const [enemy] = await stage(greatWeapon);
    setMemberRealDice(world.campaignId, greatWeapon.userId, true);
    try {
      await criticalLeftOpen(greatWeapon, enemy);
      kit.giveTurn(plain.id);
      if (acted) {
        const dodge = await world.invoke("take_action", { characterId: plain.id, action: "dodge" });
        assert.equal(dodge.ok, true, dodge.error);
        assert.equal(world.encounter().turnBudget?.ownerId, plain.id, "the next character holds a budget");
      }
      const note = await answer(greatWeapon, "damage", [3, 3, 3, 3]);
      assert.doesNotMatch(note, /Great Weapon Master/, note);
      assert.ok(!(world.encounter().turnBudget?.oncePerTurn ?? []).includes(GWM), JSON.stringify(world.encounter().turnBudget));
    } finally {
      setMemberRealDice(world.campaignId, greatWeapon.userId, false);
    }
  }
});

await test("With real dice, a critical's damage entered on the attacker's next turn opens nothing on that turn", async () => {
  const [enemy] = await stage(greatWeapon);
  setMemberRealDice(world.campaignId, greatWeapon.userId, true);
  try {
    await criticalLeftOpen(greatWeapon, enemy);
    const encounter = world.encounter();
    kit.saveEncounter({ ...encounter, round: encounter.round + 1, turnBudget: null });
    const dodge = await world.invoke("take_action", { characterId: greatWeapon.id, action: "dodge" });
    assert.equal(dodge.ok, true, dodge.error);
    assert.equal(world.encounter().turnBudget?.ownerId, greatWeapon.id, "the attacker holds this turn's budget");
    const note = await answer(greatWeapon, "damage", [3, 3, 3, 3]);
    assert.doesNotMatch(note, /Great Weapon Master/, note);
    assert.ok(!marks().includes(GWM), JSON.stringify(marks()));
  } finally {
    setMemberRealDice(world.campaignId, greatWeapon.userId, false);
  }
});

await test("With real dice, a thrown weapon's critical at range and a melee spell attack's critical open no Great Weapon Master bonus", async () => {
  const [enemy] = await stage(greatWeapon);
  kit.place(enemy.id, 5, 8);
  const thrown = await tableSwing(greatWeapon, enemy, 20, [3, 3], { weapon: "Handaxe" });
  assert.equal(thrown.refused, undefined, thrown.refused);
  assert.doesNotMatch(thrown.damageNote, /Great Weapon Master/, thrown.damageNote);
  assert.ok(!marks().includes(GWM), JSON.stringify(marks()));
  const [touched] = await stage(mage);
  const grasp = await tableSwing(mage, touched, 20, [3, 3, 3, 3], { spell: "Shocking Grasp" });
  assert.equal(grasp.refused, undefined, grasp.refused);
  assert.ok(grasp.damageNote, "the spell's critical landed");
  assert.doesNotMatch(grasp.damageNote, /Great Weapon Master/, grasp.damageNote);
  assert.ok(!marks().includes(GWM), JSON.stringify(marks()));
});

// ---- Tavern Brawler ----

await test("With real dice, Tavern Brawler's unarmed hit opens the grapple, and the turn can take it", async () => {
  const [enemy] = await stage(brawler);
  const { damageNote } = await tableSwing(brawler, enemy, 15, [3], { weapon: "unarmed strike" });
  assert.match(damageNote, /Tavern Brawler: the hit opens/, damageNote);
  assert.ok(marks().includes(TAVERN), JSON.stringify(marks()));
  const grapple = await world.invoke("take_action", { characterId: brawler.id, action: "grapple", targetEnemyId: enemy.id, bonus: true });
  assert.equal(grapple.ok, true, grapple.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true, "the grapple took the bonus action");
});

await test("With real dice, Tavern Brawler's hit with an improvised weapon opens the grapple", async () => {
  const [enemy] = await stage(brawler);
  const { damageNote } = await tableSwing(brawler, enemy, 15, [3], { weapon: "chair", improvised: true });
  assert.match(damageNote, /Tavern Brawler: the hit opens/, damageNote);
  assert.ok(marks().includes(TAVERN), JSON.stringify(marks()));
});

await test("With real dice, an unarmed hit without the feat opens nothing", async () => {
  const [enemy] = await stage(monk);
  const { damageNote } = await tableSwing(monk, enemy, 15, [3], { weapon: "unarmed strike" });
  assert.ok(damageNote, "the blow landed");
  assert.doesNotMatch(damageNote, /Tavern Brawler/, damageNote);
  assert.ok(!marks().includes(TAVERN), JSON.stringify(marks()));
});

await test("With real dice, Tavern Brawler's miss and its hit with a sword open nothing", async () => {
  const [enemy] = await stage(brawler);
  await tableSwing(brawler, enemy, 2, [], { weapon: "unarmed strike" });
  assert.ok(!marks().includes(TAVERN), JSON.stringify(marks()));
  const [other] = await stage(brawler);
  const { damageNote } = await tableSwing(brawler, other, 15, [3], { weapon: "Longsword" });
  assert.doesNotMatch(damageNote, /Tavern Brawler/, damageNote);
  assert.ok(!marks().includes(TAVERN), JSON.stringify(marks()));
});

await test("With real dice, Tavern Brawler's hit that ends the fight leaves it over, its XP paid once", async () => {
  await fightStaysOver(brawler, 15, [3], { weapon: "unarmed strike" }, /Tavern Brawler/);
});

await kit.endFight();
world.close();
finish();
