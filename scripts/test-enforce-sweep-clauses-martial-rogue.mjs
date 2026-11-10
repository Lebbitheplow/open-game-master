// The clause ledger's rogue probes: the sentences of the authored rogue
// subclass features (src/lib/srd/subclasses.json) that no existing suite ran,
// each run through the engine. scripts/clauses/martial.json names every probe
// here by its id; scripts/lib/sweep-clauses-martial-known-rogue.mjs holds the
// ones the engine fails today.
import assert from "node:assert/strict";
import { clauseSuite, openRig, prof, MOD } from "./lib/sweep-clauses-martial.mjs";
import { KNOWN, SKIP } from "./lib/sweep-clauses-martial-known-rogue.mjs";

const { probe, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
const RAPIER = { equipment: [{ name: "Rapier", qty: 1, equipped: true }] };
const CASTER = { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: ["Burning Hands"], cantrips: ["Mage Hand"] };
const expr = (hit) => String(hit?.damage?.breakdown?.expression ?? "");
const sneakDice = (level) => Math.ceil(level / 2);

// ---- Assassin ----
{
  const r = await openRig();
  const { world, kit, hero, stage, swing, sheet, foe, forced, give } = r;
  await probe("death-strike-double", async () => {
    const assassin = hero("rogue", "Assassin", 17, RAPIER);
    const [enemy] = await stage(assassin);
    kit.saveEncounter({ ...world.encounter(), surprisedIds: [enemy.id] });
    const hit = await swing(assassin, enemy, [15, 15, ...new Array(30).fill(2)]);
    assert.equal(hit.result.crit, true, "the staging: Assassinate's critical hit on a surprised creature");
    assert.equal(hit.result.hit, true, hit.error);
    const dealt = 300 - foe(enemy).currentHp;
    // A critical hit (Assassinate) doubles the dice: 2 x (1d8 + 9d6) of 2s,
    // plus Dexterity; Death Strike doubles all of it on a failed save.
    const crit = 2 * 2 * (1 + sneakDice(17)) + MOD;
    assert.equal(dealt, 2 * crit, `a surprised creature that failed (every die a 2) its Constitution save took ${dealt}, the hit alone being ${crit}`);
  });
}

// ---- Arcane Trickster ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, budget, give, forced, show } = r;
  const third = await import("../src/lib/srd/third-caster.ts");
  await probe("arcane-trickster-casting", () => {
    const profile = third.thirdCasterProfileForFeature("Spellcasting (Arcane Trickster)");
    assert.equal(third.thirdCasterAbility(profile), "int");
    assert.equal(third.thirdCasterList(profile), "wizard");
    assert.deepEqual([...third.thirdCasterSchools(profile)].sort(), ["enchantment", "illusion"]);
    assert.equal(third.isThirdCaster("rogue", "Arcane Trickster"), true);
  });

  const trickster = hero("rogue", "Arcane Trickster", 13, { ...RAPIER, spellcasting: CASTER });
  await probe("magical-ambush", async () => {
    const [enemy] = await stage(trickster);
    give(trickster, "hidden");
    world.diceLog();
    const out = await forced([18, 2, 5, 5, 5], () => world.invoke("aoe_damage", { casterCharacterId: trickster.id, spell: "Burning Hands", level: 1, enemyIds: [enemy.id], saveAbility: "dex", dc: 14 }));
    assert.equal(out.ok, true, out.error);
    assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 2, "the creature the trickster is hidden from saves with one d20");
  });

  await probe("versatile-trickster", async () => {
    const [enemy] = await stage(trickster);
    const out = await spend(trickster, "Versatile Trickster", { targetEnemyId: enemy.id });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal((await swing(trickster, enemy, [15, 15, 4])).toHit.advantage, "advantage");
  });
}

// ---- Mastermind ----
{
  const r = await openRig();
  const { world, kit, hero, stage, react, enemyHits, sheet, budget, act, show } = r;
  const mastermind = hero("rogue", "Mastermind", 13, { ...RAPIER, ac: 5 });
  const ally = hero("fighter", "Champion", 5);
  await probe("master-of-tactics-help", async () => {
    const [enemy] = await stage(mastermind, { cast: [[ally, 6, 6]] });
    const out = await act(mastermind, "help", { bonus: true, targetCharacterId: ally.id, targetEnemyId: enemy.id });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal(budget().actionUsed ?? false, false, "and not the action");
  });
  await probe("misdirection-within-5-feet", async () => {
    const [enemy] = await stage(mastermind, { cast: [[ally, 5, 9]] });
    await enemyHits(enemy, mastermind, [16, 4]);
    const out = await react(mastermind, "Misdirection", { targetCharacterId: ally.id }, [16, 4]);
    assert.equal(out.ok, false, `the attack was turned onto an ally 20 feet away, no cover between: ${show(out)}`);
  });
}

// ---- Swashbuckler ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, budget, d20s, show } = r;
  const swash = hero("rogue", "Swashbuckler", 13, RAPIER);
  await probe("fancy-footwork", async () => {
    const [enemy] = await stage(swash);
    await swing(swash, enemy, [15, 4]);
    world.diceLog();
    assert.equal(await r.walk(swash, 2, 5), 200);
    assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 0, "the creature the swashbuckler attacked made an opportunity attack as they left");
  });
  await probe("elegant-maneuver", async () => {
    await stage(swash);
    const out = await spend(swash, "Elegant Maneuver");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal(d20s(await roll(swash, { kind: "skill_check", skill: "acrobatics", dc: 10 })), 2, "the next Acrobatics check");
    assert.equal(d20s(await roll(swash, { kind: "skill_check", skill: "acrobatics", dc: 10 })), 1, "only the next");
  });
}

// ---- Inquisitive ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, budget, act, d20s, walk, show } = r;
  const SKILLED = { skills: ["insight", "perception", "investigation"], saves: [], expertise: [], languages: ["Common"], tools: [], armor: ["light"], weapons: ["simple", "martial"] };
  const inquisitive = hero("rogue", "Inquisitive", 9, { ...RAPIER, proficiencies: SKILLED });
  await probe("ear-for-deceit-floor", async () => {
    await kit.endFight();
    const out = await roll(inquisitive, { kind: "skill_check", skill: "insight", dc: 15, reason: "is the merchant lying about the price?" }, [3]);
    assert.equal(out.total, 8 + MOD + prof(9), `a 3 on an Insight check for a lie totals ${out.total}`);
  });
  await probe("ear-for-deceit-lies-only", async () => {
    await kit.endFight();
    const out = await roll(inquisitive, { kind: "skill_check", skill: "insight", dc: 15, reason: "reading the mood of the crowd" }, [3]);
    assert.equal(out.total, 3 + MOD + prof(9), `a 3 on an Insight check about no lie is floored to 8 (${out.total})`);
  });
  await probe("eye-for-detail", async () => {
    await stage(inquisitive);
    const out = await act(inquisitive, "search", { bonus: true });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal(budget().actionUsed ?? false, false);
  });
  await probe("insightful-fighting-sneak", async () => {
    const [enemy] = await stage(inquisitive);
    const out = await spend(inquisitive, "Insightful Fighting", { targetEnemyId: enemy.id }, [20, 1]);
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true);
    kit.freshTurn();
    const hit = await swing(inquisitive, enemy, [15, 4, 4, 4, 4, 4, 4]);
    assert.match(expr(hit), new RegExp(`${sneakDice(9)}d6`), `alone, no advantage, the hit after Insightful Fighting: ${expr(hit)}`);
  });
  await probe("steady-eye-advantage", async () => {
    await stage(inquisitive);
    assert.equal(d20s(await roll(inquisitive, { kind: "skill_check", skill: "perception", dc: 10 })), 2, "Perception, not having moved");
    assert.equal(d20s(await roll(inquisitive, { kind: "skill_check", skill: "investigation", dc: 10 })), 2, "Investigation, not having moved");
  });
  await probe("steady-eye-half-speed", async () => {
    await stage(inquisitive);
    assert.equal(await walk(inquisitive, 11, 5), 200, "the staging: a 30-foot walk");
    assert.equal(d20s(await roll(inquisitive, { kind: "skill_check", skill: "perception", dc: 10 })), 1, "after moving its whole speed the rogue still searches with advantage");
  });
}

// ---- Scout ----
{
  const r = await openRig();
  const { world, kit, hero, stage, swing, roll, sheet, foeHas, untilTurnOf, show } = r;
  const scout = hero("rogue", "Scout", 17, RAPIER);
  const ally = hero("fighter", "Champion", 5);
  await probe("ambush-master-mark", async () => {
    const [enemy] = await stage(scout, { cast: [[ally, 6, 6]] });
    const hit = await swing(scout, enemy, [15, 4]);
    assert.equal(hit.result.hit, true, hit.error);
    kit.giveTurn(ally.id);
    assert.equal((await swing(ally, enemy, [15, 15, 4])).toHit.advantage, "advantage", "an ally attacks the creature the scout hit first");
  });
  await probe("sudden-strike-bonus-attack", async () => {
    const [enemy] = await stage(scout);
    await swing(scout, enemy, [15, 4]);
    const out = await swing(scout, enemy, [15, 4], { bonusAttack: "feature" });
    assert.equal(out.ok, true, `the bonus-action attack after the Attack action: ${String(out.error).slice(0, 100)}`);
    assert.equal(r.budget().bonusUsed, true);
  });
  await probe("sudden-strike-second-sneak", async () => {
    const [first, second] = await stage(scout, { enemies: 2, cast: [[ally, 6, 4]] });
    kit.place(second.id, 5, 6);
    kit.place(ally.id, 6, 6);
    const one = await swing(scout, first, [15, ...new Array(12).fill(1)]);
    const two = await swing(scout, second, [15, ...new Array(12).fill(1)], { bonusAttack: "feature" });
    assert.match(expr(one), /d6/, `the first hit: ${expr(one)}`);
    assert.match(expr(two), new RegExp(`${sneakDice(17)}d6`), `a second Sneak Attack against another creature in the turn: ${expr(two)}`);
  });
}

// ---- Phantom ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, sheet, foe, give, d20s, show } = r;
  const phantom = hero("rogue", "Phantom", 9, RAPIER);
  await probe("wails-from-the-grave", async () => {
    const [first, second] = await stage(phantom, { enemies: 2, cast: [] });
    kit.setEnemy(first.id, { conditions: ["prone"] });
    const hit = await swing(phantom, first, [15, 15, ...new Array(12).fill(2)]);
    assert.equal(hit.result.hit, true, hit.error);
    const before = foe(second).currentHp;
    const out = await spend(phantom, "Wails from the Grave", { targetEnemyId: second.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(before - foe(second).currentHp, 2 * Math.ceil(sneakDice(9) / 2), `half the sneak attack dice (3d6 of 2s) in necrotic to a second creature 15 feet off: ${show(out)}`);
  });
  await probe("tokens-save-advantage", async () => {
    await kit.endFight();
    give(phantom, "soul trinket", { rounds: 14400 });
    assert.equal(d20s(await roll(phantom, { kind: "saving_throw", ability: "con", dc: 10 })), 2, "a Constitution save while carrying a trinket");
  });
}

// ---- Soulknife ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, has, budget, foe, show } = r;
  const knife = hero("rogue", "Soulknife", 13, RAPIER);
  await probe("psychic-veil", async () => {
    await stage(knife);
    const out = await spend(knife, "Psychic Veil");
    assert.equal(out.ok, true, out.error);
    assert.ok(has(knife, "invisible"), "invisible");
    assert.equal(budget().actionUsed, true, "the action");
    assert.equal(sheet(knife).conditionMeta.invisible?.rounds, 600, "an hour");
  });
  await probe("psychic-veil-ends-on-damage", async () => {
    const [enemy] = await stage(knife);
    await spend(knife, "Psychic Veil");
    kit.freshTurn();
    const hit = await swing(knife, enemy, [15, 15, 4, 4, 4, 4, 4, 4, 4, 4]);
    assert.equal(hit.result.hit, true, hit.error);
    assert.ok(!has(knife, "invisible"), "the soulknife dealt damage and is still invisible");
  });
}

finish();
