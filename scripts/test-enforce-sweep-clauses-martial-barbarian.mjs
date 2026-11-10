// The clause ledger's barbarian probes (scripts/clauses/martial.json names
// each by its id; scripts/lib/sweep-clauses-martial-known-barbarian.mjs holds
// the ones the engine fails today).
import assert from "node:assert/strict";
import { clauseSuite, openRig, prof, MOD } from "./lib/sweep-clauses-martial.mjs";
import { KNOWN, SKIP } from "./lib/sweep-clauses-martial-known-barbarian.mjs";

const { probe, finish } = await clauseSuite(import.meta.url, KNOWN, SKIP);
const NONMAGICAL = { stats: { resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } };
const AXE = { equipment: [{ name: "Greataxe", qty: 1, equipped: true }] };
const BOW = { equipment: [{ name: "Longbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] };
const d20sOf = (log) => log.filter((die) => die.sides === 20).length;
const expr = (hit) => hit.damage?.breakdown?.expression ?? `no damage (${hit.error ?? "a miss"})`;
const rageBonus = (level) => (level >= 16 ? 4 : level >= 9 ? 3 : 2);

// ---- Path of the Totem Warrior ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, enemyHits, roll, sheet, foe, foeHas, budget, rage, choose, d20s, rollBy, walk, show } = r;
  const { speedFor } = await import("../src/lib/srd/index.ts");
  const { authoredSpeeds } = await import("../src/lib/srd/authored-effects.ts");
  const { liftLimits } = await import("../src/lib/dm/load-rules.ts");
  const training = await import("../src/lib/srd/subclass-training.ts");
  const totem = async (level, spirit, aspect, attunement) => {
    const who = hero("barbarian", "Path of the Totem Warrior", level, AXE);
    if (spirit) await choose(who, "Totem Spirit", spirit);
    if (aspect) await choose(who, "Aspect of the Beast", aspect);
    if (attunement) await choose(who, "Totemic Attunement", attunement);
    return who;
  };
  const ally = hero("fighter", "Champion", 5, { ac: 5 });
  const archer = hero("fighter", "Champion", 5, BOW);

  await probe("totem-spirit-while-raging", async () => {
    const bear = await totem(3, "bear");
    await kit.endFight();
    world.patch(bear.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: bear.id, amount: 10, type: "fire" });
    assert.equal(sheet(bear).currentHp, 50, "the bear's resistance holds without the rage");
  });

  await probe("totem-spirit-eagle-opportunity-attacks", async () => {
    const eagle = await totem(3, "eagle");
    const plain = await totem(3, "bear");
    const rolled = {};
    for (const [name, who] of [["eagle", eagle], ["bear", plain]]) {
      await stage(who);
      rage(who);
      world.diceLog();
      assert.equal(await walk(who, 2, 5), 200);
      rolled[name] = d20sOf(world.diceLog());
    }
    assert.deepEqual(rolled, { eagle: 2, bear: 1 }, "the opportunity attack as each pulls away");
  });

  await probe("totem-spirit-elk-speed", async () => {
    const elk = await totem(3, "elk");
    const calm = speedFor(sheet(elk));
    rage(elk);
    assert.equal(speedFor(sheet(elk)) - calm, 15);
  });

  await probe("totem-spirit-tiger-jump", () => {});

  await probe("totem-spirit-wolf-allies", async () => {
    const wolf = await totem(3, "wolf");
    const [enemy] = await stage(ally, { cast: [[wolf, 6, 4], [archer, 12, 5]] });
    rage(wolf);
    assert.equal((await swing(ally, enemy, [15, 15, 4])).toHit.advantage, "advantage", "an ally's melee attack");
    kit.giveTurn(archer.id);
    assert.equal((await swing(archer, enemy, [15, 15, 4], { weapon: "Longbow" })).toHit.advantage, "none", "an ally's arrow");
    kit.place(wolf.id, 6, 2);
    kit.giveTurn(ally.id);
    assert.equal((await swing(ally, enemy, [15, 15, 4])).toHit.advantage, "none", "the creature is 15 feet from the barbarian");
  });

  await probe("aspect-of-the-beast-bear-strength", async () => {
    const bear = await totem(6, "bear", "bear");
    await kit.endFight();
    assert.equal(d20s(await roll(bear, { kind: "ability_check", ability: "str", dc: 10, about: "push_pull_lift_break" })), 2);
    assert.equal(d20s(await roll(bear, { kind: "ability_check", ability: "str", dc: 10 })), 1);
  });

  await probe("aspect-of-the-beast-bear-carrying", async () => {
    const bear = await totem(6, "bear", "bear");
    const other = await totem(6, "bear", "wolf");
    assert.equal(liftLimits(sheet(bear)).capacityLb, 2 * liftLimits(sheet(other)).capacityLb, `a Bear carries ${liftLimits(sheet(bear)).capacityLb} lb, the same as any barbarian of their Strength`);
  });

  await probe("aspect-of-the-beast-elk-travel", () => {});

  await probe("aspect-of-the-beast-tiger-skills", async () => {
    const tiger = await totem(6, "tiger", "tiger");
    const grants = training.subclassGrants([{ id: "barbarian", level: 6, subclass: "Path of the Totem Warrior" }], undefined, sheet(tiger).features).filter((grant) => grant.subclass);
    assert.ok(grants.some((grant) => /aspect of the beast/i.test(grant.name)), `the Tiger's two skills have no pick: the subclass's training at 6th level is [${grants.map((grant) => grant.name).join(", ")}]`);
  });

  await probe("totemic-attunement-bear", async () => {
    const bear = await totem(14, "bear", "bear", "bear");
    const [enemy] = await stage(ally, { cast: [[bear, 6, 4]] });
    rage(bear);
    await enemyHits(enemy, ally, [15, 12, 4]);
    assert.equal(rollBy("attack", ally.id, enemy).advantage, "disadvantage", "a foe within 5 feet of the raging bear attacks an ally");
    world.patch(bear.id, { ac: 5, acOverride: true });
    await enemyHits(enemy, bear, [15, 4]);
    assert.equal(rollBy("attack", bear.id, enemy).advantage, "none", "and the bear");
    kit.place(bear.id, 6, 2);
    const far = await enemyHits(enemy, ally, [15, 4]);
    // The roll log keeps the millisecond, so the record of this attack and of
    // the first can tie: the swing itself says which die it kept (15 + 4).
    assert.equal(far.swings[0].rolled, 19, `and an ally with the bear 15 feet off: ${JSON.stringify(far).slice(0, 300)}`);
  });

  await probe("totemic-attunement-eagle-flight", async () => {
    const eagle = await totem(14, "eagle", "eagle", "eagle");
    const walking = speedFor(sheet(eagle));
    assert.equal(authoredSpeeds(sheet(eagle), walking).fly, undefined, "no flight without the rage");
    rage(eagle);
    assert.equal(authoredSpeeds(sheet(eagle), walking).fly, walking);
  });

  const elk = await totem(14, "elk", "elk", "elk");
  await probe("totemic-attunement-elk-trample", async () => {
    const [enemy] = await stage(elk);
    assert.equal((await spend(elk, "Elk Trample", { targetEnemyId: enemy.id }, 2)).ok, false, "not while calm");
    rage(elk);
    const dc = 8 + prof(14) + MOD;
    const out = await spend(elk, "Elk Trample", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.deepEqual([out.result.dc, out.result.saved, out.result.damage, out.result.damageType], [dc, false, 2 + MOD, "bludgeoning"], "1d12 (a 2) + Strength");
    assert.ok(foeHas(enemy, "prone"));
    assert.equal(budget().bonusUsed, true);
    kit.freshTurn();
    kit.setEnemy(enemy.id, { conditions: [] });
    const made = await spend(elk, "Elk Trample", { targetEnemyId: enemy.id }, [dc - 1, 2]);
    assert.equal(made.result.saved, true);
    assert.ok(!foeHas(enemy, "prone"));
    assert.equal(made.result.damage ?? 0, 0, "a save made: no damage");
  });
  await probe("totemic-attunement-elk-size", async () => {
    const [enemy] = await stage(elk);
    kit.setEnemy(enemy.id, { stats: { size: "Huge" } });
    rage(elk);
    const out = await spend(elk, "Elk Trample", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, false, "a Huge creature was trampled prone");
  });

  await probe("totemic-attunement-tiger-needs-a-run", async () => {
    const tiger = await totem(14, "tiger", "tiger", "tiger");
    const [enemy] = await stage(tiger);
    rage(tiger);
    await swing(tiger, enemy, [15, 4]);
    const out = await swing(tiger, enemy, [15, 4], { feature: "Totemic Attunement" });
    assert.equal(out.ok, false, "a Tiger who has not moved a foot made the bonus-action attack");
  });
}

// ---- Path of the Ancestral Guardian ----
{
  const r = await openRig();
  const { world, kit, hero, stage, react, swing, enemyHits, sheet, foeHas, rage, rollBy, untilTurnOf } = r;
  const guardian = hero("barbarian", "Path of the Ancestral Guardian", 6, AXE);
  const ally = hero("fighter", "Champion", 5, { ac: 5 });

  await probe("ancestral-protectors-first-creature", async () => {
    const [first, second] = await stage(guardian, { enemies: 2 });
    kit.place(second.id, 5, 6);
    await swing(guardian, first, [15, 4]);
    assert.ok(!foeHas(first, "ancestral protectors"), "a calm barbarian's hit marks nobody");
    kit.freshTurn();
    rage(guardian);
    await swing(guardian, first, [15, 4]);
    await swing(guardian, second, [15, 4]);
    assert.ok(foeHas(first, "ancestral protectors"));
    assert.ok(!foeHas(second, "ancestral protectors"), "the second creature hit in the turn is marked too");
  });

  await probe("ancestral-protectors-resistance", async () => {
    const [enemy] = await stage(guardian, { cast: [[ally, 7, 5]] });
    rage(guardian);
    await swing(guardian, enemy, [15, 4]);
    const before = sheet(ally).currentHp;
    await enemyHits(enemy, ally, [15, 15, 4]);
    assert.equal(before - sheet(ally).currentHp, 3, "half of the club's 6");
  });

  await probe("ancestral-protectors-until-next-turn", async () => {
    const [enemy] = await stage(guardian, { cast: [[ally, 7, 5]] });
    rage(guardian);
    await swing(guardian, enemy, [15, 4]);
    r.endTurn();
    assert.ok(foeHas(enemy, "ancestral protectors"), "the mark is gone before the barbarian's next turn");
    untilTurnOf(guardian);
    assert.ok(!foeHas(enemy, "ancestral protectors"), "the mark outlives the start of the barbarian's next turn");
  });

  await probe("ancestral-protectors-rage-ends", async () => {
    const [enemy] = await stage(guardian, { cast: [[ally, 7, 5]] });
    rage(guardian);
    await swing(guardian, enemy, [15, 4]);
    const ended = await world.invoke("clear_condition", { characterId: guardian.id, condition: "raging" });
    assert.equal(ended.ok, true, ended.error);
    await enemyHits(enemy, ally, [15, 12, 4]);
    assert.equal(rollBy("attack", ally.id, enemy).advantage, "none", "the rage is over and the marked creature still attacks an ally at disadvantage");
  });

  await probe("spirit-shield-who-and-where", async () => {
    const [enemy] = await stage(ally, { cast: [[guardian, 12, 5]] });
    await enemyHits(enemy, ally, [16, 4]);
    kit.place(guardian.id, 9, 5);
    assert.equal((await react(guardian, "Spirit Shield", { targetCharacterId: ally.id }, 3)).ok, false, "not while calm");
    rage(guardian);
    kit.place(guardian.id, 12, 5);
    assert.equal((await react(guardian, "Spirit Shield", { targetCharacterId: ally.id }, 3)).ok, false, "an ally 35 feet away");
    const [again] = await stage(guardian);
    rage(guardian);
    world.patch(guardian.id, { ac: 5, acOverride: true });
    await enemyHits(again, guardian, [16, 4]);
    assert.equal((await react(guardian, "Spirit Shield", {}, 3)).ok, false, "the barbarian's own hit");
  });

  await probe("spirit-shield-sight", async () => {
    const [enemy] = await stage(ally, { cast: [[guardian, 7, 5]] });
    rage(guardian);
    await enemyHits(enemy, ally, [16, 4]);
    r.give(guardian, "blinded");
    const hurt = sheet(ally).currentHp;
    const out = await react(guardian, "Spirit Shield", { targetCharacterId: ally.id }, 3);
    assert.equal(out.ok, false, `a blinded barbarian shielded an ally they cannot see (${sheet(ally).currentHp - hurt} damage taken back)`);
  });

  await probe("spirit-shield-dice", async () => {
    for (const [level, dice] of [[6, 2], [9, 2], [10, 3], [13, 3], [14, 4]]) {
      const shield = hero("barbarian", "Path of the Ancestral Guardian", level, AXE);
      const [enemy] = await stage(ally, { cast: [[shield, 7, 5]] });
      rage(shield);
      await enemyHits(enemy, ally, [16, 4]);
      world.diceLog();
      const out = await react(shield, "Spirit Shield", { targetCharacterId: ally.id }, 1);
      assert.equal(out.ok, true, out.error);
      assert.equal(world.diceLog().filter((die) => die.sides === 6).length, dice, `level ${level}`);
    }
  });
}

// ---- Path of the Storm Herald ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, enemyHits, sheet, foe, foeHas, budget, has, rage, choose } = r;
  const { authoredSpeeds } = await import("../src/lib/srd/authored-effects.ts");
  const herald = async (level, environment) => {
    const who = hero("barbarian", "Path of the Storm Herald", level, AXE);
    await choose(who, "Storm Environment", environment);
    return who;
  };
  const ally = hero("fighter", "Champion", 5);
  const hurt = async (who, type) => {
    world.patch(who.id, { currentHp: 60 });
    await world.invoke("apply_damage", { characterId: who.id, amount: 10, type });
    return 60 - sheet(who).currentHp;
  };

  await probe("storm-environment-choice", async () => {
    const who = await herald(3, "tundra");
    assert.ok(sheet(who).features.some((feature) => feature.name === "Storm Aura (Tundra)"));
  });

  await probe("storm-aura-wakes-with-rage", async () => {
    const desert = await herald(20, "desert");
    const [enemy] = await stage(desert);
    const out = await spend(desert, "Rage");
    assert.equal(out.ok, true, out.error);
    assert.equal(300 - foe(enemy).currentHp, 6, `entering the rage woke no aura (the creature beside them lost ${300 - foe(enemy).currentHp}), and the bonus action it would take is spent`);
  });

  await probe("storm-aura-desert", async () => {
    for (const [level, fire] of [[3, 2], [5, 3], [10, 4], [15, 5], [20, 6]]) {
      const desert = await herald(level, "desert");
      const [near, far] = await stage(desert, { enemies: 2 });
      kit.place(near.id, 7, 5);
      kit.place(far.id, 8, 5);
      assert.equal((await spend(desert, "Storm Aura")).ok, false, "not while calm");
      rage(desert);
      const out = await spend(desert, "Storm Aura");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.deepEqual([300 - foe(near).currentHp, 300 - foe(far).currentHp], [fire, 0], `level ${level}: 10 feet and 15 feet`);
    }
  });
  await probe("storm-aura-desert-each-other-creature", async () => {
    const desert = await herald(20, "desert");
    await stage(desert, { cast: [[ally, 5, 6]] });
    rage(desert);
    await spend(desert, "Storm Aura");
    assert.equal(80 - sheet(ally).currentHp, 6, "an ally standing in the aura took no fire damage");
  });

  await probe("storm-aura-sea", async () => {
    for (const [level, dice] of [[3, 1], [10, 2], [15, 3], [20, 4]]) {
      const sea = await herald(level, "sea");
      const [chosen, spared] = await stage(sea, { enemies: 2 });
      kit.place(spared.id, 5, 6);
      rage(sea);
      const failed = await spend(sea, "Storm Aura", { targetEnemyId: chosen.id }, 2);
      assert.equal(failed.ok, true, failed.error);
      assert.deepEqual([failed.result.dc, failed.result.saved, failed.result.damage, failed.result.damageType], [8 + prof(level) + MOD, false, 2 * dice, "lightning"], `level ${level}`);
      assert.equal(foe(spared).currentHp, 300, "one creature, the one chosen");
      kit.freshTurn();
      const made = await spend(sea, "Storm Aura", { targetEnemyId: chosen.id }, 20);
      assert.deepEqual([made.result.saved, made.result.damage], [true, 3 * dice], `level ${level}: half of ${dice}d6 at their most`);
    }
  });

  await probe("storm-aura-tundra", async () => {
    for (const [level, temp] of [[3, 2], [10, 4], [20, 6]]) {
      const tundra = await herald(level, "tundra");
      await stage(tundra, { cast: [[ally, 5, 6]] });
      rage(tundra);
      const out = await spend(tundra, "Storm Aura");
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(ally).tempHp, temp, `level ${level}`);
    }
  });

  await probe("storm-soul", async () => {
    await kit.endFight();
    const desert = await herald(6, "desert");
    const sea = await herald(6, "sea");
    const tundra = await herald(6, "tundra");
    assert.deepEqual([await hurt(desert, "fire"), await hurt(desert, "cold")], [5, 10]);
    assert.deepEqual([await hurt(sea, "lightning"), await hurt(sea, "fire")], [5, 10]);
    assert.deepEqual([await hurt(tundra, "cold"), await hurt(tundra, "lightning")], [5, 10]);
    assert.equal(authoredSpeeds(sheet(sea), 30).swim, 30);
    assert.equal(authoredSpeeds(sheet(desert), 30).swim, undefined);
  });

  await probe("shielding-storm", async () => {
    const desert = await herald(10, "desert");
    await stage(desert, { cast: [[ally, 5, 6]] });
    assert.equal(await hurt(ally, "fire"), 10, "no aura, no shelter");
    rage(desert);
    await spend(desert, "Storm Aura");
    assert.equal(await hurt(ally, "fire"), 5, "an ally in the aura");
    assert.equal(await hurt(ally, "cold"), 10, "the desert's own type only");
    kit.place(ally.id, 5, 9);
    assert.equal(await hurt(ally, "fire"), 10, "an ally 20 feet off");
  });

  await probe("raging-storm-desert", async () => {
    const desert = await herald(14, "desert");
    const [enemy] = await stage(desert);
    rage(desert);
    await spend(desert, "Storm Aura");
    world.patch(desert.id, { ac: 5, acOverride: true });
    await enemyHits(enemy, desert, [16, 4]);
    const before = foe(enemy).currentHp;
    const out = await react(desert, "Raging Storm", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.equal(before - foe(enemy).currentHp, 7, "half the barbarian level in fire");
    assert.match(out.result.save, new RegExp(`vs DC ${8 + prof(14) + MOD}$`));
  });
  await probe("raging-storm-sea", async () => {
    const sea = await herald(14, "sea");
    const [enemy] = await stage(sea);
    rage(sea);
    await spend(sea, "Storm Aura", { targetEnemyId: enemy.id }, 2);
    await swing(sea, enemy, [15, 4]);
    const out = await react(sea, "Raging Storm", { targetEnemyId: enemy.id }, 2);
    assert.equal(out.ok, true, out.error);
    assert.ok(foeHas(enemy, "prone"));
  });
  await probe("raging-storm-tundra", async () => {
    for (const [level, held] of [[10, false], [14, true]]) {
      const tundra = await herald(level, "tundra");
      const [enemy] = await stage(tundra);
      rage(tundra);
      const out = await spend(tundra, "Storm Aura", { targetEnemyId: enemy.id }, 2);
      assert.equal(out.ok, true, out.error);
      assert.equal(foeHas(enemy, "raging storm"), held, `level ${level}`);
      if (held) assert.equal(foe(enemy).conditionMeta["raging storm (tundra)"]?.rounds, 1);
    }
  });
}

// ---- Path of the Zealot ----
{
  const r = await openRig();
  const { world, kit, hero, stage, swing, sheet, foe, has, rage, forced } = r;

  await probe("divine-fury", async () => {
    for (const level of [5, 14]) {
      const zealot = hero("barbarian", "Path of the Zealot", level, AXE);
      const fury = `+1d6+${Math.floor(level / 2)}`;
      const [enemy] = await stage(zealot);
      assert.ok(!expr(await swing(zealot, enemy, [15, 4, 4])).includes("1d6"), "not while calm");
      kit.freshTurn();
      rage(zealot);
      assert.ok(expr(await swing(zealot, enemy, [15, 4, 4])).endsWith(fury), `level ${level}: the first hit of the turn`);
      assert.ok(!expr(await swing(zealot, enemy, [15, 4, 4])).includes("1d6"), "the second hit of the turn");
      kit.freshTurn();
      kit.setEnemy(enemy.id, { stats: { immune: "radiant, necrotic" } });
      const before = foe(enemy).currentHp;
      await swing(zealot, enemy, [15, 4, 4]);
      assert.equal(before - foe(enemy).currentHp, 4 + MOD + rageBonus(level), "a creature immune to both types takes the axe alone");
    }
  });

  const presence = hero("barbarian", "Path of the Zealot", 10, AXE);
  const near = hero("fighter", "Champion", 5);
  const far = hero("fighter", "Champion", 5);
  await probe("zealous-presence", async () => {
    await stage(presence);
    const out = await r.spend(presence, "Zealous Presence");
    assert.equal(out.ok, true, out.error);
    assert.equal(r.budget().bonusUsed, true, "the bonus action");
  });
  await probe("zealous-presence-advantage", async () => {
    const [enemy] = await stage(presence, { cast: [[near, 5, 9], [far, 19, 14]] });
    kit.place(enemy.id, 5, 10);
    await r.spend(presence, "Zealous Presence");
    kit.giveTurn(near.id);
    const swung = await swing(near, enemy, [15, 15, 4]);
    const saved = await r.roll(near, { kind: "saving_throw", ability: "dex", dc: 10 }, [10, 10]);
    const farSave = await r.roll(far, { kind: "saving_throw", ability: "dex", dc: 10 }, [10, 10]);
    assert.deepEqual(
      [swung.toHit?.advantage, r.d20s(saved), r.d20s(farSave)],
      ["advantage", 2, 1],
      `an ally 20 feet off attacks and saves with [${swung.toHit?.advantage}, ${r.d20s(saved)} d20s]; one 70 feet off saves with ${r.d20s(farSave)}`,
    );
  });

  await probe("rage-beyond-death-stays-up", async () => {
    const zealot = hero("barbarian", "Path of the Zealot", 14, { ...AXE, ac: 5 });
    const [enemy] = await stage(zealot);
    rage(zealot);
    world.patch(zealot.id, { currentHp: 3 });
    // The club's 16 to hit and 4 + 2, then Relentless Rage's save on a 1.
    await forced([16, 4, 1, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: zealot.id }));
    assert.equal(sheet(zealot).currentHp, 0, "setup: the blow dropped them");
    assert.ok(has(zealot, "raging") && !has(zealot, "unconscious"), `at 0 hit points the raging zealot is ${sheet(zealot).conditions.join(", ")}`);
  });
  await probe("rage-beyond-death-no-death", async () => {
    const zealot = hero("barbarian", "Path of the Zealot", 14, AXE);
    await stage(zealot);
    world.patch(zealot.id, { currentHp: 0, conditions: ["raging"], conditionMeta: { raging: { rounds: 10 } }, deathSaves: { successes: 0, failures: 2, stable: false, dead: false } });
    const out = await world.invoke("apply_damage", { characterId: zealot.id, amount: 3, type: "slashing" });
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(zealot).deathSaves?.dead, false, "a third death save failure while raging killed the zealot");
  });
}

// ---- Path of the Beast ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, react, swing, enemyHits, sheet, foe, rage, show } = r;
  const beast = hero("barbarian", "Path of the Beast", 14);
  const ally = hero("fighter", "Champion", 5);

  await probe("form-of-the-beast-while-raging", async () => {
    const [enemy] = await stage(beast);
    assert.equal((await swing(beast, enemy, [15, 4], { weapon: "Claws" })).ok, false, "no claws while calm");
  });
  await probe("form-of-the-beast-one-weapon", async () => {
    const [enemy] = await stage(beast);
    rage(beast);
    const claws = await swing(beast, enemy, [15, 4], { weapon: "Claws" });
    const bite = await swing(beast, enemy, [15, 4], { weapon: "Bite" });
    assert.deepEqual([claws.ok, bite.ok], [true, false], "in one rage the barbarian clawed and then bit");
  });
  await probe("form-of-the-beast-tail-reaction", async () => {
    const [enemy] = await stage(beast);
    rage(beast);
    world.patch(beast.id, { ac: 13, acOverride: true });
    await enemyHits(enemy, beast, [16, 4]);
    const before = sheet(beast).currentHp;
    const out = await react(beast, "Form of the Beast", {}, [8]);
    assert.ok(out.ok && sheet(beast).currentHp > before, `the tail's 1d8 (an 8) on AC 13 against a 20 turned nothing: ${show(out)}`);
  });

  const lostTo = async (weapon) => {
    const [enemy] = await stage(beast);
    rage(beast);
    kit.setEnemy(enemy.id, NONMAGICAL);
    const hit = await swing(beast, enemy, [15, 4], { weapon });
    assert.equal(hit.result.hit, true, hit.error);
    return 300 - foe(enemy).currentHp;
  };
  await probe("bestial-soul-magical", async () => {
    assert.equal(await lostTo("Claws"), 4 + MOD + rageBonus(14), "claws through resistance to nonmagical weapons");
  });
  await probe("bestial-soul-natural-weapons-only", async () => {
    const lost = await lostTo("Longsword");
    assert.equal(lost, Math.floor((4 + MOD + rageBonus(14)) / 2), `a longsword in the same hands deals ${lost} through resistance to nonmagical weapons`);
  });
  await probe("bestial-soul-adapt", async () => {
    await kit.endFight();
    const out = await spend(beast, "Bestial Soul", { variant: "swim" });
    assert.equal(out.ok, true, `no way to take the swim, climb or jump option: ${show(out)}`);
  });

  await probe("call-the-hunt-does-nothing", async () => {
    await stage(beast, { cast: [[ally, 5, 6]] });
    rage(beast);
    const out = await spend(beast, "Call the Hunt", { targetCharacterId: ally.id });
    assert.equal(out.ok, true, out.error);
    assert.equal(sheet(beast).tempHp, 5, `one ally accepted: ${sheet(beast).tempHp} temporary hit points, and the ally carries [${sheet(ally).conditions.join(", ")}]`);
  });
}

// ---- Path of Wild Magic ----
{
  const r = await openRig();
  const { world, hero, stage, spend, react } = r;
  const wild = hero("barbarian", "Path of Wild Magic", 14);

  await probe("wild-surge-rolls-nothing", async () => {
    await stage(wild);
    world.diceLog();
    const out = await spend(wild, "Rage", {}, [5, 5, 5, 5]);
    assert.equal(out.ok, true, out.error);
    const d8s = world.diceLog().filter((die) => die.sides === 8).length;
    assert.ok(d8s >= 1 || /surge/i.test(JSON.stringify(out.result)), "entering the rage rolled no d8 and named no Wild Surge");
  });
  await probe("bolstering-magic-d3", async () => {
    const bolster = hero("barbarian", "Path of Wild Magic", 6);
    const friend = hero("fighter", "Champion", 5);
    const [enemy] = await stage(bolster, { cast: [[friend, 5, 6]] });
    const out = await spend(bolster, "Bolstering Magic", { targetCharacterId: friend.id });
    assert.equal(out.ok, true, out.error);
    r.kit.giveTurn(friend.id);
    r.kit.place(enemy.id, 6, 6);
    const swung = await r.swing(friend, enemy, [15, 2, 4]);
    // The roll record's own expression: a record's ids are hex and can hold
    // "d3" by chance.
    const expression = String(swung.toHit?.breakdown?.expression ?? swung.toHit?.expression ?? "");
    assert.match(expression, /\bd3\b|\dd3\b/, `the touched ally's attack adds no d3: ${expression.slice(0, 200)}; the spend said ${r.show(out)}`);
  });

  await probe("unstable-backlash-rerolls-nothing", async () => {
    await stage(wild);
    r.rage(wild);
    world.diceLog();
    const out = await react(wild, "Unstable Backlash", {}, [5, 5]);
    assert.ok(out.ok && world.diceLog().some((die) => die.sides === 8), `the reaction was ${out.ok ? "spent" : "refused"} and no d8 rolled`);
  });
}

// ---- Path of the Giant ----
{
  const r = await openRig();
  const { world, kit, hero, stage, spend, swing, sheet, foe, foeHas, budget, rage, choose, show } = r;
  const giant = async (level, element, gear = AXE) => {
    const who = hero("barbarian", "Path of the Giant", level, gear);
    if (element) await choose(who, "Elemental Cleaver", element);
    return who;
  };

  await probe("giants-power-cantrip-choice", async () => {
    const who = await giant(3);
    await choose(who, "Giant's Power", "thaumaturgy");
    assert.ok(sheet(who).features.some((feature) => feature.name === "Giant's Power (Thaumaturgy)"));
  });

  await probe("giants-havoc-reach", async () => {
    const who = await giant(3);
    const [enemy] = await stage(who);
    kit.place(enemy.id, 7, 5);
    assert.equal((await swing(who, enemy, [15, 4])).ok, false, "10 feet while calm");
    rage(who);
    assert.equal((await swing(who, enemy, [15, 4])).ok, true, "10 feet while raging");
    kit.freshTurn();
    kit.place(enemy.id, 8, 5);
    assert.equal((await swing(who, enemy, [15, 4])).ok, false, "15 feet while raging");
  });
  await probe("giants-havoc-crushing-throw", async () => {
    const who = await giant(3, null, { equipment: [{ name: "Handaxe", qty: 2, equipped: true }] });
    const [enemy] = await stage(who);
    kit.place(enemy.id, 9, 5);
    rage(who);
    const thrown = await swing(who, enemy, [15, 4], { weapon: "Handaxe" });
    assert.equal(expr(thrown), `1d6+${MOD}+${rageBonus(3)}`, "a handaxe thrown 20 feet with Strength");
  });

  await probe("elemental-cleaver-extra-damage", async () => {
    for (const [level, dice] of [[6, "1d6"], [13, "1d6"], [14, "2d6"]]) {
      const who = await giant(level, "fire");
      const [enemy] = await stage(who);
      assert.ok(!expr(await swing(who, enemy, [15, 4, 4, 4])).includes("d6"), "not while calm");
      kit.freshTurn();
      rage(who);
      const hit = await swing(who, enemy, [15, 4, 4, 4]);
      assert.ok(expr(hit).endsWith(`+${dice}`), `level ${level}: ${expr(hit)}`);
      assert.match(JSON.stringify(hit.result), /fire/);
    }
  });
  const sixth = await giant(6, "fire");
  await probe("elemental-cleaver-damage-type", async () => {
    const [enemy] = await stage(sixth);
    rage(sixth);
    kit.setEnemy(enemy.id, { stats: { immune: "fire" } });
    await swing(sixth, enemy, [15, 4, 4]);
    assert.equal(300 - foe(enemy).currentHp, 0, `a fire-infused greataxe dealt ${300 - foe(enemy).currentHp} to a creature immune to fire: the axe's own damage is still slashing`);
  });
  await probe("elemental-cleaver-thrown", async () => {
    const [enemy] = await stage(sixth);
    rage(sixth);
    kit.place(enemy.id, 9, 5);
    const out = await swing(sixth, enemy, [15, 4, 4]);
    assert.equal(out.ok, true, `the infused greataxe cannot be thrown 20 feet: ${String(out.error).slice(0, 80)}`);
  });
  await probe("elemental-cleaver-change-costs-a-bonus-action", async () => {
    await stage(sixth);
    rage(sixth);
    const out = await spend(sixth, "Elemental Cleaver", { variant: "cold" });
    assert.equal(out.ok, true, out.error);
    assert.equal(budget().bonusUsed, true, "the element changed in a fight for no bonus action");
  });

  const tenth = await giant(10);
  await probe("mighty-impel-save", async () => {
    const [enemy] = await stage(tenth);
    assert.equal((await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, 2)).ok, false, "not while calm");
    rage(tenth);
    kit.place(enemy.id, 8, 5);
    assert.equal((await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, 2)).ok, false, "15 feet is beyond a reach of 10");
    kit.place(enemy.id, 7, 5);
    const dc = 8 + prof(10) + MOD;
    const made = await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, [dc - 1]);
    assert.equal(made.ok, true, made.error);
    assert.deepEqual([made.result.dc, made.result.saved], [dc, true]);
    assert.equal(budget().bonusUsed, true);
    kit.freshTurn();
    assert.equal((await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id }, [dc - 2])).result.saved, false);
  });
  await probe("mighty-impel-size", async () => {
    const taken = [];
    for (const [who, size] of [[tenth, "Large"], [await giant(14), "Huge"]]) {
      const [enemy] = await stage(who);
      rage(who);
      kit.setEnemy(enemy.id, { stats: { size } });
      const out = await spend(who, "Mighty Impel", { targetEnemyId: enemy.id }, 2);
      if (out.ok) taken.push(`${size} at level ${sheet(who).level}`);
    }
    assert.deepEqual(taken, [], "thrown all the same");
  });
  await probe("mighty-impel-moves-nothing", async () => {
    const [enemy] = await stage(tenth);
    rage(tenth);
    const before = kit.token(enemy.id);
    const out = await spend(tenth, "Mighty Impel", { targetEnemyId: enemy.id, x: 10, y: 5 }, 2);
    assert.equal(out.result?.saved, false, show(out));
    const after = kit.token(enemy.id);
    assert.notDeepEqual([after.x, after.y], [before.x, before.y], "the creature failed its save and stands where it stood");
  });

  await probe("demiurgic-colossus-reach", async () => {
    const who = await giant(14);
    const [enemy] = await stage(who);
    rage(who);
    kit.place(enemy.id, 8, 5);
    const out = await swing(who, enemy, [15, 4]);
    assert.equal(out.ok, true, `at 14th level a raging giant's reach is the 10 feet it was at 3rd: ${String(out.error).slice(0, 70)}`);
  });
}

finish();
