// The steampunk classes' features that answer a blow or an effect's end
// (WAVE2 D5: the genre text is the rule), fifth round: a charge the next melee
// hit spends, a vent held to a knight below half, the boiler's debt when Full
// Throttle ends, and a reaction that absorbs lightning
// (src/lib/dm/genre-b-steampunk-ends.ts, genre-b-steampunk-reactions.ts and the
// rows of src/lib/srd/authored-effects-genre-b-steampunk.ts). Each case fails
// without its mechanism; the clause ledger (scripts/clauses/genre-steampunk.json)
// points here for the clauses it holds.
//
// Dice forced; every check reads hit points, a condition, a counter or a slot.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { dice, clearDice } from "./lib/enforce-world.mjs";

const SRC = new URL("../src/", import.meta.url);
const { tickClockConditions } = await import(new URL("lib/dm/condition-tick.ts", SRC).href);
const { settleFullThrottle } = await import(new URL("lib/dm/genre-b-steampunk-ends.ts", SRC).href);
const { getCampaignById } = await import(new URL("lib/db/campaigns.ts", SRC).href);

const { test, finish } = suite("test-genre-b-steampunk-triggers");
const rig = await clausesRig();
const { world, kit } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    rig.reset();
  }
};
const lost = (enemy) => 300 - kit.enemy(enemy.id).currentHp;
const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;
const has = (hero, condition) => world.sheet(hero.id).conditions.includes(condition);
const campaign = () => getCampaignById(world.campaignId);
const spend = async (hero, resource, faces = [], extra = {}) => {
  clearDice();
  dice(...faces);
  const out = await world.invoke("use_resource", { characterId: hero.id, resource, reason: "test", ...extra });
  clearDice();
  return out;
};
// The near foe's attack on the hero: a 16 hits for the dice that follow.
async function struck(enemy, hero, faces) {
  kit.handOnEnemies();
  kit.freshRound();
  clearDice();
  dice(16, ...faces);
  const out = rig.must(await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: hero.id }), "enemy_attack");
  clearDice();
  return out;
}

// ---- Galvanic Discharge, Lightning Rod ----

await run("Galvanic Discharge: the charge shocks the next creature that hits in melee for 1d8 lightning and is spent by it; uncharged, a hit shocks nobody", async () => {
  const hero = rig.holder(feature("aether_channeler", "Galvanic Discharge", 1));
  const { near } = await rig.fight(hero);
  await struck(near, hero, [4, 5]);
  assert.equal(lost(near), 0, `an uncharged channeler shocked its attacker for ${lost(near)}`);
  rig.myTurn(hero);
  rig.must(await spend(hero, "Galvanic Discharge"), "use_resource Galvanic Discharge");
  assert.ok(has(hero, "galvanic discharge"), "the spend laid no charge");
  assert.ok(!rig.budget().actionUsed && !rig.budget().bonusUsed, "charging cost part of the turn");
  await struck(near, hero, [4, 5]);
  assert.equal(lost(near), 5, `the charged hit shocked its attacker for ${lost(near)}`);
  assert.ok(!has(hero, "galvanic discharge"), "the charge outlived the creature it shocked");
  await struck(near, hero, [4, 5]);
  assert.equal(lost(near), 5, "a second hit was shocked by a charge already spent");
});

await run("Lightning Rod: every melee hit shocks its attacker for 1d8 lightning, with no charge spent", async () => {
  const row = feature("aether_channeler", "Lightning Rod", 17);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  await struck(near, hero, [4, 5]);
  await struck(near, hero, [4, 5]);
  assert.equal(lost(near), 10, `two hits shocked their attacker for ${lost(near)}`);
  assert.equal(used(hero, "steampunk_galvanic_discharge"), 0, "the always-active discharge spent a use");
  // A charged hit is the charge's own: one shock, not two.
  kit.setEnemy(near.id, { currentHp: 300 });
  rig.myTurn(hero);
  rig.must(await spend(hero, "Galvanic Discharge"), "use_resource Galvanic Discharge");
  await struck(near, hero, [4, 5]);
  assert.equal(lost(near), 5, `a charged hit on a Lightning Rod shocked for ${lost(near)}`);
  const off = await rig.without(hero, row, async () => {
    kit.setEnemy(near.id, { currentHp: 300 });
    await struck(near, hero, [4, 5]);
    return lost(near);
  });
  assert.equal(off, 0, "without Lightning Rod an uncharged hit shocked its attacker");
});

// ---- Emergency Release ----

await run("Emergency Release: refused at full hit points with nothing spent; below half the vent burns foes within 10 ft for 3d8 fire, half on a made DEX save, and none farther off", async () => {
  const hero = rig.holder(feature("steam_knight", "Emergency Release", 13));
  const { near, far } = await rig.fight(hero);
  const early = await spend(hero, "steampunk_emergency_release", new Array(12).fill(1), { targetEnemyId: near.id });
  assert.ok(!early.ok && /half/.test(early.error), `the vent at full hit points: ${early.error ?? "accepted"}`);
  assert.equal(used(hero, "steampunk_emergency_release"), 0, "the refused vent spent its use");
  world.patch(hero.id, { currentHp: 30 });
  const failed = rig.must(await spend(hero, "steampunk_emergency_release", new Array(12).fill(1), { targetEnemyId: near.id }), "the vent below half");
  assert.equal(failed.saveAbility, "dex", `the vent rolls a ${failed.saveAbility} save`);
  assert.equal(lost(near), 3, `a failed save lost ${lost(near)} of 3d8 showing 1s`);
  assert.equal(lost(far), 0, `a creature 65 feet away lost ${lost(far)}`);
  kit.setEnemy(near.id, { currentHp: 300 });
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, steampunk_emergency_release: { max: 1, used: 0 } } });
  rig.myTurn(hero);
  rig.must(await spend(hero, "steampunk_emergency_release", new Array(12).fill(20), { targetEnemyId: near.id }), "the vent, save made");
  assert.equal(lost(near), 12, `a made save lost ${lost(near)} of 24`);
});

// ---- Full Throttle ----

await run("Full Throttle: when the minute ends the knight takes 3d10 fire, once", async () => {
  const hero = rig.holder(feature("steam_knight", "Full Throttle", 18));
  await kit.endFight();
  rig.must(await spend(hero, "Full Throttle"), "use_resource Full Throttle");
  assert.ok(has(hero, "full throttle"), "no full throttle on the knight");
  // Two minutes on the road: the minute runs out. Reinforced Boiler halves the fire.
  clearDice();
  dice(4, 4, 4);
  tickClockConditions(campaign(), 2);
  clearDice();
  assert.ok(!has(hero, "full throttle") && !has(hero, "boiler strain"), `the knight still carries ${JSON.stringify(world.sheet(hero.id).conditions)}`);
  assert.equal(100 - world.sheet(hero.id).currentHp, 6, `the boiler's end took ${100 - world.sheet(hero.id).currentHp} of 12 fire`);
  // Nothing more is owed.
  dice(4, 4, 4);
  assert.deepEqual(settleFullThrottle(campaign()), [], "the debt was paid twice");
  clearDice();
  assert.equal(100 - world.sheet(hero.id).currentHp, 6, "a second burn landed");
});

await run("Full Throttle: taken off early, the round's wrap still burns the knight", async () => {
  const hero = rig.holder(feature("steam_knight", "Full Throttle", 18));
  await rig.fight(hero);
  rig.must(await spend(hero, "Full Throttle"), "use_resource Full Throttle");
  assert.ok(has(hero, "boiler strain"), "the spend marked no debt");
  assert.deepEqual(settleFullThrottle(campaign()), [], "the wrap burned a knight still at full throttle");
  rig.must(await world.invoke("clear_condition", { characterId: hero.id, condition: "full throttle", reason: "the GM ends it" }), "clear_condition");
  clearDice();
  dice(4, 4, 4);
  const lines = settleFullThrottle(campaign());
  clearDice();
  assert.equal(lines.length, 1, `the wrap said ${JSON.stringify(lines)}`);
  assert.equal(100 - world.sheet(hero.id).currentHp, 6, `the boiler's end took ${100 - world.sheet(hero.id).currentHp}`);
});

// ---- Capacitor Soul ----

await run("Capacitor Soul: a lightning hit is absorbed whole as a reaction and a 1st-level slot comes back; a club's hit is refused with nothing spent", async () => {
  const hero = rig.holder(feature("aether_channeler", "Capacitor Soul", 9));
  const { near } = await rig.fight(hero);
  const casting = world.sheet(hero.id).spellcasting ?? { ability: "cha", slots: {}, prepared: [], known: [], cantrips: [] };
  world.patch(hero.id, { spellcasting: { ...casting, slots: { ...casting.slots, 1: { max: 4, used: 2 } } } });
  const absorb = () => world.invoke("use_reaction", { characterId: hero.id, feature: "Capacitor Soul", reason: "test" });
  await struck(near, hero, [4]);
  assert.ok(world.sheet(hero.id).currentHp < 100, "the club did not land");
  const club = await absorb();
  assert.ok(!club.ok, `Capacitor Soul absorbed a club: ${JSON.stringify(club.result ?? {}).slice(0, 160)}`);
  assert.equal(used(hero, "steampunk_capacitor_soul"), 0, "the refused absorption spent its use");
  world.patch(hero.id, { currentHp: 100 });
  kit.setEnemy(near.id, { stats: { ...kit.enemy(near.id).stats, attacks: [{ name: "Arc", toHit: 4, damage: "1d6+2", type: "lightning" }] } });
  await struck(near, hero, [4]);
  assert.ok(world.sheet(hero.id).currentHp < 100, "the arc did not land");
  rig.must(await absorb(), "use_reaction Capacitor Soul");
  assert.equal(world.sheet(hero.id).currentHp, 100, `the absorbed arc left ${world.sheet(hero.id).currentHp}/100`);
  assert.equal(world.sheet(hero.id).spellcasting.slots[1].used, 1, "no 1st-level slot came back");
  assert.equal(used(hero, "steampunk_capacitor_soul"), 1, "the use was not spent");
  assert.equal(rig.reacted(hero), true, "the reaction was not spent");
});

rig.world.close();
finish();
