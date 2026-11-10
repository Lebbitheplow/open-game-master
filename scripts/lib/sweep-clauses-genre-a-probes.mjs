// The probes a clause's `run` names, by kind. Each builds a real holder of the
// class at the level the feature arrives (or the level the run names), plays
// the clause through the engine's own doors (the GM's tools), and asserts what
// the stored text promises. An assertion that fails is the rule not held; any
// other throw is the probe's own setup breaking and fails the suite.
//
// Dice are forced: a d20 of 15 hits the dummy's AC 13, a weapon die shows 4
// and every die a rider adds shows 3, so a missing rider is a missing 3.
import assert from "node:assert/strict";
import { SCORES, mod, prof, must, eq } from "./sweep-clauses-genre-a.mjs";
import { heroInput } from "./enforce-world.mjs";

const SRC = new URL("../../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const key = (name) => name.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();

// A swing with the longsword: what the foe lost and the rolls stored.
async function swing(t, scene, target, faces = [15, 4, 3, 3, 3, 3, 3, 3], args = {}) {
  const before = t.foeHp(target.id);
  const out = await t.kit.swing(scene.holder.id, target.id, faces, args);
  must(out, "the staged attack");
  if (out.result.hit === false) throw new Error(`the staged attack missed: ${JSON.stringify(out.result).slice(0, 300)}`);
  return { ...out, loss: before - t.foeHp(target.id) };
}

// The holder without one feature, to tell what the feature added.
function strip(t, scene, name) {
  const features = t.world.sheet(scene.holder.id).features.filter((feature) => key(feature.name) !== key(name));
  t.world.patch(scene.holder.id, { features });
  if (t.world.sheet(scene.holder.id).features.some((feature) => key(feature.name) === key(name))) {
    throw new Error(`could not take ${name} off the sheet for the control swing`);
  }
}

// A use spent by counter id, with the target shapes a row may ask for.
async function spend(t, scene, resource, args = {}) {
  return t.world.invoke("use_resource", { characterId: scene.holder.id, resource, ...args });
}

export const PROBES = {
  // "1/long rest", "2/rest", "CON-mod uses per short rest": the counter the
  // sheet holds at that level has that many uses and comes back at that rest.
  async counter(t, run, feature) {
    t.fresh();
    const level = run.level ?? feature.level;
    const hero = t.hero(feature.classId, level);
    const held = hero.resources?.[run.id];
    assert.ok(held, `a level ${level} ${feature.classId} holds no counter ${run.id}`);
    const want = typeof run.n === "number" ? run.n : Math.max(1, mod(run.n));
    eq(held.max, want, `uses of ${run.id} at level ${level}`);
    const spendAll = () => t.world.patch(hero.id, { resources: { ...t.world.sheet(hero.id).resources, [run.id]: { ...held, used: held.max } } });
    const used = () => t.world.sheet(hero.id).resources[run.id].used;
    spendAll();
    must(await t.world.invoke("take_rest", { kind: "short", characterIds: [hero.id] }), "a short rest");
    if (run.rest === "short") {
      eq(used(), 0, `${run.id} after a short rest`);
      return;
    }
    eq(used(), held.max, `${run.id} came back on a short rest, and the text gives it per ${run.rest} rest`);
    must(await t.world.invoke("take_rest", { kind: "long", characterIds: [hero.id] }), "a long rest");
    if (run.rest === "long") eq(used(), 0, `${run.id} after a long rest`);
    else eq(used(), held.max, `${run.id} came back on a long rest, and the text gives it per ${run.rest}`);
  },

  // The class casts from the named list with the named ability: the server's
  // legality check writes the ability and refuses a spell off the list.
  async caster(t, run, feature) {
    const { legalizeSheet } = await load("lib/srd/sheet-legality.ts");
    const options = await load("lib/characters/options.ts");
    const { bundledPrices } = await load("lib/srd/starting-wealth.ts");
    const { checklistSpell } = await load("lib/srd/spell-lists.ts");
    const { bundledSubclassName } = await load("lib/srd/features.ts");
    const classes = options.srdClassOptions();
    const races = options.srdRaceOptions();
    const ON = { wizard: "Magic Missile", sorcerer: "Magic Missile", cleric: "Cure Wounds", bard: "Healing Word", warlock: "Hellish Rebuke", paladin: "Bless" };
    const OFF = { wizard: "Cure Wounds", sorcerer: "Cure Wounds", cleric: "Magic Missile", bard: "Magic Missile", warlock: "Cure Wounds", paladin: "Magic Missile" };
    const wrong = run.ability === "cha" ? "wis" : "cha";
    const sheet = heroInput({ class: feature.classId, level: 5, race: "human", abilities: SCORES, spellcasting: { ability: wrong, slots: {}, prepared: [ON[run.list], OFF[run.list]], known: [ON[run.list], OFF[run.list]], cantrips: [] } });
    const out = legalizeSheet(sheet, {
      door: "table", level: 5, hpMethod: "average", startingWealth: "equipment",
      classOf: (id) => classes.find((entry) => entry.id === id) ?? null,
      race: { ...races.find((entry) => entry.id === "human"), feats: 0 },
      background: null, baseline: null, abilityPool: null, wealthRoll: null,
      priceOf: bundledPrices, spellOf: checklistSpell, featOf: () => null,
      subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)), rollDie: () => 3,
    });
    eq(out.sheet.spellcasting?.ability, run.ability, "the casting ability the server writes");
    assert.ok(out.problems.some((line) => line.includes(OFF[run.list])), `${OFF[run.list]} is off the ${run.list} list and was let through`);
    assert.ok(!out.problems.some((line) => line.includes(ON[run.list])), `${ON[run.list]} is on the ${run.list} list and was refused`);
  },

  // The subclass is picked at the feature's level: its features come with the
  // pick at that level and never a level earlier.
  async subclass(t, run, feature) {
    t.fresh();
    const table = t.classes.CUSTOM_CLASS_FEATURES[feature.classId];
    eq(table.subclassLevel, feature.level, "the level the class picks its subclass");
    const sub = table.subclasses[0];
    const first = Object.values(sub.levels).flat();
    const at = t.hero(feature.classId, feature.level, { subclass: sub.name });
    assert.ok(at.features.some((entry) => first.includes(entry.name)), `no ${sub.name} feature at level ${feature.level}`);
    if (feature.level > 1) {
      const early = t.hero(feature.classId, feature.level - 1, { subclass: sub.name });
      assert.ok(!early.features.some((entry) => first.includes(entry.name)), `a ${sub.name} feature a level early`);
    }
  },

  // Advantage on a save: two d20s are thrown for it.
  async save_adv(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, run.level ?? feature.level);
    for (const ability of run.ability.split(",")) {
      for (const against of run.against ?? [null]) {
        t.world.clearDice();
        t.world.dice(5, 17);
        const out = await t.world.invoke("request_roll", {
          characterId: hero.id, kind: "saving_throw", ability, dc: 10, reason: "a probe",
          ...(against ? { against } : {}), ...(run.magical ? { magical: true } : {}),
        });
        const thrown = 2 - t.world.clearDice();
        must(out, "the save");
        eq(thrown, 2, `d20s thrown for the ${ability} save${against ? ` against ${against}` : ""}${run.magical ? " against a spell" : ""}`);
      }
    }
  },

  // A flat bonus on a save.
  async save_bonus(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, run.level ?? feature.level);
    t.world.dice(10);
    const out = must(await t.world.invoke("request_roll", { characterId: hero.id, kind: "saving_throw", ability: run.ability, dc: 10, reason: "a probe", ...(run.against ? { against: run.against } : {}) }), "the save");
    t.world.clearDice();
    eq(out.result.total, 10 + mod(run.ability) + run.n, `the ${run.ability} save on a 10`);
  },

  // Resistance halves 10 of the type; immunity takes none. Played with the
  // feature and without it, so a resistance another feature lends by accident
  // does not pass for this one.
  async resist(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, run.level ?? feature.level);
    const lose = async (type) => {
      t.world.patch(hero.id, { currentHp: 100 });
      if (run.via === "fall") {
        t.world.clearDice();
        t.world.dice(4, 6);
        must(await t.world.invoke("apply_hazard", { type: "falling", feet: 20, characterIds: [hero.id] }), "the fall");
        t.world.clearDice();
      } else {
        must(await t.world.invoke("apply_damage", { characterId: hero.id, amount: 10, type }), "the damage");
      }
      return 100 - t.hp(hero.id);
    };
    for (const type of run.type.split(",")) {
      const what = run.via === "fall" ? "a 20 foot fall for 10" : `10 ${type}`;
      const withIt = await lose(type);
      eq(withIt, run.immune ? 0 : 5, `hit points lost to ${what}`);
      const kept = t.world.sheet(hero.id).features;
      t.world.patch(hero.id, { features: kept.filter((entry) => key(entry.name) !== key(feature.name)) });
      const without = await lose(type);
      t.world.patch(hero.id, { features: kept });
      eq(without, 10, `${what} is cut without ${feature.name} too: something else on the sheet answers, not this feature`);
    }
  },

  // Immunity to a condition: laying it is refused, or it does not stay.
  async cond_immune(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, run.level ?? feature.level);
    if (run.hp) t.world.patch(hero.id, { currentHp: run.hp });
    for (const condition of run.conditions) {
      const out = await t.world.invoke("set_condition", { characterId: hero.id, condition });
      const holds = t.world.sheet(hero.id).conditions.map((entry) => entry.toLowerCase()).includes(condition);
      assert.ok(!out.ok || !holds, `${condition} was laid on a character the text makes immune to it`);
    }
  },

  // Armor class as the sheet derives it: 10 + DEX unarmored, plus the text's.
  async ac(t, run, feature) {
    t.fresh();
    const wear = {
      none: { equipment: [{ name: "Longsword", qty: 1, equipped: true }], base: 10 + mod("dex") },
      light: { equipment: [{ name: "Leather", qty: 1, equipped: true }, { name: "Longsword", qty: 1, equipped: true }], base: 11 + mod("dex") },
      dual: { equipment: [{ name: "Shortsword", qty: 2, equipped: true }], base: 10 + mod("dex") },
      bare: { equipment: [], base: 10 + mod("dex") },
    }[run.wear ?? "none"];
    const hero = t.hero(feature.classId, run.level ?? feature.level, { equipment: wear.equipment });
    const want = run.formula ? 10 + run.formula.reduce((sum, ability) => sum + mod(ability), 0) : wear.base + run.n;
    eq(t.srd.deriveAc(t.world.sheet(hero.id)), want, `armor class (${run.wear ?? "none"} worn)`);
  },

  // Armor class an attack faces in a fight, for a bonus a state switches on.
  async ac_fight(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level, hp: run.hp ?? 100 });
    if (run.alone) {
      t.kit.place(scene.ally.id, 15, 12);
      t.kit.place(scene.fallen.id, 16, 12);
    }
    const out = await t.clubs(scene, scene.holder, 16, 4);
    eq(out.vsAc, 10 + mod("dex") + run.n, "the armor class the club swung against");
  },

  async init(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, run.level ?? feature.level);
    const fight = await t.kit.fight(1, { heroFaces: { [hero.id]: 10 } });
    const entry = fight.order.find((row) => row.characterId === hero.id);
    eq(entry.initiative, 10 + mod("dex") + run.n, "initiative on a 10");
  },

  async init_adv(t, run, feature) {
    const { resolveRollExpression } = await load("lib/dm/rolls.ts");
    const { rollExtrasFor } = await load("lib/dm/forced-save.ts");
    t.fresh();
    const hero = t.hero(feature.classId, run.level ?? feature.level);
    const sheet = t.world.sheet(hero.id);
    const resolved = resolveRollExpression({ kind: "initiative", characterId: sheet.id }, sheet, rollExtrasFor(t.world.campaign(), sheet, "initiative"));
    assert.match(String(resolved.expression), /2d20/, "the initiative roll's dice");
  },

  // The party is surprised. A fighter with the Alert feat stands by, so the
  // order stops on round 1 and the list of the surprised is still held.
  async no_surprise(t, run, feature) {
    t.fresh();
    const hero = t.hero(feature.classId, run.level ?? feature.level);
    const watch = t.world.addHero({ name: "Watch", class: "fighter", level: 4, feats: ["Alert"], abilities: SCORES, maxHp: 40 });
    const fight = await t.world.beginFight([{ monster: run.monster ?? "goblin", count: 1 }], { surprised: "party", heroFaces: { [hero.id]: 10, [watch.id]: 10, [t.ally.id]: 10, [t.fallen.id]: 10 } });
    if (!fight.surprisedIds.includes(t.ally.id) || fight.surprisedIds.includes(watch.id)) throw new Error(`the staged surprise went wrong: ${JSON.stringify(fight.surprisedIds)}`);
    assert.ok(!fight.surprisedIds.includes(hero.id), "the holder is on the list of the surprised");
  },

  // A natural 19 with the longsword is a critical hit.
  async crit(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    const out = await swing(t, scene, scene.near, [19, 4, 4, 4]);
    eq(out.result.crit === true, true, "a 19 on the die is a critical hit");
  },

  // What the feature adds to a weapon hit: the same swing with and without it.
  async dmg(t, run, feature) {
    const extra = run.mode === "ranged" ? { equipment: [{ name: "Shortbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] } : run.mode === "unarmed" ? { equipment: [] } : {};
    const scene = await t.stage(feature, { level: run.level, hp: run.hp ?? 100, extra, lane: run.mode === "ranged" });
    const target = run.mode === "ranged" ? scene.far : scene.near;
    if (run.type) t.kit.setEnemy(target.id, { stats: { type: run.type } });
    const args = run.mode === "unarmed" ? { weapon: "Unarmed Strike" } : {};
    const faces = [15, 4, 3, 3, 3, 3, 3, 3];
    // A rider the text puts on a weapon another spend calls up (the grave
    // knight's pact blade): that spend is made before each swing.
    const callUp = async () => {
      if (run.spend) must(await spend(t, scene, run.spend), run.spend);
    };
    await callUp();
    const withIt = await swing(t, scene, target, faces, args);
    strip(t, scene, feature.name);
    t.kit.giveTurn(scene.holder.id);
    await callUp();
    const without = await swing(t, scene, target, faces, args);
    const want = run.flat ?? run.dice * 3;
    eq(withIt.loss - without.loss, want, `damage ${feature.name} adds to a hit (${withIt.loss} with it, ${without.loss} without)`);
  },

  // What the feature adds to an attack roll, the same way.
  async atk(t, run, feature) {
    const extra = run.mode === "ranged" ? { equipment: [{ name: "Shortbow", qty: 1, equipped: true }, { name: "Arrows", qty: 20 }] } : {};
    const scene = await t.stage(feature, { level: run.level, hp: run.hp ?? 100, extra, lane: run.mode === "ranged" });
    const target = run.mode === "ranged" ? scene.far : scene.near;
    const withIt = await swing(t, scene, target);
    strip(t, scene, feature.name);
    t.kit.giveTurn(scene.holder.id);
    const without = await swing(t, scene, target);
    eq(withIt.toHit.total - without.toHit.total, run.n, `what ${feature.name} adds to the attack roll (${withIt.toHit.total} with it, ${without.toHit.total} without)`);
  },

  // Attacks the Attack action gives.
  async attacks(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    await swing(t, scene, scene.near);
    eq(t.budget().attacksAllowed, run.n, "attacks allowed this turn");
  },

  // A move taken as the bonus action.
  async bonus_route(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    if (run.noneDown) t.world.patch(scene.fallen.id, { currentHp: 10, conditions: [], deathSaves: null });
    for (const action of run.actions) {
      t.kit.giveTurn(scene.holder.id);
      // Hiding needs to be unseen: the foes are blinded for it, so a refusal
      // is about the bonus action and not about being watched.
      if (action === "hide") for (const foe of [scene.near, scene.far]) t.kit.setEnemy(foe.id, { conditions: ["blinded"] });
      const out = await t.world.invoke("take_action", { characterId: scene.holder.id, action, bonus: true, ...(action === "grapple" ? { targetEnemyId: scene.near.id } : {}) });
      if (run.refused) {
        eq(out.ok, false, `${action} as a bonus action was accepted`);
        continue;
      }
      eq(out.ok, true, `${action} as a bonus action: ${out.error}`);
      eq(t.budget().bonusUsed, true, `${action} took the bonus action`);
      eq(t.budget().actionUsed, false, `${action} left the action`);
    }
    if (run.counter) eq(t.world.sheet(scene.holder.id).resources[run.counter].used, run.actions.length, `${run.counter} uses spent, one for each`);
  },

  // A spend the spends sweep did not flag: something other than the counter
  // and the turn's cost moves when it is spent.
  async spend_moves(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    const before = t.reader.snapshot();
    const tries = [{}, { targetCharacterId: scene.ally.id }, { targetEnemyId: scene.near.id }];
    let out = null;
    const errors = [];
    for (const args of tries) {
      out = await spend(t, scene, run.id, args);
      if (out.ok) break;
      errors.push(out.error);
    }
    if (!out.ok) throw new Error(`no target shape got ${run.id} accepted: ${errors.join(" / ")}`);
    const moved = t.readChanges(scene, t.reader.diff(before, t.reader.snapshot()));
    assert.ok(moved.effects.length > 0, `spending ${run.id} moved its counter and the turn's cost and nothing else; the result was its guidance: ${String(out.result?.effect ?? "").slice(0, 120)}`);
  },

  // A use spent with the action cost the text names.
  async spend_cost(t, run, feature) {
    const scene = await t.stage(feature, { level: run.level });
    const tries = [{}, { targetCharacterId: scene.ally.id }, { targetEnemyId: scene.near.id }];
    let out = null;
    for (const args of tries) {
      out = await spend(t, scene, run.id, args);
      if (out.ok) break;
    }
    must(out, `spending ${run.id}`);
    const cost = t.budget();
    const reacted = t.world.encounter().reactionsUsed.includes(scene.holder.id);
    const paid = cost.bonusUsed ? "bonus" : cost.actionUsed ? "action" : reacted ? "reaction" : "nothing";
    eq(paid, run.cost, `what spending ${run.id} cost of the turn`);
  },
};
