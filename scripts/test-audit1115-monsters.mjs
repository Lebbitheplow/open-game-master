// The monster rules the 2026-11-15 audit found the engine getting wrong
// (lens "monsters", E01 and on), each held here as the SRD 5.1 block reads.
// The creatures are the rulebook's own pages read as the engine reads a pack
// row (statblock.ts parseMonster), so the suite needs no content pack.
// Dice forced; every check reads a stored row.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { readPage, rowOfBlock } from "./lib/srd-bestiary.mjs";

const { test, finish } = suite("test-audit1115-monsters");

const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { parseSaveEffect } = await import("../src/lib/dm/save-effect.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
function srd(title) {
  const page = book.pages.find((entry) => entry.title === title && entry.kind === "monster");
  const parsed = parseMonster(rowOfBlock(title, readPage(page.md)));
  return parsed.stats ?? parsed;
}

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 10, maxHp: 90, abilities: { str: 16, wis: 10 }, proficiencies: TRAINED });
const bram = world.addHero({ name: "Bram", class: "fighter", level: 10, maxHp: 90, abilities: { str: 16, wis: 10 }, proficiencies: TRAINED });

// One creature of the rulebook's, on its own turn, beside the heroes.
async function stage(title) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [foe] = world.enemies();
  const stats = srd(title);
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 5, 6);
  kit.place(foe.id, 7, 5);
  kit.enemyTurn(foe.id);
  return kit.enemy(foe.id);
}

test("E01 the block's 24-hour immunity is read: Frightful Presence after a success or its end, the harpy's song after a success", () => {
  const presence = parseSaveEffect(
    "Each creature of the dragon's choice that is within 120 feet of the dragon and aware of it must succeed on a DC 19 Wisdom saving throw or become frightened for 1 minute. A creature can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success. If a creature's saving throw is successful or the effect ends for it, the creature is immune to the dragon's Frightful Presence for the next 24 hours.",
  );
  assert.deepEqual(presence.immuneAfter, { rounds: 14400, onEnd: true });
  assert.equal(presence.condition, "frightened");
  assert.equal(presence.rounds, 10);
  const song = parseSaveEffect(
    "The harpy sings a magical melody. Every humanoid and giant within 300 feet of the harpy that can hear the song must succeed on a DC 11 Wisdom saving throw or be charmed until the song ends. If a creature's saving throw is successful, the creature is immune to the harpy's song for the next 24 hours.",
  );
  assert.deepEqual(song.immuneAfter, { rounds: 14400, onEnd: false });
  assert.equal(parseSaveEffect("must succeed on a DC 13 Constitution saving throw or be poisoned for 1 minute.").immuneAfter, undefined);
});

await test("E01 a hero who makes the save against a dragon's Frightful Presence is immune to it: the next round's use is refused with nothing spent", async () => {
  const dragon = await stage("Adult Red Dragon");
  world.dice(20);
  const first = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: kara.id });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.saved, true);
  assert.match(String(first.result.immune), /immune to it for 24 hours/);
  kit.freshRound();
  kit.enemyTurn(dragon.id);
  world.dice(1);
  const again = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: kara.id });
  world.clearDice();
  assert.equal(again.ok, false, "the immune hero is not asked the save again");
  assert.match(String(again.error), /immune to it for 24 hours.*Nothing was spent/);
  assert.ok(!world.sheet(kara.id).conditions.includes("frightened"));
  assert.equal(world.encounter().legendary.acted?.ids?.includes(dragon.id) ?? false, false, "the dragon keeps its action");
});

await test("E01 the area form passes over the immune hero and asks the other, whose failure lays the fear and, the effect ending, immunity too", async () => {
  const dragon = await stage("Adult Red Dragon");
  world.dice(20);
  await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: kara.id });
  world.clearDice();
  kit.freshRound();
  kit.enemyTurn(dragon.id);
  world.dice(1);
  const area = await world.invoke("aoe_damage", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterIds: [kara.id, bram.id] });
  world.clearDice();
  assert.equal(area.ok, true, area.error);
  const rows = area.result.results ?? [];
  const karaRow = rows.find((row) => row.target === "Kara");
  assert.ok(karaRow?.immune, JSON.stringify(rows));
  assert.ok(!world.sheet(kara.id).conditions.includes("frightened"), "the immune hero is not frightened");
  assert.ok(world.sheet(bram.id).conditions.includes("frightened"), "the other failed and is frightened");
  assert.ok(world.sheet(bram.id).conditions.includes("immune to frightful presence"), "and is immune once the fear ends");
});

const swingsOf = (out) => (out.result?.swings ?? []).filter((swing) => !swing.skipped).map((swing) => swing.attack);

await test("E02 a dragon that uses its Frightful Presence then makes its Multiattack's three attacks, all one action", async () => {
  const dragon = await stage("Adult Red Dragon");
  world.dice(20);
  const presence = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: kara.id });
  world.clearDice();
  assert.equal(presence.ok, true, presence.error);
  world.dice(1, 1, 1);
  const routine = await world.invoke("enemy_attack", { enemyId: dragon.id, targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(routine.ok, true, routine.error);
  assert.deepEqual(swingsOf(routine), ["Bite", "Claw", "Claw"]);
  world.dice(1, 1, 1);
  const more = await world.invoke("enemy_attack", { enemyId: dragon.id, targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(more.ok, false, "the action is spent once the routine is made");
  world.dice(1);
  const presenceAgain = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: bram.id });
  world.clearDice();
  assert.equal(presenceAgain.ok, false, "and the presence is not its own action again");
});

await test("E02 the attacks may come first: the Frightful Presence after them is the same action, once", async () => {
  const dragon = await stage("Adult Red Dragon");
  world.dice(1, 1, 1);
  const routine = await world.invoke("enemy_attack", { enemyId: dragon.id, targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(routine.ok, true, routine.error);
  world.dice(1);
  const presence = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Frightful Presence", characterId: bram.id });
  world.clearDice();
  assert.equal(presence.ok, true, presence.error);
  assert.ok(world.sheet(bram.id).conditions.includes("frightened"));
  world.dice(1);
  const breath = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Fire Breath", characterId: kara.id });
  world.clearDice();
  assert.equal(breath.ok, false, "a breath is an action of its own, already spent");
});

await test("E02 an ability the Multiattack does not name still spends the action: a young dragon's breath, then no bite", async () => {
  const dragon = await stage("Young Red Dragon");
  world.dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
  const breath = await world.invoke("cast_at_player", { casterEnemyId: dragon.id, enemyAbility: "Fire Breath", characterId: kara.id });
  world.clearDice();
  assert.equal(breath.ok, true, breath.error);
  world.dice(1, 1, 1);
  const routine = await world.invoke("enemy_attack", { enemyId: dragon.id, targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(routine.ok, false, "the breath was its action");
});

const MAGIC_RESISTANCE = "Magic Resistance: The creature has advantage on saving throws against spells and other magical effects.";

await test("E03 Magic Resistance answers Sanctuary: the fiend rolls its WIS save with advantage and makes its attack", async () => {
  const foe = await stage("Adult Red Dragon");
  kit.setEnemy(foe.id, { stats: { ...kit.enemy(foe.id).stats, traits: [MAGIC_RESISTANCE], saveMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } } });
  world.patch(kara.id, { conditions: ["sanctuary"], conditionMeta: { sanctuary: { source: kara.id } } });
  // A 1 and a 20 on the save: with advantage it makes the DC; the swings miss.
  world.dice(1, 20, 1, 1, 1);
  const out = await world.invoke("enemy_attack", { enemyId: foe.id, targetCharacterId: kara.id });
  world.clearDice();
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  assert.equal(out.ok, true, out.error);
  assert.ok((out.result.swings ?? []).length > 0, "the attack was made");
});

await test("E03 a magical hold set on a creature keeps Magic Resistance on the save at the end of its turn", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 10 } });
  const [foe] = world.enemies();
  kit.setEnemy(foe.id, { maxHp: 200, stats: { ...kit.enemy(foe.id).stats, traits: [MAGIC_RESISTANCE] } });
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((each) => (each.kind === "pc" ? each.characterId : each.enemyId) === id);
  const legendary = { ...encounter.legendary };
  delete legendary.walked;
  delete legendary.walkedHolds;
  kit.saveEncounter({ ...encounter, order: [entry(kara.id), entry(foe.id), entry(bram.id)], turnIndex: 0, turnBudget: null, legendary });
  const set = await world.invoke("set_enemy_condition", { enemyId: foe.id, condition: "paralyzed", saveAbility: "wis", saveDc: 15, magical: true });
  assert.equal(set.ok, true, set.error);
  assert.equal(kit.endTurn(kara.userId), true);
  // The end of the creature's turn: a 1 and a 20, kept high with advantage.
  world.dice(1, 20);
  assert.equal(kit.endTurn(bram.userId), true);
  world.clearDice();
  assert.ok(!kit.enemy(foe.id).conditions.includes("paralyzed"), "Magic Resistance's advantage carried it past DC 15");
});

await test("E04 a wolf's opportunity attack has Pack Tactics' advantage with its packmate beside the square the hero left", async () => {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [wolf, packmate] = world.enemies();
  const PACK = ["Pack Tactics: The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature and the ally isn't incapacitated."];
  for (const foe of [wolf, packmate]) {
    kit.setEnemy(foe.id, { stats: { ...kit.enemy(foe.id).stats, traits: PACK } });
  }
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(wolf.id, 6, 5);
  kit.place(packmate.id, 6, 6);
  kit.giveTurn(kara.id);
  const before = new Set(kit.lastRolls(40).map((roll) => roll.id));
  // Kara's own walk west, as her player makes it.
  const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn(world.owner);
  const walked = await moveRoute.POST(new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 2, y: 5 }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
  world.clearDice();
  assert.equal(walked.status, 200, await walked.text());
  const swings = kit.lastRolls(40).filter((roll) => !before.has(roll.id) && roll.kind === "attack" && /opportunity attack/.test(roll.detail ?? ""));
  assert.equal(swings.length, 2, "both wolves strike as she pulls away");
  for (const swing of swings) {
    assert.equal(swing.advantage, "advantage", `${swing.detail}: the other wolf stood beside her where she left`);
  }
});

// A hero's own walk west to (2,5), as their player makes it; the opportunity
// attacks it drew, by their stored rolls.
async function walkAway(hero, user) {
  const before = new Set(kit.lastRolls(40).map((roll) => roll.id));
  const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn(user);
  const walked = await moveRoute.POST(new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 2, y: 5 }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
  world.clearDice();
  assert.equal(walked.status, 200, await walked.text());
  return kit.lastRolls(40).filter((roll) => !before.has(roll.id) && roll.kind === "attack" && /opportunity attack/.test(roll.detail ?? ""));
}

await test("E05 a zombie Chill Touch struck swings at its caster walking away at disadvantage", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [zombie] = world.enemies();
  const { CHILL_TOUCH_DREAD } = await import("../src/lib/dm/spell-attack-riders.ts");
  kit.setEnemy(zombie.id, { stats: { ...kit.enemy(zombie.id).stats, type: "undead" }, conditions: [CHILL_TOUCH_DREAD], conditionMeta: { [CHILL_TOUCH_DREAD]: { source: kara.id, untilTurnEndOf: kara.id } } });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(zombie.id, 6, 5);
  kit.giveTurn(kara.id);
  const swings = await walkAway(kara, world.owner);
  assert.equal(swings.length, 1, "the zombie strikes as she pulls away");
  assert.equal(swings[0].advantage, "disadvantage");
});

await test("E05 an Elusive rogue walking off two wolves is struck with no advantage, Pack Tactics or not", async () => {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [kara.id]: 10, [bram.id]: 19 } });
  const [wolf, packmate] = world.enemies();
  const PACK = ["Pack Tactics: The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature and the ally isn't incapacitated."];
  for (const foe of [wolf, packmate]) {
    kit.setEnemy(foe.id, { stats: { ...kit.enemy(foe.id).stats, traits: PACK } });
  }
  const features = world.sheet(bram.id).features ?? [];
  world.patch(bram.id, { features: [...features, { name: "Elusive", description: "No attack roll has advantage against you while you aren't incapacitated." }] });
  kit.place(bram.id, 5, 5);
  kit.place(kara.id, 15, 15);
  kit.place(wolf.id, 6, 5);
  kit.place(packmate.id, 6, 6);
  kit.giveTurn(bram.id);
  const swings = await walkAway(bram, { id: bram.userId });
  world.patch(bram.id, { features });
  assert.equal(swings.length, 2);
  for (const swing of swings) {
    assert.notEqual(swing.advantage, "advantage", `${swing.detail}: Elusive takes the advantage away`);
  }
});

test("E06 a ghoul's claws are read as sparing elves and undead", async () => {
  const { readAttackText } = await import("../src/lib/bestiary/attack-text.ts");
  const claws = readAttackText(
    "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) slashing damage. If the target is a creature other than an elf or undead, it must succeed on a DC 10 Constitution saving throw or be paralyzed for 1 minute. The target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success.",
  );
  assert.deepEqual(claws.onHit?.spares, ["elf", "undead"]);
  assert.equal(claws.onHit?.condition, "paralyzed");
});

// A server with no content pack builds its ghoul from the bundled SRD table
// (srd-creatures.json), whose rider names the same exception as `exempt`.
// The enemy's rider handed all of it to the GM, so the claws rolled no save.
await test("E06 the bundled table's ghoul keeps its claws' save and spares elves and undead, as the pack's reading does", async () => {
  const { SRD_CREATURES } = await import("../src/lib/srd/srd-creatures.ts");
  const { enemyAttackOf } = await import("../src/lib/srd/creature-attacks.ts");
  const ghoul = SRD_CREATURES.find((entry) => entry.name === "Ghoul");
  const claws = enemyAttackOf(ghoul.attacks.find((entry) => entry.name === "Claws"));
  assert.deepEqual(claws.onHit?.spares, ["elf", "undead"]);
  assert.deepEqual([claws.onHit?.save, claws.onHit?.dc, claws.onHit?.condition, claws.onHit?.rounds, claws.onHit?.repeatSave], ["con", 10, "paralyzed", 10, true]);
  assert.equal(claws.onHit?.manual, undefined, JSON.stringify(claws.onHit));
});

// A creature built in the workshop from a pack's block goes through the
// other conversion (creatureAttackOf), which dropped the kinds the rider
// spares: a story pet made from a ghoul paralyzed elves.
await test("E06 a ghoul's claws copied into a workshop creature still spare elves and undead, and come back the same", async () => {
  const { SRD_CREATURES } = await import("../src/lib/srd/srd-creatures.ts");
  const { creatureAttackOf, enemyAttackOf } = await import("../src/lib/srd/creature-attacks.ts");
  const read = enemyAttackOf(SRD_CREATURES.find((entry) => entry.name === "Ghoul").attacks.find((entry) => entry.name === "Claws"));
  const copied = creatureAttackOf(read);
  assert.deepEqual(copied.onHit?.exempt, ["elf", "undead"], JSON.stringify(copied.onHit));
  assert.deepEqual(enemyAttackOf(copied).onHit?.spares, ["elf", "undead"]);
});

await test("E06 a ghoul's claws paralyze a human who fails the save, and pass over an elf", async () => {
  const sylvi = world.addHero({ name: "Sylvi", race: "elf", class: "fighter", level: 3, maxHp: 60, abilities: { con: 10 }, proficiencies: TRAINED });
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18, [sylvi.id]: 17 } });
  const [ghoul] = world.enemies();
  const stats = srd("Ghoul");
  kit.setEnemy(ghoul.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(sylvi.id, 5, 5);
  kit.place(kara.id, 7, 5);
  kit.place(ghoul.id, 6, 5);
  kit.place(bram.id, 15, 15);
  for (const [hero, paralyzed] of [[sylvi, false], [kara, true]]) {
    kit.freshRound();
    kit.enemyTurn(ghoul.id);
    // A hit, 2d4 + 2, and a 1 on the save if one is asked.
    world.dice(19, 3, 3, 1);
    const out = await world.invoke("enemy_attack", { enemyId: ghoul.id, targetCharacterId: hero.id, attack: "Claws" });
    world.clearDice();
    assert.equal(out.ok, true, out.error);
    assert.equal(world.sheet(hero.id).conditions.includes("paralyzed"), paralyzed, `${hero.name}: ${JSON.stringify(out.result.swings)}`);
  }
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  world.patch(sylvi.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, dead: true } });
});

await test("E07 a pteranodon with Flyby flying out of the fighter's reach draws no opportunity attack; walking, it does", async () => {
  const maps = await import("../src/lib/db/battle-maps.ts");
  const FLYBY = ["Flyby: The pteranodon doesn't provoke opportunity attacks when it flies out of an enemy's reach."];
  for (const aloft of [true, false]) {
    await kit.endFight();
    await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
    const [foe] = world.enemies();
    kit.setEnemy(foe.id, { stats: { ...kit.enemy(foe.id).stats, speed: "10 ft., fly 60 ft.", traits: FLYBY } });
    kit.place(kara.id, 5, 5);
    kit.place(bram.id, 15, 15);
    kit.place(foe.id, 6, 5);
    if (aloft) {
      maps.setTokenMovement(kit.token(foe.id).id, "fly");
    }
    kit.enemyTurn(foe.id);
    const before = new Set(kit.lastRolls(40).map((roll) => roll.id));
    const moved = await world.invoke("move_token", { token: foe.id, x: 8, y: 5 });
    world.clearDice();
    assert.equal(moved.ok, true, moved.error);
    const swings = kit.lastRolls(40).filter((roll) => !before.has(roll.id) && roll.kind === "attack");
    const struck = world.encounter().reactionsUsed.includes(kara.id) || swings.length > 0;
    assert.equal(struck, !aloft, aloft ? "Flyby: no swing at a creature flying out of reach" : "walking out of reach still provokes");
  }
});

await test("E08 a boar's Relentless leaves it at 1 hit point from 7 damage or less, once; past 7, or the second time, it falls", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [boar] = world.enemies();
  const stats = srd("Boar");
  kit.setEnemy(boar.id, { ac: 5, maxHp: stats.maxHp, currentHp: 3, stats: { ...stats, ac: 5 } });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(boar.id, 6, 5);
  // Kara's fist, 1 + her Strength 3: 4 damage, 7 or less.
  kit.giveTurn(kara.id);
  const first = await kit.swing(kara.id, boar.id, [15]);
  assert.equal(first.ok, true, first.error);
  assert.equal(kit.enemy(boar.id).status, "alive", JSON.stringify(first.result));
  assert.equal(kit.enemy(boar.id).currentHp, 1, "Relentless: 1 hit point instead");
  kit.giveTurn(kara.id);
  await kit.swing(kara.id, boar.id, [15]);
  assert.equal(kit.enemy(boar.id).status, "dead", "used once, the next drop is its last");

  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [big] = world.enemies();
  kit.setEnemy(big.id, { ac: 5, maxHp: stats.maxHp, currentHp: 5, stats: { ...stats, ac: 5 } });
  const out = await world.invoke("damage_enemy", { enemyId: big.id, amount: 9, type: "slashing", source: "hazard" });
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(big.id).status, "dead", "9 damage is past what Relentless holds");
});

await test("E09 Pounce and Trampling Charge are read from the block: the run, the attack, the DC and the bonus attack", async () => {
  const { readChargeTrait } = await import("../src/lib/dm/charge-logic.ts");
  assert.deepEqual(
    readChargeTrait("Pounce: If the lion moves at least 20 ft. straight toward a creature and then hits it with a claw attack on the same turn, that target must succeed on a DC 13 Strength saving throw or be knocked prone. If the target is prone, the lion can make one bite attack against it as a bonus action."),
    { name: "Pounce", feet: 20, attacks: ["claw"], prone: true, save: { ability: "str", dc: 13 }, bonus: ["bite"] },
  );
  assert.deepEqual(
    readChargeTrait("Trampling Charge: If the horse moves at least 20 ft. straight toward a creature and then hits it with a hooves attack on the same turn, that target must succeed on a DC 14 Strength saving throw or be knocked prone. If the target is prone, the horse can make another attack with its hooves against it as a bonus action."),
    { name: "Trampling Charge", feet: 20, attacks: ["hooves"], prone: true, save: { ability: "str", dc: 14 }, bonus: ["hooves"] },
  );
  // A terser book's wording, and a weretiger's form note and choice of bites.
  assert.deepEqual(
    readChargeTrait("Pounce: If it moves 20'+ straight toward creature and hits it with Claw on same turn target knocked prone (DC 15 Str negates). If target prone cyonaxin can make one Bite attack vs. it as a bonus action."),
    { name: "Pounce", feet: 20, attacks: ["claw"], prone: true, save: { ability: "str", dc: 15 }, bonus: ["bite"] },
  );
  assert.deepEqual(readChargeTrait("Pounce (Tiger or Hybrid Form Only): If the weretiger moves at least 15 feet straight toward a creature and then hits it with a Claw attack on the same turn, that target must succeed on a DC 14 STR save or be knocked prone. If the target is prone, the weretiger can make one Bite or Claw attack against it as a bonus action.")?.bonus, ["bite", "claw"]);
  // What it cannot read whole stays the GM's: a mounted charge, a pounce with
  // no straight run, two bonus attacks.
  assert.equal(readChargeTrait("Charge: If the ghost knight is mounted and moves at least 30 feet in a straight line toward a target and hits it with a melee attack on the same turn, the target takes an extra 7 (2d6) damage."), null);
  assert.equal(readChargeTrait("Pounce: When the risen reaver hits an enemy with its blade attack after moving at least 20 feet, the target creature must make a DC 15 Strength saving throw."), null);
  assert.equal(readChargeTrait("Pounce: If the likho moves at least 20 feet straight toward a creature and then hits it with a claw attack on the same turn, that target must succeed on a DC 14 Strength saving throw or be knocked prone. If the target is prone, the likho can use a bonus action to make two additional claw attacks against it."), null);
  const { manualTraits } = await import("../src/lib/dm/monster-traits.ts");
  assert.ok(!manualTraits(srd("Lion")).includes("Pounce"), "the lion's Pounce is the engine's, not the GM's");
  assert.ok(!manualTraits(srd("Triceratops")).includes("Trampling Charge"));
});

// A lion's own turn, five squares from Kara on an open field.
async function lionAt(x) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [lion] = world.enemies();
  const stats = srd("Lion");
  kit.setEnemy(lion.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(lion.id, x, 5);
  kit.enemyTurn(lion.id);
  return lion;
}

await test("E09 a lion that bounds 20 feet at Kara and claws her knocks her prone on a failed DC 13 STR save, then bites as its bonus action, once", async () => {
  const lion = await lionAt(10);
  // The claw hits for 1d6 + 3; Kara's STR save comes up 1.
  world.dice(19, 3, 1);
  const claw = await world.invoke("enemy_attack", { enemyId: lion.id, targetCharacterId: kara.id, attack: "Claw" });
  world.clearDice();
  assert.equal(claw.ok, true, claw.error);
  assert.ok(world.sheet(kara.id).conditions.includes("prone"), JSON.stringify(claw.result));
  // Prone within 5 feet: the bite rolls at advantage.
  world.dice(19, 19, 4);
  const bite = await world.invoke("enemy_attack", { enemyId: lion.id, targetCharacterId: kara.id, attack: "Bite" });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(swingsOf(bite).length, 1, "one bite");
  world.dice(19, 19, 4);
  const again = await world.invoke("enemy_attack", { enemyId: lion.id, targetCharacterId: kara.id, attack: "Bite" });
  world.clearDice();
  assert.equal(again.ok, false, "the bonus action is spent");
});

await test("E09 a lion that charges with no attack named makes its claw; one standing beside Kara knocks nobody down", async () => {
  const lion = await lionAt(10);
  world.dice(19, 3, 1);
  const out = await world.invoke("enemy_attack", { enemyId: lion.id, targetCharacterId: kara.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(swingsOf(out), ["Claw"], "the attack its Pounce rides");
  assert.ok(world.sheet(kara.id).conditions.includes("prone"));
  world.patch(kara.id, { conditions: [], conditionMeta: {} });

  const still = await lionAt(6);
  world.dice(19, 3, 1);
  const claw = await world.invoke("enemy_attack", { enemyId: still.id, targetCharacterId: kara.id, attack: "Claw" });
  world.clearDice();
  assert.equal(claw.ok, true, claw.error);
  assert.ok(!world.sheet(kara.id).conditions.includes("prone"), "no run, no Pounce");
  world.dice(19, 4);
  const bite = await world.invoke("enemy_attack", { enemyId: still.id, targetCharacterId: kara.id, attack: "Bite" });
  world.clearDice();
  assert.equal(bite.ok, false, "no Pounce, no bonus bite: its action is spent");
});

await test("E10 a Charge's extra dice, their type and its push are read; a charge of extra damage only leaves the GM nothing", async () => {
  const { readChargeTrait } = await import("../src/lib/dm/charge-logic.ts");
  const { withChargeDice } = await import("../src/lib/dm/enemy-charge.ts");
  const { manualTraits } = await import("../src/lib/dm/monster-traits.ts");
  const minotaur = readChargeTrait("Charge: If the minotaur moves at least 10 ft. straight toward a target and then hits it with a gore attack on the same turn, the target takes an extra 9 (2d8) piercing damage. If the target is a creature, it must succeed on a DC 14 Strength saving throw or be pushed up to 10 ft. away and knocked prone.");
  assert.deepEqual(minotaur, { name: "Charge", feet: 10, attacks: ["gore"], prone: true, extra: { dice: "2d8", type: "piercing" }, save: { ability: "str", dc: 14 }, pushFeet: 10 });
  assert.deepEqual(
    readChargeTrait("Charge: If the centaur moves at least 30 ft. straight toward a target and then hits it with a pike attack on the same turn, the target takes an extra 10 (3d6) piercing damage."),
    { name: "Charge", feet: 30, attacks: ["pike"], prone: false, extra: { dice: "3d6", type: "piercing" } },
  );
  // "An extra 7 (2d6) damage": the ram's own type.
  assert.deepEqual(readChargeTrait("Charge: If the elk moves at least 20 ft. straight toward a target and then hits it with a ram attack on the same turn, the target takes an extra 7 (2d6) damage. If the target is a creature, it must succeed on a DC 13 Strength saving throw or be knocked prone.").extra, { dice: "2d6" });
  // Dice of another type ride the blow as a part of their own.
  const blow = withChargeDice({ name: "Ram", toHit: 5, damage: "1d8+3", type: "bludgeoning" }, { name: "Charge", feet: 20, attacks: ["ram"], prone: false, extra: { dice: "2d6", type: "fire" } });
  assert.equal(blow.damage, "1d8+3+2d6");
  assert.equal(blow.type, "bludgeoning/fire");
  assert.deepEqual(blow.riders, [{ dice: "2d6", type: "fire" }]);
  for (const title of ["Minotaur", "Boar", "Centaur", "Elk", "Rhinoceros"]) {
    assert.ok(!manualTraits(srd(title)).includes("Charge"), `${title}: its Charge is the engine's`);
  }
});

// A minotaur's own turn, its near side four squares from Kara.
async function minotaurAt(x) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [bull] = world.enemies();
  const stats = srd("Minotaur");
  kit.setEnemy(bull.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(bull.id, x, 5);
  kit.enemyTurn(bull.id);
  return bull;
}

await test("E10 a minotaur that charges Kara gores her for its extra 2d8, and on a failed DC 14 STR save pushes her 10 feet and knocks her prone", async () => {
  const bull = await minotaurAt(9);
  // The gore hits: 2d8 + 4, then the Charge's 2d8, all 3s; Kara's save a 1.
  world.dice(19, 3, 3, 3, 3, 1);
  const out = await world.invoke("enemy_attack", { enemyId: bull.id, targetCharacterId: kara.id, attack: "Gore" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.swings[0].damage, 16, JSON.stringify(out.result.swings));
  assert.ok(world.sheet(kara.id).conditions.includes("prone"));
  const { tilesApart } = await import("../src/lib/dm/board-reach.ts");
  assert.equal(tilesApart(kit.token(kara.id), kit.token(bull.id)), 3, "pushed 10 feet straight away");

  const still = await minotaurAt(6);
  world.dice(19, 3, 3, 3, 3, 1);
  const gore = await world.invoke("enemy_attack", { enemyId: still.id, targetCharacterId: kara.id, attack: "Gore" });
  world.clearDice();
  assert.equal(gore.ok, true, gore.error);
  assert.equal(gore.result.swings[0].damage, 10, "no run, no Charge: 2d8 + 4");
  assert.ok(!world.sheet(kara.id).conditions.includes("prone"));
});

await test("E11 a shadow's Strength Drain is read: 1d4 off Strength, death at 0, until a short or long rest", async () => {
  const { readAttackText } = await import("../src/lib/bestiary/attack-text.ts");
  const drain = readAttackText(
    "Melee Weapon Attack: +4 to hit, reach 5 ft., one creature. Hit: 9 (2d6 + 2) necrotic damage, and the target's Strength score is reduced by 1d4. The target dies if this reduces its Strength to 0. Otherwise, the reduction lasts until the target finishes a short or long rest. If a non-evil humanoid dies from this attack, a new shadow rises from the corpse 1d4 hours later.",
  );
  assert.deepEqual(drain.onHit?.scoreDrain, { ability: "str", dice: "1d4", diesAtZero: true, until: "short" });
  assert.ok(!(drain.onHit?.manual ?? []).some((line) => /Strength score is reduced/.test(line)), "no longer the GM's");
  assert.deepEqual(
    readAttackText("Melee Weapon Attack: +5 to hit, reach 5 ft., one creature. Hit: 10 (3d6) necrotic damage, and the target's Charisma score is reduced by 1d4. The target dies if this reduces its Charisma to 0. Otherwise, the reduction lasts until the target finishes a long rest.").onHit?.scoreDrain,
    { ability: "cha", dice: "1d4", diesAtZero: true, until: "long" },
  );
});

await test("E11 a shadow's touch takes 1d4 from Kara's Strength (her attacks and checks feel it) until a short rest; at 0 Strength a hero dies", async () => {
  const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
  const { effectiveAbilities } = await import("../src/lib/srd/magic-items.ts");
  const strength = (sheet) => effectiveAbilities(sheet.abilities, sheet.equipment ?? [], sheet).str;
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [shade] = world.enemies();
  // Out of the sun: its Sunlight Weakness is no part of this.
  const printed = srd("Shadow");
  const indoors = (lines) => (lines ?? []).filter((line) => !/^sunlight/i.test(line));
  const stats = { ...printed, traits: indoors(printed.traits), fullTraits: indoors(printed.fullTraits) };
  kit.setEnemy(shade.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 7, 5);
  kit.place(shade.id, 6, 5);
  kit.enemyTurn(shade.id);
  assert.equal(computeSheetDerived(world.sheet(kara.id)).abilityMods.str, 3);
  // A hit, 2d6 + 2, and the drain's d4 a 4: Strength 16 to 12.
  world.dice(19, 3, 3, 4);
  const out = await world.invoke("enemy_attack", { enemyId: shade.id, targetCharacterId: kara.id, attack: "Strength Drain" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(strength(world.sheet(kara.id)), 12, JSON.stringify(out.result.swings));
  assert.equal(computeSheetDerived(world.sheet(kara.id)).abilityMods.str, 1);

  // Bram at Strength 3: the d4's 4 takes it to 0, and he dies.
  const abilities = world.sheet(bram.id).abilities;
  world.patch(bram.id, { abilities: { ...abilities, str: 3 } });
  kit.freshRound();
  kit.enemyTurn(shade.id);
  world.dice(19, 3, 3, 4);
  const fatal = await world.invoke("enemy_attack", { enemyId: shade.id, targetCharacterId: bram.id, attack: "Strength Drain" });
  world.clearDice();
  assert.equal(fatal.ok, true, fatal.error);
  assert.equal(world.sheet(bram.id).deathSaves?.dead, true, "Strength 0: dead");
  world.patch(bram.id, { abilities, currentHp: 90, deathSaves: null, conditions: [], conditionMeta: {} });

  // The suite's end of a fight wipes conditions; the drain is put back.
  const drained = world.sheet(kara.id);
  await kit.endFight();
  world.patch(kara.id, { conditions: drained.conditions, conditionMeta: drained.conditionMeta });
  assert.equal(strength(world.sheet(kara.id)), 12, "it outlasts the fight");
  // Greater Restoration ends "one reduction to one of the target's ability scores".
  const { curePlan } = await import("../src/lib/dm/cure-spell.ts");
  const { spellMechanicsFor } = await import("../src/lib/content/index.ts");
  const restoration = spellMechanicsFor({ spell: "Greater Restoration" })?.mech.cures;
  assert.deepEqual(curePlan(restoration, world.sheet(kara.id), "ability reduced").conditions, ["strength reduced (-4)"]);
  const rested = await world.invoke("take_rest", { kind: "short" });
  assert.equal(rested.ok, true, rested.error);
  assert.equal(strength(world.sheet(kara.id)), 16, "the reduction ends with the short rest");
});

const WEB = "Ranged Weapon Attack: +5 to hit, range 30/60 ft., one creature. Hit: The target is restrained by webbing. As an action, the restrained target can make a DC 12 Strength check, bursting the webbing on a success. The webbing can also be attacked and destroyed (AC 10; hp 5; vulnerability to fire damage; immunity to bludgeoning, poison, and psychic damage).";

await test("E13 a giant spider's Web is read: restrained, a DC 12 STR check to burst it, the webbing's AC, hit points and defences", async () => {
  const { readAttackText } = await import("../src/lib/bestiary/attack-text.ts");
  const web = readAttackText(WEB).onHit;
  assert.equal(web?.condition, "restrained");
  assert.deepEqual(web?.hold, { name: "webbing", check: { ability: "str", dc: 12 }, ac: 10, hp: 5, vulnerable: "fire", immune: "bludgeoning, poison, psychic" });
  assert.equal(web?.manual, undefined, "nothing of it is left to the GM");
  // Another book's wording: the webbing's numbers in a sentence of its own.
  assert.deepEqual(
    readAttackText("Ranged Weapon Attack: +5 to hit, range 30/60 ft., one creature. Hit: The creature is restrained by webbing. As an action, the restrained creature can make a DC 13 Strength check, escaping from the webbing on a success. The effect also ends if the webbing is destroyed. The webbing has AC 10, 5 hp, vulnerability to fire damage, and immunity to bludgeoning, poison, and psychic damage.").onHit?.hold,
    { name: "webbing", check: { ability: "str", dc: 13 }, ac: 10, hp: 5, vulnerable: "fire", immune: "bludgeoning, poison, psychic" },
  );
});

// A giant spider's Web on Kara, from the rulebook's own block.
async function webbed(before = () => {}) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [spider] = world.enemies();
  const stats = srd("Giant Spider");
  kit.setEnemy(spider.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  before();
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 6, 6);
  kit.place(spider.id, 9, 5);
  kit.enemyTurn(spider.id);
  world.dice(19);
  const out = await world.invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: kara.id, attack: "Web" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(kara.id).conditions.includes("restrained"), JSON.stringify(out.result.swings));
  return spider;
}

await test("E13 Kara webbed by a giant spider bursts it with her action and a DC 12 STR check; a failed check leaves her held", async () => {
  await webbed();
  kit.giveTurn(kara.id);
  world.dice(2);
  const stuck = await world.invoke("take_action", { characterId: kara.id, action: "escape" });
  world.clearDice();
  assert.equal(stuck.ok, true, stuck.error);
  assert.equal(stuck.result.success, false, JSON.stringify(stuck.result));
  assert.ok(world.sheet(kara.id).conditions.includes("restrained"));
  kit.giveTurn(kara.id);
  world.dice(12);
  const free = await world.invoke("take_action", { characterId: kara.id, action: "escape" });
  world.clearDice();
  assert.equal(free.ok, true, free.error);
  assert.equal(free.result.success, true, JSON.stringify(free.result));
  assert.ok(!world.sheet(kara.id).conditions.includes("restrained"), "15 vs DC 12: the webbing bursts");
});

await test("E13 the webbing is an object of its own: immune to bludgeoning, and 5 hit points of fire (doubled) or slashing destroy it and free her", async () => {
  await webbed();
  const blunt = await world.invoke("damage_object", { name: "webbing", damage: "6", damageType: "bludgeoning" });
  assert.equal(blunt.ok, true, blunt.error);
  assert.equal(blunt.result.damage, 0, JSON.stringify(blunt.result));
  assert.ok(world.sheet(kara.id).conditions.includes("restrained"));
  const fire = await world.invoke("damage_object", { name: "webbing", damage: "3", damageType: "fire" });
  assert.equal(fire.ok, true, fire.error);
  assert.equal(fire.result.damage, 6, "vulnerable to fire: 3 doubled");
  assert.ok(!world.sheet(kara.id).conditions.includes("restrained"), "the webbing is destroyed and she is free");
});

// A hero's own walk to (x, y) as their player makes it; the opportunity
// attacks it drew, by their stored rolls.
async function walkTo(user, x, y) {
  const before = new Set(kit.lastRolls(40).map((roll) => roll.id));
  const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn(user);
  const walked = await moveRoute.POST(new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x, y }) }), { params: Promise.resolve({ campaignId: world.campaignId }) });
  world.clearDice();
  assert.equal(walked.status, 200, await walked.text());
  return kit.lastRolls(40).filter((roll) => !before.has(roll.id) && roll.kind === "attack" && /opportunity attack/.test(roll.detail ?? ""));
}

await test("E14 under the Flanking variant, a goblin's opportunity attack at Kara walking out of a flank has advantage; the other's, after she left it, does not", async () => {
  const { updateGameSettings } = await import("../src/lib/db/campaigns.ts");
  const settings = world.campaign().gameSettings;
  updateGameSettings(world.campaignId, { variantRules: { ...settings.variantRules, flanking: true } });
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [east, west] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(east.id, 6, 5);
  kit.place(west.id, 4, 5);
  kit.giveTurn(kara.id);
  // Up and away to the north-west: she leaves the east goblin's reach from
  // between the two, the west one's a square later.
  const swings = await walkTo(world.owner, 2, 2);
  updateGameSettings(world.campaignId, { variantRules: settings.variantRules });
  const by = (foe) => swings.find((roll) => roll.attacker?.id === foe.id);
  assert.equal(swings.length, 2, JSON.stringify(swings.map((roll) => roll.detail)));
  assert.equal(by(east)?.advantage, "advantage", "flanked as she pulled away");
  assert.notEqual(by(west)?.advantage, "advantage", "out of the flank by then");
});

await test("E14 Heavy Armor Master takes 3 off a goblin's nonmagical opportunity attack, as off its own-turn blow", async () => {
  const kept = world.sheet(kara.id);
  world.patch(kara.id, { feats: [...(kept.feats ?? []), "Heavy Armor Master"], equipment: [...(kept.equipment ?? []), { name: "Plate", qty: 1, equipped: true }] });
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(goblin.id, 6, 5);
  kit.giveTurn(kara.id);
  const before = world.sheet(kara.id).currentHp;
  // A natural 20 to beat plate; the club's 1d6 + 2 doubled: 6 and 6 and 2.
  world.dice(20, 6, 6);
  const swings = await walkTo(world.owner, 2, 5);
  world.patch(kara.id, { feats: kept.feats ?? [], equipment: kept.equipment ?? [] });
  assert.equal(swings.length, 1);
  assert.equal(before - world.sheet(kara.id).currentHp, 11, "14 less Heavy Armor Master's 3");
});

await test("E14 a goblin that fails its WIS save against Kara's Sanctuary loses its opportunity attack", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(goblin.id, 6, 5);
  kit.giveTurn(kara.id);
  world.patch(kara.id, { conditions: ["sanctuary"], conditionMeta: { sanctuary: { source: kara.id } } });
  const before = world.sheet(kara.id).currentHp;
  // Its save a 1: turned away. Were the swing made, a 20 would land it.
  world.dice(1, 20, 6, 6);
  const swings = await walkTo(world.owner, 2, 5);
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  assert.equal(swings.length, 0, "no opportunity attack is rolled");
  assert.equal(world.sheet(kara.id).currentHp, before);
});

// A creature the party dominates, on its own turn, walking west off its old
// allies; the opportunity attacks it drew, by their stored rolls.
async function turncoatWalk(walker) {
  const encounters = await import("../src/lib/db/encounters.ts");
  encounters.patchEnemyConditions(walker.id, ["charmed"], { charmed: { spell: "Dominate Person", source: kara.id } });
  kit.enemyTurn(walker.id);
  const before = new Set(kit.lastRolls(40).map((roll) => roll.id));
  const moved = await world.invoke("move_token", { token: walker.id, x: 2, y: 5 });
  world.clearDice();
  assert.equal(moved.ok, true, moved.error);
  return kit.lastRolls(40).filter((roll) => !before.has(roll.id) && roll.kind === "attack" && /opportunity attack/.test(roll.detail ?? ""));
}

const PACK_WOLF = {
  traits: ["Pack Tactics: The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature and the ally isn't incapacitated."],
  attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing", mode: "melee", onHit: { save: "str", dc: 11, condition: "prone" } }],
};

await test("E15 a goblin the party dominates, walking off a wolf, is bitten with Pack Tactics' advantage and knocked prone on a failed save", async () => {
  await kit.endFight();
  await kit.fight(3, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [walker, wolf, packmate] = world.enemies();
  for (const foe of [wolf, packmate]) {
    kit.setEnemy(foe.id, { stats: { ...kit.enemy(foe.id).stats, ...PACK_WOLF } });
  }
  kit.place(kara.id, 15, 15);
  kit.place(bram.id, 17, 15);
  kit.place(walker.id, 5, 5);
  kit.place(wolf.id, 6, 5);
  kit.place(packmate.id, 5, 6);
  // The packmate has spent its reaction: it strikes nobody, and stands beside.
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, reactionsUsed: [...encounter.reactionsUsed, packmate.id] });
  // Two d20s for the advantage, the bite's 2d4, the goblin's STR save of 1.
  world.dice(15, 14, 2, 2, 1);
  const swings = await turncoatWalk(walker);
  assert.equal(swings.length, 1, JSON.stringify(swings.map((roll) => roll.detail)));
  assert.equal(swings[0].advantage, "advantage", "Pack Tactics, the packmate beside where it left");
  assert.ok(kit.enemy(walker.id).conditions.includes("prone"), "the bite's rider: knocked prone");
});

await test("E15 a creature with Magic Weapons strikes a dominated walker's resistance to nonmagical blows whole", async () => {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [walker, guard] = world.enemies();
  kit.setEnemy(walker.id, { maxHp: 40, stats: { ...kit.enemy(walker.id).stats, resist: "bludgeoning, piercing, and slashing from nonmagical attacks" } });
  kit.setEnemy(guard.id, { stats: { ...kit.enemy(guard.id).stats, traits: ["Magic Weapons: The guard's weapon attacks are magical."] } });
  kit.place(kara.id, 15, 15);
  kit.place(bram.id, 17, 15);
  kit.place(walker.id, 5, 5);
  kit.place(guard.id, 6, 5);
  // A hit, the club's 1d6 + 2 at 4: 6, not halved.
  world.dice(19, 4);
  const swings = await turncoatWalk(walker);
  assert.equal(swings.length, 1);
  assert.equal(kit.enemy(walker.id).currentHp, 34, "magical: the resistance does not halve it");
});

// Kara's pet walks with her (pet-place.ts: a pet has no token of its own).
const GREY = { name: "Grey", kind: "beast_companion", form: "wolf", hp: 11, maxHp: 11, ac: 13, speed: 40, attacks: [], notes: "" };
const HOOT = { name: "Hoot", kind: "familiar", form: "owl", hp: 1, maxHp: 1, ac: 11, speed: 5, fly: 60, attacks: [], notes: "Fly 60 ft.; darkvision 120 ft.; Flyby, Keen Hearing and Sight." };

async function petWalk(pet) {
  await kit.endFight();
  world.patch(kara.id, { pets: [pet] });
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(goblin.id, 6, 5);
  kit.giveTurn(kara.id);
  const disengage = await world.invoke("take_action", { characterId: kara.id, action: "disengage" });
  assert.equal(disengage.ok, true, disengage.error);
  // A hit, and the club's 1d6 + 2 at 4.
  world.dice(19, 4);
  const swings = await walkTo(world.owner, 2, 5);
  return { goblin, swings };
}

await test("E16 a companion walking off a goblin with its Disengaged ranger draws the goblin's opportunity attack, as any creature does", async () => {
  const { swings } = await petWalk(GREY);
  const pet = world.sheet(kara.id).pets.find((entry) => entry.name === "Grey");
  world.patch(kara.id, { pets: [] });
  assert.equal(swings.length, 1, "the goblin strikes the wolf: Kara's Disengage is hers, not its");
  assert.match(String(swings[0].detail), /Grey/);
  assert.equal(pet?.hp, 5, "11 less the club's 6");
});

await test("E16 an owl familiar's Flyby keeps it clear of the same swing", async () => {
  const { swings } = await petWalk(HOOT);
  const pet = world.sheet(kara.id).pets.find((entry) => entry.name === "Hoot");
  world.patch(kara.id, { pets: [] });
  assert.equal(swings.length, 0);
  assert.equal(pet?.hp, 1);
});

await test("E17 a Dreadful Glare's immunity is read for the kinds it covers: all mummies but not mummy lords, or mummies and mummy lords both", () => {
  const glare = (text) => parseSaveEffect(text).immuneAfter;
  assert.deepEqual(glare("If the target can see the mummy, it must succeed on a DC 11 Wisdom saving throw against this magic or become frightened until the end of the mummy's next turn. A target that succeeds on the saving throw is immune to the Dreadful Glare of all mummies (but not mummy lords) for the next 24 hours."), { rounds: 14400, onEnd: false, kinds: ["mummy"], except: ["mummy lord"] });
  assert.deepEqual(glare("If the target can see the mummy lord, it must succeed on a DC 16 Wisdom saving throw against this magic or become frightened until the end of the mummy's next turn. A target that succeeds on the saving throw is immune to the Dreadful Glare of all mummies and mummy lords for the next 24 hours."), { rounds: 14400, onEnd: false, kinds: ["mummy", "mummy lord"] });
  // Every other block's is its own creature's (E01).
  assert.equal(glare("must succeed on a DC 19 Wisdom saving throw or become frightened for 1 minute. If a creature's saving throw is successful or the effect ends for it, the creature is immune to the dragon's Frightful Presence for the next 24 hours.").kinds, undefined);
});

await test("E17 a hero who withstands one mummy's glare is immune to every mummy's, not a mummy lord's; withstanding the lord's covers mummies too", async () => {
  const { getDatabase } = await import("../src/lib/db/core.ts");
  await kit.endFight();
  await kit.fight(3, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [first, second, lord] = world.enemies();
  for (const [foe, title, slug] of [[first, "Mummy", "mummy"], [second, "Mummy", "mummy"], [lord, "Mummy Lord", "mummy-lord"]]) {
    const stats = srd(title);
    kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
    getDatabase().prepare("UPDATE encounter_enemies SET slug = ? WHERE id = ?").run(slug, foe.id);
  }
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 5, 7);
  kit.place(first.id, 7, 5);
  kit.place(second.id, 7, 6);
  kit.place(lord.id, 8, 8);
  const glare = async (foe, hero, face) => {
    kit.freshRound();
    kit.enemyTurn(foe.id);
    world.dice(face);
    const out = await world.invoke("cast_at_player", { casterEnemyId: foe.id, enemyAbility: "Dreadful Glare", characterId: hero.id });
    world.clearDice();
    return out;
  };
  const withstood = await glare(first, kara, 20);
  assert.equal(withstood.ok, true, withstood.error);
  const again = await glare(second, kara, 1);
  assert.equal(again.ok, false, "another mummy's glare: immune");
  assert.match(String(again.error), /immune/);
  const lords = await glare(lord, kara, 20);
  assert.equal(lords.ok, true, "the mummy's immunity is not to a mummy lord's glare");
  // Bram withstands the lord's: no mummy's glare reaches him now.
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  const lordOnBram = await glare(lord, bram, 20);
  assert.equal(lordOnBram.ok, true, lordOnBram.error);
  const mummyOnBram = await glare(first, bram, 1);
  assert.equal(mummyOnBram.ok, false, "the lord's covers all mummies");
});

await test("E18 a druid in an owl's form flying out of a goblin's reach keeps the owl's Flyby: no opportunity attack", async () => {
  const maps = await import("../src/lib/db/battle-maps.ts");
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(goblin.id, 6, 5);
  world.patch(kara.id, { wildShape: { form: "Owl", beastHp: 1, beastMaxHp: 1, beastAc: 11, kind: "wildshape", abilities: { str: 3, dex: 13, con: 8 }, speed: 5 } });
  maps.setTokenMovement(kit.token(kara.id).id, "fly");
  kit.giveTurn(kara.id);
  world.dice(19, 4);
  const swings = await walkTo(world.owner, 4, 5);
  world.patch(kara.id, { wildShape: null });
  maps.setTokenMovement(kit.token(kara.id).id, "walk");
  assert.equal(swings.length, 0, "the form's Flyby is hers while she wears it");
});

// E19: the party's own Pounce, Charge and Trampling Charge. A goblin 25 feet
// east of Kara, on her own turn.
const { findBeastForm, wildShapeRecord } = await import("../src/lib/srd/beast-forms.ts");
const { findSummonForm } = await import("../src/lib/srd/summon-forms.ts");
const { summonRecord } = await import("../src/lib/dm/summon-rules.ts");
const { spawnSummons } = await import("../src/lib/dm/summon-store.ts");

async function goblinAhead() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [goblin] = world.enemies();
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(goblin.id, 10, 5);
  return goblin;
}

// A creature Bram's spell made, on its own turn beside Kara.
function summoned(name, spell) {
  const form = findSummonForm(name);
  const record = summonRecord(form, { spell, casterId: bram.id, casterName: "Bram", concentration: false, castId: `e19-${name}` });
  const [made] = spawnSummons(world.campaign(), world.sheet(bram.id), { form, count: 1, record, rounds: null, slotLevel: null, initiative: "caster" });
  kit.place(made.id, 5, 6);
  kit.giveTurn(made.id);
  return made;
}

await test("E19 Kara in a tiger's form who runs 20 feet at a goblin and claws it knocks it prone on a failed DC 13 STR save, then bites as the bonus action, once", async () => {
  const goblin = await goblinAhead();
  world.patch(kara.id, { wildShape: wildShapeRecord(findBeastForm("Tiger"), { kind: "wildshape", abilities: { str: 17, dex: 15, con: 14 } }) });
  kit.giveTurn(kara.id);
  await walkTo(world.owner, 9, 5);
  // The claw hits for 1d8 + 3; the goblin's STR save comes up 1.
  world.dice(19, 4, 1);
  const claw = await world.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Claw" });
  world.clearDice();
  assert.equal(claw.ok, true, claw.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("prone"), JSON.stringify(claw.result));
  // Prone within 5 feet: the bite rolls at advantage, 1d10 + 3.
  world.dice(19, 19, 5);
  const bite = await world.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Bite" });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(world.encounter().turnBudget?.bonusUsed, true, "the bite is the bonus action");
  assert.equal(kit.enemy(goblin.id).currentHp, 40 - 7 - 8);
  // Her Extra Attack's second swing is still hers (Wild Shape keeps her
  // class features); after it the turn holds no attack and no bonus action.
  world.dice(19, 19, 5);
  const second = await world.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Bite" });
  world.clearDice();
  assert.equal(second.ok, true, second.error);
  world.dice(19, 19, 5);
  const again = await world.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Bite" });
  world.clearDice();
  world.patch(kara.id, { wildShape: null });
  assert.equal(again.ok, false, "one bonus bite");
});

await test("E19 the tiger standing beside the goblin knocks nobody down; with no board, the run is the call's word", async () => {
  const goblin = await goblinAhead();
  world.patch(kara.id, { wildShape: wildShapeRecord(findBeastForm("Tiger"), { kind: "wildshape", abilities: { str: 17, dex: 15, con: 14 } }) });
  kit.place(kara.id, 9, 5);
  kit.giveTurn(kara.id);
  world.dice(19, 4, 1);
  const still = await world.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Claw" });
  world.clearDice();
  assert.equal(still.ok, true, still.error);
  assert.ok(!kit.enemy(goblin.id).conditions.includes("prone"), "no run, no Pounce");

  const { getDatabase } = await import("../src/lib/db/core.ts");
  getDatabase().prepare("DELETE FROM battle_maps WHERE id = ?").run(kit.map().id);
  kit.giveTurn(kara.id);
  world.dice(19, 4, 1);
  const charged = await world.invoke("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Claw", charged: true });
  world.clearDice();
  world.patch(kara.id, { wildShape: null });
  assert.equal(charged.ok, true, charged.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("prone"), JSON.stringify(charged.result));
});

await test("E19 an elk Conjure Animals called charges 20 feet and rams for its extra 2d6, the goblin knocked prone on a failed DC 13 STR save", async () => {
  const goblin = await goblinAhead();
  const elk = summoned("Elk", "Conjure Animals");
  const ran = await world.invoke("move_token", { token: elk.id, x: 9, y: 6 });
  assert.equal(ran.ok, true, ran.error);
  // Ram 1d6 + 3 at 2, the charge's 2d6 at 3 and 4; the save comes up 1.
  world.dice(19, 2, 3, 4, 1);
  const ram = await world.invoke("pc_attack", { characterId: elk.id, targetEnemyId: goblin.id, weapon: "Ram" });
  world.clearDice();
  assert.equal(ram.ok, true, ram.error);
  assert.equal(kit.enemy(goblin.id).currentHp, 40 - (2 + 3 + 3 + 4), JSON.stringify(ram.result));
  assert.ok(kit.enemy(goblin.id).conditions.includes("prone"));
});

await test("E19 a Find Steed warhorse's Trampling Charge knocks the goblin prone, and its second hooves attack is the bonus action", async () => {
  const goblin = await goblinAhead();
  const horse = summoned("Warhorse", "Find Steed");
  await world.invoke("move_token", { token: horse.id, x: 9, y: 6 });
  // Hooves 2d6 + 4 at 3 and 3; the DC 14 STR save comes up 1.
  world.dice(19, 3, 3, 1);
  const first = await world.invoke("pc_attack", { characterId: horse.id, targetEnemyId: goblin.id, weapon: "Hooves" });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("prone"), JSON.stringify(first.result));
  world.dice(19, 19, 3, 3);
  const second = await world.invoke("pc_attack", { characterId: horse.id, targetEnemyId: goblin.id, weapon: "Hooves" });
  world.clearDice();
  assert.equal(second.ok, true, second.error);
  assert.equal(world.encounter().turnBudget?.bonusUsed, true, "the second hooves attack is the bonus action");
  assert.equal(kit.enemy(goblin.id).currentHp, 40 - 10 - 10);
});

await test("E19 Kara's panther companion, running with her 20 feet at the goblin, pounces: prone on a failed save, then its bite as its own bonus action", async () => {
  await kit.endFight();
  const panther = findBeastForm("Panther");
  world.patch(kara.id, { pets: [{ name: "Shade", kind: "beast_companion", form: "panther", hp: 13, maxHp: 13, ac: 12, speed: 50, attacks: panther.attacks, notes: "" }] });
  const goblin = await goblinAhead();
  kit.giveTurn(kara.id);
  await walkTo(world.owner, 9, 5);
  // Claw 1d4 + 2 at 2; the DC 12 STR save comes up 1.
  world.dice(19, 2, 1);
  const claw = await world.invoke("pet_attack", { characterId: kara.id, targetEnemyId: goblin.id, attack: "Claw" });
  world.clearDice();
  assert.equal(claw.ok, true, claw.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("prone"), JSON.stringify(claw.result));
  // Bite 1d6 + 2 at 4, with advantage on the prone goblin.
  world.dice(19, 19, 4);
  const bite = await world.invoke("pet_attack", { characterId: kara.id, targetEnemyId: goblin.id, attack: "Bite" });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  world.dice(19, 19, 4);
  const again = await world.invoke("pet_attack", { characterId: kara.id, targetEnemyId: goblin.id, attack: "Bite" });
  world.clearDice();
  world.patch(kara.id, { pets: [] });
  assert.equal(again.ok, false, "one bite");
  assert.equal(kit.enemy(goblin.id).currentHp, 40 - 4 - 6);
});

// E21: Freedom of Movement and a creature's webbing.
await test("E21 Kara under Freedom of Movement is still webbed by a giant spider (nonmagical), and slips the webbing for 5 feet of movement, no action and no check", async () => {
  await webbed(() => world.patch(kara.id, { conditions: ["freedom of movement"], conditionMeta: { "freedom of movement": { rounds: 600, spell: "Freedom of Movement" } } }));
  kit.giveTurn(kara.id);
  // A natural 1 on any check would keep her held: the slip asks none.
  world.dice(1);
  const out = await world.invoke("take_action", { characterId: kara.id, action: "escape" });
  world.clearDice();
  const after = world.sheet(kara.id);
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.feature, "Freedom of Movement", JSON.stringify(out.result));
  assert.ok(!after.conditions.includes("restrained"), "the webbing no longer holds her");
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false, "no action spent");
});

await test("E21 a goblin under Freedom of Movement held by a giant spider's webbing slips it for 5 feet of its movement, keeping its action", async () => {
  const spider = await webbed();
  world.patch(kara.id, { conditions: [], conditionMeta: {} });
  const [goblin] = await (async () => {
    await kit.endFight();
    await kit.fight(2, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
    return world.enemies();
  })();
  const { readAttackText } = await import("../src/lib/bestiary/attack-text.ts");
  const hold = readAttackText(WEB).onHit?.hold;
  assert.ok(hold, "the web's hold is read (E13)");
  kit.place(goblin.id, 3, 2);
  kit.setEnemy(goblin.id, {
    conditions: ["freedom of movement", "restrained"],
    conditionMeta: { "freedom of movement": { rounds: 600, spell: "Freedom of Movement" }, restrained: { source: spider.id, hold } },
  });
  kit.enemyTurn(goblin.id);
  world.dice(1);
  const out = await world.invoke("take_action", { action: "escape", enemyId: goblin.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.feature, "Freedom of Movement", JSON.stringify(out.result));
  assert.ok(!kit.enemy(goblin.id).conditions.includes("restrained"));
  const dodge = await world.invoke("take_action", { action: "dodge", enemyId: goblin.id });
  assert.equal(dodge.ok, true, `its action is still its own: ${dodge.error}`);
});

// E22: a shadow's Strength Drain on a creature, not only on a sheet.
async function shadowAndOgre() {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [shade, ogre] = world.enemies();
  const printed = srd("Shadow");
  const indoors = (lines) => (lines ?? []).filter((line) => !/^sunlight/i.test(line));
  const shadowStats = { ...printed, traits: indoors(printed.traits), fullTraits: indoors(printed.fullTraits) };
  kit.setEnemy(shade.id, { ac: shadowStats.ac, maxHp: shadowStats.maxHp, stats: shadowStats });
  const ogreStats = srd("Ogre");
  kit.setEnemy(ogre.id, { ac: ogreStats.ac, maxHp: ogreStats.maxHp, stats: ogreStats });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 15, 15);
  kit.place(shade.id, 7, 5);
  kit.place(ogre.id, 6, 5);
  // Dominated by Kara, the shadow strikes its old ally (enemy-strike.ts).
  const encounters = await import("../src/lib/db/encounters.ts");
  encounters.patchEnemyConditions(shade.id, ["charmed"], { charmed: { spell: "Dominate Person", source: kara.id } });
  kit.enemyTurn(shade.id);
  return { shade, ogre };
}

await test("E22 a shadow's touch on an ogre takes 1d4 from its Strength: its Strength save, Greatclub and Javelin feel it, until the fight ends", async () => {
  const { shade, ogre } = await shadowAndOgre();
  // A hit, 2d6 + 2, and the drain's d4 a 4: Strength 19 to 15, +4 to +2.
  world.dice(19, 3, 3, 4);
  const out = await world.invoke("enemy_attack", { enemyId: shade.id, targetCharacterId: ogre.id, attack: "Strength Drain" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  const drained = kit.enemy(ogre.id);
  assert.ok(drained.conditions.includes("strength reduced (-4)"), JSON.stringify(out.result));
  assert.equal(drained.stats.abilities.str, 15);
  const { saveModFor } = await import("../src/lib/bestiary/enemy-numbers.ts");
  assert.equal(saveModFor(drained.stats, "str"), 2);
  assert.deepEqual(drained.stats.attacks.map((attack) => attack.toHit), [4, 4], "both Strength attacks lose 2");
  // The ogre's greatclub at Kara: 2d8 + 4 - 2.
  const hp = world.sheet(kara.id).currentHp;
  kit.freshRound();
  kit.enemyTurn(ogre.id);
  world.dice(19, 4, 4);
  const club = await world.invoke("enemy_attack", { enemyId: ogre.id, targetCharacterId: kara.id, attack: "Greatclub" });
  world.clearDice();
  assert.equal(club.ok, true, club.error);
  assert.equal(world.sheet(kara.id).currentHp, hp - (4 + 4 + 2));
  world.patch(kara.id, { currentHp: hp });
  // No rest is kept for a creature's row: the drain is gone with the fight
  // (a foe brought back carries none of it).
  const { carryConditions } = await import("../src/lib/dm/foe-carry-logic.ts");
  assert.deepEqual(carryConditions(drained.conditions, drained.conditionMeta, 0, 0).conditions, []);
});

await test("E22 an ogre drained to Strength 0 by a shadow dies", async () => {
  const { shade, ogre } = await shadowAndOgre();
  kit.setEnemy(ogre.id, { stats: { abilities: { ...srd("Ogre").abilities, str: 3 } } });
  world.dice(19, 3, 3, 4);
  const out = await world.invoke("enemy_attack", { enemyId: shade.id, targetCharacterId: ogre.id, attack: "Strength Drain" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(ogre.id).status, "dead", JSON.stringify(out.result));
});

await test("E22 a brown bear Bram conjured, drained by a shadow, bites with its lowered Strength", async () => {
  const { shade, ogre } = await shadowAndOgre();
  const encounters = await import("../src/lib/db/encounters.ts");
  encounters.patchEnemyConditions(shade.id, [], {});
  const bear = summoned("Brown Bear", "Conjure Animals");
  kit.place(bear.id, 8, 5);
  kit.enemyTurn(shade.id);
  world.dice(19, 3, 3, 4);
  const touch = await world.invoke("enemy_attack", { enemyId: shade.id, targetCharacterId: bear.id, attack: "Strength Drain" });
  world.clearDice();
  assert.equal(touch.ok, true, touch.error);
  assert.ok(world.sheet(bear.id).conditions.includes("strength reduced (-4)"));
  // Bite +6 1d8 + 4 as printed, +4 and 1d8 + 2 at Strength 15.
  kit.place(bear.id, 7, 6);
  kit.giveTurn(bear.id);
  world.dice(10, 5);
  const bite = await world.invoke("pc_attack", { characterId: bear.id, targetEnemyId: ogre.id, weapon: "Bite" });
  world.clearDice();
  assert.equal(bite.ok, true, bite.error);
  assert.equal(bite.result.rolled, 14, JSON.stringify(bite.result));
  assert.equal(bite.result.damage, 7);
});

// E23: what a spell on a creature makes it immune to.
await test("E23 a goblin under Heroism cannot be frightened, one under Mind Blank cannot be charmed", async () => {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [brave, guarded] = world.enemies();
  kit.setEnemy(brave.id, { conditions: ["heroism"], conditionMeta: { heroism: { rounds: 10, spell: "Heroism" } } });
  kit.setEnemy(guarded.id, { conditions: ["mind blank"], conditionMeta: { "mind blank": { rounds: 14400, spell: "Mind Blank" } } });
  const fear = await world.invoke("set_enemy_condition", { enemyId: brave.id, condition: "frightened", sourceCharacterId: kara.id });
  assert.equal(fear.ok, false, "Heroism: immune to being frightened");
  assert.ok(!kit.enemy(brave.id).conditions.includes("frightened"));
  const charm = await world.invoke("set_enemy_condition", { enemyId: guarded.id, condition: "charmed", sourceCharacterId: kara.id });
  assert.equal(charm.ok, false, "Mind Blank: immune to being charmed");
  assert.ok(!kit.enemy(guarded.id).conditions.includes("charmed"));
});

await test("E23 a goblin under Freedom of Movement is not paralyzed by a spell, but a giant spider's web still holds it", async () => {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [goblin, spider] = world.enemies();
  const stats = srd("Giant Spider");
  kit.setEnemy(spider.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  kit.setEnemy(goblin.id, { conditions: ["freedom of movement"], conditionMeta: { "freedom of movement": { rounds: 600, spell: "Freedom of Movement" } } });
  const held = await world.invoke("set_enemy_condition", { enemyId: goblin.id, condition: "paralyzed", sourceCharacterId: kara.id, magical: true });
  assert.equal(held.ok, false, "magic cannot paralyze it");
  assert.ok(!kit.enemy(goblin.id).conditions.includes("paralyzed"));
  kit.place(kara.id, 2, 2);
  kit.place(goblin.id, 6, 5);
  kit.place(spider.id, 9, 5);
  const encounters = await import("../src/lib/db/encounters.ts");
  encounters.patchEnemyConditions(spider.id, ["charmed"], { charmed: { spell: "Dominate Monster", source: kara.id } });
  kit.enemyTurn(spider.id);
  world.dice(19);
  const web = await world.invoke("enemy_attack", { enemyId: spider.id, targetCharacterId: goblin.id, attack: "Web" });
  world.clearDice();
  assert.equal(web.ok, true, web.error);
  assert.ok(kit.enemy(goblin.id).conditions.includes("restrained"), `the web is no magic: ${JSON.stringify(web.result)}`);
});

finish();
