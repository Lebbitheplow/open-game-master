// The probes of the clause ledger for the mystery, post-apocalyptic and
// steampunk classes (scripts/clauses/genre-*.json): one function per kind of
// promise a feature's text makes, each run against the engine through the
// doors a table uses (invokeEngine, the roll resolver, the AC and speed
// derivations), and most of them twice: with the feature on the sheet and
// with only that feature taken off, so a number another feature gives (or a
// same-named feature of another class) is never read as this one's.
//
// A probe throws an AssertionError when the engine does not do what the
// clause says, and a plain Error when its own staging broke.
//
// Import after enforce-world.mjs (sweep-clauses-genre-b.mjs does).
import assert from "node:assert/strict";
import { openWorld, dice, clearDice, diceLog } from "./enforce-world.mjs";
import { combatKit, TRAINED } from "./enforce-combat.mjs";
import { tableReader } from "./sweep-spends.mjs";

const SRC = new URL("../../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);

export const ABILITIES = { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 };
const MOD = 3;
const prof = (level) => 2 + Math.floor((level - 1) / 4);
const baseName = (name) => name.replace(/\s*\([^)]*\)\s*$/, "").trim();
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// A staging call that must go through: its refusal is the probe breaking.
function must(out, what) {
  if (!out?.ok) {
    throw new Error(`${what}: ${out?.error ?? "refused"}`);
  }
  return out.result ?? {};
}

const KITS = {
  melee: [{ name: "Longsword", qty: 1, equipped: true }],
  simple: [{ name: "Club", qty: 1, equipped: true }],
  firearm: [{ name: "Pistol", qty: 1, equipped: true }, { name: "Bullets", qty: 20 }, { name: "Rapier", qty: 1, equipped: true }],
  armor: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Chain Shirt", qty: 1, equipped: true }],
  shield: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Chain Shirt", qty: 1, equipped: true }, { name: "Shield", qty: 1, equipped: true }],
  none: [],
};

export async function clausesRig() {
  const world = await openWorld({ campaign: { maxPlayers: 400 } });
  const kit = await combatKit(world);
  const { getDatabase } = await load("lib/db/core.ts");
  const reader = tableReader(getDatabase());
  const srd = await load("lib/srd/index.ts");
  const featureEffects = await load("lib/srd/feature-effects.ts");
  const authored = await load("lib/srd/authored-effects.ts");
  const resources = await load("lib/srd/class-resources.ts");
  const classes = await load("lib/classes/index.ts");
  const { resolveRollExpression } = await load("lib/dm/rolls.ts");
  const { rollExtrasFor } = await load("lib/dm/forced-save.ts");
  const rolls = await load("lib/db/rolls.ts");
  const features = await load("lib/srd/features.ts");

  const ally = world.addHero({ name: "Ally", class: "fighter", subclass: "Champion", level: 5, abilities: ABILITIES, maxHp: 100, proficiencies: TRAINED, portrait: { url: "/uploads/test.png" }, equipment: KITS.melee });
  const base = reader.snapshot();
  const reset = () => {
    clearDice();
    reader.restore(base);
    diceLog();
  };

  // The holder of one catalog row, at the level the feature arrives.
  function holder(row, { gear = "melee", level = row.level, skills = [] } = {}) {
    const table = classes.CUSTOM_CLASS_FEATURES[row.classId];
    const hero = world.addHero({
      user: world.addUser("holder"), name: "Holder", class: row.classId,
      subclass: level >= table.subclassLevel ? table.subclasses[0].name : "",
      level, abilities: ABILITIES, maxHp: 100, acOverride: false,
      proficiencies: { ...TRAINED, weapons: ["simple", "martial", "firearms"], skills },
      portrait: { url: "/uploads/test.png" }, equipment: KITS[gear] ?? KITS.melee,
    });
    const sheet = world.sheet(hero.id);
    if (!sheet.features.some((feature) => feature.name === row.name)) {
      throw new Error(`a level ${level} ${row.classId} does not hold ${row.name}`);
    }
    return hero;
  }

  // Runs `read` with the row's own feature taken off the sheet, then puts it back.
  async function without(hero, row, read) {
    const sheet = world.sheet(hero.id);
    world.patch(hero.id, { features: sheet.features.filter((feature) => feature.name !== row.name) });
    try {
      return await read();
    } finally {
      world.patch(hero.id, { features: sheet.features });
    }
  }
  const both = async (hero, row, read) => ({ on: await read(), off: await without(hero, row, read) });

  async function fight(hero) {
    await kit.endFight();
    await kit.fight(2, { heroFaces: { [hero.id]: 19, [ally.id]: 3 } });
    const [near, far] = world.enemies();
    for (const enemy of [near, far]) kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
    kit.place(hero.id, 5, 2);
    kit.place(ally.id, 5, 3);
    kit.place(near.id, 6, 2);
    kit.place(far.id, 18, 2);
    myTurn(hero);
    return { near: kit.enemy(near.id), far: kit.enemy(far.id) };
  }
  function myTurn(hero) {
    kit.giveTurn(hero.id);
    kit.freshRound();
    clearDice();
    diceLog();
  }
  const budget = () => world.encounter()?.turnBudget ?? {};
  const reacted = (hero) => Boolean(world.encounter()?.reactionsUsed.includes(hero.id) || budget().reactionUsed);

  // ---- readings ----

  async function damageLost(hero, type, magical, from = 100) {
    world.patch(hero.id, { currentHp: from, tempHp: 0 });
    must(await world.invoke("apply_damage", { characterId: hero.id, amount: 20, type, ...(magical === undefined ? {} : { magical }), reason: "clause probe" }), "apply_damage");
    const lost = from - world.sheet(hero.id).currentHp;
    world.patch(hero.id, { currentHp: 100 });
    return lost;
  }
  async function d20sOf(hero, args) {
    clearDice();
    diceLog();
    must(await world.invoke("request_roll", { characterId: hero.id, dc: 10, reason: "clause probe", ...args }), "request_roll");
    return diceLog().filter((die) => die.sides === 20).length;
  }
  async function modifierOf(hero, args) {
    clearDice();
    diceLog();
    dice(11);
    const out = must(await world.invoke("request_roll", { characterId: hero.id, dc: 10, reason: "clause probe", ...args }), "request_roll");
    clearDice();
    return out.total - 11;
  }
  function initiative(hero) {
    const sheet = world.sheet(hero.id);
    return resolveRollExpression({ kind: "initiative", characterId: sheet.id }, sheet, rollExtrasFor(world.campaign(), sheet, "initiative")).expression ?? "";
  }
  async function swing(hero, enemy, args = {}, extraDice = 8) {
    const out = await kit.swing(hero.id, enemy.id, [15, ...new Array(extraDice).fill(3)], args);
    if (!out.ok) throw new Error(`pc_attack: ${out.error}`);
    return out;
  }
  // The dummy's club on a hero: a 16 hits AC 12 to 18 for 4 + 2; a 2 misses.
  async function clubbed(enemy, target, face = 16) {
    kit.handOnEnemies();
    kit.freshRound();
    clearDice();
    dice(face, 4);
    const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
    clearDice();
    return must(out, "enemy_attack");
  }
  const engineHooks = (hero, row) => {
    const sheet = world.sheet(hero.id);
    const own = (name) => baseName(name).toLowerCase() === baseName(row.name).toLowerCase();
    return {
      effects: featureEffects.effectsFor({ class: sheet.class, features: sheet.features }).filter((entry) => own(entry.feature)).map((entry) => entry.effect.kind + (entry.effect.types ? `(${entry.effect.types.join(",")})` : "")),
      authored: authored.heldAuthored(sheet).filter((held) => own(held.name)).map((held) => held.key),
      counter: Object.keys(sheet.resources ?? {}).filter((id) => own(resources.resourceDef(id)?.displayName ?? "")).map((id) => `${id}:${resources.resourceDef(id)?.effect?.kind}`),
    };
  };

  return {
    world, kit, ally, reset, holder, without, both, fight, myTurn, budget, reacted, damageLost, d20sOf, modifierOf, initiative, swing, clubbed,
    engineHooks, srd, resources, classes, authored, featureEffects, rolls, features, must, prof,
  };
}

// ---- the probes, by kind ----

export const PROBES = {
  // "1/rest", "INT-mod uses per long rest", "<Base> has 3 uses per short rest".
  async uses(rig, row, p) {
    const hero = rig.holder(row);
    const id = p.id;
    const state = rig.world.sheet(hero.id).resources?.[id];
    assert.ok(state, `a level ${row.level} ${row.classId} holds no counter ${id} (counters: ${Object.keys(rig.world.sheet(hero.id).resources ?? {}).join(", ") || "none"})`);
    const want = p.ability ? MOD : p.n;
    assert.equal(state.max, want, `${id} holds ${state.max} use(s) at level ${row.level}, and the text gives ${want}`);
    if (!p.rest) return;
    const usedUp = () => rig.world.patch(hero.id, { resources: { ...rig.world.sheet(hero.id).resources, [id]: { ...state, used: state.max } } });
    usedUp();
    rig.must(await rig.world.invoke("take_rest", { kind: "short" }), "take_rest short");
    const afterShort = rig.world.sheet(hero.id).resources[id].used;
    if (p.rest === "long") {
      assert.equal(afterShort, state.max, `${id} came back on a short rest, and the text says a long rest`);
      rig.must(await rig.world.invoke("take_rest", { kind: "long" }), "take_rest long");
      assert.equal(rig.world.sheet(hero.id).resources[id].used, 0, `${id} did not come back on a long rest`);
    } else {
      assert.equal(afterShort, 0, `${id} did not come back on a short rest (left used ${afterShort})`);
    }
  },

  // A counter's spend costs the bonus action, the reaction or the action its text names.
  async action_cost(rig, row, p) {
    const hero = rig.holder(row);
    await rig.fight(hero);
    const out = await rig.world.invoke("use_resource", { characterId: hero.id, resource: p.id, reason: "clause probe" });
    assert.equal(out.ok, true, `use_resource ${p.id} on the holder's turn: ${out.error}`);
    const spent = rig.budget();
    if (p.cost === "bonus") assert.equal(spent.bonusUsed, true, `the bonus action was not spent (${JSON.stringify(spent)})`);
    if (p.cost === "action") assert.equal(spent.actionUsed, true, `the action was not spent (${JSON.stringify(spent)})`);
    if (p.cost === "reaction") assert.equal(rig.reacted(hero), true, "the reaction was not spent");
  },

  // What a typed counter's spend does to the creature it names. A counter
  // whose use makes creatures save rolls them in the spend itself and refuses
  // a spend that names none (src/lib/dm/counter-saves.ts resolveCounterSave:
  // "Before this the spend paid the use and the action and handed the numbers
  // back for an aoe_damage call"), so the probe names its creature and reads
  // what landed. Every die is staged before the spend: 20s for a made save
  // ("made"), 1s otherwise so the save fails and the condition lands.
  async fx(rig, row, p) {
    const hero = rig.holder(row);
    const { near, far } = await rig.fight(hero);
    const target = p.resolve === "far" ? far : near;
    const spend = async (faces) => {
      clearDice();
      dice(...new Array(12).fill(faces));
      const out = await rig.world.invoke("use_resource", { characterId: hero.id, resource: p.id, targetEnemyId: target.id, reason: "clause probe" });
      clearDice();
      return out;
    };
    if (p.resolve === "far") {
      const out = await spend(1);
      const foe = rig.kit.enemy(target.id);
      assert.ok(!out.ok || !foe.conditions.length, `a creature ${p.feet} ft and more away was caught: ${JSON.stringify(foe.conditions)}`);
      assert.equal(out.ok, false, `use_resource ${p.id} took a creature 65 ft away for an effect that reaches ${p.feet} ft`);
      return;
    }
    if (p.made) {
      const [count, sides] = p.made.dice.split("d").map(Number);
      const out = await spend(20);
      assert.equal(out.ok, true, `use_resource ${p.id}: ${out.error}`);
      // A spend that rolls no damage at all would read as "takes none".
      assert.equal(out.result.damage, p.made.dice, `the spend rolls ${out.result.damage ?? "no damage"}, and the text says ${p.made.dice}`);
      const lost = 300 - rig.kit.enemy(near.id).currentHp;
      const want = p.made.takes === "half" ? Math.floor((count * sides) / 2) : 0;
      assert.equal(lost, want, `a creature that made the save lost ${lost} of ${count * sides}, and the text makes it ${want} (${JSON.stringify(out.result).slice(0, 200)})`);
      if (p.save) assert.equal(out.result.saveAbility, p.save, `the spend rolls a ${out.result.saveAbility} save`);
      return;
    }
    const out = await spend(1);
    assert.equal(out.ok, true, `use_resource ${p.id}: ${out.error}`);
    const given = out.result;
    if (p.save) assert.equal(given.saveAbility, p.save, `the spend hands back saveAbility ${given.saveAbility}`);
    if (p.dice) assert.ok(Object.values(given).includes(p.dice), `the spend hands back no ${p.dice} (${JSON.stringify(given).slice(0, 220)})`);
    if (p.type) assert.ok([given.type, given.damageType].includes(p.type), `the spend hands back no ${p.type} damage type (${JSON.stringify(given).slice(0, 220)})`);
    if (p.half !== undefined) assert.equal(Boolean(given.halfOnSave), p.half, `halfOnSave is ${given.halfOnSave} (${JSON.stringify({ ...given, effect: undefined, note: undefined }).slice(0, 240)})`);
    if (p.condition) assert.equal(given.condition, p.condition, `the spend hands back condition ${given.condition}, and the text's is ${p.condition} (${JSON.stringify(given).slice(0, 200)})`);
    for (const key of p.absent ?? []) assert.ok(!(key in given), `the spend hands back ${key} ${JSON.stringify(given[key])}, which the text does not lay on anyone`);
    if (!p.resolve) return;
    const foe = rig.kit.enemy(target.id);
    if (p.resolve === "lands") assert.ok(foe.conditions.includes(given.condition), `the failed save left ${JSON.stringify(foe.conditions)}`);
    if (p.resolve === "rounds") {
      const meta = foe.conditionMeta?.[given.condition] ?? {};
      const rounds = meta.rounds ?? meta.roundsLeft ?? meta.duration ?? null;
      assert.equal(rounds, p.rounds, `the condition's record is ${JSON.stringify(meta)}, and the text says ${p.rounds} round(s)`);
    }
  },

  // "Resistance to necrotic damage", "Immune to poison".
  async resist(rig, row, p) {
    const hero = rig.holder(row);
    for (const type of p.types) {
      const { on, off } = await rig.both(hero, row, () => rig.damageLost(hero, type, p.nonmagical ? false : undefined, p.belowHalf ? 40 : 100));
      const want = p.immune ? 0 : 10;
      assert.equal(on, want, `20 ${type} damage took ${on} hit points with ${row.name} (${off} without it), and the text makes it ${want}`);
      assert.equal(off, 20, `without ${row.name} the same ${type} damage took ${off}: something else gives this`);
    }
    if (p.nonmagical) {
      const magical = await rig.damageLost(hero, p.types[0], true);
      assert.equal(magical, 20, `magical ${p.types[0]} damage took ${magical}`);
    }
  },

  // "Advantage on saves against fear and charm".
  async save_adv(rig, row, p) {
    const hero = rig.holder(row);
    for (const against of p.against) {
      const { on, off } = await rig.both(hero, row, () => rig.d20sOf(hero, { kind: "saving_throw", ability: p.ability ?? "wis", against }));
      assert.equal(on, 2, `a save against ${against} threw ${on} d20 with ${row.name} (${off} without it)`);
      assert.equal(off, 1, `without ${row.name} the save threw ${off} d20s`);
    }
  },

  // "Immune to being frightened".
  async immune_cond(rig, row, p) {
    const hero = rig.holder(row);
    const read = async () => {
      rig.world.patch(hero.id, { conditions: [], conditionMeta: {} });
      await rig.world.invoke("set_condition", { characterId: hero.id, condition: p.condition, reason: "clause probe" });
      const has = rig.world.sheet(hero.id).conditions.includes(p.condition);
      rig.world.patch(hero.id, { conditions: [], conditionMeta: {} });
      return has;
    };
    const { on, off } = await rig.both(hero, row, read);
    assert.equal(on, false, `set_condition laid ${p.condition} on the holder of ${row.name}`);
    assert.equal(off, true, "the staging never lays the condition");
  },

  // "+1 AC while wearing armor", "AC equals 13 + DEX modifier".
  async ac(rig, row, p) {
    const hero = rig.holder(row, { gear: p.gear ?? "armor" });
    const sheet = rig.world.sheet(hero.id);
    const on = rig.srd.deriveAc(sheet);
    const off = rig.srd.deriveAc({ ...sheet, features: sheet.features.filter((feature) => feature.name !== row.name) });
    assert.equal(sheet.ac, on, "the stored AC is not the derived one");
    if (p.equals !== undefined) assert.equal(on, p.equals, `AC is ${on} (${rig.srd.acBreakdownFor(sheet).parts.join(", ")}), and the text makes it ${p.equals}`);
    if (p.delta !== undefined) assert.equal(on - off, p.delta, `AC is ${on} with ${row.name} and ${off} without it`);
  },

  // "+2 initiative", "Advantage on initiative".
  async init(rig, row, p) {
    const hero = rig.holder(row);
    const { on, off } = await rig.both(hero, row, () => rig.initiative(hero));
    if (p.advantage) {
      assert.match(on, /2d20/, `initiative rolls ${on} with ${row.name} (${off} without it)`);
    } else {
      assert.equal(on, `1d20+${MOD + p.bonus}`, `initiative rolls ${on} with ${row.name} (${off} without it)`);
    }
    assert.equal(off, `1d20+${MOD}`, `without ${row.name} initiative rolls ${off}`);
  },

  // "Your speed increases by 10 ft".
  async speed(rig, row, p) {
    const hero = rig.holder(row);
    const sheet = rig.world.sheet(hero.id);
    const on = rig.srd.speedFor(sheet);
    const off = rig.srd.speedFor({ ...sheet, features: sheet.features.filter((feature) => feature.name !== row.name) });
    assert.equal(on - off, p.delta, `speed is ${on} with ${row.name} and ${off} without it`);
  },

  // "Double proficiency bonus on Insight", "Advantage on Stealth".
  async skill(rig, row, p) {
    const hero = rig.holder(row, { skills: p.proficient === false ? [] : [p.skill] });
    if (p.advantage) {
      const { on, off } = await rig.both(hero, row, () => rig.d20sOf(hero, { kind: "skill_check", skill: p.skill }));
      assert.equal(on, 2, `a ${p.skill} check threw ${on} d20 with ${row.name} (${off} without it)`);
      return;
    }
    const { on, off } = await rig.both(hero, row, () => rig.modifierOf(hero, { kind: "skill_check", skill: p.skill }));
    const want = p.half ? MOD + Math.floor(rig.prof(row.level) / 2) : MOD + 2 * rig.prof(row.level);
    assert.equal(on, want, `a ${p.skill} check adds ${on} with ${row.name} (${off} without it), and the text makes it ${want}`);
  },

  // "Attack twice when taking the Attack action".
  async extra_attack(rig, row, p) {
    const hero = rig.holder(row);
    const { near } = await rig.fight(hero);
    await rig.swing(hero, near);
    const on = rig.budget().attacksAllowed;
    rig.myTurn(hero);
    const off = await rig.without(hero, row, async () => {
      await rig.swing(hero, near);
      return rig.budget().attacksAllowed;
    });
    assert.equal(on, p.attacks, `the Attack action allows ${on} attack(s) with ${row.name}`);
    assert.equal(off, p.attacks - 1, `without ${row.name} it allows ${off}`);
  },

  // "+1d6 bludgeoning on a melee hit", "unarmed strikes deal 1d6 + STR".
  async rider(rig, row, p) {
    const hero = rig.holder(row, { gear: p.gear ?? "melee" });
    const { near } = await rig.fight(hero);
    if (p.belowHalf) rig.world.patch(hero.id, { currentHp: 30 });
    if (p.foeCondition) rig.must(await rig.world.invoke("set_condition", { enemyId: near.id, condition: p.foeCondition, reason: "clause probe" }), "set_condition on the foe");
    const args = p.args ?? {};
    const read = async () => {
      rig.myTurn(hero);
      // Off the sheet the feature cannot be spent, and the swing is the plain one.
      if (p.pre) await rig.world.invoke("use_resource", { characterId: hero.id, resource: p.pre, reason: "clause probe" });
      // Two 15s: a shot fired beside a foe rolls twice and keeps the lower.
      const out = await rig.kit.swing(hero.id, near.id, [15, 15, 3, 3, 3, 3, 3, 3, 3], args);
      if (!out.ok) return `refused (${String(out.error).slice(0, 120)})`;
      return `${out.damage?.expression ?? "no damage roll"}`;
    };
    const { on, off } = await rig.both(hero, row, read);
    assert.ok(on.includes(p.dice) && on !== off, `a hit rolls ${on} with ${row.name} (${off} without it), and the text makes it ${p.dice}`);
  },

  // "Disengage or Hide as a bonus action".
  async bonus_route(rig, row, p) {
    const hero = rig.holder(row);
    const { near } = await rig.fight(hero);
    // Hiding wants the foes not to see the hider; "even in plain sight" does not.
    if (p.actions.includes("hide") && !p.plainSight) {
      for (const enemy of rig.world.enemies()) rig.must(await rig.world.invoke("set_condition", { enemyId: enemy.id, condition: "blinded", reason: "clause probe" }), "set_condition blinded");
    }
    for (const action of p.actions) {
      const call = () => rig.world.invoke("take_action", { characterId: hero.id, action, bonus: true, ...(action === "grapple" ? { targetEnemyId: near.id } : {}), reason: "clause probe" });
      rig.myTurn(hero);
      const on = await call();
      assert.equal(on.ok, true, `${action} as a bonus action: ${on.error}`);
      assert.equal(rig.budget().bonusUsed, true, `${action} did not spend the bonus action`);
      assert.ok(!rig.budget().actionUsed, `${action} spent the action as well`);
      rig.myTurn(hero);
      const off = await rig.without(hero, row, call);
      assert.equal(off.ok, false, `without ${row.name} the ${action} is a bonus action all the same`);
    }
  },

  // An at-will spend of the genre rows (Head of Steam, Wind-Up Ally).
  async spend_row(rig, row, p) {
    const hero = rig.holder(row);
    await rig.fight(hero);
    const out = await rig.world.invoke("use_resource", { characterId: hero.id, resource: p.name, reason: "clause probe" });
    assert.equal(out.ok, true, `use_resource ${p.name}: ${out.error}`);
    assert.equal(rig.budget().bonusUsed, true, "the bonus action was not spent");
    if (p.condition) assert.ok(rig.world.sheet(hero.id).conditions.includes(p.condition), `no ${p.condition} on the holder`);
  },

  // "Reaction when an adjacent ally is hit: take the hit instead."
  async take_hit(rig, row, p) {
    const hero = rig.holder(row);
    const { near } = await rig.fight(hero);
    if (p.allyAt) rig.kit.place(rig.ally.id, ...p.allyAt);
    if (p.foeAt) rig.kit.place(near.id, ...p.foeAt);
    const spot = (id) => {
      const token = rig.kit.token(id);
      return `${token.x},${token.y}`;
    };
    const stood = { hero: spot(hero.id), ally: spot(rig.ally.id) };
    await rig.clubbed(near, rig.ally);
    const allyHp = rig.world.sheet(rig.ally.id).currentHp;
    assert.equal(allyHp, 94, "the staged club did not land for 6");
    const out = await rig.world.invoke("use_reaction", { characterId: hero.id, feature: baseName(p.name ?? row.name), targetCharacterId: rig.ally.id, reason: "clause probe" });
    if (p.refused) {
      assert.equal(out.ok, false, `${p.name ?? row.name} reached an ally 15 feet away: ${JSON.stringify(out.result ?? {}).slice(0, 160)}`);
      return;
    }
    assert.equal(out.ok, true, `use_reaction ${p.name ?? row.name}: ${out.error}`);
    if (p.swap) assert.deepEqual({ hero: spot(hero.id), ally: spot(rig.ally.id) }, { hero: stood.ally, ally: stood.hero }, "the two did not swap places");
    assert.equal(rig.world.sheet(rig.ally.id).currentHp, 100, "the ally kept the wound");
    assert.equal(rig.world.sheet(hero.id).currentHp, 94, `the holder took ${100 - rig.world.sheet(hero.id).currentHp}`);
    assert.equal(rig.reacted(hero), true, "the reaction was not spent");
  },

  // "Reaction: halve the damage of one attack that hits you."
  async halve_hit(rig, row) {
    const hero = rig.holder(row);
    const { near } = await rig.fight(hero);
    await rig.clubbed(near, hero);
    assert.equal(rig.world.sheet(hero.id).currentHp, 94, "the staged club did not land for 6");
    const out = await rig.world.invoke("use_reaction", { characterId: hero.id, feature: baseName(row.name), reason: "clause probe" });
    assert.equal(out.ok, true, `use_reaction ${row.name}: ${out.error}`);
    assert.equal(rig.world.sheet(hero.id).currentHp, 97, "the hit was not halved");
    assert.equal(rig.reacted(hero), true, "the reaction was not spent");
  },

  // "Reaction when missed in melee: riposte with one weapon attack."
  async riposte(rig, row, p) {
    const hero = rig.holder(row);
    const { near } = await rig.fight(hero);
    await rig.clubbed(near, hero, p.hit ? 16 : 2);
    // A reaction attack answers another creature's turn: the floor is the ally's.
    rig.kit.giveTurn(rig.ally.id);
    const before = new Set(rig.rolls.listRecentRolls(rig.world.campaignId, 40).map((roll) => roll.id));
    clearDice();
    dice(15, 4, 4);
    const out = await rig.world.invoke("use_reaction", { characterId: hero.id, feature: baseName(row.name), targetEnemyId: near.id, reason: "clause probe" });
    clearDice();
    if (p.hit) {
      assert.equal(out.ok, false, `${row.name} answered a blow that hit: ${JSON.stringify(out.result ?? {}).slice(0, 200)}`);
      return;
    }
    assert.equal(out.ok, true, `use_reaction ${row.name}: ${out.error}`);
    const made = rig.rolls.listRecentRolls(rig.world.campaignId, 40).filter((roll) => !before.has(roll.id) && roll.kind === "attack");
    assert.equal(made.length, 1, `${made.length} attack roll(s) were made`);
    assert.equal(rig.reacted(hero), true, "the reaction was not spent");
  },

  // "DEX saves for half damage deal none on a success, half on a failure."
  async evasion(rig, row) {
    const hero = rig.holder(row);
    await rig.fight(hero);
    const blast = async (dc) => {
      rig.world.patch(hero.id, { currentHp: 100, tempHp: 0 });
      clearDice();
      dice(10);
      const out = rig.must(await rig.world.invoke("aoe_damage", { damage: "40", saveAbility: "dex", dc, type: "fire", halfOnSave: true, characterIds: [hero.id], reason: "clause probe" }), "aoe_damage");
      clearDice();
      return { lost: 100 - rig.world.sheet(hero.id).currentHp, out };
    };
    const made = await blast(1);
    const failed = await blast(30);
    assert.equal(made.lost, 0, `a made DEX save for half took ${made.lost} of 40`);
    assert.equal(failed.lost, 20, `a failed one took ${failed.lost} of 40`);
  },

  // The Attack action's start cannot find the holder surprised.
  async no_surprise(rig, row) {
    const hero = rig.holder(row);
    const read = async () => {
      await rig.kit.endFight();
      // An ambush: the goblin's Stealth on a 20 beats every passive Perception.
      clearDice();
      dice(1, 20, 15, 15);
      const opened = rig.must(await rig.world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 1 }], ambush: "enemies" }), "start_encounter");
      clearDice();
      // surprisedIds empties as round 1 passes; the opening says who was caught.
      const caught = /\bHolder\b[^.]*\bnotices? nothing\b/.test(String(opened.ambush ?? ""));
      await rig.kit.endFight();
      return caught;
    };
    const { on, off } = await rig.both(hero, row, read);
    assert.equal(off, true, "the staging surprises nobody");
    assert.equal(on, false, `the holder of ${row.name} was surprised with the party`);
  },

  // "Chooses a ... (subclass)": the subclass's features come with the choice.
  async subclass(rig, row) {
    const table = rig.classes.CUSTOM_CLASS_FEATURES[row.classId];
    const first = table.subclasses[0].levels[String(table.subclassLevel)] ?? [];
    const hero = rig.holder(row);
    const names = rig.world.sheet(hero.id).features.map((feature) => feature.name);
    assert.equal(row.level, table.subclassLevel, "the choice arrives at the subclass level");
    for (const name of first) assert.ok(names.includes(name), `the level ${row.level} sheet lacks ${name}`);
  },

  // "Casts wizard-list spells ... using INT".
  async casting(rig, row, p) {
    const klass = rig.srd.findClass(row.classId);
    assert.equal(rig.classes.spellClassFor(row.classId), p.list, `the class casts from the ${rig.classes.spellClassFor(row.classId)} list`);
    assert.equal(klass.spellAbility, p.ability, `the class casts with ${klass.spellAbility}`);
    const slots = rig.srd.spellSlotsFor(row.classId, row.level);
    assert.ok(Object.keys(slots ?? {}).length > 0 || klass.casterType === "half", `a level ${row.level} ${row.classId} has no spell slots`);
  },

  // "Double proficiency bonus in two skills": the picks the sheet is owed.
  async expertise(rig, row, p) {
    const slots = rig.features.expertiseSlotsFor(row.classId, row.level);
    assert.equal(slots, p.slots, `a level ${row.level} ${row.classId} is owed ${slots} expertise pick(s), and the text gives ${p.slots} by now`);
  },

  // No hook at all: the feature is its sentence in the GM's prompt.
  async unhooked(rig, row) {
    const hero = rig.holder(row);
    const hooks = rig.engineHooks(hero, row);
    const typed = [...hooks.effects, ...hooks.authored, ...hooks.counter.filter((entry) => !/:narrative$/.test(entry))];
    assert.ok(typed.length > 0, `nothing in the engine answers to ${row.name}: no typed effect, no authored row, no typed counter (its counter: ${hooks.counter.join(", ") || "none"})`);
  },
  // A counter whose text states a mechanic: its spend moves something besides the counter.
  async spend_moves(rig, row, p) {
    const hero = rig.holder(row);
    const { near } = await rig.fight(hero);
    rig.world.patch(rig.ally.id, { currentHp: 60 });
    const vitals = (sheet) => [sheet.currentHp, sheet.tempHp, sheet.conditions, sheet.spellcasting?.slots ?? null, sheet.ac, sheet.concentratingOn ?? null];
    const read = () => JSON.stringify({ hero: vitals(rig.world.sheet(hero.id)), ally: vitals(rig.world.sheet(rig.ally.id)), foes: rig.world.enemies().map((enemy) => [enemy.currentHp, enemy.conditions]) });
    const before = read();
    let out = await rig.world.invoke("use_resource", { characterId: hero.id, resource: p.id, targetEnemyId: near.id, targetCharacterId: rig.ally.id, reason: "clause probe" });
    if (!out.ok) out = await rig.world.invoke("use_resource", { characterId: hero.id, resource: p.id, reason: "clause probe" });
    assert.equal(out.ok, true, `use_resource ${p.id}: ${out.error}`);
    const typed = out.result.resolveWith || out.result.applied || out.result.teleport || out.result.healed;
    assert.ok(read() !== before || typed, `the spend moved the counter and nothing else; the result is the text handed back: ${JSON.stringify(out.result).slice(0, 180)}`);
  },

  // "allies within 60 ft regain 5d8 HP": a typed heal reaches everyone the text names.
  async fx_heal(rig, row, p) {
    const hero = rig.holder(row);
    await rig.fight(hero);
    rig.world.patch(hero.id, { currentHp: 40 });
    rig.world.patch(rig.ally.id, { currentHp: 40 });
    if (p.allyAt) rig.kit.place(rig.ally.id, ...p.allyAt);
    clearDice();
    dice(...new Array(p.count).fill(3));
    const out = await rig.world.invoke("use_resource", { characterId: hero.id, resource: p.id, targetCharacterId: rig.ally.id, reason: "clause probe" });
    clearDice();
    if (p.allyAt) {
      assert.equal(out.ok, false, `the heal reached an ally 65 feet away (${rig.world.sheet(rig.ally.id).currentHp - 40} hit points)`);
      return;
    }
    assert.equal(out.ok, true, `use_resource ${p.id}: ${out.error}`);
    const gained = { ally: rig.world.sheet(rig.ally.id).currentHp - 40, hero: rig.world.sheet(hero.id).currentHp - 40 };
    if (p.all) {
      assert.ok(gained.ally > 0 && gained.hero > 0, `one spend healed the ally ${gained.ally} and the holder ${gained.hero}: the text heals every ally in reach`);
    } else {
      assert.equal(gained.ally, p.count * 3, `the ally regained ${gained.ally} on ${p.count} dice showing 3`);
    }
  },

  // "falling damage you take is halved", "Immune to falling damage", "ignore the first 20 ft of any fall".
  async fall(rig, row, p) {
    const hero = rig.holder(row);
    const read = async () => {
      rig.world.patch(hero.id, { currentHp: 100, tempHp: 0, conditions: [], conditionMeta: {} });
      clearDice();
      dice(3, 3, 3, 3, 3, 3);
      rig.must(await rig.world.invoke("apply_hazard", { type: "falling", characterIds: [hero.id], feet: 60, reason: "clause probe" }), "apply_hazard falling");
      clearDice();
      return 100 - rig.world.sheet(hero.id).currentHp;
    };
    const { on, off } = await rig.both(hero, row, read);
    assert.equal(off, 18, `a 60-foot fall on six 3s took ${off} without ${row.name}`);
    assert.equal(on, p.want, `a 60-foot fall took ${on} with ${row.name}, and the text makes it ${p.want}`);
  },

  // "escape grapples with advantage".
  async escape_adv(rig, row) {
    const hero = rig.holder(row);
    const { near } = await rig.fight(hero);
    const read = async () => {
      rig.myTurn(hero);
      rig.world.patch(hero.id, { conditions: [], conditionMeta: {} });
      rig.must(await rig.world.invoke("set_condition", { characterId: hero.id, condition: "grappled", sourceEnemyId: near.id, reason: "clause probe" }), "set_condition grappled");
      clearDice();
      diceLog();
      const out = await rig.world.invoke("take_action", { characterId: hero.id, action: "escape", reason: "clause probe" });
      if (!out.ok) throw new Error(`escape: ${out.error}`);
      return diceLog().filter((die) => die.sides === 20).length;
    };
    const { on, off } = await rig.both(hero, row, read);
    assert.equal(on, off + 1, `the escape threw ${on} d20 with ${row.name} and ${off} without it`);
  },

  // "You may attack recklessly: advantage on melee attacks this turn".
  async reckless(rig, row) {
    const hero = rig.holder(row);
    const { near } = await rig.fight(hero);
    clearDice();
    diceLog();
    const out = await rig.kit.attack(hero.id, near.id, { reckless: true });
    assert.equal(out.ok, true, `a reckless attack: ${out.error}`);
    const d20s = diceLog().filter((die) => die.sides === 20).length;
    assert.equal(d20s, 2, `the reckless attack threw ${d20s} d20`);
  },

  // "When you attack with a melee weapon, make one firearm attack as a bonus action."
  async pistol_blade(rig, row) {
    const hero = rig.holder(row, { gear: "firearm" });
    const { near } = await rig.fight(hero);
    const shot = () => rig.kit.attack(hero.id, near.id, { weapon: "Pistol", bonusAttack: "feature" });
    const early = await shot();
    assert.equal(early.ok, false, "the bonus shot went off before any melee attack");
    await rig.swing(hero, near, { weapon: "Rapier" });
    const late = await shot();
    assert.equal(late.ok, true, `the bonus shot after a melee attack: ${late.error}`);
    assert.equal(rig.budget().bonusUsed, true, "the bonus action was not spent");
  },

  // "cast a cantrip as a bonus action after casting a leveled ...": not before one.
  async surge(rig, row, p) {
    const hero = rig.holder(row);
    await rig.fight(hero);
    const early = await rig.world.invoke("use_resource", { characterId: hero.id, resource: p.id, reason: "clause probe" });
    assert.equal(early.ok, false, "the surge was accepted before any levelled spell this turn");
    assert.equal(rig.world.sheet(hero.id).resources[p.id].used, 0, "the refused surge spent a use");
  },

  // The Vanish counter is what a bonus-action Hide spends.
  async route_counter(rig, row, p) {
    const hero = rig.holder(row);
    await rig.fight(hero);
    for (const enemy of rig.world.enemies()) rig.must(await rig.world.invoke("set_condition", { enemyId: enemy.id, condition: "blinded", reason: "clause probe" }), "set_condition blinded");
    const out = await rig.world.invoke("take_action", { characterId: hero.id, action: p.action, bonus: true, reason: "clause probe" });
    assert.equal(out.ok, true, `${p.action} as a bonus action: ${out.error}`);
    assert.equal(rig.world.sheet(hero.id).resources[p.id].used, 1, `the ${p.action} left ${p.id} unspent`);
  },

  // The feature's name answers to nothing its text does not say.
  async stray(rig, row, p) {
    const found = await strayHooks(rig, row, p);
    assert.deepEqual(found, [], `by its name the engine also gives ${row.name}: ${found.join("; ")}`);
  },

  // A d20 on this skill counts as rolled (no floor from a same-named feature).
  async no_floor(rig, row, p) {
    const hero = rig.holder(row);
    clearDice();
    dice(2);
    const out = rig.must(await rig.world.invoke("request_roll", { characterId: hero.id, kind: "skill_check", skill: p.skill, dc: 10, reason: "clause probe" }), "request_roll");
    clearDice();
    assert.equal(out.total, 2 + MOD, `a 2 on the die for ${p.skill} totalled ${out.total}: ${JSON.stringify(out.dice?.[0]?.dice ?? [])}`);
  },
};

// What the engine does for a feature's NAME that its text does not say: an
// effect, an authored row of another class's feature of the same name, a
// spend or a reaction accepted by name.
export async function strayHooks(rig, row, expected = {}) {
  const hero = rig.holder(row);
  const hooks = rig.engineHooks(hero, row);
  const out = [];
  for (const effect of hooks.effects) {
    if (!(expected.effects ?? []).includes(effect)) out.push(`effect ${effect}`);
  }
  for (const key of hooks.authored) {
    if (!key.startsWith("genre::")) out.push(`authored row ${key}`);
  }
  const { near } = await rig.fight(hero);
  const sheet = rig.world.sheet(hero.id);
  const hasCounter = hooks.counter.length > 0;
  const genreRow = hooks.authored.some((key) => key.startsWith("genre::"));
  if (!hasCounter && !genreRow) {
    const out2 = await rig.world.invoke("use_resource", { characterId: hero.id, resource: baseName(row.name), targetEnemyId: near.id, reason: "clause probe" });
    if (out2.ok) out.push(`use_resource "${baseName(row.name)}" accepted: ${JSON.stringify(out2.result).slice(0, 160)}`);
  }
  if (!genreRow && !expected.reaction) {
    rig.world.patch(hero.id, { currentHp: sheet.maxHp });
    await rig.clubbed(near, hero);
    // Off the holder's own turn, as a reaction is taken.
    rig.kit.giveTurn(rig.ally.id);
    clearDice();
    dice(15, 4, 4);
    const out3 = await rig.world.invoke("use_reaction", { characterId: hero.id, feature: baseName(row.name), targetEnemyId: near.id, reason: "clause probe" });
    clearDice();
    // Any held feature may be declared as a reaction and is then "resolved
    // from its own text"; what is looked for is a reaction the engine RUNS.
    const generic = /resolved from its own text/.test(String(out3.result?.note ?? ""));
    if (out3.ok && !generic && !hasCounter) out.push(`use_reaction "${baseName(row.name)}" accepted: ${JSON.stringify(out3.result).slice(0, 160)}`);
  }
  return out;
}

export { baseName, slug };
