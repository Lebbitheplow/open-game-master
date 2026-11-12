// The clause probes of the wizard's War Magic, Bladesinging, Chronurgy Magic,
// Graviturgy Magic and Order of Scribes (scripts/clauses/arcane.json; run by
// test-enforce-sweep-clauses-arcane-wizard.mjs).
import assert from "node:assert/strict";
import { MOD, prof, spellDc } from "./sweep-clauses-arcane.mjs";

import { fateProbe } from "./fate-probe.mjs";
const DATA = "src/lib/srd/authored-effects-data*.ts";
export const SCRIBE_BOOK = ["Magic Missile", "Shield", "Detect Magic", "Scorching Ray", "Fireball", "Lightning Bolt", "Fly", "Ice Storm", "Cone of Cold", "Chain Lightning"];
const RES = "src/lib/srd/authored-resources.json";

export function probes(rig, shared) {
  const { world, kit, holder, sheet, foe, hp, counter, budget, show, call, spend, react, roll, stage } = rig;
  const { friend, mage, drain, uses, rests, buysAnother } = shared;
  rig.outfit("wizard", "War Magic", { spells: ["Fire Bolt", "Magic Missile", "Hold Person", "Counterspell"], cantrips: ["Fire Bolt"], acOverride: false });
  rig.outfit("wizard", "Bladesinging", { spells: ["Fire Bolt", "Acid Splash", "Hold Person"], cantrips: ["Fire Bolt", "Acid Splash"], equipment: [{ name: "Rapier", qty: 1, equipped: true }], acOverride: false });
  // A scribe's book: 29 spell levels, more than One with the Word's 3d6 can ask.
  // Shocking Grasp, a touch cantrip, for a spell cast from the mind's space.
  rig.outfit("wizard", "Order of Scribes", { spells: SCRIBE_BOOK, cantrips: ["Shocking Grasp"] });
  rig.outfit("wizard", "Chronurgy Magic", { spells: ["Hold Person", "Magic Missile", "Fireball", "Cone of Cold"], cantrips: ["Fire Bolt"] });
  const war = () => holder("wizard", "War Magic");
  const bla = () => holder("wizard", "Bladesinging");
  const chr = () => holder("wizard", "Chronurgy Magic");
  const gra = () => holder("wizard", "Graviturgy Magic");
  const scr = () => holder("wizard", "Order of Scribes");
  const condition = await0(() => import("../../src/lib/dm/condition-logic.ts"));
  const training = await0(() => import("../../src/lib/srd/subclass-training.ts"));
  const speedOf = async (who) => (await condition()).effectiveSpeed(sheet(who).conditions, rig.srd.speedFor(sheet(who)));
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
      // The attacker named alone (targetEnemyId) is no list for the shroud: the nearest three take it.
      const aimed = await react(war(), "Arcane Deflection", { targetEnemyId: foes[4].id });
      assert.equal(aimed.ok, true, aimed.error);
      assert.deepEqual(lost(before, foes), [half, half, half, 0, 0], "the nearest three, with a far creature named as the one answered");
      // The save's half deals it too.
      foes = await shrouded(war());
      before = hps(foes);
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
    // The wizard casts the spell into a bead (use_spell_slot with storeIn):
    // the slot, the action and the use of Arcane Abeyance are paid, the spell
    // does nothing now, and the bead is on the pack of the creature named,
    // holding the spell at the slot's level with the wizard's save DC and
    // attack bonus for an hour. Whoever holds it casts from it with no slot of
    // their own, and it is gone once cast or when the hour is over. A slot
    // above 4th level, a cantrip, a second bead with the use spent, a bare
    // use_resource and a wizard without the feature are refused, nothing spent.
    abeyance: async () => {
      const { getClock } = await import("../../src/lib/db/clock.ts");
      const who = chr();
      const [enemy] = await stage(who, { others: [friend()] });
      const beads = (holds) => sheet(holds).equipment.filter((item) => item.conjured?.kind === "bead");
      const paid = () => [sheet(who).spellcasting.slots[2].used, sheet(who).spellcasting.slots[5].used, counter(who, "sub_arcane_abeyance").used, budget()?.actionUsed ?? false, beads(who).length + beads(friend()).length];
      const store = (args) => call("use_spell_slot", { characterId: who.id, storeIn: "Arcane Abeyance", ...args });
      for (const [why, args] of [["a slot of 5th level", { spell: "Fireball", level: 5 }], ["a spell of 5th level", { spell: "Cone of Cold" }], ["a cantrip", { spell: "Fire Bolt" }]]) {
        const out = await store(args);
        assert.equal(out.ok, false, `${why} goes into a bead: ${show(out).slice(0, 120)}`);
        assert.match(out.error, /Nothing was spent/, why);
      }
      const bare = await spend(who, "Arcane Abeyance");
      assert.equal(bare.ok, false, "a bare use_resource spends the use and stores nothing");
      assert.deepEqual(paid(), [0, 0, 0, false, 0], "[2nd-level slots, 5th-level slots, uses, action, beads] after the refusals");
      // Hold Person from a 3rd-level slot would be level 3; from its own, level 2.
      const out = await store({ spell: "Hold Person", storeInCharacterId: friend().id });
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(paid(), [1, 0, 1, true, 1], "[2nd-level slots, 5th-level slots, uses, action, beads] once it is stored");
      const [bead] = beads(friend());
      const dc = spellDc("wizard", 20);
      assert.deepEqual(bead.storedSpells, [{ spell: "Hold Person", level: 2, saveDc: dc, attackBonus: dc - 8, abilityMod: MOD.int, by: sheet(who).name }], "the spell at its slot's level, with the wizard's numbers");
      assert.equal(bead.conjured.until - getClock(world.campaignId).instant, 60, "the minutes the bead has left");
      assert.deepEqual([foe(enemy).conditions.includes("paralyzed"), sheet(who).concentratingOn ?? null], [false, null], "[the foe held, the wizard concentrating]: the spell has no effect now");
      kit.freshTurn();
      const again = await store({ spell: "Magic Missile" });
      assert.equal(again.ok, false, "a second bead with the use spent");
      assert.equal(sheet(who).spellcasting.slots[1].used, 0, "the refused second bead spent a slot");
      // The fighter breaks it on their own turn: no slot of theirs, the wizard's DC.
      kit.giveTurn(friend().id);
      kit.freshTurn();
      const broken = await call("use_item", { characterId: friend().id, item: bead.name });
      assert.equal(broken.ok, true, broken.error);
      assert.deepEqual([broken.result.spellCast, broken.result.spellLevel, broken.result.saveDc], ["Hold Person", 2, dc], "[spell, level, save DC] read from the bead");
      const held = await call("cast_at_enemy", { characterId: friend().id, targetEnemyId: enemy.id, spell: "Hold Person" }, [1]);
      assert.equal(held.ok, true, held.error);
      assert.ok(foe(enemy).conditions.includes("paralyzed"), `the foe failed the save against the bead's Hold Person: ${show(held).slice(0, 160)}`);
      assert.equal(beads(friend()).length, 0, "the bead is gone once its spell is cast");
      // Its hour: there at 59 minutes, gone at 60.
      await kit.endFight();
      world.patch(friend().id, { concentratingOn: null });
      rig.refill(who);
      assert.equal((await store({ spell: "Magic Missile" })).ok, true, "a bead out of a fight");
      assert.equal(beads(who).length, 1);
      assert.equal((await call("pass_time", { amount: 59, unit: "minutes" })).ok, true);
      assert.equal(beads(who).length, 1, "the bead at 59 minutes");
      assert.equal((await call("pass_time", { amount: 1, unit: "minutes" })).ok, true);
      assert.equal(beads(who).length, 0, "the bead when its hour is over");
      // A wizard of another school has no bead to fill.
      const other = await call("use_spell_slot", { characterId: war().id, spell: "Magic Missile", storeIn: "Arcane Abeyance" });
      assert.equal(other.ok, false, "a war mage stores a spell in a bead");
      assert.equal(sheet(war()).spellcasting.slots[1].used, 0);
      rig.refill(who);
    },
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
    // "Decide whether the number rolled is the minimum needed to succeed or one
    // less than that number": a friend's failed save made a success on its
    // card, and a foe's passed save made a failure at the watch stop.
    "convergent-other-rolls": async () => {
      const who = chr();
      const foes = await fateProbe(rig, { holder: who, friend: friend(), power: "convergent_future", paid: (what) => assert.equal(sheet(who).exhaustion, 1, `a level of exhaustion for ${what}`) });
      const out = await foes.cast([20, 1, 1, 1, 1, 1]);
      assert.match(out.shift ?? "", /used Convergent Future: the die is ignored/, "a foe's passed save is not answered");
      assert.match(out.shift, /it fails/);
      assert.ok(out.lost > 0, "the spell the foe saved against lands once its save is made a failure");
      assert.equal(sheet(who).exhaustion, 1, "a level of exhaustion for the foe's save");
      rig.refill(who);
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
    // A creature of either side: the foe named carries it for the minute and
    // walks 10 feet slower or faster, the wizard nothing; with no creature
    // named it is the wizard's own; and a target the buff cannot use is
    // refused with the action unspent, for this buff and for any other.
    "density-enemy": async () => {
      const { enemySpeedTiles } = await import("../../src/lib/dm/enemy-speed.ts");
      const [enemy] = await stage(gra(), { others: [friend()] });
      const density = (list) => list.filter((name) => name.startsWith("adjusted density"));
      const walks = enemySpeedTiles(foe(enemy));
      const out = await spend(gra(), "Adjust Density", { targetEnemyId: enemy.id, variant: "heavier" });
      if (!out.ok) throw new Error(out.error);
      assert.deepEqual(density(foe(enemy).conditions), ["adjusted density (heavier)"], `aimed at a creature of the other side: ${show(out).slice(0, 150)}`);
      assert.equal(foe(enemy).conditionMeta["adjusted density (heavier)"].rounds, 10, "a minute");
      assert.deepEqual(density(sheet(gra()).conditions), [], "nothing lands on the wizard");
      assert.equal(budget().actionUsed, true, "the action");
      assert.equal(enemySpeedTiles(foe(enemy)), walks - 2, "doubled weight: 10 feet slower");
      // Halved on the next turn: the doubling goes as the halving lands.
      kit.freshTurn();
      assert.equal((await spend(gra(), "Adjust Density", { targetEnemyId: enemy.id, variant: "halve" })).ok, true);
      assert.deepEqual(density(foe(enemy).conditions), ["adjusted density (lighter)"], "halved, no longer doubled");
      assert.equal(enemySpeedTiles(foe(enemy)), walks + 2, "halved weight: 10 feet faster");
      // Two creatures named, and a creature that is not there: nothing spent.
      kit.freshTurn();
      const before = JSON.stringify([foe(enemy).conditions, sheet(friend()).conditions, sheet(gra()).conditions]);
      const both = await spend(gra(), "Adjust Density", { targetEnemyId: enemy.id, targetCharacterId: friend().id, variant: "heavier" });
      assert.equal(both.ok, false, "a foe and an ally named together");
      assert.match(both.error, /Nothing was spent/);
      assert.equal((await spend(gra(), "Adjust Density", { targetEnemyId: "nobody-here", variant: "heavier" })).ok, false, "a creature that is not in the fight");
      assert.equal(JSON.stringify([foe(enemy).conditions, sheet(friend()).conditions, sheet(gra()).conditions]), before, "a refusal lays nothing");
      assert.equal(budget()?.actionUsed ?? false, false, "a refusal spends no action");
      // No creature named: the wizard's own weight.
      assert.equal((await spend(gra(), "Adjust Density", { variant: "double" })).ok, true);
      assert.deepEqual(density(sheet(gra()).conditions), ["adjusted density (heavier)"]);
      world.patch(gra().id, { conditions: [], conditionMeta: {} });
      // Any buff: a sorcerer's own wings named for a foe, or for a friend, were
      // laid on the sorcerer; now refused, the bonus action unspent.
      const soul = holder("sorcerer", "Divine Soul");
      await stage(soul, { others: [friend()] });
      const [other] = world.enemies().filter((entry) => entry.status === "alive");
      for (const stray of [{ targetEnemyId: other.id }, { targetCharacterId: friend().id }]) {
        const wings = await spend(soul, "Otherworldly Wings", stray);
        assert.equal(wings.ok, false, `Otherworldly Wings with ${Object.keys(stray)[0]}: ${show(wings).slice(0, 120)}`);
        assert.match(wings.error, /Nothing was spent/);
        assert.deepEqual([sheet(soul).conditions.includes("otherworldly wings"), budget()?.bonusUsed ?? false], [false, false], "[winged, bonus action spent] after the refusal");
      }
      assert.equal((await spend(soul, "Otherworldly Wings")).ok, true, "with no target it is theirs");
      world.patch(soul.id, { conditions: [], conditionMeta: {} });
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
      // A player's weapon hit is also offered on the card it waits on, from
      // the after-the-roll table (scripts/test-enforce-after-roll-table.mjs
      // runs the card, the spend and the damage).
      const logic = await import("../../src/lib/dm/after-roll-logic.ts");
      rig.refill(gra());
      const d20 = (value) => ({ expression: "1d20+5", total: value + 5, natural: value, terms: [{ kind: "dice", sign: 1, count: 1, sides: 20, dice: [{ sides: 20, value, kept: true }], subtotal: value }, { kind: "modifier", sign: 1, value: 5 }] });
      const offer = (value, weapon) => logic.hitHelperOption(sheet(gra()), "violent_attraction", { outcome: d20(value), ac: 15, critRange: 20, weapon }, "the fighter");
      assert.match(offer(12, true)?.label ?? "", /1d10/, "a weapon attack that hits");
      assert.equal(offer(12, false), null, "an attack that is not a weapon's");
      assert.equal(offer(3, true), null, "a miss");
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
    // "manifest your spellbook's mind as a Tiny spectral object within 60
    // feet that sheds dim light in 10 feet ... and moves up to 30 feet when
    // you use a bonus action": a token on the board (src/lib/dm/scribe-mind.ts).
    "mind-object": async () => {
      const { listTokens } = await import("../../src/lib/db/battle-maps.ts");
      await stage(scr());
      const mind = () => listTokens(kit.map().id).find((token) => token.refId === `mind:${scr().id}`);
      assert.equal(mind(), undefined);
      const far = await spend(scr(), "Manifest Mind", { x: 5 + 13, y: 5 });
      assert.equal(far.ok, false, "65 feet off is beyond the 60");
      const out = await spend(scr(), "Manifest Mind", { x: 5 + 12, y: 5 });
      assert.equal(out.ok, true, out.error);
      assert.ok(mind(), "nothing stands on the board for the mind: no token, no zone, no light, nothing to be within 60 or 300 feet of");
      assert.deepEqual([mind().x, mind().y, mind().lightRadius ?? 0, mind().lightDimRadius], [17, 5, 0, 2], "at the square named, dim light in 10 feet");
      // Its move takes the bonus action: refused with it spent, then moved 30 feet on a fresh turn.
      assert.equal((await call("move_token", { token: mind().name, x: 17, y: 6 })).ok, false, "the manifesting took the bonus action");
      kit.saveEncounter({ ...world.encounter(), turnBudget: null });
      kit.freshTurn();
      assert.equal((await call("move_token", { token: mind().name, x: 17, y: 5 + 7 })).ok, false, "35 feet is beyond the 30");
      const moved = await call("move_token", { token: mind().name, x: 17, y: 5 + 6 });
      assert.equal(moved.ok, true, moved.error);
      assert.equal(budget().bonusUsed, true, "the move is a bonus action");
    },
    // "While it is manifested you can cast a wizard spell from its space":
    // Shocking Grasp on a creature 40 feet off reaches from the mind beside
    // it, for one use of Manifest Mind casting; a bare spend of that use is
    // refused, as the server spends it with the spell.
    "mind-casts-from": async () => {
      const [enemy] = await stage(scr());
      kit.place(scr().id, 1, 5);
      kit.place(enemy.id, 9, 5);
      const before = counter(scr(), "sub_manifest_mind_casts")?.used ?? 0;
      const touch = () => call("pc_attack", { characterId: scr().id, targetEnemyId: enemy.id, spell: "Shocking Grasp" }, [15, 4]);
      assert.equal((await touch()).ok, false, "no mind out: the touch spell does not reach 40 feet");
      assert.equal((await spend(scr(), "Manifest Mind casting")).ok, false, "a bare spend is refused");
      const out = await spend(scr(), "Manifest Mind", { x: 8, y: 5 });
      assert.equal(out.ok, true, out.error);
      const cast = await touch();
      assert.equal(cast.ok, true, `cast from the mind's space: ${show(cast).slice(0, 200)}`);
      assert.equal(counter(scr(), "sub_manifest_mind_casts")?.used, before + 1, "one use of Manifest Mind casting is spent");
    },
    "mind-casts": uses(["wizard", "Order of Scribes"], "sub_manifest_mind_casts", { 6: prof(6), 20: prof(20) }),
    "mind-free": async () => {
      await uses(["wizard", "Order of Scribes"], "sub_manifest_mind", { 6: 1 })();
      await mindRest();
    },
    "mind-slot": buysAnother(["wizard", "Order of Scribes"], "Manifest Mind", "sub_manifest_mind", "spell slot"),
    // The spend writes a scroll of the spell named onto the pack; reading it
    // casts the spell one level higher (Scorching Ray's fourth ray at 3rd
    // level, the Spell Scroll table's +7 for that level) and uses it up; one
    // left unread is gone after a long rest. A spell above 2nd level, one not
    // in the book, one cast with a reaction, no spell named, a second scroll
    // with the use spent, and a scroll in the middle of a fight are refused.
    scrivener: async () => {
      const who = scr();
      const { vanished: _old, ...casting } = sheet(who).spellcasting;
      void _old;
      world.patch(who.id, { spellcasting: { ...casting, prepared: SCRIBE_BOOK, known: SCRIBE_BOOK } });
      const scrolls = () => sheet(who).equipment.filter((item) => item.conjured?.kind === "scroll");
      const uses = () => counter(who, "sub_master_scrivener").used;
      const write = (variant) => spend(who, "Master Scrivener", variant ? { variant } : {});
      const [enemy] = await stage(who);
      const fighting = await write("Magic Missile");
      assert.equal(fighting.ok, false, "a scroll written in the middle of a fight");
      await kit.endFight();
      rig.refill(who);
      for (const [why, variant] of [["a 3rd-level spell", "Fireball"], ["a spell not in the book", "Burning Hands"], ["a spell cast with a reaction", "Shield"], ["no spell named", ""]]) {
        const out = await write(variant);
        assert.equal(out.ok, false, `${why}: ${show(out).slice(0, 120)}`);
        assert.match(out.error, /Nothing was spent/, why);
      }
      assert.deepEqual([uses(), scrolls().length], [0, 0], "[uses spent, scrolls] after the refusals");
      const out = await write("Scorching Ray");
      assert.equal(out.ok, true, out.error);
      const [scroll] = scrolls();
      assert.deepEqual([uses(), scroll?.spell, scroll?.tags], [1, "Scorching Ray", ["scroll"]], "[uses spent, the scroll's spell, its tags]");
      assert.equal((await write("Magic Missile")).ok, false, "a second scroll before the next long rest");
      // Read in a fight: an action, no slot, cast at 3rd level.
      const [foe2] = await stage(who);
      const slots = JSON.stringify(sheet(who).spellcasting.slots);
      const read = await call("use_item", { characterId: who.id, item: scroll.name });
      assert.equal(read.ok, true, read.error);
      assert.deepEqual([read.result.spellCast, read.result.spellLevel, read.result.attackBonus, budget().actionUsed], ["Scorching Ray", 3, 7, true], "[spell, level it is cast at, the scroll's attack bonus, the action]");
      assert.equal(scrolls().length, 0, "the scroll is used up as it is read");
      // Four rays at 3rd level, where its own 2nd gives three.
      let rays = 0;
      for (let ray = 0; ray < 5; ray += 1) {
        const shot = await call("pc_attack", { characterId: who.id, targetEnemyId: foe2.id, spell: "Scorching Ray" }, [15, 3, 3]);
        if (!shot.ok) break;
        rays += 1;
      }
      assert.equal(rays, 4, "rays of a Scorching Ray read from the scrivener's scroll");
      assert.equal(JSON.stringify(sheet(who).spellcasting.slots), slots, "no spell slot of the reader's is spent");
      void enemy;
      // A scroll left unread vanishes when the wizard finishes a long rest.
      await kit.endFight();
      assert.equal((await call("pass_time", { amount: 1, unit: "days" })).ok, true);
      await rig.rest("long");
      assert.equal((await write("Magic Missile")).ok, true, "a new scroll after the long rest");
      assert.equal(scrolls().length, 1);
      assert.equal((await call("pass_time", { amount: 1, unit: "days" })).ok, true);
      await rig.rest("long");
      assert.equal(scrolls().length, 0, "the unread scroll after the next long rest");
      assert.equal((await call("pass_time", { amount: 1, unit: "days" })).ok, true);
    },
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
    // The price is taken from the book: spells of the 3d6's total in levels
    // leave it (prepared and known alike), held on the sheet with the 1d6 long
    // rests rolled then; they cannot be cast meanwhile; each long rest counts
    // one off and the last writes them back; the wizard may name the spells
    // that go first; and a book that cannot pay keeps its spells and drops
    // the wizard to 0 hit points.
    "word-vanish": async () => {
      const book = () => {
        const now = sheet(scr()).spellcasting;
        return { prepared: now.prepared, known: now.known, gone: (now.vanished ?? []).map((entry) => `${entry.spell} for ${entry.rests}`) };
      };
      const staged = async (spells) => {
        await hit(scr());
        const { vanished: _old, ...casting } = sheet(scr()).spellcasting;
        void _old;
        world.patch(scr().id, { conditions: ["manifest mind"], spellcasting: { ...casting, prepared: spells, known: spells } });
      };
      // 3d6 of 1 each (3 levels), then a 2 on the d6: Fireball (3rd) pays alone.
      await staged(["Fireball", "Fly", "Shield"]);
      const out = await react(scr(), "One with the Word", {}, [1, 1, 1, 2]);
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(book(), { prepared: ["Fly", "Shield"], known: ["Fly", "Shield"], gone: ["Fireball for 2"] }, `the book after a 3 on the 3d6 and a 2 on the d6: ${show(out).slice(0, 200)}`);
      kit.giveTurn(scr().id);
      kit.freshTurn();
      const cast = await call("use_spell_slot", { characterId: scr().id, spell: "Fireball" });
      assert.equal(cast.ok, false, "a vanished spell is cast");
      // One long rest: still gone, one rest left. A day on, the second: back.
      // (A long rest counts once in 24 hours, so a day passes before each.)
      const day = async () => assert.equal((await call("pass_time", { amount: 1, unit: "days" })).ok, true);
      await kit.endFight();
      await day();
      await rig.rest("long");
      assert.deepEqual(book().gone, ["Fireball for 1"], "after one of its two long rests");
      assert.ok(!book().prepared.includes("Fireball"), "back a rest early");
      await day();
      await rig.rest("long");
      await day();
      assert.deepEqual(book(), { prepared: ["Fly", "Shield", "Fireball"], known: ["Fly", "Shield", "Fireball"], gone: [] }, "after the second long rest it is written back");
      // The spells named go first: a 4 (1 + 1 + 2) takes Shield (1st) and Fly (3rd).
      await staged(["Fireball", "Fly", "Shield"]);
      const named = await react(scr(), "One with the Word", { variant: "Shield, Fly" }, [1, 1, 2, 3]);
      assert.equal(named.ok, true, named.error);
      assert.deepEqual(book(), { prepared: ["Fireball"], known: ["Fireball"], gone: ["Shield for 3", "Fly for 3"] }, "the spells the wizard named");
      // A book of one 1st-level spell cannot pay a 3: it keeps the spell, and
      // the wizard, whose damage was prevented, drops to 0 hit points.
      await staged(["Shield"]);
      const short = await react(scr(), "One with the Word", {}, [1, 1, 1, 6]);
      assert.equal(short.ok, true, short.error);
      assert.deepEqual([sheet(scr()).currentHp, sheet(scr()).conditions.includes("unconscious"), book().prepared, book().gone], [0, true, ["Shield"], []], `[hit points, unconscious, the book, gone] when the book cannot pay: ${show(short).slice(0, 200)}`);
      const { vanished: _gone, ...casting } = sheet(scr()).spellcasting;
      void _gone;
      world.patch(scr().id, { conditions: [], conditionMeta: {}, deathSaves: null, spellcasting: { ...casting, prepared: SCRIBE_BOOK, known: SCRIBE_BOOK } });
      rig.refill(scr());
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
  };
  return { PROBES, KNOWN };
}

// A module loaded on first use and kept.
function await0(load) {
  let seen = null;
  return () => (seen ??= load());
}
