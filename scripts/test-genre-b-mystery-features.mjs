// The mystery classes' features the fifth pass built (WAVE2 D5: the genre
// text is the rule, played on the SRD 5.1 engine): the enforcer's Bodyguard
// riders, pickets and walls, the spirit medium's shades and processions, the
// alienist's cures and the files the investigators keep on the people they
// deal with. Each case fails without its mechanism; the clause ledger
// (scripts/clauses/genre-mystery.json) points here for the clauses it holds.
//
// Dice forced; every check reads hit points, a condition, a counter, a
// token's square or the d20s a roll threw.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";
import { dice, clearDice, diceLog } from "./lib/enforce-world.mjs";

const SRC = new URL("../src/", import.meta.url);
const { minutesSinceDeath } = await import(new URL("lib/dm/revival.ts", SRC).href);
const { getClock, setClockInstant } = await import(new URL("lib/db/clock.ts", SRC).href);
const { killOutright } = await import(new URL("lib/dm/death.ts", SRC).href);
const { getCampaignById } = await import(new URL("lib/db/campaigns.ts", SRC).href);

const { test, finish } = suite("test-genre-b-mystery-features");
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
const lost = (enemy) => 300 - kit.enemy(enemy.id).currentHp;
const hp = (hero) => world.sheet(hero.id).currentHp;
const used = (hero, id) => world.sheet(hero.id).resources?.[id]?.used ?? 0;
const at = (id) => [kit.token(id).x, kit.token(id).y];
const react = async (hero, name, extra = {}, faces = []) => {
  clearDice();
  dice(...faces);
  const out = await world.invoke("use_reaction", { characterId: hero.id, feature: name, reason: "test", ...extra });
  clearDice();
  return out;
};

// ---- the enforcer ----

await run("Meat Shield: Bodyguard reaches an ally 10 feet off, and the enforcer steps to their side to take the blow; without it the ally is out of reach and nothing is spent", async () => {
  const early = rig.holder(feature("enforcer", "Bodyguard", 5));
  let stage = await rig.fight(early);
  kit.place(ally.id, 5, 4);
  kit.place(stage.near.id, 6, 4);
  await rig.clubbed(stage.near, ally);
  const refused = await react(early, "Bodyguard", { targetCharacterId: ally.id });
  assert.equal(refused.ok, false, "a 5th-level enforcer's Bodyguard reached an ally 10 feet away");
  assert.equal(hp(ally), 94, "the refused reaction moved hit points");
  assert.equal(rig.reacted(early), false, "the refused reaction was spent");
  rig.reset();

  const hero = rig.holder(feature("enforcer", "Meat Shield", 6));
  stage = await rig.fight(hero);
  kit.place(ally.id, 5, 4);
  kit.place(stage.near.id, 6, 4);
  await rig.clubbed(stage.near, ally);
  const out = rig.must(await react(hero, "Bodyguard", { targetCharacterId: ally.id }), "use_reaction Bodyguard");
  assert.equal(hp(ally), 100, "the ally kept the wound");
  assert.equal(hp(hero), 94, `the enforcer took ${100 - hp(hero)}`);
  const [x, y] = at(hero.id);
  const [ax, ay] = at(ally.id);
  assert.ok(Math.max(Math.abs(x - ax), Math.abs(y - ay)) === 1, `the enforcer stands at ${x},${y}, not beside the ally at ${ax},${ay}`);
  assert.ok(Math.max(Math.abs(x - 5), Math.abs(y - 2)) <= 2, `the intercept carried the enforcer more than 10 feet (to ${x},${y})`);
  assert.match(String(out.intercept ?? ""), /Meat Shield/, "the result does not say the enforcer moved");
});

await run("Meat Shield: an enforcer already beside the ally does not move", async () => {
  const hero = rig.holder(feature("enforcer", "Meat Shield", 6));
  const { near } = await rig.fight(hero);
  await rig.clubbed(near, ally);
  const out = rig.must(await react(hero, "Bodyguard", { targetCharacterId: ally.id }), "use_reaction Bodyguard");
  assert.deepEqual(at(hero.id), [5, 2], "the enforcer moved from the ally's side");
  assert.equal(out.intercept, undefined);
});

await run("Solidarity: the creature whose blow Bodyguard took loses the enforcer's STR modifier + proficiency bonus; without the feature it loses nothing", async () => {
  const row = feature("enforcer", "Solidarity", 11);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const read = async () => {
    rig.myTurn(hero);
    kit.setEnemy(near.id, { currentHp: 300 });
    world.patch(ally.id, { currentHp: 100 });
    world.patch(hero.id, { currentHp: 100 });
    await rig.clubbed(near, ally);
    rig.must(await react(hero, "Bodyguard", { targetCharacterId: ally.id }), "use_reaction Bodyguard");
    return lost(near);
  };
  const { on, off } = await rig.both(hero, row, read);
  // STR 16 (+3) and a proficiency bonus of +4 at 11th level.
  assert.equal(on, 7, `the attacker lost ${on} with Solidarity`);
  assert.equal(off, 0, `without Solidarity the attacker lost ${off}`);
});

await run("Picket Stance: a creature that Disengages and walks out of the enforcer's reach still takes their opportunity attack; an ally without the feature makes none, and without it nobody does", async () => {
  const row = feature("enforcer", "Picket Stance", 7);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const walkAway = async () => {
    kit.setEnemy(near.id, { currentHp: 300 });
    kit.place(near.id, 6, 2);
    kit.handOnEnemies();
    kit.freshRound();
    kit.giveTurn(hero.id);
    clearDice();
    dice(15, 4, 4, 4);
    const out = await world.invoke("move_token", { token: near.id, x: 10, y: 2, disengage: true });
    clearDice();
    if (!out.ok) throw new Error(`move_token: ${out.error}`);
    return { lost: lost(near), reacted: rig.reacted(hero), allyReacted: Boolean(world.encounter()?.reactionsUsed.includes(ally.id)) };
  };
  const { on, off } = await rig.both(hero, row, walkAway);
  assert.ok(on.lost > 0, "the Disengaged creature walked out of the picket untouched");
  assert.equal(on.reacted, true, "the opportunity attack did not spend the enforcer's reaction");
  assert.equal(on.allyReacted, false, "an ally with no Picket Stance struck a creature that Disengaged");
  assert.equal(off.lost, 0, `without Picket Stance the Disengage was answered for ${off.lost}`);
});

await run("Immovable: a creature the enforcer grapples rolls its escape at disadvantage, and the enforcer escapes a grapple with advantage", async () => {
  const row = feature("enforcer", "Immovable", 13);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  const foeEscapes = async () => {
    rig.myTurn(hero);
    kit.setEnemy(near.id, { conditions: [], conditionMeta: {} });
    rig.must(await world.invoke("set_condition", { enemyId: near.id, condition: "grappled", sourceCharacterId: hero.id, reason: "test" }), "set_condition grappled");
    kit.handOnEnemies();
    kit.freshRound();
    clearDice();
    diceLog();
    dice(2, 2, 19, 19);
    const out = await world.invoke("take_action", { action: "escape", escapingEnemyId: near.id, reason: "test" });
    const log = diceLog();
    clearDice();
    if (!out.ok) throw new Error(`escape: ${out.error}`);
    return log.filter((die) => die.sides === 20).length;
  };
  const grip = await rig.both(hero, row, foeEscapes);
  // The creature's d20(s) and the enforcer's one Athletics d20 to hold it.
  assert.equal(grip.on, grip.off + 1, `the held creature threw ${grip.on - 1} d20 with Immovable and ${grip.off - 1} without`);
  const iEscape = async () => {
    rig.myTurn(hero);
    world.patch(hero.id, { conditions: [], conditionMeta: {} });
    rig.must(await world.invoke("set_condition", { characterId: hero.id, condition: "grappled", sourceEnemyId: near.id, reason: "test" }), "set_condition grappled");
    clearDice();
    diceLog();
    const out = await world.invoke("take_action", { characterId: hero.id, action: "escape", reason: "test" });
    if (!out.ok) throw new Error(`escape: ${out.error}`);
    return diceLog().filter((die) => die.sides === 20).length;
  };
  const free = await rig.both(hero, row, iEscape);
  assert.equal(free.on, free.off + 1, `the enforcer's escape threw ${free.on} d20 with Immovable and ${free.off} without`);
});

await run("Wall of Muscle: a creature fighting the enforcer pays double for every square within 10 feet of them, and walks at full speed once the feature is gone", async () => {
  const row = feature("enforcer", "Wall of Muscle", 18);
  const hero = rig.holder(row);
  const { near } = await rig.fight(hero);
  kit.place(ally.id, 1, 9);
  const walk = async () => {
    kit.handOnEnemies();
    kit.freshRound();
    kit.place(near.id, 10, 4);
    const out = await world.invoke("move_token", { token: near.id, x: 5, y: 3 });
    if (!out.ok) throw new Error(`move_token: ${out.error}`);
    return at(near.id);
  };
  const { on, off } = await rig.both(hero, row, walk);
  // Five squares to the enforcer's side: 25 of the creature's 30 feet.
  assert.deepEqual(off, [5, 3], `without the wall the creature's 30 feet carried it to ${off}`);
  // Any way in crosses two walled squares before the last one: 10 feet in
  // the open, 20 for the two, and the third is past its speed.
  assert.notDeepEqual(on, [5, 3], "the creature crossed the wall to the enforcer's side at full speed");
  assert.ok(Math.max(Math.abs(on[0] - 5), Math.abs(on[1] - 2)) >= 1 && kit.token(near.id).movedThisRound <= 6, `the creature stands at ${on} having spent ${kit.token(near.id).movedThisRound} squares`);
});

await run("General Strike: the enforcer calls it with their reaction as an ally within 30 feet is hit, which lays the strike on those in reach for a minute and is their own attack; then each striker answers a hit on any of them; nobody does before the call, and a plain spend is refused", async () => {
  const hero = rig.holder(feature("enforcer", "General Strike", 15));
  const { near } = await rig.fight(hero);
  const bare = await world.invoke("use_resource", { characterId: hero.id, resource: "General Strike", reason: "test" });
  assert.equal(bare.ok, false, "General Strike was spent with no hit to answer");
  assert.equal(used(hero, "mystery_general_strike"), 0);
  await rig.clubbed(near, ally);
  kit.giveTurn(hero.id);
  const early = await react(ally, "General Strike", {}, [15, 4, 4]);
  assert.equal(early.ok, false, "an ally took a reaction attack with no General Strike called");
  // The enforcer's call, on the ally's turn.
  kit.giveTurn(ally.id);
  rig.must(await react(hero, "General Strike", {}, [15, 4, 4]), "the enforcer's General Strike");
  assert.equal(used(hero, "mystery_general_strike"), 1, "the call did not spend the use");
  assert.equal(rig.reacted(hero), true, "the call did not take the enforcer's reaction");
  assert.ok(lost(near) > 0, "the enforcer's reaction attack dealt nothing");
  for (const who of [hero, ally]) {
    const sheet = world.sheet(who.id);
    assert.ok(sheet.conditions.includes("general strike"), `${sheet.name} is not part of the strike`);
    assert.equal(sheet.conditionMeta["general strike"].rounds, 10, "the strike does not last a minute");
  }
  // A later hit on the enforcer: the ally answers it, and no second use is spent.
  kit.setEnemy(near.id, { currentHp: 300 });
  await rig.clubbed(near, hero);
  kit.giveTurn(hero.id);
  rig.must(await react(ally, "General Strike", {}, [15, 4, 4]), "the ally's General Strike");
  assert.ok(lost(near) > 0, "the ally's reaction attack dealt nothing");
  assert.ok(world.encounter().reactionsUsed.includes(ally.id), "the ally's reaction was not spent");
  assert.equal(used(hero, "mystery_general_strike"), 1, "a striker's answer spent a second use");
});

await run("General Strike: a hit on an ally beyond 30 feet is no call, and an ally out of reach when it is called is no striker", async () => {
  const hero = rig.holder(feature("enforcer", "General Strike", 15));
  const { near, far } = await rig.fight(hero);
  kit.place(ally.id, 5, 12);
  kit.place(far.id, 6, 12);
  await rig.clubbed(far, ally);
  kit.giveTurn(ally.id);
  const out = await react(hero, "General Strike", {}, [15, 4, 4]);
  assert.equal(out.ok, false, "a hit on an ally 50 feet away called the strike");
  assert.equal(used(hero, "mystery_general_strike"), 0, "the refused call spent the use");
  await rig.clubbed(near, hero);
  kit.giveTurn(ally.id);
  rig.must(await react(hero, "General Strike", {}, [15, 4, 4]), "the enforcer's General Strike");
  assert.ok(!world.sheet(ally.id).conditions.includes("general strike"), "an ally 50 feet away joined the strike");
});

// ---- the spirit medium ----

await run("Guardian Shade: the bound spirit turns aside an attack that hit the medium, for its use and their reaction; with no hit on record, or for a hit on an ally, it is refused and nothing is spent", async () => {
  const hero = rig.holder(feature("spirit_medium", "Guardian Shade", 11));
  const { near } = await rig.fight(hero);
  const none = await react(hero, "Guardian Shade");
  assert.equal(none.ok, false, "the shade answered a hit that never came");
  await rig.clubbed(near, ally);
  const other = await react(hero, "Guardian Shade", { targetCharacterId: ally.id });
  assert.equal(other.ok, false, "the shade turned aside a hit on an ally");
  assert.equal(used(hero, "mystery_guardian_shade"), 0, "a refused use was spent");
  assert.equal(hp(ally), 94);
  await rig.clubbed(near, hero);
  assert.equal(hp(hero), 94, "the staged club did not land for 6");
  rig.must(await react(hero, "Guardian Shade"), "use_reaction Guardian Shade");
  assert.equal(hp(hero), 100, "the blow stood");
  assert.equal(used(hero, "mystery_guardian_shade"), 1);
});

await run("Chorus of the Dead: Spirit Ward on an ally wards the medium too, and each has advantage on their next save, once; without it the ward is the ally's alone", async () => {
  const row = feature("spirit_medium", "Chorus of the Dead", 15);
  const hero = rig.holder(row);
  await rig.fight(hero);
  const ward = async () => {
    rig.myTurn(hero);
    for (const who of [hero, ally]) world.patch(who.id, { conditions: [], conditionMeta: {} });
    rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Spirit Ward", targetCharacterId: ally.id, reason: "test" }), "use_resource Spirit Ward");
    const first = await rig.d20sOf(ally, { kind: "saving_throw", ability: "wis" });
    const second = await rig.d20sOf(ally, { kind: "saving_throw", ability: "wis" });
    return { ally: world.sheet(ally.id).conditions.includes("spirit ward"), hero: world.sheet(hero.id).conditions.includes("spirit ward"), first, second, mine: await rig.d20sOf(hero, { kind: "saving_throw", ability: "wis" }) };
  };
  const { on, off } = await rig.both(hero, row, ward);
  assert.deepEqual(on, { ally: true, hero: true, first: 2, second: 1, mine: 2 }, `with Chorus of the Dead: ${JSON.stringify(on)}`);
  assert.deepEqual(off, { ally: true, hero: false, first: 1, second: 1, mine: 1 }, `without it: ${JSON.stringify(off)}`);
});

await run("Queen of the Quiet Court: the procession frightens the creature it is sent at for a minute (WIS save) and strikes it for 2d8 necrotic, obscures the medium, and is sent at another creature on a later turn for no further use", async () => {
  const hero = rig.holder(feature("spirit_medium", "Queen of the Quiet Court", 20));
  const { near, far } = await rig.fight(hero);
  const early = await world.invoke("use_resource", { characterId: hero.id, resource: "Direct the Procession", targetEnemyId: near.id, reason: "test" });
  assert.equal(early.ok, false, "the procession was sent before it was called");
  clearDice();
  dice(1, 3, 5);
  const out = rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Queen of the Quiet Court", targetEnemyId: near.id, reason: "test" }), "use_resource Queen of the Quiet Court");
  clearDice();
  assert.ok(kit.enemy(near.id).conditions.includes("frightened"), `the creature that failed carries ${JSON.stringify(kit.enemy(near.id).conditions)}`);
  assert.equal(kit.enemy(near.id).conditionMeta.frightened.rounds, 10, "the fear does not last a minute");
  assert.equal(lost(near), 8, `the spirits struck for ${lost(near)} on a 3 and a 5`);
  assert.equal(out.condition, "frightened");
  assert.equal(world.sheet(hero.id).conditionMeta["quiet court"].rounds, 10, "the procession does not stay a minute");
  // "they obscure": the creature's club on the medium is rolled twice.
  kit.handOnEnemies();
  kit.freshRound();
  clearDice();
  diceLog();
  dice(2, 2);
  rig.must(await world.invoke("enemy_attack", { enemyId: near.id, targetCharacterId: hero.id }), "enemy_attack");
  assert.equal(diceLog().filter((die) => die.sides === 20).length, 2, "the attack on the obscured medium threw one d20");
  // A later turn: the same procession, another creature, no use.
  rig.myTurn(hero);
  clearDice();
  dice(20);
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Direct the Procession", targetEnemyId: far.id, reason: "test" }), "use_resource Direct the Procession");
  clearDice();
  assert.equal(lost(far), 0, "a creature that made its save was struck");
  assert.ok(!kit.enemy(far.id).conditions.includes("frightened"));
  assert.equal(used(hero, "mystery_queen_of_the_quiet_court"), 1, "directing the procession spent a second use");
  assert.equal(rig.budget().actionUsed, true, "directing the procession did not take the action");
});

await run("Anchor of the Living: a spirit held as its creature dies within 30 feet is found freshly dead a day on, where Revivify's minute had long run out; a living ally and one who died out of reach are refused, nothing spent", async () => {
  const hero = rig.holder(feature("spirit_medium", "Anchor of the Living", 18));
  await rig.fight(hero);
  const spend = () => world.invoke("use_resource", { characterId: hero.id, resource: "Anchor of the Living", targetCharacterId: ally.id, reason: "test" });
  const alive = await spend();
  assert.equal(alive.ok, false, "a living ally's spirit was held");
  assert.equal(used(hero, "mystery_anchor_of_the_living"), 0, "a refused hold spent the use");
  rig.must(await world.invoke("apply_damage", { characterId: ally.id, amount: 400, type: "necrotic", reason: "test" }), "apply_damage");
  assert.equal(world.sheet(ally.id).deathSaves?.dead, true, "the staged blow did not kill the ally");
  kit.place(ally.id, 5, 12);
  const farOff = await spend();
  assert.equal(farOff.ok, false, "a spirit 50 feet away was held");
  assert.equal(used(hero, "mystery_anchor_of_the_living"), 0, "a refused hold spent the use");
  kit.place(ally.id, 5, 3);
  const pass = (minutes) => setClockInstant(world.campaignId, getClock(world.campaignId).instant + minutes);
  pass(30);
  assert.ok(minutesSinceDeath(world.campaignId, ally.id) >= 30, "the staged half hour did not pass");
  const late = await spend();
  assert.equal(late.ok, false, "a spirit half an hour gone was caught");
  pass(-30);
  rig.must(await spend(), "use_resource Anchor of the Living");
  assert.equal(used(hero, "mystery_anchor_of_the_living"), 1);
  pass(23 * 60);
  assert.equal(minutesSinceDeath(world.campaignId, ally.id), 0, "the held spirit is not freshly dead 23 hours on");
  pass(2 * 60);
  assert.ok(minutesSinceDeath(world.campaignId, ally.id) > 24 * 60, "the hold outlasted its 24 hours");
});

await run("Ferrywoman's Due: an undead that fails its CHA save is laid to rest and one that makes it stays; a creature that is no spirit is refused, nothing spent; a possessed ally is released", async () => {
  const hero = rig.holder(feature("spirit_medium", "Ferrywoman's Due", 13));
  const { near, far } = await rig.fight(hero);
  const due = async (extra, face) => {
    rig.myTurn(hero);
    world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, mystery_ferrywoman_s_due: { max: 1, used: 0 } } });
    clearDice();
    dice(face);
    const out = await world.invoke("use_resource", { characterId: hero.id, resource: "Ferrywoman's Due", reason: "test", ...extra });
    clearDice();
    return out;
  };
  const living = await due({ targetEnemyId: near.id }, 1);
  assert.equal(living.ok, false, "a goblin was laid to rest as a spirit");
  assert.equal(used(hero, "mystery_ferrywoman_s_due"), 0, "the refused use was spent");
  for (const enemy of [near, far]) kit.setEnemy(enemy.id, { stats: { ...kit.enemy(enemy.id).stats, type: "undead" } });
  const held = rig.must(await due({ targetEnemyId: far.id }, 20), "use_resource Ferrywoman's Due");
  assert.equal(held.saveAbility, "cha");
  assert.equal(kit.enemy(far.id).status, "alive", "an undead that made its CHA save was laid to rest");
  assert.equal(used(hero, "mystery_ferrywoman_s_due"), 1, "the save it made cost no use");
  rig.must(await due({ targetEnemyId: near.id }, 1), "use_resource Ferrywoman's Due");
  assert.notEqual(kit.enemy(near.id).status, "alive", "the undead that failed its CHA save still stands");
  world.patch(ally.id, { conditions: ["charmed"], conditionMeta: { charmed: { rounds: 100 } } });
  rig.must(await due({ targetCharacterId: ally.id }, 1), "use_resource Ferrywoman's Due on the ally");
  assert.deepEqual(world.sheet(ally.id).conditions, [], "the possession was not released");
  const free = await due({ targetCharacterId: ally.id }, 1);
  assert.equal(free.ok, false, "a character under no possession was released");
});

// ---- the grifter ----

await run("Vanish: a grifter watched in the open hides all the same, for a use each time, and is refused once the uses are gone; without the feature the watcher's clear view refuses the Hide", async () => {
  const row = feature("grifter", "Vanish", 18);
  const hero = rig.holder(row);
  await rig.fight(hero);
  const hideAs = async (bonus) => {
    rig.myTurn(hero);
    world.patch(hero.id, { conditions: [], conditionMeta: {} });
    clearDice();
    dice(19);
    const out = await world.invoke("take_action", { characterId: hero.id, action: "hide", ...(bonus ? { bonus: true } : {}), reason: "test" });
    clearDice();
    return out;
  };
  rig.must(await hideAs(true), "a bonus-action Hide in plain sight");
  assert.equal(used(hero, "mystery_vanish"), 1, "the Hide in plain sight spent no use, or two");
  rig.must(await hideAs(false), "a Hide in plain sight with the action");
  assert.equal(used(hero, "mystery_vanish"), 2, "a Hide in plain sight with the action spent no use");
  rig.must(await hideAs(true), "the third Hide in plain sight");
  assert.equal(used(hero, "mystery_vanish"), 3);
  const spent = await hideAs(false);
  assert.equal(spent.ok, false, "a grifter with no Vanish left hid in plain sight");
  world.patch(hero.id, { resources: { ...world.sheet(hero.id).resources, mystery_vanish: { max: 3, used: 0 } } });
  const off = await rig.without(hero, row, () => hideAs(false));
  assert.equal(off.ok, false, "without Vanish the watched grifter hid in plain sight");
});

// ---- the alienist ----

await run("Talking Cure: a short rest gives the alienist's most troubled companion an extra hit die of hit points and ends their fear; Depth Analysis counsels two and takes a level of exhaustion off each", async () => {
  const row = feature("alienist", "Talking Cure", 1);
  const hero = rig.holder(row);
  const rest = async () => {
    world.patch(ally.id, { currentHp: 40, conditions: ["frightened"], conditionMeta: { frightened: { rounds: 9000 } } });
    clearDice();
    dice(6, 6, 6, 6);
    rig.must(await world.invoke("take_rest", { kind: "short" }), "take_rest short");
    clearDice();
    return { hp: hp(ally), afraid: world.sheet(ally.id).conditions.includes("frightened") };
  };
  const { on, off } = await rig.both(hero, row, rest);
  // A fighter's d10 on a 6, with CON 16 (+3).
  assert.equal(on.hp - off.hp, 9, `the counselled ally ended the rest at ${on.hp}, and at ${off.hp} with no alienist's cure`);
  assert.equal(on.afraid, false, "the counselled ally is still frightened");
  assert.equal(off.afraid, true, "the staged fear ends with any short rest");
  rig.reset();

  const deep = rig.holder(feature("alienist", "Depth Analysis", 11));
  const second = world.addHero({ user: world.addUser("second"), name: "Second", class: "fighter", level: 5, abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, maxHp: 100, portrait: { url: "/uploads/test.png" } });
  for (const who of [ally, second]) world.patch(who.id, { currentHp: 40, exhaustion: 2 });
  clearDice();
  dice(6, 6, 6, 6);
  rig.must(await world.invoke("take_rest", { kind: "short" }), "take_rest short");
  clearDice();
  for (const who of [ally, second]) {
    assert.equal(world.sheet(who.id).exhaustion, 1, `${world.sheet(who.id).name} kept both levels of exhaustion`);
    assert.ok(hp(who) >= 49, `${world.sheet(who.id).name} ended the rest at ${hp(who)}`);
  }
  assert.equal(world.sheet(deep.id).exhaustion ?? 0, 0);
});

await run("Hypnotic Induction: an unrestrained creature in a fight is refused with nothing spent; a restrained one saves (WIS) or answers, and no condition is laid; Master of the Couch takes a hostile creature as it stands", async () => {
  const hero = rig.holder(feature("alienist", "Hypnotic Induction", 6));
  const { near } = await rig.fight(hero);
  const trance = async (who, face) => {
    clearDice();
    dice(face);
    const out = await world.invoke("use_resource", { characterId: who.id, resource: "Hypnotic Induction", targetEnemyId: near.id, reason: "test" });
    clearDice();
    return out;
  };
  const refused = await trance(hero, 1);
  assert.equal(refused.ok, false, "a creature neither willing nor restrained was put under trance");
  assert.equal(used(hero, "mystery_hypnotic_induction"), 0, "the refused use was spent");
  rig.must(await world.invoke("set_condition", { enemyId: near.id, condition: "restrained", reason: "test" }), "set_condition restrained");
  const out = rig.must(await trance(hero, 1), "use_resource Hypnotic Induction");
  assert.equal(out.saveAbility, "wis");
  assert.ok(!("condition" in out), `the trance laid ${out.condition}`);
  assert.match(String(out.applied), /answers three questions truthfully/);
  assert.deepEqual(kit.enemy(near.id).conditions, ["restrained", "trance"], "the creature that failed is not under trance");
  rig.reset();
  const master = rig.holder(feature("alienist", "Master of the Couch", 18));
  const again = await rig.fight(master);
  clearDice();
  dice(20);
  const hostile = rig.must(await world.invoke("use_resource", { characterId: master.id, resource: "Hypnotic Induction", targetEnemyId: again.near.id, reason: "test" }), "Master of the Couch on a hostile creature");
  clearDice();
  assert.match(String(hostile.applied), /resists the trance/);
});

await run("The Unconscious Speaks: a waking creature is refused with nothing spent; an unconscious one's dreams are read", async () => {
  const hero = rig.holder(feature("alienist", "The Unconscious Speaks", 13));
  const { near } = await rig.fight(hero);
  const read = () => world.invoke("use_resource", { characterId: hero.id, resource: "The Unconscious Speaks", targetEnemyId: near.id, reason: "test" });
  const awake = await read();
  assert.equal(awake.ok, false, "a waking creature's dreams were read");
  assert.equal(used(hero, "mystery_the_unconscious_speaks"), 0, "the refused use was spent");
  rig.must(await world.invoke("set_condition", { enemyId: near.id, condition: "unconscious", reason: "test" }), "set_condition unconscious");
  const out = rig.must(await read(), "use_resource The Unconscious Speaks");
  assert.match(String(out.applied), /three true impressions/);
  assert.equal(used(hero, "mystery_the_unconscious_speaks"), 1);
  assert.ok(world.sheet(hero.id).conditions.includes("the unconscious speaks"), "the reading is not on the alienist for the GM to answer");
});

await run("Radical Breakthrough: a madness or a magical fear on the patient ends; a patient with none is refused, nothing spent", async () => {
  const hero = rig.holder(feature("alienist", "Radical Breakthrough", 17));
  const cure = () => world.invoke("use_resource", { characterId: hero.id, resource: "Radical Breakthrough", targetCharacterId: ally.id, reason: "test" });
  const well = await cure();
  assert.equal(well.ok, false, "a patient with nothing to cure was cured");
  assert.equal(used(hero, "mystery_radical_breakthrough"), 0, "the refused use was spent");
  world.patch(ally.id, { conditions: ["madness", "frightened"], conditionMeta: { madness: {}, frightened: { rounds: 100 } } });
  rig.must(await cure(), "use_resource Radical Breakthrough");
  assert.ok(!world.sheet(ally.id).conditions.includes("madness"), `the patient still carries ${JSON.stringify(world.sheet(ally.id).conditions)}`);
  assert.equal(used(hero, "mystery_radical_breakthrough"), 1);
});

// ---- the muckraker ----

await run("The Story of the Century: the named creature's allies save (WIS) or abandon it and flee; the creature itself does not save", async () => {
  const hero = rig.holder(feature("muckraker", "The Story of the Century", 20));
  const { near, far } = await rig.fight(hero);
  const bare = await world.invoke("use_resource", { characterId: hero.id, resource: "The Story of the Century", reason: "test" });
  assert.equal(bare.ok, false, "the story named nobody");
  assert.equal(used(hero, "mystery_the_story_of_the_century"), 0, "the refused use was spent");
  clearDice();
  diceLog();
  dice(1);
  const out = rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "The Story of the Century", targetEnemyId: near.id, reason: "test" }), "use_resource The Story of the Century");
  const d20s = diceLog().filter((die) => die.sides === 20).length;
  clearDice();
  assert.equal(out.saveAbility, "wis");
  assert.equal(d20s, 1, `${d20s} creatures saved, and the named one has one ally`);
  assert.ok(kit.enemy(far.id).conditions.includes("fleeing"), `the ally that failed carries ${JSON.stringify(kit.enemy(far.id).conditions)}`);
  assert.ok(!kit.enemy(near.id).conditions.includes("fleeing"), "the named creature abandoned itself");
});

await run("Anchor of the Living: laid on a dying ally, it holds their spirit if they die within the minute", async () => {
  const hero = rig.holder(feature("spirit_medium", "Anchor of the Living", 18));
  await rig.fight(hero);
  world.patch(ally.id, { currentHp: 0, conditions: ["unconscious"] });
  rig.must(await world.invoke("use_resource", { characterId: hero.id, resource: "Anchor of the Living", targetCharacterId: ally.id, reason: "test" }), "use_resource Anchor of the Living");
  assert.ok(world.sheet(ally.id).conditions.includes("spirit anchored"), "the dying ally carries no anchor");
  killOutright(getCampaignById(world.campaignId), null, world.sheet(ally.id), "test");
  assert.equal(world.sheet(ally.id).deathSaves?.dead, true, "the staged death did not take");
  setClockInstant(world.campaignId, getClock(world.campaignId).instant + 600);
  assert.equal(minutesSinceDeath(world.campaignId, ally.id), 0, "the spirit anchored as they lay dying is not freshly dead ten hours on");
});

rig.world.close();
finish();
