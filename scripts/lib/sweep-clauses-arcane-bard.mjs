// The clause probes of the bard's authored colleges: Valor, Glamour, Swords,
// Whispers, Eloquence, Creation and Spirits (scripts/clauses/arcane.json; run
// by test-enforce-sweep-clauses-arcane-bard.mjs).
import assert from "node:assert/strict";
import { MOD } from "./sweep-clauses-arcane.mjs";

const DATA = "src/lib/srd/authored-effects-data*.ts";
const RES = "src/lib/srd/authored-resources.json";

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
      await stage(valor(), { others: [friend()], first: friend() });
      await inspire(valor());
      const [enemy] = world.enemies();
      kit.giveTurn(friend().id);
      kit.freshTurn();
      const swing = await kit.swing(friend().id, enemy.id, [15, 3]);
      assert.equal(swing.ok, true, swing.error);
      const before = foe(enemy).currentHp;
      const out = await spend(friend(), "Combat Inspiration", { targetEnemyId: enemy.id, variant: "damage" }, [6]);
      assert.equal(before - foe(enemy).currentHp, 6, `the inspired friend adds the die (a 6) to the damage of the hit: ${show(out).slice(0, 180)}`);
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
      await struck(swords());
      const from = kit.token(swords().id);
      const out = await call("move_token", { characterId: swords().id, x: from.x, y: from.y + 8 });
      assert.equal(out.ok, true, `40 feet on a turn the bard took the Attack action: ${String(out.error).slice(0, 160)}`);
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
      const out = await spend(swords(14), "Blade Flourish", { targetEnemyId: enemy.id, variant: "defensive" }, [3]);
      assert.equal(out.ok, true, `with no Bardic Inspiration left, a d6 pays for the flourish: ${String(out.error).slice(0, 160)}`);
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
      await stage(eloquence(), { others: [friend()] });
      await inspire(eloquence());
      const { listOpenPendingRolls } = await import("../../src/lib/db/dm-turns.ts");
      const { call: routeCall } = await import("./enforce-campaign.mjs");
      const choice = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");
      world.clearDice();
      world.dice(10);
      await world.invoke("request_roll", { characterId: friend().id, kind: "skill_check", skill: "athletics", dc: 25, reason: "probe" });
      world.clearDice();
      const [pending] = listOpenPendingRolls(world.campaignId).filter((entry) => entry.thrown);
      assert.ok(pending, "the friend's check waits on the inspiration card");
      world.signIn({ id: sheet(friend()).userId });
      world.dice(1);
      await routeCall(choice, "POST", { use: "bardic" }, { campaignId: world.campaignId, pendingRollId: pending.id });
      world.clearDice();
      assert.ok(has(friend(), "bardic inspiration"), "a die that left the check failed is kept");
    },
    "speech-rest": rests(["bard", "College of Eloquence"], "sub_universal_speech", "long"),
    "speech-slot": async () => {
      await stage(eloquence());
      drain(eloquence(), "sub_universal_speech");
      const out = await spend(eloquence(), "Universal Speech");
      assert.equal(out.ok, true, `with the use spent and every slot on the sheet: ${String(out.error).slice(0, 160)}`);
      assert.ok(Object.values(sheet(eloquence()).spellcasting.slots).some((slot) => slot.used > 0), "a slot paid");
    },
    "infectious-uses": async () => {
      await uses(["bard", "College of Eloquence"], "sub_infectious_inspiration", { 14: Math.max(1, MOD.cha), 20: Math.max(1, MOD.cha) })();
      await infectiousRest();
    },
    // ---- College of Creation
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
    "tales-door": async () => {
      await stage(spirits());
      const out = await spend(spirits(), "Tales from Beyond");
      assert.equal(out.ok, true, `use_resource "Tales from Beyond": ${String(out.error).slice(0, 160)}`);
    },
    session: async () => {
      await kit.endFight();
      const out = await spend(spirits(), "Spirit Session", { variant: "Speak with Dead" });
      assert.equal(out.ok, true, out.error);
      assert.ok((sheet(spirits()).spellcasting.prepared ?? []).includes("Speak with Dead"), "the spell is learned");
    },
    "session-rest": rests(["bard", "College of Spirits"], "sub_spirit_session", "long"),
  };
  const infectiousRest = rests(["bard", "College of Eloquence"], "sub_infectious_inspiration", "long");

  const KNOWN = {
    "combat-damage": { severity: "medium", kind: "rule-missing", where: `${DATA} bard::Combat Inspiration (one reaction, ac_vs_hit)`, note: "", fix: "Let the inspired creature add the die to a damage roll it just made." },
    "flourish-speed": { severity: "low", kind: "rule-missing", where: `${DATA} bard::Blade Flourish (the spend only)`, note: "", fix: "Add 10 feet to the bard's speed on a turn they take the Attack action." },
    "masters-flourish": { severity: "low", kind: "rule-missing", where: `${DATA} bard::Master's Flourish (narrated)`, note: "", fix: "Let Blade Flourish be paid with a d6 when no die is spent." },
    unfailing: { severity: "low", kind: "rule-missing", where: `${DATA} bard::Unfailing Inspiration (narrated)`, note: "", fix: "Keep the inspiration of an Eloquence bard when the roll it rode still fails." },
    "tales-door": { severity: "medium", kind: "rule-missing", where: `${DATA} bard::Tales from Beyond (narrated)`, note: "", fix: "A spend that rolls the Spirit Tales table and plays the tale." },
    session: { severity: "low", kind: "rule-missing", where: `${RES} sub_spirit_session (a counter with guidance)`, note: "", fix: "Teach the chosen divination or necromancy spell until the next long rest." },
  };
  return { PROBES, KNOWN };
}
