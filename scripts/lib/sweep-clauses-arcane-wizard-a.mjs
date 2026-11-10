// The clause probes of the wizard's schools of Abjuration, Conjuration,
// Divination, Enchantment, Illusion, Necromancy and Transmutation
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-wizard.mjs).
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";
import { hasPack } from "./enforce-world.mjs";

const DATA = "src/lib/srd/authored-effects-data*.ts";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, counter, budget, show, call, spend, react, hurt, roll, stage } = rig;
  const { friend, mage, drain, freeReactions, uses, rests, movesSomething, hasDoor } = shared;
  const DC = spellDc("wizard", 20);
  const conds = (enemy) => foe(enemy).conditions;
  const slotsUsed = (who) => Object.values(sheet(who).spellcasting.slots).map((slot) => slot.used).join("");
  const spendSlots = (who, used) => {
    const now = sheet(who);
    const slots = { ...now.spellcasting.slots };
    for (const [level, count] of Object.entries(used)) slots[level] = { ...slots[level], used: count };
    world.patch(who.id, { spellcasting: { ...now.spellcasting, slots } });
  };
  rig.outfit("wizard", "School of Abjuration", { spells: ["Mage Armor", "Counterspell", "Dispel Magic"] });
  rig.outfit("wizard", "School of Conjuration", { spells: ["Fog Cloud", "Misty Step", "Hold Person"] });
  rig.outfit("wizard", "School of Divination", { spells: ["Foresight", "Detect Thoughts", "Detect Magic"] });
  rig.outfit("wizard", "School of Enchantment", { spells: ["Hold Person", "Vicious Mockery"], cantrips: ["Vicious Mockery"] });
  rig.outfit("wizard", "School of Necromancy", { spells: ["Magic Missile", "Blight", "Ray of Sickness", "Fireball", "Animate Dead"] });
  rig.outfit("wizard", "School of Transmutation", { spells: ["Polymorph"] });
  const abj = () => holder("wizard", "School of Abjuration");
  const con = () => holder("wizard", "School of Conjuration");
  const div = () => holder("wizard", "School of Divination");
  const enc = () => holder("wizard", "School of Enchantment");
  const ill = () => holder("wizard", "School of Illusion");
  const nec = () => holder("wizard", "School of Necromancy");
  const tra = () => holder("wizard", "School of Transmutation");
  const mageArmor = (who) => call("cast_buff", { characterId: who.id, spell: "Mage Armor", targetCharacterIds: [who.id] });
  // The abjurer with the ward up, on their own turn.
  async function warded() {
    const foes = await stage(abj(), { others: [friend()] });
    const cast = await mageArmor(abj());
    assert.equal(cast.ok, true, cast.error);
    kit.freshTurn();
    return foes;
  }
  // A kill by the necromancer at 40 hit points: what came back.
  async function harvest(tool, args, faces) {
    const [enemy] = await stage(nec());
    kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 1 });
    world.patch(nec().id, { currentHp: 40 });
    const out = await call(tool, args(enemy), faces);
    if (!out.ok) throw new Error(`${tool} refused: ${out.error}`);
    assert.ok(foe(enemy).currentHp <= 0, "the creature was to die");
    return sheet(nec()).currentHp - 40;
  }
  const missile = (level) => harvest("cast_at_enemy", (enemy) => ({ characterId: nec().id, targetEnemyId: enemy.id, spell: "Magic Missile", ...(level ? { level } : {}) }), [4, 4, 4, 4, 4]);
  // The Hypnotic Gaze laid on the creature beside the enchanter (it fails).
  async function gazed(count = 1) {
    const foes = await stage(enc(), { count, others: [friend()] });
    const out = await spend(enc(), "Hypnotic Gaze", { targetEnemyId: foes[0].id }, [1]);
    assert.equal(out.ok, true, out.error);
    assert.ok(conds(foes[0]).includes("charmed"), "the gaze was to charm");
    return foes;
  }
  // The dummy has hit the enchanter, on the friend's turn.
  async function struck({ prepare = () => {} } = {}) {
    const foes = await stage(enc(), { count: 2, others: [friend()], first: friend() });
    kit.place(foes[1].id, 15, 12);
    prepare(foes);
    await rig.table.strike(foes[0], enc());
    return foes;
  }
  // Out of a fight and out of any beast form a probe before left them in.
  async function plain() {
    await kit.endFight();
    rig.refill(tra());
    world.patch(tra().id, { wildShape: null });
  }
  async function stone(option) {
    await plain();
    const out = await spend(tra(), "Transmuter's Stone", { variant: option });
    assert.equal(out.ok, true, out.error);
  }

  const PROBES = {
    // ---- Abjuration
    "ward-size": uses(["wizard", "School of Abjuration"], "sub_arcane_ward", { 2: 2 * 2 + MOD.int, 20: 2 * 20 + MOD.int }),
    "ward-raise": async () => {
      await stage(abj());
      drain(abj(), "sub_arcane_ward");
      world.patch(abj().id, { resources: { ...sheet(abj()).resources, sub_arcane_ward_raised: { max: 1, used: 0 } } });
      assert.equal((await mageArmor(abj())).ok, true);
      assert.equal(counter(abj(), "sub_arcane_ward").used, 0, "the first abjuration spell raises the ward whole");
      assert.equal(counter(abj(), "sub_arcane_ward_raised").used, 1);
    },
    "ward-absorbs": async () => {
      await warded();
      assert.equal(await hurt(abj(), 10, "fire"), 0, "hit points lost with the ward up");
      assert.equal(counter(abj(), "sub_arcane_ward").used, 10);
    },
    "ward-recharge": async () => {
      await warded();
      await hurt(abj(), 10, "fire");
      assert.equal((await mageArmor(abj())).ok, true);
      assert.equal(counter(abj(), "sub_arcane_ward").used, 8, "a 1st-level abjuration spell gives back 2");
    },
    "projected-ward": async () => {
      const [enemy] = await warded();
      kit.place(friend().id, 3, 5);
      kit.place(enemy.id, 3, 6);
      const before = hp(friend());
      await rig.table.strike(enemy, friend());
      assert.equal(hp(friend()), before - 6);
      const out = await react(abj(), "Projected Ward", { targetCharacterId: friend().id });
      assert.equal(out.ok, true, out.error);
      assert.equal(hp(friend()), before, "the ward takes the blow");
      assert.equal(counter(abj(), "sub_arcane_ward").used, 6);
    },
    "projected-ward-range": async () => {
      const [enemy] = await warded();
      kit.place(friend().id, 12, 5);
      kit.place(enemy.id, 13, 5);
      await rig.table.strike(enemy, friend());
      const out = await react(abj(), "Projected Ward", { targetCharacterId: friend().id });
      assert.equal(out.ok, false, "35 feet away");
      assert.match(out.error, /beyond 30 feet/);
    },
    "improved-abjuration": async () => {
      const [enemy] = await stage(abj(), { others: [friend()], first: friend() });
      mage(enemy);
      // Cone of Cold is 5th level, the wizard counters with a 3rd-level slot:
      // an Intelligence check against DC 15. A 9 on the die is 12 with INT,
      // 18 with the proficiency bonus the feature adds.
      const out = await react(abj(), "Counterspell", { targetEnemyId: enemy.id, spell: "Cone of Cold", level: 3 }, [9]);
      if (!out.ok) throw new Error(out.error);
      assert.equal(out.result.countered, true, `9 + ${MOD.int} INT + ${prof(20)} proficiency is 18 against DC 15, and the engine answers: ${out.result.check}`);
    },
    "spell-resistance-saves": async () => {
      await kit.endFight();
      assert.equal((await roll(abj(), { kind: "saving_throw", ability: "dex", dc: 10, magical: true })).d20s, 2);
      assert.equal((await roll(abj(), { kind: "saving_throw", ability: "dex", dc: 10 })).d20s, 1);
    },
    "spell-resistance-damage": async () => {
      const [enemy] = await stage(abj(), { others: [friend()], first: friend() });
      mage(enemy);
      drain(abj(), "sub_arcane_ward");
      const before = hp(abj());
      // Burning Hands, 3d6 of 4 each, the save failed on both dice.
      const out = await call("cast_at_player", { characterId: abj().id, casterEnemyId: enemy.id, spell: "Burning Hands" }, [1, 1, 4, 4, 4]);
      if (!out.ok) throw new Error(out.error);
      assert.equal(before - hp(abj()), 6, "12 fire from a spell, halved");
      assert.equal(await hurt(abj(), 12, "fire"), 12, "fire that is no spell's is whole");
    },
    // ---- Conjuration
    "benign-swap": async () => {
      await stage(con(), { others: [friend()] });
      const [mine, theirs] = [kit.token(con().id), kit.token(friend().id)];
      const out = await spend(con(), "Benign Transposition", { targetCharacterId: friend().id });
      if (!out.ok) throw new Error(out.error);
      assert.deepEqual([kit.token(con().id).x, kit.token(friend().id).x], [theirs.x, mine.x], `the two have not changed places: ${show(out).slice(0, 160)}`);
    },
    "benign-rest": rests(["wizard", "School of Conjuration"], "sub_benign_transposition", "long"),
    "benign-recharge-on-cast": async () => {
      await stage(con());
      drain(con(), "sub_benign_transposition");
      for (const [spell, level] of [["Misty Step", 2], ["Fog Cloud", 1]]) {
        const out = await call("use_spell_slot", { characterId: con().id, level, spell });
        if (!out.ok) throw new Error(out.error);
        kit.freshTurn();
      }
      assert.equal(counter(con(), "sub_benign_transposition").used, 0, "two conjuration spells cast, and the use is still spent");
    },
    "focused-conjuration": async () => {
      const [enemy] = await stage(con());
      assert.equal((await call("use_spell_slot", { characterId: con().id, level: 1, spell: "Fog Cloud", concentration: true })).ok, true);
      const fog = await call("apply_damage", { characterId: con().id, amount: 30, type: "fire" }, [1, 1]);
      assert.equal(sheet(con()).concentratingOn, "Fog Cloud", "a conjuration spell holds through 30 damage");
      assert.equal(fog.rolled.length, 0, "no save is rolled for it");
      rig.refill(con());
      kit.freshTurn();
      assert.equal((await call("cast_at_enemy", { characterId: con().id, targetEnemyId: enemy.id, spell: "Hold Person" }, [1])).ok, true);
      await call("apply_damage", { characterId: con().id, amount: 30, type: "fire" }, [1, 1]);
      assert.equal(sheet(con()).concentratingOn, null, "an enchantment spell is lost on a failed save");
    },
    // ---- Divination
    "portent-dice": async () => {
      const young = holder("wizard", "School of Divination", 2);
      const old = holder("wizard", "School of Divination", 14);
      await rig.rest("long");
      assert.equal(sheet(young).foretold?.length, 2, `a 2nd-level diviner's foretold numbers: ${JSON.stringify(sheet(young).foretold)}`);
      assert.equal(sheet(old).foretold?.length, 3);
      assert.deepEqual([counter(young, "sub_portent").max, counter(old, "sub_portent").max], [2, 3]);
    },
    "expert-divination-min": async () => {
      await kit.endFight();
      rig.refill(div());
      spendSlots(div(), { 1: 2 });
      // A 1st-level divination spell gives nothing back; a 2nd-level one does.
      assert.equal((await call("use_spell_slot", { characterId: div().id, level: 1, spell: "Detect Magic" })).ok, true);
      assert.equal(slotsUsed(div()), "300000000");
      assert.equal((await call("use_spell_slot", { characterId: div().id, level: 2, spell: "Detect Thoughts" })).ok, true);
      assert.equal(slotsUsed(div()), "210000000");
    },
    "expert-divination-lower": async () => {
      await kit.endFight();
      rig.refill(div());
      spendSlots(div(), { 2: 1, 3: 1 });
      assert.equal((await call("use_spell_slot", { characterId: div().id, level: 2, spell: "Detect Thoughts" })).ok, true);
      assert.equal(slotsUsed(div()), "021000000", "no slot below 2nd was spent, so none comes back");
    },
    "expert-divination-cap": async () => {
      await kit.endFight();
      rig.refill(div());
      spendSlots(div(), { 1: 1, 5: 1, 6: 1 });
      assert.equal((await call("use_spell_slot", { characterId: div().id, level: 9, spell: "Foresight" })).ok, true);
      assert.equal(slotsUsed(div()), "100001001", "the 5th-level slot comes back, the 6th does not");
    },
    "third-eye-cost": async () => {
      await stage(div());
      const out = await spend(div(), "The Third Eye", { variant: "darkvision" });
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().actionUsed, true);
      assert.equal(counter(div(), "sub_third_eye").used, 1);
      await PROBES_REST.thirdEye();
    },
    // ---- Enchantment
    "gaze-action": async () => {
      await gazed();
      assert.equal(budget().actionUsed, true);
      assert.equal(budget().bonusUsed, false);
    },
    "gaze-range": async () => {
      const [enemy] = await stage(enc());
      kit.place(enemy.id, 7, 5);
      const out = await spend(enc(), "Hypnotic Gaze", { targetEnemyId: enemy.id }, [1]);
      assert.equal(out.ok, false, "10 feet away");
      assert.match(out.error, /beyond 5 feet/);
      assert.equal(budget()?.actionUsed ?? false, false, "nothing spent");
    },
    "gaze-save": async () => {
      const [one, two] = await stage(enc(), { count: 2 });
      kit.place(two.id, 5, 6);
      // The dummy's Wisdom save is +0: the die is the total.
      const failed = await spend(enc(), "Hypnotic Gaze", { targetEnemyId: one.id }, [DC - 1]);
      assert.equal(failed.result.dc, DC, "8 + proficiency + Intelligence");
      assert.ok(conds(one).includes("charmed"), "one under the DC fails");
      kit.freshTurn();
      await spend(enc(), "Hypnotic Gaze", { targetEnemyId: two.id }, [DC]);
      assert.ok(!conds(two).includes("charmed"), "the DC itself saves");
    },
    "gaze-senses": async () => {
      const [enemy] = await stage(enc());
      kit.setEnemy(enemy.id, { conditions: ["blinded", "deafened"] });
      const out = await spend(enc(), "Hypnotic Gaze", { targetEnemyId: enemy.id }, [1]);
      assert.ok(!conds(enemy).includes("charmed"), `a creature that can neither see nor hear the wizard is charmed: ${show(out).slice(0, 140)}`);
    },
    "gaze-duration": async () => {
      const [enemy] = await gazed();
      rig.endCurrent();
      assert.ok(conds(enemy).includes("charmed"), "still charmed once the wizard's own turn ends");
      rig.cycleTo(enc());
      assert.ok(conds(enemy).includes("charmed"), "still charmed as the wizard's next turn begins");
      rig.endCurrent();
      assert.ok(!conds(enemy).includes("charmed"), "gone once that turn ends");
    },
    "gaze-incapacitated": async () => {
      const [enemy] = await gazed();
      assert.ok(conds(enemy).includes("incapacitated"), `the creature is ${conds(enemy).join(", ")}: charmed alone, free to act and move`);
    },
    "gaze-leash": async () => {
      const [enemy] = await gazed();
      const moved = await call("move_token", { token: enemy.id, x: 12, y: 5, forced: true });
      if (!moved.ok) throw new Error(moved.error);
      assert.ok(!conds(enemy).includes("charmed"), "30 feet from the wizard and still charmed");
    },
    "gaze-damage": async () => {
      const [enemy] = await gazed();
      assert.equal((await call("apply_damage", { enemyId: enemy.id, amount: 1, type: "fire" })).ok, true);
      assert.ok(!conds(enemy).includes("charmed"), "the creature took damage and is still charmed");
    },
    "gaze-once": async () => {
      const [enemy] = await gazed();
      kit.freshTurn();
      const again = await spend(enc(), "Hypnotic Gaze", { targetEnemyId: enemy.id }, [1]);
      assert.equal(again.ok, false, "a second gaze at the same creature before a long rest is taken");
    },
    "charm-redirect": async () => {
      await struck();
      const before = [hp(enc()), hp(friend())];
      const out = await react(enc(), "Instinctive Charm", {}, [1]);
      assert.equal(out.ok, true, out.error);
      assert.deepEqual([hp(enc()), hp(friend())], [before[0] + 6, before[1] - 6], "the blow leaves the wizard and lands on the creature nearest its attacker");
    },
    "charm-save": async () => {
      await struck();
      const before = hp(enc());
      const out = await react(enc(), "Instinctive Charm", {}, [DC]);
      assert.equal(out.ok, true, out.error);
      assert.equal(hp(enc()), before, "a save that meets the DC keeps the target");
      assert.match(out.result.applied, new RegExp(`WIS ${DC} vs DC ${DC}`));
    },
    "charm-once": async () => {
      const [enemy] = await struck();
      await react(enc(), "Instinctive Charm", {}, [20]);
      freeReactions();
      await rig.table.strike(enemy, enc());
      const again = await react(enc(), "Instinctive Charm", {}, [1]);
      assert.equal(again.ok, false);
      assert.match(again.error, /already resisted/);
    },
    "charm-range": async () => {
      await struck({ prepare: ([enemy]) => {
        kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, attacks: [{ name: "Longbow", toHit: 4, damage: "1d8", type: "piercing", ranged: true, range: "150/600 ft." }] } });
        kit.place(enemy.id, 13, 5);
      } });
      const out = await react(enc(), "Instinctive Charm", {}, [1]);
      assert.equal(out.ok, false, "40 feet away");
      assert.match(out.error, /beyond 30 feet/);
    },
    "charm-immune": async () => {
      await struck({ prepare: ([enemy]) => kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, conditionImmune: "charmed" } }) });
      const out = await react(enc(), "Instinctive Charm", {}, [1]);
      assert.equal(out.ok, false);
      assert.match(out.error, /cannot be charmed/);
    },
    "charm-sight": async () => {
      await struck();
      world.patch(enc().id, { conditions: ["blinded"] });
      const out = await react(enc(), "Instinctive Charm", {}, [1]);
      world.patch(enc().id, { conditions: [] });
      assert.equal(out.ok, false, `a blinded wizard sways an attacker they cannot see: ${show(out).slice(0, 140)}`);
    },
    "charm-before-hit": async () => {
      const [enemy] = await stage(enc(), { others: [friend()], first: friend() });
      // The attack misses (a 2 on the die): the wizard chose before knowing.
      await rig.table.strike(enemy, enc(), [2]);
      const out = await react(enc(), "Instinctive Charm", {}, [1]);
      assert.equal(out.ok, true, `against an attack roll that has not hit: ${String(out.error).slice(0, 160)}`);
    },
    "split-level": async () => {
      const [one, two] = await stage(enc(), { count: 2 });
      const out = await call("cast_at_enemy", { characterId: enc().id, targetEnemyId: one.id, secondTargetEnemyId: two.id, spell: "Vicious Mockery" }, [1, 1, 3, 3]);
      assert.equal(out.ok, false, "a cantrip takes no second creature");
    },
    "split-second": async () => {
      const [one, two] = await stage(enc(), { count: 2 });
      const out = await call("cast_at_enemy", { characterId: enc().id, targetEnemyId: one.id, secondTargetEnemyId: two.id, spell: "Hold Person" }, [1, 1]);
      assert.equal(out.ok, true, out.error);
      assert.deepEqual([conds(one).includes("paralyzed"), conds(two).includes("paralyzed")], [true, true]);
      assert.equal(sheet(enc()).spellcasting.slots[2].used, 1, "one slot for both");
    },
    "split-distance": async () => {
      const [one, two] = await stage(enc(), { count: 2 });
      kit.place(two.id, 14, 5);
      const out = await call("cast_at_enemy", { characterId: enc().id, targetEnemyId: one.id, secondTargetEnemyId: two.id, spell: "Hold Person" }, [1, 1]);
      assert.equal(out.ok, true, `a second creature 40 feet from the first, well inside Hold Person's 60: ${String(out.error).slice(0, 170)}`);
    },
    "alter-memories-door": hasDoor(["wizard", "School of Enchantment"], "Alter Memories", (foes) => ({ targetEnemyId: foes[0].id })),
    // ---- Illusion
    "illusion-cantrip": async () => {
      assert.ok(rig.features.subclassSpellsFor("wizard", "School of Illusion", 2).includes("Minor Illusion"));
    },
    "illusory-self": async () => {
      const [enemy] = await stage(ill(), { others: [friend()], first: friend() });
      const before = hp(ill());
      await rig.table.strike(enemy, ill());
      const out = await react(ill(), "Illusory Self");
      assert.equal(out.ok, true, out.error);
      assert.equal(hp(ill()), before, "the hit is a miss");
      assert.equal(counter(ill(), "sub_illusory_self").used, 1);
    },
    "illusory-self-rest": rests(["wizard", "School of Illusion"], "sub_illusory_self", "short"),
    // ---- Necromancy
    "harvest-necromancy": async () => {
      assert.equal(await missile(), 2, "an evocation spell of 1st level: twice its level");
      assert.equal(await harvest("cast_at_enemy", (enemy) => ({ characterId: nec().id, targetEnemyId: enemy.id, spell: "Blight" }), [1, 5, 5, 5, 5, 5, 5, 5, 5]), 12, "Blight, a 4th-level necromancy spell: three times its level");
    },
    "harvest-once": async () => {
      const [one, two] = await stage(nec(), { count: 2 });
      for (const enemy of [one, two]) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 1 });
      world.patch(nec().id, { currentHp: 40 });
      await call("cast_at_enemy", { characterId: nec().id, targetEnemyId: one.id, spell: "Magic Missile" }, [4, 4, 4]);
      assert.equal(sheet(nec()).currentHp, 42);
      kit.saveEncounter({ ...world.encounter(), turnBudget: { ...world.encounter().turnBudget, actionUsed: false } });
      const second = await call("cast_at_enemy", { characterId: nec().id, targetEnemyId: two.id, spell: "Magic Missile" }, [4, 4, 4]);
      assert.equal(second.ok, true, second.error);
      assert.equal(sheet(nec()).currentHp, 42, "the second kill of the turn restores nothing");
    },
    "harvest-upcast": async () => {
      assert.equal(await missile(3), 6, "Magic Missile cast with a 3rd-level slot is a 3rd-level spell");
    },
    "harvest-paths": async () => {
      const area = await harvest("aoe_damage", (enemy) => ({ casterCharacterId: nec().id, spell: "Fireball", enemyIds: [enemy.id] }), [1, 6, 6, 6, 6, 6, 6, 6, 6]);
      // With no content pack the spell's dice are not known: the call names
      // them (2d8 poison), as pc_attack asks.
      const attack = await harvest("pc_attack", (enemy) => ({ characterId: nec().id, targetEnemyId: enemy.id, spell: "Ray of Sickness", ...(hasPack ? {} : { damage: "2d8" }) }), [15, 5, 5]);
      assert.deepEqual({ "Fireball through aoe_damage": area, "Ray of Sickness through pc_attack": attack }, { "Fireball through aoe_damage": 6, "Ray of Sickness through pc_attack": 3 }, "hit points back from a kill");
    },
    "thralls-learn": async () => {
      assert.ok(rig.features.subclassSpellsFor("wizard", "School of Necromancy", 6).includes("Animate Dead"), "the spells the subclass teaches at 6th level hold no Animate Dead");
    },
    "thralls-extra": async () => {
      await kit.endFight();
      rig.refill(nec());
      const out = await call("cast_buff", { characterId: nec().id, spell: "Animate Dead", variant: "Skeleton" });
      if (!out.ok) throw new Error(out.error);
      PROBES_SEEN.thralls = out.result.summoned;
      assert.equal(out.result.summoned.length, 2, "skeletons raised by one casting at 3rd level");
    },
    "thralls-sturdier": async () => {
      if (!PROBES_SEEN.thralls) await PROBES["thralls-extra"]().catch(() => {});
      const [skeleton] = PROBES_SEEN.thralls;
      assert.equal(skeleton.hp, `${13 + 20}/${13 + 20}`, "a skeleton's 13 hit points plus the wizard's level");
    },
    "inured-necrotic": async () => {
      await kit.endFight();
      const old = holder("wizard", "School of Necromancy", 10);
      assert.equal(await hurt(old, 10, "necrotic"), 5);
      assert.equal(await hurt(old, 10, "fire"), 10);
    },
    "inured-maximum": async () => {
      await kit.endFight();
      const old = holder("wizard", "School of Necromancy", 10);
      const before = sheet(old).maxHp;
      await call("set_effect", { characterId: old.id, name: "life drain", field: "maxHp", mode: "add", value: -10, duration: "manual" });
      assert.equal(sheet(old).maxHp, before, "a drain of 10 lowers the hit point maximum");
    },
    "command-undead-action": async () => {
      const [enemy] = await stage(nec());
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, type: "undead" } });
      const out = await spend(nec(), "Command Undead", { targetEnemyId: enemy.id }, [1, 1]);
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().actionUsed, true);
    },
    "command-undead-advantage": async () => {
      const [enemy] = await stage(nec());
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, type: "undead", abilities: { ...foe(enemy).stats.abilities, int: 10 } } });
      const bright = await spend(nec(), "Command Undead", { targetEnemyId: enemy.id }, [1, 1]);
      assert.equal(bright.rolled.filter((die) => die.sides === 20).length, 2, "Intelligence 10 saves with advantage");
      const [dull] = await stage(nec());
      kit.setEnemy(dull.id, { stats: { ...foe(dull).stats, type: "undead", abilities: { ...foe(dull).stats.abilities, int: 6 } } });
      const plain = await spend(nec(), "Command Undead", { targetEnemyId: dull.id }, [1, 1]);
      assert.equal(plain.rolled.filter((die) => die.sides === 20).length, 1, "Intelligence 6 does not");
    },
    // ---- Transmutation
    "stone-darkvision": async () => {
      await stone("Darkvision");
      assert.equal(rig.darkvisionFeet(tra()), 60);
    },
    "stone-speed": async () => {
      await stone("Speed");
      assert.equal(rig.srd.speedFor(sheet(tra())), 40);
    },
    "stone-constitution": async () => {
      await stone("Constitution");
      const rolled = await roll(tra(), { kind: "saving_throw", ability: "con", dc: 10 }, [10]);
      assert.equal(rolled.out.result.total, 10 + MOD.con + prof(20));
    },
    "stone-resistance": async () => {
      await stone("Fire");
      assert.equal(await hurt(tra(), 10, "fire"), 5);
      await stone("Speed");
      assert.equal(await hurt(tra(), 10, "fire"), 10, "the stone's old gift goes when another is chosen");
    },
    "stone-change": async () => {
      await stage(tra());
      assert.equal((await call("cast_buff", { characterId: tra().id, spell: "Polymorph", targetCharacterIds: [tra().id], variant: "wolf" })).ok, true);
      const out = await spend(tra(), "Transmuter's Stone", { variant: "Fire" });
      world.patch(tra().id, { wildShape: null });
      assert.equal(out.ok, true, `having just cast a transmutation spell of 4th level: ${String(out.error).slice(0, 140)}`);
    },
    "shapechanger-book": async () => {
      assert.ok(rig.features.subclassSpellsFor("wizard", "School of Transmutation", 10).includes("Polymorph"), "the spells the subclass adds at 10th level hold no Polymorph");
    },
    "shapechanger-free": async () => {
      await plain();
      const out = await call("cast_buff", { characterId: tra().id, spell: "Polymorph", targetCharacterIds: [tra().id], variant: "wolf" });
      if (!out.ok) throw new Error(out.error);
      assert.deepEqual([sheet(tra()).spellcasting.slots[4].used, counter(tra(), "sub_shapechanger").used], [0, 1], "[4th-level slots spent, Shapechanger uses spent] after polymorphing into a wolf");
    },
    "shapechanger-slot": async () => {
      await plain();
      const out = await call("cast_buff", { characterId: tra().id, spell: "Polymorph", targetCharacterIds: [tra().id], variant: "wolf" });
      assert.equal(out.ok, true, out.error);
      assert.equal(out.result.applied, "polymorphed");
      await plain();
    },
    "shapechanger-rest": rests(["wizard", "School of Transmutation"], "sub_shapechanger", "short"),
  };
  const PROBES_SEEN = {};
  const thirdEyeRest = rests(["wizard", "School of Divination"], "sub_third_eye", "short");
  const PROBES_REST = { thirdEye: thirdEyeRest };

  const KNOWN = {
    "improved-abjuration": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/reaction-tools.ts Counterspell's ability check (and the Dispel Magic check), which never reads Improved Abjuration", note: `The row is narrated ("the GM adds it to that check"), but the engine rolls the check and settles countered itself, so the GM has nothing to add it to: an abjurer's Counterspell fails on a roll the feature turns into a success.`, fix: "Add the proficiency bonus to the Counterspell and Dispel Magic ability checks of a sheet holding Improved Abjuration, and drop the narrated reason." },
    "benign-swap": { severity: "medium", kind: "rule-missing", where: "src/lib/srd/authored-resources.json sub_benign_transposition (fx teleport, words only) read by src/lib/dm/resource-tools.ts", note: "With a willing creature named, the use and the action are spent and nobody moves; the result tells the GM to move a token.", fix: "Swap the two tokens when targetCharacterId is sent, and move the wizard up to 30 feet when a square is." },
    "benign-recharge-on-cast": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/cast-guard.ts (no refill of sub_benign_transposition on a conjuration spell of 1st level or higher)", note: "The counter's own guidance says it (\"Also recharges whenever the wizard casts a conjuration spell of 1st level or higher\") and nothing does it.", fix: "Refill sub_benign_transposition where a conjuration spell of 1st level or higher is cast by its holder." },
    "gaze-senses": { severity: "low", kind: "rule-wrong", where: `${DATA} wizard::Hypnotic Gaze (save_effect with no sense asked), read by src/lib/dm/authored-spend-effects.ts`, note: "The same family as the missing \"you can see\" (limits sweep, 831-you-can-see).", fix: "Refuse, with nothing spent, a creature that is both blinded and deafened." },
    "gaze-incapacitated": { severity: "high", kind: "rule-missing", where: `${DATA} wizard::Hypnotic Gaze (onFail is a sentence: "is also incapacitated with speed 0 ...")`, note: "The whole point of the gaze is that the creature loses its turn; charmed alone leaves it free to attack anyone but the wizard and to walk away.", fix: "Lay incapacitated (and speed 0) beside charmed, ending together." },
    "gaze-leash": { severity: "low", kind: "state-lifecycle", where: `${DATA} wizard::Hypnotic Gaze (no leashFeet), src/lib/dm/condition-leash.ts`, note: "Champion Challenge's row carries leashFeet for the same shape of ending.", fix: "Give the charm leashFeet 5." },
    "gaze-damage": { severity: "medium", kind: "state-lifecycle", where: `${DATA} wizard::Hypnotic Gaze (no endsOnDamage on a save_effect)`, note: "save_area rows have endsOnDamage; save_effect has no such field.", fix: "End the gaze's conditions when the creature takes damage." },
    "gaze-once": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/authored-spend-effects.ts save_effect (no memory of the creatures a gaze was used on)", note: "Instinctive Charm, the next feature of the same school, does remember the creature that resisted it.", fix: "Remember each creature gazed at until the wizard's long rest, and refuse it." },
    "charm-sight": { severity: "low", kind: "rule-wrong", where: `${DATA} wizard::Instinctive Charm (the reaction carries no sees: "attacker")`, note: "Warding Flare and Chronal Shift carry sees for the same words.", fix: "Add sees: \"attacker\" to the reaction." },
    "charm-before-hit": { severity: "low", kind: "timing-window", where: "src/lib/dm/reaction-tools.ts (a reaction answers a hit on record; an attack roll that missed leaves none)", note: "The engine's shape favours the wizard: they decide knowing the attack hit, and never spend the reaction on a miss.", fix: "A ruling: write that Instinctive Charm answers a hit, or offer it at the roll." },
    "split-distance": { severity: "medium", kind: "rule-wrong", where: "src/lib/dm/authored-reaper.ts authoredTwinSpell (the 5 feet between the two targets is Reaper's and Moon Fire's rule, applied to every twin_spell row)", note: "Split Enchantment's text sets no distance between the two creatures; each must only be in the spell's own range.", fix: "Let a twin_spell row say whether the second target must stand within 5 feet of the first; Split Enchantment's does not." },
    "alter-memories-door": { severity: "low", kind: "rule-missing", where: `${DATA} wizard::Alter Memories (narrated: "the GM rolls its save and narrates what it loses")`, note: "The save is an Intelligence save against the wizard's DC, and nothing rolls it or holds the hours.", fix: "A spend that rolls the creature's save, or a ruling that the save is the GM's." },
    "harvest-upcast": { severity: "medium", kind: "rule-wrong", where: "src/lib/dm/authored-hooks.ts authoredOnKill (reads the spell's own level, not the slot it was cast with)", note: "A spell cast with a higher slot is of that level (SRD 5.1, Casting a Spell at a Higher Level).", fix: "Pass the slot level to the harvest." },
    "harvest-paths": { severity: "medium", kind: "path-parity", where: "src/lib/dm/aoe-damage.ts and src/lib/dm/pc-attack*.ts (a spell's kill there never reaches authoredOnKill; only cast_at_enemy does)", note: "Fireball, the necromancer's commonest kill, and every attack-roll spell restore nothing.", fix: "Call the kill hook with the spell from aoe_damage and from pc_attack's spell attacks." },
    "thralls-learn": { severity: "low", kind: "data", where: "src/lib/srd/subclasses.json School of Necromancy (no spells table for level 6)", note: "School of Illusion's Minor Illusion is granted this way.", fix: "Add spells: { 6: [\"Animate Dead\"] }." },
    "thralls-extra": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/summon-cast.ts (Animate Dead raises one creature whoever casts it)", note: `The row is narrated ("the GM writes those onto their stat blocks"), yet the server makes the skeleton itself.`, fix: "Raise one more for a holder of Undead Thralls." },
    "thralls-sturdier": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/summon-cast.ts (authoredSummonHitPoints has no row for Undead Thralls)", note: "The stored text gives no number for the hit points (\"extra hit points\"); the feature it condenses gives the wizard's level. The proficiency bonus on the undead's weapon damage is unread as well.", fix: "A summon_hp row and a damage bonus for the necromancer's undead; state the number in the text." },
    "inured-maximum": { severity: "low", kind: "rule-missing", where: "src/lib/dm/effect-tools.ts set_effect field maxHp (and any creature ability that lowers a maximum)", note: "Reached by the GM's own hand here; the feature-effects row for Inured to Undeath holds the resistance only.", fix: "Refuse a lowering of the hit point maximum for a holder." },
    "stone-change": { severity: "low", kind: "rule-wrong", where: `${DATA} wizard::Transmuter's Stone (the choose spend is fight: "out" and asks for no spell)`, note: "Looser and stricter than the text at once: out of a fight the benefit changes at will, in one it cannot change even on a transmutation spell.", fix: "A ruling, or tie the change to a transmutation spell of 1st level or higher." },
    "shapechanger-book": { severity: "low", kind: "data", where: "src/lib/srd/subclasses.json School of Transmutation (no spells table for level 10)", note: "", fix: "Add spells: { 10: [\"Polymorph\"] }." },
  };
  return { PROBES, KNOWN };
}
