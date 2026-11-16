// Summons, companions and helpers, from the 2026-11-16 rules audit (the
// allies lens, findings U01..): familiars, the Beast Master's companion, story
// pets, mounts and the creatures a spell calls. Each test names its finding
// and the SRD 5.1 rule it holds the engine to. A pet has no token and stands
// in its owner's square (ruling D2, pet-place.ts), and acts on its owner's
// turn.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, d20Faces, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-audit1116-allies");
const world = await openWorld({ campaign: { maxPlayers: 30 } });
const kit = await combatKit(world);

// A call with its dice forced, the queue emptied after.
async function forced(faces, call) {
  world.clearDice();
  world.diceLog();
  world.dice(...faces);
  const out = await call();
  world.clearDice();
  return out;
}

// The enemy holds the floor, as it does when it attacks on its own turn.
function enemyHoldsTheFloor() {
  const fight = world.encounter();
  kit.saveEncounter({ ...fight, turnIndex: Math.max(0, fight.order.findIndex((entry) => entry.kind !== "pc")), turnBudget: null });
}

const petOf = (ownerId, name) => world.sheet(ownerId).pets.find((pet) => pet.name.toLowerCase() === name);

// The newest stored attack roll whose words match, and how many d20s it threw
// (the kit lists the recent rolls oldest first).
function lastAttackDice(pattern) {
  const roll = kit.lastRolls(12).filter((entry) => entry.kind === "attack" && pattern.test(entry.detail ?? "")).at(-1);
  assert.ok(roll, `no attack roll matching ${pattern}`);
  return d20Faces(roll).length;
}

// The owner's hero: the first one seated, so the owner walks them by the
// board's own move route.
const keeper = world.addHero({ class: "fighter", level: 5, maxHp: 60, proficiencies: { ...TRAINED } });

// U01. SRD 5.1, Underwater Combat: "When making a melee weapon attack, a
// creature that doesn't have a swimming speed (either natural or granted by
// magic) has disadvantage on the attack roll unless the weapon is a dagger,
// javelin, shortsword, spear, or trident"; "Creatures and objects that are
// fully immersed in water have resistance to fire damage." A pet stands in
// its owner's square (ruling D2), so it shares its owner's water. The hero's
// and the creature's own doors read the rule; a pet's bite, a creature's
// swing at a pet or a mount, and its opportunity attack at a pet did not, and
// a pet in the water took a fire bolt whole.
await test("U01: a pet in its owner's water swings, is struck and burns by the underwater rules", async () => {
  const dog = await world.invoke("summon_pet", { characterId: keeper.id, kind: "other", form: "Mastiff", name: "Brute" });
  assert.equal(dog.ok, true, dog.error);
  const snake = await world.invoke("summon_pet", { characterId: keeper.id, kind: "other", form: "Giant Poisonous Snake", name: "Hiss" });
  assert.equal(snake.ok, true, snake.error);
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.openField([[5, 5, "~"], [5, 6, "~"], [6, 5, "~"]]);
  kit.place(keeper.id, 5, 5);
  kit.place(enemy.id, 5, 6);

  // The mastiff has no swimming speed: its bite is at disadvantage.
  kit.giveTurn(keeper.id);
  const bite = await forced([15, 15, 1], () => world.invoke("pet_attack", { characterId: keeper.id, petName: "Brute", targetEnemyId: enemy.id }));
  assert.equal(bite.ok, true, bite.error);
  assert.equal(lastAttackDice(/^Bite/), 2, "a mastiff's bite in the water rolled one d20");
  // The snake swims: its bite is not. (The mastiff's bite may have knocked
  // the creature prone: it stands again.)
  kit.setEnemy(enemy.id, { conditions: [], conditionMeta: {} });
  kit.giveTurn(keeper.id);
  const fang = await forced([15, 1], () => world.invoke("pet_attack", { characterId: keeper.id, petName: "Hiss", targetEnemyId: enemy.id }));
  assert.equal(fang.ok, true, fang.error);
  assert.equal(lastAttackDice(/^Bite/), 1, "a swimming snake's bite in the water was at disadvantage");

  // The creature in the water swings its club at the mastiff with no
  // swimming speed of its own: at disadvantage.
  enemyHoldsTheFloor();
  const club = await forced([15, 15, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: keeper.id, targetPet: "Brute" }));
  assert.equal(club.ok, true, club.error);
  assert.equal(lastAttackDice(/^Club/), 2, "a club swung from the water at a pet rolled one d20");
  assert.match(JSON.stringify(club.result.swings), /underwater/, "the swing says why");

  // Fire on a pet in the water: halved.
  const before = petOf(keeper.id, "brute").hp;
  const burned = await world.invoke("apply_damage", { characterId: keeper.id, petName: "Brute", amount: 4, type: "fire" });
  assert.equal(burned.ok, true, burned.error);
  assert.equal(petOf(keeper.id, "brute").hp, before - 2, `a mastiff in the water took 4 fire whole: ${JSON.stringify(burned.result)}`);

  // The keeper Disengages and wades off; the creature's reaction goes to the
  // pet that walked out of its reach, from the water, at disadvantage.
  kit.freshRound();
  kit.giveTurn(keeper.id);
  const off = await world.invoke("take_action", { characterId: keeper.id, action: "disengage" });
  assert.equal(off.ok, true, off.error);
  const before2 = new Set(kit.lastRolls(40).map((roll) => roll.id));
  const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn(world.owner);
  world.dice(15, 15, 1, 1);
  const walked = await moveRoute.POST(new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 2, y: 5 }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
  world.clearDice();
  assert.equal(walked.status, 200, await walked.text());
  const swings = kit.lastRolls(40).filter((roll) => !before2.has(roll.id) && roll.kind === "attack" && /opportunity attack/.test(roll.detail ?? ""));
  assert.equal(swings.length, 1, "the creature strikes a pet as it pulls away");
  assert.equal(swings[0].advantage, "disadvantage", `${swings[0].detail}: a club swung from the water`);

  // The keeper's horse, in the water with them, struck by the club.
  kit.place(keeper.id, 5, 5);
  const up = await world.invoke("mount_up", { characterId: keeper.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  kit.freshRound();
  enemyHoldsTheFloor();
  const atHorse = await forced([15, 15, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: keeper.id, targetMount: true }));
  assert.equal(atHorse.ok, true, atHorse.error);
  assert.equal(lastAttackDice(/^Club/), 2, "a club swung from the water at a mount rolled one d20");
  await kit.endFight();
});

// U02. Ranger's Companion: "Add your proficiency bonus to the beast's AC,
// attack rolls, and damage rolls, as well as to any saving throws and skills
// it is proficient in. Its hit point maximum equals its normal maximum or
// four times your ranger level, whichever is higher." summon_pet wrote the
// numbers once: a 4th-level ranger's wolf kept 16 hit points and its +2
// after the ranger reached 5th level.
await test("U02: a ranger's companion keeps up with the ranger's level-ups", async () => {
  const { buildLevelUp } = await import("../src/lib/srd/level-up.ts");
  const { classGrantsFor } = await import("../src/lib/characters/catalog.ts");
  const ranger = world.addHero({ class: "ranger", subclass: "Beast Master", level: 4, maxHp: 36, proficiencies: { ...TRAINED } });
  const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  const wolf = () => petOf(ranger.id, "wolf");
  const at4 = wolf();
  assert.equal(at4.maxHp, 16, "four times the ranger's 4th level");
  assert.equal(at4.ac, 13 + 2);
  // Hurt by 3 before the level comes.
  world.patch(ranger.id, { pets: [{ ...at4, hp: 13 }], xp: 6500 });
  const sheet = world.sheet(ranger.id);
  const context = { hpMethod: "average", multiclassAllowed: true, classOf: classGrantsFor, racialCantrips: 0, spellOf: () => null, featOf: () => null, subclassOffered: () => true, rollDie: () => 1 };
  const leveled = buildLevelUp(sheet, { level: 5, maxHp: sheet.maxHp, currentHp: sheet.currentHp, hitDice: sheet.hitDice }, context);
  assert.ok(!("error" in leveled), leveled.error);
  const at5 = leveled.patch.pets?.find((pet) => pet.name === at4.name);
  assert.ok(at5, "the level-up left the wolf as summoned at 4th level");
  assert.equal(at5.maxHp, 20, "four times the ranger's 5th level");
  assert.equal(at5.hp, 17, "the 4 hit points the maximum gained, on top of its 13");
  assert.equal(at5.ac, 13 + 3, "the wolf's 13 and the ranger's new +3");
  assert.equal(at5.attacks[0].toHit, at4.attacks[0].toHit + 1, "the bite's bonus rises with the proficiency bonus");
  assert.match(at5.attacks[0].damage, /\+3$/, `the bite's damage adds the new +3: ${at5.attacks[0].damage}`);
  assert.equal(at5.saves.dex, at4.saves.dex, "a save the wolf is not proficient in stays its own");
  assert.deepEqual(at5.conditions, at4.conditions, "what it is doing is its own");
});

finish();
