// The clause probes of the sorcerer's authored origins: Wild Magic, Divine
// Soul, Shadow Magic, Storm Sorcery, Aberrant Mind, Clockwork Soul and Lunar
// Sorcery (scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-sorcerer.mjs).
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";
import { fateProbe } from "./fate-probe.mjs";

const DATA = "src/lib/srd/authored-effects-data*.ts";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, counter, left, budget, show, call, spend, react, hurt, roll, stage } = rig;
  const { friend, drain, uses, rests, buysAnother } = shared;
  rig.outfit("sorcerer", "Storm Sorcery", { spells: ["Shatter"] });
  rig.outfit("sorcerer", "Divine Soul", { spells: ["Cure Wounds"] });
  rig.outfit("sorcerer", "Wild Magic", { spells: ["Burning Hands"], cantrips: ["Poison Spray", "Fire Bolt"] });
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
    // The phase already held stands: choosing an option again changes nothing
    // and is refused with nothing spent (authored-spend-effects.ts, choose).
    assert.ok(out.ok || / already; choosing it again changes nothing/.test(out.error ?? ""), out.error);
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
    // "Apply the number rolled as a bonus or penalty (your choice) to the
    // creature's roll": a d4 added to a friend's save that failed by one, on
    // its card, and taken off a foe's save that passed, at the watch stop.
    "bend-doors": async () => {
      const who = wild();
      const used = () => sheet(who).resources.sorcery_points.used;
      const foes = await fateProbe(rig, { holder: who, friend: friend(), power: "bend_luck", paid: (what) => assert.equal(used(), 2, `2 sorcery points for ${what}`) });
      // The foe needs `need` on the die against the sorcerer's DC: rolled
      // exactly, the save passes, and a d4 of 1 off it makes it fail.
      const need = spellDc("sorcerer", 20) - foes.saveMod;
      const out = await foes.cast([need, 1, 1, 1, 1, 1]);
      assert.match(out.shift ?? "", /used Bend Luck: .* and it fails/, "a foe's save that passed by nothing is not bent");
      assert.ok(out.lost > 0, "the spell lands once the save is bent under the Difficulty Class");
      assert.equal(used(), 2, "2 sorcery points for the foe's save");
      // A save out of a d4's reach is left alone, and nothing is spent.
      rig.refill(who);
      (await import("../../src/lib/db/encounters.ts")).saveEncounter({ ...world.encounter(), reactionsUsed: [] });
      kit.freshTurn();
      const far = await foes.cast([need - 6, 1, 1, 1, 1, 1]);
      assert.equal(far.shift, null);
      assert.equal(used(), 0, "a failed save costs nothing");
      rig.refill(who);
    },
    // Every door a spell's damage is rolled at (src/lib/dm/ar-ws-bombardment.ts):
    // a die showing its highest number is rolled again and added, once a turn.
    // Each case reads the dice the engine threw and what the creature lost.
    "bombardment-door": async () => {
      const who = wild();
      const thrown = (out, sides) => out.rolled.filter((die) => die.sides === sides).map((die) => die.face);
      const through = async (enemy, name, args, faces) => {
        const before = foe(enemy).currentHp;
        const out = await call(name, args, faces);
        assert.equal(out.ok, true, out.error);
        return { out, lost: before - foe(enemy).currentHp };
      };
      // cast_at_enemy: Poison Spray is 4d12 at 20th level, the save failed on a 1.
      let [enemy] = await stage(who);
      const spray = (caster, faces) => through(enemy, "cast_at_enemy", { characterId: caster.id, targetEnemyId: enemy.id, spell: "Poison Spray" }, faces);
      const first = await spray(who, [1, 12, 2, 3, 4, 5]);
      assert.deepEqual([thrown(first.out, 12), first.lost], [[12, 2, 3, 4, 5], 26], "a 12 on a d12 is rolled again and added");
      assert.match(String(first.out.result.spellBombardment), /Spell Bombardment/);
      // A second spell that turn: two dice at their highest, none rolled again.
      kit.freshTurn();
      const second = await spray(who, [1, 12, 12, 3, 4, 9]);
      assert.deepEqual([thrown(second.out, 12), second.lost, second.out.unused], [[12, 12, 3, 4], 31, 1], "once per turn");
      // No die at its highest number adds nothing, and leaves the turn's use.
      [enemy] = await stage(who);
      const none = await spray(who, [1, 11, 2, 3, 4, 9]);
      assert.deepEqual([thrown(none.out, 12), none.lost, none.out.unused], [[11, 2, 3, 4], 20, 1], "no die at its highest number");
      kit.freshTurn();
      const late = await spray(who, [1, 2, 3, 12, 4, 6]);
      assert.deepEqual([thrown(late.out, 12), late.lost], [[2, 3, 12, 4, 6], 27], "the use was still there for the next spell of the turn");
      // Below 18th level there is no such feature.
      const young = S("Wild Magic", 17);
      [enemy] = await stage(young);
      const plain = await spray(young, [1, 12, 2, 3, 4, 5]);
      assert.deepEqual([thrown(plain.out, 12), plain.lost], [[12, 2, 3, 4], 21], "a 17th-level wild sorcerer");
      // aoe_damage: Burning Hands, 3d6 rolled before the save.
      [enemy] = await stage(who);
      const hands = await through(enemy, "aoe_damage", { casterCharacterId: who.id, spell: "Burning Hands", enemyIds: [enemy.id] }, [6, 1, 1, 4, 1]);
      assert.deepEqual([thrown(hands.out, 6), hands.lost], [[6, 1, 1, 4], 12], "an area spell's die");
      // pc_attack: Fire Bolt, 4d10 on a hit, at a creature 20 feet off.
      [enemy] = await stage(who);
      kit.place(enemy.id, 9, 5);
      const bolt = await through(enemy, "pc_attack", { characterId: who.id, targetEnemyId: enemy.id, spell: "Fire Bolt" }, [15, 10, 1, 1, 1, 7]);
      assert.deepEqual([thrown(bolt.out, 10), bolt.lost], [[10, 1, 1, 1, 7], 20], "a spell attack's die");
    },
    // ---- Divine Soul
    "favored-rest": rests(["sorcerer", "Divine Soul"], "sub_favored_by_the_gods", "short"),
    // The healing dice of a spell cast this turn, rolled again for 1 sorcery
    // point (src/lib/dm/ar-ws-empowered-healing.ts). Cure Wounds heals 1d8 a
    // slot level plus the Charisma modifier.
    "empowered-healing-door": async () => {
      const who = soul();
      const points = () => left(who, "sorcery_points");
      const cure = async (caster, target, faces, level) => {
        const out = await call("heal", { characterId: target.id, casterId: caster.id, spell: "Cure Wounds", ...(level ? { level } : {}) }, faces);
        assert.equal(out.ok, true, out.error);
      };
      const hurtFriend = (hpNow) => world.patch(friend().id, { currentHp: hpNow });
      // No healing roll on record: refused, the point kept, and no card dealt.
      await stage(who, { others: [friend()] });
      hurtFriend(10);
      const early = await spend(who, "Empowered Healing");
      assert.equal(early.ok, false, "with no healing rolled this turn");
      assert.equal(points(), 20, "nothing spent");
      assert.equal(rig.table.offered(who, "Empowered Healing").length, 0, "no card with no roll to answer");
      // 3d8 + 4 on a 2, a 7 and a 3: 16. The 2 and the 3 are rolled again (an 8 and a 1): 20.
      await cure(who, friend(), [2, 7, 3], 3);
      assert.equal(sheet(friend()).currentHp, 26);
      assert.deepEqual(rig.table.offered(who, "Empowered Healing").map((card) => card.disabled), [null], "one card, open, while the roll is on record");
      const again = await spend(who, "Empowered Healing", {}, [8, 1]);
      assert.equal(again.ok, true, again.error);
      assert.deepEqual([again.rolled.map((die) => [die.sides, die.face]), sheet(friend()).currentHp, points()], [[[8, 8], [8, 1]], 30, 19], "[dice rolled again, the friend's hit points, sorcery points]");
      // Once a turn: a second healing spell that turn is not rolled again.
      kit.freshTurn();
      await cure(who, friend(), [1], 1);
      const twice = await spend(who, "Empowered Healing", {}, [8]);
      assert.equal(twice.ok, false, "a second use that turn");
      assert.deepEqual([sheet(friend()).currentHp, points()], [35, 19], "nothing rolled, nothing spent");
      // The new roll stands when it is lower: 4 + 4 becomes 1 + 4.
      await stage(who, { others: [friend()] });
      hurtFriend(10);
      await cure(who, friend(), [4], 1);
      const lower = await spend(who, "Empowered Healing", {}, [1]);
      assert.equal(lower.ok, true, lower.error);
      assert.equal(sheet(friend()).currentHp, 15, "10 + 5: the reroll is kept");
      // A die above half is left alone unless the call says how many to roll again.
      await stage(who, { others: [friend()] });
      hurtFriend(10);
      await cure(who, friend(), [5], 1);
      const high = await spend(who, "Empowered Healing");
      assert.equal(high.ok, false, "a 5 on a d8, no number given");
      assert.equal(points(), 20, "nothing spent");
      const named = await spend(who, "Empowered Healing", { amount: 1 }, [8]);
      assert.equal(named.ok, true, named.error);
      assert.deepEqual([sheet(friend()).currentHp, points()], [22, 19], "10 + 8 + 4, for a point");
      // An ally's roll: within 5 feet of the sorcerer, on the ally's own turn; not from 20 feet.
      const ally = S("Divine Soul", 6);
      for (const [x, expected] of [[4, { ok: true, hp: 20, points: 19 }], [1, { ok: false, hp: 16, points: 20 }]]) {
        await stage(who, { others: [ally], first: ally });
        kit.place(ally.id, x, 5);
        world.patch(ally.id, { currentHp: 10 });
        await cure(ally, ally, [2], 1);
        const out = await spend(who, "Empowered Healing", {}, [6]);
        assert.deepEqual({ ok: out.ok, hp: sheet(ally).currentHp, points: points() }, expected, `an ally ${(5 - x) * 5} feet from the sorcerer rolled Cure Wounds: ${String(out.error ?? "").slice(0, 120)}`);
      }
      await kit.endFight();
      // Out of a fight no turn keeps the roll, and it was refused there: the
      // last healing roll is rolled again once (last-save.ts recordCalmTrigger).
      hurtFriend(10);
      const before = points();
      await cure(who, friend(), [2], 1);
      assert.equal(sheet(friend()).currentHp, 16);
      const calm = await spend(who, "Empowered Healing", {}, [8]);
      assert.equal(calm.ok, true, `out of a fight: ${String(calm.error ?? "").slice(0, 160)}`);
      assert.deepEqual([sheet(friend()).currentHp, points()], [22, before - 1], "10 + 8 + 4 out of a fight, for a point");
      const second = await spend(who, "Empowered Healing", {}, [8]);
      assert.equal(second.ok, false, "the same roll rolled again twice");
      assert.equal(points(), before - 1, "nothing spent");
    },
    // "Whenever you roll on the Wild Magic Surge table, you can roll twice
    // and use either number": both rolls wait on the sorcerer's pick, which
    // the GM's line held before (src/lib/dm/ar-ws-wild-surge.ts pickChaos).
    "controlled-chaos": async () => {
      const who = S("Wild Magic", 14);
      await stage(who);
      const tides = sheet(who).resources.sub_tides_of_chaos;
      world.patch(who.id, { conditions: ["surge chance"], conditionMeta: { "surge chance": { rounds: 1 } }, resources: { ...sheet(who).resources, sub_tides_of_chaos: { ...tides, used: tides.max } } });
      const body = (out) => out.result ?? out;
      const surge = await spend(who, "Wild Magic Surge", {}, [1, 2]);
      assert.equal(surge.ok, true, surge.error);
      assert.deepEqual((body(surge).choices ?? []).map((choice) => choice.roll), [1, 2], "two rolls on the table");
      assert.ok(sheet(who).conditions.includes("controlled chaos"), "the two rolls wait on the pick");
      const wrong = await spend(who, "Controlled Chaos", { variant: "5" });
      assert.equal(wrong.ok, false, "a number not rolled");
      const picked = await spend(who, "Controlled Chaos", { variant: "2" });
      assert.equal(picked.ok, true, picked.error);
      assert.equal(body(picked).surge?.roll, 2, "the second roll is the surge");
      assert.ok(!sheet(who).conditions.includes("controlled chaos"), "the pick is spent");
    },
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
      const [enemy] = await stage(S("Storm Sorcery", 6));
      // The flight follows a spell of 1st level or higher cast this turn
      // (tempest-trigger): Shatter first, with the action.
      const cast = await call("aoe_damage", { casterCharacterId: S("Storm Sorcery", 6).id, spell: "Shatter", enemyIds: [enemy.id] }, [20, 1, 1, 1]);
      assert.equal(cast.ok, true, cast.error);
      const out = await spend(S("Storm Sorcery", 6), "Tempestuous Magic");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.match(out.result.teleport, /up to 10 feet, flying, without provoking opportunity attacks/);
    },
    // In a fight the flight is open once the turn has seen a spell of 1st
    // level or higher cast (src/lib/dm/ar-ws-tempest-logic.ts has the ruling on
    // "before"): [the spend's answer, the bonus action spent].
    "tempest-trigger": async () => {
      const who = S("Storm Sorcery", 6);
      const casting = sheet(who).spellcasting;
      world.patch(who.id, { spellcasting: { ...casting, cantrips: [...new Set([...(casting.cantrips ?? []), "Poison Spray"])] } });
      const shatter = async (enemy) => {
        const cast = await call("aoe_damage", { casterCharacterId: who.id, spell: "Shatter", enemyIds: [enemy.id] }, [20, 1, 1, 1]);
        assert.equal(cast.ok, true, cast.error);
      };
      const flight = async (before) => {
        const [enemy] = await stage(who);
        await before(enemy);
        const out = await spend(who, "Tempestuous Magic");
        return { out, seen: [out.ok, budget()?.bonusUsed ?? false] };
      };
      const bare = await flight(async () => {});
      assert.deepEqual(bare.seen, [false, false], "on a turn with no spell cast");
      assert.match(bare.out.error, /spell of 1st level or higher.*Nothing was spent\.$/);
      const cantrip = await flight(async (enemy) => {
        const cast = await call("cast_at_enemy", { characterId: who.id, targetEnemyId: enemy.id, spell: "Poison Spray" }, [20, 1]);
        assert.equal(cast.ok, true, cast.error);
      });
      assert.deepEqual(cantrip.seen, [false, false], "after a cantrip, which is no spell of 1st level or higher");
      assert.deepEqual((await flight(shatter)).seen, [true, true], "after Shatter, a 2nd-level spell cast with the action");
      // The next turn has seen no casting of its own.
      kit.freshTurn();
      assert.equal((await spend(who, "Tempestuous Magic")).ok, false, "on the turn after the one Shatter was cast in");
      // Out of a fight no turn is kept, and the spend is open as it was.
      await kit.endFight();
      const idle = await spend(who, "Tempestuous Magic");
      assert.equal(idle.ok, true, `out of a fight: ${idle.error}`);
    },
    "heart-resist": async () => {
      await kit.endFight();
      const who = S("Storm Sorcery", 6);
      assert.deepEqual([await hurt(who, 10, "lightning"), await hurt(who, 10, "thunder"), await hurt(who, 10, "fire")], [5, 5, 10]);
    },
    // What each dummy lost, [5 feet, 10 feet, 15 feet, 35 feet] east of the
    // sorcerer, after one call; an ally stands 5 feet west. Every die is a 1
    // unless a case says otherwise, so a save fails and a spell's own damage
    // is its number of dice.
    "heart-burst": async () => {
      const six = S("Storm Sorcery", 6);
      const same = (lost, expected, label) => assert.deepEqual(lost, expected, `${label}: the dummies lost ${JSON.stringify(lost)}`);
      const learn = (who, spells, cantrips) => {
        const casting = sheet(who).spellcasting;
        world.patch(who.id, { spellcasting: { ...casting, prepared: [...new Set([...casting.prepared, ...spells])], known: [...new Set([...casting.known, ...spells])], cantrips: [...new Set([...(casting.cantrips ?? []), ...cantrips])] } });
      };
      learn(six, ["Witch Bolt", "Magic Missile"], ["Shocking Grasp"]);
      const cast = async (who, name, args, arrange = () => {}, faces = [1, 1, 1, 1, 1, 1]) => {
        const foes = await stage(who, { count: 4, others: [friend()] });
        kit.place(foes[3].id, 12, 5);
        arrange(foes);
        const ally = hp(friend());
        const out = await call(name, args(foes), faces);
        if (!out.ok) throw new Error(`${name}: ${out.error}`);
        assert.equal(hp(friend()), ally, "an ally within 10 feet is never chosen");
        return { lost: foes.map((enemy) => 300 - (foe(enemy)?.currentHp ?? 300)), said: String(out.result.castBurst ?? "") };
      };
      const shatterAt = (who, at) => (foes) => ({ casterCharacterId: who.id, spell: "Shatter", enemyIds: [foes[at].id] });
      // Shatter (thunder, 3d8) at the creature 35 feet off: half of 6 to each creature within 10 feet.
      const far = await cast(six, "aoe_damage", shatterAt(six, 3));
      same(far.lost, [3, 3, 0, 3], "a 6th-level storm sorcerer's Shatter at the far creature");
      assert.match(far.said, /^Heart of the Storm: .*3 thunder damage/);
      // The spell's own target, beside the sorcerer, takes the spell and the burst both.
      same((await cast(six, "aoe_damage", shatterAt(six, 0))).lost, [3 + 3, 3, 0, 0], "Shatter at the creature 5 feet off");
      // The same door from pc_attack: Witch Bolt (lightning, 1d12) at the creature 15 feet off.
      same((await cast(six, "pc_attack", (foes) => ({ characterId: six.id, targetEnemyId: foes[2].id, spell: "Witch Bolt" }), undefined, [15, 15, 1])).lost, [3, 3, 1, 0], "Witch Bolt, a ranged spell attack (at disadvantage beside a foe: 15 and 15)");
      // And from cast_at_enemy, a creature of the area per call.
      same((await cast(six, "cast_at_enemy", (foes) => ({ characterId: six.id, targetEnemyId: foes[3].id, spell: "Shatter" }))).lost, [3, 3, 0, 3], "Shatter through cast_at_enemy");
      // Each tool's own target beside the sorcerer keeps both: the burst lands
      // once the spell's damage has (src/lib/dm/ar-ws-after-call.ts).
      same((await cast(six, "cast_at_enemy", (foes) => ({ characterId: six.id, targetEnemyId: foes[0].id, spell: "Shatter" }))).lost, [3 + 3, 3, 0, 0], "Shatter through cast_at_enemy at the creature 5 feet off");
      same((await cast(six, "pc_attack", (foes) => ({ characterId: six.id, targetEnemyId: foes[0].id, spell: "Witch Bolt" }), undefined, [15, 15, 1])).lost, [1 + 3, 3, 0, 0], "Witch Bolt at the creature 5 feet off");
      // Once per casting: a second creature of the same Shatter, named in a
      // second call, is no second casting.
      const twice = await stage(six, { count: 4, others: [friend()] });
      kit.place(twice[3].id, 12, 5);
      kit.place(twice[2].id, 13, 5);
      for (const at of [3, 2]) {
        const out = await call("cast_at_enemy", { characterId: six.id, targetEnemyId: twice[at].id, spell: "Shatter" }, [1, 1, 1, 1]);
        if (!out.ok) throw new Error(`Shatter's creature ${at}: ${out.error}`);
      }
      same(twice.map((enemy) => 300 - foe(enemy).currentHp), [3, 3, 3, 3], "one Shatter resolved a creature per call, two calls");
      // A cantrip of the type is no spell of 1st level or higher, and a spell of another type sets nothing off.
      same((await cast(six, "pc_attack", (foes) => ({ characterId: six.id, targetEnemyId: foes[0].id, spell: "Shocking Grasp" }), undefined, [15, 1, 1])).lost, [2, 0, 0, 0], "Shocking Grasp, a lightning cantrip (2d8 at 6th level)");
      same((await cast(six, "cast_at_enemy", (foes) => ({ characterId: six.id, targetEnemyId: foes[3].id, spell: "Magic Missile" }))).lost, [0, 0, 0, 6], "Magic Missile, three darts of force");
      // "that you can see": an invisible creature beside the sorcerer is not struck.
      same((await cast(six, "aoe_damage", shatterAt(six, 3), (foes) => kit.setEnemy(foes[0].id, { conditions: ["invisible"] }))).lost, [0, 3, 0, 3], "with the nearest creature invisible");
      // Half the sorcerer level: 10 at 20th.
      same((await cast(storm(), "aoe_damage", shatterAt(storm(), 3))).lost, [10, 10, 0, 3], "a 20th-level storm sorcerer's Shatter");
    },
    "fury-push": async () => {
      const dc = 8 + prof(20) + MOD.cha;
      // The dummy (Strength save +1) has hit the sorcerer from the east and
      // rolls `face`; `arrange` moves the pieces before the reaction.
      const pushed = async (face, arrange = () => {}) => {
        const [enemy] = await hit(storm());
        arrange(enemy);
        const from = kit.token(enemy.id);
        const out = await react(storm(), "Storm's Fury", {}, [face]);
        assert.equal(out.ok, true, out.error);
        const now = kit.token(enemy.id);
        return { moved: [now.x - from.x, now.y - from.y], save: out.result.save, lightning: 300 - foe(enemy).currentHp, reacted: rig.reacted(storm()), said: show(out).slice(0, 200) };
      };
      // A 1 fails: 20 feet, four squares straight away from the sorcerer.
      const failed = await pushed(1);
      assert.deepEqual([failed.moved, failed.save, failed.lightning, failed.reacted], [[4, 0], `2 vs DC ${dc}`, 20, true], `[squares moved, the Strength save, lightning taken, reaction spent] on a failed save: ${failed.said}`);
      // A 20 saves: the lightning lands all the same and the creature stands.
      const saved = await pushed(20);
      assert.deepEqual([saved.moved, saved.save, saved.lightning], [[0, 0], `21 vs DC ${dc}`, 20], "on a save made");
      // A wall two squares behind it: it stops against the wall after 5 feet.
      assert.deepEqual((await pushed(1, () => kit.openField([[8, 5, "#"]]))).moved, [1, 0], "with a wall 10 feet behind it");
      // Diagonally: straight away is the same diagonal.
      assert.deepEqual((await pushed(1, (enemy) => kit.place(enemy.id, 6, 6))).moved, [4, 4], "struck from the south-east");
      // The map's edge: one square of board behind it is all it goes.
      const edge = kit.map().width - 1;
      assert.deepEqual((await pushed(1, (enemy) => { kit.place(storm().id, edge - 2, 9); kit.place(enemy.id, edge - 1, 9); })).moved, [1, 0], "with the map's edge 5 feet behind it");
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
      // Once the roll is on record it is too late: a spend then is refused,
      // and the hit stands (the ruling on issue #908).
      const late = await spend(clock(), "Restore Balance");
      assert.equal(late.ok ?? false, false, `a spend after the roll: ${show(late).slice(0, 160)}`);
      assert.match(String(late.error), /before the roll/);
      assert.ok(hp(clock()) < before, "the hit stands");
      // Before the roll, as the watch stop sets it (foresight-before.ts, the
      // ruling on issue #908): the attack is thrown with one d20, and the use
      // and the reaction are paid only because it had advantage to cancel.
      const { runWithForetold } = await import("../../src/lib/dm/foresight.ts");
      const { getCampaignById } = await import("../../src/lib/db/campaigns.ts");
      const spent = () => sheet(clock()).resources.sub_restore_balance.used;
      const set = async (args) => {
        const [fresh] = await stage(clock(), { others: [friend()], first: friend() });
        rig.refill(clock());
        const tag = { roller: "enemy", kind: "attack", who: foe(fresh).displayName };
        const was = { hp: hp(clock()), used: spent() };
        const ran = await runWithForetold(getCampaignById(world.campaignId), "", { watcherId: clock().id, face: null, power: "restore_balance", tags: [tag], line: "" }, () => call("enemy_attack", { enemyId: fresh.id, targetCharacterId: clock().id, ...args }, [2, 19, 4]));
        assert.equal(ran.result.ok, true, ran.result.error);
        return { ...ran, lost: was.hp - hp(clock()), paid: spent() - was.used };
      };
      const edged = await set({ advantage: "advantage", advantageReason: "the sorcerer is flanked" });
      assert.equal(edged.lost, 0, "the 2 alone misses: the 19 was never thrown");
      assert.equal(edged.paid, 1, "paid for the advantage it cancelled");
      assert.match(edged.portent ?? "", /used Restore Balance/);
      const plain = await set({});
      assert.equal(plain.portent, null, "a roll with no edge pays nothing");
      assert.equal(plain.paid, 0);
    },
    "balance-uses": async () => {
      await uses(["sorcerer", "Clockwork Soul"], "sub_restore_balance", { 1: prof(1), 20: prof(20) })();
      await balanceRest();
    },
    // The ward and its dice (src/lib/dm/ar-ws-bastion.ts): laid for 1 to 5
    // sorcery points as an action on a creature within 30 feet, spent by the
    // warded creature off a blow on record for no reaction, gone at a long rest.
    "bastion-door": async () => {
      const who = clock();
      const points = () => left(who, "sorcery_points");
      const ward = (carrier) => sheet(carrier).conditions.filter((entry) => entry.startsWith("bastion of law"));
      const dice = (carrier, args, faces) => spend(carrier, "Bastion of Law", { variant: "reduce", ...args }, faces);
      const [enemy] = await stage(who, { others: [friend()] });
      kit.place(enemy.id, 4, 4);
      // Six points are more than it takes; 35 feet is farther than it reaches.
      assert.equal((await spend(who, "Bastion of Law", { targetCharacterId: friend().id, amount: 6 })).ok, false, "6 sorcery points");
      kit.place(friend().id, 12, 5);
      assert.equal((await spend(who, "Bastion of Law", { targetCharacterId: friend().id, amount: 3 })).ok, false, "a creature 35 feet away");
      assert.deepEqual([points(), budget()?.actionUsed ?? false, ward(friend())], [20, false, []], "nothing spent on a refusal");
      kit.place(friend().id, 4, 5);
      const laid = await spend(who, "Bastion of Law", { targetCharacterId: friend().id, amount: 3 });
      assert.equal(laid.ok, true, laid.error);
      assert.deepEqual([points(), budget().actionUsed, ward(friend())], [17, true, ["bastion of law (3d8)"]], "[sorcery points, the action, the friend's ward]");
      // With no blow on record the dice are kept.
      assert.equal((await dice(friend(), { amount: 2 }, [3, 1])).ok, false, "no damage to reduce");
      assert.deepEqual(ward(friend()), ["bastion of law (3d8)"]);
      assert.equal(rig.table.offered(friend(), "Bastion of Law").length, 0, "no card with no blow open");
      // The dummy's club lands for 6; two dice (a 3 and a 1) give 4 back.
      await rig.table.strike(enemy, friend(), [16, 4]);
      assert.equal(sheet(friend()).currentHp, 44);
      assert.deepEqual(rig.table.offered(friend(), "Bastion of Law").map((card) => [card.disabled, card.intent.variant]), [[null, "reduce"]], "the warded creature's card");
      const cut = await dice(friend(), { amount: 2 }, [3, 1]);
      assert.equal(cut.ok, true, cut.error);
      assert.deepEqual([sheet(friend()).currentHp, ward(friend()), rig.reacted(friend())], [48, ["bastion of law (1d8)"], false], "[hit points, the ward left, a reaction spent]");
      // One blow is answered once; a new blow takes no more dice than the ward holds.
      assert.equal((await dice(friend(), {}, [8])).ok, false, "the same blow again");
      await rig.table.strike(enemy, friend(), [16, 4]);
      assert.equal((await dice(friend(), { amount: 2 }, [8, 8])).ok, false, "two dice of a ward of one");
      assert.deepEqual([sheet(friend()).currentHp, ward(friend())], [42, ["bastion of law (1d8)"]], "nothing rolled, nothing spent");
      const last = await dice(friend(), {}, [8]);
      assert.equal(last.ok, true, last.error);
      assert.deepEqual([sheet(friend()).currentHp, ward(friend())], [48, []], "an 8 takes the whole 6 off, and the ward is spent");
      // Laid again, the earlier ward ends: on the sorcerer first, then on the friend.
      kit.freshTurn();
      assert.equal((await spend(who, "Bastion of Law", { amount: 1 })).ok, true);
      assert.deepEqual([ward(who), points()], [["bastion of law (1d8)"], 16]);
      kit.freshTurn();
      assert.equal((await spend(who, "Bastion of Law", { targetCharacterId: friend().id, amount: 2 })).ok, true);
      assert.deepEqual([ward(who), ward(friend()), points()], [[], ["bastion of law (2d8)"], 14], "one ward at a time");
      // "Reducing damage": harm from no attack (a hazard, a spell's save) is
      // damage the ward reduces too (src/lib/dm/last-hit.ts openEffect).
      const beforeHarm = sheet(friend()).currentHp;
      await call("apply_damage", { characterId: friend().id, amount: 5, type: "fire" });
      const offHarm = await dice(friend(), { amount: 1 }, [3]);
      assert.equal(offHarm.ok, true, offHarm.error);
      assert.deepEqual([sheet(friend()).currentHp, ward(friend())], [beforeHarm - 2, ["bastion of law (1d8)"]], "a die (a 3) off 5 fire damage from no attack");
      // "until your next long rest". The clock is put back after it, so the
      // probes that follow fight at the hour they would have.
      const clocks = await import("../../src/lib/db/clock.ts");
      const hour = clocks.getClock(world.campaignId);
      await rig.rest("long");
      clocks.setClock(world.campaignId, hour);
      assert.deepEqual(ward(friend()), [], "after a long rest");
    },
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
      world.patch(who.id, { features: [...sheet(who).features.filter((feature) => !feature.name.startsWith("Metamagic: ")), ...["Extended Spell", "Twinned Spell", "Empowered Spell"].map((name) => ({ name: `Metamagic: ${name}`, source: "class", description: "" }))] });
      // Crescent Moon: illusion and transmutation. Alter Self is transmutation,
      // Lesser Restoration abjuration (the Full Moon's).
      assert.deepEqual(await paid([() => cast("Alter Self")]), [0, 0], "a spell of the phase's schools with no Metamagic on it");
      assert.deepEqual(await paid([() => meta("Extended Spell"), () => cast("Alter Self")]), [0, 1], "Extended Spell (1 point) on Alter Self in the Crescent Moon phase");
      // Darkvision, a transmutation on one creature touched: Twinned Spell takes
      // no spell with a range of self (mt-srd-metamagic-logic.ts twinPlan gives
      // Alter Self's points back), so the 2 points are read on a spell it takes.
      const casting = sheet(who).spellcasting;
      world.patch(who.id, { spellcasting: { ...casting, known: [...new Set([...(casting.known ?? []), "Darkvision"])] } });
      assert.deepEqual(await paid([() => meta("Twinned Spell", 2), () => cast("Darkvision")]), [1, 1], "Twinned Spell on a 2nd-level spell (2 points)");
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
      // One option a spell, and Empowered Spell alone goes with another
      // (mt-srd-metamagic-logic.ts secondOptionProblem): the second option of
      // the turn is that one. A second Extended Spell was paid here before
      // the one-option rule was built.
      const again = await meta("Empowered Spell");
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
  };
  return { PROBES, KNOWN };
}
