// Pets and familiars, from the 2026-11-15 rules audit (the pets lens,
// findings P01..). Each test names its finding and the SRD 5.1 rule it holds
// the engine to. A pet has no token and stands in its owner's square (ruling
// D2, pet-place.ts), and acts on its owner's turn.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1115-pets");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);
const { endTurnSaves } = await import("../src/lib/dm/condition-tick.ts");
const { clearSpellConditionsByName } = await import("../src/lib/dm/concentration.ts");
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const { petProvokes } = await import("../src/lib/dm/opportunity-pets.ts");
const { petDodgeTurnStart } = await import("../src/lib/dm/pet-command.ts");

// A call with its dice forced, the queue emptied after.
async function forced(faces, call) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const out = await call();
  world.clearDice();
  return out;
}

// The enemy holds the floor, as it does when it casts on its own turn.
function enemyHoldsTheFloor() {
  const fight = world.encounter();
  kit.saveEncounter({ ...fight, turnIndex: Math.max(0, fight.order.findIndex((entry) => entry.kind !== "pc")), turnBudget: null });
}

const petOf = (ownerId, name) => world.sheet(ownerId).pets.find((pet) => pet.name.toLowerCase() === name);

// P01. SRD 5.1, Saving Throws: a creature that fails the save suffers what
// the effect lays; Hold Monster: "The target must succeed on a Wisdom saving
// throw or be paralyzed for the duration ... At the end of each of its turns,
// the target can make another Wisdom saving throw"; Find Familiar: the
// familiar "has the statistics of the chosen form" (an imp's "Condition
// Immunities poisoned"); Paralyzed: "incapacitated ... can't move"; a net
// that restrains. A pet that failed took the damage and none of the
// condition, and went on acting.
await test("P01: a pet that fails a save is held by the condition it lays, for the effect's own duration", async () => {
  await kit.endFight();
  const warlock = world.addHero({ class: "warlock", level: 9, maxHp: 50, proficiencies: { ...TRAINED } });
  world.patch(warlock.id, { currentHp: 50, features: [...world.sheet(warlock.id).features, { name: "Pact of the Chain", source: "class" }] });
  const bound = await world.invoke("summon_pet", { characterId: warlock.id, kind: "familiar", form: "imp" });
  assert.equal(bound.ok, true, bound.error);
  const imp = () => petOf(warlock.id, "imp");
  const [enemy] = (await kit.fight(1), world.enemies());
  kit.setEnemy(enemy.id, { stats: { spells: ["Hold Monster"], abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 } } });
  enemyHoldsTheFloor();
  // The imp's WIS +1 with Magic Resistance's two dice: 2 and 3 fail DC 15.
  const held = await forced([2, 3], () => world.invoke("cast_at_player", { characterId: warlock.id, petName: "imp", casterEnemyId: enemy.id, spell: "Hold Monster", level: 5, saveAbility: "wis", dc: 15, condition: "paralyzed" }));
  assert.equal(held.ok, true, held.error);
  assert.equal(held.result.saved, false, JSON.stringify(held.result));
  assert.equal(held.result.conditionApplied, "paralyzed", `the failed save lays the paralysis: ${JSON.stringify(held.result)}`);
  assert.ok(imp().conditions.includes("paralyzed"), "the imp's record holds it");
  const meta = imp().conditionMeta.paralyzed;
  assert.equal(meta.spell, "Hold Monster", JSON.stringify(meta));
  assert.equal(meta.source, enemy.id);
  assert.deepEqual(meta.saveEnds, { ability: "wis", dc: 15 }, "a Wisdom save at the end of each of its turns");
  assert.equal(meta.rounds, 10, "for the spell's minute at most");
  // Shown where the GM reads the pet, as a character's condition reads.
  const petLine = describeSheet(world.sheet(warlock.id), "Kara", false).split("\n").find((line) => line.includes("Pet: Imp")) ?? "";
  assert.match(petLine, /Conditions: paralyzed \(1 min left\)/, petLine);
  // Paralyzed is incapacitated: no attack.
  kit.giveTurn(warlock.id);
  const bite = await world.invoke("pet_attack", { characterId: warlock.id, targetEnemyId: enemy.id });
  assert.equal(bite.ok, false, "a paralyzed imp cannot attack");
  assert.match(String(bite.error), /paralyzed/);
  // The end of its turn is its owner's: a failed save keeps it, a made one
  // ends it, each on the imp's own dice card.
  await forced([1, 2], () => endTurnSaves(world.campaign(), world.encounter(), [warlock.id]));
  assert.ok(imp().conditions.includes("paralyzed"), "a failed save at the end of the warlock's turn keeps it");
  assert.ok(kit.lastRolls(6).some((roll) => /^Imp: WIS save to end paralyzed/.test(roll.detail ?? "")), "the imp rolls its own save to end it");
  await forced([19, 20], () => endTurnSaves(world.campaign(), world.encounter(), [warlock.id]));
  assert.ok(!imp().conditions.includes("paralyzed"), `a made save ends it: ${JSON.stringify(imp().conditions)}`);
  // Held again, the caster's broken concentration ends the spell's hold.
  kit.freshRound();
  enemyHoldsTheFloor();
  const again = await forced([2, 3], () => world.invoke("cast_at_player", { characterId: warlock.id, petName: "imp", casterEnemyId: enemy.id, spell: "Hold Monster", level: 5, saveAbility: "wis", dc: 15, condition: "paralyzed" }));
  assert.equal(again.result.conditionApplied, "paralyzed", JSON.stringify(again.result));
  clearSpellConditionsByName(world.campaign(), "Hold Monster", undefined, enemy.id);
  assert.ok(!imp().conditions.includes("paralyzed"), "the spell's end frees the imp");
  // The imp's block: immune to the poisoned condition.
  const gas = await forced([1, 1], () => world.invoke("cast_at_player", { characterId: warlock.id, petName: "imp", saveAbility: "con", dc: 20, condition: "poisoned", source: "a cloud of spores" }));
  assert.equal(gas.ok, true, gas.error);
  assert.match(String(gas.result.conditionRefused), /immune/, JSON.stringify(gas.result));
  assert.ok(!imp().conditions.includes("poisoned"));
  await kit.endFight();

  // A net from the ceiling (no damage): the wolf's own save, at advantage
  // while it dodges; a failure restrains it until a save at the end of the
  // ranger's turn, and a restrained wolf stays where it is.
  const ranger = world.addHero({ class: "ranger", subclass: "Beast Master", level: 3, maxHp: 40, abilities: { dex: 10 }, proficiencies: { ...TRAINED } });
  const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  const wolf = () => petOf(ranger.id, "wolf");
  await kit.fight(1);
  kit.place(ranger.id, 3, 3);
  const net = await forced([20, 2, 3], () => world.invoke("aoe_damage", { characterIds: [ranger.id], saveAbility: "dex", dc: 15, condition: "restrained", reason: "a falling net" }));
  assert.equal(net.ok, true, net.error);
  const caught = net.result.results[0].pets?.[0];
  assert.ok(caught, `an area with no damage still asks the wolf's save: ${JSON.stringify(net.result.results[0])}`);
  assert.equal(caught.success, false);
  assert.equal(caught.conditionApplied, "restrained", JSON.stringify(caught));
  assert.ok(wolf().conditions.includes("restrained"));
  assert.deepEqual(wolf().conditionMeta.restrained.saveEnds, { ability: "dex", dc: 15 });
  assert.equal(petProvokes(wolf()), false, "a restrained wolf does not walk off with the ranger");
  // A paralytic dart for 1 minute: the count is the hazard's, and a
  // paralyzed companion takes no Dodge as its owner's turn starts.
  const dart = await forced([1, 1], () => world.invoke("cast_at_player", { characterId: ranger.id, petName: "wolf", saveAbility: "con", dc: 13, condition: "paralyzed", rounds: 10, source: "a paralytic dart" }));
  assert.equal(dart.result.conditionApplied, "paralyzed", JSON.stringify(dart.result));
  assert.equal(wolf().conditionMeta.paralyzed.rounds, 10);
  petDodgeTurnStart(world.campaign(), world.sheet(ranger.id));
  assert.ok(!wolf().conditions.includes("dodging"), `a paralyzed wolf takes no Dodge: ${JSON.stringify(wolf().conditions)}`);
  await kit.endFight();
});

world.close();
finish();
