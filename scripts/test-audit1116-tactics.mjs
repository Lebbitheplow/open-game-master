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

await kit.endFight();
world.close();
finish();
