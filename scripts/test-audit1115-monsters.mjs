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

finish();
