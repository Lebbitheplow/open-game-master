// The clause probes of the bard's authored colleges: Valor, Glamour, Swords,
// Whispers, Eloquence, Creation and Spirits (scripts/clauses/arcane.json; run
// by test-enforce-sweep-clauses-arcane-bard.mjs).
import assert from "node:assert/strict";
import { MOD } from "./sweep-clauses-arcane.mjs";
import { call as routeCall } from "./enforce-campaign.mjs";

const DATA = "src/lib/srd/authored-effects-data*.ts";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, left, budget, show, call, spend, react, stage } = rig;
  const { friend, drain, uses, rests } = shared;
  rig.outfit("bard", "College of Valor", { spells: ["Vicious Mockery"], cantrips: ["Vicious Mockery"], equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  rig.outfit("bard", "College of Glamour", { spells: ["Command"] });
  rig.outfit("bard", "College of Swords", { equipment: [{ name: "Scimitar", qty: 1, equipped: true }] });
  rig.outfit("bard", "College of Whispers", { equipment: [{ name: "Rapier", qty: 1, equipped: true }] });
  rig.outfit("bard", "College of Eloquence", { spells: ["Vicious Mockery"], cantrips: ["Vicious Mockery"] });
  const B = (college, level = 20) => holder("bard", college, level);
  const valor = (level = 20) => B("College of Valor", level);
  const glamour = (level = 20) => B("College of Glamour", level);
  const swords = (level = 20) => B("College of Swords", level);
  const whispers = (level = 20) => B("College of Whispers", level);
  const eloquence = (level = 20) => B("College of Eloquence", level);
  const creation = () => B("College of Creation");
  const spirits = () => B("College of Spirits");
  const spellsAt = (college, level) => rig.features.subclassSpellsFor("bard", college, level);
  const grantOf = async (college, level, name) =>
    (await import("../../src/lib/srd/subclass-training.ts")).subclassGrants([{ id: "bard", level, subclass: college }]).find((entry) => entry.name === name);
  const d = (out, sides) => out.rolled.filter((die) => die.sides === sides).length;
  const has = (who, prefix) => sheet(who).conditions.some((name) => name.startsWith(prefix));
  async function inspire(bard, target = friend()) {
    const out = await spend(bard, "Bardic Inspiration", { targetCharacterId: target.id });
    assert.equal(out.ok, true, out.error);
    assert.ok(has(target, "bardic inspiration"), JSON.stringify(sheet(target).conditions));
  }
  // A weapon hit by the bard on their own fresh turn.
  async function struck(who, weapon) {
    const foes = await stage(who);
    const out = await kit.swing(who.id, foes[0].id, [15, 3], { weapon });
    assert.equal(out.ok, true, out.error);
    return foes;
  }
  // The rolls parked on a player's after-the-roll card, and the route that answers one.
  const openRolls = async () => (await import("../../src/lib/db/dm-turns.ts")).listOpenPendingRolls(world.campaignId);
  const afterRoll = () => world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
  async function attacks(who, weapon) {
    const [enemy] = await stage(who);
    const made = [];
    for (let swing = 0; swing < 3; swing += 1) made.push((await kit.swing(who.id, enemy.id, [15, 3], { weapon })).ok);
    return made;
  }

  const PROBES = {
    // ---- College of Valor
    "valor-training": async () => {
      const grant = await grantOf("College of Valor", 3, "Bonus Proficiencies (Valor)");
      assert.ok(grant?.spec, "no grant");
      assert.match(JSON.stringify(grant.spec.armor ?? ""), /medium/);
      assert.match(JSON.stringify(grant.spec.armor ?? ""), /shield/);
      assert.match(JSON.stringify(grant.spec), /martial/i);
    },
    "combat-damage": async () => {
      // The maintainer's ruling: the inspired creature spends the die it
      // holds on its own damage roll, on the card its hit waits on, and the
      // bard pays nothing more.
      let [enemy] = await stage(valor(), { others: [friend()] });
      world.patch(friend().id, { conditions: [], conditionMeta: {} });
      await inspire(valor());
      const pool = left(valor(), "bardic_inspiration");
      const hit = async (answer) => {
        // Beside the foe, so the friend's own weapon reaches it.
        kit.place(friend().id, 6, 4);
        kit.giveTurn(friend().id);
        kit.freshTurn();
        world.clearDice();
        world.dice(15);
        const swing = await world.invoke("pc_attack", { characterId: friend().id, targetEnemyId: enemy.id });
        world.clearDice();
        assert.equal(swing.ok, true, swing.error);
        const [pending] = (await openRolls()).filter((entry) => entry.thrown);
        if (!pending) return { waited: false, offered: [], dealt: null };
        const offered = pending.thrown.options.map((option) => option.id);
        const before = foe(enemy).currentHp;
        world.signIn({ id: sheet(friend()).userId });
        // Every damage die a 4, so the inspiration die adds exactly 4.
        world.dice(4, 4, 4, 4);
        await routeCall(await afterRoll(), "POST", answer, { campaignId: world.campaignId, pendingRollId: pending.id });
        world.clearDice();
        return { waited: true, offered, dealt: before - foe(enemy).currentHp };
      };
      const plain = await hit({ keep: true });
      assert.deepEqual([plain.waited, plain.offered], [true, ["combat_inspiration"]], "the hit of a creature holding a Valor bard's die waits on Combat Inspiration");
      assert.ok(has(friend(), "bardic inspiration"), "keeping the roll keeps the die");
      const inspired = await hit({ use: "combat_inspiration" });
      assert.equal(inspired.dealt - plain.dealt, 4, `the die (a 4) joins the hit's damage: ${plain.dealt} without it, ${inspired.dealt} with it`);
      assert.equal(has(friend(), "bardic inspiration"), false, "the die is spent");
      assert.equal(left(valor(), "bardic_inspiration"), pool, "the bard pays nothing more");
      // A die from a bard of another college rides no damage roll: the hit lands at once.
      [enemy] = await stage(eloquence(), { others: [friend()] });
      world.patch(friend().id, { conditions: [], conditionMeta: {} });
      await inspire(eloquence());
      const other = await hit({ keep: true });
      assert.equal(other.offered.includes("combat_inspiration"), false, "an Eloquence bard's die was offered on a hit's damage");
    },
    "combat-ac": async () => {
      const [enemy] = await stage(valor(), { others: [friend()] });
      await inspire(valor());
      kit.giveTurn(friend().id);
      kit.freshTurn();
      world.patch(friend().id, { ac: 12, acOverride: true });
      await rig.table.strike(enemy, friend(), [9, 4]);
      const before = hp(friend());
      const out = await react(friend(), "Combat Inspiration", {}, [3]);
      assert.equal(out.ok, true, out.error);
      assert.equal(hp(friend()), before + 6, "13 against AC 12 + 3 misses");
      assert.equal(has(friend(), "bardic inspiration"), false, "the die is spent");
    },
    "valor-extra-attack": async () => {
      assert.deepEqual(await attacks(valor(6), "Longsword"), [true, true, false]);
    },
    "battle-magic": async () => {
      const [enemy] = await stage(valor());
      const cast = await call("cast_at_enemy", { characterId: valor().id, targetEnemyId: enemy.id, spell: "Vicious Mockery" }, [1, 2, 2, 2, 2]);
      assert.equal(cast.ok, true, cast.error);
      const bonus = await call("pc_attack", { characterId: valor().id, targetEnemyId: enemy.id, weapon: "Longsword", feature: "Battle Magic" }, [15, 3]);
      assert.equal(bonus.ok, true, bonus.error);
      assert.equal(budget().bonusUsed, true);
      kit.freshTurn();
      const without = await call("pc_attack", { characterId: valor().id, targetEnemyId: enemy.id, weapon: "Longsword", feature: "Battle Magic" }, [15, 3]);
      assert.equal(without.ok, false, "no spell cast this turn");
    },
    // ---- College of Glamour
    mantle: async () => {
      await stage(glamour(), { others: [friend()] });
      const before = left(glamour(), "bardic_inspiration");
      const out = await spend(glamour(), "Mantle of Inspiration", { targetCharacterIds: [friend().id] });
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(before - left(glamour(), "bardic_inspiration"), 1);
    },
    "mantle-range": async () => {
      await stage(glamour(), { others: [friend()] });
      kit.place(friend().id, 5, 19);
      const out = await spend(glamour(), "Mantle of Inspiration", { targetCharacterIds: [friend().id] });
      assert.ok(!out.ok || sheet(friend()).tempHp === 0, `the friend ${rig.feetBetween(glamour(), friend())} feet away gained ${sheet(friend()).tempHp}`);
    },
    "mantle-ladder": async () => {
      for (const [level, temp] of [[3, 5], [5, 8], [10, 11], [15, 14]]) {
        await stage(glamour(level), { others: [friend()] });
        world.patch(friend().id, { tempHp: 0 });
        const out = await spend(glamour(level), "Mantle of Inspiration", { targetCharacterIds: [friend().id] });
        assert.equal(out.ok, true, out.error);
        assert.equal(sheet(friend()).tempHp, temp, `at level ${level}`);
      }
    },
    "enthralling-rest": rests(["bard", "College of Glamour"], "sub_enthralling_performance", "short"),
    "majesty-command": async () => {
      const [enemy] = await stage(glamour());
      const out = await spend(glamour(), "Mantle of Majesty");
      assert.equal(out.ok, true, out.error);
      const now = sheet(glamour());
      world.patch(glamour().id, { spellcasting: { ...now.spellcasting, slots: Object.fromEntries(Object.entries(now.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: slot.max }])) } });
      kit.giveTurn(glamour().id);
      kit.freshTurn();
      const cast = await call("cast_at_enemy", { characterId: glamour().id, targetEnemyId: enemy.id, spell: "Command" }, [1]);
      assert.equal(cast.ok, true, `Command with every slot spent, in the mantle: ${String(cast.error).slice(0, 160)}`);
      assert.equal(budget().bonusUsed, true, "a bonus action");
    },
    majesty: async () => {
      await stage(glamour());
      assert.equal((await spend(glamour(), "Mantle of Majesty")).ok, true);
      assert.equal(budget().bonusUsed, true);
      assert.equal(sheet(glamour()).conditionMeta["mantle of majesty"]?.rounds, 10);
    },
    "majesty-concentration": async () => {
      await stage(glamour());
      assert.equal((await spend(glamour(), "Mantle of Majesty")).ok, true);
      assert.match(String(sheet(glamour()).concentratingOn ?? ""), /mantle of majesty/i);
      // A failed concentration save (a 1) ends the mantle.
      await call("apply_damage", { characterId: glamour().id, amount: 10, type: "fire" }, [1]);
      assert.equal(has(glamour(), "mantle of majesty"), false, "the concentration broke and the mantle stands");
    },
    "majesty-rest": rests(["bard", "College of Glamour"], "sub_mantle_of_majesty", "long"),
    "unbreakable-cost": async () => {
      await stage(glamour());
      const out = await spend(glamour(), "Unbreakable Majesty");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(budget().actionUsed, false);
    },
    // ---- College of Swords
    "swords-training": async () => {
      const grant = await grantOf("College of Swords", 3, "Bonus Proficiencies (Swords)");
      assert.ok(grant?.spec, "no grant");
      assert.match(JSON.stringify(grant.spec.armor ?? ""), /medium/);
      assert.match(JSON.stringify(grant.spec), /scimitar/i);
    },
    "flourish-speed": async () => {
      // The speed the board and the move route both read (view.ts pcMoveBudget).
      const { pcMoveBudget } = await import("../../src/lib/battlemap/view.ts");
      const { getBattleMapForEncounter, getTokenByRef } = await import("../../src/lib/db/battle-maps.ts");
      const speed = () => {
        const encounter = world.encounter();
        const map = getBattleMapForEncounter(encounter.id);
        return pcMoveBudget(world.campaignId, encounter, map, sheet(swords()), getTokenByRef(map.id, swords().id)).speed;
      };
      await stage(swords());
      const walking = speed();
      await struck(swords(), "Scimitar");
      assert.equal(speed(), walking + 10, `10 feet more on a turn the bard took the Attack action (${walking} before)`);
    },
    "flourish-once": async () => {
      const [enemy] = await struck(swords(), "Scimitar");
      assert.equal((await spend(swords(), "Blade Flourish", { targetEnemyId: enemy.id, variant: "defensive" }, [3])).ok, true);
      assert.equal((await kit.swing(swords().id, enemy.id, [15, 3], { weapon: "Scimitar" })).ok, true, "the second attack");
      const again = await spend(swords(), "Blade Flourish", { targetEnemyId: enemy.id, variant: "defensive" }, [3]);
      assert.equal(again.ok, false, "a second flourish in one turn");
    },
    "flourish-defensive": async () => {
      const [enemy] = await struck(swords(), "Scimitar");
      const before = [foe(enemy).currentHp, left(swords(), "bardic_inspiration")];
      const out = await spend(swords(), "Blade Flourish", { targetEnemyId: enemy.id, variant: "defensive" }, [3]);
      assert.equal(out.ok, true, out.error);
      assert.deepEqual([before[0] - foe(enemy).currentHp, before[1] - left(swords(), "bardic_inspiration")], [3, 1], "the die (a 3) to the damage, one die spent");
      assert.ok(has(swords(), "defensive flourish (+3)"), JSON.stringify(sheet(swords()).conditions));
    },
    "swords-extra-attack": async () => {
      assert.deepEqual(await attacks(swords(6), "Scimitar"), [true, true, false]);
    },
    "masters-flourish": async () => {
      const [enemy] = await struck(swords(14), "Scimitar");
      drain(swords(14), "bardic_inspiration");
      const before = foe(enemy).currentHp;
      const out = await spend(swords(14), "Blade Flourish", { targetEnemyId: enemy.id, variant: "defensive" }, [3]);
      assert.equal(out.ok, true, `with no Bardic Inspiration left, a d6 pays for the flourish: ${String(out.error).slice(0, 160)}`);
      assert.equal(before - foe(enemy).currentHp, 3, "the d6 (a 3) to the damage");
      assert.match(JSON.stringify(out.result), /1d6/, "the die is a d6");
      assert.equal(left(swords(14), "bardic_inspiration"), 0, "nothing spent");
      // Below 14th level the empty pool refuses.
      const [other] = await struck(swords(13), "Scimitar");
      drain(swords(13), "bardic_inspiration");
      assert.equal((await spend(swords(13), "Blade Flourish", { targetEnemyId: other.id, variant: "defensive" }, [3])).ok, false, "a 13th-level bard has no Master's Flourish");
    },
    // ---- College of Whispers
    "blades-cost": async () => {
      const [enemy] = await struck(whispers(), "Rapier");
      const before = left(whispers(), "bardic_inspiration");
      const out = await spend(whispers(), "Psychic Blades", { targetEnemyId: enemy.id }, [1, 1, 1, 1, 1, 1, 1, 1]);
      assert.equal(out.ok, true, out.error);
      assert.equal(before - left(whispers(), "bardic_inspiration"), 1);
    },
    "blades-no-hit": async () => {
      const [enemy] = await stage(whispers());
      const out = await spend(whispers(), "Psychic Blades", { targetEnemyId: enemy.id }, [1, 1, 1, 1, 1, 1, 1, 1]);
      assert.equal(out.ok, false, "no weapon hit this turn");
    },
    "blades-dice": async () => {
      for (const [level, dice] of [[3, 2], [5, 3], [10, 5], [15, 8]]) {
        const [enemy] = await struck(whispers(level), "Rapier");
        const out = await spend(whispers(level), "Psychic Blades", { targetEnemyId: enemy.id }, Array(8).fill(1));
        assert.equal(out.ok, true, out.error);
        assert.equal(d(out, 6), dice, `d6s at level ${level}`);
      }
    },
    "terror-rest": rests(["bard", "College of Whispers"], "sub_words_of_terror", "short"),
    "whispers-rest": rests(["bard", "College of Whispers"], "sub_mantle_of_whispers", "short"),
    "lore-rest": rests(["bard", "College of Whispers"], "sub_shadow_lore", "long"),
    // ---- College of Eloquence
    unsettling: async () => {
      const [enemy] = await stage(eloquence());
      const before = left(eloquence(), "bardic_inspiration");
      const out = await spend(eloquence(), "Unsettling Words", { targetEnemyId: enemy.id });
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.equal(before - left(eloquence(), "bardic_inspiration"), 1);
      assert.ok(foe(enemy).conditions.some((name) => name.startsWith("unsettled")), JSON.stringify(foe(enemy).conditions));
    },
    "unsettling-save": async () => {
      const [enemy] = await stage(eloquence());
      assert.equal((await spend(eloquence(), "Unsettling Words", { targetEnemyId: enemy.id })).ok, true);
      // The dummy's Wisdom save: a 13 on the die, less the bard's die (a 4 at most of a d12... a forced 4).
      const out = await call("cast_at_enemy", { characterId: eloquence().id, targetEnemyId: enemy.id, spell: "Vicious Mockery" }, [13, 4, 2, 2, 2, 2]);
      assert.equal(out.ok, true, out.error);
      assert.match(JSON.stringify(out.result), /unsettled/i, show(out).slice(0, 240));
      assert.equal(foe(enemy).conditions.some((name) => name.startsWith("unsettled")), false, "the die is spent on that save");
    },
    unfailing: async () => {
      // A check the die cannot save (a 1 on it): an Eloquence bard's die stays, any other bard's is spent.
      const failing = async (bard) => {
        await stage(bard, { others: [friend()] });
        world.patch(friend().id, { conditions: [], conditionMeta: {} });
        await inspire(bard);
        world.clearDice();
        world.dice(10);
        await world.invoke("request_roll", { characterId: friend().id, kind: "skill_check", skill: "athletics", dc: 25, reason: "probe" });
        world.clearDice();
        const [pending] = (await openRolls()).filter((entry) => entry.thrown);
        assert.ok(pending, "the friend's check waits on the inspiration card");
        world.signIn({ id: sheet(friend()).userId });
        world.dice(1);
        await routeCall(await afterRoll(), "POST", { use: "bardic" }, { campaignId: world.campaignId, pendingRollId: pending.id });
        world.clearDice();
        return has(friend(), "bardic inspiration");
      };
      assert.equal(await failing(valor()), false, "a Valor bard's die that left the check failed was kept");
      assert.equal(await failing(eloquence()), true, "a die that left the check failed is kept");
      // The die that carries the roll is spent: a save the engine forces, DC 12, a 5 on the d20 and a 12 on the die.
      const { settleHeldDie } = await import("../../src/lib/dm/forced-save.ts");
      const { rollExpression } = await import("../../src/lib/dice.ts");
      world.clearDice();
      world.dice(5, 1);
      const short = settleHeldDie(world.campaignId, friend().id, rollExpression("1d20"), 15);
      assert.ok(short.total < 15 && has(friend(), "bardic inspiration"), `a forced roll the die left short (${short.total} against 15) spent it`);
      world.dice(5, 12);
      const made = settleHeldDie(world.campaignId, friend().id, rollExpression("1d20"), 15);
      world.clearDice();
      assert.ok(made.total >= 15 && !has(friend(), "bardic inspiration"), `the die that carried the roll (${made.total} against 15) is spent`);
    },
    "speech-rest": rests(["bard", "College of Eloquence"], "sub_universal_speech", "long"),
    "speech-slot": async () => {
      await stage(eloquence());
      drain(eloquence(), "sub_universal_speech");
      const out = await spend(eloquence(), "Universal Speech");
      assert.equal(out.ok, true, `with the use spent and every slot on the sheet: ${String(out.error).slice(0, 160)}`);
      assert.ok(Object.values(sheet(eloquence()).spellcasting.slots).some((slot) => slot.used > 0), "a slot paid");
    },
    // "A reaction copies a successful inspiration die onto another creature":
    // answered through the record of the roll the die made succeed
    // (last-save.ts recordInspiredSuccess), the die handed to a creature other
    // than the bard and the roller, and no Bardic Inspiration use spent.
    "infectious-die": async () => {
      const bard = eloquence();
      await stage(bard, { others: [friend(), valor()] });
      const nothing = await spend(bard, "Infectious Inspiration", { targetCharacterId: valor().id });
      assert.equal(nothing.ok, false, "spent with no inspired roll on record");
      assert.equal((await spend(bard, "Bardic Inspiration", { targetCharacterId: friend().id })).ok, true);
      const { settleHeldDie } = await import("../../src/lib/dm/forced-save.ts");
      const { rollExpression } = await import("../../src/lib/dice.ts");
      world.clearDice();
      world.dice(5, 12);
      const made = settleHeldDie(world.campaignId, friend().id, rollExpression("1d20"), 15);
      world.clearDice();
      assert.ok(made.total >= 15, `the staging: the die carried the roll (${made.total})`);
      const inspirationUsed = sheet(bard).resources.bardic_inspiration.used;
      const same = await spend(bard, "Infectious Inspiration", { targetCharacterId: friend().id });
      assert.equal(same.ok, false, "the die went back to the creature whose roll succeeded");
      const on = await spend(bard, "Infectious Inspiration", { targetCharacterId: valor().id });
      assert.equal(on.ok, true, on.error);
      assert.deepEqual(
        [has(valor(), "bardic inspiration"), sheet(bard).resources.bardic_inspiration.used - inspirationUsed, sheet(bard).resources.sub_infectious_inspiration.used],
        [true, 0, 1],
        "[the other creature holds a die, Bardic Inspiration uses spent on it, Infectious Inspiration uses spent]",
      );
    },
    "infectious-uses": async () => {
      await uses(["bard", "College of Eloquence"], "sub_infectious_inspiration", { 14: Math.max(1, MOD.cha), 20: Math.max(1, MOD.cha) })();
      await infectiousRest();
    },
    // ---- College of Creation
    "creation-item": async () => {
      await stage(creation());
      const dear = await spend(creation(), "Performance of Creation", { variant: "Spyglass" });
      assert.equal(dear.ok, false, "a 1,000 gp spyglass is more than 20 times bard level 20 (400 gp)");
      const out = await spend(creation(), "Performance of Creation", { variant: "Hourglass" });
      assert.equal(out.ok, true, out.error);
      assert.ok(sheet(creation()).equipment.some((item) => item.name === "Hourglass"), "the hourglass is in the bard's pack");
    },
    "animating-item": async () => {
      await stage(creation());
      const out = await spend(creation(), "Animating Performance");
      assert.equal(out.ok, true, out.error);
      const item = world.sheets().find((entry) => entry.name.startsWith("Dancing Item"));
      assert.ok(item, `a Dancing Item stands at the table: ${show(out).slice(0, 160)}`);
      assert.equal(item.maxHp, 10 + 5 * 20, "10 + five times the bard level");
      assert.equal(item.ac, 16);
    },
    "creation-rest": rests(["bard", "College of Creation"], "sub_performance_of_creation", "long"),
    "creation-slot": async () => {
      await stage(creation());
      drain(creation(), "sub_performance_of_creation");
      const out = await spend(creation(), "Performance of Creation", { variant: "rope" });
      assert.equal(out.ok, true, `with the use spent and every slot on the sheet: ${String(out.error).slice(0, 160)}`);
      assert.ok(Object.values(sheet(creation()).spellcasting.slots).some((slot) => slot.used > 0), "a slot paid");
    },
    "animating-rest": rests(["bard", "College of Creation"], "sub_animating_performance", "long"),
    "animating-slot": async () => {
      await stage(creation());
      drain(creation(), "sub_animating_performance");
      const now = sheet(creation());
      world.patch(creation().id, { spellcasting: { ...now.spellcasting, slots: Object.fromEntries(Object.entries(now.spellcasting.slots).map(([level, slot]) => [level, { ...slot, used: Number(level) >= 3 ? slot.max : 0 }])) } });
      const out = await spend(creation(), "Animating Performance");
      assert.equal(out.ok, false, "only 1st- and 2nd-level slots left");
    },
    // ---- College of Spirits
    "spirits-guidance": async () => {
      assert.ok(spellsAt("College of Spirits", 3).includes("Guidance"));
    },
    "focus-text": async () => {
      const { sliceFeatures } = await import("./sweep-clauses-arcane.mjs");
      const text = sliceFeatures().get("bard::Spiritual Focus")?.text ?? "";
      assert.match(text, /\bd6\b|1d6/, `the words name no die, and the row rolls a d6 from 6th level: "${text}"`);
    },
    // "roll on the Spirit Tales table using your Bardic Inspiration die ...
    // you can use an action to choose one creature you can see within 30
    // feet": a 1 tells The Burned Bridge (src/lib/dm/spirit-tales.ts), which
    // burns the creature for two dice on a failed save and is then let go.
    "tales-door": async () => {
      const foes = await stage(spirits());
      const out = await spend(spirits(), "Tales from Beyond", {}, [1]);
      assert.equal(out.ok, true, `use_resource "Tales from Beyond": ${String(out.error).slice(0, 160)}`);
      assert.equal(sheet(spirits()).conditionMeta["spirit tale"]?.tale, 1, "the tale is kept");
      kit.saveEncounter({ ...world.encounter(), turnBudget: null });
      kit.freshTurn();
      const before = foe(foes[0]).currentHp;
      const told = await spend(spirits(), "Release Tale", { targetEnemyId: foes[0].id }, [1, 3, 3]);
      assert.equal(told.ok, true, told.error);
      assert.equal(before - foe(foes[0]).currentHp, 6, `two dice of fire on a failed save: ${show(told).slice(0, 200)}`);
      assert.ok(!sheet(spirits()).conditions.includes("spirit tale"), "the tale is let go");
      assert.equal((await spend(spirits(), "Release Tale", { targetEnemyId: foes[0].id })).ok, false, "nothing held to tell again");
    },
    // "session" is staged in sweep-clauses-arcane-bard-wbf.mjs: the probe that
    // stood here asked for a 3rd-level spell from a session of one, which the
    // text refuses ("no higher than the number of creatures who took part").
    "session-rest": rests(["bard", "College of Spirits"], "sub_spirit_session", "long"),
  };
  const infectiousRest = rests(["bard", "College of Eloquence"], "sub_infectious_inspiration", "long");

  const KNOWN = {
  };
  return { PROBES, KNOWN };
}
