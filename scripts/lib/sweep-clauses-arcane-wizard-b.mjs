// The clause probes of the wizard's War Magic, Bladesinging, Chronurgy Magic,
// Graviturgy Magic and Order of Scribes (scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-wizard.mjs).
import assert from "node:assert/strict";
import { MOD, prof } from "./sweep-clauses-arcane.mjs";

const DATA = "src/lib/srd/authored-effects-data*.ts";
const RES = "src/lib/srd/authored-resources.json";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, counter, budget, show, call, spend, react, roll, stage } = rig;
  const { friend, mage, drain, uses, rests, movesSomething, buysAnother } = shared;
  rig.outfit("wizard", "War Magic", { spells: ["Fire Bolt", "Magic Missile", "Hold Person", "Counterspell"], cantrips: ["Fire Bolt"], acOverride: false });
  rig.outfit("wizard", "Bladesinging", { spells: ["Fire Bolt", "Acid Splash", "Hold Person"], cantrips: ["Fire Bolt", "Acid Splash"], equipment: [{ name: "Rapier", qty: 1, equipped: true }], acOverride: false });
  const war = () => holder("wizard", "War Magic");
  const bla = () => holder("wizard", "Bladesinging");
  const chr = () => holder("wizard", "Chronurgy Magic");
  const gra = () => holder("wizard", "Graviturgy Magic");
  const scr = () => holder("wizard", "Order of Scribes");
  const condition = await0(() => import("../../src/lib/dm/condition-logic.ts"));
  const training = await0(() => import("../../src/lib/srd/subclass-training.ts"));
  const speedOf = async (who) => (await condition()).effectiveSpeed(sheet(who).conditions, rig.srd.speedFor(sheet(who)));
  const d20s = (out) => out.rolled.filter((die) => die.sides === 20).length;
  // The Hand's card of that name as the page deals it on the holder's own turn.
  const handOf = await0(async () => ({ ...(await import("../../src/lib/battlemap/hand.ts")), ...(await import("../../src/lib/battlemap/hand-table.ts")), ...(await import("../../src/lib/db/encounter-view.ts")) }));
  async function card(who, name) {
    const { deriveHand, turnFromEncounter, activePublicEncounter } = await handOf();
    const found = deriveHand(sheet(who), turnFromEncounter(activePublicEncounter(world.campaignId), sheet(who), { myTurn: true })).find((entry) => entry.name === name);
    assert.ok(found, `the Hand deals no ${name} card`);
    return found;
  }
  const open = async (who, name) => (await card(who, name)).disabled === null;
  // The dummy has hit this wizard for 6 on the friend's turn (13 against AC 12).
  async function hit(who, faces = [9, 4]) {
    const foes = await stage(who, { others: [friend()], first: friend() });
    await rig.table.strike(foes[0], who, faces);
    return foes;
  }
  async function singing() {
    const foes = await stage(bla());
    const out = await spend(bla(), "Bladesong");
    assert.equal(out.ok, true, out.error);
    return foes;
  }

  const PROBES = {
    // ---- War Magic
    "deflection-ac": async () => {
      // AC 12 with no armor (10 + DEX 2): a 13 hits, and +2 turns it.
      await hit(war());
      const before = hp(war());
      const turned = await react(war(), "Arcane Deflection");
      assert.equal(turned.ok, true, turned.error);
      assert.equal(hp(war()), before + 6, "the 13 is a miss against 14");
      await hit(war(), [10, 4]);
      const after = hp(war());
      await react(war(), "Arcane Deflection");
      assert.equal(hp(war()), after, "a 14 still lands");
    },
    "deflection-save": async () => {
      const marked = () => sheet(war()).conditions.includes("arcane deflection");
      const offered = () => rig.table.offered(war(), "Arcane Deflection").filter((entry) => entry.intent?.variant === "save");
      // With no save failed, nothing is answered and nothing is spent.
      await stage(war(), { others: [friend()], first: friend() });
      const none = await react(war(), "Arcane Deflection", { variant: "save" });
      assert.equal(none.ok, false, "no failed save on record");
      assert.deepEqual([rig.reacted(war()), marked()], [false, false], "[reaction spent, mark laid] on the refusal");
      // DEX save: a 9 on the die is 11 against DC 14, and +4 makes it 15.
      const failed = await roll(war(), { kind: "saving_throw", ability: "dex", dc: 14 }, [9]);
      assert.equal(failed.out.result?.success, false);
      const out = await react(war(), "Arcane Deflection", { variant: "save" });
      assert.equal(out.ok, true, `after a failed save: ${String(out.error).slice(0, 170)}`);
      assert.equal(out.result.save, "success", show(out));
      assert.match(out.result.applied, new RegExp(`\\+4 on the DEX save: ${9 + MOD.dex} becomes ${13 + MOD.dex} against DC 14`));
      assert.deepEqual([rig.reacted(war()), marked()], [true, true], "[reaction spent, mark laid] by the save's half");
      // One the +4 does not reach: 11 + 4 against DC 20 stays a failure, and the reaction is spent all the same.
      await stage(war(), { others: [friend()], first: friend() });
      assert.equal((await roll(war(), { kind: "saving_throw", ability: "dex", dc: 20 }, [9])).out.result?.success, false);
      const short = await react(war(), "Arcane Deflection", { variant: "save" });
      assert.equal(short.ok, true, short.error);
      assert.equal(short.result.save, "failure", show(short));
      assert.deepEqual([rig.reacted(war()), marked()], [true, true]);
      // A save a creature forced, whose failure laid a condition that same save
      // ends: CON 8 + 1 against DC 12 fails, 13 succeeds, and the poison is gone.
      const [enemy] = await stage(war(), { others: [friend()], first: friend() });
      const spit = await call("cast_at_player", { characterId: war().id, casterEnemyId: enemy.id, source: "a venom spit", saveAbility: "con", dc: 12, condition: "poisoned" }, [8]);
      assert.equal(spit.ok, true, spit.error);
      assert.ok(sheet(war()).conditions.includes("poisoned"), `the staging: the failed save was to poison them: ${show(spit)}`);
      assert.equal(offered().length, 1, "the Hand deals the save's card for the failed save on record");
      assert.equal(offered()[0].disabled, null);
      // No variant named and no hit open: the save is what it answers.
      const lifted = await react(war(), "Arcane Deflection");
      assert.equal(lifted.ok, true, lifted.error);
      assert.equal(lifted.result.save, "success", show(lifted));
      assert.ok(!sheet(war()).conditions.includes("poisoned"), "the condition the failed save laid is lifted with the save turned");
      assert.equal(offered().length, 0, "the card goes once the save is answered");
      // A failed save that paralyzes them is still theirs to turn: the reaction
      // is judged as they stood before the failure. STR 8 against DC 10, 12 with the +4.
      const [holder2] = await stage(war(), { others: [friend()], first: friend() });
      const held = await call("cast_at_player", { characterId: war().id, casterEnemyId: holder2.id, source: "a binding gaze", saveAbility: "str", dc: 10, condition: "paralyzed" }, [8]);
      assert.equal(held.ok, true, held.error);
      assert.ok(sheet(war()).conditions.includes("paralyzed"), `the staging: the failed save was to paralyze them: ${show(held)}`);
      assert.deepEqual(offered().map((entry) => entry.disabled), [null], "the save's card is open to a wizard the failure has just paralyzed");
      const freed = await react(war(), "Arcane Deflection", { variant: "save" });
      assert.equal(freed.ok, true, `paralyzed by the very save it answers: ${String(freed.error).slice(0, 170)}`);
      assert.ok(!sheet(war()).conditions.includes("paralyzed"), "the paralysis is lifted with the save turned");
      // Paralyzed by something else, they take no reaction at all.
      await stage(war(), { others: [friend()], first: friend() });
      assert.equal((await roll(war(), { kind: "saving_throw", ability: "dex", dc: 14 }, [9])).out.result?.success, false);
      world.patch(war().id, { conditions: ["paralyzed"], conditionMeta: { paralyzed: { rounds: 10 } } });
      assert.equal((await react(war(), "Arcane Deflection", { variant: "save" })).ok, false, "paralyzed before the save");
      world.patch(war().id, { conditions: [], conditionMeta: {} });
      // A save failed on an earlier turn is not open on this one.
      await stage(war(), { others: [friend()], first: friend() });
      assert.equal((await roll(war(), { kind: "saving_throw", ability: "dex", dc: 14 }, [9])).out.result?.success, false);
      rig.cycleTo(friend());
      const stale = await react(war(), "Arcane Deflection", { variant: "save" });
      assert.equal(stale.ok, false, "a save failed a round ago");
      assert.equal(rig.reacted(war()), false);
    },
    "deflection-cost": async () => {
      const [enemy] = await hit(war());
      assert.equal((await react(war(), "Arcane Deflection")).ok, true);
      assert.ok(sheet(war()).conditions.includes("arcane deflection"), "the reaction leaves its mark");
      // The wizard's next turn, come to by the table's own End Turn.
      rig.cycleTo(war());
      const before = JSON.stringify([budget(), sheet(war()).spellcasting.slots]);
      const cast = await call("cast_at_enemy", { characterId: war().id, targetEnemyId: enemy.id, spell: "Magic Missile" }, [4, 4, 4]);
      assert.equal(cast.ok, false, "on the turn after Arcane Deflection, a 1st-level spell is cast");
      assert.match(cast.error, /casts only cantrips until the end of their next turn/);
      assert.equal(JSON.stringify([budget(), sheet(war()).spellcasting.slots]), before, "the refusal spends neither the slot nor the action");
      // The Hand shuts the same cards the door refuses, and leaves the cantrip.
      assert.deepEqual([await open(war(), "Magic Missile"), await open(war(), "Hold Person"), await open(war(), "Fire Bolt")], [false, false, true], "[Magic Missile, Hold Person, Fire Bolt] cards open under the mark");
      assert.match((await card(war(), "Magic Missile")).disabled, /only cantrips/);
      const bolt = await call("pc_attack", { characterId: war().id, targetEnemyId: enemy.id, spell: "Fire Bolt" }, [10, 10]);
      assert.equal(bolt.ok, true, `a cantrip under the mark: ${String(bolt.error).slice(0, 170)}`);
      // The mark ends with that turn: the turn after, the spell is cast.
      rig.endCurrent();
      assert.ok(!sheet(war()).conditions.includes("arcane deflection"), "the mark outlives the end of the wizard's next turn");
      rig.cycleTo(war());
      const later = await call("cast_at_enemy", { characterId: war().id, targetEnemyId: enemy.id, spell: "Magic Missile" }, [4, 4, 4]);
      assert.equal(later.ok, true, `the turn after that: ${String(later.error).slice(0, 170)}`);
    },
    "surge-max": uses(["wizard", "War Magic"], "sub_power_surge", { 6: Math.max(1, MOD.int), 20: Math.max(1, MOD.int) }),
    "surge-long-rest": async () => {
      await rig.rest("long");
      const now = counter(war(), "sub_power_surge");
      assert.equal(now.max - now.used, 1, `surges held after a long rest (of ${now.max})`);
    },
    "surge-short-rest": async () => {
      await kit.endFight();
      drain(war(), "sub_power_surge");
      await rig.rest("short");
      const now = counter(war(), "sub_power_surge");
      assert.equal(now.max - now.used, 1, "surges held after a short rest begun with none");
    },
    "surge-counterspell": async () => {
      const [enemy] = await stage(war(), { others: [friend()], first: friend() });
      mage(enemy);
      drain(war(), "sub_power_surge");
      // Fireball is 3rd level: a 3rd-level Counterspell ends it with no check.
      const out = await react(war(), "Counterspell", { targetEnemyId: enemy.id, spell: "Fireball", level: 3 });
      if (!out.ok) throw new Error(out.error);
      assert.equal(out.result.countered, true);
      const now = counter(war(), "sub_power_surge");
      assert.equal(now.max - now.used, 1, "surges held after ending a spell with Counterspell");
    },
    "surge-spend": async () => {
      const [enemy] = await stage(war());
      kit.saveEncounter({ ...world.encounter(), turnBudget: null });
      kit.freshTurn();
      const bare = await spend(war(), "Power Surge", { targetEnemyId: enemy.id });
      assert.equal(bare.ok, false, "a surge with no wizard spell's damage this turn");
      const cast = await call("cast_at_enemy", { characterId: war().id, targetEnemyId: enemy.id, spell: "Magic Missile" }, [1, 1, 1]);
      assert.equal(cast.ok, true, cast.error);
      const before = foe(enemy).currentHp;
      const out = await spend(war(), "Power Surge", { targetEnemyId: enemy.id });
      assert.equal(out.ok, true, out.error);
      assert.equal(before - foe(enemy).currentHp, 10, "force damage equal to half a 20th-level wizard's level");
      assert.equal((await spend(war(), "Power Surge", { targetEnemyId: enemy.id })).ok, false, "once per turn");
    },
    "deflecting-shroud": async () => {
      // Hit by the first of five: four stand in a row within 20 feet, the fifth 75 feet off.
      async function shrouded(who) {
        const foes = await stage(who, { count: 5, others: [friend()], first: friend() });
        await rig.table.strike(foes[0], who, [9, 4]);
        kit.place(who.id, 1, 5);
        foes.slice(0, 4).forEach((enemy, at) => kit.place(enemy.id, 2 + at, 5));
        kit.place(foes[4].id, 16, 5);
        assert.ok(rig.feetBetween(who, foes[4]) > 60 && rig.feetBetween(who, foes[3]) <= 60, "the staging: four within 60 feet, one beyond");
        return foes;
      }
      const hps = (foes) => foes.map((enemy) => foe(enemy).currentHp);
      const lost = (before, foes) => hps(foes).map((now, at) => before[at] - now);
      const half = Math.floor(20 / 2);
      // Nobody named: the three nearest take half the wizard level, the fourth and the far one nothing.
      let foes = await shrouded(war());
      let before = hps(foes);
      const out = await react(war(), "Arcane Deflection");
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(lost(before, foes), [half, half, half, 0, 0], `force damage to [nearest, second, third, fourth, 75 feet off]: ${show(out)}`);
      assert.match(out.result.shroud, /10 force/);
      // The creatures named are the ones struck.
      foes = await shrouded(war());
      before = hps(foes);
      const picked = await react(war(), "Arcane Deflection", { targetEnemyIds: [foes[3].id, foes[1].id] });
      assert.equal(picked.ok, true, picked.error);
      assert.deepEqual(lost(before, foes), [0, half, 0, half, 0], "the two named and nobody else");
      // One named beyond 60 feet, or a fourth: refused, with the reaction and the hit as they were.
      foes = await shrouded(war());
      before = hps(foes);
      const far = await react(war(), "Arcane Deflection", { targetEnemyIds: [foes[4].id] });
      assert.equal(far.ok, false, "a creature 75 feet off");
      assert.match(far.error, /beyond 60 feet/);
      const four = await react(war(), "Arcane Deflection", { targetEnemyIds: foes.slice(0, 4).map((enemy) => enemy.id) });
      assert.equal(four.ok, false, "four creatures named");
      assert.deepEqual([lost(before, foes), rig.reacted(war()), sheet(war()).conditions.includes("arcane deflection")], [[0, 0, 0, 0, 0], false, false], "[damage, reaction spent, mark laid] on the refusals");
      // The save's half deals it too.
      assert.equal((await roll(war(), { kind: "saving_throw", ability: "dex", dc: 14 }, [9])).out.result?.success, false);
      const saved = await react(war(), "Arcane Deflection", { variant: "save" });
      assert.equal(saved.ok, true, saved.error);
      assert.deepEqual(lost(before, foes), [half, half, half, 0, 0], "the shroud from the +4 on a save");
      // Below 14th level there is no shroud.
      const young = holder("wizard", "War Magic", 13);
      foes = await shrouded(young);
      before = hps(foes);
      assert.equal((await react(young, "Arcane Deflection")).ok, true);
      assert.deepEqual(lost(before, foes), [0, 0, 0, 0, 0], "a 13th-level war mage's Arcane Deflection hurts nobody");
    },
    // ---- Bladesinging
    "bladesinger-training": async () => {
      const [grant] = (await training()).subclassGrants([{ id: "wizard", level: 2, subclass: "Bladesinging" }]);
      assert.deepEqual(grant.spec.armor, ["light"]);
      assert.deepEqual(grant.spec.fixedSkills, ["performance"]);
      assert.equal(grant.spec.weapons, 1, "one weapon of the player's choice");
      assert.ok(grant.spec.weaponsFrom.includes("Rapier") && !grant.spec.weaponsFrom.includes("Greatsword"), "one-handed melee weapons only");
    },
    "bladesong-on": async () => {
      await singing();
      assert.equal(budget().bonusUsed, true);
      assert.equal(budget().actionUsed, false);
      assert.equal(sheet(bla()).conditionMeta.bladesong.rounds, 10);
    },
    "bladesong-ac": async () => {
      const [enemy] = await singing();
      const out = await rig.table.strike(enemy, bla(), [2, 4]);
      assert.equal(out.result.vsAc, 10 + MOD.dex + MOD.int);
    },
    "bladesong-speed": async () => {
      await stage(bla());
      const before = await speedOf(bla());
      await spend(bla(), "Bladesong");
      assert.equal(await speedOf(bla()), before + 10);
    },
    "bladesong-acrobatics": async () => {
      await singing();
      assert.equal((await roll(bla(), { kind: "skill_check", skill: "acrobatics", dc: 10 })).d20s, 2, "d20s thrown for a bladesinger's Acrobatics check");
    },
    "bladesong-concentration": async () => {
      const [enemy] = await singing();
      kit.saveEncounter({ ...world.encounter(), turnBudget: null });
      assert.equal((await call("cast_at_enemy", { characterId: bla().id, targetEnemyId: enemy.id, spell: "Hold Person" }, [1])).ok, true);
      // 10 damage is DC 10: a 6 on the die is 7 with CON +1, 10 with INT +3.
      const out = await call("apply_damage", { characterId: bla().id, amount: 10, type: "fire" }, [6]);
      assert.equal(sheet(bla()).concentratingOn, "Hold Person", `the save to keep the spell: ${JSON.stringify(out.result?.concentration)}`);
      assert.equal(out.result.concentration.rolled, 6 + MOD.con + Math.max(1, MOD.int), "the die, Constitution and Intelligence");
      // The Intelligence modifier and no more: a 5 is 9, and the spell is lost.
      const low = await call("apply_damage", { characterId: bla().id, amount: 10, type: "fire" }, [5]);
      assert.equal(low.result.concentration.rolled, 5 + MOD.con + Math.max(1, MOD.int));
      assert.equal(sheet(bla()).concentratingOn ?? null, null, "9 against DC 10 loses the spell");
      // Only while the song runs: the same 6 is a 7 once it has ended.
      const [other] = await stage(bla());
      kit.saveEncounter({ ...world.encounter(), turnBudget: null });
      assert.equal((await call("cast_at_enemy", { characterId: bla().id, targetEnemyId: other.id, spell: "Hold Person" }, [1])).ok, true);
      const plain = await call("apply_damage", { characterId: bla().id, amount: 10, type: "fire" }, [6]);
      assert.equal(plain.result.concentration.rolled, 6 + MOD.con, "no song, no Intelligence on the save");
      assert.equal(sheet(bla()).concentratingOn ?? null, null);
    },
    "bladesong-uses": async () => {
      await uses(["wizard", "Bladesinging"], "sub_bladesong", { 2: prof(2), 20: prof(20) })();
      await bladesongRest();
    },
    "bladesinger-extra-attack": async () => {
      const [enemy] = await stage(bla());
      for (const swing of [1, 2]) {
        const out = await kit.swing(bla().id, enemy.id, [15, 4], { weapon: "Rapier" });
        assert.equal(out.ok, true, `swing ${swing}: ${out.error}`);
      }
      assert.equal((await kit.swing(bla().id, enemy.id, [15, 4], { weapon: "Rapier" })).ok, false, "no third");
    },
    "bladesinger-cantrip": async () => {
      const swing = (who, enemy) => kit.swing(who.id, enemy.id, [15, 4], { weapon: "Rapier" });
      const bolt = (who, enemy) => call("pc_attack", { characterId: who.id, targetEnemyId: enemy.id, spell: "Fire Bolt" }, [10, 10]);
      const splash = (who, enemy) => call("cast_at_enemy", { characterId: who.id, targetEnemyId: enemy.id, spell: "Acid Splash" }, [10, 3]);
      const refusedFree = async (act, why) => {
        const before = JSON.stringify([budget(), sheet(bla()).spellcasting.slots]);
        const out = await act();
        assert.equal(out.ok, false, why);
        assert.equal(JSON.stringify([budget(), sheet(bla()).spellcasting.slots]), before, `${why}: nothing is spent on the refusal`);
        return out;
      };
      // A weapon attack, then an attack-roll cantrip as the second attack.
      let [enemy] = await stage(bla());
      assert.equal((await swing(bla(), enemy)).ok, true);
      const second = await bolt(bla(), enemy);
      assert.equal(second.ok, true, `Fire Bolt as the second attack of the action: ${String(second.error).slice(0, 170)}`);
      assert.deepEqual([budget().attacksMade, budget().castThisAction ?? false], [2, false], "the cantrip is one of the two attacks");
      assert.deepEqual([await open(bla(), "Fire Bolt"), await open(bla(), "Rapier")], [false, false], "[Fire Bolt, Rapier] cards open with both attacks made");
      await refusedFree(() => swing(bla(), enemy), "a third attack");
      await refusedFree(() => bolt(bla(), enemy), "a cantrip once both attacks are made");
      // The cantrip first, then the weapon; a save cantrip through cast_at_enemy.
      [enemy] = await stage(bla());
      const first = await splash(bla(), enemy);
      assert.equal(first.ok, true, `Acid Splash as the first attack of the action: ${String(first.error).slice(0, 170)}`);
      assert.deepEqual([budget().actionUsed, budget().attacksMade], [true, 1]);
      assert.deepEqual([await open(bla(), "Fire Bolt"), await open(bla(), "Rapier")], [false, true], "[Fire Bolt, Rapier] cards open after the action's one cantrip");
      // One cantrip per Attack action: the other attack is a weapon's.
      const twice = await refusedFree(() => bolt(bla(), enemy), "a second cantrip in the same Attack action");
      assert.match(twice.error, /Extra Attack allows one/);
      assert.equal((await swing(bla(), enemy)).ok, true, "the weapon attack after the cantrip");
      assert.equal(budget().attacksMade, 2);
      // A spell of 1st level or higher is never one of the attacks.
      [enemy] = await stage(bla());
      assert.equal((await swing(bla(), enemy)).ok, true);
      // The Hand after one weapon attack: the cantrips are open, the levelled spell shut.
      assert.deepEqual([await open(bla(), "Fire Bolt"), await open(bla(), "Acid Splash"), await open(bla(), "Hold Person")], [true, true, false], "[Fire Bolt, Acid Splash, Hold Person] cards open after one weapon attack");
      const levelled = await refusedFree(() => call("cast_at_enemy", { characterId: bla().id, targetEnemyId: enemy.id, spell: "Hold Person" }, [1]), "a levelled spell as the second attack");
      assert.match(levelled.error, /not a spell of 1st level or higher/);
      assert.equal((await splash(bla(), enemy)).ok, true, "the cantrip still takes the second attack");
      // Below 6th level there is no Extra Attack to give it.
      const young = holder("wizard", "Bladesinging", 5);
      [enemy] = await stage(young);
      assert.equal((await swing(young, enemy)).ok, true);
      assert.equal(await open(young, "Fire Bolt"), false, "a 5th-level bladesinger's Fire Bolt card after their one attack");
      assert.equal((await bolt(young, enemy)).ok, false, "a 5th-level bladesinger's cantrip is the whole action");
    },
    "song-of-defense-gate": async () => {
      await hit(bla());
      const out = await react(bla(), "Song of Defense", { level: 1 });
      assert.equal(out.ok, false);
      assert.match(out.error, /only while bladesong holds/);
    },
    "song-of-victory": async () => {
      const [enemy] = await singing();
      const out = await kit.swing(bla().id, enemy.id, [15, 4], { weapon: "Rapier" });
      assert.equal(out.damage.total, 4 + MOD.dex + Math.max(1, MOD.int));
    },
    "song-of-victory-off": async () => {
      const [enemy] = await stage(bla());
      const out = await kit.swing(bla().id, enemy.id, [15, 4], { weapon: "Rapier" });
      assert.equal(out.damage.total, 4 + MOD.dex);
    },
    // ---- Chronurgy
    "chronal-uses": async () => {
      await uses(["wizard", "Chronurgy Magic"], "sub_chronal_shift", { 2: 2, 20: 2 })();
      await chronalRest();
    },
    "temporal-awareness": async () => {
      await kit.endFight();
      const rolled = await roll(chr(), { kind: "initiative" }, [10]);
      assert.equal(rolled.out.result.total, 10 + MOD.dex + MOD.int);
    },
    "stasis-uses": async () => {
      await uses(["wizard", "Chronurgy Magic"], "sub_momentary_stasis", { 6: Math.max(1, MOD.int) })();
      await stasisRest();
    },
    abeyance: movesSomething(["wizard", "Chronurgy Magic"], "Arcane Abeyance"),
    "abeyance-rest": rests(["wizard", "Chronurgy Magic"], "sub_arcane_abeyance", "short"),
    "convergent-miss": async () => {
      await hit(chr());
      const before = hp(chr());
      const out = await react(chr(), "Convergent Future");
      assert.equal(out.ok, true, out.error);
      assert.equal(hp(chr()), before + 6, "the hit is a miss");
      assert.equal(sheet(chr()).exhaustion, 1);
    },
    "convergent-range": async () => {
      const [enemy] = await stage(chr(), { others: [friend()], first: friend() });
      kit.setEnemy(enemy.id, { stats: { ...foe(enemy).stats, attacks: [{ name: "Longbow", toHit: 4, damage: "1d8", type: "piercing", ranged: true, range: "150/600 ft." }] } });
      kit.place(chr().id, 1, 1);
      kit.place(enemy.id, 16, 1);
      // The shot straight from where it stands (the table's strike walks it in first).
      const shot = await call("enemy_attack", { enemyId: enemy.id, targetCharacterId: chr().id }, [20, 4]);
      assert.equal(shot.ok, true, shot.error);
      // The engine walks the archer in to shoot; the reach is measured from
      // where the attacker stands as the reaction answers, as Chronal Shift's.
      kit.place(enemy.id, 16, 1);
      assert.ok(rig.feetBetween(chr(), enemy) > 60, `the staging: the archer stands ${rig.feetBetween(chr(), enemy)} feet away`);
      const out = await react(chr(), "Convergent Future");
      assert.equal(out.ok, false, `the roll was made 75 feet away: ${show(out).slice(0, 140)}`);
    },
    "convergent-other-rolls": async () => {
      await stage(chr(), { others: [friend()], first: friend() });
      const failed = await roll(friend(), { kind: "saving_throw", ability: "dex", dc: 25 }, [2]);
      assert.equal(failed.out.result?.success, false);
      const out = await react(chr(), "Convergent Future", { targetCharacterId: friend().id, variant: "success" });
      assert.equal(out.ok, true, `to make an ally's failed save a success: ${String(out.error).slice(0, 170)}`);
    },
    // ---- Graviturgy
    "density-speed": async () => {
      await stage(gra(), { others: [friend()] });
      const before = await speedOf(friend());
      const heavier = await spend(gra(), "Adjust Density", { targetCharacterId: friend().id, variant: "heavier" });
      assert.equal(heavier.ok, true, heavier.error);
      assert.equal(sheet(friend()).conditionMeta["adjusted density (heavier)"].rounds, 10, "a minute");
      assert.equal(await speedOf(friend()), before - 10);
      world.patch(friend().id, { conditions: ["adjusted density (lighter)"] });
      assert.equal(await speedOf(friend()), before + 10);
      world.patch(friend().id, { conditions: [], conditionMeta: {} });
    },
    "density-strength": async () => {
      await kit.endFight();
      const keep = async (condition) => {
        world.patch(friend().id, { conditions: [condition] });
        const out = (await roll(friend(), { kind: "ability_check", ability: "str", dc: 10 }, [3, 17])).out;
        world.patch(friend().id, { conditions: [] });
        return out.result.dice.find((term) => term.sides === 20)?.keep?.mode;
      };
      assert.equal(await keep("adjusted density (heavier)"), "highest", "doubled weight: advantage on Strength checks");
      assert.equal(await keep("adjusted density (lighter)"), "lowest", "halved weight: disadvantage");
    },
    "density-enemy": async () => {
      const [enemy] = await stage(gra(), { others: [friend()] });
      const out = await spend(gra(), "Adjust Density", { targetEnemyId: enemy.id, variant: "heavier" });
      if (!out.ok) throw new Error(out.error);
      assert.ok(foe(enemy).conditions.some((name) => name.startsWith("adjusted density")), `aimed at a creature of the other side, it lands elsewhere: ${show(out).slice(0, 150)}`);
    },
    "attraction-hit": async () => {
      const [enemy] = await stage(gra(), { others: [friend()], first: friend() });
      kit.place(friend().id, 6, 6);
      const swung = await kit.swing(friend().id, enemy.id, [15, 3]);
      assert.equal(swung.ok, true, swung.error);
      const before = foe(enemy).currentHp;
      const out = await spend(gra(), "Violent Attraction", {}, [7]);
      assert.equal(out.ok, true, out.error);
      assert.equal(before - foe(enemy).currentHp, 7, `the 1d10 rides the ally's weapon hit: ${show(out).slice(0, 160)}`);
    },
    "attraction-uses": async () => {
      await uses(["wizard", "Graviturgy Magic"], "sub_violent_attraction", { 10: Math.max(1, MOD.int) })();
      await attractionRest();
    },
    "horizon-uses": async () => {
      await uses(["wizard", "Graviturgy Magic"], "sub_event_horizon", { 14: 1 })();
      await horizonRest();
    },
    "horizon-slot": buysAnother(["wizard", "Graviturgy Magic"], "Event Horizon", "sub_event_horizon", "spell slot of 3rd level and higher"),
    // ---- Order of Scribes
    "mind-bonus": async () => {
      await stage(scr());
      const out = await spend(scr(), "Manifest Mind");
      assert.equal(out.ok, true, out.error);
      assert.equal(budget().bonusUsed, true);
      assert.ok(sheet(scr()).conditions.includes("manifest mind"));
    },
    "mind-object": async () => {
      await stage(scr());
      const tokens = () => world.enemies().length + world.sheets().length + JSON.stringify(kit.map().zones ?? kit.map().effects ?? "").length;
      const before = tokens();
      await spend(scr(), "Manifest Mind");
      assert.notEqual(tokens(), before, "nothing stands on the board for the mind: no token, no zone, no light, nothing to be within 60 or 300 feet of");
    },
    "mind-casts": uses(["wizard", "Order of Scribes"], "sub_manifest_mind_casts", { 6: prof(6), 20: prof(20) }),
    "mind-free": async () => {
      await uses(["wizard", "Order of Scribes"], "sub_manifest_mind", { 6: 1 })();
      await mindRest();
    },
    "mind-slot": buysAnother(["wizard", "Order of Scribes"], "Manifest Mind", "sub_manifest_mind", "spell slot"),
    scrivener: movesSomething(["wizard", "Order of Scribes"], "Master Scrivener"),
    "word-arcana": async () => {
      await kit.endFight();
      assert.equal((await roll(scr(), { kind: "skill_check", skill: "arcana", dc: 10 })).d20s, 2, "d20s thrown for a 14th-level scribe's Arcana check");
    },
    "word-prevent": async () => {
      await hit(scr());
      world.patch(scr().id, { conditions: ["manifest mind"] });
      const before = hp(scr());
      const out = await react(scr(), "One with the Word");
      assert.equal(out.ok, true, out.error);
      assert.equal(hp(scr()), before + 6, "all of the damage is prevented");
      assert.ok(!sheet(scr()).conditions.includes("manifest mind"), "the mind is dismissed");
    },
    "word-vanish": async () => {
      await hit(scr());
      world.patch(scr().id, { conditions: ["manifest mind"], spellcasting: { ...sheet(scr()).spellcasting, prepared: ["Fireball", "Fly", "Shield"], known: ["Fireball", "Fly", "Shield"] } });
      // 3d6 of 1 each: spells of 3 levels together leave the book.
      await react(scr(), "One with the Word", {}, [1, 1, 1]);
      const book = sheet(scr()).spellcasting;
      assert.ok(book.known.length + book.prepared.length < 6, "every spell is still in the book after the 3d6");
    },
    "word-uses": async () => {
      await uses(["wizard", "Order of Scribes"], "sub_one_with_the_word", { 14: 1 })();
      await wordRest();
    },
  };
  const bladesongRest = rests(["wizard", "Bladesinging"], "sub_bladesong", "long");
  const chronalRest = rests(["wizard", "Chronurgy Magic"], "sub_chronal_shift", "long");
  const stasisRest = rests(["wizard", "Chronurgy Magic"], "sub_momentary_stasis", "long");
  const attractionRest = rests(["wizard", "Graviturgy Magic"], "sub_violent_attraction", "long");
  const horizonRest = rests(["wizard", "Graviturgy Magic"], "sub_event_horizon", "long");
  const mindRest = rests(["wizard", "Order of Scribes"], "sub_manifest_mind", "long");
  const wordRest = rests(["wizard", "Order of Scribes"], "sub_one_with_the_word", "long");

  const KNOWN = {
    abeyance: { severity: "low", kind: "rule-missing", where: `${RES} sub_arcane_abeyance (a counter with guidance)`, note: "Nothing holds the bead or the spell in it.", fix: "An item on the sheet (as use_spell_slot's storeIn does for a Ring of Spell Storing)." },
    "convergent-other-rolls": { severity: "medium", kind: "rule-missing", where: `${DATA} wizard::Convergent Future (force_miss: a hit made a miss, and nothing else)`, note: "The feature turns any attack roll, ability check or saving throw within 60 feet into a success or a failure; the engine holds one of those six cases.", fix: "Offer it on the after-roll card for an ally's failed save or check and a foe's passed save." },
    "density-enemy": { severity: "medium", kind: "rule-wrong", where: `${DATA} wizard::Adjust Density (buff target "ally"), src/lib/dm/authored-spend-effects.ts (a targetEnemyId the buff cannot use falls back to the holder)`, note: "The wizard meant to slow a foe and is told they have slowed themselves; the action is spent.", fix: "Let the buff take a creature of either side, and refuse a target it cannot use instead of falling back to the holder." },
    "mind-object": { severity: "low", kind: "rule-missing", where: `${RES} sub_manifest_mind (fx buff: a condition on the wizard)`, note: "The 60 feet, the 300 feet, its light and its sight have nothing to be measured from.", fix: "A token or zone for the mind, moved with the wizard's bonus action." },
    scrivener: { severity: "low", kind: "rule-missing", where: `${RES} sub_master_scrivener (a counter with guidance)`, note: "No scroll is made; the +1 level casting has nothing to ride.", fix: "Write a scroll onto the sheet that the cast tools read one level higher and a long rest removes." },
    "word-vanish": { severity: "low", kind: "rule-missing", where: "src/lib/dm/reaction-counters.ts One with the Word (the price is told, not taken)", note: "The reaction prevents the damage for free.", fix: "Roll the 3d6 and mark spells of that many levels as gone until 1d6 long rests pass." },
  };
  return { PROBES, KNOWN };
}

// A module loaded on first use and kept.
function await0(load) {
  let seen = null;
  return () => (seen ??= load());
}
