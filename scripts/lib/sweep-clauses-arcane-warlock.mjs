// The clause probes of the warlock's authored patrons: the Archfey, the Great
// Old One, the Celestial, the Hexblade, the Fathomless, the Genie, the Undead
// and the Undying (scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-warlock.mjs).
import assert from "node:assert/strict";
import { MOD, prof } from "./sweep-clauses-arcane.mjs";


export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, counter, budget, show, call, spend, react, hurt, roll, stage } = rig;
  const { friend, uses, rests } = shared;
  rig.outfit("warlock", "The Celestial", { spells: ["Sacred Flame", "Burning Hands"], cantrips: ["Sacred Flame"] });
  rig.outfit("warlock", "The Genie", { cantrips: ["Eldritch Blast"], spells: ["Eldritch Blast"] });
  const W = (patron, level = 20) => holder("warlock", patron, level);
  const fey = () => W("The Archfey");
  const old = () => W("The Great Old One");
  const cel = () => W("The Celestial");
  const hex = () => W("The Hexblade");
  const deep = () => W("The Fathomless");
  const genie = () => W("The Genie");
  const dead = () => W("The Undead");
  const undying = () => W("The Undying");
  const spellsAt = (patron, level) => rig.features.subclassSpellsFor("warlock", patron, level);
  const training = async (patron, level) => (await import("../../src/lib/srd/subclass-training.ts")).subclassGrants([{ id: "warlock", level, subclass: patron }]);
  const d = (out, sides) => out.rolled.filter((die) => die.sides === sides).length;
  // The dummy has hit `target` for 6 (13 against AC 12) on the friend's turn.
  async function hit(who, target = who, faces = [9, 4]) {
    const foes = await stage(who, { others: [friend()], first: friend() });
    await rig.table.strike(foes[0], target, faces);
    return foes;
  }
  async function cursed(who = hex()) {
    const foes = await stage(who);
    const out = await spend(who, "Hexblade's Curse", { targetEnemyId: foes[0].id });
    assert.equal(out.ok, true, out.error);
    return foes;
  }
  async function kind(who, name) {
    await kit.endFight();
    const out = await spend(who, "Genie Kind", { variant: name });
    assert.equal(out.ok, true, out.error);
  }
  async function dread(who = dead()) {
    const foes = await stage(who);
    const out = await spend(who, "Form of Dread", {}, [5]);
    assert.equal(out.ok, true, out.error);
    return foes;
  }
  async function condition(who, name) {
    return call("set_condition", { characterId: who.id, condition: name, rounds: 10 });
  }
  const has = (who, name) => sheet(who).conditions.includes(name);
  // The curse is the warlock's condition, its meta naming the cursed creature.
  const curseOn = (who) => {
    const name = sheet(who).conditions.find((entry) => entry.startsWith("hexblade's curse"));
    return name ? (sheet(who).conditionMeta?.[name] ?? {}) : null;
  };

  const PROBES = {
    // ---- The Archfey
    "fey-rest": rests(["warlock", "The Archfey"], "sub_fey_presence", "short"),
    "misty-invisible": async () => {
      await hit(fey());
      const out = await react(fey(), "Misty Escape");
      assert.equal(out.ok, true, out.error);
      assert.ok(has(fey(), "invisible"), JSON.stringify(sheet(fey()).conditions));
    },
    "misty-teleport": async () => {
      await hit(fey());
      const from = kit.token(fey().id);
      // 65 feet off is past the 60: refused, with the use kept.
      const far = await react(fey(), "Misty Escape", { x: from.x + 13, y: from.y });
      assert.equal(far.ok, false, "a square 65 feet away");
      assert.equal(counter(fey(), "sub_misty_escape").used, 0, "the refusal spent the use");
      const out = await react(fey(), "Misty Escape", { x: from.x + 10, y: from.y });
      assert.equal(out.ok, true, out.error);
      const at = kit.token(fey().id);
      assert.deepEqual([at.x, at.y], [from.x + 10, from.y], `the warlock stands where they took the hit: ${show(out).slice(0, 160)}`);
      assert.ok(has(fey(), "invisible"));
    },
    "misty-rest": rests(["warlock", "The Archfey"], "sub_misty_escape", "short"),
    "beguiling-immune": async () => {
      await stage(fey());
      await condition(fey(), "charmed");
      assert.equal(has(fey(), "charmed"), false);
    },
    "delirium-rest": rests(["warlock", "The Archfey"], "sub_dark_delirium", "short"),
    // ---- The Great Old One
    entropic: async () => {
      await hit(old());
      const before = hp(old());
      // The attack is thrown again at disadvantage: a 2 misses.
      const out = await react(old(), "Entropic Ward", {}, [2]);
      assert.equal(out.ok, true, out.error);
      assert.equal(hp(old()), before + 6);
      assert.equal(rig.reacted(old()), true);
    },
    "entropic-advantage": async () => {
      const [enemy] = await hit(old());
      assert.equal((await react(old(), "Entropic Ward", {}, [2])).ok, true);
      kit.giveTurn(old().id);
      kit.freshTurn();
      const swing = await kit.swing(old().id, enemy.id, [3, 17, 5], { weapon: "Longsword" });
      assert.equal(swing.ok, true, swing.error);
      assert.match(JSON.stringify(swing.result), /Entropic Ward: advantage/);
    },
    "entropic-rest": rests(["warlock", "The Great Old One"], "sub_entropic_ward", "short"),
    "thought-resist": async () => {
      await kit.endFight();
      assert.equal(await hurt(old(), 10, "psychic"), 5);
    },
    // "Whenever a creature deals psychic damage to you, that creature takes
    // the same amount of damage that you do": a creature's blow, a creature's
    // spell, and nothing back from a hazard no creature dealt.
    "thought-reflect": async () => {
      const who = old();
      const [enemy, caster] = await stage(who, { count: 2 });
      kit.setEnemy(enemy.id, { maxHp: 200, currentHp: 200, stats: { ...foe(enemy).stats, attacks: [{ name: "Mind Lash", toHit: 20, damage: "2d6", type: "psychic" }] } });
      let [mine, theirs] = [hp(who), foe(enemy).currentHp];
      const blow = await call("enemy_attack", { enemyId: enemy.id, targetCharacterId: who.id }, [15, 5, 5]);
      assert.equal(blow.ok, true, blow.error);
      assert.equal(mine - hp(who), 5, "10 psychic, halved by the resistance");
      assert.equal(theirs - foe(enemy).currentHp, 5, "the creature takes the 5 the warlock took");
      [mine, theirs] = [hp(who), foe(caster).currentHp];
      const spell = await call("cast_at_player", { characterId: who.id, source: "a mind spike", saveAbility: "wis", dc: 30, damage: "2d4", damageType: "psychic", casterEnemyId: caster.id }, [2, 4, 4]);
      assert.equal(spell.ok, true, spell.error);
      assert.equal(mine - hp(who), 4);
      assert.equal(theirs - foe(caster).currentHp, 4, `a spell's psychic damage goes back to its caster: ${show(spell).slice(0, 200)}`);
      theirs = foe(caster).currentHp;
      const trap = await call("cast_at_player", { characterId: who.id, source: "a screaming rune", saveAbility: "wis", dc: 30, damage: "2d4", damageType: "psychic" }, [2, 4, 4]);
      assert.equal(trap.ok, true, trap.error);
      assert.equal(foe(caster).currentHp, theirs, "a hazard is no creature");
      rig.refill(who);
    },
    // ---- The Celestial
    "celestial-cantrips": async () => {
      const spells = spellsAt("The Celestial", 1);
      assert.ok(spells.includes("Light") && spells.includes("Sacred Flame"), spells.join(", "));
    },
    "light-pool": async () => {
      await uses(["warlock", "The Celestial"], "sub_healing_light", { 1: 2, 20: 21 })();
      await lightRest();
    },
    "light-heal": async () => {
      await stage(cel(), { others: [friend()] });
      world.patch(friend().id, { currentHp: 20 });
      const out = await spend(cel(), "Healing Light", { targetCharacterId: friend().id, amount: 2 }, [3, 4]);
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(friend()).currentHp, 27);
      assert.equal(budget().bonusUsed, true);
      assert.equal(counter(cel(), "sub_healing_light").used, 2);
    },
    "light-cap": async () => {
      await stage(cel(), { others: [friend()] });
      world.patch(friend().id, { currentHp: 20 });
      const out = await spend(cel(), "Healing Light", { targetCharacterId: friend().id, amount: MOD.cha + 1 }, [1, 1, 1, 1, 1]);
      assert.equal(out.ok, false, `${MOD.cha + 1} dice, past the Charisma modifier`);
      assert.equal(counter(cel(), "sub_healing_light").used, 0);
    },
    "light-sight": async () => {
      await stage(cel(), { others: [friend()] });
      world.patch(friend().id, { currentHp: 20, conditions: ["invisible"], conditionMeta: { invisible: { rounds: 10 } } });
      const out = await spend(cel(), "Healing Light", { targetCharacterId: friend().id, amount: 1 }, [3]);
      assert.equal(out.ok, false, "the warlock cannot see the invisible friend, and healed them");
    },
    "light-range": async () => {
      await stage(cel(), { others: [friend()] });
      kit.place(friend().id, 5, 19);
      world.patch(friend().id, { currentHp: 20 });
      const out = await spend(cel(), "Healing Light", { targetCharacterId: friend().id, amount: 1 }, [3]);
      assert.equal(out.ok, false, `the friend ${rig.feetBetween(cel(), friend())} feet away was healed`);
    },
    "soul-resist": async () => {
      await kit.endFight();
      assert.deepEqual([await hurt(cel(), 10, "radiant"), await hurt(cel(), 10, "fire")], [5, 10]);
    },
    "soul-rider": async () => {
      const [enemy] = await stage(W("The Celestial", 6));
      const out = await call("cast_at_enemy", { characterId: W("The Celestial", 6).id, targetEnemyId: enemy.id, spell: "Sacred Flame" }, [1, 3, 3]);
      assert.equal(out.ok, true, out.error);
      // Sacred Flame at 6th level: 2d8 (3 + 3), and the Charisma modifier.
      assert.equal(300 - foe(enemy).currentHp, 6 + MOD.cha);
    },
    "soul-one-target": async () => {
      const who = W("The Celestial", 6);
      const [one, two] = await stage(who, { count: 2 });
      const out = await call("aoe_damage", { casterCharacterId: who.id, spell: "Burning Hands", enemyIds: [one.id, two.id] }, [20, 20, 2, 2, 2]);
      if (!out.ok) throw new Error(out.error);
      const dealt = [300 - foe(one).currentHp, 300 - foe(two).currentHp];
      // Both take the one roll (the pact slot is 3rd level), and the
      // Charisma modifier rides the first creature's damage alone.
      assert.equal(dealt[0] - dealt[1], MOD.cha, `Burning Hands dealt ${dealt.join(" and ")}: the Charisma modifier rides one target's roll`);
    },
    "vengeance-rest": rests(["warlock", "The Celestial"], "sub_searing_vengeance", "long"),
    // ---- The Hexblade
    curse: async () => {
      const [enemy] = await cursed();
      assert.equal(budget().bonusUsed, true);
      const meta = curseOn(hex());
      assert.equal(meta?.quarry ?? meta?.target ?? meta?.source, enemy.id, JSON.stringify(sheet(hex()).conditionMeta));
      assert.equal(meta?.rounds, 10, "a minute");
    },
    "curse-incapacitated": async () => {
      await cursed();
      assert.ok(curseOn(hex()), "the curse is laid");
      await condition(hex(), "incapacitated");
      assert.equal(curseOn(hex()), null, "the warlock is incapacitated and the curse stands");
    },
    "curse-heal": async () => {
      const [enemy] = await cursed();
      world.patch(hex().id, { currentHp: 40 });
      kit.setEnemy(enemy.id, { currentHp: 1 });
      kit.freshTurn();
      const out = await kit.swing(hex().id, enemy.id, [15, 4], { weapon: "Longsword" });
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(hex()).currentHp, 40 + 20 + MOD.cha);
    },
    "curse-rest": rests(["warlock", "The Hexblade"], "sub_hexblades_curse", "short"),
    "hexwarrior-training": async () => {
      const grant = (await training("The Hexblade", 1)).find((entry) => entry.name === "Hex Warrior");
      assert.ok(grant?.spec, JSON.stringify(grant));
      assert.ok(JSON.stringify(grant.spec.armor ?? "").includes("medium") && /shield/.test(JSON.stringify(grant.spec.armor ?? "")), JSON.stringify(grant.spec));
      assert.match(JSON.stringify(grant.spec), /martial/i, JSON.stringify(grant.spec));
    },
    "hexwarrior-pick": async () => {
      await kit.endFight();
      assert.equal((await spend(hex(), "Hex Warrior Weapon", { variant: "Greatsword" })).ok, false, "a two-handed weapon");
      assert.equal((await spend(hex(), "Hex Warrior Weapon", { variant: "Longsword" })).ok, true);
    },
    "hexwarrior-charisma": async () => {
      await kit.endFight();
      // The weapon already chosen stands: choosing an option again changes
      // nothing and is refused with nothing spent (authored-spend-effects.ts, choose).
      const chosen = await spend(hex(), "Hex Warrior Weapon", { variant: "Longsword" });
      assert.ok(chosen.ok || / already; choosing it again changes nothing/.test(chosen.error ?? ""), chosen.error);
      const [enemy] = await stage(hex());
      const out = await kit.swing(hex().id, enemy.id, [5, 4], { weapon: "Longsword" });
      assert.equal(out.ok, true, out.error);
      assert.equal(300 - foe(enemy).currentHp, 4 + MOD.cha, "a 4 on the d8 and the Charisma modifier (Strength is +0)");
    },
    "hexes-move": async () => {
      const [first, second] = await stage(hex(), { count: 2 });
      kit.setEnemy(first.id, { currentHp: 1 });
      const early = await spend(hex(), "Master of Hexes", { targetEnemyId: second.id });
      assert.equal(early.ok, false, "the cursed creature has not died");
      const cursed = await spend(hex(), "Hexblade's Curse", { targetEnemyId: first.id });
      assert.equal(cursed.ok, true, cursed.error);
      world.patch(hex().id, { currentHp: sheet(hex()).maxHp - 40 });
      const before = hp(hex());
      const kill = await kit.swing(hex().id, first.id, [15, 4]);
      assert.equal(kill.ok, true, kill.error);
      assert.ok(hp(hex()) > before, "the cursed creature's death heals the warlock");
      // "another creature you can see": an invisible one is refused, and the death stays open.
      kit.setEnemy(second.id, { conditions: ["invisible"] });
      assert.equal((await spend(hex(), "Master of Hexes", { targetEnemyId: second.id })).ok, false, "an unseen creature takes no curse");
      kit.setEnemy(second.id, { conditions: [] });
      const out = await spend(hex(), "Master of Hexes", { targetEnemyId: second.id });
      assert.equal(out.ok, true, out.error);
      assert.equal(hp(hex()), before, `moving the curse gives back the healing: ${show(out).slice(0, 160)}`);
    },
    "specter-rises": async () => {
      // A second foe keeps the fight on once the first falls.
      const [enemy] = await stage(hex(), { count: 2 });
      kit.setEnemy(enemy.id, { currentHp: 1, stats: { ...foe(enemy).stats, type: "humanoid" } });
      const early = await spend(hex(), "Accursed Specter");
      assert.equal(early.ok, false, "no humanoid has been slain");
      const kill = await kit.swing(hex().id, enemy.id, [15, 4]);
      assert.equal(kill.ok, true, kill.error);
      const out = await spend(hex(), "Accursed Specter");
      assert.equal(out.ok, true, out.error);
      const specter = world.sheets().find((entry) => entry.name.startsWith("Accursed Specter"));
      assert.ok(specter, `a specter stands at the table: ${show(out).slice(0, 160)}`);
      assert.equal(specter.tempHp, 10, "temporary hit points equal to half a 20th-level warlock's level");
    },
    "specter-rest": rests(["warlock", "The Hexblade"], "sub_accursed_specter", "long"),
    "armor-cursed-only": async () => {
      await hit(hex());
      const out = await react(hex(), "Armor of Hexes", {}, [6]);
      assert.equal(out.ok, false, "the creature that hit is not cursed");
    },
    "armor-d6": async () => {
      for (const [face, turned] of [[4, true], [3, false]]) {
        const [enemy] = await stage(hex(), { others: [friend()] });
        assert.equal((await spend(hex(), "Hexblade's Curse", { targetEnemyId: enemy.id })).ok, true);
        kit.giveTurn(friend().id);
        kit.freshTurn();
        await rig.table.strike(enemy, hex(), [9, 4]);
        const before = hp(hex());
        const out = await react(hex(), "Armor of Hexes", {}, [face]);
        assert.equal(out.ok, true, out.error);
        assert.equal(hp(hex()), turned ? before + 6 : before, `a ${face} on the d6`);
      }
    },
    // ---- The Fathomless
    tentacle: async () => {
      await stage(deep());
      const out = await spend(deep(), "Tentacle of the Deeps");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(sheet(deep()).conditionMeta["tentacle of the deep"]?.rounds, 10);
    },
    "tentacle-uses": async () => {
      await uses(["warlock", "The Fathomless"], "sub_tentacle_of_the_deep", { 1: prof(1), 20: prof(20) })();
      await tentacleRest();
    },
    "gift-swim": async () => {
      assert.equal(rig.speeds(W("The Fathomless", 1)).swim, 40);
    },
    "coil-near": async () => {
      const who = W("The Fathomless", 6);
      const [enemy] = await stage(who, { others: [friend()], first: who });
      assert.equal((await spend(who, "Tentacle of the Deeps")).ok, true);
      // The tentacle's strike sets it on the board beside the foe.
      kit.freshTurn();
      const lash = await kit.swing(who.id, enemy.id, [15, 3], { weapon: "Tentacle of the Deeps" });
      assert.equal(lash.ok, true, lash.error);
      const zone = (kit.map()?.spellZones ?? []).find((entry) => /tentacle/i.test(entry.spell));
      assert.ok(zone, "the tentacle stands on the board");
      // The friend stands 25 feet from the warlock and well away from the tentacle.
      kit.place(friend().id, 0, 5);
      kit.place(enemy.id, 0, 6);
      kit.giveTurn(friend().id);
      kit.freshTurn();
      await rig.table.strike(enemy, friend(), [9, 4]);
      const out = await react(who, "Guardian Coil", { targetCharacterId: friend().id }, [5]);
      assert.equal(out.ok, false, `the tentacle (${zone.origin.x},${zone.origin.y}) is far from the friend at 0,5, and the coil reduced the blow`);
    },
    "coil-dice": async () => {
      for (const [level, faces, cut] of [[6, [5], 5], [10, [3, 3], 6]]) {
        const who = W("The Fathomless", level);
        const [enemy] = await stage(who, { others: [friend()] });
        assert.equal((await spend(who, "Tentacle of the Deeps")).ok, true);
        kit.giveTurn(friend().id);
        kit.freshTurn();
        await rig.table.strike(enemy, who, [9, 6]);
        const before = hp(who);
        const out = await react(who, "Guardian Coil", {}, faces);
        assert.equal(out.ok, true, out.error);
        assert.equal(hp(who) - before, cut, `at level ${level}`);
      }
    },
    "grasping-learn": async () => {
      assert.ok(spellsAt("The Fathomless", 10).some((spell) => /black tentacles/i.test(spell)));
      assert.ok(!spellsAt("The Fathomless", 9).some((spell) => /black tentacles/i.test(spell)));
    },
    "grasping-free": async () => {
      const who = deep();
      await stage(who);
      const now = sheet(who);
      const spells = [...new Set([...(now.spellcasting.prepared ?? []), "Black Tentacles"])];
      world.patch(who.id, { spellcasting: { ...now.spellcasting, prepared: spells, known: spells, slots: Object.fromEntries(Object.entries(now.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: slot.max }])) } });
      const out = await call("use_spell_slot", { characterId: who.id, spell: "Black Tentacles" });
      assert.equal(out.ok, true, `cast with no slot left: ${String(out.error).slice(0, 170)}`);
      assert.equal(counter(who, "sub_grasping_tentacles").used, 1, "the once-a-day use pays");
      assert.equal(sheet(who).tempHp, 20, "temporary hit points equal to the warlock level");
    },
    "plunge-rest": rests(["warlock", "The Fathomless"], "sub_fathomless_plunge", "short"),
    // ---- The Genie
    "wrath-once": async () => {
      await kind(genie(), "Efreeti");
      const [enemy] = await stage(genie());
      const first = await kit.swing(genie().id, enemy.id, [15, 4], { weapon: "Longsword" });
      assert.equal(first.ok, true, first.error);
      const one = 300 - foe(enemy).currentHp;
      // A second attack in the same turn (the budget's once-a-turn marks kept).
      kit.saveEncounter({ ...world.encounter(), turnBudget: { ...budget(), actionUsed: false, attacksMade: 0 } });
      const second = await kit.swing(genie().id, enemy.id, [15, 4], { weapon: "Longsword" });
      assert.equal(second.ok, true, second.error);
      assert.deepEqual([one, 300 - foe(enemy).currentHp - one], [4 + prof(20), 4], `the first hit carries the proficiency bonus in fire, the second of the turn none: ${show(first).slice(0, 200)} // ${show(second).slice(0, 200)}`);
    },
    "wrath-spell-attack": async () => {
      const who = W("The Genie", 3);
      await kind(who, "Efreeti");
      const [enemy] = await stage(who);
      // 20 feet off: a ranged spell attack with no foe at the warlock's elbow.
      kit.place(enemy.id, 9, 5);
      const out = await call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, spell: "Eldritch Blast" }, [15, 5]);
      assert.equal(out.ok, true, out.error);
      assert.equal(300 - foe(enemy).currentHp, 5 + prof(3), `an Eldritch Blast hit of 5: ${show(out).slice(0, 160)}`);
    },
    "wrath-type": async () => {
      for (const [name, type] of [["Dao", "bludgeoning"], ["Djinni", "thunder"], ["Efreeti", "fire"], ["Marid", "cold"]]) {
        await kind(genie(), name);
        const [enemy] = await stage(genie());
        const out = await kit.swing(genie().id, enemy.id, [15, 4], { weapon: "Longsword" });
        assert.equal(out.ok, true, out.error);
        const line = JSON.stringify(out.result).match(/Genie's (?:Vessel|Wrath)[^"]*/g) ?? [];
        assert.ok(line.some((entry) => entry.includes(type)), `a ${name} warlock's hit: ${line.join(" | ")}`);
      }
    },
    "gift-resist": async () => {
      await kind(genie(), "Efreeti");
      assert.deepEqual([await hurt(genie(), 10, "fire"), await hurt(genie(), 10, "cold")], [5, 10]);
    },
    "gift-flight": async () => {
      await stage(genie());
      const out = await spend(genie(), "Elemental Flight");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(sheet(genie()).conditionMeta.flying?.rounds, 100, "10 minutes");
      assert.equal(rig.speeds(genie()).fly, 30);
    },
    "gift-uses": async () => {
      await uses(["warlock", "The Genie"], "sub_elemental_gift", { 6: prof(6), 20: prof(20) })();
      await giftRest();
    },
    // ---- The Undead
    dread: async () => {
      await dread();
      assert.equal(budget().bonusUsed, true);
      assert.equal(sheet(dead()).conditionMeta["form of dread"]?.rounds, 10);
      assert.equal(sheet(dead()).tempHp, 5 + 20, "1d10 (a 5) + the warlock level");
    },
    "dread-uses": async () => {
      await uses(["warlock", "The Undead"], "sub_form_of_dread", { 1: prof(1), 20: prof(20) })();
      await dreadRest();
    },
    "dread-immune": async () => {
      await dread();
      await condition(dead(), "frightened");
      assert.equal(has(dead(), "frightened"), false);
    },
    "dread-fright": async () => {
      const [enemy] = await dread();
      // The hit's dice: the sword's d8 and Grave Touched's (one more die in the
      // form, once a turn), then the creature's save.
      const swing = await kit.swing(dead().id, enemy.id, [15, 4, 4, 1], { weapon: "Longsword" });
      assert.equal(swing.ok, true, swing.error);
      assert.ok(foe(enemy).conditions.includes("frightened"), `a hit in Form of Dread, the creature's Wisdom save a 1: ${show(swing).slice(0, 200)}`);
      assert.equal(foe(enemy).conditionMeta.frightened?.untilTurnEndOf, dead().id, "until the end of the warlock's next turn");
      // Once on each turn: a second hit asks no second save.
      kit.setEnemy(enemy.id, { conditions: [] });
      kit.saveEncounter({ ...world.encounter(), turnBudget: { ...budget(), actionUsed: false, attacksMade: 0 } });
      const again = await kit.swing(dead().id, enemy.id, [15, 4, 1], { weapon: "Longsword" });
      assert.equal(again.ok, true, again.error);
      assert.ok(!foe(enemy).conditions.includes("frightened"), "a second save in the same turn");
    },
    "grave-die": async () => {
      const [enemy] = await dread();
      // Through `call`, whose dice log `d` reads (kit.swing keeps none).
      const blow = (faces) => call("pc_attack", { characterId: dead().id, targetEnemyId: enemy.id, weapon: "Longsword" }, faces);
      const before = foe(enemy).currentHp;
      const swing = await blow([15, 4, 4, 20]);
      assert.equal(swing.ok, true, swing.error);
      assert.equal(d(swing, 8), 2, "d8s rolled for a longsword hit in Form of Dread");
      assert.equal(before - foe(enemy).currentHp, 8, "both dice are damage");
      // Once on each turn: the second hit rolls the sword's own die alone.
      kit.saveEncounter({ ...world.encounter(), turnBudget: { ...budget(), actionUsed: false, attacksMade: 0 } });
      const again = await blow([15, 4, 4]);
      assert.equal(again.ok, true, again.error);
      assert.equal(d(again, 8), 1, "a second hit of the turn rolled the extra die again");
      // Out of the form, no die.
      const plain = holder("warlock", "The Undead", 20, {}, "out of the form");
      const [other] = await stage(plain);
      const outside = await call("pc_attack", { characterId: plain.id, targetEnemyId: other.id, weapon: "Longsword" }, [15, 4, 4]);
      assert.equal(d(outside, 8), 1, "a hit outside Form of Dread rolled the extra die");
    },
    "husk-resist": async () => {
      await kit.endFight();
      assert.equal(await hurt(dead(), 10, "necrotic"), 5);
    },
    "husk-immune": async () => {
      await dread();
      world.patch(dead().id, { tempHp: 0 });
      assert.equal(await hurt(dead(), 10, "necrotic"), 0);
    },
    husk: async () => {
      const [enemy] = await stage(dead(), { others: [friend()], first: friend() });
      world.patch(dead().id, { currentHp: 5 });
      await rig.table.strike(enemy, dead(), [9, 4]);
      assert.equal(sheet(dead()).currentHp, 0);
      const before = foe(enemy).currentHp;
      // The 1d4 of long rests first, then the 2d10.
      const out = await react(dead(), "Necrotic Husk", {}, [2, 5, 5]);
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(dead()).currentHp, 1);
      assert.equal(before - foe(enemy).currentHp, 10 + 20, `2d10 (5 + 5) + the warlock level: ${show(out).slice(0, 220)} ${JSON.stringify(out.rolled)}`);
      assert.equal(sheet(dead()).exhaustion, 1);
    },
    "husk-rests": async () => {
      // The 1d4 is rolled when the reaction is spent; its marker counts the nights.
      const [enemy] = await stage(dead(), { others: [friend()], first: friend() });
      world.patch(dead().id, { currentHp: 5 });
      await rig.table.strike(enemy, dead(), [9, 4]);
      const out = await react(dead(), "Necrotic Husk", {}, [2, 5, 5]);
      assert.equal(out.ok, true, out.error);
      const waiting = () => sheet(dead()).conditions.find((name) => /necrotic husk recovering/i.test(name)) ?? null;
      const nights = Number(/\((\d+)\)/.exec(waiting() ?? "")?.[1] ?? 0);
      assert.ok(nights >= 1 && nights <= 4, `the marker after the reaction: ${waiting()}`);
      // The fight ends with the marker kept (the rig's endFight would wipe it).
      if (world.encounter()) await world.invoke("end_encounter", { outcome: "truce" });
      for (let night = 1; night <= nights; night += 1) {
        // One long rest in 24 hours: a day passes before each.
        await call("pass_time", { amount: 24, unit: "hours", reason: "a day on the road" });
        const rested = await call("take_rest", { kind: "long" });
        assert.equal(rested.ok, true, rested.error);
        assert.equal(counter(dead(), "sub_necrotic_husk").used, night < nights ? 1 : 0, `after long rest ${night} of ${nights}: ${JSON.stringify(sheet(dead()).conditions)}`);
      }
    },
    projection: async () => {
      await stage(dead());
      const out = await spend(dead(), "Spirit Projection");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().actionUsed, true);
      assert.equal(sheet(dead()).conditionMeta["spirit projection"]?.rounds, 600, "an hour");
      await projectionRest();
    },
    "projection-concentration": async () => {
      await stage(dead());
      assert.equal((await spend(dead(), "Spirit Projection")).ok, true);
      assert.match(String(sheet(dead()).concentratingOn ?? ""), /spirit projection/i);
      // A failed concentration save (a 1) ends the projection.
      await call("apply_damage", { characterId: dead().id, amount: 10, type: "fire" }, [1]);
      assert.equal(has(dead(), "spirit projection"), false, "the concentration broke and the projection stands");
    },
    "projection-resist": async () => {
      await stage(dead());
      assert.equal((await spend(dead(), "Spirit Projection")).ok, true);
      assert.deepEqual([await hurt(dead(), 10, "slashing"), await hurt(dead(), 10, "fire")], [5, 10]);
    },
    "projection-fly": async () => {
      await stage(dead());
      assert.equal((await spend(dead(), "Spirit Projection")).ok, true);
      assert.equal(rig.speeds(dead()).fly, sheet(dead()).speed ?? 30);
    },
    // ---- The Undying
    "undying-cantrip": async () => {
      assert.ok(spellsAt("The Undying", 1).includes("Spare the Dying"));
    },
    "dead-immune": async () => {
      const [enemy] = await stage(undying(), { others: [friend()], first: friend() });
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, type: "undead" } });
      const attack = async (faces) => {
        kit.freshRound();
        const out = await call("enemy_attack", { enemyId: enemy.id, targetCharacterId: undying().id }, faces);
        if (!out.ok) throw new Error(out.error);
        return d(out, 20);
      };
      // The undead saves (a 20), then swings; the second attack asks no save.
      assert.equal(await attack([20, 9, 4]), 2, "the first attack: the ward's save, then the swing");
      assert.equal(await attack([9, 4, 9, 4]), 1, "d20s an undead that already saved throws to attack the warlock again");
      // One the warlock attacked is immune too.
      const [other] = await stage(undying());
      kit.setEnemy(other.id, { stats: { ...foe(other).stats, type: "undead" } });
      assert.equal((await kit.swing(undying().id, other.id, [15, 4], { weapon: "Longsword" })).ok, true);
      kit.giveTurn(friend().id);
      kit.freshRound();
      const out = await call("enemy_attack", { enemyId: other.id, targetCharacterId: undying().id }, [9, 4, 9, 4]);
      if (!out.ok) throw new Error(out.error);
      assert.equal(d(out, 20), 1, "d20s an undead the warlock struck throws to attack the warlock");
    },
    "undying-disease": async () => {
      await kit.endFight();
      assert.equal((await roll(undying(), { kind: "saving_throw", ability: "con", dc: 10, against: "disease" })).d20s, 2);
    },
    "defy-heal": async () => {
      // "When you succeed on a death saving throw": the save is made at its
      // own door in a fight (death.ts rollDeathSave), which leaves the record
      // Defy Death answers (trigger-table.ts sub_defy_death, steadied). A
      // death save count patched onto the sheet is no such moment.
      await stage(undying());
      rig.refill(undying());
      world.patch(undying().id, { currentHp: 0, conditions: ["unconscious"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
      const early = await spend(undying(), "Defy Death", {}, [5]);
      assert.equal(early.ok, false, "with no death save succeeded");
      const { rollDeathSave } = await import("../../src/lib/dm/death.ts");
      world.clearDice();
      world.dice(15);
      assert.match(String(rollDeathSave(world.campaign(), undying().id)), /success/);
      const out = await spend(undying(), "Defy Death", {}, [5]);
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(undying()).currentHp, 5 + MOD.con);
    },
    "defy-rest": rests(["warlock", "The Undying"], "sub_defy_death", "long"),
    indestructible: async () => {
      await stage(undying());
      world.patch(undying().id, { currentHp: 30 });
      const out = await spend(undying(), "Indestructible Life", {}, [5]);
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(sheet(undying()).currentHp, 30 + 5 + 20);
    },
    "indestructible-rest": rests(["warlock", "The Undying"], "sub_indestructible_life", "short"),
  };
  const lightRest = rests(["warlock", "The Celestial"], "sub_healing_light", "long");
  const tentacleRest = rests(["warlock", "The Fathomless"], "sub_tentacle_of_the_deep", "long");
  const giftRest = rests(["warlock", "The Genie"], "sub_elemental_gift", "long");
  const dreadRest = rests(["warlock", "The Undead"], "sub_form_of_dread", "long");
  const projectionRest = rests(["warlock", "The Undead"], "sub_spirit_projection", "long");

  const KNOWN = {};
  return { PROBES, KNOWN };
}
