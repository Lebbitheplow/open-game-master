// The clause probes of the sorcerer's authored origins: Wild Magic, Divine
// Soul, Shadow Magic, Storm Sorcery, Aberrant Mind, Clockwork Soul and Lunar
// Sorcery (scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-sorcerer.mjs).
import assert from "node:assert/strict";
import { MOD, prof } from "./sweep-clauses-arcane.mjs";

const DATA = "src/lib/srd/authored-effects-data*.ts";
const RES = "src/lib/srd/authored-resources.json";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, counter, left, budget, show, call, spend, react, hurt, roll, stage } = rig;
  const { friend, drain, freeReactions, uses, rests, hasDoor, buysAnother, movesSomething } = shared;
  rig.outfit("sorcerer", "Storm Sorcery", { spells: ["Shatter"] });
  rig.outfit("sorcerer", "Aberrant Mind", { spells: ["Dissonant Whispers"] });
  rig.outfit("sorcerer", "Shadow Magic", { spells: ["Darkness"] });
  rig.outfit("sorcerer", "Lunar Sorcery", { spells: ["Sacred Flame"], cantrips: ["Sacred Flame"] });
  const S = (origin, level = 20) => holder("sorcerer", origin, level);
  const wild = () => S("Wild Magic");
  const soul = () => S("Divine Soul");
  const shadow = () => S("Shadow Magic");
  const storm = () => S("Storm Sorcery");
  const mind = () => S("Aberrant Mind");
  const clock = () => S("Clockwork Soul");
  const lunar = () => S("Lunar Sorcery");
  const spellsAt = (origin, level) => rig.features.subclassSpellsFor("sorcerer", origin, level);
  const phase = async (name) => {
    await kit.endFight();
    const out = await spend(lunar(), "Lunar Phase", { variant: name });
    assert.equal(out.ok, true, out.error);
  };
  // The dummy has hit `target` for 6 (13 against AC 12) on the friend's turn.
  async function hit(who, target = who) {
    const foes = await stage(who, { others: [friend()], first: friend() });
    await rig.table.strike(foes[0], target, [9, 4]);
    return foes;
  }
  async function tranced() {
    const foes = await stage(clock());
    const out = await spend(clock(), "Trance of Order");
    assert.equal(out.ok, true, out.error);
    return foes;
  }

  const PROBES = {
    // ---- Wild Magic
    "tides-advantage": async () => {
      await kit.endFight();
      rig.refill(wild());
      const out = await spend(wild(), "Tides of Chaos", { variant: "save" });
      assert.equal(out.ok, true, out.error);
      assert.equal((await roll(wild(), { kind: "saving_throw", ability: "dex", dc: 10 })).d20s, 2, "the next save");
      assert.equal((await roll(wild(), { kind: "saving_throw", ability: "dex", dc: 10 })).d20s, 1, "the one after");
    },
    "bend-cost": async () => {
      await hit(wild());
      const [points, before] = [left(wild(), "sorcery_points"), hp(wild())];
      // 13 against AC 12, less a d4 of 2: a miss.
      const out = await react(wild(), "Bend Luck", {}, [2]);
      assert.equal(out.ok, true, out.error);
      assert.equal(points - left(wild(), "sorcery_points"), 2);
      assert.equal(rig.reacted(wild()), true);
      assert.equal(hp(wild()), before + 6);
    },
    "bend-doors": async () => {
      await stage(wild(), { others: [friend()], first: friend() });
      const failed = await roll(friend(), { kind: "saving_throw", ability: "dex", dc: 14 }, [11]);
      assert.equal(failed.out.result?.success, false);
      const out = await react(wild(), "Bend Luck", { targetCharacterId: friend().id, variant: "add" }, [4]);
      assert.equal(out.ok, true, `to add 1d4 to an ally's save that failed by one: ${String(out.error).slice(0, 170)}`);
    },
    "bombardment-door": hasDoor(["sorcerer", "Wild Magic"], "Spell Bombardment", (foes) => ({ targetEnemyId: foes[0].id })),
    // ---- Divine Soul
    "favored-rest": rests(["sorcerer", "Divine Soul"], "sub_favored_by_the_gods", "short"),
    "empowered-healing-door": hasDoor(["sorcerer", "Divine Soul"], "Empowered Healing", () => ({ targetCharacterId: friend().id })),
    wings: async () => {
      await stage(soul());
      assert.deepEqual(rig.speeds(soul()), {});
      const out = await spend(soul(), "Otherworldly Wings");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(rig.speeds(soul()).fly, 30);
    },
    "recovery-gate": async () => {
      await stage(soul());
      const full = await spend(soul(), "Unearthly Recovery");
      assert.equal(full.ok, false, "at full hit points");
      world.patch(soul().id, { currentHp: 50 });
      assert.equal((await spend(soul(), "Unearthly Recovery")).ok, false, "at exactly half");
      assert.equal(counter(soul(), "sub_unearthly_recovery").used, 0, "nothing spent");
    },
    recovery: async () => {
      await stage(soul());
      world.patch(soul().id, { currentHp: 30 });
      const out = await spend(soul(), "Unearthly Recovery");
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(soul()).currentHp, 30 + 50, "half of 100");
      assert.equal(budget().bonusUsed, true);
    },
    "recovery-rest": rests(["sorcerer", "Divine Soul"], "sub_unearthly_recovery", "long"),
    // ---- Shadow Magic
    "eyes-board": async () => {
      const now = sheet(shadow());
      assert.equal(rig.more.authoredDarkvisionFeet(now, 0), 120, "the attack's light reads it");
      assert.equal(rig.darkvisionFeet(shadow()), 120, "feet of darkvision the board's own sight gives the sorcerer (src/lib/battlemap/view.ts sheetDarkvisionTiles)");
    },
    "eyes-darkness": async () => {
      assert.ok(!spellsAt("Shadow Magic", 2).includes("Darkness"));
      assert.ok(spellsAt("Shadow Magic", 3).includes("Darkness"));
    },
    "eyes-points": async () => {
      await stage(shadow());
      const now = sheet(shadow());
      world.patch(shadow().id, { spellcasting: { ...now.spellcasting, slots: Object.fromEntries(Object.entries(now.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: slot.max }])) } });
      const out = await call("use_spell_slot", { characterId: shadow().id, level: 2, spell: "Darkness" });
      assert.equal(out.ok, true, `with every slot spent and ${left(shadow(), "sorcery_points")} sorcery points: ${String(out.error).slice(0, 150)}`);
    },
    "grave-save": async () => {
      await kit.endFight();
      rig.refill(shadow());
      world.patch(shadow().id, { currentHp: 10 });
      // 12 damage: DC 17. A 13 on the die is 17 with CHA +4.
      const out = await call("apply_damage", { characterId: shadow().id, amount: 12, type: "fire" }, [17 - MOD.cha]);
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(shadow()).currentHp, 1);
      assert.match(out.result.strengthOfTheGrave, /DC 17/);
      assert.equal(counter(shadow(), "sub_strength_of_the_grave").used, 1);
      world.patch(shadow().id, { currentHp: 10 });
      await call("apply_damage", { characterId: shadow().id, amount: 12, type: "fire" }, [20]);
      assert.equal(sheet(shadow()).currentHp, 0, "spent, it does not answer again");
    },
    "grave-radiant": async () => {
      await kit.endFight();
      rig.refill(shadow());
      world.patch(shadow().id, { currentHp: 10 });
      await call("apply_damage", { characterId: shadow().id, amount: 12, type: "radiant" }, [20]);
      assert.equal(sheet(shadow()).currentHp, 0);
      assert.equal(counter(shadow(), "sub_strength_of_the_grave").used, 0);
      rig.refill(shadow());
    },
    "grave-rest": rests(["sorcerer", "Shadow Magic"], "sub_strength_of_the_grave", "long"),
    hound: async () => {
      const [enemy] = await stage(shadow());
      const points = left(shadow(), "sorcery_points");
      const out = await spend(shadow(), "Hound of Ill Omen", { targetEnemyId: enemy.id });
      assert.equal(out.ok, true, out.error);
      assert.equal(points - left(shadow(), "sorcery_points"), 3);
      assert.ok(foe(enemy).conditions.includes("hound of ill omen"));
    },
    "hound-wolf": movesSomethingBut("hound of ill omen"),
    "shadow-walk": async () => {
      await stage(shadow());
      const out = await spend(shadow(), "Shadow Walk");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(budget().actionUsed, false);
    },
    umbral: async () => {
      await stage(shadow());
      const points = left(shadow(), "sorcery_points");
      const out = await spend(shadow(), "Umbral Form");
      assert.equal(out.ok, true, out.error);
      assert.equal(points - left(shadow(), "sorcery_points"), 6);
      assert.equal(sheet(shadow()).conditionMeta["umbral form"].rounds, 10);
    },
    "umbral-resist": async () => {
      await stage(shadow());
      await spend(shadow(), "Umbral Form");
      assert.deepEqual([await hurt(shadow(), 10, "fire"), await hurt(shadow(), 10, "slashing"), await hurt(shadow(), 10, "force"), await hurt(shadow(), 10, "radiant")], [5, 5, 10, 10]);
    },
    // ---- Storm Sorcery
    "wind-speaker": async () => {
      const training = await import("../../src/lib/srd/subclass-training.ts");
      const [grant] = training.subclassGrants([{ id: "sorcerer", level: 1, subclass: "Storm Sorcery" }]);
      assert.deepEqual(grant.spec.fixedLanguages, ["Primordial"]);
    },
    tempest: async () => {
      await stage(S("Storm Sorcery", 6));
      const out = await spend(S("Storm Sorcery", 6), "Tempestuous Magic");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.match(out.result.teleport, /up to 10 feet, flying, without provoking opportunity attacks/);
    },
    "tempest-trigger": async () => {
      await stage(S("Storm Sorcery", 6));
      const out = await spend(S("Storm Sorcery", 6), "Tempestuous Magic");
      assert.equal(out.ok, false, "on a turn with no spell cast, the flight is taken");
    },
    "heart-resist": async () => {
      await kit.endFight();
      const who = S("Storm Sorcery", 6);
      assert.deepEqual([await hurt(who, 10, "lightning"), await hurt(who, 10, "thunder"), await hurt(who, 10, "fire")], [5, 5, 10]);
    },
    "heart-burst": async () => {
      const who = S("Storm Sorcery", 6);
      const [near, far] = await stage(who, { count: 2 });
      kit.place(far.id, 12, 5);
      const before = foe(near).currentHp;
      const out = await call("aoe_damage", { casterCharacterId: who.id, spell: "Shatter", enemyIds: [far.id] }, [20, 1, 1, 1]);
      if (!out.ok) throw new Error(out.error);
      assert.equal(before - foe(near).currentHp, 3, "damage to the creature 5 feet from a 6th-level storm sorcerer who cast Shatter (thunder) at another");
    },
    "fury-push": async () => {
      const foes = await hit(storm());
      const at = kit.token(foes[0].id);
      // The creature fails its Strength save on a 1.
      const out = await react(storm(), "Storm's Fury", {}, [1]);
      assert.equal(out.ok, true, out.error);
      const now = kit.token(foes[0].id);
      assert.notDeepEqual([now.x, now.y], [at.x, at.y], `the creature failed its save and stands where it stood: ${show(out).slice(0, 170)}`);
    },
    "windsoul-immune": async () => {
      await kit.endFight();
      assert.deepEqual([await hurt(storm(), 10, "lightning"), await hurt(storm(), 10, "thunder")], [0, 0]);
    },
    "windsoul-fly": async () => {
      assert.equal(rig.speeds(storm()).fly, 60);
      assert.equal(rig.speeds(S("Storm Sorcery", 14)).fly, undefined, "not before 18th level");
    },
    "windsoul-grant": async () => {
      await stage(storm(), { others: [friend()] });
      const out = await spend(storm(), "Wind Soul");
      assert.equal(out.ok, true, out.error);
      assert.equal(sheet(friend()).conditionMeta.flying?.rounds, 600, "an hour");
    },
    "windsoul-rest": rests(["sorcerer", "Storm Sorcery"], "sub_wind_soul", "short"),
    // ---- Aberrant Mind
    "psionic-spells": async () => {
      assert.deepEqual(spellsAt("Aberrant Mind", 1), ["Arms of Hadar", "Dissonant Whispers", "Mind Sliver"]);
      assert.ok(spellsAt("Aberrant Mind", 9).includes("Telekinesis"));
    },
    "psionic-sorcery": async () => {
      const [enemy] = await stage(mind());
      const now = sheet(mind());
      world.patch(mind().id, { spellcasting: { ...now.spellcasting, slots: Object.fromEntries(Object.entries(now.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: slot.max }])) } });
      const out = await call("cast_at_enemy", { characterId: mind().id, targetEnemyId: enemy.id, spell: "Dissonant Whispers" }, [1, 3, 3, 3]);
      assert.equal(out.ok, true, `Dissonant Whispers with every slot spent and ${left(mind(), "sorcery_points")} sorcery points: ${String(out.error).slice(0, 150)}`);
    },
    "psychic-resist": async () => {
      await kit.endFight();
      assert.equal(await hurt(mind(), 10, "psychic"), 5);
    },
    "psychic-saves": async () => {
      await kit.endFight();
      const thrown = {};
      for (const against of ["charmed", "frightened"]) thrown[against] = (await roll(mind(), { kind: "saving_throw", ability: "wis", dc: 10, against })).d20s;
      assert.deepEqual(thrown, { charmed: 2, frightened: 2 }, "d20s thrown for a save against each");
    },
    revelation: async () => {
      await stage(mind());
      const points = left(mind(), "sorcery_points");
      const out = await spend(mind(), "Revelation in Flesh", { variant: "fly", amount: 1 });
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(points - left(mind(), "sorcery_points"), 1);
      assert.equal(sheet(mind()).conditionMeta["revelation in flesh (fly)"].rounds, 100, "10 minutes");
    },
    "revelation-fly": async () => {
      await stage(mind());
      await spend(mind(), "Revelation in Flesh", { variant: "fly", amount: 1 });
      assert.equal(rig.speeds(mind()).fly, sheet(mind()).speed);
    },
    "revelation-swim": async () => {
      await stage(mind());
      await spend(mind(), "Revelation in Flesh", { variant: "swim", amount: 1 });
      assert.equal(rig.speeds(mind()).swim, 2 * sheet(mind()).speed, "the swimming speed of a sorcerer who walks 30 feet");
    },
    "implosion-uses": async () => {
      await uses(["sorcerer", "Aberrant Mind"], "sub_warping_implosion", { 18: 1 })();
      await implosionRest();
    },
    "implosion-points": buysAnother(["sorcerer", "Aberrant Mind"], "Warping Implosion", "sub_warping_implosion", "sorcery point"),
    // ---- Clockwork Soul
    "clockwork-spells": async () => {
      assert.deepEqual(spellsAt("Clockwork Soul", 1), ["Alarm", "Protection from Evil and Good"]);
      assert.ok(spellsAt("Clockwork Soul", 9).includes("Wall of Force"));
    },
    "balance-uses": async () => {
      await uses(["sorcerer", "Clockwork Soul"], "sub_restore_balance", { 1: prof(1), 20: prof(20) })();
      await balanceRest();
    },
    "bastion-door": hasDoor(["sorcerer", "Clockwork Soul"], "Bastion of Law", () => ({ targetCharacterId: friend().id, amount: 2 })),
    "trance-on": async () => {
      await tranced();
      assert.equal(sheet(clock()).conditionMeta["trance of order"].rounds, 10);
    },
    "trance-floor": async () => {
      await tranced();
      const rolled = await roll(clock(), { kind: "saving_throw", ability: "dex", dc: 10 }, [3]);
      assert.equal(rolled.out.result.total, 10 + MOD.dex, "a Dexterity save with a 3 on the die");
    },
    "trance-advantage": async () => {
      const [enemy] = await tranced();
      const out = await call("enemy_attack", { enemyId: enemy.id, targetCharacterId: clock().id, advantage: "advantage", advantageReason: "the sorcerer is flanked" }, [2, 19, 4]);
      if (!out.ok) throw new Error(out.error);
      assert.equal(out.rolled.filter((die) => die.sides === 20).length, 1, "d20s thrown by an attacker with advantage");
    },
    "trance-uses": async () => {
      await uses(["sorcerer", "Clockwork Soul"], "sub_trance_of_order", { 14: 1 })();
      await tranceRest();
    },
    "trance-points": buysAnother(["sorcerer", "Clockwork Soul"], "Trance of Order", "sub_trance_of_order", "sorcery point"),
    "cavalcade-uses": async () => {
      await uses(["sorcerer", "Clockwork Soul"], "sub_clockwork_cavalcade", { 18: 1 })();
      await cavalcadeRest();
    },
    "cavalcade-points": buysAnother(["sorcerer", "Clockwork Soul"], "Clockwork Cavalcade", "sub_clockwork_cavalcade", "sorcery point"),
    // ---- Lunar Sorcery
    "lunar-spells": async () => {
      const table = { 1: ["Shield", "Ray of Sickness", "Color Spray"], 3: ["Lesser Restoration", "Blindness/Deafness", "Alter Self"], 5: ["Dispel Magic", "Vampiric Touch", "Phantom Steed"], 7: ["Death Ward", "Confusion", "Hallucinatory Terrain"], 9: ["Rary's Telepathic Bond", "Hold Monster", "Mislead"] };
      for (const [level, spells] of Object.entries(table)) {
        // Below 1st level there is no sorcerer: subclassSpellsFor answers a
        // level 0 with the 1st-level list, so the 1st-level row has no "not
        // before" half to check.
        const below = Number(level) > 1 ? spellsAt("Lunar Sorcery", Number(level) - 1) : [];
        const at = spellsAt("Lunar Sorcery", Number(level));
        for (const spell of spells) assert.ok(at.includes(spell) && !below.includes(spell), `${spell} at ${level}`);
      }
    },
    "moon-fire-cantrip": async () => {
      assert.ok(spellsAt("Lunar Sorcery", 1).includes("Sacred Flame"));
    },
    "lunar-phase": async () => {
      await phase("New Moon");
      assert.ok(sheet(lunar()).features.some((feature) => feature.name === "Lunar Embodiment (New Moon)"));
      await stage(lunar());
      assert.equal((await spend(lunar(), "Lunar Phase", { variant: "Full Moon" })).ok, false, "not in the middle of a fight");
    },
    "moon-fire": async () => {
      const [one, two] = await stage(lunar(), { count: 2 });
      const out = await call("cast_at_enemy", { characterId: lunar().id, targetEnemyId: one.id, secondTargetEnemyId: two.id, spell: "Sacred Flame" }, [1, 1, 3, 3, 3, 3]);
      assert.equal(out.ok, true, out.error);
      assert.ok(foe(one).currentHp < 300 && foe(two).currentHp < 300, "both burn");
      kit.freshTurn();
      kit.place(two.id, 14, 5);
      const apart = await call("cast_at_enemy", { characterId: lunar().id, targetEnemyId: one.id, secondTargetEnemyId: two.id, spell: "Sacred Flame" }, [1, 1, 3, 3, 3, 3]);
      assert.equal(apart.ok, false, "40 feet apart");
    },
    "lunar-boons": movesSomething(["sorcerer", "Lunar Sorcery"], "Lunar Boons"),
    "boons-uses": async () => {
      await uses(["sorcerer", "Lunar Sorcery"], "sub_lunar_boons", { 6: prof(6), 20: prof(20) })();
      await boonsRest();
    },
    "waxing-change": async () => {
      await phase("Full Moon");
      await stage(lunar());
      const points = left(lunar(), "sorcery_points");
      const tried = [await spend(lunar(), "Lunar Phase", { variant: "New Moon" }), await spend(lunar(), "Waxing and Waning", { variant: "New Moon" })];
      const changed = sheet(lunar()).features.some((feature) => feature.name === "Lunar Embodiment (New Moon)");
      assert.deepEqual([changed, points - left(lunar(), "sorcery_points")], [true, 1], `[the phase changed in a fight, sorcery points paid] (Lunar Phase: ${String(tried[0].error).slice(0, 90)})`);
    },
    "empowerment-full": async () => {
      await phase("Full Moon");
      assert.deepEqual([(await roll(lunar(), { kind: "skill_check", skill: "perception", dc: 10 })).d20s, (await roll(lunar(), { kind: "skill_check", skill: "investigation", dc: 10 })).d20s, (await roll(lunar(), { kind: "skill_check", skill: "stealth", dc: 10 })).d20s], [2, 2, 1]);
    },
    "empowerment-new": async () => {
      await phase("New Moon");
      assert.deepEqual([(await roll(lunar(), { kind: "skill_check", skill: "stealth", dc: 10 })).d20s, (await roll(lunar(), { kind: "skill_check", skill: "perception", dc: 10 })).d20s], [2, 1]);
    },
    "empowerment-crescent": async () => {
      await phase("Crescent Moon");
      assert.deepEqual([await hurt(lunar(), 10, "necrotic"), await hurt(lunar(), 10, "radiant"), await hurt(lunar(), 10, "fire")], [5, 5, 10]);
    },
    "phenomenon-cost": async () => {
      await stage(lunar());
      // A bare spend is refused: the use names its phase's variant (WAVE1 R10,
      // a pool spent only through a named option). Crescent Moon asks no creature.
      const out = await spend(lunar(), "Lunar Phenomenon", { variant: "crescent moon" });
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      await uses(["sorcerer", "Lunar Sorcery"], "sub_lunar_phenomenon", { 18: 1 })();
      await phenomenonRest();
    },
    "phenomenon-points": buysAnother(["sorcerer", "Lunar Sorcery"], "Lunar Phenomenon", "sub_lunar_phenomenon", "sorcery point"),
  };
  const implosionRest = rests(["sorcerer", "Aberrant Mind"], "sub_warping_implosion", "long");
  const balanceRest = rests(["sorcerer", "Clockwork Soul"], "sub_restore_balance", "long");
  const tranceRest = rests(["sorcerer", "Clockwork Soul"], "sub_trance_of_order", "long");
  const cavalcadeRest = rests(["sorcerer", "Clockwork Soul"], "sub_clockwork_cavalcade", "long");
  const boonsRest = rests(["sorcerer", "Lunar Sorcery"], "sub_lunar_boons", "long");
  const phenomenonRest = rests(["sorcerer", "Lunar Sorcery"], "sub_lunar_phenomenon", "long");

  // The hound: spent, and beyond the mark on its quarry nothing joins the fight.
  function movesSomethingBut(mark) {
    return async () => {
      const [enemy] = await stage(shadow(), { others: [friend()] });
      const before = [world.sheets().length, world.enemies().length];
      const out = await spend(shadow(), "Hound of Ill Omen", { targetEnemyId: enemy.id });
      if (!out.ok) throw new Error(out.error);
      assert.ok(foe(enemy).conditions.includes(mark));
      assert.notDeepEqual([world.sheets().length, world.enemies().length], before, "no creature joined the table for the hound: it is a mark on its quarry, and never bites");
    };
  }

  const KNOWN = {
    "bend-doors": { severity: "medium", kind: "rule-missing", where: `${DATA} sorcerer::Bend Luck (one reaction, attack_penalty 1d4: a subtraction from an attack that hit)`, note: "Of the six cases in the text (add or subtract, on an attack, a check or a save) one has a door. An ally's save that failed by one cannot be lifted; a foe's save that passed by one cannot be dropped.", fix: "Offer Bend Luck on the after-roll card for another creature's check or save, and as an addition to an ally's attack." },
    "bombardment-door": { severity: "low", kind: "rule-missing", where: `${DATA} sorcerer::Spell Bombardment (narrated: "the GM adds it with apply_damage")`, note: "The engine rolls the spell's dice and knows which is the highest.", fix: "Explode the highest die of the holder's spell damage once a turn." },
    "empowered-healing-door": { severity: "low", kind: "rule-missing", where: `${DATA} sorcerer::Empowered Healing (narrated: "the GM rolls them again and spends the point with use_resource")`, note: "", fix: "A reroll of the healing dice of the last heal for a sorcery point, once a turn." },
    "eyes-board": { severity: "medium", kind: "path-parity", where: "src/lib/battlemap/view.ts sheetDarkvisionTiles and src/lib/dm/place-light.ts (neither reads authoredDarkvisionFeet; src/lib/dm/attack-light.ts does)", note: "The sorcerer attacks in the dark without disadvantage, and the board still shows them nothing there: their own screen and the light a Perception check reads treat them as blind in darkness. Every authored darkvision row shares it (Umbral Sight).", fix: "Read authoredDarkvisionFeet in sheetDarkvisionTiles." },
    "eyes-points": { severity: "low", kind: "rule-missing", where: `${DATA} sorcerer::Eyes of the Dark (note: "Darkness for 2 sorcery points ... is the cast tools' with the points spent"); src/lib/dm/cast-guard.ts has no such price`, note: "The note names a door the cast tools do not have.", fix: "Let Darkness be paid with 2 sorcery points by a holder." },
    "hound-wolf": { severity: "medium", kind: "rule-missing", where: `${DATA} sorcerer::Hound of Ill Omen (buff on the enemy; no summon)`, note: "The hound is a dire wolf that attacks its quarry every round; three sorcery points buy the disadvantage on saves only.", fix: "A summon of the hound (dire wolf, half the sorcerer level in temporary hit points) bound to its quarry." },
    "tempest-trigger": { severity: "low", kind: "timing-window", where: `${DATA} sorcerer::Tempestuous Magic (a plain bonus-action spend; nothing asks for a spell cast this turn)`, note: "", fix: "Gate the spend on a spell of 1st level or higher cast this turn, or about to be." },
    "heart-burst": { severity: "medium", kind: "rule-missing", where: "src/lib/srd/feature-effects.ts Heart of the Storm (the resistance only; the second half of the sentence is its guidance)", note: "No written reason: the row is counted as typed because of the resistance.", fix: "On a lightning or thunder spell of 1st level or higher, deal half the sorcerer level to chosen creatures within 10 feet." },
    "fury-push": { severity: "low", kind: "rule-missing", where: `${DATA} sorcerer::Storm's Fury (save.onFail is a sentence: "is pushed up to 20 feet (move_token forced)")`, note: "The engine rolls the save and leaves the push to a second call.", fix: "Move the creature 20 feet straight away on the failed save." },
    "psionic-sorcery": { severity: "medium", kind: "rule-missing", where: `${DATA} sorcerer::Psionic Sorcery (narrated: "the cast tools with the points spent by use_resource"); the cast tools refuse a caster with no slot`, note: "The narrated door does not exist: with no slot left the cast is refused, so the points cannot stand in for one.", fix: "Let a psionic spell be paid with sorcery points equal to its level." },
    "psychic-saves": { severity: "medium", kind: "rule-missing", where: "src/lib/srd/feature-effects.ts Psychic Defenses (resistance only; no save_adv against charmed and frightened)", note: "A passive defence a player never sees missing. No written reason.", fix: "An authored effect save_adv against charmed and frightened." },
    "revelation-swim": { severity: "low", kind: "rule-wrong", where: `${DATA} sorcerer::Revelation in Flesh (move swim "walk"; its own note says "The swimming speed is twice the walking speed")`, note: "", fix: "A swim value of twice the walking speed." },
    "implosion-points": { severity: "low", kind: "rule-missing", where: `${RES} sub_warping_implosion (no purchase with sorcery points)`, note: "", fix: "With the use spent, take 5 sorcery points instead." },
    "bastion-door": { severity: "medium", kind: "rule-missing", where: `${DATA} sorcerer::Bastion of Law (narrated: "the GM rolls the dice spent off the damage")`, note: "A ward of up to 5d8 that lasts until the next long rest, with nowhere to be written down.", fix: "A spend that lays the ward's dice on a creature and a reaction-free reduction when it is hit." },
    "trance-floor": { severity: "medium", kind: "rule-missing", where: "src/lib/srd/condition-effects.ts trance of order (a summary and nothing else); src/lib/dm/rolls.ts", note: "The use is spent, the condition is laid, and neither half of it is read by any roll.", fix: "Read the condition where Silver Tongue's check_floor is read, for attacks, checks and saves." },
    "trance-advantage": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/enemy-swing-odds.ts (the trance is not read)", note: "", fix: "Strike advantage from attacks against a creature in the trance." },
    "trance-points": { severity: "low", kind: "rule-missing", where: `${RES} sub_trance_of_order (no purchase with sorcery points)`, note: "", fix: "With the use spent, take 5 sorcery points instead." },
    "cavalcade-points": { severity: "low", kind: "rule-missing", where: `${RES} sub_clockwork_cavalcade (no purchase with sorcery points)`, note: "", fix: "With the use spent, take 7 sorcery points instead." },
    "lunar-boons": { severity: "low", kind: "rule-missing", where: `${RES} sub_lunar_boons (a counter with guidance); src/lib/dm/metamagic*.ts does not read it`, note: "", fix: "Lower the Metamagic cost by 1 for a spell of the phase's schools while a use remains." },
    "waxing-change": { severity: "medium", kind: "rule-missing", where: `${DATA} sorcerer::Lunar Embodiment (the phase spend is fight: "out" and free); ${RES} sub_waxing_and_waning`, note: "Out of a fight the phase changes for nothing; in one it cannot change at all.", fix: "From 6th level let the phase change in a fight for a bonus action and 1 sorcery point." },
    "phenomenon-points": { severity: "low", kind: "rule-missing", where: `${RES} sub_lunar_phenomenon (its guidance says "Again for 5 sorcery points"; no such purchase)`, note: "", fix: "With the use spent, take 5 sorcery points instead." },
  };
  return { PROBES, KNOWN };
}
