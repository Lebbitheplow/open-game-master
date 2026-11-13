// State that moves between places (a story edit, a rest, a fight's end, a
// level) and must arrive whole: the 2026-11-13 carry-over audit. Each case
// is a bug a player met, read back from the database.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-carry-over");
const world = await openWorld();

await test("A Constitution the story raises moves the hit point maximum for every level (SRD 5.1, Hit Points)", async () => {
  // "If your Constitution modifier changes, your hit point maximum changes as
  // well, as though you had the new modifier from 1st level." A tome read at
  // 5th level took CON 14 to 16 and left the maximum at 44.
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { con: 14 } });
  world.patch(hero.id, { currentHp: 30 });
  const raised = await world.invoke("update_sheet", { characterId: hero.id, abilities: { ...world.sheet(hero.id).abilities, con: 16 }, reason: "a manual of bodily health" });
  assert.equal(raised.ok, true, raised.error);
  assert.deepEqual([world.sheet(hero.id).maxHp, world.sheet(hero.id).currentHp], [49, 35]);
  // A curse that lowers it takes as much away, and the hit points stay inside it.
  world.patch(hero.id, { currentHp: 49 });
  const cursed = await world.invoke("update_sheet", { characterId: hero.id, abilities: { ...world.sheet(hero.id).abilities, con: 12 }, reason: "a withering curse" });
  assert.equal(cursed.ok, true, cursed.error);
  assert.deepEqual([world.sheet(hero.id).maxHp, world.sheet(hero.id).currentHp], [39, 39]);
  // Tough granted by the story: twice the level, at once.
  const tough = await world.invoke("update_sheet", { characterId: hero.id, feats: ["Tough"], reason: "a boon" });
  assert.equal(tough.ok, true, tough.error);
  assert.equal(world.sheet(hero.id).maxHp, 49);
  // The console that names a maximum is taken at its word.
  const named = await world.invoke("update_sheet", { characterId: hero.id, abilities: { ...world.sheet(hero.id).abilities, con: 14 }, maxHp: 50, reason: "fixing the sheet" });
  assert.equal(named.ok, true, named.error);
  assert.equal(world.sheet(hero.id).maxHp, 50);
});

await test("What was laid on a fight's foes ends with the fight; what a hero carries runs on", async () => {
  // A curse with no end of its own on a goblin stayed on the effects list
  // after the goblin died and the fight closed, read to the storyteller on
  // every later turn as "someone" at -2 AC.
  const { listEffects } = await import("../src/lib/db/active-effects.ts");
  const { patchEnemyHp } = await import("../src/lib/db/encounters.ts");
  const hero = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  const [goblin] = world.enemies();
  assert.equal((await world.invoke("set_effect", { enemyId: goblin.id, name: "Shrine's Curse", modifiers: [{ field: "ac", mode: "add", value: -2 }] })).ok, true);
  assert.equal((await world.invoke("set_effect", { characterId: hero.id, name: "Goblin's Hex", modifiers: [{ field: "attack", mode: "disadvantage" }], duration: "rounds", remaining: 10 })).ok, true);
  patchEnemyHp(goblin.id, 0, "dead");
  assert.equal((await world.invoke("end_encounter", { outcome: "victory" })).ok, true);
  assert.deepEqual(listEffects(world.campaignId).map((effect) => effect.name), ["Goblin's Hex"]);
});

world.close();
finish();
