// What common spells do after the roll and when they end: the 2026-11-16
// audit's effects lens, its second follow-up (findings Y18 on; Y01 to Y11 are
// in scripts/test-audit1116-effects.mjs, Y12 to Y16 in
// scripts/test-audit1116-effects2.mjs, Y17 in scripts/test-audit1116-wake.mjs).
// Each test is the rule as SRD 5.1 prints it, read off the engine's own state.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { closeTables } from "./lib/enforce-spell-kit.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { dropMap } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-audit1116-effects3");
const { endTurnSaves } = await import("../src/lib/dm/condition-tick.ts");

// ---- Y18: a pet frightened by Fear saves only out of the caster's sight ----

// SRD 5.1, Fear: "If the creature ends its turn in a location where it
// doesn't have line of sight to you, the creature can make a Wisdom saving
// throw." Creatures and heroes keep it (Y02 on the board, Y13 off it); a pet
// saved at the end of every one of its owner's turns, in plain sight or not.
// A pet has no token and stands in its owner's square (pet-place.ts).
async function petFearStage() {
  const { openWorld } = await import("./lib/enforce-world.mjs");
  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const ranger = world.addHero({ name: "Rook", class: "ranger", subclass: "Beast Master", level: 5, proficiencies: TRAINED });
  const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  await kit.fight(1);
  const [goblin] = world.enemies();
  kit.place(ranger.id, 2, 7);
  kit.place(goblin.id, 6, 7);
  // DC 1: any save passes, so only whether one is rolled is in question.
  const fear = { spell: "Fear", source: goblin.id, rounds: 10, saveEnds: { ability: "wis", dc: 1, unseen: true } };
  const owner = world.sheet(ranger.id);
  world.patch(ranger.id, { pets: owner.pets.map((pet) => ({ ...pet, conditions: [...(pet.conditions ?? []), "frightened"], conditionMeta: { ...(pet.conditionMeta ?? {}), frightened: fear } })) });
  const turnEnds = () => {
    world.dice(20, 20);
    endTurnSaves(world.campaign(), world.encounter(), [ranger.id]);
    world.clearDice();
  };
  const frightened = () => (world.sheet(ranger.id).pets[0].conditions ?? []).includes("frightened");
  assert.ok(frightened(), "the wolf starts frightened");
  return { world, kit, goblin, turnEnds, frightened };
}

await test("Y18: a pet frightened by Fear whose owner's square is in the caster's sight makes no save", async () => {
  const { turnEnds, frightened } = await petFearStage();
  turnEnds();
  assert.ok(frightened(), "in plain sight the fear holds");
});

await test("Y18: a pet frightened by Fear whose owner stands behind a wall from the caster saves and shakes it off", async () => {
  const { kit, turnEnds, frightened } = await petFearStage();
  kit.openField(Array.from({ length: kit.map().height }, (_, y) => [4, y, "#"]));
  turnEnds();
  assert.ok(!frightened(), "out of sight, its save ended the fear");
});

await test("Y18: off the board, a pet frightened by Fear saves from the end of its second turn", async () => {
  const { world, turnEnds, frightened } = await petFearStage();
  await dropMap(world);
  turnEnds();
  assert.ok(frightened(), "its first turn is spent fleeing, with no save");
  turnEnds();
  assert.ok(!frightened(), "the end of its second turn brings the save");
});

closeTables();
finish();
