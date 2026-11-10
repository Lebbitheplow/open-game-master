// The clause ledger's monk probes: the sentences of the authored monk
// subclass features (src/lib/srd/subclasses.json) that no existing suite ran,
// each run through the engine. scripts/clauses/martial.json names every probe
// here by its id; scripts/lib/sweep-clauses-martial-known-monk.mjs holds the
// ones the engine fails today.
import assert from "node:assert/strict";
import { clauseSuite, openRig, prof, MOD } from "./lib/sweep-clauses-martial.mjs";
import { KNOWN, SKIP } from "./lib/sweep-clauses-martial-known-monk.mjs";

const { probe, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
const BARE = { equipment: [] };
const UNARMED = { weapon: "unarmed strike" };
const die = (level) => (level >= 17 ? 10 : level >= 11 ? 8 : level >= 5 ? 6 : 4);
const expr = (hit) => String(hit?.damage?.breakdown?.expression ?? hit?.result?.damage?.expression ?? "");

// ---- Way of Shadow ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, budget, has, show } = r;
  const shadow = hero("monk", "Way of Shadow", 11, BARE);

  await probe("shadow-step-advantage", async () => {
    const [enemy] = await stage(shadow);
    const out = await spend(shadow, "Shadow Step");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the bonus action");
    assert.equal((await swing(shadow, enemy, [15, 15, 3], UNARMED)).toHit.advantage, "advantage", "the next melee attack");
    assert.equal((await swing(shadow, enemy, [15, 15, 3], UNARMED)).toHit.advantage, "none", "only the next one");
  });

  await probe("cloak-of-shadows", async () => {
    await stage(shadow);
    const out = await spend(shadow, "Cloak of Shadows");
    assert.ok(out.ok && has(shadow, "invisible"), `Cloak of Shadows: ${show(out)}; the monk carries [${sheet(shadow).conditions.join(", ")}]`);
  });
}

// ---- Way of the Four Elements ----
{
  const options = await import("../src/lib/srd/options.ts");
  await probe("elemental-disciplines-known", () => {
    const known = [3, 6, 11, 17].map((level) => options.optionSlotsFor("monk", "Way of the Four Elements", level, "discipline") ?? options.optionSlotsFor("monk", "Way of the Four Elements", level, "elemental discipline"));
    assert.deepEqual(known, [2, 3, 4, 5], `disciplines known at 3, 6, 11, 17: ${JSON.stringify(known)}`);
  });
}

// ---- Way of the Drunken Master ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, used, give, moveTiles, show } = r;
  const drunk = hero("monk", "Way of the Drunken Master", 17, BARE);

  // 55 feet of walking at 17th level: a square 65 feet off is beyond it
  // until Flurry of Blows adds its 10 feet.
  await probe("drunken-technique-movement", async () => {
    const [control] = await stage(drunk);
    kit.place(control.id, 4, 4);
    assert.equal(await r.walk(drunk, 16, 5), 200, "the staging is wrong: the monk cannot walk the 55 feet of their speed");
    const [enemy] = await stage(drunk);
    kit.place(enemy.id, 4, 4);
    assert.notEqual(await r.walk(drunk, 18, 5), 200, "the staging is wrong: the monk walked 65 feet with no Flurry of Blows");
    await swing(drunk, enemy, [15, 3], UNARMED);
    const out = await swing(drunk, enemy, [15, 3], { ...UNARMED, feature: "flurry of blows" });
    assert.equal(out.ok, true, out.error);
    assert.equal(await r.walk(drunk, 18, 5), 200, "after Flurry of Blows the monk still cannot walk 65 feet: no 10 feet of extra movement");
  });
  await probe("drunken-technique-disengage", async () => {
    const [enemy] = await stage(drunk);
    await swing(drunk, enemy, [15, 3], UNARMED);
    const out = await swing(drunk, enemy, [15, 3], { ...UNARMED, feature: "flurry of blows" });
    assert.equal(out.ok, true, out.error);
    world.diceLog();
    assert.equal(await r.walk(drunk, 2, 5), 200);
    assert.equal(world.diceLog().filter((d) => d.sides === 20).length, 0, "leaving the creature after Flurry of Blows drew an opportunity attack: no Disengage");
  });

  await probe("drunkards-luck", async () => {
    const [enemy] = await stage(drunk);
    give(drunk, "poisoned");
    const out = await spend(drunk, "Drunkard's Luck", { variant: "attack" });
    assert.equal(out.ok, true, out.error);
    assert.equal(used(drunk, "ki"), 2, "2 ki");
    const swung = await swing(drunk, enemy, [15, 2, 3], UNARMED);
    assert.equal(swung.toHit.advantage, "none", `the poisoned monk's attack after Drunkard's Luck is rolled with ${swung.toHit.advantage}`);
  });

  await probe("intoxicated-frenzy-different-creatures", async () => {
    const [enemy] = await stage(drunk);
    await swing(drunk, enemy, [15, 3], UNARMED);
    await swing(drunk, enemy, [15, 3], UNARMED);
    const strikes = [];
    for (let count = 0; count < 5; count += 1) strikes.push((await swing(drunk, enemy, [15, 3], { ...UNARMED, feature: "flurry of blows" })).ok);
    assert.ok(strikes.filter(Boolean).length <= 2, `Flurry of Blows struck one creature ${strikes.filter(Boolean).length} times: the extra attacks went to the same target`);
  });
}

// ---- Way of the Kensei ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, used, budget, show } = r;
  const SWORD = { equipment: [{ name: "Longsword", qty: 1, equipped: true }] };

  await probe("agile-parry-needs-an-unarmed-strike", async () => {
    const kensei = hero("monk", "Way of the Kensei", 3, SWORD);
    await stage(kensei);
    const out = await spend(kensei, "Agile Parry");
    assert.equal(out.ok, false, `Agile Parry with no unarmed strike made this turn: ${show(out)}`);
  });

  const blade = hero("monk", "Way of the Kensei", 11, SWORD);
  await probe("one-with-the-blade-deft-strike", async () => {
    const [enemy] = await stage(blade);
    const hit = await swing(blade, enemy, [15, 4]);
    assert.equal(hit.result.hit, true, hit.error);
    const before = r.foe(enemy).currentHp;
    const out = await spend(blade, "One with the Blade", { targetEnemyId: enemy.id }, 4);
    assert.ok(out.ok && before - r.foe(enemy).currentHp === 4, `1 ki for the martial arts die on the hit: ${show(out)}`);
  });

  await probe("sharpen-the-blade", async () => {
    const [enemy] = await stage(blade);
    const out = await spend(blade, "Sharpen the Blade", { amount: 2 });
    assert.equal(out.ok, true, out.error);
    assert.equal(used(blade, "ki"), 2, "2 ki for +2");
    assert.equal(budget().bonusUsed, true, "the bonus action");
    const hit = await swing(blade, enemy, [10, 4]);
    assert.match(String(hit.toHit.expression), /\+2\b/, `the attack: ${hit.toHit.expression}`);
    assert.match(expr(hit), /\+2\b/, `the damage: ${expr(hit)}`);
  });
}

// ---- Way of the Sun Soul ----
{
  const r = await openRig();
  const { world, kit, hero, stage, enemyHits, sheet, foe } = r;
  await probe("sun-shield-retaliate", async () => {
    const sun = hero("monk", "Way of the Sun Soul", 17, { ...BARE, ac: 5 });
    const [enemy] = await stage(sun);
    const before = foe(enemy).currentHp;
    await enemyHits(enemy, sun, [16, 4]);
    assert.equal(before - foe(enemy).currentHp, 5 + MOD, "5 + Wisdom radiant to the creature that hit in melee");
  });
}

// ---- Way of the Long Death ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, sheet, foeHas, budget, enemyHits, show } = r;
  const death = hero("monk", "Way of the Long Death", 11, { ...BARE, ac: 5 });

  await probe("hour-of-reaping", async () => {
    const [near, far] = await stage(death, { enemies: 2 });
    kit.place(far.id, 13, 5);
    const out = await spend(death, "Hour of Reaping", {}, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().actionUsed, true, "the action");
    assert.deepEqual([foeHas(near, "frightened"), foeHas(far, "frightened")], [true, false], `a creature 5 feet off and one 40 feet off, both failing: ${show(out)}`);
  });

  await probe("mastery-of-death", async () => {
    const [enemy] = await stage(death);
    world.patch(death.id, { currentHp: 3 });
    await enemyHits(enemy, death, [16, 4]);
    const out = await spend(death, "Mastery of Death");
    assert.ok(out.ok && sheet(death).currentHp === 1 && !r.has(death, "unconscious"), `dropped to 0 with ki left: ${show(out)}; at ${sheet(death).currentHp} hit points, [${sheet(death).conditions.join(", ")}]`);
  });
}

// ---- Way of Mercy ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, foe, used, budget, show } = r;
  const mercy = hero("monk", "Way of Mercy", 6, BARE);
  const ally = hero("fighter", "Champion", 5);
  const far = hero("fighter", "Champion", 5);

  await probe("hand-of-healing", async () => {
    await stage(mercy, { cast: [[ally, 5, 6], [far, 5, 9]] });
    world.patch(ally.id, { currentHp: 40 });
    const out = await spend(mercy, "Hand of Healing", { targetCharacterId: ally.id }, 4);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(ally).currentHp, 40 + 4 + MOD, "the martial arts die (a 4) + Wisdom");
    assert.equal(used(mercy, "ki"), 1, "1 ki");
    assert.equal(budget().actionUsed, true, "the action");
  });
  await probe("hand-of-healing-5-feet", async () => {
    await stage(mercy, { cast: [[far, 5, 9]] });
    world.patch(far.id, { currentHp: 40 });
    const out = await spend(mercy, "Hand of Healing", { targetCharacterId: far.id }, 4);
    assert.equal(out.ok, false, `an ally 20 feet away was healed for ${sheet(far).currentHp - 40}`);
  });

  await probe("hand-of-harm", async () => {
    const [enemy] = await stage(mercy);
    const hit = await swing(mercy, enemy, [15, 3], UNARMED);
    assert.equal(hit.result.hit, true, hit.error);
    const before = foe(enemy).currentHp;
    const out = await spend(mercy, "Hand of Harm", { targetEnemyId: enemy.id }, 4);
    assert.equal(out.ok, true, out.error);
    assert.equal(before - foe(enemy).currentHp, 4 + MOD, "the die (a 4) + Wisdom");
    assert.match(JSON.stringify(out.result), /necrotic/i);
    assert.equal(used(mercy, "ki"), 1);
    await swing(mercy, enemy, [15, 3], UNARMED);
    assert.equal((await spend(mercy, "Hand of Harm", { targetEnemyId: enemy.id }, 4)).ok, false, "once per turn");
  });

  await probe("hand-of-ultimate-mercy-revives", async () => {
    const master = hero("monk", "Way of Mercy", 17, BARE);
    const fallen = hero("fighter", "Champion", 5);
    await kit.endFight();
    world.patch(fallen.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
    const out = await spend(master, "Hand of Ultimate Mercy", { targetCharacterId: fallen.id }, 5);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(fallen).currentHp, 4 * 5 + MOD, "4d10 (four 5s) + Wisdom");
    assert.equal(sheet(fallen).deathSaves?.dead ?? false, false, "back to life");
    assert.equal(used(master, "ki"), 5, "5 ki");
  });
}

// ---- Way of the Astral Self ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, roll, sheet, foe, used, budget, d20s, has, show } = r;
  const astral = hero("monk", "Way of the Astral Self", 17, { ...BARE, abilities: { str: 8, wis: 18 } });

  await probe("arms-of-the-astral-self-burst", async () => {
    const [near, far] = await stage(astral, { enemies: 2 });
    kit.place(near.id, 7, 5);
    kit.place(far.id, 8, 5);
    const out = await spend(astral, "Arms of the Astral Self", {}, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true);
    assert.equal(used(astral, "ki"), 1);
    assert.deepEqual([300 - foe(near).currentHp, 300 - foe(far).currentHp], [4, 0], `two rolls of the d10 (two 2s) to the creature 10 feet off, nothing 15 feet off: ${show(out)}`);
  });
  await probe("arms-of-the-astral-self-reach", async () => {
    const [enemy] = await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    kit.place(enemy.id, 7, 5);
    const strike = await swing(astral, enemy, [15, 3], UNARMED);
    assert.equal(strike.ok, true, `with the arms out a creature 10 feet off is beyond the unarmed strike: ${String(strike.error).slice(0, 90)}`);
  });
  await probe("arms-of-the-astral-self-wisdom", async () => {
    const [enemy] = await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    const strike = await swing(astral, enemy, [15, 3], UNARMED);
    assert.equal(strike.ok, true, strike.error);
    assert.match(String(strike.toHit.expression), new RegExp(`\\+${4 + prof(17)}$`), `Wisdom for the attack: ${strike.toHit.expression}`);
    assert.match(JSON.stringify(strike.result), /force/i, "force damage");
  });
  await probe("arms-of-the-astral-self-strength-checks", async () => {
    await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    const check = await roll(astral, { kind: "ability_check", ability: "str", dc: 10 }, [10]);
    const save = await roll(astral, { kind: "saving_throw", ability: "str", dc: 10 }, [10]);
    assert.deepEqual([check.total, save.total], [10 + 4, 10 + 4], "a Strength check and save with Wisdom 18 under the arms (Strength 8)");
  });

  await probe("deflect-energy", async () => {
    await stage(astral);
    await spend(astral, "Arms of the Astral Self", {}, 2);
    world.patch(astral.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: astral.id, amount: 20, type: "fire" });
    const out = await react(astral, "Deflect Energy", {}, 5);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(astral).currentHp, 40 + 5 + 4, "1d10 (a 5) + Wisdom back");
  });

  await probe("awakened-astral-self-ac", async () => {
    await stage(astral);
    const ac = sheet(astral).ac;
    const out = await spend(astral, "Awakened Astral Self");
    assert.equal(out.ok, true, out.error);
    assert.equal(used(astral, "ki"), 5, "5 ki");
    const { deriveAc } = await import("../src/lib/srd/index.ts");
    assert.equal(deriveAc({ ...sheet(astral), acOverride: false }) - deriveAc({ ...sheet(astral), acOverride: false, conditions: [] }), 2, `+2 AC: ${show(out)}`);
    void ac;
  });
}

// ---- Way of the Ascendant Dragon ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, sheet, foeHas, has, show } = r;
  const dragon = hero("monk", "Way of the Ascendant Dragon", 11, BARE);

  await probe("wings-unfurled-needs-step-of-the-wind", async () => {
    await stage(dragon);
    const out = await spend(dragon, "Wings Unfurled");
    assert.equal(out.ok, false, `wings with no Step of the Wind used: ${show(out)}`);
  });

  await probe("aspect-of-the-wyrm-frighten", async () => {
    const [enemy] = await stage(dragon);
    const out = await spend(dragon, "Aspect of the Wyrm", { variant: "frighten" }, 2);
    assert.equal(out.ok, true, out.error);
    // On to the creature's own turn, its dice all 1s: any save it makes fails.
    r.endTurn();
    assert.ok(foeHas(enemy, "frightened"), `a creature 5 feet off, its turn begun in the aura, is not frightened: ${show(out)}`);
  });
}

finish();
