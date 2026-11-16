// A monster's hit that lays a disease or a curse running on the game clock
// and the rests (rules audit 2026-11-16, time lens follow-up, W10 on): the
// otyugh's bite and the rakshasa's claw, read from the rulebook's own blocks
// as the engine reads a pack row (statblock.ts parseMonster), so the suite
// needs no content pack. Dice forced.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { readPage, rowOfBlock } from "./lib/srd-bestiary.mjs";

const { test, finish } = suite("test-audit1116-time-riders");

const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { readAttackText } = await import("../src/lib/bestiary/attack-text.ts");
const { effectiveMaxHp } = await import("../src/lib/dm/condition-logic.ts");
const { renameEnemy } = await import("../src/lib/db/encounters.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
function srd(title) {
  const page = book.pages.find((entry) => entry.title === title && entry.kind === "monster");
  const parsed = parseMonster(rowOfBlock(title, readPage(page.md)));
  return parsed.stats ?? parsed;
}
// The two hits as SRD 5.1 prints them.
const RAKSHASA_CLAW =
  "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 9 (2d6 + 2) slashing damage, and the target is cursed if it is a creature. The magical curse takes effect whenever the target takes a short or long rest, filling the target's thoughts with horrible images and dreams. The cursed target gains no benefit from finishing a short or long rest. The curse lasts until it is lifted by a remove curse spell or similar magic.";
const OTYUGH_BITE =
  "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 12 (2d8 + 3) piercing damage. If the target is a creature, it must succeed on a DC 15 Constitution saving throw against disease or become poisoned until the disease is cured. Every 24 hours that elapse, the target must repeat the saving throw, reducing its hit point maximum by 5 (1d10) on a failure. The disease is cured on a success. The target dies if the disease reduces its hit point maximum to 0. This reduction to the target's hit point maximum lasts until the disease is cured.";

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const kara = world.addHero({ name: "Kara", class: "fighter", level: 10, maxHp: 90, abilities: { str: 16, con: 10 }, proficiencies: TRAINED });
const bram = world.addHero({ name: "Bram", class: "fighter", level: 10, maxHp: 90, abilities: { str: 16, con: 10 }, proficiencies: TRAINED });

// One creature of the rulebook's, on its own turn, beside the heroes.
async function stage(title) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [bram.id]: 18 } });
  const [foe] = world.enemies();
  const stats = srd(title);
  kit.setEnemy(foe.id, { ac: stats.ac, maxHp: stats.maxHp, stats });
  // The kit's dummy, named for the block it now plays.
  renameEnemy(foe.id, title);
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 5, 6);
  kit.place(foe.id, 6, 5);
  kit.enemyTurn(foe.id);
  return kit.enemy(foe.id);
}
const holds = (id, name) => world.sheet(id).conditions.some((entry) => entry.toLowerCase() === name);

await test("W10 the otyugh's bite is read as a disease the engine keeps: no turn-end save, no line left to the GM", () => {
  const bite = readAttackText(OTYUGH_BITE).onHit;
  assert.deepEqual(bite?.disease, { dice: "1d10" });
  assert.equal(bite?.repeatSave, undefined, "its repeat is every 24 hours, not each turn");
  assert.ok(!(bite?.manual ?? []).some((line) => /disease|24 hours/i.test(line)), `still the GM's: ${JSON.stringify(bite?.manual)}`);
});

await test("W10 a failed save against the otyugh's bite is a disease: poisoned until cured, a daily DC 15 CON save, 1d10 off the maximum on a failure, cured on a success", async () => {
  // SRD 5.1, Otyugh, Bite: "it must succeed on a DC 15 Constitution saving
  // throw against disease or become poisoned until the disease is cured.
  // Every 24 hours that elapse, the target must repeat the saving throw,
  // reducing its hit point maximum by 5 (1d10) on a failure. The disease is
  // cured on a success. The target dies if the disease reduces its hit point
  // maximum to 0. This reduction to the target's hit point maximum lasts
  // until the disease is cured."
  const otyugh = await stage("Otyugh");
  world.patch(kara.id, { currentHp: 90 });
  // The bite hits (19), 2d8 of 4 and 4, and Kara fails the DC 15 save (2);
  // both tentacles of the multiattack miss (1, 1).
  world.dice(19, 4, 4, 2, 1, 1);
  const bitten = await world.invoke("enemy_attack", { enemyId: otyugh.id, targetCharacterId: kara.id, attack: "Bite" });
  world.clearDice();
  assert.equal(bitten.ok, true, bitten.error);
  assert.ok(holds(kara.id, "poisoned"), `poisoned: ${world.sheet(kara.id).conditions.join(", ")}`);
  assert.ok(holds(kara.id, "diseased (otyugh)"), `the disease is held: ${world.sheet(kara.id).conditions.join(", ")}`);
  assert.equal(world.sheet(kara.id).conditionMeta.poisoned?.saveEnds, undefined, "no save at each turn's end");
  // A day: the save fails (3) and the d10 takes 7 off the maximum.
  world.dice(3, 7);
  await world.invoke("pass_time", { amount: 24, unit: "hours" });
  world.clearDice();
  assert.equal(effectiveMaxHp(world.sheet(kara.id)), 83, "1d10 off the maximum on a failed daily save");
  assert.ok(holds(kara.id, "poisoned"));
  // The next day's save succeeds (18): cured, and the maximum is whole again.
  world.dice(18);
  await world.invoke("pass_time", { amount: 24, unit: "hours" });
  world.clearDice();
  assert.ok(!holds(kara.id, "poisoned") && !holds(kara.id, "diseased (otyugh)"), `cured: ${world.sheet(kara.id).conditions.join(", ")}`);
  assert.equal(effectiveMaxHp(world.sheet(kara.id)), 90, "the reduction lasts until the disease is cured");
});

await test("W10 the otyugh's disease ended by a cure takes its poisoning with it and rolls no more", async () => {
  // SRD 5.1, Lesser Restoration: "end either one disease or one condition";
  // the bite's poisoning lasts "until the disease is cured".
  const otyugh = await stage("Otyugh");
  world.patch(kara.id, { currentHp: 90, conditions: [], conditionMeta: {} });
  world.dice(19, 4, 4, 2, 1, 1);
  await world.invoke("enemy_attack", { enemyId: otyugh.id, targetCharacterId: kara.id, attack: "Bite" });
  world.clearDice();
  world.dice(3, 6);
  await world.invoke("pass_time", { amount: 24, unit: "hours" });
  world.clearDice();
  assert.equal(effectiveMaxHp(world.sheet(kara.id)), 84);
  const cured = await world.invoke("clear_condition", { characterId: kara.id, condition: "diseased (otyugh)", reason: "lesser restoration" });
  assert.equal(cured.ok, true, cured.error);
  assert.equal(effectiveMaxHp(world.sheet(kara.id)), 90, "the maximum is whole with the disease cured");
  world.diceLog();
  await world.invoke("pass_time", { amount: 25, unit: "hours" });
  assert.ok(!holds(kara.id, "poisoned"), `its poisoning ends with it: ${world.sheet(kara.id).conditions.join(", ")}`);
  assert.equal(world.diceLog().filter((die) => die.sides === 20).length, 0, "no daily save for a cured disease");
});

await test("W10 the otyugh's disease kills when it takes the last of the maximum", async () => {
  const otyugh = await stage("Otyugh");
  world.patch(bram.id, { maxHp: 6, currentHp: 6, conditions: [], conditionMeta: {} });
  world.dice(19, 1, 1, 2, 1, 1);
  const bitten = await world.invoke("enemy_attack", { enemyId: otyugh.id, targetCharacterId: bram.id, attack: "Bite" });
  world.clearDice();
  assert.equal(bitten.ok, true, bitten.error);
  world.patch(bram.id, { currentHp: 4 });
  world.dice(3, 10);
  await world.invoke("pass_time", { amount: 24, unit: "hours" });
  world.clearDice();
  assert.equal(world.sheet(bram.id).deathSaves?.dead, true, "a maximum of 0: dead");
  world.patch(bram.id, { maxHp: 90, currentHp: 90, deathSaves: null, conditions: [], conditionMeta: {} });
});

await test("W11 the rakshasa's claw is read as a curse the engine keeps, not a line for the GM", () => {
  const claw = readAttackText(RAKSHASA_CLAW).onHit;
  assert.equal(claw?.condition, "cursed (nightmares)");
  assert.ok(!(claw?.manual ?? []).some((line) => /curse|benefit/i.test(line)), `still the GM's: ${JSON.stringify(claw?.manual)}`);
});

await test("W11 a hero the rakshasa's claw curses gains nothing from a long rest, a short rest or a day waited out, until the curse is lifted", async () => {
  // SRD 5.1, Rakshasa, Claw: "the target is cursed if it is a creature. The
  // magical curse takes effect whenever the target takes a short or long
  // rest, filling the target's thoughts with horrible images and dreams. The
  // cursed target gains no benefit from finishing a short or long rest. The
  // curse lasts until it is lifted by a remove curse spell or similar magic."
  const rakshasa = await stage("Rakshasa");
  world.patch(kara.id, { currentHp: 90, conditions: [], conditionMeta: {} });
  // The first claw hits (19) for 2d6 of 3 and 3; the second misses (1).
  world.dice(19, 3, 3, 1);
  const clawed = await world.invoke("enemy_attack", { enemyId: rakshasa.id, targetCharacterId: kara.id, attack: "Claw" });
  world.clearDice();
  assert.equal(clawed.ok, true, clawed.error);
  assert.ok(holds(kara.id, "cursed (nightmares)"), `cursed: ${world.sheet(kara.id).conditions.join(", ")}`);
  // Out of the fight (the kit's end wipes conditions; the curse is put back).
  const cursed = world.sheet(kara.id);
  await kit.endFight();
  world.patch(kara.id, { conditions: cursed.conditions, conditionMeta: cursed.conditionMeta });
  const worn = { currentHp: 40, hitDice: { die: "d10", total: 10, spent: 6 }, resources: { second_wind: { max: 1, used: 1 } } };
  world.patch(kara.id, worn);
  world.patch(bram.id, worn);
  const night = await world.invoke("take_rest", { kind: "long" });
  assert.equal(night.ok, true, night.error);
  assert.equal(world.sheet(kara.id).currentHp, 40, "no hit points from the night");
  assert.equal(world.sheet(kara.id).hitDice.spent, 6, "no hit dice back");
  assert.equal(world.sheet(bram.id).currentHp, effectiveMaxHp(world.sheet(bram.id)), "Bram, uncursed, rests");
  assert.match(String(night.result.unaffected ?? ""), /Kara \(cursed/, "the result says why");
  world.patch(bram.id, worn);
  const breather = await world.invoke("take_rest", { kind: "short", spend: [{ characterId: bram.id, dice: 1 }] });
  assert.equal(breather.ok, true, breather.error);
  assert.equal(world.sheet(kara.id).resources.second_wind.used, 1, "no Second Wind back from a short rest");
  assert.equal(world.sheet(bram.id).resources.second_wind.used, 0, "Bram's comes back");
  assert.match(JSON.stringify(breather.result), /Kara/, "the short rest names the cursed");
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  assert.equal(world.sheet(kara.id).currentHp, 40, "a day waited out is no rest for the cursed either");
  // Remove Curse lifts it, and the next night rests her.
  await world.invoke("clear_condition", { characterId: kara.id, condition: "cursed (nightmares)", reason: "remove curse" });
  await world.invoke("pass_time", { amount: 1, unit: "days" });
  assert.equal(world.sheet(kara.id).currentHp, effectiveMaxHp(world.sheet(kara.id)), "lifted, the next night rests her");
});

finish();
