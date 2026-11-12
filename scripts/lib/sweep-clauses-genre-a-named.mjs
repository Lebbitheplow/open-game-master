// The probes of the genre-a clause ledger that one feature, or one family of
// features, needs: the typed rows of src/lib/srd/authored-effects-genre.ts,
// the counters of src/lib/classes/resources.json that carry an fx, and the
// passive promises no generic probe can stage. Same contract as the generic
// ones in sweep-clauses-genre-a-probes.mjs.
import assert from "node:assert/strict";
import { mod, prof, must, eq } from "./sweep-clauses-genre-a.mjs";
import { TRAINED } from "./enforce-combat.mjs";

const SRC = new URL("../../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const key = (name) => name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
const slug = (name) => key(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const SKILL_ABILITY = { stealth: "dex", investigation: "int", persuasion: "cha", athletics: "str", arcana: "int", history: "int" };
const CASTING = { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, known: ["Magic Missile", "Healing Word"], prepared: ["Magic Missile", "Healing Word"], cantrips: ["Fire Bolt"] };

const spendOn = (t, scene, resource, args = {}) => t.world.invoke("use_resource", { characterId: scene.holder.id, resource, ...args });
async function spendAny(t, scene, resource) {
  const errors = [];
  for (const args of [{}, { targetCharacterId: scene.ally.id }, { targetEnemyId: scene.near.id }]) {
    const out = await spendOn(t, scene, resource, args);
    if (out.ok) return { out, args };
    errors.push(out.error);
  }
  return { out: { ok: false, error: errors.join(" / ") }, args: null };
}
async function swing(t, scene, target, faces = [15, 4, 3, 3, 3, 3, 3, 3]) {
  const before = t.foeHp(target.id);
  const out = await t.kit.swing(scene.holder.id, target.id, faces);
  must(out, "the staged attack");
  if (out.result.hit === false) throw new Error(`the staged attack missed: ${JSON.stringify(out.result).slice(0, 300)}`);
  return { ...out, loss: before - t.foeHp(target.id) };
}
const flush = (t) => {
  t.world.clearDice();
  t.world.diceLog();
};
const thrown = (t, sides) => t.world.diceLog().filter((die) => die.sides === sides).length;
const conditionsOf = (t, id) => t.world.sheet(id).conditions.map((entry) => entry.toLowerCase());
const casterOf = async (t, feature) => (await load("lib/classes/index.ts")).findCustomClass(feature.classId)?.spellAbility ?? "int";

export const NAMED = {
  // A check the text gives advantage, a die, a flat bonus or doubled proficiency.
  async check(t, run, feature) {
    t.fresh();
    const level = run.level ?? feature.level;
    const hero = t.hero(feature.classId, level, { proficiencies: { ...TRAINED, skills: [run.skill] } });
    if (run.hp) t.world.patch(hero.id, { currentHp: run.hp });
    flush(t);
    t.world.dice(10, 17, 3);
    const out = must(await t.world.invoke("request_roll", { characterId: hero.id, kind: "skill_check", skill: run.skill, dc: 10, reason: "a probe" }), "the check");
    t.world.clearDice();
    const log = t.world.diceLog();
    const base = 10 + mod(SKILL_ABILITY[run.skill]) + prof(level);
    if (run.want === "adv") eq(log.filter((die) => die.sides === 20).length, 2, `d20s thrown for the ${run.skill} check`);
    if (run.want === "d4") eq(log.filter((die) => die.sides === 4).length, 1, `d4s added to the ${run.skill} check`);
    if (run.want === "double") eq(out.result.total, base + prof(level), `the ${run.skill} check on a 10 with doubled proficiency`);
    if (run.want === "flat") eq(out.result.total, base + run.n, `the ${run.skill} check on a 10`);
  },

  // The text limits a use and the sheet tracks no counter for it.
  async limit_tracked(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, feature.level);
    const ids = Object.keys(hero.resources ?? {});
    assert.ok(ids.some((id) => id.endsWith(slug(feature.name))), `the text limits its use and a level ${feature.level} ${feature.classId} holds no counter for it (it holds ${ids.join(", ") || "none"})`);
  },

  // An ability a player declares, with no counter: some call must play it.
  async no_door(t, run, feature) {
    const scene = await t.stage(feature);
    const before = t.reader.snapshot();
    const { out } = await spendAny(t, scene, key(feature.name));
    eq(out.ok, true, `no call plays it: use_resource answers "${String(out.error).slice(0, 160)}"`);
    const moved = t.readChanges(scene, t.reader.diff(before, t.reader.snapshot()));
    assert.ok(moved.effects.length > 0, "the call was accepted and nothing but the turn's cost moved");
  },

  // Does any engine table answer to the feature at all: feature effects, the
  // authored rows, a counter. Used where the clause itself could not be staged.
  async hook(t, run, feature) {
    const fx = await load("lib/srd/feature-effects.ts");
    t.fresh();
    const hero = t.hero(feature.classId, feature.level);
    const sheet = t.world.sheet(hero.id);
    const typed = fx.effectsFor({ class: sheet.class, features: sheet.features, campaignId: sheet.campaignId }).some((entry) => key(entry.feature) === key(feature.name) && entry.effect.kind !== "narrative");
    const row = t.authored.heldAuthored(sheet).some((entry) => key(entry.name) === key(feature.name));
    const counter = Object.keys(sheet.resources ?? {}).some((id) => id.endsWith(slug(feature.name)));
    assert.ok(typed || row || counter, "no engine table answers to the feature (feature effects, authored rows, counters): its text reaches the GM's prompt and nothing else");
  },

  // What the feature adds to a damaging spell: Fire Bolt with and without it.
  async spell_dmg(t, run, feature) {
    const ability = await casterOf(t, feature);
    const scene = await t.stage(feature, { level: run.level, lane: true, extra: { equipment: [], spellcasting: { ...CASTING, ability } } });
    const cast = async () => {
      const before = t.foeHp(scene.far.id);
      flush(t);
      const out = await t.kit.swing(scene.holder.id, scene.far.id, [run.face ?? 15, 3, 3, 3, 3, 3, 3, 3, 3], { spell: "Fire Bolt" });
      must(out, "the Fire Bolt");
      if (out.result.hit === false) throw new Error(`the staged Fire Bolt missed: ${JSON.stringify(out.result).slice(0, 300)}`);
      return { out, loss: before - t.foeHp(scene.far.id) };
    };
    if (run.crit) {
      t.kit.setEnemy(scene.far.id, { stats: { type: "construct" } });
      const { out } = await cast();
      eq(out.result.crit === true, true, "a 19 on the die against a construct is a critical hit");
      return;
    }
    const withIt = await cast();
    const features = t.world.sheet(scene.holder.id).features.filter((entry) => key(entry.name) !== key(feature.name));
    t.world.patch(scene.holder.id, { features });
    t.kit.giveTurn(scene.holder.id);
    const without = await cast();
    const want = run.dice ? run.dice * 3 : mod(run.ability);
    eq(withIt.loss - without.loss, want, `damage ${feature.name} adds to a Fire Bolt (${withIt.loss} with it, ${without.loss} without)`);
  },

  // ---- marks: Target Lock, Hunter's Brand, Quarry ----
  async mark(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    t.kit.place(scene.far.id, 4, 6);
    const plain = await swing(t, scene, scene.far);
    t.kit.giveTurn(scene.holder.id);
    must(await spendOn(t, scene, run.res, { targetEnemyId: scene.near.id }), `marking with ${run.res}`);
    const marked = await swing(t, scene, scene.near);
    if (run.other) {
      t.kit.giveTurn(scene.holder.id);
      const other = await swing(t, scene, scene.far);
      eq(other.loss, plain.loss, "a hit on a creature that is not marked");
      return;
    }
    eq(marked.loss - plain.loss, run.flat ?? run.dice * 3, `what the mark adds to a hit (${marked.loss} marked, ${plain.loss} unmarked)`);
    if (run.sides) {
      const terms = String(marked.damage?.expression ?? "").match(new RegExp(`\\d*d${run.sides}\\b`, "g")) ?? [];
      const dice = terms.reduce((sum, term) => sum + Number(term.split("d")[0] || 1), 0);
      eq(dice, run.dice + (run.sides === 8 ? 1 : 0), `d${run.sides}s in the damage roll ${marked.damage?.expression}`);
    }
  },
  // "a creature you can see": marking a foe the holder cannot see (it is
  // invisible) is refused, and nothing is laid.
  async mark_sight(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    t.kit.setEnemy(scene.near.id, { conditions: ["invisible"] });
    const out = await spendOn(t, scene, run.res, { targetEnemyId: scene.near.id });
    // The control: the same call on the same creature once it is seen goes
    // through, so a refusal above is about sight and not the call's shape.
    const accepted = out.ok;
    if (!accepted) {
      t.kit.setEnemy(scene.near.id, { conditions: [] });
      t.kit.giveTurn(scene.holder.id);
      must(await spendOn(t, scene, run.res, { targetEnemyId: scene.near.id }), `${run.res} on the same creature once seen`);
    }
    eq(accepted, false, `${run.res} on an invisible creature the holder cannot see was accepted`);
  },
  async mark_ends(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    must(await spendOn(t, scene, run.res, { targetEnemyId: scene.near.id }), `marking with ${run.res}`);
    if (!conditionsOf(t, scene.holder.id).includes(run.res.toLowerCase())) throw new Error(`the mark is not on the holder as "${run.res.toLowerCase()}"`);
    t.kit.setEnemy(scene.near.id, { currentHp: 1 });
    await swing(t, scene, scene.near);
    assert.ok(!conditionsOf(t, scene.holder.id).includes(run.res.toLowerCase()), "the mark is still held after the marked creature died");
  },
  async two_marks(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    t.kit.place(scene.far.id, 4, 6);
    must(await spendOn(t, scene, run.res, { targetEnemyId: scene.near.id }), "the first mark");
    t.kit.giveTurn(scene.holder.id);
    const second = await spendOn(t, scene, run.res, { targetEnemyId: scene.far.id });
    eq(second.ok, true, `the second mark: ${second.error}`);
    t.kit.giveTurn(scene.holder.id);
    const first = await swing(t, scene, scene.near);
    t.kit.giveTurn(scene.holder.id);
    const other = await swing(t, scene, scene.far);
    const riders = (roll) => (String(roll.damage?.expression ?? "").match(/\d*d\d+/g) ?? []).length;
    assert.ok(riders(first) >= 2 && riders(other) >= 2, `both marked creatures take the rider (damage rolls ${first.damage?.expression} and ${other.damage?.expression})`);
  },

  // ---- reactions ----
  async ice(t, run, feature) {
    const scene = await t.stage(feature);
    if (run.part === "ac") {
      await t.clubs(scene, scene.holder, 9, 4);
      must(await t.world.invoke("use_reaction", { characterId: scene.holder.id, feature: "ICE Pick" }), "ICE Pick against a 13");
      eq(t.hp(scene.holder.id), 100, "a 13 against AC 12 + 2 misses, and the hit points come back");
      return;
    }
    await t.clubs(scene, scene.holder, 16, 4);
    const out = await t.world.invoke("use_reaction", { characterId: scene.holder.id, feature: "ICE Pick" });
    eq(out.ok, false, "ICE Pick answered a club, which is neither a program nor a spell");
  },
  async strike_back(t, run, feature) {
    const scene = await t.stage(feature);
    await t.clubs(scene, scene.holder, 16, 4);
    if (run.spell) {
      // "when a creature damages you with a spell": the club is no spell, and
      // is refused with nothing spent; then the foe's spell burns the holder
      // (cast_at_player, a failed save: the record the reaction answers,
      // src/lib/dm/last-save.ts noteSaveDamage).
      const club = await t.world.invoke("use_reaction", { characterId: scene.holder.id, feature: run.feature });
      eq(club.ok, false, `${run.feature} answered a club, which is no spell`);
      t.kit.setEnemy(scene.near.id, { stats: { ...t.kit.enemy(scene.near.id).stats, spellcasting: { dc: 14, attack: 6, ability: "int", slots: { 1: 2 }, spells: [{ name: "Burning Hands", level: 1 }] } } });
      t.kit.freshRound();
      t.world.clearDice();
      t.world.dice(1, 3, 3, 3);
      const cast = await t.world.invoke("cast_at_player", { characterId: scene.holder.id, casterEnemyId: scene.near.id, spell: "Burning Hands" });
      t.world.clearDice();
      must(cast, "the foe's staged Burning Hands");
    }
    const before = t.foeHp(scene.near.id);
    must(await t.world.invoke("use_reaction", { characterId: scene.holder.id, feature: run.feature }), run.feature);
    const want = run.amount === "cha" ? mod("cha") : mod("cha") + feature.level;
    eq(before - t.foeHp(scene.near.id), want, "damage dealt back");
  },
  async ally_hit(t, run, feature) {
    const scene = await t.stage(feature);
    if (run.far) {
      t.kit.place(scene.ally.id, 5 + run.far / 5, 5);
      t.kit.place(scene.near.id, 5 + run.far / 5, 6);
    }
    await t.clubs(scene, scene.ally, 16, run.die ?? 4);
    const out = await t.world.invoke("use_reaction", { characterId: scene.holder.id, feature: run.feature, targetCharacterId: scene.ally.id });
    if (run.far) {
      eq(out.ok, false, `${run.feature} answered a hit on an ally ${run.far} feet away`);
      return;
    }
    must(out, run.feature);
    if (run.ally !== undefined) eq(t.hp(scene.ally.id), run.ally === "prof+cha" ? 20 - Math.max(0, (run.die ?? 4) + 2 - (mod("cha") + prof(feature.level))) : run.ally, "the ally's hit points after the reaction");
    if (run.holder !== undefined) eq(100 - t.hp(scene.holder.id), run.holder, "hit points the holder lost");
  },

  // ---- counters with an fx ----
  async heal(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level, hp: run.hp ?? 40 });
    const target = run.target === "self" ? scene.holder : scene[run.target];
    const conditions = run.conditions ? String(run.conditions).split("|") : [];
    if (conditions.length) t.world.patch(target.id, { conditions });
    if (run.feet) t.kit.place(target.id, 5 + run.feet / 5, 5);
    const before = t.hp(target.id);
    const tempBefore = t.world.sheet(target.id).tempHp;
    const acBefore = t.srd.effectiveAcFor(t.world.sheet(target.id));
    flush(t);
    t.world.dice(...new Array(run.dice ?? 0).fill(run.face ?? 3));
    let out = await spendOn(t, scene, run.id, run.target === "self" ? {} : { targetCharacterId: target.id });
    if (!out.ok && run.target === "self") out = await spendOn(t, scene, run.id, { targetCharacterId: target.id });
    t.world.clearDice();
    if (run.refused) {
      eq(out.ok, false, `${run.id} was accepted (${run.refused})`);
      return;
    }
    if (run.accepted) {
      eq(out.ok, true, `${run.id}: ${out.error}`);
      return;
    }
    // The spend on the creature healed is what the clause asks for, not the
    // probe's staging: a refusal of it is the engine not doing what the text
    // says (Master of the Black Ledger's "full HP restored" on an ally is
    // refused, its counter knowing only the save), so it is asserted.
    eq(out.ok, true, `spending ${run.id} on the ${run.target === "self" ? "holder" : run.target}: ${out.error}`);
    const after = t.world.sheet(target.id);
    if (run.want === "temp") assert.ok(after.tempHp > tempBefore, "temporary hit points on the healed ally");
    else if (run.want === "ac") eq(t.srd.effectiveAcFor(after) - acBefore, 2, "what the heal added to the ally's armor class");
    else if (run.want === "stands") assert.ok(!after.conditions.map((entry) => entry.toLowerCase()).includes("prone"), "the stimmed ally is still prone");
    else if (run.want === "cured") assert.deepEqual(after.conditions.map((entry) => entry.toLowerCase()).filter((entry) => conditions.includes(entry)), [], "conditions left on the creature touched");
    else if (run.want === "full") eq(after.currentHp, after.maxHp, "the touched creature's hit points");
    else if (run.want === "nobody") assert.ok(after.currentHp === before && t.hp(scene.holder.id) === 40, "it healed a character; the text heals each drone");
    else {
      const die = Math.max(run.face ?? 3, run.floor ?? 0);
      const plus = run.plus === "level10" ? 10 + (run.level ?? feature.level) : run.plus ? mod(run.plus) : 0;
      eq(after.currentHp - before, (run.dice ?? 0) * die + plus, `hit points ${run.id} restored`);
    }
  },
  async ghost(t, run, feature) {
    const scene = await t.stage(feature);
    must((await spendAny(t, scene, "cyberpunk_ghost_protocol")).out, "Ghost Protocol");
    assert.ok(!conditionsOf(t, scene.holder.id).includes("invisible"), "the rigger turned invisible; the text turns one drone invisible");
  },
  async teleport(t, run, feature) {
    const { featureTeleportFeet } = await load("lib/dm/feature-teleport.ts");
    const scene = await t.stage(feature);
    must(await spendOn(t, scene, run.id), `spending ${run.id}`);
    eq(featureTeleportFeet(scene.holder.id, t.resources.resourceDef(run.id).displayName), run.feet, "feet the spend credits to a teleporting move");
  },
  async garden(t, run, feature) {
    const scene = await t.stage(feature);
    const before = t.reader.snapshot();
    const { out } = await spendAny(t, scene, "dark_fantasy_garden_of_grief");
    must(out, "Garden of Grief");
    if (run.part === "slow") {
      assert.ok(t.kit.enemy(scene.near.id).conditions.some((entry) => /slow/i.test(entry)), "no enemy in the garden is slowed");
      return;
    }
    const lasting = t.readChanges(scene, t.reader.diff(before, t.reader.snapshot())).effects.filter((change) => !(change.table === "character_sheets" && /current_hp|temp_hp/.test(change.column)));
    assert.ok(lasting.length > 0, "one heal of 1d6 and nothing that lasts: no zone, no effect on the holder, nothing to tick each turn for a minute");
  },
  async buff(t, run, feature) {
    const scene = await t.stage(feature);
    must(await spendOn(t, scene, run.res), run.res);
    const sheet = t.world.sheet(scene.holder.id);
    assert.ok(conditionsOf(t, scene.holder.id).includes(run.condition), `${run.condition} on the holder`);
    assert.match(JSON.stringify(sheet.conditionMeta?.[run.condition] ?? sheet.conditionMeta), new RegExp(`\\b${run.rounds}\\b`), `${run.rounds} rounds (a minute) on ${run.condition}`);
  },
  async inspire(t, run, feature) {
    const scene = await t.stage(feature);
    const out = must(await spendOn(t, scene, "dark_fantasy_requiem_inspiration", { targetCharacterId: scene.ally.id }), "Requiem Inspiration");
    const ally = t.world.sheet(scene.ally.id);
    const handed = /\b1?(d\d+)\b/.exec(JSON.stringify([out.result.inspiration, out.result, ally.conditionMeta, ally.conditions]))?.[1] ?? "no die";
    eq(handed, run.die, `the die handed to the ally at level ${feature.level}`);
  },

  // ---- passive promises staged by hand ----
  async companion(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, feature.level);
    const sheet = t.world.sheet(hero.id);
    const pets = sheet.pets ?? [];
    assert.ok(pets.length > 0 || sheet.summon, "the sheet holds no companion: no pet, no summon");
    if (run.stats) eq(pets[0]?.ac, 13, "the companion's armor class");
  },
  async apex(t, run, feature) {
    const scene = await t.stage(feature);
    t.kit.setEnemy(scene.near.id, { currentHp: 1 });
    await swing(t, scene, scene.near);
    eq(t.budget().attacksAllowed, 4, "attacks allowed after dropping a foe to 0 (three from Extra Attack and one more)");
  },
  async expertise(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, feature.level, { proficiencies: { ...TRAINED, skills: ["persuasion"], expertise: ["persuasion"] } });
    t.world.dice(10);
    const out = must(await t.world.invoke("request_roll", { characterId: hero.id, kind: "skill_check", skill: "persuasion", dc: 10, reason: "a probe" }), "the check");
    t.world.clearDice();
    eq(out.result.total, 10 + mod("cha") + 2 * prof(feature.level), "a Persuasion check with expertise on a 10");
  },
  async psi_font(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, feature.level, { spellcasting: { ability: "cha", slots: { 1: { max: 3, used: 2 } }, known: [], prepared: [], cantrips: [] } });
    must(await t.world.invoke("take_rest", { kind: "short", characterIds: [hero.id] }), "a short rest");
    eq(t.world.sheet(hero.id).spellcasting.slots["1"].used, 1, "1st-level slots used after the short rest (two were)");
  },
  async surge(t, run, feature) {
    const ability = await casterOf(t, feature);
    const scene = await t.stage(feature, { lane: true, extra: { equipment: [], spellcasting: { ...CASTING, ability } } });
    const id = Object.keys(scene.holder.resources).find((entry) => entry.endsWith(slug(feature.name)));
    must(await t.world.invoke("cast_at_enemy", { characterId: scene.holder.id, targetEnemyId: scene.far.id, spell: "Magic Missile", level: 1 }), "the leveled spell");
    // The surge is declared (use_resource marks the turn), then the cantrip is cast.
    must(await spendOn(t, scene, id), `spending ${id}`);
    const out = await t.kit.swing(scene.holder.id, scene.far.id, [15, 3, 3, 3], { spell: "Fire Bolt" });
    eq(out.ok, true, `the cantrip after the leveled spell: ${out.error}`);
    eq(t.budget().bonusUsed, true, "the cantrip took the bonus action");
    eq(t.world.sheet(scene.holder.id).resources[id].used, 1, `${id} uses spent`);
  },
  async conc(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, feature.level, { spellcasting: { ...CASTING, ability: "wis" } });
    t.world.patch(hero.id, { concentratingOn: "Bless" });
    flush(t);
    t.world.dice(run.keep ? 1 : 5, 17);
    must(await t.world.invoke("apply_damage", { characterId: hero.id, amount: 10, type: "slashing" }), "the damage");
    t.world.clearDice();
    const d20s = thrown(t, 20);
    if (d20s === 0) throw new Error("no concentration save was rolled for the staged damage");
    if (run.keep) eq(t.world.sheet(hero.id).concentratingOn, "Bless", "concentration after 10 damage and a failed save");
    else eq(d20s, 2, "d20s thrown for the concentration save");
  },
  async stabilize(t, run, feature) {
    const scene = await t.stage(feature);
    const patient = run.patient === "holder" ? scene.holder : scene.fallen;
    const healer = run.patient === "holder" ? scene.ally : scene.holder;
    if (run.patient === "holder") {
      t.world.patch(patient.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
      t.kit.giveTurn(healer.id);
    }
    flush(t);
    t.world.dice(run.face ?? 15, 2, 2);
    const out = await t.world.invoke("stabilize", { characterId: patient.id, healerId: healer.id });
    t.world.clearDice();
    const after = t.world.sheet(patient.id);
    if (run.want === "auto") {
      eq(out.ok && after.deathSaves?.stable === true, true, `a 1 on the Medicine check still stabilizes: ${out.error ?? JSON.stringify(out.result).slice(0, 160)}`);
      return;
    }
    must(out, "stabilizing");
    if (run.want === "bonus") {
      eq(t.budget().bonusUsed, true, "stabilizing took the bonus action");
      eq(t.budget().actionUsed, false, "stabilizing left the action");
      return;
    }
    const wait = JSON.stringify([out.result, after.conditionMeta]);
    assert.match(wait, /minute/i, `the stabilized creature wakes after a minute; the engine wrote ${wait.slice(0, 220)}`);
  },
  async death_adv(t, run, feature) {
    const { rollDeathSave } = await load("lib/dm/death.ts");
    t.fresh();
    const hero = t.hero(feature.classId, feature.level);
    t.world.patch(hero.id, { currentHp: 0, conditions: ["unconscious", "prone"], deathSaves: { successes: 0, failures: 0, stable: false, dead: false } });
    flush(t);
    t.world.dice(5, 17);
    const line = rollDeathSave(t.world.campaign(), hero.id);
    t.world.clearDice();
    const d20s = thrown(t, 20);
    if (!line || d20s === 0) throw new Error(`no death save was rolled: ${line}`);
    eq(d20s, 2, "d20s thrown for the death save");
  },
  async foe_disadv(t, run, feature) {
    const scene = await t.stage(feature);
    t.foesTurn(scene);
    t.kit.freshRound();
    flush(t);
    t.world.dice(16, 3, 4);
    must(await t.world.invoke("enemy_attack", { enemyId: scene.near.id, targetCharacterId: scene.holder.id }), "the club swing");
    t.world.clearDice();
    eq(thrown(t, 20), 2, "d20s the foe threw at a holder standing beside a downed ally");
  },
  async ally_save(t, run, feature) {
    const scene = await t.stage(feature);
    if (run.after) must(await spendOn(t, scene, run.after), run.after);
    flush(t);
    t.world.dice(10, 17, 3);
    must(await t.world.invoke("request_roll", { characterId: scene.ally.id, kind: "saving_throw", ability: "wis", dc: 10, against: run.against, reason: "a probe" }), "the ally's save");
    t.world.clearDice();
    const log = t.world.diceLog();
    if (run.want === "d4") eq(log.filter((die) => die.sides === 4).length, 1, `d4s added to the save of an ally 5 feet away against ${run.against}`);
    else eq(log.filter((die) => die.sides === 20).length, 2, `d20s an ally 5 feet away threw against ${run.against}`);
  },
  async ally_resist(t, run, feature) {
    const scene = await t.stage(feature);
    must(await t.world.invoke("apply_damage", { characterId: scene.ally.id, amount: 10, type: run.type }), "the damage");
    eq(20 - t.hp(scene.ally.id), 5, `hit points an ally 5 feet away lost to 10 ${run.type}`);
  },
  async self_resist(t, run, feature) {
    const scene = await t.stage(feature);
    if (run.after) must(await spendOn(t, scene, run.after), run.after);
    if (run.sole) t.world.patch(scene.ally.id, { currentHp: 0, conditions: ["unconscious", "prone"] });
    must(await t.world.invoke("apply_damage", { characterId: scene.holder.id, amount: 10, type: run.type }), "the damage");
    eq(100 - t.hp(scene.holder.id), 5, `hit points lost to 10 ${run.type}`);
  },
  async club(t, run, feature) {
    const scene = await t.stage(feature, { hp: run.hp ?? 100 });
    const foeBefore = t.foeHp(scene.near.id);
    const out = await t.clubs(scene, scene.holder, 16, 4);
    if (run.thorns) eq(foeBefore - t.foeHp(scene.near.id), mod(run.thorns), "damage the foe took for landing a melee hit");
    else eq(out.totalDamage, 6 - (run.n ?? mod(run.less)), "damage of a club hit for 6");
  },
  async hit_heal(t, run, feature) {
    const scene = await t.stage(feature, { hp: 50 });
    if (run.spend) must(await spendOn(t, scene, run.spend), run.spend);
    await swing(t, scene, scene.near);
    eq(t.hp(scene.holder.id) - 50, mod(run.amount), "hit points regained on the hit");
  },
  async spell_heal(t, run, feature) {
    const scene = await t.stage(feature, { extra: { equipment: [], spellcasting: { ...CASTING, ability: "cha" } } });
    t.world.dice(3);
    must(await t.world.invoke("heal", { characterId: scene.ally.id, casterId: scene.holder.id, spell: "Healing Word" }), "Healing Word");
    t.world.clearDice();
    eq(t.hp(scene.ally.id) - 20, 3 + 2 * mod("cha"), "hit points a Healing Word restored on a 3");
  },
  async init_regain(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, feature.level);
    const held = hero.resources[run.id];
    t.world.patch(hero.id, { resources: { ...hero.resources, [run.id]: { ...held, used: held.max } } });
    await t.kit.fight(1, { heroFaces: { [hero.id]: 10 } });
    eq(t.world.sheet(hero.id).resources[run.id].used, Math.max(0, held.max - (run.n ?? held.max)), `${run.id} uses spent after rolling initiative with none left`);
  },
  async magical(t, run, feature) {
    const scene = await t.stage(feature, run.mode === "ranged" ? { lane: true, extra: { equipment: [{ name: "Shortbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] } } : {});
    const target = run.mode === "ranged" ? scene.far : scene.near;
    if (run.spend) must(await spendOn(t, scene, run.spend), run.spend);
    const plain = await swing(t, scene, target);
    t.kit.setEnemy(target.id, { stats: { type: run.type ?? "fiend", resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } });
    t.kit.giveTurn(scene.holder.id);
    const resisted = await swing(t, scene, target);
    eq(resisted.loss, plain.loss, "damage to a creature that resists nonmagical weapons");
  },
};
