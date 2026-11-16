// What common spells do after the roll and when they end: the 2026-11-16
// audit's effects lens, its second follow-up (findings Y18 on; Y01 to Y11 are
// in scripts/test-audit1116-effects.mjs, Y12 to Y16 in
// scripts/test-audit1116-effects2.mjs, Y17 in scripts/test-audit1116-wake.mjs).
// Each test is the rule as SRD 5.1 prints it, read off the engine's own state.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { closeTables, FIGHTER, table } from "./lib/enforce-spell-kit.mjs";
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

// ---- Y19: an area that passes over an Intelligence of 4 or less passes over a pet ----

// SRD 5.1, Hideous Laughter: "A creature with an Intelligence score of 4 or
// less isn't affected." Y04 and Y14 hold it on every door to a creature or a
// character; aoe_damage's pets (pet-save.ts areaOnPets) made the save and took
// what it laid whatever their Intelligence. The SRD's own spell names one
// target, so an area reaches a pet only through a table's workshop spell that
// keeps the rule: a laughing gas over a 20-foot sphere.
async function brewGiggles(world) {
  const { spellMechanicsFor } = await import("../src/lib/content/index.ts");
  const { draftFromCatalog } = await import("../src/app/workshop/homebrew/draft.ts");
  const mech = spellMechanicsFor({ spell: "Hideous Laughter" })?.mech;
  assert.equal(mech?.sparesIntAtMost, 4, "Hideous Laughter's block keeps the rule");
  const draft = draftFromCatalog("spell", {
    name: "Gale of Giggles",
    level: 1,
    school: "enchantment",
    data: {
      desc: "A gale of laughter sweeps a 20-foot-radius sphere centered on a point you choose within range. Each creature in the sphere must succeed on a Wisdom saving throw or fall prone, becoming incapacitated and unable to stand up for the duration. A creature with an Intelligence score of 4 or less isn't affected.",
      level_int: 1,
      classes: [{ name: "Bard" }, { name: "Wizard" }],
      concentration: true,
      casting_time: "1 action",
      range: "60 feet",
      components: "V, S",
      duration: "Up to 1 minute",
    },
    mech,
  });
  const route = await world.route("homebrew");
  world.signIn(world.owner);
  const made = await call(route, "POST", { kind: "spell", name: "Gale of Giggles", data: draft.data });
  assert.equal(made.status, 201, JSON.stringify(made.json));
}

const wolfOf = (world, ownerId) => world.sheet(ownerId).pets.find((pet) => pet.form.toLowerCase() === "wolf");

await test("Y19: an area that spares an Intelligence of 4 or less passes over the wolf beside its owner", async () => {
  const { world, sheets: [, rook], enemies: [hag] } = await table([{ ...FIGHTER, name: "Kara" }, { class: "ranger", subclass: "Beast Master", level: 5, name: "Rook", abilities: { wis: 10, int: 10 } }], 1, { spells: ["Gale of Giggles"], type: "humanoid" });
  await brewGiggles(world);
  const summoned = await world.invoke("summon_pet", { characterId: rook.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  world.dice(1, 1, 1, 1);
  const out = await world.invoke("aoe_damage", { casterEnemyId: hag.id, spell: "Gale of Giggles", level: 1, saveAbility: "wis", dc: 15, characterIds: [rook.id] });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(rook.id).conditions.includes("incapacitated"), "the ranger, Intelligence 10, failed and laughs");
  assert.ok(!(wolfOf(world, rook.id).conditions ?? []).includes("incapacitated"), `the wolf, Intelligence 3, is not affected: ${JSON.stringify(out.result.results[0].pets)}`);
  assert.match(JSON.stringify(out.result.results[0].pets ?? []), /Intelligence of 4 or less/, "the result says why");
});

closeTables();
finish();
