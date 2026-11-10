// The mystery, post-apocalyptic and steampunk classes' features, third suite
// (WAVE2 D5): what a genre caster's features add to a spell once it lands
// (src/lib/dm/genre-b-spell-hits.ts, from cast-at-enemy-damage.ts
// landSpellDamage and heal-spell.ts). Each case fails without its mechanism;
// the clause ledgers (scripts/clauses/genre-*.json) point here for the clauses
// they hold.
//
// Dice forced; every check reads an enemy's hit points, a condition, an AC or
// a heal's total.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { dice, clearDice } from "./lib/enforce-world.mjs";

const SRC = new URL("../src/", import.meta.url);
const { enemyAcWithEffects } = await import(new URL("lib/dm/ac-effects.ts", SRC).href);
const encounters = await import(new URL("lib/db/encounters.ts", SRC).href);

const { test, finish } = suite("test-genre-b-features-3");
const rig = await clausesRig();
const { world, kit, ally } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};

// A caster of the holder's class with the cantrips the cases cast and slots for a heal.
function caster(hero, ability = "int") {
  world.patch(hero.id, {
    equipment: [...world.sheet(hero.id).equipment, { name: "Component Pouch", qty: 1 }],
    spellcasting: { ability, slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, prepared: ["Cure Wounds"], known: [], cantrips: ["Acid Splash", "Shocking Grasp", "Sacred Flame"] },
  });
}

// One cantrip at the near enemy: the save's d20 a 1, every damage die a 3.
async function castAt(hero, enemy, spell, faces = [1, 3, 3, 3, 3, 3]) {
  clearDice();
  dice(...faces);
  if (spell === "Shocking Grasp") {
    const out = rig.must(await world.invoke("pc_attack", { characterId: hero.id, targetEnemyId: enemy.id, spell }), `pc_attack ${spell}`);
    clearDice();
    return out;
  }
  const args = { characterId: hero.id, targetEnemyId: enemy.id, spell, ...(spell === "Shocking Grasp" ? {} : { saveAbility: spell === "Acid Splash" ? "dex" : "dex" }) };
  const out = rig.must(await world.invoke("cast_at_enemy", args), `cast_at_enemy ${spell}`);
  clearDice();
  return out;
}
const lost = (enemy) => 300 - kit.enemy(enemy.id).currentHp;
// The action back, so a second cantrip is cast in the same turn.
function actionBack() {
  const encounter = world.encounter();
  encounters.saveEncounter({ ...encounter, turnBudget: { ...encounter.turnBudget, actionUsed: false, castThisAction: false, castLeveledBonus: false } });
}

// ---- once-a-turn riders ----

for (const [classId, name, level, spell, type, extra] of [
  ["alchemist", "Corrosive Focus", 2, "Acid Splash", "acid", 3],
  ["waste_preacher", "Judgment", 11, "Sacred Flame", "radiant", 3],
  ["salvage_tech", "Blessed Isotope", 3, "Acid Splash", "radiant", 3],
  ["aether_channeler", "Dynamo Spark", 1, "Acid Splash", "lightning", 3],
]) {
  await run(`${name}: a damaging spell deals +${extra} ${type} once a turn, and the second spell of the turn does not`, async () => {
    const hero = rig.holder(feature(classId, name, level));
    caster(hero, classId === "aether_channeler" ? "cha" : classId === "waste_preacher" ? "wis" : "int");
    const { near } = await rig.fight(hero);
    const base = await rig.without(hero, { name }, async () => {
      await castAt(hero, near, spell);
      return lost(near);
    });
    kit.setEnemy(near.id, { currentHp: 300 });
    rig.myTurn(hero);
    await castAt(hero, near, spell);
    const first = lost(near);
    assert.equal(first - base, extra, `the spell took ${first} with ${name} and ${base} without it`);
    actionBack();
    await castAt(hero, near, spell);
    assert.equal(lost(near) - first, base, `the second spell of the turn took ${lost(near) - first}, and once a turn makes it ${base}`);
  });
}

// ---- Volatile Chain, Chain Arc ----

await run("Volatile Chain: a creature beside the target takes the INT modifier, one farther off nothing", async () => {
  const hero = rig.holder(feature("alchemist", "Volatile Chain", 14));
  caster(hero);
  const { near, far } = await rig.fight(hero);
  kit.place(far.id, 7, 2);
  await castAt(hero, near, "Shocking Grasp", [15, 3, 3, 3, 3]);
  assert.equal(lost(far), 3, `the creature beside the target lost ${lost(far)}`);
  kit.setEnemy(far.id, { currentHp: 300 });
  kit.place(far.id, 9, 2);
  rig.myTurn(hero);
  await castAt(hero, near, "Shocking Grasp", [15, 3, 3, 3, 3]);
  assert.equal(lost(far), 0, `a creature 10 ft from the target lost ${lost(far)}`);
});

await run("Chain Arc: the spent arc jumps a lightning spell to a creature within 15 ft for half, once", async () => {
  const hero = rig.holder(feature("aether_channeler", "Chain Arc", 6));
  caster(hero, "cha");
  const { near, far } = await rig.fight(hero);
  kit.place(far.id, 8, 2);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Chain Arc", reason: "test" }), "use_resource Chain Arc");
  // Shocking Grasp at level 6: 2d8, two 6s; the jump is half of those 12.
  await castAt(hero, near, "Shocking Grasp", [15, 6, 6, 6, 6]);
  assert.equal(lost(far), 6, `the jump dealt ${lost(far)} (the target lost ${lost(near)})`);
  const after = lost(far);
  rig.myTurn(hero);
  await castAt(hero, near, "Shocking Grasp", [15, 6, 6, 6, 6]);
  assert.equal(lost(far), after, "the arc jumped a second time");
});

// ---- Etching Acid, Universal Solvent ----

await run("Etching Acid: acid that lands takes 1 off the AC, not cumulative; Universal Solvent stacks it to -3", async () => {
  const hero = rig.holder(feature("alchemist", "Etching Acid", 2));
  caster(hero);
  const { near } = await rig.fight(hero);
  const ac = () => enemyAcWithEffects(world.campaignId, kit.enemy(near.id));
  const before = ac();
  await castAt(hero, near, "Acid Splash");
  assert.equal(ac(), before - 1, `after the acid the AC is ${ac()} (${before} before)`);
  rig.myTurn(hero);
  await castAt(hero, near, "Acid Splash");
  assert.equal(ac(), before - 1, `a second splash made it ${ac()}`);
  const solvent = rig.holder(feature("alchemist", "Universal Solvent", 14));
  caster(solvent);
  await rig.fight(solvent);
  const target = world.enemies()[0];
  const start = enemyAcWithEffects(world.campaignId, kit.enemy(target.id));
  for (let index = 0; index < 4; index += 1) {
    rig.myTurn(solvent);
    await castAt(solvent, target, "Acid Splash");
  }
  assert.equal(enemyAcWithEffects(world.campaignId, kit.enemy(target.id)), start - 3, "Universal Solvent's etching did not stop at -3");
});

// ---- Overcharge, Catalyst Stone ----

await run("Overcharge: the next damaging spell rolls its dice at their maximum and the channeler takes 1d10 lightning", async () => {
  const hero = rig.holder(feature("aether_channeler", "Overcharge", 13));
  caster(hero, "cha");
  const { near } = await rig.fight(hero);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Overcharge", reason: "test" }), "use_resource Overcharge");
  const hp = world.sheet(hero.id).currentHp;
  // Acid Splash at 13: 3d6 at their maximum, 18; Dynamo Spark +3 lightning.
  await castAt(hero, near, "Acid Splash", [1, 4, 1, 1, 1, 1]);
  assert.equal(lost(near), 18 + 3, `the overcharged splash took ${lost(near)}`);
  // The 4 meets the channeler's own Grounded Stance (lightning resistance): 2.
  assert.equal(hp - world.sheet(hero.id).currentHp, 2, "the backlash did not land its 1d10");
  kit.setEnemy(near.id, { currentHp: 300 });
  rig.myTurn(hero);
  await castAt(hero, near, "Acid Splash", [1, 1, 1, 1, 1, 1]);
  assert.equal(lost(near), 3 + 3, `the charge was not spent: the next splash took ${lost(near)}`);
});

await run("Catalyst Stone: the spent stone adds +1d4 to one spell's damage, then is gone", async () => {
  const hero = rig.holder(feature("alchemist", "Catalyst Stone", 1));
  caster(hero);
  const { near } = await rig.fight(hero);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Catalyst Stone", reason: "test" }), "use_resource Catalyst Stone");
  await castAt(hero, near, "Acid Splash", [1, 3, 2, 3]);
  assert.equal(lost(near), 5, `the catalysed splash took ${lost(near)}`);
  rig.myTurn(hero);
  await castAt(hero, near, "Acid Splash", [1, 3, 2, 3]);
  assert.equal(lost(near), 8, "the stone was not spent");
});

await run("Improved Catalyst: the stone adds +1d8, three times a rest", async () => {
  const hero = rig.holder(feature("alchemist", "Improved Catalyst", 9));
  caster(hero);
  assert.equal(world.sheet(hero.id).resources.steampunk_catalyst_stone?.max, 3, "the stone has not three uses");
  const { near } = await rig.fight(hero);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Catalyst Stone", reason: "test" }), "use_resource Catalyst Stone");
  // Acid Splash at 9: 2d6 (two 3s), Corrosive Focus's d6 a 1, the stone's d8 a 7.
  await castAt(hero, near, "Acid Splash", [1, 3, 3, 1, 7, 1]);
  assert.equal(lost(near), 14, `the catalysed splash took ${lost(near)}`);
});

await run("Catalyst Stone: or +1d4 to one healing spell, and the heal spends it", async () => {
  const hero = rig.holder(feature("alchemist", "Catalyst Stone", 1));
  caster(hero);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Catalyst Stone", reason: "test" }), "use_resource Catalyst Stone");
  world.patch(ally.id, { currentHp: 40 });
  clearDice();
  dice(5, 2, 5, 2);
  rig.must(await world.invoke("heal", { characterId: ally.id, casterId: hero.id, spell: "Cure Wounds", level: 1 }), "heal");
  // 1d8 (5) + INT 3 + the stone's 2.
  assert.equal(world.sheet(ally.id).currentHp, 50, `the healed ally stands at ${world.sheet(ally.id).currentHp}`);
  assert.ok(!world.sheet(hero.id).conditions.includes("catalyst stone"), "the heal did not spend the stone");
});

// ---- healing sermons ----

await run("Lay On the Word: a preacher's healing adds the WIS modifier again", async () => {
  const hero = rig.holder(feature("waste_preacher", "Lay On the Word", 5));
  caster(hero, "wis");
  world.patch(ally.id, { currentHp: 40 });
  const heal = async () => {
    world.patch(ally.id, { currentHp: 40 });
    clearDice();
    dice(5, 5);
    rig.must(await world.invoke("heal", { characterId: ally.id, casterId: hero.id, spell: "Cure Wounds", level: 1 }), "heal");
    return world.sheet(ally.id).currentHp - 40;
  };
  const { on, off } = await rig.both(hero, { name: "Lay On the Word" }, heal);
  assert.equal(on - off, 3, `the heal restored ${on} with the feature and ${off} without it`);
});

await run("Baptism of Ash: a creature healed from below half has +1 to attack rolls until the preacher's next turn", async () => {
  const hero = rig.holder(feature("waste_preacher", "Baptism of Ash", 6));
  caster(hero, "wis");
  world.patch(ally.id, { currentHp: 40 });
  clearDice();
  dice(5);
  rig.must(await world.invoke("heal", { characterId: ally.id, casterId: hero.id, spell: "Cure Wounds", level: 1 }), "heal");
  const sheet = world.sheet(ally.id);
  assert.ok(sheet.conditions.includes("baptism of ash"), `the healed ally holds ${JSON.stringify(sheet.conditions)}`);
  assert.equal(sheet.conditionMeta["baptism of ash"]?.untilTurnOf, hero.id, "it does not end on the preacher's next turn");
  world.patch(ally.id, { currentHp: 90, conditions: [], conditionMeta: {} });
  clearDice();
  dice(5);
  rig.must(await world.invoke("heal", { characterId: ally.id, casterId: hero.id, spell: "Cure Wounds", level: 1 }), "heal");
  assert.ok(!world.sheet(ally.id).conditions.includes("baptism of ash"), "an ally above half was blessed too");
});

world.close();
finish();
