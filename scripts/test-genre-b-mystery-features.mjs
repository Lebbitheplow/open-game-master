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

rig.world.close();
finish();
