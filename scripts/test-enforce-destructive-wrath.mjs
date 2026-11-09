// Destructive Wrath (Tempest Domain 2): "When you roll lightning or thunder
// damage, you can use your Channel Divinity to deal maximum damage, instead of
// rolling" (src/lib/dm/destructive-wrath.ts).
//
// Before this the card in the Hand spent the use and changed nothing. Now a
// hit offers it on the card the hit waits on, as Touch of Death is offered,
// and the rolls the server makes at once (a save spell, an area, Wrath of the
// Storm) take a use held from the Hand. Only the lightning and thunder dice
// are dealt at their maximum (destructive-wrath-logic.ts).
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-destructive-wrath");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed" } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { attackWrathDice, expressionMaximum } = await import("../src/lib/dm/destructive-wrath-logic.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { createHomebrew } = await import("../src/lib/db/homebrew.ts");
const route = {
  choice: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"),
  pending: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
  revert: await world.route("campaigns/[campaignId]/audit/revert-turn"),
};

// Spells of two types, one of them thunder or lightning (aoe-parts.ts).
const brew = (name, mech, desc) =>
  createHomebrew(world.owner.id, { kind: "spell", name, data: { desc, level: 2, classes: ["cleric"], school: "evocation", castingTime: "1 action", range: "60 feet", mech } });
brew("Storm Burst", { resolution: "save", save: "dex", halfOnSave: true, damageType: "fire", secondType: "thunder", dice: { base: "2d6+2d8", baseLevel: 2 } },
  "The target must make a Dexterity saving throw, taking 2d6 fire damage and 2d8 thunder damage on a failed save, or half as much on a successful one.");
brew("Spark Burst", { resolution: "save", save: "dex", halfOnSave: true, damageType: "lightning", secondType: "fire", dice: { base: "2d8+2d6", baseLevel: 2 } },
  "The target must make a Dexterity saving throw, taking 2d8 lightning damage and 2d6 fire damage on a failed save, or half as much on a successful one.");
brew("Thunder Lance", { resolution: "attack", attack: "ranged", damageType: "piercing", secondType: "thunder", dice: { base: "1d8+2d6", baseLevel: 2 } },
  "Make a ranged spell attack against the target. On a hit, the target takes 1d8 piercing damage plus 2d6 thunder damage.");
const hero = world.addHero(caster("cleric", "wis", ["Shatter", "Burning Hands", "Storm Burst", "Spark Burst", "Thunder Lance"], ["Shocking Grasp", "Fire Bolt"], 5, { maxHp: 44 }));
const SPELLCASTING = world.sheet(hero.id).spellcasting;
const ally = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED });
const OPTION = { features: [{ name: "Channel Divinity: Destructive Wrath", description: "" }], resources: { channel_divinity: { max: 2, used: 0 } } };
// An eighth-level Tempest cleric with a warhammer: 1d8+3 bludgeoning, and
// Divine Strike's 1d8 thunder once a turn.
const tempest = world.addHero({
  class: "cleric", subclass: "Tempest Domain", level: 8, maxHp: 60, abilities: { str: 16, wis: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Warhammer", qty: 1, equipped: true }],
});
const TEMPEST = {
  features: [...world.sheet(tempest.id).features.filter((feature) => !/destructive wrath/i.test(feature.name)), { name: "Channel Divinity: Destructive Wrath", description: "" }],
  resources: { ...world.sheet(tempest.id).resources, channel_divinity: { max: 2, used: 0 } },
};

async function stage(patch = OPTION, who = hero) {
  await kit.endFight();
  world.patch(hero.id, { currentHp: 44, tempHp: 0, conditions: [], conditionMeta: {}, feats: [], spellcasting: SPELLCASTING, ...(who === hero ? patch : OPTION) });
  world.patch(tempest.id, { currentHp: 60, tempHp: 0, conditions: [], conditionMeta: {}, ...(who === tempest ? patch : TEMPEST) });
  await kit.fight(1, { heroFaces: { [who.id]: 19, [hero.id === who.id ? tempest.id : hero.id]: 3, [ally.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 10, saveMods: { str: -9, dex: -9, con: -9, int: -9, wis: -9, cha: -9 } });
  kit.place(who.id, 5, 5);
  kit.place(who.id === hero.id ? tempest.id : hero.id, 8, 8);
  kit.place(ally.id, 2, 2);
  kit.place(enemy.id, 5, 6);
  return enemy;
}
const hold = (who = hero) => world.invoke("use_resource", { characterId: who.id, resource: "Channel Divinity", variant: "destructive wrath" });
const holds = (who = hero) => world.sheet(who.id).conditions.includes("destructive wrath");
const used = (who = hero) => world.sheet(who.id).resources.channel_divinity.used;
const lost = (enemy) => 400 - kit.enemy(enemy.id).currentHp;
const open = () => listOpenPendingRolls(world.campaignId);
const offered = () => (open().find((entry) => entry.thrown)?.thrown?.options ?? []).map((option) => option.id);
const choose = (who, pendingId, body) => {
  world.signIn({ id: world.sheet(who.id).userId });
  return call(route.choice, "POST", body, { campaignId: world.campaignId, pendingRollId: pendingId });
};
const grasp = (enemy) => world.invoke("pc_attack", { characterId: hero.id, enemyId: enemy.id, targetEnemyId: enemy.id, spell: "Shocking Grasp", damage: "1d8" });
async function revertTurn(turnId) {
  world.signIn(world.owner);
  const response = await route.revert.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

await test("The card holds it, the use is spent, and a second is refused with nothing spent.", async () => {
  await stage();
  const first = await hold();
  assert.equal(first.ok, true, first.error);
  assert.equal(used(), 1);
  assert.equal(holds(), true);
  const second = await hold();
  assert.equal(second.ok, false);
  assert.equal(used(), 1);
});

await test("The card is in the Hand until it is held, and says it is held for the next lightning or thunder.", async () => {
  await stage();
  const card = () => deriveHand(world.sheet(hero.id), FRESH_TURN, {}).find((entry) => entry.name === "Destructive Wrath");
  assert.ok(card());
  assert.match(card().rules, /next lightning or thunder damage/);
  await hold();
  assert.equal(card(), undefined);
});

await test("A sheet without the option is refused, with nothing spent.", async () => {
  await stage({ features: [], resources: { channel_divinity: { max: 2, used: 0 } } });
  const out = await hold();
  assert.equal(out.ok, false);
  assert.equal(used(), 0);
  assert.equal(holds(), false);
});

await test("An area spell of its type deals its dice's maximum and ends the hold. Without it the dice are rolled.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(2);
  const out = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Shatter", level: 2, enemyIds: [enemy.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(enemy), 24, "Shatter's 3d8 at their maximum");
  assert.match(JSON.stringify(out), /Destructive Wrath: the lightning and thunder dice dealt at their maximum/);
  assert.equal(holds(), false);
  const plain = await stage();
  world.dice(1, 1, 1, 1);
  const rolled = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Shatter", level: 2, enemyIds: [plain.id] });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  assert.ok(lost(plain) < 24, `rolled ${lost(plain)}`);
});

await test("A character's area with no spell named (a blue dragonborn's breath) takes the hold too.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(1, 1);
  const out = await world.invoke("aoe_damage", { casterCharacterId: hero.id, damage: "2d6", type: "lightning", saveAbility: "dex", dc: 13, enemyIds: [enemy.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(enemy), 12, "2d6 at their maximum");
  assert.equal(holds(), false);
});

await test("cast_at_enemy reaches it too.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(2);
  const out = await world.invoke("cast_at_enemy", { characterId: hero.id, targetEnemyId: enemy.id, spell: "Shatter", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(enemy), 24);
  assert.equal(holds(), false);
});

await test("A two-type spell: only its thunder or lightning part is at its maximum, and each part keeps its type.", async () => {
  // Storm Burst's thunder is its second type: 2d6 fire rolled (1 and 1), 2d8
  // thunder at 16, halved to 8 by the creature's resistance.
  const second = await stage();
  kit.setEnemy(second.id, { stats: { resist: "thunder" } });
  await hold();
  world.dice(2, 1, 1);
  const out = await world.invoke("cast_at_enemy", { characterId: hero.id, targetEnemyId: second.id, spell: "Storm Burst", level: 2 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(second), 2 + 8);
  assert.equal(holds(), false);
  // Spark Burst's lightning is its first type: the fire is still rolled.
  const first = await stage();
  await hold();
  world.dice(2, 1, 1);
  const spark = await world.invoke("cast_at_enemy", { characterId: hero.id, targetEnemyId: first.id, spell: "Spark Burst", level: 2 });
  world.clearDice();
  assert.equal(spark.ok, true, spark.error);
  assert.equal(lost(first), 16 + 2);
  // The same in an area.
  const area = await stage();
  kit.setEnemy(area.id, { stats: { resist: "thunder" } });
  await hold();
  // An area rolls its damage before the creature's save.
  world.dice(1, 1, 2);
  const burst = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Storm Burst", level: 2, enemyIds: [area.id] });
  world.clearDice();
  assert.equal(burst.ok, true, burst.error);
  assert.equal(lost(area), 2 + 8);
  // An attack spell whose thunder is its second type: the piercing is rolled.
  const lance = await stage();
  await hold();
  // Ranged beside the goblin: two d20s at disadvantage, then the piercing die.
  world.dice(18, 18, 3);
  const hit = await world.invoke("pc_attack", { characterId: hero.id, enemyId: lance.id, targetEnemyId: lance.id, spell: "Thunder Lance", level: 2 });
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  assert.equal(lost(lance), 3 + 12);
  assert.equal(holds(), false);
});

await test("Another type's spell leaves the hold in place.", async () => {
  const enemy = await stage();
  await hold();
  const out = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Burning Hands", level: 1, enemyIds: [enemy.id] });
  assert.equal(out.ok, true, out.error);
  assert.equal(holds(), true);
  assert.doesNotMatch(JSON.stringify(out), /Destructive Wrath/);
});

await test("A held use: an attack spell of its type deals its maximum on a hit, and a miss keeps the hold.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(2);
  const missed = await grasp(enemy);
  world.clearDice();
  assert.equal(missed.ok, true, missed.error);
  assert.equal(lost(enemy), 0);
  assert.equal(holds(), true, "no damage was rolled");
  const again = await stage();
  await hold();
  world.dice(18);
  const hit = await grasp(again);
  world.clearDice();
  assert.equal(hit.ok, true, hit.error);
  assert.equal(lost(again), 16, "Shocking Grasp at 5th level is 2d8, at its maximum");
  assert.equal(holds(), false);
  assert.equal(open().length, 0, "nothing waits: the use was already held");
});

await test("A critical's doubled dice are at their maximum too.", async () => {
  const enemy = await stage();
  await hold();
  world.dice(20);
  const out = await grasp(enemy);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(enemy), 32, "2d8 doubled is 4d8, at its maximum");
});

await test("Elemental Adept's floored dice are maximized, not written as a broken expression.", async () => {
  const enemy = await stage({ ...OPTION, feats: ["Elemental Adept"], features: [...OPTION.features, { name: "Elemental Adept: lightning", source: "story" }] });
  await hold();
  world.dice(18);
  const out = await grasp(enemy);
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(enemy), 16);
  assert.equal(holds(), false);
});

await test("Divine Strike's thunder takes a held use: its die at the maximum, the warhammer's rolled, each meeting its own resistance.", async () => {
  const enemy = await stage(TEMPEST, tempest);
  kit.setEnemy(enemy.id, { stats: { resist: "thunder" } });
  await hold(tempest);
  const swing = await kit.swing(tempest.id, enemy.id, [15, 3], { weapon: "Warhammer" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.unused, 0);
  // Warhammer 3 + STR 3 = 6 bludgeoning; the thunder 8, halved to 4.
  assert.equal(lost(enemy), 6 + 4);
  assert.equal(holds(tempest), false);
});

await test("Only the lightning and thunder dice are maximized: a rider of the same dice and another type is still rolled.", async () => {
  // A lightning blow with a radiant rider of the same dice.
  const own = attackWrathDice("1d8+3+1d8", "lightning", [{ dice: "1d8", type: "radiant" }], { crit: false });
  assert.equal(own.expression, "8+3+1d8");
  assert.deepEqual(own.riders, [{ dice: "1d8", type: "radiant" }]);
  // A bludgeoning blow with a thunder rider of the same dice, and on a
  // critical, where both copies of the rider are its.
  const rider = attackWrathDice("1d8+3+1d8", "bludgeoning", [{ dice: "1d8", type: "thunder" }], { crit: false });
  assert.equal(rider.expression, "1d8+3+8");
  assert.deepEqual(rider.riders, [{ dice: "", type: "thunder", flat: 8 }]);
  const crit = attackWrathDice("1d8+1d8+3+1d8+1d8", "bludgeoning", [{ dice: "1d8", type: "thunder" }], { crit: true });
  assert.equal(crit.expression, "1d8+1d8+3+16");
  assert.equal(attackWrathDice("1d8+3", "bludgeoning", [{ dice: "1d6", type: "radiant" }], { crit: false }), null);
  assert.equal(attackWrathDice("2d8", "thunder", [], { crit: false }).noDice, true);
  assert.equal(expressionMaximum("2d8f2+3"), 19);
});

await test("With no use held, a hit that rolls lightning waits on the card, and choosing it deals the maximum with no damage roll.", async () => {
  const enemy = await stage();
  world.dice(18);
  await grasp(enemy);
  world.clearDice();
  assert.deepEqual(offered(), ["destructive_wrath"]);
  assert.equal(used(), 0, "nothing is spent until they choose");
  assert.equal(lost(enemy), 0, "the hit has not landed yet");
  const [pending] = open();
  const out = await choose(hero, pending.id, { use: "destructive_wrath" });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(used(), 1);
  assert.equal(lost(enemy), 16);
  assert.match(getPendingRoll(pending.id).combatNote, /Destructive Wrath/);
  assert.equal(holds(), false);
});

await test("Keeping the roll rolls the damage and spends nothing; a fire spell, a miss and an empty pool offer nothing.", async () => {
  const kept = await stage();
  world.dice(18);
  await grasp(kept);
  const [pending] = open();
  world.dice(1, 1);
  const out = await choose(hero, pending.id, { keep: true });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(used(), 0);
  assert.equal(lost(kept), 2);
  const fire = await stage();
  world.dice(18, 1, 1);
  await world.invoke("pc_attack", { characterId: hero.id, enemyId: fire.id, targetEnemyId: fire.id, spell: "Fire Bolt", damage: "1d10" });
  world.clearDice();
  assert.equal(open().length, 0, "fire is not its type");
  const missed = await stage();
  world.dice(2);
  await grasp(missed);
  world.clearDice();
  assert.equal(open().length, 0, "a miss rolls no damage");
  const empty = await stage({ ...OPTION, resources: { channel_divinity: { max: 2, used: 2 } } });
  world.dice(18, 1, 1);
  await grasp(empty);
  world.clearDice();
  assert.equal(open().length, 0, "no use left");
});

await test("Divine Strike on a weapon hit offers it: the thunder at its maximum, the warhammer rolled.", async () => {
  const enemy = await stage(TEMPEST, tempest);
  await kit.swing(tempest.id, enemy.id, [15], { weapon: "Warhammer" });
  assert.deepEqual(offered(), ["destructive_wrath"]);
  world.dice(3);
  const out = await choose(tempest, open()[0].id, { use: "destructive_wrath" });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(lost(enemy), 6 + 8);
  assert.equal(used(tempest), 1);
});

await test("A Parry that turns the hit as it lands spends nothing: the card's use is paid by the hit, as Touch of Death's is.", async () => {
  const PARRY = "Reaction: Parry. The captain adds 2 to its AC against one melee attack that would hit it. To do so, the captain must see the attacker and be wielding a melee weapon.";
  const enemy = await stage(TEMPEST, tempest);
  // 9 + 6 meets AC 15 as it stands; the Parry's +2 turns it as it lands.
  kit.setEnemy(enemy.id, { ac: 15, stats: { traits: [PARRY] } });
  await kit.swing(tempest.id, enemy.id, [9], { weapon: "Warhammer" });
  assert.deepEqual(offered(), ["destructive_wrath"]);
  const [pending] = open();
  const out = await choose(tempest, pending.id, { use: "destructive_wrath" });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.match(getPendingRoll(pending.id).combatNote, /MISS/);
  assert.equal(used(tempest), 0, "the Channel Divinity was spent on a hit that never landed");
  assert.equal(lost(enemy), 0);
});

await test("Real dice: the d20 entered at the table waits on the card; all dice maximized asks for no damage roll, and a warhammer's own die is still the player's.", async () => {
  const enemy = await stage();
  setMemberRealDice(world.campaignId, world.sheet(hero.id).userId, true);
  try {
    await grasp(enemy);
    const [toHit] = open();
    assert.equal(toHit.parkedFor, "real_dice");
    world.signIn({ id: world.sheet(hero.id).userId });
    const entered = await call(route.pending, "POST", { dice: [18] }, { campaignId: world.campaignId, pendingRollId: toHit.id });
    assert.equal(entered.status, 200, JSON.stringify(entered.json));
    assert.deepEqual(getPendingRoll(toHit.id).thrown.options.map((option) => option.id), ["destructive_wrath"]);
    await choose(hero, toHit.id, { use: "destructive_wrath" });
    assert.equal(open().filter((entry) => entry.kind === "damage").length, 0, "no dice are left to roll");
    assert.equal(lost(enemy), 16);
  } finally {
    setMemberRealDice(world.campaignId, world.sheet(hero.id).userId, false);
  }
  const struck = await stage(TEMPEST, tempest);
  setMemberRealDice(world.campaignId, world.sheet(tempest.id).userId, true);
  try {
    await world.invoke("pc_attack", { characterId: tempest.id, targetEnemyId: struck.id, weapon: "Warhammer" });
    const [toHit] = open();
    world.signIn({ id: world.sheet(tempest.id).userId });
    await call(route.pending, "POST", { dice: [15] }, { campaignId: world.campaignId, pendingRollId: toHit.id });
    await choose(tempest, toHit.id, { use: "destructive_wrath" });
    const damage = open().find((entry) => entry.kind === "damage");
    assert.ok(damage, "the warhammer's die is the player's to roll");
    assert.equal(damage.expression, "1d8+3+8");
    world.signIn({ id: world.sheet(tempest.id).userId });
    const rolled = await call(route.pending, "POST", { dice: [3] }, { campaignId: world.campaignId, pendingRollId: damage.id });
    assert.equal(rolled.status, 200, JSON.stringify(rolled.json));
    assert.equal(lost(struck), 6 + 8);
  } finally {
    setMemberRealDice(world.campaignId, world.sheet(tempest.id).userId, false);
  }
});

await test("A held use lasts through the end of a fight, and the short rest that gives the use back ends it.", async () => {
  await stage();
  await hold();
  const ended = await world.invoke("end_encounter", { outcome: "truce" });
  assert.equal(ended.ok, true, ended.error);
  assert.equal(holds(), true, "a fight with no lightning in it does not take it");
  const out = await world.invoke("take_rest", { kind: "short", reason: "breath" });
  assert.equal(out.ok, true, out.error);
  assert.equal(holds(), false);
  assert.equal(used(), 0);
});

await test("Reverting the turn that spent the hold puts it back; reverting the turn that took it gives the use back.", async () => {
  const enemy = await stage();
  const taken = await hold();
  assert.equal(taken.ok, true, taken.error);
  world.dice(2);
  const cast = await world.invoke("aoe_damage", { casterCharacterId: hero.id, spell: "Shatter", level: 2, enemyIds: [enemy.id] });
  world.clearDice();
  assert.equal(holds(), false);
  const back = await revertTurn(cast.turnId);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(holds(), true);
  assert.equal(used(), 1);
  const undone = await revertTurn(taken.turnId);
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  assert.equal(holds(), false);
  assert.equal(used(), 0);
});

world.close();
finish();
