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
  rig.outfit("wizard", "War Magic", { spells: ["Magic Missile", "Hold Person", "Counterspell"], acOverride: false });
  rig.outfit("wizard", "Bladesinging", { spells: ["Fire Bolt", "Hold Person"], cantrips: ["Fire Bolt"], equipment: [{ name: "Rapier", qty: 1, equipped: true }], acOverride: false });
  const war = () => holder("wizard", "War Magic");
  const bla = () => holder("wizard", "Bladesinging");
  const chr = () => holder("wizard", "Chronurgy Magic");
  const gra = () => holder("wizard", "Graviturgy Magic");
  const scr = () => holder("wizard", "Order of Scribes");
  const condition = await0(() => import("../../src/lib/dm/condition-logic.ts"));
  const training = await0(() => import("../../src/lib/srd/subclass-training.ts"));
  const speedOf = async (who) => (await condition()).effectiveSpeed(sheet(who).conditions, rig.srd.speedFor(sheet(who)));
  const d20s = (out) => out.rolled.filter((die) => die.sides === 20).length;
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
      await stage(war(), { others: [friend()], first: friend() });
      // DEX save: a 9 on the die is 11 against DC 14, and +4 makes it 15.
      const failed = await roll(war(), { kind: "saving_throw", ability: "dex", dc: 14 }, [9]);
      assert.equal(failed.out.result?.success, false);
      const out = await react(war(), "Arcane Deflection", { variant: "save" });
      assert.equal(out.ok, true, `after a failed save: ${String(out.error).slice(0, 170)}`);
    },
    "deflection-cost": async () => {
      const [enemy] = await hit(war());
      assert.equal((await react(war(), "Arcane Deflection")).ok, true);
      kit.giveTurn(war().id);
      kit.freshTurn();
      const cast = await call("cast_at_enemy", { characterId: war().id, targetEnemyId: enemy.id, spell: "Magic Missile" }, [4, 4, 4]);
      assert.equal(cast.ok, false, "on the turn after Arcane Deflection, a 1st-level spell is cast");
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
    "deflecting-shroud": async () => {
      const [enemy] = await hit(war());
      const before = foe(enemy).currentHp;
      assert.equal((await react(war(), "Arcane Deflection")).ok, true);
      assert.equal(before - foe(enemy).currentHp, 10, "force damage to the creature beside a 20th-level war mage who used Arcane Deflection");
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
      const [enemy] = await stage(bla());
      assert.equal((await kit.swing(bla().id, enemy.id, [15, 4], { weapon: "Rapier" })).ok, true);
      const bolt = await call("pc_attack", { characterId: bla().id, targetEnemyId: enemy.id, spell: "Fire Bolt" }, [15, 5, 5, 5, 5]);
      assert.equal(bolt.ok, true, `Fire Bolt as the second attack of the action: ${String(bolt.error).slice(0, 170)}`);
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
      await rig.table.strike(enemy, chr());
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
    "deflection-save": { severity: "medium", kind: "rule-missing", where: `${DATA} wizard::Arcane Deflection (one reaction, ac_vs_hit; no half for a failed save)`, note: "Half of the feature has no door: a failed save cannot be answered.", fix: "A second reaction on the row that adds 4 to the save just failed (the after-roll card's shape)." },
    "deflection-cost": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/cast-guard.ts (nothing marks the war mage after Arcane Deflection)", note: "The reaction is free of its price: a full spell the turn after.", fix: "Lay a mark until the end of the wizard's next turn that refuses any spell but a cantrip." },
    "surge-long-rest": { severity: "medium", kind: "rule-wrong", where: `${RES} sub_power_surge (a plain counter refilled whole by a long rest)`, note: "A long rest hands a war mage their Intelligence modifier in surges where the text gives one.", fix: "After a long rest set the counter to one surge held." },
    "surge-short-rest": { severity: "low", kind: "rule-missing", where: "src/lib/dm/rest-tools.ts (a short rest gives no surge to a war mage holding none)", note: "", fix: "Give one surge at the end of a short rest begun with none." },
    "surge-counterspell": { severity: "low", kind: "rule-missing", where: "src/lib/dm/reaction-tools.ts Counterspell and the Dispel Magic path (no surge gained)", note: "", fix: "Give a surge, up to the maximum, when the holder's Counterspell or Dispel Magic ends a spell." },
    "deflecting-shroud": { severity: "medium", kind: "rule-missing", where: `${DATA} wizard::Deflecting Shroud (narrated: "the GM applies it with apply_damage")`, note: "A number (half the wizard level, force, three creatures, 60 feet) the engine has every fact for at the moment Arcane Deflection resolves.", fix: "Deal it from the Arcane Deflection reaction to up to three chosen creatures in 60 feet." },
    "bladesong-acrobatics": { severity: "medium", kind: "rule-missing", where: "src/lib/srd/condition-effects.ts bladesong (acBonusAbility and speedBonus only; its summary names the advantage and nothing rolls it)", note: "", fix: "Give the bladesong condition advantage on Dexterity (Acrobatics) checks." },
    "bladesong-concentration": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/concentration.ts (the bladesong's bonus to the save is not read)", note: "The stored text gives no number (\"a concentration-save bonus\"); the feature it condenses adds the Intelligence modifier.", fix: "Add the Intelligence modifier to a bladesinger's concentration saves, and state it in the text." },
    "bladesinger-cantrip": { severity: "medium", kind: "rule-missing", where: "src/lib/dm/pc-attack*.ts and src/lib/dm/cast-guard.ts (\"Extra Attack gives more weapon attacks, not a second casting\")", note: "The refusal's own words deny the 6th-level feature.", fix: "For a holder of the Bladesinging Extra Attack, let one attack of the Attack action be a cantrip with a casting time of an action." },
    abeyance: { severity: "low", kind: "rule-missing", where: `${RES} sub_arcane_abeyance (a counter with guidance)`, note: "Nothing holds the bead or the spell in it.", fix: "An item on the sheet (as use_spell_slot's storeIn does for a Ring of Spell Storing)." },
    "convergent-range": { severity: "low", kind: "rule-wrong", where: `${DATA} wizard::Convergent Future (force_miss with no rangeFt)`, note: "", fix: "Give the reaction rangeFt 60." },
    "convergent-other-rolls": { severity: "medium", kind: "rule-missing", where: `${DATA} wizard::Convergent Future (force_miss: a hit made a miss, and nothing else)`, note: "The feature turns any attack roll, ability check or saving throw within 60 feet into a success or a failure; the engine holds one of those six cases.", fix: "Offer it on the after-roll card for an ally's failed save or check and a foe's passed save." },
    "density-enemy": { severity: "medium", kind: "rule-wrong", where: `${DATA} wizard::Adjust Density (buff target "ally"), src/lib/dm/authored-spend-effects.ts (a targetEnemyId the buff cannot use falls back to the holder)`, note: "The wizard meant to slow a foe and is told they have slowed themselves; the action is spent.", fix: "Let the buff take a creature of either side, and refuse a target it cannot use instead of falling back to the holder." },
    "horizon-slot": { severity: "low", kind: "rule-missing", where: `${RES} sub_event_horizon (its guidance says "A spell slot of 3rd level or higher buys extra uses"; resource-tools.ts has no such purchase)`, note: "", fix: "With the use spent, take a slot of 3rd level or higher instead." },
    "mind-object": { severity: "low", kind: "rule-missing", where: `${RES} sub_manifest_mind (fx buff: a condition on the wizard)`, note: "The 60 feet, the 300 feet, its light and its sight have nothing to be measured from.", fix: "A token or zone for the mind, moved with the wizard's bonus action." },
    "mind-slot": { severity: "medium", kind: "rule-missing", where: `${RES} sub_manifest_mind (uses 1; its guidance says "a spell slot of any level buys another manifestation")`, note: "", fix: "With the use spent, take a slot of any level instead." },
    scrivener: { severity: "low", kind: "rule-missing", where: `${RES} sub_master_scrivener (a counter with guidance)`, note: "No scroll is made; the +1 level casting has nothing to ride.", fix: "Write a scroll onto the sheet that the cast tools read one level higher and a long rest removes." },
    "word-arcana": { severity: "medium", kind: "rule-missing", where: `${RES} sub_one_with_the_word (the reaction only); no check_adv effect for wizard::One with the Word`, note: "A passive advantage with no hook at all.", fix: "An authored effect check_adv skills [arcana]." },
    "word-vanish": { severity: "low", kind: "rule-missing", where: "src/lib/dm/reaction-counters.ts One with the Word (the price is told, not taken)", note: "The reaction prevents the damage for free.", fix: "Roll the 3d6 and mark spells of that many levels as gone until 1d6 long rests pass." },
  };
  return { PROBES, KNOWN };
}

// A module loaded on first use and kept.
function await0(load) {
  let seen = null;
  return () => (seen ??= load());
}
