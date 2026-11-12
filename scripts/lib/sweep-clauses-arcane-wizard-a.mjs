// The clause probes of the wizard's schools of Abjuration, Conjuration,
// Divination, Enchantment, Illusion, Necromancy and Transmutation
// (scripts/clauses/arcane.json; run by test-enforce-sweep-clauses-arcane-wizard.mjs).
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";
import { hasPack } from "./enforce-world.mjs";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, counter, budget, show, call, spend, react, hurt, roll, stage } = rig;
  const { friend, mage, drain, freeReactions, uses, rests } = shared;
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
  rig.outfit("wizard", "School of Necromancy", { spells: ["Magic Missile", "Blight", "Ray of Sickness", "Fireball", "Animate Dead", "Cloudkill"] });
  rig.outfit("wizard", "School of Transmutation", { spells: ["Polymorph", "Jump", "Mage Armor"], cantrips: ["Message"] });
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
  // The benefit the transmuter's stone holds now, or null before it is made.
  const stoneOf = (who) => /^Transmuter's Stone \((.+)\)$/.exec(sheet(who).features.find((feature) => feature.name.startsWith("Transmuter's Stone"))?.name ?? "")?.[1]?.toLowerCase() ?? null;
  // The stone's first benefit is chosen freely out of a fight; a change needs
  // a transmutation spell of 1st level or higher just cast (Jump).
  async function stone(option) {
    await plain();
    if (stoneOf(tra()) && stoneOf(tra()) !== option.toLowerCase()) {
      const cast = await call("use_spell_slot", { characterId: tra().id, spell: "Jump" });
      assert.equal(cast.ok, true, cast.error);
    }
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
      // One short of the DC with the bonus counted fails: a 5 is 14.
      const [other] = await stage(abj(), { others: [friend()], first: friend() });
      mage(other);
      const short = await react(abj(), "Counterspell", { targetEnemyId: other.id, spell: "Cone of Cold", level: 3 }, [15 - MOD.int - prof(20) - 1]);
      assert.equal(short.result?.countered, false, `one under DC 15 with the bonus counted: ${short.result?.check ?? short.error}`);
      // Dispel Magic's check is the same door: Greater Invisibility (4th
      // level) against a 3rd-level slot is DC 14, met by a 5 with +3 and +6.
      await kit.endFight();
      rig.refill(abj());
      world.patch(friend().id, { conditions: ["invisible"], conditionMeta: { invisible: { spell: "Greater Invisibility", rounds: 10 } } });
      const dispel = await call("cast_buff", { characterId: abj().id, spell: "Dispel Magic", targetCharacterIds: [friend().id] }, [14 - MOD.int - prof(20)]);
      world.patch(friend().id, { conditions: [], conditionMeta: {} });
      if (!dispel.ok) throw new Error(dispel.error);
      assert.match(JSON.stringify(dispel.result.dispelled), /ends: check 14 vs DC 14/, `Dispel Magic's check: ${JSON.stringify(dispel.result.dispelled)}`);
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
      assert.deepEqual([budget().actionUsed, counter(con(), "sub_benign_transposition").used], [true, 1], "[the action, the use] of the swap");
      // A willing creature past the feature's 30 feet: refused, nothing spent.
      await stage(con(), { others: [friend()] });
      kit.place(friend().id, 12, 5);
      const far = await spend(con(), "Benign Transposition", { targetCharacterId: friend().id });
      assert.equal(far.ok, false, "a swap with a creature 35 feet away");
      assert.match(far.error, /35 ft away/);
      assert.deepEqual([budget()?.actionUsed ?? false, counter(con(), "sub_benign_transposition").used, kit.token(con().id).x], [false, 0, 5], "[the action, the use, the wizard's square] after the refusal");
      // The plain jump: 30 feet through the board's teleport, and no farther.
      const jump = await spend(con(), "Benign Transposition");
      assert.equal(jump.ok, true, jump.error);
      const aim = (y) => call("move_token", { token: con().id, x: 5, y, teleport: true, spell: "Benign Transposition", casterCharacterId: con().id });
      assert.equal((await aim(12)).ok, false, "a jump of 35 feet");
      const landed = await aim(11);
      assert.equal(landed.ok, true, landed.error);
      assert.equal(kit.token(con().id).y, 11, "30 feet");
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
      // A spell of another school gives nothing back.
      drain(con(), "sub_benign_transposition");
      const other = await call("use_spell_slot", { characterId: con().id, level: 2, spell: "Hold Person" });
      assert.equal(other.ok, true, other.error);
      assert.equal(counter(con(), "sub_benign_transposition").used, 1, "Hold Person (enchantment) refilled it");
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
    // "later actions extend it": an action with variant "extend" renews the
    // gaze on the creature it holds, rolling no save.
    "gaze-extend": async () => {
      const [enemy] = await gazed();
      kit.freshTurn();
      const out = await spend(enc(), "Hypnotic Gaze", { targetEnemyId: enemy.id, variant: "extend" }, [20]);
      assert.equal(out.ok, true, out.error);
      assert.equal(out.rolled.filter((die) => die.sides === 20).length, 0, "the extension rolled a save");
      assert.equal(budget().actionUsed, true, "the extension is the wizard's action");
      assert.ok(conds(enemy).includes("charmed") && conds(enemy).includes("incapacitated"), `after the extension: ${conds(enemy).join(", ")}`);
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
    // The reaction answers the attack roll, whichever way it went: the server
    // resolves an attack in one step, so a miss on record is taken as a hit is
    // (src/lib/dm/ar-ws-charm-miss.ts).
    "charm-before-hit": async () => {
      const ac = sheet(friend()).ac;
      const [enemy] = await stage(enc(), { others: [friend()], first: friend() });
      // The attack misses (a 2 on the die is 6 against AC 12): the wizard chose before knowing.
      await rig.table.strike(enemy, enc(), [2]);
      world.patch(friend().id, { ac: 5 });
      const before = [hp(enc()), hp(friend())];
      // The attacker fails its save on a 1; its 6 hits AC 5, and its 1d6+2 is rolled now.
      const out = await react(enc(), "Instinctive Charm", {}, [1, 4]);
      world.patch(friend().id, { ac });
      assert.equal(out.ok, true, `against an attack roll that has not hit: ${String(out.error).slice(0, 160)}`);
      assert.deepEqual([hp(enc()), hp(friend())], [before[0], before[1] - 6], `[the wizard, the creature closest to the attacker] after the missed roll turned onto AC 5: ${show(out).slice(0, 200)}`);
      assert.equal(rig.reacted(enc()), true, "the reaction is spent on a miss as on a hit");
      // Turned onto a creature the roll misses too, nothing lands.
      const [other] = await stage(enc(), { others: [friend()], first: friend() });
      await rig.table.strike(other, enc(), [2]);
      const held = hp(friend());
      const turned = await react(enc(), "Instinctive Charm", {}, [1, 4]);
      assert.equal(turned.ok, true, turned.error);
      assert.equal(hp(friend()), held, "a 6 against the friend's AC 12");
      assert.match(turned.result.applied, /misses them too \(6 against AC 12\)/);
      // With no attack roll on record at all, there is nothing to answer.
      await stage(enc(), { others: [friend()], first: friend() });
      const none = await react(enc(), "Instinctive Charm", {}, [1]);
      assert.equal(none.ok, false, "with no attack made on the wizard");
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
      assert.deepEqual([conds(one).includes("paralyzed"), conds(two).includes("paralyzed")], [true, true], "both are held");
      // Each is a target of the spell: a second creature past Hold Person's
      // own 60 feet is refused before the slot is spent on the first.
      const [near, far] = await stage(enc(), { count: 2 });
      kit.place(far.id, 18, 5);
      const beyond = await call("cast_at_enemy", { characterId: enc().id, targetEnemyId: near.id, secondTargetEnemyId: far.id, spell: "Hold Person" }, [1, 1]);
      assert.equal(beyond.ok, false, "a second creature 65 feet from the wizard");
      assert.deepEqual([sheet(enc()).spellcasting.slots[2].used, conds(near).includes("paralyzed")], [0, false], "[2nd-level slots spent, the first creature held] after the refusal");
    },
    // The charmed creature's Intelligence save against the spell save DC, and
    // the hours: the Charisma modifier plus one, or fewer when asked.
    "alter-memories-door": async () => {
      const stripped = (enemy) => conds(enemy).filter((name) => name.startsWith("memory stripped"));
      const [enemy] = await gazed();
      kit.freshTurn();
      // The dummy's Intelligence save is +0: one under the DC fails.
      const out = await spend(enc(), "Alter Memories", { targetEnemyId: enemy.id }, [DC - 1]);
      assert.equal(out.ok, true, out.error);
      assert.deepEqual([out.result.dc, out.result.saved, out.result.hours], [DC, false, MOD.cha + 1], "[the DC, saved, hours lost] on a save one under the DC");
      assert.equal(out.rolled.filter((die) => die.sides === 20).length, 1, "one save rolled");
      assert.deepEqual(stripped(enemy), [`memory stripped (${MOD.cha + 1} hours)`]);
      assert.equal(budget().actionUsed, true, "an action");
      kit.freshTurn();
      assert.equal((await spend(enc(), "Alter Memories", { targetEnemyId: enemy.id }, [1])).ok, false, "a second reach into the same creature's memory under one charm");
      // A save that meets the DC keeps the memory.
      const [other] = await gazed();
      kit.freshTurn();
      const kept = await spend(enc(), "Alter Memories", { targetEnemyId: other.id, amount: 2 }, [DC]);
      assert.equal(kept.ok, true, kept.error);
      assert.deepEqual([kept.result.saved, stripped(other)], [true, []], "[saved, the mark] on a save that meets the DC");
      // Fewer hours asked, and never more than the Charisma modifier plus one.
      const [third] = await gazed();
      kit.freshTurn();
      const many = await spend(enc(), "Alter Memories", { targetEnemyId: third.id, amount: MOD.cha + 2 }, [1]);
      assert.equal(many.ok, false, `${MOD.cha + 2} hours asked of a wizard whose Charisma modifier is +${MOD.cha}`);
      assert.equal(budget()?.actionUsed ?? false, false, "the refusal spent the action");
      const few = await spend(enc(), "Alter Memories", { targetEnemyId: third.id, amount: 2 }, [1]);
      assert.equal(few.ok, true, few.error);
      assert.deepEqual(stripped(third), ["memory stripped (2 hours)"]);
      // A creature that is not charmed is refused with nothing spent.
      const [plain] = await stage(enc());
      const none = await spend(enc(), "Alter Memories", { targetEnemyId: plain.id }, [1]);
      assert.equal(none.ok, false, "a creature that is not charmed");
      assert.match(none.error, /not charmed/);
      assert.equal(budget()?.actionUsed ?? false, false, "nothing spent");
    },
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
      // The slot counts on the other two paths a spell kills by as well.
      const area = await harvest("aoe_damage", (enemy) => ({ casterCharacterId: nec().id, spell: "Fireball", level: 5, enemyIds: [enemy.id] }), [1, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
      const attack = await harvest("pc_attack", (enemy) => ({ characterId: nec().id, targetEnemyId: enemy.id, spell: "Ray of Sickness", level: 2, ...(hasPack ? {} : { damage: "2d8" }) }), [15, 5, 5, 5]);
      assert.deepEqual([area, attack], [10, 6], "[Fireball from a 5th-level slot, Ray of Sickness (necromancy) from a 2nd-level slot]");
    },
    "harvest-paths": async () => {
      const area = await harvest("aoe_damage", (enemy) => ({ casterCharacterId: nec().id, spell: "Fireball", enemyIds: [enemy.id] }), [1, 6, 6, 6, 6, 6, 6, 6, 6]);
      // With no content pack the spell's dice are not known: the call names
      // them (2d8 poison), as pc_attack asks.
      const attack = await harvest("pc_attack", (enemy) => ({ characterId: nec().id, targetEnemyId: enemy.id, spell: "Ray of Sickness", ...(hasPack ? {} : { damage: "2d8" }) }), [15, 5, 5]);
      assert.deepEqual({ "Fireball through aoe_damage": area, "Ray of Sickness through pc_attack": attack }, { "Fireball through aoe_damage": 6, "Ray of Sickness through pc_attack": 3 }, "hit points back from a kill");
      // A running spell kills on a later turn: the creature starts its turn in
      // the necromancer's Cloudkill (5th level, conjuration) and fails its save.
      const [enemy] = await stage(nec());
      kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
      kit.place(enemy.id, 12, 5);
      const cloud = await call("aoe_damage", { casterCharacterId: nec().id, spell: "Cloudkill", enemyIds: [enemy.id], x: 15, y: 5 }, [1, 8, 8, 8, 8, 8]);
      assert.equal(cloud.ok, true, cloud.error);
      kit.setEnemy(enemy.id, { currentHp: 1 });
      world.patch(nec().id, { currentHp: 40 });
      // Every hero of the world is in the order: the round is ended to the
      // necromancer's next turn, the creature's turn falling inside it.
      world.dice(...Array(60).fill(1));
      rig.cycleTo(nec());
      world.clearDice();
      assert.ok(foe(enemy).currentHp <= 0, "the creature was to die as its turn started in the cloud");
      assert.equal(sheet(nec()).currentHp, 50, "a kill by the cloud on the creature's own turn: twice the 5th level");
    },
    "thralls-learn": async () => {
      assert.ok(rig.features.subclassSpellsFor("wizard", "School of Necromancy", 6).includes("Animate Dead"), "the spells the subclass teaches at 6th level hold no Animate Dead");
    },
    // One more per casting at every slot level, of either form, for the
    // holder alone; a casting past the budget is refused with the slot unspent.
    "thralls-extra": async () => {
      await kit.endFight();
      rig.refill(nec());
      const raise = (who, args) => call("cast_buff", { characterId: who.id, spell: "Animate Dead", ...args });
      const out = await raise(nec(), { variant: "Skeleton" });
      if (!out.ok) throw new Error(out.error);
      PROBES_SEEN.thralls = out.result.summoned;
      assert.equal(out.result.summoned.length, 2, "skeletons raised by one casting at 3rd level");
      const higher = await raise(nec(), { variant: "Zombie", level: 4 });
      assert.equal(higher.result?.summoned.length, 4, `zombies from a 4th-level slot (one, two more for the slot, and the extra): ${show(higher)}`);
      const used = slotsUsed(nec());
      const three = await raise(nec(), { mix: [{ variant: "Skeleton", count: 2 }, { variant: "Zombie", count: 1 }] });
      assert.equal(three.ok, false, "three from a 3rd-level slot is one past the extra corpse");
      assert.match(String(three.error), /Nothing was spent/);
      assert.equal(slotsUsed(nec()), used, "the refused casting spent a slot");
      const mixed = await raise(nec(), { mix: [{ variant: "Skeleton", count: 1 }, { variant: "Zombie", count: 1 }] });
      assert.deepEqual(mixed.result?.summoned.map((made) => made.name.replace(/ \d+$/, "")).sort(), ["Skeleton", "Zombie"], `the extra corpse may be of the other form: ${show(mixed)}`);
      // Another wizard's Animate Dead raises the spell's one.
      const other = holder("wizard", "School of Illusion", 20, { spells: ["Animate Dead"] }, "raiser");
      const plain = await raise(other, { variant: "Skeleton" });
      assert.equal(plain.result?.summoned.length, 1, `a wizard without the feature: ${show(plain)}`);
      PROBES_SEEN.plain = plain.result.summoned;
      const two = await raise(other, { variant: "Skeleton", count: 2 });
      assert.equal(two.ok, false, "a wizard without the feature raises no second corpse from a 3rd-level slot");
      // The table keeps the three the next probe reads; the rest go.
      const { removeSummon } = await import("../../src/lib/dm/summon-store.ts");
      for (const made of [...higher.result.summoned, ...mixed.result.summoned]) removeSummon(world.campaign(), world.sheet(made.characterId));
    },
    // The hit point maximum rises by the wizard's level and the weapon's
    // damage by the wizard's proficiency bonus (20th level: 20 and +6); another
    // wizard's skeleton has its stat block's 13 hit points and 1d6+2.
    "thralls-sturdier": async () => {
      if (!PROBES_SEEN.thralls) await PROBES["thralls-extra"]().catch(() => {});
      const [skeleton] = PROBES_SEEN.thralls;
      assert.equal(skeleton.hp, `${13 + 20}/${13 + 20}`, "a skeleton's 13 hit points plus the wizard's level");
      const [plain] = PROBES_SEEN.plain;
      assert.equal(plain.hp, "13/13", "another wizard's skeleton");
      // Each skeleton's shortsword on the dummy: a 4 on the d6.
      const swing = async (made) => {
        const [enemy] = await stage(nec());
        kit.place(made.characterId, 6, 4);
        kit.giveTurn(made.characterId);
        kit.freshTurn();
        const before = foe(enemy).currentHp;
        const out = await call("pc_attack", { characterId: made.characterId, targetEnemyId: enemy.id, weapon: "Shortsword" }, [15, 4]);
        assert.equal(out.ok, true, out.error);
        return before - foe(enemy).currentHp;
      };
      assert.deepEqual([await swing(skeleton), await swing(plain)], [4 + 2 + prof(20), 4 + 2], "[the necromancer's skeleton, another wizard's] shortsword damage on a 4");
      await kit.endFight();
      const { removeSummon } = await import("../../src/lib/dm/summon-store.ts");
      for (const made of [...PROBES_SEEN.thralls, ...PROBES_SEEN.plain]) removeSummon(world.campaign(), world.sheet(made.characterId));
    },
    "inured-necrotic": async () => {
      await kit.endFight();
      const old = holder("wizard", "School of Necromancy", 10);
      assert.equal(await hurt(old, 10, "necrotic"), 5);
      assert.equal(await hurt(old, 10, "fire"), 10);
    },
    // Every door that lowers a maximum: the GM's effect (refused, nothing
    // written), a drain laid as a condition, a creature's Life Drain on a
    // failed save, and exhaustion's halving. The friend beside them is lowered
    // by each, and a necromancer below 10th level too.
    "inured-maximum": async () => {
      await kit.endFight();
      const old = holder("wizard", "School of Necromancy", 10);
      const young = holder("wizard", "School of Necromancy", 9);
      const { effectiveMaxHp: condition } = await import("../../src/lib/dm/condition-logic.ts");
      const before = sheet(old).maxHp;
      const drain = (who) => call("set_effect", { characterId: who.id, name: "life drain", field: "maxHp", mode: "add", value: -10, duration: "manual" });
      const refused = await drain(old);
      assert.equal(sheet(old).maxHp, before, "a drain of 10 lowers the hit point maximum");
      assert.equal(refused.ok, false, "the effect is refused, not written with nothing behind it");
      assert.match(String(refused.error), /Inured to Undeath/);
      assert.match(String(refused.error), /Nothing was changed/);
      const youngBefore = sheet(young).maxHp;
      assert.equal((await drain(young)).ok, true, "a 9th-level necromancer is drained as anybody");
      assert.equal(sheet(young).maxHp, youngBefore - 10);
      assert.equal((await call("clear_effect", { characterId: young.id, name: "life drain" })).ok, true);
      assert.equal(sheet(young).maxHp, youngBefore, "the lifted effect gives the 10 back");
      // A drain laid by name.
      const laid = await call("set_condition", { characterId: old.id, condition: "max hp reduced (-7)" });
      assert.deepEqual([sheet(old).maxHp, sheet(old).conditions.some((name) => /max hp reduced/i.test(name))], [before, false], `[maximum, drain on the sheet] after set_condition: ${show(laid)}`);
      // A wight's Life Drain: 1d6+2 necrotic on a 4, the Constitution save failed.
      const [wight] = await stage(old, { others: [friend()] });
      kit.setEnemy(wight.id, { stats: { ...foe(wight).stats, attacks: [{ name: "Life Drain", toHit: 4, damage: "1d6+2", type: "necrotic", onHit: { save: "con", dc: 30, drainMaxHp: "all" } }] } });
      const [oldMax, friendMax] = [sheet(old).maxHp, sheet(friend()).maxHp];
      const hpBefore = sheet(old).currentHp;
      const onOld = await rig.table.strike(wight, old, [18, 4, 2]);
      assert.equal(sheet(old).maxHp, oldMax, `Life Drain on the necromancer: ${JSON.stringify(onOld.result).slice(0, 300)}`);
      assert.equal(hpBefore - sheet(old).currentHp, 3, "the 6 necrotic still lands, halved by the feature's resistance");
      assert.match(JSON.stringify(onOld.result), /cannot be reduced \(Inured to Undeath\)/);
      kit.place(friend().id, 6, 4);
      await rig.table.strike(wight, friend(), [18, 4, 2]);
      assert.equal(sheet(friend()).maxHp, friendMax - 6, "the same drain on the friend");
      await kit.endFight();
      world.patch(friend().id, { conditions: [], conditionMeta: {} });
      assert.equal(sheet(friend()).maxHp, friendMax, "the friend's maximum comes back with the drain's end");
      // Exhaustion level 4 halves a maximum.
      world.patch(old.id, { exhaustion: 4 });
      world.patch(friend().id, { exhaustion: 4 });
      assert.deepEqual([condition(sheet(old)), condition(sheet(friend()))], [before, Math.floor(friendMax / 2)], "[the necromancer's, the friend's] maximum at exhaustion 4");
      world.patch(old.id, { exhaustion: 0 });
      world.patch(friend().id, { exhaustion: 0 });
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
    // The first benefit is chosen freely out of a fight; a change needs a
    // transmutation spell of 1st level or higher just cast, in a fight or out,
    // and each casting opens one change. Refusals change and spend nothing.
    "stone-change": async () => {
      const fresh = holder("wizard", "School of Transmutation", 20, {}, "stone");
      const choose = (option) => spend(fresh, "Transmuter's Stone", { variant: option });
      const cast = async (tool, args) => {
        const out = await call(tool, { characterId: fresh.id, ...args });
        assert.equal(out.ok, true, `${args.spell}: ${out.error}`);
        return out;
      };
      const refused = async (option, why) => {
        const before = stoneOf(fresh);
        const out = await choose(option);
        assert.equal(out.ok, false, why);
        assert.equal(stoneOf(fresh), before, `${why}: the stone changed all the same`);
        return String(out.error);
      };
      // Making the stone.
      await stage(fresh);
      await refused("Fire", "the stone's first benefit, in a fight");
      await kit.endFight();
      rig.refill(fresh);
      assert.equal((await choose("Fire")).ok, true, "the stone's first benefit, out of a fight, with no spell cast");
      assert.equal(stoneOf(fresh), "fire");
      // Changing it.
      assert.match(await refused("Speed", "a change with no spell cast"), /transmutation spell of level 1 or higher.*Nothing was spent/);
      await cast("use_spell_slot", { spell: "Message" });
      await refused("Speed", "a change after a transmutation cantrip");
      await cast("cast_buff", { spell: "Mage Armor", targetCharacterIds: [fresh.id] });
      await refused("Speed", "a change after an abjuration spell");
      const jump = await cast("use_spell_slot", { spell: "Jump" });
      assert.match(String(jump.result.stoneChange), /may change its benefit now/);
      const changed = await choose("Speed");
      assert.equal(changed.ok, true, `having just cast a transmutation spell of 1st level: ${String(changed.error).slice(0, 140)}`);
      assert.deepEqual([stoneOf(fresh), await hurt(fresh, 10, "fire")], ["speed", 10], "[the stone's benefit, fire damage taken of 10] after the change");
      await refused("Constitution", "a second change on the one casting");
      // In a fight: no change without a casting, one with it, and the opening
      // ends with the caster's turn.
      await stage(fresh);
      await refused("Cold", "a change in a fight with no spell cast");
      await cast("use_spell_slot", { spell: "Jump" });
      const midFight = await choose("Cold");
      assert.equal(midFight.ok, true, `in a fight, having just cast a transmutation spell: ${String(midFight.error).slice(0, 140)}`);
      assert.equal(stoneOf(fresh), "cold");
      kit.freshTurn();
      await cast("use_spell_slot", { spell: "Jump" });
      rig.cycleTo(fresh);
      await refused("Acid", "a change a round after the casting");
      await kit.endFight();
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
    // The free use is held to its limits; outside them a slot pays, and with
    // no slot left the casting is refused with the use unspent.
    "shapechanger-limit": async () => {
      const spent = () => [sheet(tra()).spellcasting.slots[4].used, counter(tra(), "sub_shapechanger").used];
      await plain();
      const ally = await call("cast_buff", { characterId: tra().id, spell: "Polymorph", targetCharacterIds: [friend().id], variant: "wolf" });
      assert.equal(ally.ok, true, ally.error);
      assert.deepEqual(spent(), [1, 0], "[4th-level slots spent, Shapechanger uses spent] after polymorphing an ally into a wolf");
      world.patch(friend().id, { wildShape: null });
      await plain();
      const big = await call("cast_buff", { characterId: tra().id, spell: "Polymorph", targetCharacterIds: [tra().id], variant: "Giant Ape" });
      assert.equal(big.ok, true, big.error);
      assert.deepEqual(spent(), [1, 0], "[4th-level slots spent, Shapechanger uses spent] after becoming a giant ape (challenge rating 7)");
      await plain();
      const bear = await call("cast_buff", { characterId: tra().id, spell: "Polymorph", targetCharacterIds: [tra().id], variant: "Brown Bear" });
      assert.equal(bear.ok, true, bear.error);
      assert.deepEqual(spent(), [0, 1], "a brown bear (challenge rating 1) is inside the free use");
      await plain();
      spendSlots(tra(), Object.fromEntries([4, 5, 6, 7, 8, 9].map((level) => [level, sheet(tra()).spellcasting.slots[level].max])));
      const none = await call("cast_buff", { characterId: tra().id, spell: "Polymorph", targetCharacterIds: [friend().id], variant: "wolf" });
      assert.equal(none.ok, false, "with no slot of 4th level or higher, an ally's polymorph is refused, not paid by the free use");
      assert.equal(counter(tra(), "sub_shapechanger").used, 0, "the refused casting spent the free use");
      world.patch(friend().id, { wildShape: null });
      await plain();
    },
  };
  const PROBES_SEEN = {};
  const thirdEyeRest = rests(["wizard", "School of Divination"], "sub_third_eye", "short");
  const PROBES_REST = { thirdEye: thirdEyeRest };

  const KNOWN = {
  };
  return { PROBES, KNOWN };
}
