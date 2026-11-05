// The combat feats at the table (issue #125, src/lib/srd/feat-combat.ts):
// Great Weapon Master's and Sharpshooter's -5/+10 through pc_attack's
// powerAttack, Great Weapon Master's bonus-action attack after a critical
// hit, Gunner shooting with a foe at the elbow, Elemental Adept's floored
// dice through a resistant creature, Defensive Duelist's reaction turning a
// hit into a miss, Mage Slayer's reaction attack, and Dungeon Delver's traps
// and passive notice.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-feat-combat");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);
const encounters = await import("../src/lib/db/encounters.ts");

// Puts the initiative pointer on the enemy: what a character does now is a
// reaction, not their action.
function enemyTurn(enemy) {
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => encounters.orderEntryId(entry) === enemy.id);
  assert.ok(place >= 0, "the enemy is in the order");
  encounters.saveEncounter({ ...encounter, turnIndex: place, turnBudget: null });
}

const greatWeapon = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Greatsword", qty: 1 }, { name: "Longsword", qty: 1 }],
  feats: ["Great Weapon Master"],
});
const plain = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Greatsword", qty: 1 }, { name: "Longbow", qty: 1 }],
});
const sharpshooter = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 10, dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longbow", qty: 1 }],
  feats: ["Sharpshooter"],
});
const gunner = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 10, dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longbow", qty: 1 }],
  feats: ["Gunner"],
});
const adept = world.addHero({
  class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
  feats: ["Elemental Adept"],
  // The pick as the judge writes it to the sheet (see test-enforce-feats).
  features: [{ name: "Elemental Adept: fire", source: "story" }],
});
const evoker = world.addHero({
  class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Fire Bolt"] },
});
const duelist = world.addHero({
  class: "rogue", level: 5, maxHp: 30, abilities: { dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Rapier", qty: 1, equipped: true }],
  feats: ["Defensive Duelist"],
});
const slayer = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  feats: ["Mage Slayer"],
});
// Issue #147: the other feats the engines apply.
const powerful = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Greatsword", qty: 1 }],
  feats: ["Powerful Attacker"],
});
const deadeye = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 10, dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longbow", qty: 1 }],
  feats: ["Deadeye"],
});
const polearm = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Glaive", qty: 1 }],
  feats: ["Polearm Master"],
});
const lucky = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  feats: ["Lucky"],
});
const brawler = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [],
  feats: ["Tavern Brawler"],
});
const piercer = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 10, dex: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Rapier", qty: 1 }],
  feats: ["Piercer"],
});
const savage = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
  feats: ["Savage Attacker"],
});
const favored = world.addHero({
  class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 12, wis: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Greatsword", qty: 1 }],
  feats: ["Great Weapon Master"],
});
world.patch(favored.id, { features: [...world.sheet(favored.id).features, { name: "Foe Slayer", description: "" }, { name: "Favored Enemy: humanoids", description: "" }] });
const favoredMage = world.addHero({
  class: "wizard", level: 5, maxHp: 30, abilities: { int: 16, wis: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, prepared: ["Scorching Ray"], known: ["Scorching Ray"], cantrips: ["Fire Bolt"] },
});
world.patch(favoredMage.id, { features: [...world.sheet(favoredMage.id).features, { name: "Foe Slayer", description: "" }, { name: "Favored Enemy: humanoids", description: "" }] });
const heroes = [greatWeapon, plain, sharpshooter, gunner, adept, evoker, duelist, slayer, powerful, deadeye, polearm, lucky, brawler, piercer, savage, favored, favoredMage];
const base = new Map(heroes.map((hero) => [hero.id, world.sheet(hero.id)]));

async function stage(hero, { count = 1, apart = 1 } = {}) {
  await kit.endFight();
  for (const entry of heroes) {
    const made = base.get(entry.id);
    world.patch(entry.id, { features: made.features, equipment: made.equipment, resources: made.resources, feats: made.feats, currentHp: made.maxHp, conditions: [] });
  }
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === hero.id ? 19 : 2]));
  await kit.fight(count, { heroFaces });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    kit.setEnemy(enemy.id, { maxHp: 400 });
  }
  kit.place(hero.id, 5, 5);
  kit.place(enemies[0].id, 5, 5 + apart);
  assert.equal(kit.current().characterId, hero.id);
  return enemies;
}

const PB = proficiencyBonus(5);
const hp = (hero) => world.sheet(hero.id).currentHp;
const enemyHp = (enemy) => world.enemies().find((entry) => entry.id === enemy.id).currentHp;

await test("Great Weapon Master's -5/+10 rides a heavy melee weapon; a plain fighter and a longsword are refused", async () => {
  const [enemy] = await stage(greatWeapon);
  const swing = await kit.swing(greatWeapon.id, enemy.id, [15, 3, 3], { weapon: "Greatsword", powerAttack: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit.total, 15 + abilityMod(16) + PB - 5, "to hit less 5");
  assert.equal(swing.result.hit, true, JSON.stringify(swing.result));
  assert.equal(swing.damage.total, 3 + 3 + abilityMod(16) + 10, "damage plus 10");
  const light = await kit.swing(greatWeapon.id, enemy.id, [10, 3], { weapon: "Longsword", powerAttack: true });
  assert.equal(light.ok, false, "a longsword is not heavy");
  assert.match(light.error ?? "", /heavy melee weapon/);
  const [other] = await stage(plain);
  const none = await kit.swing(plain.id, other.id, [10, 3, 3], { weapon: "Greatsword", powerAttack: true });
  assert.equal(none.ok, false, "no feat, no trade");
  assert.match(none.error ?? "", /none of them|neither/);
});

await test("a melee critical hit opens Great Weapon Master's bonus-action attack; without one it is refused", async () => {
  const [enemy] = await stage(greatWeapon);
  const early = await kit.swing(greatWeapon.id, enemy.id, [10, 3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.equal(early.ok, false, "a bonus attack before any crit or kill");
  assert.match(early.error ?? "", /critical hit or a kill/);
  const crit = await kit.swing(greatWeapon.id, enemy.id, [20, 3, 3, 3, 3], { weapon: "Greatsword" });
  assert.equal(crit.ok, true, crit.error);
  assert.equal(crit.result.crit, true);
  assert.ok((crit.result.conditionEffects ?? []).some((note) => /Great Weapon Master/.test(note)), JSON.stringify(crit.result.conditionEffects));
  const bonus = await kit.swing(greatWeapon.id, enemy.id, [10, 3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.equal(bonus.ok, true, bonus.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

// A mark a hit leaves on the turn is written after the blow lands. Written on
// the encounter read before it, it undid what the blow did.
const marks = () => world.encounter().turnBudget.oncePerTurn;

// One hit that ends the fight: it stays over, its XP is paid once, and the GM
// is not told to play a bonus action in a fight that has gone.
async function fightStaysOver(hero, faces, args, note) {
  const [enemy] = await stage(hero);
  kit.setEnemy(enemy.id, { currentHp: 1, stats: { xp: 1500 } });
  const before = world.sheet(hero.id).xp;
  const blow = await kit.swing(hero.id, enemy.id, faces, args);
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.encounterOver, true, JSON.stringify(blow.result).slice(0, 300));
  const standing = world.encounter();
  const paid = world.sheet(hero.id).xp - before;
  assert.ok(paid > 0, "the fight's XP is paid");
  // The model often ends the fight it has just seen end, so the second payment
  // is asked about first: a reopened fight is what pays it.
  const again = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(world.sheet(hero.id).xp - before, paid, "and only once");
  assert.equal(again.result?.alreadyEnded, true, JSON.stringify(again).slice(0, 300));
  assert.equal(standing, null, "the fight stays over");
  assert.ok(!(blow.result.conditionEffects ?? []).some((line) => note.test(line)), JSON.stringify(blow.result.conditionEffects));
}

// One hit that leaves the fight running, on a concentrating legendary creature
// that fails the save: the mark goes on, and the failed save stays on record
// for legendary_resist to turn.
async function markKeepsTheBlow(hero, faces, args, mark, feats) {
  const [enemy] = await stage(hero);
  if (feats) {
    world.patch(hero.id, { feats });
  }
  encounters.setEnemyConcentration(enemy.id, "Hold Person");
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, legendary: { ...encounter.legendary, pools: { ...encounter.legendary?.pools, [enemy.id]: { actions: 0, resistances: 3 } } } });
  const blow = await kit.swing(hero.id, enemy.id, faces, args);
  assert.equal(blow.ok, true, blow.error);
  assert.equal(world.encounter().legendary.failedSave?.enemyId, enemy.id, "the failed save is on record");
  assert.ok(marks().includes(mark), JSON.stringify(marks()));
  return enemy;
}

await test("Great Weapon Master's kill of the last foe leaves the fight over, its XP paid once, on a plain hit and a critical", async () => {
  await fightStaysOver(greatWeapon, [15, 3, 3], { weapon: "Greatsword" }, /Great Weapon Master: the/);
  await fightStaysOver(greatWeapon, [20, 3, 3, 3, 3], { weapon: "Greatsword" }, /Great Weapon Master: the/);
});

await test("Great Weapon Master's kill with foes left still opens the bonus attack", async () => {
  const [enemy, other] = await stage(greatWeapon, { count: 2 });
  kit.setEnemy(enemy.id, { currentHp: 1 });
  kit.place(other.id, 6, 5);
  const blow = await kit.swing(greatWeapon.id, enemy.id, [15, 3, 3], { weapon: "Greatsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.dead, true, JSON.stringify(blow.result).slice(0, 300));
  assert.ok((blow.result.conditionEffects ?? []).some((line) => /Great Weapon Master: the kill/.test(line)), JSON.stringify(blow.result.conditionEffects));
  const bonus = await kit.swing(greatWeapon.id, other.id, [10, 3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.equal(bonus.ok, true, bonus.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("Great Weapon Master's critical that does not kill opens the bonus attack and keeps what the blow wrote", async () => {
  const enemy = await markKeepsTheBlow(greatWeapon, [20, 3, 3, 3, 3, 1], { weapon: "Greatsword" }, "great weapon master");
  const bonus = await kit.swing(greatWeapon.id, enemy.id, [10, 3, 3], { weapon: "Greatsword", bonusAttack: "feature" });
  assert.equal(bonus.ok, true, bonus.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("A later feat's store does not drop Great Weapon Master's mark from the turn", async () => {
  const [enemy] = await stage(greatWeapon);
  world.patch(greatWeapon.id, { feats: ["Great Weapon Master", "Slasher"] });
  const blow = await kit.swing(greatWeapon.id, enemy.id, [20, 3, 3, 3, 3], { weapon: "Greatsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.ok((blow.result.conditionEffects ?? []).some((line) => /Slasher: .*speed/.test(line)), JSON.stringify(blow.result.conditionEffects));
  assert.ok(marks().includes("great weapon master"), JSON.stringify(marks()));
});

await test("Great Weapon Master's mark does not take Foe Slayer's once-a-turn mark off the turn", async () => {
  const [enemy] = await stage(favored);
  const blow = await kit.swing(favored.id, enemy.id, [20, 3, 3, 3, 3], { weapon: "Greatsword" });
  assert.equal(blow.ok, true, blow.error);
  assert.ok((blow.result.conditionEffects ?? []).some((line) => /Foe Slayer: \+3 damage/.test(line)), JSON.stringify(blow.result.conditionEffects));
  assert.ok(marks().includes("foe-slayer") && marks().includes("great weapon master"), JSON.stringify(marks()));
});

await test("Slasher's and Crusher's marks keep what the blow wrote: a concentrating legendary creature's failed save can still be turned", async () => {
  await markKeepsTheBlow(greatWeapon, [15, 3, 3, 1], { weapon: "Greatsword" }, "slasher:used", ["Slasher"]);
  await markKeepsTheBlow(brawler, [15, 3, 1], { weapon: "unarmed strike" }, "crusher:used", ["Tavern Brawler", "Crusher"]);
  // With Great Weapon Master's mark before it: both stay on the turn.
  await markKeepsTheBlow(greatWeapon, [20, 3, 3, 3, 3, 1], { weapon: "Greatsword" }, "slasher:used", ["Great Weapon Master", "Slasher"]);
  assert.ok(marks().includes("great weapon master"), JSON.stringify(marks()));
});

await test("Foe Slayer stays once a turn when another feat's mark follows it, whether it rode the damage or turned a near miss", async () => {
  const usedOn = (blow) => (blow.result.conditionEffects ?? []).some((line) => /Foe Slayer/.test(line));
  // +6 to hit against AC 13: a 15 hits on its own, and a 5 is 11, turned by +3.
  for (const [feats, first] of [
    [["Savage Attacker"], [15, 3, 3, 3, 3]],
    [["Brutal Attack"], [15, 3, 3, 3, 3]],
    [["Slasher"], [15, 3, 3]],
    [["Savage Attacker"], [5, 3, 3, 3, 3]],
  ]) {
    const [enemy] = await stage(favored);
    world.patch(favored.id, { feats });
    const blow = await kit.swing(favored.id, enemy.id, first, { weapon: "Greatsword" });
    assert.equal(blow.ok, true, blow.error);
    assert.equal(blow.result.hit, true, JSON.stringify(blow.result).slice(0, 300));
    assert.ok(usedOn(blow), JSON.stringify(blow.result.conditionEffects));
    assert.ok(marks().includes("foe-slayer"), `${feats}: ${JSON.stringify(marks())}`);
    const next = await kit.swing(favored.id, enemy.id, [15, 3, 3], { weapon: "Greatsword" });
    assert.equal(next.ok, true, next.error);
    assert.equal(usedOn(next), false, `${feats}: ${JSON.stringify(next.result.conditionEffects)}`);
  }
});

await test("Foe Slayer on a spell attack leaves the turn the cast wrote: the action stays spent, and a second ray stays the same casting", async () => {
  const fireBolt = { spell: "Fire Bolt", damage: "2d10", damageType: "fire" };
  // +6 to hit against AC 13: a 15 hits on its own, and a 5 is 11, turned by +3.
  for (const faces of [[15, 3, 3], [5, 3, 3]]) {
    const [enemy] = await stage(favoredMage, { apart: 3 });
    const bolt = await kit.swing(favoredMage.id, enemy.id, faces, fireBolt);
    assert.equal(bolt.ok, true, bolt.error);
    assert.equal(bolt.result.hit, true, JSON.stringify(bolt.result).slice(0, 300));
    assert.ok(marks().includes("foe-slayer"), JSON.stringify(marks()));
    assert.equal(world.encounter().turnBudget.actionUsed, true, "the cast spent the action");
    const again = await kit.swing(favoredMage.id, enemy.id, [15, 3, 3], fireBolt);
    assert.equal(again.ok, false, "no second action");
    assert.match(again.error ?? "", /action/);
  }
  const [enemy] = await stage(favoredMage, { apart: 3 });
  const slots = () => world.sheet(favoredMage.id).spellcasting.slots[2].used;
  const spent = slots();
  const first = await kit.swing(favoredMage.id, enemy.id, [15, 3, 3], { spell: "Scorching Ray" });
  assert.equal(first.ok, true, first.error);
  assert.ok(marks().includes("foe-slayer") && marks().includes("spell:levelled"), JSON.stringify(marks()));
  const second = await kit.swing(favoredMage.id, enemy.id, [15, 3, 3], { spell: "Scorching Ray" });
  assert.equal(second.ok, true, second.error);
  assert.ok(!(second.result.conditionEffects ?? []).some((line) => /Foe Slayer/.test(line)), JSON.stringify(second.result.conditionEffects));
  assert.equal(slots() - spent, 1, "one casting, one slot");
});

await test("Tavern Brawler's hit that ends the fight leaves it over, its XP paid once", async () => {
  await fightStaysOver(brawler, [15, 3], { weapon: "unarmed strike" }, /Tavern Brawler: the hit opens/);
});

await test("Tavern Brawler's hit opens the grapple with foes left after a kill, and keeps what a hit that does not kill wrote", async () => {
  const [enemy, other] = await stage(brawler, { count: 2 });
  kit.setEnemy(enemy.id, { currentHp: 1 });
  kit.place(other.id, 6, 5);
  const blow = await kit.swing(brawler.id, enemy.id, [15, 3], { weapon: "unarmed strike" });
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.dead, true, JSON.stringify(blow.result).slice(0, 300));
  const grab = await world.invoke("take_action", { characterId: brawler.id, action: "grapple", targetEnemyId: other.id, bonus: true });
  assert.equal(grab.ok, true, grab.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true, "the grapple took the bonus action");
  const held = await markKeepsTheBlow(brawler, [15, 3, 1], { weapon: "unarmed strike" }, "tavern brawler:hit");
  const second = await world.invoke("take_action", { characterId: brawler.id, action: "grapple", targetEnemyId: held.id, bonus: true });
  assert.equal(second.ok, true, second.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true, "the grapple took the bonus action");
});

await test("Sharpshooter's -5/+10 rides a ranged weapon; Gunner shoots with a foe at the elbow at no disadvantage", async () => {
  const [enemy] = await stage(sharpshooter, { apart: 3 });
  const shot = await kit.swing(sharpshooter.id, enemy.id, [15, 4], { weapon: "Longbow", powerAttack: true });
  assert.equal(shot.ok, true, shot.error);
  assert.equal(shot.toHit.total, 15 + abilityMod(16) + PB - 5);
  assert.equal(shot.result.hit, true, JSON.stringify(shot.result));
  assert.equal(shot.damage.total, 4 + abilityMod(16) + 10);
  // A hostile creature within 5 feet: disadvantage for most, not for Gunner.
  const [near] = await stage(plain, { apart: 1 });
  const crowded = await kit.swing(plain.id, near.id, [10, 10, 4], { weapon: "Longbow" });
  assert.equal(crowded.ok, true, crowded.error);
  assert.equal(d20Faces(crowded.toHit).length, 2, "two d20s: disadvantage at the elbow");
  const [beside] = await stage(gunner, { apart: 1 });
  const free = await kit.swing(gunner.id, beside.id, [10, 4], { weapon: "Longbow" });
  assert.equal(free.ok, true, free.error);
  assert.equal(d20Faces(free.toHit).length, 1, "Gunner: one d20 with a foe at the elbow");
});

await test("Elemental Adept: a fire bolt's 1s count as 2 and the creature's fire resistance is ignored; another caster's is halved", async () => {
  const [enemy] = await stage(adept, { apart: 3 });
  kit.setEnemy(enemy.id, { stats: { resist: "fire" } });
  const before = enemyHp(enemy);
  const bolt = await kit.swing(adept.id, enemy.id, [15, 1, 1], { spell: "Fire Bolt", damage: "2d10", damageType: "fire" });
  assert.equal(bolt.ok, true, bolt.error);
  assert.equal(bolt.result.hit, true);
  assert.equal(bolt.damage.total, 4, "two 1s floored to 2 each");
  assert.equal(before - enemyHp(enemy), 4, "resistance ignored");
  const [other] = await stage(evoker, { apart: 3 });
  kit.setEnemy(other.id, { stats: { resist: "fire" } });
  const start = enemyHp(other);
  const plainBolt = await kit.swing(evoker.id, other.id, [15, 1, 1], { spell: "Fire Bolt", damage: "2d10", damageType: "fire" });
  assert.equal(plainBolt.ok, true, plainBolt.error);
  assert.equal(plainBolt.damage.total, 2);
  assert.equal(start - enemyHp(other), 1, "halved by resistance");
});

async function enemyHits(enemy, target, faces) {
  kit.freshRound();
  kit.place(target.id, 5, 5);
  world.diceLog();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  return out.result;
}
const react = (hero, feature, args = {}) => world.invoke("use_reaction", { characterId: hero.id, feature, ...args });

await test("Defensive Duelist adds the proficiency bonus to AC against the melee hit it answers", async () => {
  const [enemy] = await stage(duelist);
  // AC 13 (no armor, DEX 16); the goblin's +4: 10 + 4 = 14 hits for 3 + 2.
  const hit = await enemyHits(enemy, duelist, [10, 3]);
  assert.equal(hit.hit, true, JSON.stringify(hit));
  assert.equal(hp(duelist), 25);
  const out = await react(duelist, "Defensive Duelist");
  assert.equal(out.ok, true, out.error);
  assert.match(String(out.result.applied), /now misses/);
  assert.equal(hp(duelist), 30, "the hit the higher AC turned away deals nothing");
  assert.ok(world.encounter().reactionsUsed.includes(duelist.id), "the reaction is spent");
  // A hit that still meets AC 16 stands.
  const [again] = await stage(duelist);
  await enemyHits(again, duelist, [15, 3]);
  const stands = await react(duelist, "Defensive Duelist");
  assert.equal(stands.ok, true, stands.error);
  assert.equal(hp(duelist), 25);
  // Without the feat, or without a finesse weapon in hand, nothing happens.
  const [third] = await stage(slayer);
  await enemyHits(third, slayer, [10, 3]);
  const none = await react(slayer, "Defensive Duelist");
  assert.equal(none.ok, false);
  assert.match(none.error ?? "", /takes the feat and a finesse weapon/);
});

await test("a Mage Slayer's melee hit from within 5 feet puts the caster's concentration save at disadvantage", async () => {
  const [enemy] = await stage(slayer);
  encounters.setEnemyConcentration(enemy.id, "Hold Person");
  // The hit lands for 3 + 3, DC 10; the save reads two d20s and keeps the lower.
  const swing = await kit.swing(slayer.id, enemy.id, [15, 3, 20, 2], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.hit, true, JSON.stringify(swing.result));
  assert.match(String(swing.result.mageSlayer ?? ""), /disadvantage/);
  const save = kit.lastRolls(8).find((roll) => roll.kind === "saving_throw" && /concentration/.test(roll.detail ?? ""));
  assert.ok(save, "the concentration save is on the record");
  assert.equal(d20Faces(save).length, 2, "two d20s: disadvantage");
  assert.match(String(swing.result.concentration ?? ""), /loses concentration/);
  // A plain fighter's hit leaves the save as it is.
  const [other] = await stage(plain);
  encounters.setEnemyConcentration(other.id, "Hold Person");
  const flat = await kit.swing(plain.id, other.id, [15, 3, 20, 2], { weapon: "Greatsword" });
  assert.equal(flat.ok, true, flat.error);
  const plainSave = kit.lastRolls(8).find((roll) => roll.kind === "saving_throw" && /concentration/.test(roll.detail ?? ""));
  assert.equal(d20Faces(plainSave).length, 1);
  assert.equal(flat.result.mageSlayer, undefined);
});

await test("Mage Slayer's reaction is one melee weapon attack on a caster within 5 feet; nobody else has it", async () => {
  const [enemy] = await stage(slayer);
  // On the caster's turn, not the fighter's: a reaction.
  enemyTurn(enemy);
  const out = await react(slayer, "Mage Slayer", { targetEnemyId: enemy.id });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.reaction, "Mage Slayer");
  assert.ok(world.encounter().reactionsUsed.includes(slayer.id), "the reaction is spent");
  const [far] = await stage(slayer, { apart: 3 });
  enemyTurn(far);
  const away = await react(slayer, "Mage Slayer", { targetEnemyId: far.id });
  assert.equal(away.ok, false, "a caster 15 ft away");
  assert.match(away.error ?? "", /within 5 feet/);
  const [other] = await stage(plain);
  enemyTurn(other);
  const none = await react(plain, "Mage Slayer", { targetEnemyId: other.id });
  assert.equal(none.ok, false);
  assert.match(none.error ?? "", /has no Mage Slayer/);
});

await test("Dungeon Delver saves against a trap at advantage and takes half its damage, and notices a trap at +5 passive", async () => {
  await kit.endFight();
  const delver = world.addHero({
    class: "fighter", level: 5, maxHp: 200, abilities: { str: 16, dex: 14, con: 14, wis: 10 }, proficiencies: TRAINED,
    feats: ["Dungeon Delver"],
  });
  const careless = world.addHero({
    class: "fighter", level: 5, maxHp: 200, abilities: { str: 16, dex: 14, con: 14, wis: 10 }, proficiencies: TRAINED,
  });
  // A dangerous trap at level 5 rolls 4d10; a failed save takes it all.
  world.diceLog();
  world.dice(1, 5, 5, 5, 5);
  const plainTrap = await world.invoke("apply_hazard", { type: "trap", characterIds: [careless.id], severity: "dangerous", dc: 30 });
  world.clearDice();
  assert.equal(plainTrap.ok, true, plainTrap.error);
  assert.equal(plainTrap.result.results[0].saved, false);
  assert.equal(200 - hp(careless), 20);
  // Advantage: two d20 faces are read; the 1 and the 2 both fail DC 30, and
  // the damage is halved by the feat's resistance.
  world.diceLog();
  world.dice(1, 2, 5, 5, 5, 5);
  const warded = await world.invoke("apply_hazard", { type: "trap", characterIds: [delver.id], severity: "dangerous", dc: 30 });
  world.clearDice();
  assert.equal(warded.ok, true, warded.error);
  assert.equal(warded.result.results[0].saved, false);
  assert.equal(warded.result.results[0].featAdvantage, "Dungeon Delver: a trap");
  assert.equal(200 - hp(delver), 10, "trap damage halved");
  assert.equal(d20Faces(kit.lastRolls(8).find((roll) => roll.kind === "saving_throw" && roll.characterId === delver.id)).length, 2, "the save rolled two d20s");
  // Passive Perception 10 + 0: a DC 13 trap is missed without the feat and
  // noticed with it.
  const missed = await world.invoke("check_notice", { sense: "perception", dc: 13, characterIds: [careless.id], about: "traps_and_secret_doors", reason: "a pressure plate trap under the rug" });
  assert.equal(missed.ok, true, missed.error);
  assert.deepEqual(missed.result.noticedBy, []);
  const found = await world.invoke("check_notice", { sense: "perception", dc: 13, characterIds: [delver.id], about: "traps_and_secret_doors", reason: "a pressure plate trap under the rug" });
  assert.equal(found.ok, true, found.error);
  assert.deepEqual(found.result.noticedBy, [world.sheet(delver.id).name]);
  const ambush = await world.invoke("check_notice", { sense: "perception", dc: 13, characterIds: [delver.id], reason: "an archer in the rafters" });
  assert.deepEqual(ambush.result.noticedBy, [], "the feat is about traps and secret doors only");
});

// ---- issue #147: Level Up's twins and the authored feats that were words only ----

await test("Powerful Attacker trades disadvantage for +10 on a heavy weapon; Deadeye drops the proficiency bonus for twice it on a ranged weapon (issue #147)", async () => {
  const [enemy] = await stage(powerful);
  const swing = await kit.swing(powerful.id, enemy.id, [15, 15, 3, 3], { weapon: "Greatsword", powerAttack: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, "two d20s: the roll at disadvantage");
  assert.equal(swing.toHit.total, 15 + abilityMod(16) + PB, "no flat penalty");
  assert.equal(swing.damage.total, 3 + 3 + abilityMod(16) + 10, "damage plus 10");
  const [far] = await stage(deadeye, { apart: 3 });
  const shot = await kit.swing(deadeye.id, far.id, [15, 4], { weapon: "Longbow", powerAttack: true });
  assert.equal(shot.ok, true, shot.error);
  assert.equal(shot.toHit.total, 15 + abilityMod(16), "the proficiency bonus comes off the roll");
  assert.equal(shot.damage.total, 4 + abilityMod(16) + 2 * PB, "twice the proficiency bonus on the damage");
});

await test("Polearm Master's butt-end strike follows an Attack action with the polearm: 1d4 bludgeoning as the bonus action (issue #147)", async () => {
  const [enemy] = await stage(polearm);
  const early = await kit.swing(polearm.id, enemy.id, [10, 2], { weapon: "Glaive", bonusAttack: "feature" });
  assert.equal(early.ok, false, "the butt end before the Attack action");
  assert.match(early.error ?? "", /Polearm Master/);
  const first = await kit.swing(polearm.id, enemy.id, [15, 5, 5], { weapon: "Glaive" });
  assert.equal(first.ok, true, first.error);
  const butt = await kit.swing(polearm.id, enemy.id, [15, 2], { weapon: "Glaive", bonusAttack: "feature" });
  assert.equal(butt.ok, true, butt.error);
  assert.equal(butt.damage.total, 2 + abilityMod(16), "1d4 plus the modifier");
  assert.equal(butt.result.damageType, "bludgeoning");
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
});

await test("Lucky's point buys an extra d20 on the attack roll and is spent; Tavern Brawler's unarmed strike deals 1d4 and its hit opens a bonus-action grapple (issue #147)", async () => {
  const [enemy] = await stage(lucky);
  assert.equal(world.sheet(lucky.id).resources.luck_points.max, 3, "three luck points from the feat");
  const swing = await kit.swing(lucky.id, enemy.id, [4, 17, 5], { weapon: "Longsword", luck: true });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, "a straight roll plus the luck die");
  assert.equal(swing.toHit.total, 17 + abilityMod(16) + PB, "the best die kept");
  assert.equal(world.sheet(lucky.id).resources.luck_points.used, 1, "the point is spent");
  const [other] = await stage(brawler);
  const punch = await kit.swing(brawler.id, other.id, [15, 3], { weapon: "unarmed strike" });
  assert.equal(punch.ok, true, punch.error);
  assert.equal(punch.damage.total, 3 + abilityMod(16), "1d4 plus Strength, not 1");
  assert.ok(world.encounter().turnBudget.oncePerTurn.includes("tavern brawler:hit"), "the hit opens the grapple");
  const grab = await world.invoke("take_action", { characterId: brawler.id, action: "grapple", targetEnemyId: other.id, bonus: true });
  assert.equal(grab.ok, true, grab.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true, "the grapple took the bonus action");
});

await test("Piercer: a piercing critical hit rolls one more die, and once a turn the lowest die is rerolled (issue #147)", async () => {
  const [enemy] = await stage(piercer);
  const crit = await kit.swing(piercer.id, enemy.id, [20, 1, 8, 8, 6], { weapon: "Rapier" });
  assert.equal(crit.ok, true, crit.error);
  assert.equal(crit.result.crit, true);
  const notes = crit.result.conditionEffects ?? [];
  assert.ok(notes.some((note) => /Piercer: a 1 on a d8 is rerolled to 6/.test(note)), JSON.stringify(notes));
  assert.equal(crit.damage.total, 6 + 8 + 8 + abilityMod(16), "three dice on the crit, the 1 rerolled");
});

await test("Savage Attacker (2014): once a turn a melee hit's weapon dice are rolled twice and the better kept; the second swing rolls once (issue #502)", async () => {
  const [enemy] = await stage(savage);
  const first = await kit.swing(savage.id, enemy.id, [15, 2, 7], { weapon: "Longsword" });
  assert.equal(first.ok, true, first.error);
  const notes = first.result.conditionEffects ?? [];
  assert.ok(notes.some((note) => /Savage Attacker: the weapon's dice rolled twice \(2 and 7\)/.test(note)), JSON.stringify(notes));
  assert.equal(first.damage.total, 7 + abilityMod(16), "the better roll kept");
  const second = await kit.swing(savage.id, enemy.id, [15, 3], { weapon: "Longsword" });
  assert.equal(second.ok, true, second.error);
  assert.ok(!(second.result.conditionEffects ?? []).some((note) => /Savage Attacker/.test(note)));
  assert.equal(second.damage.total, 3 + abilityMod(16), "once a turn");
});

await test("the DM prompt carries every feat's rules, and a content pack feat's numbers reach the derived sheet (issue #147)", async () => {
  const { describeSheet } = await import("../src/lib/dm/prompt.ts");
  const line = describeSheet(world.sheet(lucky.id), "Tester", false);
  assert.match(line, /Lucky \[server\]: You have three luck points/);
  const { getContentDb } = await import("../src/lib/content/db.ts");
  if (getContentDb()) {
    const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
    const quick = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { dex: 12 }, proficiencies: TRAINED, feats: ["Attentive"] });
    const plainSheet = world.sheet(plain.id);
    assert.equal(computeSheetDerived(world.sheet(quick.id)).initiative, computeSheetDerived({ ...plainSheet, feats: [] }).initiative + 5, "Attentive: +5 initiative read from the pack's text");
    const scout = world.addHero({ class: "ranger", level: 5, maxHp: 40, abilities: { dex: 12 }, proficiencies: TRAINED, features: [{ name: "Skirmisher", source: "class" }] });
    const { speedFor } = await import("../src/lib/srd/index.ts");
    assert.equal(speedFor(world.sheet(scout.id)), 30, "the Scout's Skirmisher feature is not the feat's +10 feet");
    const skirmisher = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { dex: 12 }, proficiencies: TRAINED, feats: ["Skirmisher"] });
    assert.equal(speedFor(world.sheet(skirmisher.id)), 40, "the feat's +10 feet from sheet.feats alone");
  }
});

world.close();
finish();
