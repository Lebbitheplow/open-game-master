// The mystery, post-apocalyptic and steampunk classes' features do what their
// catalog text says (WAVE2 D5, src/lib/srd/authored-effects-genre-b.ts,
// src/lib/srd/genre-b-combat.ts, src/lib/srd/genre-b-conditions.ts,
// src/lib/srd/genre-b-counter-terms.ts). Each case was a sentence in the GM's
// prompt before, so each fails without its row: the clause ledgers
// (scripts/clauses/genre-*.json) point here for the clauses their own probes
// cannot separate (a feature that stacks with another of the same level, a
// reaction that answers a hit rather than a turn).
//
// Dice forced; every check reads a sheet, a roll's expression or a refusal.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { dice, clearDice } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-genre-b-features");
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

await run("Lightning Rod: immune to lightning, on top of Grounded Stance's resistance", async () => {
  const row = feature("aether_channeler", "Lightning Rod", 17);
  const hero = rig.holder(row);
  const { on, off } = await rig.both(hero, row, () => rig.damageLost(hero, "lightning"));
  assert.equal(on, 0, `20 lightning took ${on}`);
  assert.equal(off, 10, `without Lightning Rod the same blow took ${off}, and Grounded Stance halves it`);
});

await run("Last Man Standing: below half, +10 on a hit and resistance to every type", async () => {
  const row = feature("enforcer", "Last Man Standing", 20);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  world.patch(hero.id, { currentHp: 100 });
  const whole = await kit.swing(hero.id, near.id, [15, 3, 3, 3, 3]);
  assert.ok(!/\+10\b/.test(whole.damage?.expression ?? ""), `at full hit points the hit rolls ${whole.damage?.expression}`);
  rig.myTurn(hero);
  world.patch(hero.id, { currentHp: 30 });
  const low = await kit.swing(hero.id, near.id, [15, 3, 3, 3, 3]);
  assert.match(low.damage?.expression ?? "", /\+10\b/, `below half the hit rolls ${low.damage?.expression}`);
  assert.equal(await rig.damageLost(hero, "fire", undefined, 30), 10, "below half 20 fire is halved");
  assert.equal(await rig.damageLost(hero, "fire", undefined, 100), 20, "at full hit points it is not");
});

await run("Piston Strike: +1d6 bludgeoning once a turn, +2d6 under Head of Steam", async () => {
  const row = feature("steam_knight", "Head of Steam", 2);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const first = await kit.swing(hero.id, near.id, [15, 3, 3, 3, 3]);
  assert.match(first.damage?.expression ?? "", /\+1d6\b/, `the first hit rolls ${first.damage?.expression}`);
  rig.myTurn(hero);
  const steam = await world.invoke("use_resource", { characterId: hero.id, resource: "Head of Steam", reason: "test" });
  assert.equal(steam.ok, true, steam.error);
  const pressed = await kit.swing(hero.id, near.id, [15, 3, 3, 3, 3]);
  assert.match(pressed.damage?.expression ?? "", /\+2d6\b/, `under Head of Steam the hit rolls ${pressed.damage?.expression}`);
});

await run("Hard to Kill holds the enforcer at 1 hit point once, and is no use_resource spend", async () => {
  const row = feature("enforcer", "Hard to Kill", 7);
  const hero = rig.holder(row);
  world.patch(hero.id, { currentHp: 10 });
  const held = await world.invoke("apply_damage", { characterId: hero.id, amount: 15, type: "slashing", reason: "test" });
  assert.equal(held.ok, true, held.error);
  assert.equal(world.sheet(hero.id).currentHp, 1, "the blow dropped them");
  assert.equal(world.sheet(hero.id).resources.mystery_hard_to_kill.used, 1, "the use was not spent");
  await world.invoke("apply_damage", { characterId: hero.id, amount: 5, type: "slashing", reason: "test" });
  assert.equal(world.sheet(hero.id).currentHp, 0, "a second drop is not held");
  const bare = await world.invoke("use_resource", { characterId: hero.id, resource: "mystery_hard_to_kill", reason: "test" });
  assert.equal(bare.ok, false, "a bare spend was accepted");
});

await run("Unbreakable: Hard to Kill comes back on a short rest from 17th level", async () => {
  const hero = rig.holder(feature("enforcer", "Unbreakable", 17));
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, mystery_hard_to_kill: { max: 1, used: 1 } } });
  rig.must(await world.invoke("take_rest", { kind: "short" }), "short rest");
  assert.equal(world.sheet(hero.id).resources.mystery_hard_to_kill.used, 0);
});

await run("Ectoplasmic Shield: use_resource points to use_reaction; the reaction halves the hit", async () => {
  const row = feature("spirit_medium", "Ectoplasmic Shield", 6);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const bare = await world.invoke("use_resource", { characterId: hero.id, resource: "mystery_ectoplasmic_shield", reason: "test" });
  assert.equal(bare.ok, false, "use_resource spent the reaction's use with nothing to answer");
  assert.equal(world.sheet(hero.id).resources.mystery_ectoplasmic_shield.used, 0, "the refusal spent a use");
  await rig.clubbed(near, hero);
  assert.equal(world.sheet(hero.id).currentHp, 94, "the staged club did not land for 6");
  kit.giveTurn(ally.id);
  const out = await world.invoke("use_reaction", { characterId: hero.id, feature: "Ectoplasmic Shield", reason: "test" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).currentHp, 97, "the hit was not halved");
  assert.equal(world.sheet(hero.id).resources.mystery_ectoplasmic_shield.used, 1, "the use was not spent");
});

await run("Vitriol Ampoule: the melee attacker takes 2d6 acid, as a reaction", async () => {
  const row = feature("alchemist", "Vitriol Ampoule", 6);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  await rig.clubbed(near, hero);
  kit.giveTurn(ally.id);
  clearDice();
  dice(4, 4);
  const out = await world.invoke("use_reaction", { characterId: hero.id, feature: "Vitriol Ampoule", targetEnemyId: near.id, reason: "test" });
  clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(300 - kit.enemy(near.id).currentHp, 8, `the attacker lost ${300 - kit.enemy(near.id).currentHp}`);
});

await run("Flock's Shepherd: a bonus action gives an ally temporary hit points of level + WIS, never the preacher", async () => {
  const row = feature("waste_preacher", "Flock's Shepherd", 1);
  const hero = rig.holder(row);
  await rig.fight(hero);
  const self = await world.invoke("use_resource", { characterId: hero.id, resource: "Flock's Shepherd", reason: "test" });
  assert.equal(self.ok, false, "the preacher shepherded themselves");
  clearDice();
  const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Flock's Shepherd", targetCharacterId: ally.id, reason: "test" });
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(ally.id).tempHp, 1 + 3, `the ally holds ${world.sheet(ally.id).tempHp} temporary hit points`);
  assert.equal(rig.budget().bonusUsed, true, "the bonus action was not spent");
});

await run("Spirit Ward: +2 AC on the ally named", async () => {
  const row = feature("spirit_medium", "Spirit Ward", 1);
  const hero = rig.holder(row);
  await rig.fight(hero);
  const before = rig.srd.deriveAc(world.sheet(ally.id));
  const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Spirit Ward", targetCharacterId: ally.id, reason: "test" });
  assert.equal(out.ok, true, out.error);
  assert.equal(rig.srd.deriveAc(world.sheet(ally.id)), before + 2);
});

await run("Tempest Shell: +2 AC for a minute, and a melee hit on the channeler takes 2d8 lightning back", async () => {
  const row = feature("aether_channeler", "Tempest Shell", 10);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const before = rig.srd.deriveAc(world.sheet(hero.id));
  const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Tempest Shell", reason: "test" });
  assert.equal(out.ok, true, out.error);
  assert.equal(rig.srd.deriveAc(world.sheet(hero.id)), before + 2);
  kit.handOnEnemies();
  kit.freshRound();
  clearDice();
  dice(19, 4, 5, 5);
  rig.must(await world.invoke("enemy_attack", { enemyId: near.id, targetCharacterId: hero.id }), "enemy_attack");
  clearDice();
  assert.ok(kit.enemy(near.id).currentHp < 300, "the attacker took no lightning");
});

await run("Expertise: a detective is owed two picks at 2nd level and four at 10th", () => {
  assert.equal(rig.features.expertiseSlotsFor("detective", 2), 2);
  assert.equal(rig.features.expertiseSlotsFor("detective", 10), 4);
  assert.equal(rig.features.expertiseSlotsFor("grifter", 9), 2);
});

await run("Heavy Hands: the enforcer's unarmed strike rolls 1d6 + STR", async () => {
  const row = feature("enforcer", "Heavy Hands", 2);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const out = await kit.swing(hero.id, near.id, [15, 3], { weapon: "Unarmed strike" });
  assert.equal(out.damage?.expression, "1d6+3");
});

await run("Intimidating Presence: an enforcer's is a doubled Intimidation, never the Berserker's action", async () => {
  const hero = rig.holder(feature("enforcer", "Intimidating Presence", 1), { skills: ["intimidation"] });
  const { near } = await rig.fight(hero);
  const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Intimidating Presence", targetEnemyId: near.id, reason: "test" });
  assert.equal(out.ok, false, `the Berserker's frighten ran: ${JSON.stringify(out.result ?? {}).slice(0, 160)}`);
  assert.equal(kit.enemy(near.id).conditions.includes("frightened"), false);
  assert.equal(await rig.modifierOf(hero, { kind: "skill_check", skill: "intimidation" }), 3 + 2 * 2);
});

await run("Aether Capacitor: the INT modifier in expended slot levels comes back, the highest first", async () => {
  const hero = rig.holder(feature("machinist", "Aether Capacitor", 13));
  const sheet = world.sheet(hero.id);
  world.patch(hero.id, { spellcasting: { ...sheet.spellcasting, slots: { 1: { max: 4, used: 2 }, 2: { max: 3, used: 1 }, 3: { max: 3, used: 0 } } } });
  const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Aether Capacitor", reason: "test" });
  assert.equal(out.ok, true, out.error);
  const slots = world.sheet(hero.id).spellcasting.slots;
  assert.deepEqual([slots[1].used, slots[2].used], [1, 0], `slots after: ${JSON.stringify(slots)}`);
  world.patch(hero.id, { spellcasting: { ...world.sheet(hero.id).spellcasting, slots: { 1: { max: 4, used: 0 } } }, resources: { ...world.sheet(hero.id).resources, steampunk_aether_capacitor: { max: 1, used: 0 } } });
  const none = await world.invoke("use_resource", { characterId: hero.id, resource: "Aether Capacitor", reason: "test" });
  assert.equal(none.ok, false, "with nothing expended the use was spent");
  assert.equal(world.sheet(hero.id).resources.steampunk_aether_capacitor.used, 0);
});

rig.world.close();
finish();
