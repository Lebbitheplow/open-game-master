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
  const { friend, drain, freeReactions, uses, rests, hasDoor, buysAnother } = shared;
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
      const spendSlots = () => {
        const now = sheet(shadow());
        world.patch(shadow().id, { spellcasting: { ...now.spellcasting, slots: Object.fromEntries(Object.entries(now.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: slot.max }])) } });
      };
      spendSlots();
      const points = left(shadow(), "sorcery_points");
      const out = await call("use_spell_slot", { characterId: shadow().id, level: 2, spell: "Darkness" });
      assert.equal(out.ok, true, `with every slot spent and ${points} sorcery points: ${String(out.error).slice(0, 150)}`);
      assert.equal(points - left(shadow(), "sorcery_points"), 2, "sorcery points Darkness costs through Eyes of the Dark");
      assert.equal(sheet(shadow()).concentratingOn, "Darkness");
      // One point is not two: refused, the point kept.
      await stage(shadow());
      spendSlots();
      drain(shadow(), "sorcery_points");
      world.patch(shadow().id, { resources: { ...sheet(shadow()).resources, sorcery_points: { ...counter(shadow(), "sorcery_points"), used: counter(shadow(), "sorcery_points").max - 1 } } });
      const short = await call("use_spell_slot", { characterId: shadow().id, level: 2, spell: "Darkness" });
      assert.equal(short.ok, false, "with one sorcery point and no slot");
      assert.equal(left(shadow(), "sorcery_points"), 1, "nothing spent");
      // Below 3rd level the sorcerer does not know the spell this way.
      const young = S("Shadow Magic", 2);
      await stage(young);
      const early = await call("use_spell_slot", { characterId: young.id, spell: "Darkness" });
      assert.equal(early.ok, false, "a 2nd-level shadow sorcerer casts Darkness");
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
    // The hound itself: a dire wolf on the sorcerer's side with temporary hit
    // points equal to half the sorcerer level, bound to the creature named
    // (src/lib/dm/ar-ws-hound.ts, ar-ws-hound-quarry.ts).
    "hound-wolf": async () => {
      const hounds = () => world.sheets().filter((entry) => entry.name.startsWith("Hound of Ill Omen"));
      const [quarry, other] = await stage(shadow(), { count: 2, others: [friend()] });
      rig.endCurrent();
      kit.giveTurn(shadow().id);
      kit.freshTurn();
      assert.deepEqual(hounds().map((entry) => entry.name), [], "a hound of an earlier fight is gone once its fight is over and a turn has moved on");
      const out = await spend(shadow(), "Hound of Ill Omen", { targetEnemyId: quarry.id });
      if (!out.ok) throw new Error(out.error);
      assert.ok(foe(quarry).conditions.includes("hound of ill omen"), "the quarry carries the mark");
      const [hound] = hounds();
      assert.ok(hound, `no creature joined the table for the hound: ${show(out).slice(0, 200)}`);
      assert.deepEqual([hound.maxHp, hound.tempHp, hound.ac], [37, 10, 14], "[hit points, temporary hit points, AC]: a dire wolf's block, and half a 20th-level sorcerer's level");
      assert.equal(hound.conditionMeta["hunting its quarry"]?.quarry, quarry.id, "bound to the creature named");
      assert.ok(world.encounter().order.some((entry) => entry.characterId === hound.id), "it has its own place in the initiative order");
      // It attacks its quarry and no other creature.
      kit.giveTurn(hound.id);
      kit.freshTurn();
      kit.place(hound.id, 6, 6);
      const off = await call("pc_attack", { characterId: hound.id, targetEnemyId: other.id, weapon: "Bite" }, [15, 3, 3]);
      assert.equal(off.ok, false, "a bite at a creature that is not its quarry");
      assert.match(off.error, /is not its quarry/);
      const before = foe(quarry).currentHp;
      const bite = await call("pc_attack", { characterId: hound.id, targetEnemyId: quarry.id, weapon: "Bite" }, [15, 3, 3]);
      assert.equal(bite.ok, true, bite.error);
      assert.equal(before - foe(quarry).currentHp, 3 + 3 + 3, "a dire wolf's bite, 2d6 + 3");
      // The quarry falls: the hound is gone when the turn moves on.
      kit.setEnemy(quarry.id, { currentHp: 1 });
      const felled = await call("apply_damage", { enemyId: quarry.id, amount: 5, type: "force" });
      assert.equal(felled.ok, true, felled.error);
      rig.endCurrent();
      assert.deepEqual(hounds().map((entry) => entry.name), [], "the hound outlived its quarry");
    },
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
      const spendSlots = () => {
        const now = sheet(mind());
        world.patch(mind().id, { spellcasting: { ...now.spellcasting, prepared: [...new Set([...now.spellcasting.prepared, "Magic Missile"])], known: [...new Set([...now.spellcasting.known, "Magic Missile"])], slots: Object.fromEntries(Object.entries(now.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: slot.max }])) } });
      };
      const [enemy] = await stage(mind());
      // With a slot at hand, the slot pays.
      const points = left(mind(), "sorcery_points");
      const slotted = await call("cast_at_enemy", { characterId: mind().id, targetEnemyId: enemy.id, spell: "Dissonant Whispers" }, [1, 3, 3, 3]);
      assert.equal(slotted.ok, true, slotted.error);
      assert.deepEqual([points - left(mind(), "sorcery_points"), sheet(mind()).spellcasting.slots[1].used], [0, 1], "[sorcery points, 1st-level slots] spent with slots at hand");
      kit.freshTurn();
      spendSlots();
      const out = await call("cast_at_enemy", { characterId: mind().id, targetEnemyId: enemy.id, spell: "Dissonant Whispers" }, [1, 3, 3, 3]);
      assert.equal(out.ok, true, `Dissonant Whispers with every slot spent and ${left(mind(), "sorcery_points")} sorcery points: ${String(out.error).slice(0, 150)}`);
      assert.equal(points - left(mind(), "sorcery_points"), 1, "sorcery points a 1st-level psionic spell costs: its level");
      // A spell that is not one of the psionic spells finds no points to pay it.
      kit.freshTurn();
      const other = await call("cast_at_enemy", { characterId: mind().id, targetEnemyId: enemy.id, spell: "Magic Missile" }, [1, 1, 1]);
      assert.equal(other.ok, false, "Magic Missile with every slot spent");
      // With no point left the psionic spell is refused too.
      drain(mind(), "sorcery_points");
      const broke = await call("cast_at_enemy", { characterId: mind().id, targetEnemyId: enemy.id, spell: "Dissonant Whispers" }, [1, 3, 3, 3]);
      assert.equal(broke.ok, false, "with no slot and no sorcery point");
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
    "balance-cancel": async () => {
      const [enemy] = await stage(clock(), { others: [friend()], first: friend() });
      const before = hp(clock());
      const out = await call("enemy_attack", { enemyId: enemy.id, targetCharacterId: clock().id, advantage: "advantage", advantageReason: "the sorcerer is flanked" }, [2, 19, 4]);
      assert.equal(out.ok, true, out.error);
      assert.ok(hp(clock()) < before, "the 19 kept by advantage hits");
      const cancel = await spend(clock(), "Restore Balance");
      assert.equal(cancel.ok, true, cancel.error);
      assert.equal(hp(clock()), before, `on its first die alone, a 2, the attack misses: ${show(cancel).slice(0, 160)}`);
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
    // The three rolls the text names, each with the trance and without: a
    // save and a check through request_roll, an attack through pc_attack. A
    // 10 or higher on the die is left as it fell, and a natural 1 on an
    // attack, counted as a 10, is no automatic miss.
    "trance-floor": async () => {
      const totals = async (enemy) => {
        const save = await roll(clock(), { kind: "saving_throw", ability: "dex", dc: 10 }, [3]);
        const check = await roll(clock(), { kind: "skill_check", skill: "arcana", dc: 10 }, [9]);
        const high = await roll(clock(), { kind: "skill_check", skill: "arcana", dc: 10 }, [14]);
        const swing = await kit.swing(clock().id, enemy.id, [1, 4]);
        assert.equal(swing.ok, true, swing.error);
        return { save: save.total, check: check.total, high: high.total, attack: swing.toHit.total, hit: swing.result.hit === true };
      };
      const [bare] = await stage(clock());
      const without = await totals(bare);
      const [enemy] = await tranced();
      const within = await totals(enemy);
      const toHit = without.attack - 1;
      assert.deepEqual(without, { save: 3 + MOD.dex, check: without.check, high: without.high, attack: 1 + toHit, hit: false }, "with no trance the dice count as they fall");
      assert.deepEqual(within, { save: 10 + MOD.dex, check: without.check + 1, high: without.high, attack: 10 + toHit, hit: 10 + toHit >= foe(enemy).stats.ac }, "in the trance: a Dexterity save on a 3, an Arcana check on a 9 and on a 14, an attack roll on a natural 1");
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
    // A Metamagic spend names no spell, so the boon meets it at the cast
    // (src/lib/dm/ar-ws-lunar-boons.ts): the option paid, then the spell.
    // Each case is [sorcery points, boons] the two calls cost together.
    "lunar-boons": async () => {
      const who = lunar();
      const state = () => [left(who, "sorcery_points"), left(who, "sub_lunar_boons")];
      const meta = (option, amount = 1) => spend(who, "Sorcery Points", { variant: option, amount });
      const cast = (spell) => call("use_spell_slot", { characterId: who.id, spell });
      const paid = async (steps, { boons = true } = {}) => {
        rig.refill(who);
        if (!boons) drain(who, "sub_lunar_boons");
        const before = state();
        for (const step of steps) {
          const out = await step();
          assert.equal(out.ok, true, out.error);
        }
        return [before[0] - state()[0], before[1] - state()[1]];
      };
      await phase("Crescent Moon");
      world.patch(who.id, { features: [...sheet(who).features.filter((feature) => !feature.name.startsWith("Metamagic: ")), ...["Extended Spell", "Twinned Spell"].map((name) => ({ name: `Metamagic: ${name}`, source: "class", description: "" }))] });
      // Crescent Moon: illusion and transmutation. Alter Self is transmutation,
      // Lesser Restoration abjuration (the Full Moon's).
      assert.deepEqual(await paid([() => cast("Alter Self")]), [0, 0], "a spell of the phase's schools with no Metamagic on it");
      assert.deepEqual(await paid([() => meta("Extended Spell"), () => cast("Alter Self")]), [0, 1], "Extended Spell (1 point) on Alter Self in the Crescent Moon phase");
      assert.deepEqual(await paid([() => meta("Twinned Spell", 2), () => cast("Alter Self")]), [1, 1], "Twinned Spell on a 2nd-level spell (2 points)");
      assert.deepEqual(await paid([() => meta("Extended Spell"), () => cast("Lesser Restoration")]), [1, 0], "on a spell of another phase's school");
      assert.ok(!sheet(who).conditions.includes("lunar boon"), "the Metamagic rode that spell: the mark is gone");
      assert.deepEqual(await paid([() => meta("Extended Spell"), () => cast("Lesser Restoration"), () => cast("Alter Self")]), [1, 0], "a later spell of the phase's schools takes nothing back");
      assert.deepEqual(await paid([() => meta("Extended Spell"), () => cast("Alter Self")], { boons: false }), [1, 0], "with no boon left");
      // The counter is spent by the cast, never by a call of its own.
      rig.refill(who);
      const bare = await spend(who, "Lunar Boons");
      assert.equal(bare.ok, false, "a bare spend of the counter");
      assert.equal(left(who, "sub_lunar_boons"), prof(20), "nothing spent");
      // The phase decides the schools.
      await phase("Full Moon");
      assert.deepEqual(await paid([() => meta("Extended Spell"), () => cast("Lesser Restoration")]), [0, 1], "abjuration in the Full Moon phase");
      assert.deepEqual(await paid([() => meta("Extended Spell"), () => cast("Alter Self")]), [1, 0], "transmutation in the Full Moon phase");
      // In a fight the spell may come first: a Metamagic option paid later that
      // turn costs 1 less there and then, once.
      await stage(who);
      const before = state();
      for (const step of [() => cast("Lesser Restoration"), () => meta("Extended Spell")]) {
        const out = await step();
        assert.equal(out.ok, true, out.error);
      }
      assert.deepEqual([before[0] - state()[0], before[1] - state()[1]], [0, 1], "the spell, then Extended Spell, on one turn");
      const again = await meta("Extended Spell");
      assert.equal(again.ok, true, again.error);
      assert.deepEqual([before[0] - state()[0], before[1] - state()[1]], [1, 1], "a second option that turn pays its price until its own spell is cast");
      rig.refill(who);
    },
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
      // "you release your phase's power": the phase is Lunar Embodiment's.
      await phase("Crescent Moon");
      await stage(lunar());
      const other = await spend(lunar(), "Lunar Phenomenon", { variant: "full moon" });
      assert.equal(other.ok, false, "in the Crescent Moon phase, the Full Moon's power was released");
      // A bare spend is refused: the use names its phase's variant (WAVE1 R10,
      // a pool spent only through a named option). Crescent Moon asks no creature.
      const out = await spend(lunar(), "Lunar Phenomenon", { variant: "crescent moon" });
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      await uses(["sorcerer", "Lunar Sorcery"], "sub_lunar_phenomenon", { 18: 1 })();
      await phenomenonRest();
    },
    "phenomenon-points": async () => {
      await phase("Crescent Moon");
      await buysAnother(["sorcerer", "Lunar Sorcery"], "Lunar Phenomenon", "sub_lunar_phenomenon", "sorcery point")();
    },
  };
  const implosionRest = rests(["sorcerer", "Aberrant Mind"], "sub_warping_implosion", "long");
  const balanceRest = rests(["sorcerer", "Clockwork Soul"], "sub_restore_balance", "long");
  const tranceRest = rests(["sorcerer", "Clockwork Soul"], "sub_trance_of_order", "long");
  const cavalcadeRest = rests(["sorcerer", "Clockwork Soul"], "sub_clockwork_cavalcade", "long");
  const boonsRest = rests(["sorcerer", "Lunar Sorcery"], "sub_lunar_boons", "long");
  const phenomenonRest = rests(["sorcerer", "Lunar Sorcery"], "sub_lunar_phenomenon", "long");

  const KNOWN = {
    "bend-doors": { severity: "medium", kind: "rule-missing", where: `${DATA} sorcerer::Bend Luck (one reaction, attack_penalty 1d4: a subtraction from an attack that hit)`, note: "Of the six cases in the text (add or subtract, on an attack, a check or a save) one has a door. An ally's save that failed by one cannot be lifted; a foe's save that passed by one cannot be dropped.", fix: "Offer Bend Luck on the after-roll card for another creature's check or save, and as an addition to an ally's attack." },
    "bombardment-door": { severity: "low", kind: "rule-missing", where: `${DATA} sorcerer::Spell Bombardment (narrated: "the GM adds it with apply_damage")`, note: "The engine rolls the spell's dice and knows which is the highest.", fix: "Explode the highest die of the holder's spell damage once a turn." },
    "empowered-healing-door": { severity: "low", kind: "rule-missing", where: `${DATA} sorcerer::Empowered Healing (narrated: "the GM rolls them again and spends the point with use_resource")`, note: "", fix: "A reroll of the healing dice of the last heal for a sorcery point, once a turn." },
    "eyes-board": { severity: "medium", kind: "path-parity", where: "src/lib/battlemap/view.ts sheetDarkvisionTiles and src/lib/dm/place-light.ts (neither reads authoredDarkvisionFeet; src/lib/dm/attack-light.ts does)", note: "The sorcerer attacks in the dark without disadvantage, and the board still shows them nothing there: their own screen and the light a Perception check reads treat them as blind in darkness. Every authored darkvision row shares it (Umbral Sight).", fix: "Read authoredDarkvisionFeet in sheetDarkvisionTiles." },
    "tempest-trigger": { severity: "low", kind: "timing-window", where: `${DATA} sorcerer::Tempestuous Magic (a plain bonus-action spend; nothing asks for a spell cast this turn)`, note: "", fix: "Gate the spend on a spell of 1st level or higher cast this turn, or about to be." },
    "heart-burst": { severity: "medium", kind: "rule-missing", where: "src/lib/srd/feature-effects.ts Heart of the Storm (the resistance only; the second half of the sentence is its guidance)", note: "No written reason: the row is counted as typed because of the resistance.", fix: "On a lightning or thunder spell of 1st level or higher, deal half the sorcerer level to chosen creatures within 10 feet." },
    "fury-push": { severity: "low", kind: "rule-missing", where: `${DATA} sorcerer::Storm's Fury (save.onFail is a sentence: "is pushed up to 20 feet (move_token forced)")`, note: "The engine rolls the save and leaves the push to a second call.", fix: "Move the creature 20 feet straight away on the failed save." },
    "bastion-door": { severity: "medium", kind: "rule-missing", where: `${DATA} sorcerer::Bastion of Law (narrated: "the GM rolls the dice spent off the damage")`, note: "A ward of up to 5d8 that lasts until the next long rest, with nowhere to be written down.", fix: "A spend that lays the ward's dice on a creature and a reaction-free reduction when it is hit." },
  };
  return { PROBES, KNOWN };
}
