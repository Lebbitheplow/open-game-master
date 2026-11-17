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

// U03. SRD 5.1, Unseen Attackers and Targets: "When you attack a target
// that you can't see, you have disadvantage on the attack roll"; Cover:
// "A target with half cover has a +2 bonus to AC"; Ranged Attacks: "Attacking
// at long range imposes disadvantage", and "you have disadvantage on a
// ranged attack roll if you are within 5 feet of a hostile creature who can
// see you and who isn't incapacitated". The hero's attack from a square read
// all four; the pet's attack from the same square (ruling D2) read none.
await test("U03: a pet's attack reads the light, its target's cover and its bow's range from its owner's square", async () => {
  const maps = await import("../src/lib/db/battle-maps.ts");
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const { clearLitTilesCache } = await import("../src/lib/battlemap/lit-cache.ts");
  const lightsOut = () => {
    const board = kit.map();
    maps.setBattleMapOutdoors(board.id, false);
    getDatabase().prepare(`UPDATE battle_maps SET ambient = 'dark', lights_json = '[]', zones_json = '[]' WHERE id = ?`).run(board.id);
    for (const token of maps.listTokens(board.id)) {
      maps.setTokenLight(token.id, 0);
    }
    clearLitTilesCache();
  };
  const lightsOn = () => {
    getDatabase().prepare(`UPDATE battle_maps SET ambient = 'bright' WHERE id = ?`).run(kit.map().id);
    clearLitTilesCache();
  };
  await kit.endFight();
  // U01's fight left the mastiff hurt: whole again.
  world.patch(keeper.id, { pets: world.sheet(keeper.id).pets.map((pet) => ({ ...pet, hp: pet.maxHp, conditions: [], conditionMeta: {} })) });
  const warlock = world.addHero({ class: "warlock", level: 5, maxHp: 40, proficiencies: { ...TRAINED } });
  world.patch(warlock.id, { gold: world.sheet(warlock.id).gold + 10, spellcasting: { ...world.sheet(warlock.id).spellcasting, ability: "cha", slots: { 1: { max: 2, used: 0 }, ...(world.sheet(warlock.id).spellcasting?.slots ?? {}) }, known: [...(world.sheet(warlock.id).spellcasting?.known ?? []), "Find Familiar"], prepared: world.sheet(warlock.id).spellcasting?.prepared ?? [], cantrips: world.sheet(warlock.id).spellcasting?.cantrips ?? [] }, features: [...world.sheet(warlock.id).features, { name: "Pact Boon: Pact of the Chain", source: "class" }] });
  const sprite = await world.invoke("summon_pet", { characterId: warlock.id, kind: "familiar", form: "sprite" });
  assert.equal(sprite.ok, true, sprite.error);
  await kit.fight(2);
  const [enemy, other] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200, stats: { ...kit.enemy(enemy.id).stats, senses: { passivePerception: 10, darkvision: 60 } } });
  kit.setEnemy(other.id, { maxHp: 200 });

  // In the dark, the mastiff (no darkvision) bites a creature that sees it.
  kit.openField();
  kit.place(keeper.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.place(other.id, 15, 15);
  kit.place(warlock.id, 12, 2);
  lightsOut();
  kit.giveTurn(keeper.id);
  const bite = await forced([15, 15, 1], () => world.invoke("pet_attack", { characterId: keeper.id, petName: "Brute", targetEnemyId: enemy.id }));
  assert.equal(bite.ok, true, bite.error);
  assert.equal(lastAttackDice(/^Bite/), 2, "a mastiff bit a creature it could not see in the dark at full odds");
  lightsOn();

  // The sprite's shortbow (40/160 ft.) at a creature crouched behind a low
  // wall 15 feet off: half cover.
  kit.setEnemy(enemy.id, { conditions: [], conditionMeta: {} });
  kit.openField([[5, 7, "|"]]);
  kit.place(warlock.id, 5, 5);
  kit.place(keeper.id, 15, 2);
  kit.place(enemy.id, 5, 8);
  kit.giveTurn(warlock.id);
  const behind = await forced([12, 1], () => world.invoke("pet_attack", { characterId: warlock.id, targetEnemyId: enemy.id, attack: "Shortbow" }));
  assert.equal(behind.ok, true, behind.error);
  assert.equal(behind.result.vsAc, 13 + 2, `the low wall's half cover: ${JSON.stringify(behind.result)}`);
  assert.equal(lastAttackDice(/^Shortbow/), 1, "a shot within normal range with nobody close is a straight roll");
  // 45 feet off, past its normal range.
  kit.openField();
  kit.setEnemy(enemy.id, { conditions: [], conditionMeta: {} });
  kit.place(enemy.id, 14, 5);
  kit.giveTurn(warlock.id);
  const far = await forced([12, 12, 1], () => world.invoke("pet_attack", { characterId: warlock.id, targetEnemyId: enemy.id, attack: "Shortbow" }));
  assert.equal(far.ok, true, far.error);
  assert.equal(lastAttackDice(/^Shortbow/), 2, `a shot past the sprite's normal range rolled one d20: ${JSON.stringify(far.result)}`);

  // Within normal range with a creature at the warlock's elbow.
  kit.setEnemy(enemy.id, { conditions: [], conditionMeta: {} });
  kit.place(enemy.id, 5, 9);
  kit.place(other.id, 5, 4);
  kit.giveTurn(warlock.id);
  const close = await forced([12, 12, 1], () => world.invoke("pet_attack", { characterId: warlock.id, targetEnemyId: enemy.id, attack: "Shortbow" }));
  assert.equal(close.ok, true, close.error);
  assert.equal(lastAttackDice(/^Shortbow/), 2, "a shot with a hostile creature within 5 feet rolled one d20");
  await kit.endFight();
});

// U04. Bond of Fang and Scale: the drake "can carry you as a mount"; Drake
// Companion: it "is immune to" its essence and lasts "until it drops to 0
// hit points"; SRD 5.1, Mounted Combat: "If your mount is knocked prone, you
// can use your reaction to dismount it as it falls and land on your feet.
// Otherwise, you are dismounted and fall prone." mount_up copied the
// drake's numbers onto the mount record, and the two were kept apart: an
// attack aimed at the mount left the drake whole, and a fire trap struck it
// twice, once as the mount and once as the pet.
await test("U04: a ridden drake is struck as the drake, once, and its rider comes down when it drops", async () => {
  await kit.endFight();
  const ranger = world.addHero({ class: "ranger", subclass: "Drakewarden", level: 7, maxHp: 60, proficiencies: { ...TRAINED } });
  world.patch(ranger.id, { features: [...world.sheet(ranger.id).features, { name: "Bond of Fang and Scale (Fire)", source: "class" }] });
  const drake = await world.invoke("summon_pet", { characterId: ranger.id, kind: "drake", form: "drake", essence: "fire" });
  assert.equal(drake.ok, true, drake.error);
  const pet = () => petOf(ranger.id, "drake");
  const { getMounts } = await import("../src/lib/db/mounts.ts");
  const up = await world.invoke("mount_up", { characterId: ranger.id, mount: "Drake" });
  assert.equal(up.ok, true, up.error);
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.place(ranger.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const full = pet().hp;

  // The club at the mount: the drake's own hit points.
  enemyHoldsTheFloor();
  const club = await forced([18, 18, 3], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ranger.id, targetMount: true }));
  assert.equal(club.ok, true, club.error);
  assert.equal(pet().hp, full - 5, `the blow aimed at the ridden drake left the drake whole: ${JSON.stringify(club.result)}`);

  // A fire trap: the drake is immune to fire, and is struck once, as itself.
  const trap = await forced([3, 3, 3, 3, 10, 10, 10, 10], () => world.invoke("aoe_damage", { characterIds: [ranger.id], saveAbility: "dex", dc: 15, damage: "4d6", type: "fire", halfOnSave: true, reason: "a fire trap" }));
  assert.equal(trap.ok, true, trap.error);
  const row = trap.result.results[0];
  assert.equal(row.mount, undefined, `the drake made a second save as the mount: ${JSON.stringify(row.mount)}`);
  assert.equal(pet().hp, full - 5, "the fire-immune drake took fire");
  assert.equal(getMounts(world.campaignId)[ranger.id]?.name, "Drake", "the ranger still rides");

  // Dropped to 0, the drake is gone and its rider comes down.
  world.patch(ranger.id, { pets: world.sheet(ranger.id).pets.map((entry) => (entry.kind === "drake" ? { ...entry, hp: 2 } : entry)) });
  kit.freshRound();
  enemyHoldsTheFloor();
  const last = await forced([18, 18, 3, 10, 10], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: ranger.id, targetMount: true }));
  assert.equal(last.ok, true, last.error);
  assert.equal(pet(), undefined, "the drake at 0 is gone");
  assert.equal(getMounts(world.campaignId)[ranger.id], undefined, `the ranger still rides a drake that is gone: ${JSON.stringify(last.result)}`);
  await kit.endFight();
});

// U05. SRD 5.1, Vicious Mockery: "it has disadvantage on the next attack
// roll it makes before the end of its next turn"; Bane: "Whenever a target
// that fails this saving throw makes an attack roll ... the target must roll
// a d4 and subtract the number rolled". The swing at a pet read the
// attacker's riders once for the whole routine, so a mocked creature's every
// swing at the pet was at disadvantage; the swing at a mount read none, so
// a baned creature struck the warhorse on a whole roll.
await test("U05: a creature's swings at a pet or a mount spend a one-shot rider once and keep a lasting one", async () => {
  await kit.endFight();
  world.patch(keeper.id, { pets: world.sheet(keeper.id).pets.map((pet) => ({ ...pet, hp: pet.maxHp, conditions: [], conditionMeta: {} })) });
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.place(keeper.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const twoSwings = { ...kit.enemy(enemy.id).stats, attacksPerTurn: 2 };
  const attackRolls = (count) => kit.lastRolls(12).filter((roll) => roll.kind === "attack" && /^Club/.test(roll.detail ?? "")).slice(-count);

  // Mocked: the first swing at the mastiff at disadvantage, the second not.
  kit.setEnemy(enemy.id, { maxHp: 200, stats: twoSwings, conditions: ["mocked"], conditionMeta: { mocked: { source: keeper.id } } });
  enemyHoldsTheFloor();
  const atDog = await forced([2, 2, 2], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: keeper.id, targetPet: "Brute" }));
  assert.equal(atDog.ok, true, atDog.error);
  const [dogFirst, dogSecond] = attackRolls(2);
  assert.equal(d20Faces(dogFirst).length, 2, "the mocked swing is at disadvantage");
  assert.equal(d20Faces(dogSecond).length, 1, `the mockery was spent on the first swing, and the second rolled at disadvantage too: ${JSON.stringify(atDog.result.swings)}`);

  // Baned and mocked at the keeper's horse: the d4 off both swings, the
  // disadvantage on the first.
  const up = await world.invoke("mount_up", { characterId: keeper.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  kit.freshRound();
  kit.setEnemy(enemy.id, { conditions: ["mocked", "baned"], conditionMeta: { mocked: { source: keeper.id }, baned: { source: keeper.id } } });
  enemyHoldsTheFloor();
  const atHorse = await forced([2, 2, 1, 2, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: keeper.id, targetMount: true }));
  assert.equal(atHorse.ok, true, atHorse.error);
  const [horseFirst, horseSecond] = attackRolls(2);
  assert.equal(d20Faces(horseFirst).length, 2, "the mocked swing at the horse is at disadvantage");
  assert.equal(d20Faces(horseSecond).length, 1, "the second swing at the horse is not");
  for (const roll of [horseFirst, horseSecond]) {
    assert.match(roll.expression ?? "", /-1d4/, `Bane's d4 comes off the swing at the horse: ${roll.expression}`);
  }
  await world.invoke("dismount", { characterId: keeper.id });
  await kit.endFight();
});

// U06. Exceptional Training: "a bonus action can command it to Dash,
// Disengage or Help"; SRD 5.1, Help: "you can aid a friendly creature in
// attacking a creature within 5 feet of you ... If your ally attacks the
// target before your next turn, the first attack roll is made with
// advantage." The command marked the wolf "helping" and laid nothing.
await test("U06: a companion commanded to Help gives the ranger's next attack at the creature beside it advantage", async () => {
  await kit.endFight();
  const ranger = world.addHero({ class: "ranger", subclass: "Beast Master", level: 7, maxHp: 60, abilities: { str: 16 }, proficiencies: { ...TRAINED }, equipment: [{ name: "Longsword", qty: 1 }] });
  const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  await kit.fight(2);
  const [enemy, far] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200 });
  kit.place(ranger.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.place(far.id, 12, 12);
  kit.giveTurn(ranger.id);
  // Out of the wolf's reach: refused, nothing spent.
  const tooFar = await world.invoke("use_resource", { characterId: ranger.id, resource: "Exceptional Training", variant: "help", targetEnemyId: far.id });
  assert.equal(tooFar.ok, false, "a Help at a creature 35 feet from the wolf was taken");
  const helped = await world.invoke("use_resource", { characterId: ranger.id, resource: "Exceptional Training", variant: "help", targetEnemyId: enemy.id });
  assert.equal(helped.ok, true, helped.error);
  const swing = await kit.swing(ranger.id, enemy.id, [15, 3, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, `the wolf's Help gave the ranger's swing no advantage: ${JSON.stringify(swing.result).slice(0, 300)}`);
  await kit.endFight();
});

// U07. SRD 5.1, Guiding Bolt: "the next attack roll made against this
// target before the end of your next turn has advantage." The pet's attack
// read the glimmer's advantage and left it there, so the hero's swing after
// the bite had advantage from the same bolt.
await test("U07: a pet's attack spends the Guiding Bolt advantage it used", async () => {
  await kit.endFight();
  world.patch(keeper.id, { pets: world.sheet(keeper.id).pets.map((pet) => ({ ...pet, hp: pet.maxHp, conditions: [], conditionMeta: {} })) });
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 200, conditions: ["guiding bolt"], conditionMeta: { "guiding bolt": { source: keeper.id } } });
  kit.place(keeper.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(keeper.id);
  const bite = await forced([2, 15, 1], () => world.invoke("pet_attack", { characterId: keeper.id, petName: "Hiss", targetEnemyId: enemy.id }));
  assert.equal(bite.ok, true, bite.error);
  assert.equal(lastAttackDice(/^Bite/), 2, "the glimmer gives the snake's bite advantage");
  assert.ok(!kit.enemy(enemy.id).conditions.includes("guiding bolt"), `the bite left the glimmer for the next attack: ${JSON.stringify(kit.enemy(enemy.id).conditions)}`);
  await kit.endFight();
});

// U08. Ranger's Companion: "you can use your action to verbally command it
// to take the Attack ... action. Once you have the Extra Attack feature, you
// can make one weapon attack yourself when you command the beast to take the
// Attack action." The command took the whole action, so a 5th-level Beast
// Master's own swing beside it was refused.
await test("U08: a Beast Master with Extra Attack makes one weapon attack beside commanding the companion's attack", async () => {
  await kit.endFight();
  const ranger = world.addHero({ class: "ranger", subclass: "Beast Master", level: 5, maxHp: 50, abilities: { str: 16 }, proficiencies: { ...TRAINED }, equipment: [{ name: "Longsword", qty: 1 }] });
  const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300 });
  kit.place(ranger.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(ranger.id);
  const bite = await forced([15, 1, 1, 20], () => world.invoke("pet_attack", { characterId: ranger.id, targetEnemyId: enemy.id }));
  assert.equal(bite.ok, true, bite.error);
  const own = await kit.swing(ranger.id, enemy.id, [15, 3], { weapon: "Longsword" });
  assert.equal(own.ok, true, `the ranger's own attack beside the command was refused: ${own.error}`);
  const third = await kit.swing(ranger.id, enemy.id, [15, 3], { weapon: "Longsword" });
  assert.equal(third.ok, false, "a second weapon attack of the ranger's own beside the command was taken");
  // Commanded first, the ranger's swing second: the other swing is not a
  // second command.
  kit.freshTurn();
  kit.giveTurn(ranger.id);
  const first = await forced([15, 1, 1, 20], () => world.invoke("pet_attack", { characterId: ranger.id, targetEnemyId: enemy.id }));
  assert.equal(first.ok, true, first.error);
  const twice = await forced([15, 1, 1, 20], () => world.invoke("pet_attack", { characterId: ranger.id, targetEnemyId: enemy.id }));
  assert.equal(twice.ok, false, "the companion was commanded to attack twice in one turn");
  await kit.endFight();
});

// U09. SRD 5.1, Cure Wounds: "A creature you touch regains a number of hit
// points equal to 1d8 + your spellcasting ability modifier. This spell has no
// effect on undead or constructs." Potion of Healing: "You regain hit points
// when you drink this potion": any creature it is poured into. heal took no
// petName, so the cleric's Cure Wounds on the ranger's snake healed the
// ranger, and nothing healed a pet at all.
await test("U09: a healing spell or a potion heals a pet, up to its maximum, and Cure Wounds does nothing to an undead pet", async () => {
  await kit.endFight();
  const cleric = world.addHero({
    class: "cleric", level: 5, maxHp: 40, abilities: { wis: 16 }, proficiencies: { ...TRAINED },
    spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, prepared: ["Cure Wounds"], known: [], cantrips: [] },
  });
  const hiss = () => petOf(keeper.id, "hiss");
  world.patch(keeper.id, { currentHp: 30, pets: world.sheet(keeper.id).pets.map((pet) => (pet.name === "Hiss" ? { ...pet, hp: 1, conditions: [], conditionMeta: {} } : pet)) });
  const used = () => world.sheet(cleric.id).spellcasting.slots[1].used;

  // 1d8 (a 5) + the cleric's Wisdom 3: 8 hit points onto the snake's 1.
  const cured = await forced([5], () => world.invoke("heal", { characterId: keeper.id, petName: "Hiss", spell: "Cure Wounds", casterId: cleric.id }));
  assert.equal(cured.ok, true, cured.error);
  assert.equal(hiss().hp, 9, `Cure Wounds on the snake: ${JSON.stringify(cured.result)}`);
  assert.equal(world.sheet(keeper.id).currentHp, 30, "the snake's healing went to its owner");
  assert.equal(used(), 1, "the slot is spent");

  // A potion poured into it: no more than its maximum.
  const potion = await world.invoke("heal", { characterId: keeper.id, petName: "Hiss", amount: 50, reason: "a potion of healing" });
  assert.equal(potion.ok, true, potion.error);
  assert.equal(hiss().hp, hiss().maxHp, "healed past its maximum");
  assert.equal(world.sheet(keeper.id).currentHp, 30, "the potion went to the owner");

  // An undead pet: Cure Wounds has no effect, and nothing is spent on it.
  const bones = await world.invoke("summon_pet", { characterId: keeper.id, kind: "other", form: "Skeleton", name: "Rattle" });
  assert.equal(bones.ok, true, bones.error);
  world.patch(keeper.id, { pets: world.sheet(keeper.id).pets.map((pet) => (pet.name === "Rattle" ? { ...pet, hp: 2 } : pet)) });
  const refused = await world.invoke("heal", { characterId: keeper.id, petName: "Rattle", spell: "Cure Wounds", casterId: cleric.id });
  assert.equal(refused.ok, false, "Cure Wounds healed a skeleton");
  assert.equal(used(), 1, "a slot was spent on a spell with no effect");
  assert.equal(petOf(keeper.id, "rattle").hp, 2);
  // Plain healing is not the spell's: the potion still mends it.
  const mended = await world.invoke("heal", { characterId: keeper.id, petName: "Rattle", amount: 3, reason: "a potion of healing" });
  assert.equal(mended.ok, true, mended.error);
  assert.equal(petOf(keeper.id, "rattle").hp, 5);
  await world.invoke("dismiss_pet", { characterId: keeper.id, petName: "Rattle" });
});

// U10. SRD 5.1, Animate Dead: "On each of your turns, you can use a bonus
// action to mentally command any creature you made with this spell if the
// creature is within 60 feet of you (if you control multiple creatures, you
// can command any or all of them at the same time ...). If you issue no
// commands, the creature only defends itself against hostile creatures."
// The command was charged nowhere: the skeleton shot whoever the GM liked on
// its own turn, and its caster's bonus action stayed whole.
await test("U10: an animated skeleton attacks only in self-defence until its caster spends a bonus action to command it", async () => {
  await kit.endFight();
  const necro = world.addHero({
    class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: { ...TRAINED },
    spellcasting: { ability: "int", slots: { 3: { max: 2, used: 0 } }, prepared: ["Animate Dead"], known: [], cantrips: [] },
  });
  const raised = await world.invoke("cast_buff", { characterId: necro.id, spell: "Animate Dead", variant: "skeleton" });
  assert.equal(raised.ok, true, raised.error);
  const [bones] = raised.result.summoned;
  await kit.fight(2);
  const [near, far] = world.enemies();
  kit.setEnemy(near.id, { maxHp: 200 });
  kit.setEnemy(far.id, { maxHp: 200, stats: { ...kit.enemy(far.id).stats, attacks: [{ name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing", range: 80, longRange: 320 }] } });
  kit.place(necro.id, 3, 3);
  kit.place(bones.characterId, 5, 5);
  kit.place(near.id, 5, 6);
  kit.place(far.id, 12, 5);
  const shoot = (target) => kit.swing(bones.characterId, target, [15, 3, 15], { weapon: "Shortbow" });

  // No command: the creature 35 feet off has neither attacked it nor stands
  // beside it.
  kit.giveTurn(bones.characterId);
  const unbidden = await shoot(far.id);
  assert.equal(unbidden.ok, false, "an uncommanded skeleton shot a creature that never threatened it");
  // The goblin beside it threatens it: it defends itself.
  const beside = await kit.swing(bones.characterId, near.id, [15, 3], { weapon: "Shortsword" });
  assert.equal(beside.ok, true, beside.error);

  // The caster's bonus action commands it; a second command is refused.
  kit.giveTurn(necro.id);
  const slotsBefore = world.sheet(necro.id).spellcasting.slots[3].used;
  const command = await world.invoke("cast_buff", { characterId: necro.id, spell: "Animate Dead", variant: "command" });
  assert.equal(command.ok, true, command.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true, `the command left the bonus action whole: ${JSON.stringify(world.encounter().turnBudget)}`);
  assert.equal(world.sheet(necro.id).spellcasting.slots[3].used, slotsBefore, "the command spent a slot");
  const again = await world.invoke("cast_buff", { characterId: necro.id, spell: "Animate Dead", variant: "command" });
  assert.equal(again.ok, false, "two bonus actions in one turn");
  kit.giveTurn(bones.characterId);
  const bidden = await shoot(far.id);
  assert.equal(bidden.ok, true, bidden.error);

  // Too far to hear the command: refused, nothing spent.
  world.patch(bones.characterId, { conditions: [], conditionMeta: {} });
  kit.place(necro.id, 1, 1);
  kit.place(bones.characterId, 16, 1);
  kit.giveTurn(necro.id);
  const farOff = await world.invoke("cast_buff", { characterId: necro.id, spell: "Animate Dead", variant: "command" });
  assert.equal(farOff.ok, false, "a command reached a skeleton 75 feet away");
  assert.equal(world.encounter().turnBudget?.bonusUsed ?? false, false, "the refused command spent the bonus action");

  // A creature that attacked it is one it defends itself against.
  kit.place(bones.characterId, 5, 5);
  enemyHoldsTheFloor();
  const struck = await forced([2, 1], () => world.invoke("enemy_attack", { enemyId: far.id, targetCharacterId: bones.characterId }));
  assert.equal(struck.ok, true, struck.error);
  kit.giveTurn(bones.characterId);
  const answered = await shoot(far.id);
  assert.equal(answered.ok, true, answered.error);
  await kit.endFight();
});

// U11. SRD 5.1, Find Familiar: "1st-level conjuration (ritual)", casting
// time 1 hour, "M (10 gp worth of charcoal, incense, and herbs that must be
// consumed by fire in a brass brazier)". cast_buff paid the casting;
// summon_pet's familiar, the other door to the same spell, cost nothing.
await test("U11: a familiar summoned with summon_pet casts Find Familiar: the ritual's hour and 10 gp of incense, refused without the gold", async () => {
  await kit.endFight();
  const { getClock } = await import("../src/lib/db/clock.ts");
  const wizardWith = (gold) => world.addHero({
    class: "wizard", level: 3, maxHp: 20, abilities: { int: 16 }, gold, proficiencies: { ...TRAINED },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Find Familiar"], known: [], cantrips: [] },
  });
  const mage = wizardWith(50);
  const before = getClock(world.campaignId).instant;
  const owl = await world.invoke("summon_pet", { characterId: mage.id, kind: "familiar", form: "owl", name: "Hoot" });
  assert.equal(owl.ok, true, owl.error);
  assert.equal(petOf(mage.id, "hoot")?.form, "Owl");
  assert.equal(world.sheet(mage.id).gold, 40, "the incense cost nothing");
  assert.equal(world.sheet(mage.id).spellcasting.slots[1].used, 0, "a wizard's ritual spent a slot");
  assert.ok(getClock(world.campaignId).instant > before, "the hour's casting took no time");
  // No 10 gp of incense, and none carried: no familiar, nothing spent.
  const poor = wizardWith(0);
  const broke = await world.invoke("summon_pet", { characterId: poor.id, kind: "familiar", form: "cat" });
  assert.equal(broke.ok, false, "a familiar bound with no incense");
  assert.equal(world.sheet(poor.id).pets.length, 0);
});

// U12. SRD 5.1, Find Familiar: "As an action, you can temporarily dismiss
// your familiar into a pocket dimension. Alternatively, you can dismiss it
// forever. As an action while it is temporarily dismissed, you can cause it
// to reappear in any unoccupied space within 30 feet of you." dismiss_pet
// struck the familiar off the sheet, so calling it back was a new casting:
// another hour and another 10 gp.
await test("U12: a familiar dismissed to its pocket dimension is out of reach, and comes back for an action with no casting", async () => {
  await kit.endFight();
  const { getClock } = await import("../src/lib/db/clock.ts");
  const mage = world.addHero({
    class: "wizard", level: 3, maxHp: 20, abilities: { int: 16 }, gold: 20, proficiencies: { ...TRAINED },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Find Familiar"], known: [], cantrips: [] },
  });
  // A cat (2 hit points), so the fire that shows it is back leaves it standing.
  const called = await world.invoke("summon_pet", { characterId: mage.id, kind: "familiar", form: "cat", name: "Hoot" });
  assert.equal(called.ok, true, called.error);
  const hoot = () => world.sheet(mage.id).pets.find((pet) => pet.name === "Hoot");

  // Out of a fight: into the pocket, and nothing reaches it there.
  const away = await world.invoke("dismiss_pet", { characterId: mage.id, petName: "Hoot" });
  assert.equal(away.ok, true, away.error);
  assert.ok(hoot(), "the familiar was struck off rather than set aside");
  const burned = await world.invoke("apply_damage", { characterId: mage.id, petName: "Hoot", amount: 1, type: "fire" });
  assert.equal(burned.ok, false, "fire reached a familiar in its pocket dimension");
  assert.equal(hoot().hp, hoot().maxHp);

  // In a fight, on the wizard's turn: back for their action, no casting.
  await kit.fight(1);
  kit.giveTurn(mage.id);
  const gold = world.sheet(mage.id).gold;
  const clock = getClock(world.campaignId).instant;
  const back = await world.invoke("summon_pet", { characterId: mage.id, kind: "familiar", form: "cat" });
  assert.equal(back.ok, true, back.error);
  assert.equal(world.sheet(mage.id).gold, gold, "the recall burned incense");
  assert.equal(getClock(world.campaignId).instant, clock, "the recall took the hour's casting");
  assert.equal(world.encounter().turnBudget?.actionUsed, true, "the recall cost no action");
  const struck = await world.invoke("apply_damage", { characterId: mage.id, petName: "Hoot", amount: 1, type: "fire" });
  assert.equal(struck.ok, true, struck.error);
  // Its action spent, the wizard cannot send it away again this turn.
  const again = await world.invoke("dismiss_pet", { characterId: mage.id, petName: "Hoot" });
  assert.equal(again.ok, false, "a second action in the turn");
  await kit.endFight();

  // Dismissed while in the pocket: gone for good.
  await world.invoke("dismiss_pet", { characterId: mage.id, petName: "Hoot" });
  const forever = await world.invoke("dismiss_pet", { characterId: mage.id, petName: "Hoot" });
  assert.equal(forever.ok, true, forever.error);
  assert.equal(hoot(), undefined, "a familiar dismissed from its pocket stayed bound");
});

// U13. SRD 5.1, Find Familiar: "A familiar can't attack, but it can take
// other actions as normal"; Help: "you can aid a friendly creature in
// attacking a creature within 5 feet of you ... If your ally attacks the
// target before your next turn, the first attack roll is made with
// advantage." U06 gave the Beast Master's companion its Help; a familiar had
// no door for it (take_action took a character as the helper), so the
// wizard spent their own action on the Help, or the owl's was only told.
await test("U13: a familiar takes the Help action with its own action: the fighter's next swing at the goblin beside it has advantage", async () => {
  await kit.endFight();
  const mage = world.addHero({
    class: "wizard", level: 3, maxHp: 20, abilities: { int: 16 }, gold: 20, proficiencies: { ...TRAINED },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Find Familiar"], known: [], cantrips: [] },
  });
  const blade = world.addHero({ class: "fighter", level: 3, maxHp: 30, abilities: { str: 16 }, proficiencies: { ...TRAINED }, equipment: [{ name: "Longsword", qty: 1 }] });
  const called = await world.invoke("summon_pet", { characterId: mage.id, kind: "familiar", form: "cat", name: "Whiskers" });
  assert.equal(called.ok, true, called.error);
  await kit.fight(2);
  const [near, far] = world.enemies();
  kit.setEnemy(near.id, { maxHp: 200 });
  kit.place(mage.id, 5, 5);
  kit.place(near.id, 5, 6);
  kit.place(blade.id, 6, 6);
  kit.place(far.id, 12, 12);
  kit.giveTurn(mage.id);
  const help = (target) => world.invoke("take_action", { characterId: mage.id, petName: "Whiskers", action: "help", targetCharacterId: blade.id, targetEnemyId: target });

  // The goblin 35 feet off is not within 5 feet of the cat at the wizard's feet.
  const tooFar = await help(far.id);
  assert.equal(tooFar.ok, false, "a familiar helped against a creature 35 feet off");
  const helped = await help(near.id);
  assert.equal(helped.ok, true, helped.error);
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false, "the familiar's Help took the wizard's action");
  const twice = await help(near.id);
  assert.equal(twice.ok, false, "the familiar took two actions in one turn");

  kit.giveTurn(blade.id);
  const swing = await kit.swing(blade.id, near.id, [15, 3, 4], { weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  assert.equal(d20Faces(swing.toHit).length, 2, `the cat's Help gave the fighter's swing no advantage: ${JSON.stringify(swing.result).slice(0, 300)}`);
  await kit.endFight();
});

// U14. SRD 5.1, Underwater Combat: "Creatures and objects that are fully
// immersed in water have resistance to fire damage"; a wolf's Bite: "If the
// target is a creature, it must succeed on a DC 11 Strength saving throw or
// be knocked prone"; Mounted Combat: "If your mount is knocked prone, you
// can use your reaction to dismount it as it falls and land on your feet.
// Otherwise, you are dismounted and fall prone." A blow at a plain mount
// took its dice whole, untyped, and carried nothing onto the horse: the
// bite that would have thrown it left its rider in the saddle.
await test("U14: a blow at a plain mount meets its defenses by type, and a bite that knocks it prone throws its rider", async () => {
  await kit.endFight();
  const { getMounts } = await import("../src/lib/db/mounts.ts");
  const rider = world.addHero({ class: "fighter", level: 5, maxHp: 50, proficiencies: { ...TRAINED } });
  await kit.fight(1);
  const [enemy] = world.enemies();
  const flame = { name: "Flame Bite", toHit: 4, damage: "2d6", type: "fire" };
  const bite = { name: "Bite", toHit: 4, damage: "1d6", type: "piercing", onHit: { save: "str", dc: 11, condition: "prone" } };
  kit.openField([[5, 5, "~"], [5, 6, "~"]]);
  kit.place(rider.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const up = await world.invoke("mount_up", { characterId: rider.id, mount: "Warhorse" });
  assert.equal(up.ok, true, up.error);
  const horse = () => getMounts(world.campaignId)[rider.id];
  const full = horse().hp;

  // The horse stands in its rider's water: the fire is halved.
  kit.setEnemy(enemy.id, { maxHp: 200, stats: { ...kit.enemy(enemy.id).stats, attacks: [flame] } });
  enemyHoldsTheFloor();
  const burned = await forced([18, 18, 4, 4], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: rider.id, targetMount: true }));
  assert.equal(burned.ok, true, burned.error);
  assert.equal(horse().hp, full - 4, `8 fire on a horse in the water: ${JSON.stringify(burned.result.swings)}`);

  // Out of the water, the wolf's bite: the horse's Strength save fails, it
  // goes down, and its rider comes off.
  kit.openField();
  kit.place(rider.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.setEnemy(enemy.id, { stats: { ...kit.enemy(enemy.id).stats, attacks: [bite] } });
  kit.freshRound();
  enemyHoldsTheFloor();
  const thrown = await forced([18, 18, 3, 2, 2, 1, 1], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: rider.id, targetMount: true }));
  assert.equal(thrown.ok, true, thrown.error);
  assert.equal(horse(), undefined, `the horse knocked prone kept its rider: ${JSON.stringify(thrown.result.swings)}`);
  await kit.endFight();
});

// U15. Ranger's Companion (as the engine implements it): "Once you have the
// Extra Attack feature, you can make one weapon attack yourself when you
// command the beast to take the Attack action." U08 made the command one
// swing of the ranger's Attack action, which leaves a ranger with three
// attacks (a fighter's Extra Attack (2) beside the ranger's levels) two of
// their own.
await test("U15: a Beast Master with three attacks makes exactly one weapon attack of their own beside commanding the companion", async () => {
  await kit.endFight();
  const ranger = world.addHero({ class: "ranger", subclass: "Beast Master", level: 16, maxHp: 120, abilities: { str: 16 }, proficiencies: { ...TRAINED }, equipment: [{ name: "Longsword", qty: 1 }] });
  world.patch(ranger.id, { features: [...world.sheet(ranger.id).features, { name: "Extra Attack (2)", source: "class" }] });
  const summoned = await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "wolf" });
  assert.equal(summoned.ok, true, summoned.error);
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(ranger.id, 5, 5);
  kit.place(enemy.id, 5, 6);

  // The command, then the ranger's one swing, and no second.
  kit.giveTurn(ranger.id);
  const bite = await forced([15, 1, 1, 20], () => world.invoke("pet_attack", { characterId: ranger.id, targetEnemyId: enemy.id }));
  assert.equal(bite.ok, true, bite.error);
  const own = await kit.swing(ranger.id, enemy.id, [15, 3], { weapon: "Longsword" });
  assert.equal(own.ok, true, own.error);
  const second = await kit.swing(ranger.id, enemy.id, [15, 3], { weapon: "Longsword" });
  assert.equal(second.ok, false, "a second weapon attack of the ranger's own beside the command");

  // The ranger's swing first, then the command: nothing more of their own.
  kit.freshTurn();
  kit.giveTurn(ranger.id);
  const first = await kit.swing(ranger.id, enemy.id, [15, 3], { weapon: "Longsword" });
  assert.equal(first.ok, true, first.error);
  const then = await forced([15, 1, 1, 20], () => world.invoke("pet_attack", { characterId: ranger.id, targetEnemyId: enemy.id }));
  assert.equal(then.ok, true, then.error);
  const more = await kit.swing(ranger.id, enemy.id, [15, 3], { weapon: "Longsword" });
  assert.equal(more.ok, false, "a second weapon attack of the ranger's own after commanding");
  await kit.endFight();
});

finish();
