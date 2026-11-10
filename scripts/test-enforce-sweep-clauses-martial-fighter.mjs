// The clause ledger's fighter probes: the sentences of the authored fighter
// subclass features (src/lib/srd/subclasses.json) that no existing suite ran,
// each run through the engine. scripts/clauses/martial.json names every probe
// here by its id; scripts/lib/sweep-clauses-martial-known-fighter.mjs holds
// the ones the engine fails today.
import assert from "node:assert/strict";
import { clauseSuite, openRig, prof, MOD } from "./lib/sweep-clauses-martial.mjs";
import { KNOWN, SKIP } from "./lib/sweep-clauses-martial-known-fighter.mjs";

const { probe, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
const NONMAGICAL = { stats: { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } };
const CASTER = { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: ["Burning Hands"], cantrips: ["Fire Bolt"] };
const BOW = { equipment: [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] };
const d20sOf = (log) => log.filter((die) => die.sides === 20).map((die) => die.face);

// ---- Battle Master ----
{
  const r = await openRig();
  const { world, kit, hero, stage, swing, sheet, lastRoll } = r;
  const options = await import("../src/lib/srd/options.ts");

  await probe("maneuvers-known", () => {
    assert.deepEqual([3, 6, 7, 10, 14, 15, 20].map((level) => options.optionSlotsFor("fighter", "Battle Master", level, "maneuver")), [3, 3, 5, 7, 7, 9, 9]);
  });

  await probe("maneuver-dc-dexterity", async () => {
    const duelist = hero("fighter", "Battle Master", 3, { abilities: { str: 8, dex: 18 }, equipment: [{ name: "Rapier", qty: 1, equipped: true }] });
    world.patch(duelist.id, { features: [...sheet(duelist).features, { name: options.optionFeatureName("maneuver", "Trip Attack"), source: "class" }] });
    const [enemy] = await stage(duelist);
    const out = await swing(duelist, enemy, [15, 4, 5, 2], { maneuver: "Trip Attack" });
    assert.equal(out.ok, true, out.error);
    assert.equal(lastRoll("saving_throw")?.dc, 8 + prof(3) + 4, "the DC reads the better of Strength 8 and Dexterity 18");
    assert.ok(kit.enemy(enemy.id).conditions.includes("prone"));
  });
}

// ---- Eldritch Knight ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, foe, foeHas, forced, untilTurnOf, endTurn, show } = r;
  const third = await import("../src/lib/srd/third-caster.ts");
  const burn = (caster, enemy) =>
    forced([5, 5, 5, 18, 2, 9], () => world.invoke("aoe_damage", { casterCharacterId: caster.id, spell: "Burning Hands", level: 1, enemyIds: [enemy.id], saveAbility: "dex", dc: 14 }));

  await probe("eldritch-knight-casting", () => {
    const profile = third.thirdCasterProfileForFeature("Spellcasting (Eldritch Knight)");
    assert.equal(third.thirdCasterAbility(profile), "int");
    assert.equal(third.thirdCasterList(profile), "wizard");
    assert.deepEqual([...third.thirdCasterSchools(profile)].sort(), ["abjuration", "evocation"]);
    assert.deepEqual(third.thirdCasterSlots(3), { 1: 2 });
    assert.deepEqual(third.thirdCasterSlots(7), { 1: 4, 2: 2 });
    assert.equal(third.isThirdCaster("fighter", "Eldritch Knight"), true);
  });

  const knight = hero("fighter", "Eldritch Knight", 10, { spellcasting: CASTER });
  const wizard = hero("wizard", "School of Evocation", 5, { spellcasting: CASTER });

  await probe("eldritch-strike-next-save", async () => {
    const [enemy] = await stage(knight);
    const hit = await swing(knight, enemy);
    assert.equal(hit.result.hit, true, hit.error);
    assert.ok(foeHas(enemy, "eldritch strike"), "the hit laid no mark");
    kit.freshTurn();
    world.diceLog();
    const first = await burn(knight, enemy);
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(d20sOf(world.diceLog()), [18, 2], "the marked creature rolls its save twice");
    assert.equal(first.result.results[0].success, false, "and keeps the lower");
    kit.freshTurn();
    world.diceLog();
    await burn(knight, enemy);
    assert.equal(d20sOf(world.diceLog()).length, 1, "only its next save: the one after is straight");
  });

  await probe("eldritch-strike-spell-of-yours", async () => {
    const [enemy] = await stage(knight, { cast: [[wizard, 5, 6]] });
    await swing(knight, enemy);
    kit.giveTurn(wizard.id);
    world.diceLog();
    const out = await burn(wizard, enemy);
    assert.equal(out.ok, true, out.error);
    assert.equal(d20sOf(world.diceLog()).length, 1, "another caster's spell is saved against straight");
    assert.ok(foeHas(enemy, "eldritch strike"), "and leaves the knight's mark for the knight's spell");
  });

  await probe("eldritch-strike-until-end-of-next-turn", async () => {
    const [enemy] = await stage(knight);
    await swing(knight, enemy);
    untilTurnOf(knight);
    assert.ok(foeHas(enemy, "eldritch strike"), "the mark is gone before the knight's next turn is over");
    endTurn();
    assert.ok(!foeHas(enemy, "eldritch strike"), "the mark outlives the end of the knight's next turn");
  });

  await probe("arcane-charge-teleport", async () => {
    const charger = hero("fighter", "Eldritch Knight", 15);
    await stage(charger);
    const out = await spend(charger, "Action Surge");
    assert.equal(out.ok, true, out.error);
    assert.match(JSON.stringify(out.result), /teleport/i, `Action Surge for an Eldritch Knight of 15th level offers no teleport: ${show(out)}`);
  });

  await probe("improved-war-magic", async () => {
    const seventh = hero("fighter", "Eldritch Knight", 7, { spellcasting: CASTER });
    const master = hero("fighter", "Eldritch Knight", 18, { spellcasting: CASTER });
    for (const [who, allowed] of [[seventh, false], [master, true]]) {
      const [enemy] = await stage(who);
      const cast = await burn(who, enemy);
      assert.equal(cast.ok, true, cast.error);
      const out = await swing(who, enemy, [15, 4], { bonusAttack: "feature" });
      assert.equal(out.ok, allowed, `level ${sheet(who).level} after a 1st-level spell: ${out.error ?? "the bonus attack was made"}`);
    }
  });
}

// ---- Arcane Archer ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, foe, used, show } = r;
  const options = await import("../src/lib/srd/options.ts");
  const features = await import("../src/lib/srd/features.ts");
  const archer = hero("fighter", "Arcane Archer", 7, BOW);
  const blade = hero("fighter", "Arcane Archer", 7);
  const champion = hero("fighter", "Champion", 7);

  await probe("arcane-shot-once-per-turn", async () => {
    const [enemy] = await stage(archer);
    const first = await spend(archer, "Arcane Shot", { targetEnemyId: enemy.id });
    assert.equal(first.ok, true, first.error);
    const second = await spend(archer, "Arcane Shot", { targetEnemyId: enemy.id });
    assert.equal(second.ok, false, `a second Arcane Shot in one turn was taken (${used(archer, "sub_arcane_shot")} of 2 spent, no arrow fired)`);
  });

  await probe("arcane-shot-options", () => {
    assert.notDeepEqual(options.optionLabelsOpenedBy("fighter", "Arcane Shot"), [], "Arcane Shot opens no pick of its options");
  });

  await probe("arcane-archer-lore-cantrip", () => {
    const taught = JSON.stringify(features.subclassSpellsFor("fighter", "Arcane Archer", 3));
    const picks = JSON.stringify(sheet(archer).features.map((feature) => feature.name));
    assert.match(`${taught} ${picks}`, /prestidigitation|druidcraft/i, `no table and no pick gives the cantrip (spells: ${taught})`);
  });

  await probe("magic-arrow-magical", async () => {
    const [enemy] = await stage(archer);
    kit.setEnemy(enemy.id, NONMAGICAL);
    kit.place(enemy.id, 10, 5);
    const shot = await swing(archer, enemy, [15, 4], { weapon: "Longbow" });
    assert.equal(shot.result.hit, true, shot.error);
    assert.equal(300 - foe(enemy).currentHp, 4 + MOD, "the arrow's damage is not halved");
  });

  await probe("magic-arrow-arrows-only", async () => {
    const lost = {};
    for (const [name, who] of [["archer", blade], ["champion", champion]]) {
      const [enemy] = await stage(who);
      kit.setEnemy(enemy.id, NONMAGICAL);
      const cut = await swing(who, enemy, [15, 4]);
      assert.equal(cut.result.hit, true, cut.error);
      lost[name] = 300 - foe(enemy).currentHp;
    }
    assert.equal(lost.archer, lost.champion, `an Arcane Archer's longsword deals ${lost.archer} through resistance to nonmagical weapons, a Champion's ${lost.champion}`);
  });

  await probe("curving-shot-60-feet", async () => {
    const [first, second] = await stage(archer, { enemies: 2 });
    kit.setEnemy(first.id, { ac: 30 });
    kit.place(archer.id, 0, 5);
    kit.place(first.id, 2, 5);
    kit.place(second.id, 19, 5);
    const miss = await swing(archer, first, [2], { weapon: "Longbow" });
    assert.equal(miss.result.hit, false, miss.error);
    const curved = await swing(archer, second, [15, 4], { weapon: "Longbow", bonusAttack: "feature" });
    assert.equal(curved.ok, false, "the arrow curved to a creature 85 feet from the one it missed");
  });
}

// ---- Cavalier ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, enemyHits, roll, sheet, foe, foeHas, d20s, rollBy, moveTiles, untilTurnOf, endTurn, show } = r;
  const cavalier = hero("fighter", "Cavalier", 15);
  const ally = hero("fighter", "Champion", 5, { ac: 5 });
  const bowman = hero("fighter", "Cavalier", 3, BOW);

  await probe("born-to-the-saddle-saves", async () => {
    await kit.endFight();
    assert.equal(d20s(await roll(cavalier, { kind: "saving_throw", ability: "dex", dc: 10, against: "dismount" })), 2);
    assert.equal(d20s(await roll(cavalier, { kind: "saving_throw", ability: "dex", dc: 10 })), 1);
  });

  await probe("born-to-the-saddle-mounting", async () => {
    await stage(cavalier);
    const before = moveTiles(cavalier);
    const out = await world.invoke("mount_up", { characterId: cavalier.id, mount: "warhorse" });
    assert.equal(out.ok, true, out.error);
    assert.match(JSON.stringify(out.result), /Mounting cost[^.]*\(5 ft\)/, `mounting cost a Cavalier more than 5 feet (${before} squares before): ${show(out)}`);
  });

  await probe("born-to-the-saddle-fall", () => {});

  await probe("unwavering-mark-melee-hit", async () => {
    const [enemy] = await stage(cavalier, { cast: [[ally, 7, 5]] });
    await swing(cavalier, enemy);
    assert.ok(foeHas(enemy, "unwavering mark"));
    await enemyHits(enemy, ally, [15, 12, 4]);
    assert.equal(rollBy("attack", ally.id, enemy).advantage, "disadvantage", "a marked creature beside the cavalier attacks an ally straight");
    world.patch(cavalier.id, { ac: 5, acOverride: true });
    await enemyHits(enemy, cavalier, [15, 4]);
    assert.equal(rollBy("attack", cavalier.id, enemy).advantage, "none", "and the cavalier at no disadvantage");
    const [other] = await stage(bowman);
    kit.place(other.id, 10, 5);
    const shot = await swing(bowman, other, [15, 4], { weapon: "Longbow" });
    assert.equal(shot.result.hit, true, shot.error);
    assert.ok(!foeHas(other, "unwavering mark"), "an arrow marks nothing: the mark rides a melee weapon attack");
  });

  await probe("unwavering-mark-until-end-of-next-turn", async () => {
    const [enemy] = await stage(cavalier, { cast: [[ally, 7, 5]] });
    await swing(cavalier, enemy);
    untilTurnOf(cavalier);
    assert.ok(foeHas(enemy, "unwavering mark"), "the mark is gone as the cavalier's next turn starts, not when it ends");
  });

  await probe("unwavering-mark-within-5-feet", async () => {
    const [enemy] = await stage(cavalier, { cast: [[ally, 9, 5]] });
    await swing(cavalier, enemy);
    kit.place(enemy.id, 8, 5);
    await enemyHits(enemy, ally, [15, 12, 4]);
    assert.equal(rollBy("attack", ally.id, enemy).advantage, "none", "a marked creature 15 feet from the cavalier still attacks an ally at disadvantage");
  });

  const warder = hero("fighter", "Cavalier", 7);
  const struck = async (ac) => {
    const [enemy] = await stage(ally, { cast: [[warder, 5, 6]] });
    world.patch(ally.id, { ac, acOverride: true });
    await enemyHits(enemy, ally, [16, 4]);
    return enemy;
  };
  await probe("warding-maneuver-ac", async () => {
    await struck(13);
    const hurt = sheet(ally).currentHp;
    const out = await react(warder, "Warding Maneuver", { targetCharacterId: ally.id }, [8]);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(ally).currentHp, hurt + 6, "a 20 against AC 13 + 8 is a miss: the 6 comes back");
  });
  await probe("warding-maneuver-resistance", async () => {
    await struck(13);
    const hurt = sheet(ally).currentHp;
    const out = await react(warder, "Warding Maneuver", { targetCharacterId: ally.id }, [1]);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(ally).currentHp, hurt + 3, "a 20 against AC 13 + 1 still hits, for half of 6");
  });

  const line = hero("fighter", "Cavalier", 10);
  const onEnemyTurn = async () => {
    const [enemy] = await stage(line);
    const encounter = world.encounter();
    kit.saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((entry) => !entry.characterId), turnBudget: null });
    const out = await react(line, "Hold the Line", { targetEnemyId: enemy.id }, [15, 4, 4]);
    assert.equal(out.ok, true, out.error);
    return enemy;
  };
  await probe("hold-the-line-speed-0", async () => {
    const enemy = await onEnemyTurn();
    assert.ok(foeHas(enemy, "held in place"), "the opportunity attack's hit left the creature free to move");
    const at = kit.token(enemy.id);
    const moved = await world.invoke("move_token", { token: enemy.id, x: at.x + 3, y: at.y });
    assert.ok(moved.ok === false || kit.token(enemy.id).x === at.x, `a creature held in place walked on: ${show(moved)}`);
  });
  await probe("hold-the-line-until-turn-ends", async () => {
    const enemy = await onEnemyTurn();
    endTurn();
    assert.ok(!foeHas(enemy, "held in place"), "the creature is still held after the turn it was hit in");
  });

  await probe("ferocious-charger-save", async () => {
    const [enemy] = await stage(cavalier);
    const dc = 8 + prof(15) + MOD;
    const made = await spend(cavalier, "Ferocious Charger", { targetEnemyId: enemy.id }, [dc - 1]);
    assert.equal(made.ok, true, made.error);
    assert.deepEqual([made.result.dc, made.result.saved], [dc, true], "the dummy saves at +1");
    assert.ok(!foeHas(enemy, "prone"));
    kit.freshTurn();
    const failed = await spend(cavalier, "Ferocious Charger", { targetEnemyId: enemy.id }, [dc - 2]);
    assert.equal(failed.result.saved, false);
    assert.ok(foeHas(enemy, "prone"));
    const again = await spend(cavalier, "Ferocious Charger", { targetEnemyId: enemy.id }, [2]);
    assert.equal(again.ok, false, "once on each of their turns");
  });

  await probe("ferocious-charger-needs-a-charge", async () => {
    const [enemy] = await stage(cavalier);
    const out = await spend(cavalier, "Ferocious Charger", { targetEnemyId: enemy.id }, [2]);
    assert.equal(out.ok, false, "a cavalier who has not moved and has hit nothing knocked the creature prone");
  });
}

// ---- Samurai ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, sheet, budget, has, untilTurnOf } = r;

  await probe("fighting-spirit-advantage-this-turn", async () => {
    const samurai = hero("fighter", "Samurai", 3);
    const [enemy] = await stage(samurai);
    const out = await spend(samurai, "Fighting Spirit");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "it takes the bonus action");
    assert.equal((await swing(samurai, enemy, [15, 15, 4])).toHit.advantage, "advantage");
    untilTurnOf(samurai);
    assert.equal((await swing(samurai, enemy, [15, 15, 4])).toHit.advantage, "none", "the advantage lasts into the next turn");
  });

  await probe("fighting-spirit-temporary-hit-points", async () => {
    for (const [level, temp] of [[3, 5], [9, 5], [10, 10], [14, 10], [15, 15], [20, 15]]) {
      const samurai = hero("fighter", "Samurai", level);
      await stage(samurai);
      await spend(samurai, "Fighting Spirit");
      assert.equal(sheet(samurai).tempHp, temp, `level ${level}`);
    }
  });

  const courtier = hero("fighter", "Samurai", 7, { abilities: { wis: 14, cha: 10 } });
  const plain = hero("fighter", "Champion", 7, { abilities: { wis: 14, cha: 10 } });
  await probe("elegant-courtier-persuasion", async () => {
    await kit.endFight();
    const mine = (await roll(courtier, { kind: "skill_check", skill: "persuasion", dc: 10 })).total;
    const theirs = (await roll(plain, { kind: "skill_check", skill: "persuasion", dc: 10 })).total;
    assert.equal(mine - theirs, 2, `Wisdom 14 adds nothing to the samurai's Persuasion (${mine} against a Champion's ${theirs})`);
  });
  await probe("elegant-courtier-wisdom-save", async () => {
    await kit.endFight();
    const mine = (await roll(courtier, { kind: "saving_throw", ability: "wis", dc: 10 })).total;
    const theirs = (await roll(plain, { kind: "saving_throw", ability: "wis", dc: 10 })).total;
    assert.equal(mine - theirs, prof(7), `a samurai of 7th level saves on Wisdom with no proficiency (${mine} against a Champion's ${theirs})`);
  });

  await probe("rapid-strike-same-target", async () => {
    const samurai = hero("fighter", "Samurai", 15);
    const [first, second] = await stage(samurai, { enemies: 2 });
    kit.place(second.id, 5, 6);
    await spend(samurai, "Fighting Spirit");
    const traded = await swing(samurai, first, [15, 15, 4], { rapidStrike: true });
    assert.equal(traded.ok, true, traded.error);
    const others = [];
    for (let count = 0; count < 3; count += 1) others.push((await swing(samurai, second, [15, 15, 4])).ok);
    assert.notDeepEqual(others, [true, true, true], "after Rapid Strike on one creature, every attack left went to another");
  });

  await probe("strength-before-death-failures", async () => {
    const samurai = hero("fighter", "Samurai", 18, { ac: 5 });
    const other = hero("fighter", "Champion", 5);
    const [enemy] = await stage(other, { cast: [[samurai, 6, 6]] });
    world.patch(samurai.id, { currentHp: 3 });
    await r.enemyHits(enemy, samurai, [16, 4]);
    assert.equal(sheet(samurai).currentHp, 0);
    const out = await spend(samurai, "Strength before Death");
    assert.equal(out.ok, true, out.error);
    assert.ok(has(samurai, "strength before death") && !has(samurai, "unconscious"));
    const hurt = await world.invoke("apply_damage", { characterId: samurai.id, amount: 4, type: "slashing" });
    assert.equal(hurt.ok, true, hurt.error);
    assert.equal(sheet(samurai).deathSaves?.failures, 1, "damage at 0 during the extra turn is a death save failure");
  });
}

// ---- Echo Knight ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, sheet, budget, show } = r;
  const echo = hero("fighter", "Echo Knight", 18);

  await probe("manifest-echo-no-door", async () => {
    await stage(echo);
    const tokens = () => JSON.stringify(kit.map()).length;
    const out = await spend(echo, "Manifest Echo");
    assert.equal(out.ok, true, `an Echo Knight has no way to manifest the echo: ${show(out)}`);
    assert.equal(budget().bonusUsed, true);
    assert.ok(tokens());
  });

  await probe("reclaim-potential-temporary-hit-points", async () => {
    await stage(echo);
    const out = await spend(echo, "Reclaim Potential", {}, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(echo).tempHp, 2 + 2 + MOD, "2d6 (two 2s) + Constitution");
  });

  await probe("legion-of-one-regains-on-initiative", async () => {
    await kit.endFight();
    r.setUsed(echo, "sub_unleash_incarnation", 1);
    await r.roll(echo, { kind: "initiative" });
    assert.equal(r.used(echo, "sub_unleash_incarnation"), 0, "with one of three uses spent, rolling initiative gave none back");
  });
}

// ---- Psi Warrior ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, enemyHits, sheet, foe, foeHas, used, max, budget, has, give, show } = r;
  const DIE = { 3: 6, 5: 8, 11: 10, 17: 12 };
  const allies = [1, 2, 3, 4].map(() => hero("fighter", "Champion", 5, { ac: 5 }));

  await probe("psionic-dice-count-and-size", async () => {
    for (const [level, sides] of Object.entries(DIE)) {
      const psi = hero("fighter", "Psi Warrior", Number(level));
      assert.equal(max(psi, "sub_psionic_energy"), 2 * prof(Number(level)), `level ${level}: twice the proficiency bonus`);
      const [enemy] = await stage(psi);
      await swing(psi, enemy);
      const struck = foe(enemy).currentHp;
      const out = await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id }, 20);
      assert.equal(out.ok, true, out.error);
      assert.equal(struck - foe(enemy).currentHp, sides + MOD, `level ${level}: a d${sides} at its most, plus Intelligence`);
      assert.equal(out.result.damageType, "force");
    }
  });

  const psi = hero("fighter", "Psi Warrior", 15);
  await probe("psionic-strike-once-a-turn", async () => {
    const [enemy] = await stage(psi);
    await swing(psi, enemy);
    assert.equal((await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id })).ok, true);
    assert.equal((await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id })).ok, false, "a second strike in one turn");
    assert.equal(used(psi, "sub_psionic_energy"), 1);
  });
  await probe("psionic-strike-needs-a-hit", async () => {
    const [enemy] = await stage(psi);
    const out = await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id });
    assert.equal(out.ok, false, `with no attack made this turn the die dealt ${300 - foe(enemy).currentHp} force damage`);
  });

  await probe("protective-field", async () => {
    const [enemy] = await stage(allies[0], { cast: [[psi, 12, 5]] });
    await enemyHits(enemy, allies[0], [16, 4]);
    const far = await react(psi, "Protective Field", { targetCharacterId: allies[0].id }, 4);
    assert.equal(far.ok, false, "an ally 35 feet away is beyond its 30 feet");
    assert.equal(used(psi, "sub_psionic_energy"), 0);
    kit.place(psi.id, 11, 5);
    const hurt = sheet(allies[0]).currentHp;
    const near = await react(psi, "Protective Field", { targetCharacterId: allies[0].id }, 2);
    assert.equal(near.ok, true, near.error);
    assert.equal(sheet(allies[0]).currentHp, hurt + 2 + MOD, "the die (a 2) plus Intelligence comes off the 6");
    assert.equal(used(psi, "sub_psionic_energy"), 1);
    assert.ok(world.encounter().reactionsUsed.includes(psi.id), "it takes the reaction");
    const [again] = await stage(psi);
    world.patch(psi.id, { ac: 5, acOverride: true });
    await enemyHits(again, psi, [16, 4]);
    const own = sheet(psi).currentHp;
    assert.equal((await react(psi, "Protective Field", {}, 2)).ok, true, "on the psi warrior's own hit");
    assert.equal(sheet(psi).currentHp, own + 2 + MOD);
  });

  await probe("telekinetic-movement-free-use", async () => {
    await stage(psi);
    const out = await spend(psi, "sub_psionic_energy", { variant: "telekinetic movement" });
    assert.equal(out.ok, true, out.error);
    assert.equal(used(psi, "sub_psionic_energy"), 0, "the first Telekinetic Movement after a rest cost a Psionic Energy die");
  });

  await probe("telekinetic-adept-leap-and-thrust", async () => {
    const [enemy] = await stage(psi);
    await swing(psi, enemy);
    await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id });
    const thrust = await spend(psi, "Telekinetic Adept", { variant: "thrust", targetEnemyId: enemy.id }, 2);
    assert.equal(thrust.ok, true, thrust.error);
    assert.ok(foeHas(enemy, "prone"));
    const leap = await spend(psi, "Telekinetic Adept", { variant: "leap" });
    assert.equal(leap.ok, true, leap.error);
    assert.ok(has(psi, "flying"));
    assert.equal(budget().bonusUsed, true);
  });
  await probe("telekinetic-thrust-needs-a-strike", async () => {
    const [enemy] = await stage(psi);
    const out = await spend(psi, "Telekinetic Adept", { variant: "thrust", targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, false, "with no Psionic Strike made, Thrust knocked the creature prone");
  });
  await probe("telekinetic-thrust-save-not-in-text", async () => {
    const [enemy] = await stage(psi);
    await swing(psi, enemy);
    await spend(psi, "Psionic Strike", { targetEnemyId: enemy.id });
    const out = await spend(psi, "Telekinetic Adept", { variant: "thrust", targetEnemyId: enemy.id }, 20);
    assert.equal(out.ok, true, out.error);
    assert.ok(foeHas(enemy, "prone"), `the text states no save, and the creature made one (${out.result.save} against DC ${out.result.dc}) and stands`);
  });

  await probe("guarded-mind-resistance", async () => {
    await kit.endFight();
    world.patch(psi.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: psi.id, amount: 10, type: "psychic" });
    assert.equal(sheet(psi).currentHp, 55);
  });
  await probe("guarded-mind-ends-a-condition", async () => {
    await stage(psi);
    give(psi, "frightened", { rounds: 5 });
    const out = await spend(psi, "sub_psionic_energy", { variant: "guarded mind" });
    assert.ok(out.ok && !has(psi, "frightened"), `a die was ${out.ok ? "spent" : "refused"} and the fighter is still frightened`);
  });

  await probe("bulwark-of-force", async () => {
    const [enemy] = await stage(psi, { cast: [[allies[0], 5, 6], [allies[1], 4, 5], [allies[2], 4, 6], [allies[3], 4, 4]] });
    const out = await spend(psi, "Bulwark of Force");
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true);
    assert.equal(allies.filter((ally) => has(ally, "bulwark of force")).length, MOD, "the Intelligence modifier in allies");
    assert.ok(has(psi, "bulwark of force"), "and the psi warrior");
    assert.equal(sheet(psi).conditionMeta["bulwark of force"].rounds, 10, "a minute");
    const covered = allies.find((ally) => has(ally, "bulwark of force"));
    world.patch(covered.id, { ac: 12, acOverride: true });
    const hurt = sheet(covered).currentHp;
    await enemyHits(enemy, covered, [9, 4]);
    assert.equal(sheet(covered).currentHp, hurt, "13 to hit against AC 12 behind half cover is a miss");
    kit.freshTurn();
    assert.equal((await spend(psi, "Bulwark of Force")).ok, true, "a second use, for a die");
    assert.deepEqual([used(psi, "sub_bulwark_of_force"), used(psi, "sub_psionic_energy")], [1, 1]);
  });
  await probe("bulwark-of-force-range-not-in-text", async () => {
    await stage(psi, { cast: [[allies[0], 12, 5]] });
    await spend(psi, "Bulwark of Force");
    assert.ok(has(allies[0], "bulwark of force"), "the text names no distance, and an ally 35 feet away was left out");
  });

  await probe("telekinetic-master-bonus-attack", async () => {
    const master = hero("fighter", "Psi Warrior", 18);
    const [enemy] = await stage(master);
    for (let count = 0; count < 3; count += 1) await swing(master, enemy);
    assert.equal((await swing(master, enemy, [15, 4], { feature: "Telekinetic Master" })).ok, false, "not while concentrating on telekinesis");
    world.patch(master.id, { concentratingOn: "Telekinesis" });
    const out = await swing(master, enemy, [15, 4], { feature: "Telekinetic Master" });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true);
  });
}

// ---- Rune Knight ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, roll, sheet, budget, has, d20s, show } = r;
  const options = await import("../src/lib/srd/options.ts");

  await probe("runes-known", () => {
    assert.deepEqual([3, 7, 10, 15].map((level) => options.optionSlotsFor("fighter", "Rune Knight", level, "rune")), [2, 3, 4, 5]);
  });

  await probe("rune-carver-runes-do-nothing", async () => {
    const carver = hero("fighter", "Rune Knight", 7);
    world.patch(carver.id, { currentHp: 80, features: [...sheet(carver).features, ...["Stone Rune", "Hill Rune"].map((name) => ({ name: options.optionFeatureName("rune", name), source: "class" }))] });
    await kit.endFight();
    const insight = d20s(await roll(carver, { kind: "skill_check", skill: "insight", dc: 10 }));
    const poison = d20s(await roll(carver, { kind: "saving_throw", ability: "con", dc: 10, against: "poisoned" }));
    await world.invoke("apply_damage", { characterId: carver.id, amount: 10, type: "poison" });
    const invoked = await spend(carver, "Stone Rune");
    assert.deepEqual(
      { insight, poison, lost: 80 - sheet(carver).currentHp, invoked: invoked.ok },
      { insight: 2, poison: 2, lost: 5, invoked: true },
      "Stone Rune (advantage on Insight; invoked as a reaction) and Hill Rune (advantage on saves against poison, resistance to poison damage) on a knight who carries both",
    );
  });

  const mighty = async (level) => {
    const knight = hero("fighter", "Rune Knight", level);
    const [enemy] = await stage(knight);
    const out = await spend(knight, "Giant's Might");
    assert.equal(out.ok, true, out.error);
    return { knight, enemy };
  };
  const sides = (hit) => (hit.damage?.breakdown?.terms ?? []).filter((term) => term.kind === "dice").map((term) => term.sides);

  await probe("giants-might", async () => {
    const { knight, enemy } = await mighty(3);
    assert.equal(budget().bonusUsed, true, "a bonus action");
    assert.equal(sheet(knight).conditionMeta["giant's might"].rounds, 10, "a minute");
    assert.deepEqual(sides(await swing(knight, enemy, [15, 4, 4])), [8, 6], "1d6 on the damage roll");
    assert.equal(d20s(await roll(knight, { kind: "saving_throw", ability: "str", dc: 10 })), 2, "Strength saves");
    assert.equal(d20s(await roll(knight, { kind: "ability_check", ability: "str", dc: 10 })), 2, "Strength checks");
    assert.equal(d20s(await roll(knight, { kind: "saving_throw", ability: "dex", dc: 10 })), 1);
  });
  await probe("giants-might-die-grows", async () => {
    for (const [level, die] of [[9, 6], [10, 8], [17, 8], [18, 10]]) {
      const { knight, enemy } = await mighty(level);
      assert.deepEqual(sides(await swing(knight, enemy, [15, 4, 4])), [8, die], `level ${level}`);
    }
  });
  await probe("giants-might-one-roll-a-turn", async () => {
    for (const level of [5, 10]) {
      const { knight, enemy } = await mighty(level);
      await swing(knight, enemy, [15, 4, 4]);
      const second = await swing(knight, enemy, [15, 4, 4]);
      assert.equal(second.result.hit, true, second.error);
      assert.deepEqual(sides(second), [8], `level ${level}: the second hit of the turn carries the die again`);
    }
  });
  await probe("runic-juggernaut-reach", async () => {
    const { knight, enemy } = await mighty(18);
    kit.place(enemy.id, 7, 5);
    const out = await swing(knight, enemy, [15, 4, 4]);
    assert.equal(out.ok, true, `under Giant's Might at 18th level a creature 10 feet away is out of reach: ${String(out.error).slice(0, 90)}`);
  });
}

// ---- Banneret ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, roll, sheet } = r;
  const training = await import("../src/lib/srd/subclass-training.ts");
  const banneret = hero("fighter", "Banneret", 10);
  const first = hero("fighter", "Champion", 5);
  const second = hero("fighter", "Champion", 5);
  const archer = hero("fighter", "Champion", 5, BOW);

  await probe("rallying-cry-heals-allies", async () => {
    await stage(banneret, { cast: [[first, 4, 5]] });
    world.patch(banneret.id, { currentHp: 40 });
    world.patch(first.id, { currentHp: 40 });
    const out = await spend(banneret, "Second Wind", {}, 5);
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(banneret).currentHp, 40 + 5 + 10);
    assert.equal(sheet(first).currentHp, 40 + 10, "a wounded ally 5 feet away gained nothing from the Banneret's Second Wind");
  });

  await probe("royal-envoy-expertise", async () => {
    const spec = training.subclassGrants([{ id: "fighter", level: 7, subclass: "Banneret" }]).find((grant) => grant.name === "Royal Envoy")?.spec;
    assert.deepEqual([spec?.fixedSkills, spec?.fixedExpertise], [["persuasion"], ["persuasion"]]);
    const envoy = hero("fighter", "Banneret", 7, { proficiencies: { saves: [], skills: ["persuasion"], expertise: ["persuasion"], languages: ["Common"], tools: [], armor: [], weapons: ["simple", "martial"] } });
    await kit.endFight();
    assert.equal((await roll(envoy, { kind: "skill_check", skill: "persuasion", dc: 10 })).total, 10 + 3 + 2 * prof(7));
  });
  await probe("royal-envoy-already-proficient", () => {
    const spec = training.subclassGrants([{ id: "fighter", level: 7, subclass: "Banneret" }]).find((grant) => grant.name === "Royal Envoy")?.spec;
    assert.match(JSON.stringify(spec), /animal_handling/, "Royal Envoy's training lists no skill to take in place of a Persuasion already held");
  });

  await probe("inspiring-surge-60-feet", async () => {
    const [enemy] = await stage(banneret, { cast: [[first, 19, 5]] });
    kit.place(enemy.id, 18, 5);
    const out = await react(first, "Inspiring Surge", { targetEnemyId: enemy.id }, [15, 4]);
    assert.equal(out.ok, false, "an ally 70 feet from the Banneret took the attack");
  });
  await probe("inspiring-surge-one-ally", async () => {
    const [enemy] = await stage(banneret, { cast: [[first, 6, 4], [second, 6, 6]] });
    await spend(banneret, "Action Surge");
    const answers = [];
    for (const ally of [first, second]) answers.push((await react(ally, "Inspiring Surge", { targetEnemyId: enemy.id }, [15, 4])).ok);
    assert.deepEqual(answers, [true, false], "at 10th level one ally answers the surge");
  });
  await probe("inspiring-surge-any-weapon", async () => {
    const [enemy] = await stage(banneret, { cast: [[archer, 4, 5]] });
    kit.place(enemy.id, 10, 5);
    await spend(banneret, "Action Surge");
    const out = await react(archer, "Inspiring Surge", { targetEnemyId: enemy.id, weapon: "Longbow" }, [15, 4]);
    assert.equal(out.ok, true, `an ally with a longbow, 30 feet from the creature: ${String(out.error).slice(0, 110)}`);
  });

  await probe("bulwark-indomitable-ally", () => {});
}

finish();
