// The turn and the board outside the attack itself, from the 2026-11-16 rules
// audit (the tactics lens, findings Q01..): surprise, initiative, movement,
// shove and grapple, flying and falling, underwater combat, hiding, travel
// pace and light. Each test names its finding and the SRD 5.1 rule it holds
// the engine to.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1116-tactics");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);
const { setTravelPace } = await import("../src/lib/db/clock.ts");
const { decideAmbush } = await import("../src/lib/dm/encounter-open.ts");

// Q01. SRD 5.1, Travel Pace: a fast pace gives "-5 penalty to passive Wisdom
// (Perception) scores". Surprise is decided by the hiders' Stealth against
// each opponent's passive Perception (Combat, Surprise), so a party jumped on
// a fast march notices less. check_notice took the -5; the ambush that opens
// a fight read the passive score without it.
await test("Q01: a party marching at a fast pace notices an ambush with -5 to passive Perception", async () => {
  const scout = world.addHero({ class: "ranger", level: 5, abilities: { wis: 16 }, proficiencies: { ...TRAINED, skills: ["perception"] } });
  await kit.fight(1);
  const enemies = world.enemies();
  const passive = 10 + 3 + 3;
  const ambushWith = (face) => {
    world.clearDice();
    world.dice(face);
    const out = decideAmbush(world.campaign(), "enemies", enemies, [world.sheet(scout.id)]);
    world.clearDice();
    return out;
  };
  // The dummy's Stealth is the bare d20: 13 is below the scout's 16.
  setTravelPace(world.campaignId, "normal");
  assert.deepEqual(ambushWith(13).surprisedIds, [], `a passive Perception of ${passive} notices a Stealth of 13`);
  setTravelPace(world.campaignId, "fast");
  assert.deepEqual(ambushWith(13).surprisedIds, [scout.id], `a fast pace takes the scout's ${passive} to ${passive - 5}, which a 13 beats`);
  setTravelPace(world.campaignId, null);
  await kit.endFight();
});

// Q03. SRD 5.1, Combat, Surprise: "If you're surprised, you can't move or
// take an action on your first turn of the combat, and you can't take a
// reaction until that turn ends." Whether that turn has ended is a question
// of where the creature acting now stands in the order, not of where the
// pointer rests: the pointer rests on characters only, so while the enemies
// at the end of round 1 take their turns it already names round 2's first
// character, and after a wholly surprised party's lost round the fight opens
// on round 2 with the ambushers still to play round 1.
async function surpriseTable(heroes, fightOptions) {
  const table = await openWorld();
  const tableKit = await combatKit(table);
  const made = heroes.map((hero) => table.addHero({ class: "rogue", level: 5, maxHp: 40, proficiencies: TRAINED, ...hero }));
  await tableKit.fight(fightOptions.count ?? 1, { surprised: "party", ...fightOptions, heroFaces: Object.fromEntries(made.map((hero, index) => [hero.id, fightOptions.faces[index]])) });
  for (const hero of made) {
    table.patch(hero.id, { ac: 12, acOverride: true });
  }
  // The enemy hits `target` from beside it; the hit is what a reaction answers.
  const strike = async (enemy, target) => {
    tableKit.place(target.id, 5, 5);
    tableKit.place(enemy.id, 6, 5);
    table.clearDice();
    table.dice(15, 4);
    const out = await table.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: target.id });
    table.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.hit, true, JSON.stringify(out.result));
  };
  const dodge = (hero) => table.invoke("use_reaction", { characterId: hero.id, feature: "Uncanny Dodge" });
  return { table, tableKit, heroes: made, strike, dodge };
}

await test("Q03: a surprised hero whose lost turn came before an enemy's at the end of round 1 reacts to its attack", async () => {
  // Alert at the top, the surprised rogue on 17, the dummy on 7 (a goblin's
  // +2), a surprised rogue on 2 below it.
  const { table, tableKit, heroes: [lookout, early, late], strike, dodge } = await surpriseTable(
    [{ class: "fighter", feats: ["Alert"], abilities: { dex: 10 } }, { abilities: { dex: 16 } }, { abilities: { dex: 10 } }],
    { enemyFace: 5, faces: [15, 14, 2] },
  );
  const encounter = table.encounter();
  assert.equal(encounter.round, 1);
  assert.deepEqual([...encounter.surprisedIds].sort(), [early.id, late.id].sort());
  assert.equal(tableKit.current().characterId, lookout.id);
  // The lookout ends their turn: the walk passes the surprised rogue's lost
  // turn and stops at the end of the order for the dummy's.
  assert.equal(tableKit.endTurn(lookout.userId), true);
  assert.equal(table.encounter().round, 1);
  const [enemy] = table.enemies();
  await strike(enemy, early);
  const allowed = await dodge(early);
  assert.equal(allowed.ok, true, `the rogue whose lost turn (17) had ended before the dummy's (7) was refused: ${allowed.error}`);
  // A second swing of the same turn, at the rogue below it in the order.
  tableKit.freshRound();
  await strike(enemy, late);
  const refused = await dodge(late);
  assert.equal(refused.ok, false, "the rogue whose lost turn (2) had not come reacted");
  table.close();
});

await test("Q03: in the round a wholly surprised party lost, only a hero whose lost turn came before the ambusher's reacts to it", async () => {
  // The rogues roll 18 and 2, the two dummies share 12 (a goblin's +2 on 10).
  const { table, heroes: [fast, slow], strike, dodge } = await surpriseTable(
    [{ abilities: { dex: 16 } }, { abilities: { dex: 10 } }],
    { count: 2, enemyFace: 10, faces: [15, 2] },
  );
  assert.equal(table.encounter().round, 2);
  const [first, second] = table.enemies();
  // Each ambusher's first swing is the round the party lost.
  await strike(first, fast);
  const before = await dodge(fast);
  assert.equal(before.ok, true, `the rogue on 18, whose lost turn came before the ambusher's 12, was refused: ${before.error}`);
  await strike(second, slow);
  const after = await dodge(slow);
  assert.equal(after.ok, false, "the rogue on 2 reacted to an attack made before their lost turn");
  // The ambusher's second swing is its own turn of round 2: the surprise is over.
  await strike(first, slow);
  const own = await dodge(slow);
  assert.equal(own.ok, true, `round 2's own attack was still answered as the lost round: ${own.error}`);
  table.close();
});

await kit.endFight();
world.close();
finish();
