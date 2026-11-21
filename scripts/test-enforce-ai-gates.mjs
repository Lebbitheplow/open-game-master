// The AI DM asks the engine for damage, healing and binding conditions
// rather than writing them (docs/dnd-rules-audit-2026-10-09-extent.md, F17;
// src/lib/dm/ai-gate.ts):
//
//   - apply_damage, heal, damage_enemy and split_damage take dice the server
//     rolls, or a total the server rolled this turn that nothing has spent;
//     a number of the model's own is refused and nothing changes.
//   - set_condition lays a binding condition only after the save the server
//     rolls; clear_condition never lifts one a spell or a save keeps.
//   - The console keeps its free hand.
//
// Dice forced; every check reads a stored sheet or enemy row.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as callRoute } from "./lib/enforce-campaign.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-ai-gates");
const world = await openWorld();
const kit = await combatKit(world);
const { createDmTurn, getDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getRoll } = await import("../src/lib/db/rolls.ts");
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { getLatestEndedEncounter } = await import("../src/lib/db/encounters.ts");

const hero = world.addHero({ class: "fighter", level: 5, maxHp: 40, abilities: { wis: 10 }, proficiencies: TRAINED });

// One AI DM turn: every call in it shares the turn, as the model's do.
function aiTurn() {
  const turn = createDmTurn(world.campaignId, []);
  return (name, args = {}) => invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });
}

async function stage() {
  await kit.endFight();
  await kit.fight(1);
  world.patch(hero.id, { currentHp: 40, tempHp: 0, conditions: [], conditionMeta: {} });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 100 });
  return enemy;
}
const hp = () => world.sheet(hero.id).currentHp;

// ---- damage and healing ----

await test("The AI's bare damage number is refused and the hit points stay.", async () => {
  await stage();
  const out = await aiTurn()("apply_damage", { characterId: hero.id, amount: 7, type: "slashing", reason: "a goblin's scimitar" });
  assert.equal(out.ok, false, "the model wrote damage the server never rolled");
  assert.equal(hp(), 40);
});

await test("Dice the AI sends are rolled by the server: 2d6 of 3 and 4 is 7.", async () => {
  await stage();
  world.dice(3, 4);
  const out = await aiTurn()("apply_damage", { characterId: hero.id, dice: "2d6", type: "bludgeoning", reason: "falling rubble" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(), 33);
});

await test("A damage total the server rolled this turn is accepted once, and only once.", async () => {
  await stage();
  const call = aiTurn();
  world.dice(5);
  const rolled = await call("request_roll", { characterId: hero.id, kind: "damage", expression: "1d8", reason: "poison" });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  const first = await call("apply_damage", { characterId: hero.id, amount: 5, type: "poison" });
  assert.equal(first.ok, true, first.error);
  assert.equal(hp(), 35);
  const again = await call("apply_damage", { characterId: hero.id, amount: 5, type: "poison" });
  assert.equal(again.ok, false, "one roll paid for two hits");
  assert.equal(hp(), 35);
});

await test("Dice the AI sent for damage pay once: the same total sent bare afterwards is refused.", async () => {
  await stage();
  const call = aiTurn();
  world.dice(3, 4);
  const first = await call("apply_damage", { characterId: hero.id, dice: "2d6", type: "bludgeoning", reason: "falling rubble" });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.equal(hp(), 33);
  const again = await call("apply_damage", { characterId: hero.id, amount: 7, type: "bludgeoning" });
  assert.equal(again.ok, false, "the rubble's 7 landed a second time");
  assert.equal(hp(), 33);
});

await test("Dice the AI sent for healing pay once: the same total sent bare afterwards is refused.", async () => {
  await stage();
  world.patch(hero.id, { currentHp: 20 });
  const call = aiTurn();
  world.dice(2, 3);
  const first = await call("heal", { characterId: hero.id, dice: "2d4+2" });
  world.clearDice();
  assert.equal(first.ok, true, first.error);
  assert.equal(hp(), 27);
  const again = await call("heal", { characterId: hero.id, amount: 7 });
  assert.equal(again.ok, false, "one roll healed twice");
  assert.equal(hp(), 27);
});

await test("A total the engine rolled and landed inside its own call pays for no bare number: a fall's damage is not dealt again.", async () => {
  await stage();
  const call = aiTurn();
  world.dice(2, 3, 4);
  const fall = await call("apply_hazard", { type: "falling", feet: 30, characterIds: [hero.id] });
  world.clearDice();
  assert.equal(fall.ok, true, fall.error);
  assert.equal(hp(), 31, "30 feet is 3d6: 2, 3 and 4");
  const again = await call("apply_damage", { characterId: hero.id, amount: 9, type: "bludgeoning" });
  assert.equal(again.ok, false, "the fall's 9 landed a second time");
  assert.equal(hp(), 31);
});

await test("A total the AI asked for still pays after another call's dice came up the same.", async () => {
  await stage();
  const call = aiTurn();
  world.dice(4);
  const asked = await call("request_roll", { characterId: hero.id, kind: "damage", expression: "1d8", reason: "acid" });
  world.clearDice();
  assert.equal(asked.ok, true, asked.error);
  world.dice(1, 1, 2);
  const fall = await call("apply_hazard", { type: "falling", feet: 30, characterIds: [hero.id] });
  world.clearDice();
  assert.equal(fall.ok, true, fall.error);
  assert.equal(hp(), 36);
  const acid = await call("apply_damage", { characterId: hero.id, amount: 4, type: "acid" });
  assert.equal(acid.ok, true, acid.error);
  assert.equal(hp(), 32);
  const again = await call("apply_damage", { characterId: hero.id, amount: 4, type: "acid" });
  assert.equal(again.ok, false, "the fall's 4 paid for a second splash");
  assert.equal(hp(), 32);
});

await test("A total spent inside the engine's own call is no blow the character dealt: the fight's card counts nothing for a fall or rubble that hurt them.", async () => {
  await stage();
  const call = aiTurn();
  world.dice(2, 3, 4);
  const fall = await call("apply_hazard", { type: "falling", feet: 30, characterIds: [hero.id] });
  world.clearDice();
  assert.equal(fall.ok, true, fall.error);
  world.dice(3, 4);
  const rubble = await call("apply_damage", { characterId: hero.id, dice: "2d6", type: "bludgeoning", reason: "falling rubble" });
  world.clearDice();
  assert.equal(rubble.ok, true, rubble.error);
  assert.equal(hp(), 24);
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  const card = getLatestEndedEncounter(world.campaignId).summaryCard;
  const line = card.fighters.find((fighter) => fighter.characterId === hero.id);
  assert.ok(line, JSON.stringify(card.fighters));
  assert.equal(line.dealt, 0, "the fall's 9 and the rubble's 7 read as damage the hero dealt");
});

await test("Dice thrown as a waiting roll lands on the AI's turn pay for no bare number: a coat of poison's damage, on the turn now, is not dealt again.", async () => {
  // A table of its own: the turn waits on a player's choice and resumes.
  const table = await openWorld({ gameSettings: { ttsEnabled: false } });
  const tableKit = await combatKit(table);
  const model = await fakeModel();
  try {
    model.pointAt(table);
    const blade = table.addHero({
      name: "Vex", class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED,
      equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Poison, Basic (vial)", qty: 1 }],
    });
    const coated = await table.invoke("use_item", { characterId: blade.id, item: "Poison, Basic (vial)" });
    assert.equal(coated.ok, true, coated.error);
    await tableKit.fight(1, { heroFaces: { [blade.id]: 19 } });
    const [enemy] = table.enemies();
    tableKit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 15 });
    tableKit.place(blade.id, 5, 5);
    tableKit.place(enemy.id, 5, 6);
    // A held Bardic Inspiration die: the 11 that misses AC 15 waits on it.
    table.patch(blade.id, { conditions: [...table.sheet(blade.id).conditions, "bardic inspiration (d8)"] });
    model.script([reply({ calls: [modelCall("pc_attack", { characterId: blade.id, targetEnemyId: enemy.id })] }), reply({ text: "The blade bites." })]);
    table.dice(5);
    await model.turn(table, "I swing at the goblin.", blade.id, table.sheet(blade.id).userId);
    table.clearDice();
    const [pending] = listOpenPendingRolls(table.campaignId);
    assert.equal(pending?.parkedFor, "after_roll", "the miss does not wait on the die");
    table.signIn({ id: pending.userId });
    // The die (a hit), the sword's d8, the creature's save (a 1 fails), the d4.
    table.dice(6, 4, 1, 3);
    const landed = await callRoute(await table.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"), "POST", { use: "bardic" }, { campaignId: table.campaignId, pendingRollId: pending.id });
    table.clearDice();
    assert.equal(landed.status, 200, JSON.stringify(landed.json));
    await settleQueue(table.campaignId);
    const thrown = getDmTurn(pending.turnId).rollIds.map((id) => getRoll(id));
    const poison = thrown.find((roll) => /basic poison/i.test(roll?.detail ?? ""));
    assert.ok(poison, `the coat's damage is not on the turn: ${thrown.map((roll) => roll?.detail).join(", ")}`);
    const blow = thrown.find((roll) => roll?.kind === "damage" && roll.id !== poison.id);
    assert.ok(blow, "the hit's damage is not on the turn");
    const before = table.sheet(blade.id).currentHp;
    const call = (name, args) => invokeEngine(table.campaign(), { kind: "ai", turnId: pending.turnId }, { name, args });
    // The poison's roll is the one the landing stamps. The blow's own was
    // stamped as it landed (attack-blow.ts landRoll), and is here so the
    // gate is seen to refuse both.
    for (const roll of [poison, blow]) {
      const again = await call("apply_damage", { characterId: blade.id, amount: roll.total, type: "poison" });
      assert.equal(again.ok, false, `the ${roll.total} of "${roll.detail}" paid for a bare number`);
      assert.match(String(again.error), /rolled by the server, never written/, "refused, but not by the number gate");
      assert.equal(table.sheet(blade.id).currentHp, before);
    }
    // The turn still takes a total the model asks for: the gate refused the
    // two above for what they were, not because this turn takes no number.
    table.dice(5);
    const asked = await call("request_roll", { characterId: blade.id, kind: "damage", expression: "1d8", reason: "a splash of acid" });
    table.clearDice();
    assert.equal(asked.ok, true, asked.error);
    assert.notEqual(poison.total, 5);
    assert.notEqual(blow.total, 5);
    const paid = await call("apply_damage", { characterId: blade.id, amount: 5, type: "acid" });
    assert.equal(paid.ok, true, paid.error);
    assert.equal(table.sheet(blade.id).currentHp, before - 5);
  } finally {
    model.close();
    table.close();
  }
});

await test("The AI's bare healing number is refused; healing dice are rolled by the server.", async () => {
  await stage();
  world.patch(hero.id, { currentHp: 20 });
  const call = aiTurn();
  const bare = await call("heal", { characterId: hero.id, amount: 15 });
  assert.equal(bare.ok, false);
  assert.equal(hp(), 20);
  world.dice(2, 3);
  const rolled = await call("heal", { characterId: hero.id, dice: "2d4+2" });
  world.clearDice();
  assert.equal(rolled.ok, true, rolled.error);
  assert.equal(hp(), 27);
});

await test("damage_enemy from a hazard takes dice from the AI, never a bare number.", async () => {
  const enemy = await stage();
  const call = aiTurn();
  const bare = await call("damage_enemy", { enemyId: enemy.id, amount: 25, type: "fire", source: "hazard", reason: "burning oil" });
  assert.equal(bare.ok, false);
  assert.equal(kit.enemy(enemy.id).currentHp, 100);
  world.dice(6, 6);
  const dice = await call("damage_enemy", { enemyId: enemy.id, dice: "2d6", type: "fire", source: "hazard", reason: "burning oil" });
  world.clearDice();
  assert.equal(dice.ok, true, dice.error);
  assert.equal(kit.enemy(enemy.id).currentHp, 88);
});

await test("split_damage from the AI needs the server's roll.", async () => {
  const enemy = await stage();
  const out = await aiTurn()("split_damage", { amount: 20, type: "fire", targets: [{ enemyId: enemy.id, share: "full" }, { characterId: hero.id, share: "half" }] });
  assert.equal(out.ok, false);
  assert.equal(hp(), 40);
  assert.equal(kit.enemy(enemy.id).currentHp, 100);
});

// ---- binding conditions ----

await test("The AI cannot paralyze a character without a save; with one, the server rolls it first.", async () => {
  await stage();
  const call = aiTurn();
  const bare = await call("set_condition", { characterId: hero.id, condition: "paralyzed", rounds: 10 });
  assert.equal(bare.ok, false);
  assert.equal(world.sheet(hero.id).conditions.includes("paralyzed"), false);
  world.dice(19);
  const made = await call("set_condition", { characterId: hero.id, condition: "paralyzed", saveAbility: "wis", saveDc: 13 });
  world.clearDice();
  assert.equal(made.ok, true, made.error);
  assert.equal(world.sheet(hero.id).conditions.includes("paralyzed"), false, "a made save still paralyzed");
  world.dice(2);
  const failed = await call("set_condition", { characterId: hero.id, condition: "paralyzed", saveAbility: "wis", saveDc: 13 });
  world.clearDice();
  assert.equal(failed.ok, true, failed.error);
  assert.ok(world.sheet(hero.id).conditions.includes("paralyzed"));
});

await test("The AI cannot lift a paralysis a spell keeps; the console can.", async () => {
  await stage();
  world.patch(hero.id, { conditions: ["paralyzed"], conditionMeta: { paralyzed: { spell: "Hold Person", source: "someone", saveEnds: { ability: "wis", dc: 13 } } } });
  const out = await aiTurn()("clear_condition", { characterId: hero.id, condition: "paralyzed" });
  assert.equal(out.ok, false);
  assert.ok(world.sheet(hero.id).conditions.includes("paralyzed"));
  const console = await world.invoke("clear_condition", { characterId: hero.id, condition: "paralyzed" });
  assert.equal(console.ok, true, console.error);
  assert.equal(world.sheet(hero.id).conditions.includes("paralyzed"), false);
});

await test("The console's own bare numbers still land.", async () => {
  await stage();
  const out = await world.invoke("apply_damage", { characterId: hero.id, amount: 6, type: "slashing" });
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(), 34);
});

// ---- treasure ----

await test("A hoard is rolled and paid once a turn: the same roll_treasure again in that turn pays nothing more and reports the first payout.", async () => {
  await kit.endFight();
  const call = aiTurn();
  const before = world.sheet(hero.id).gold;
  const first = await call("roll_treasure", { cr: 4, characterIds: [hero.id], reason: "the ogre's chest" });
  assert.equal(first.ok, true, first.error);
  const paid = world.sheet(hero.id).gold - before;
  assert.ok(paid > 0, "the hoard paid");
  assert.equal(paid, first.result.totalGold);
  const again = await call("roll_treasure", { cr: 4, characterIds: [hero.id], reason: "The ogre's chest" });
  assert.equal(again.ok, true, again.error);
  assert.equal(world.sheet(hero.id).gold - before, paid, "the coin moved once");
  assert.equal(again.result.totalGold, first.result.totalGold);
  assert.match(again.result.note, /already rolled and paid this turn/);
  // Another hoard in the same turn is its own, and so is the next turn's.
  const purse = await call("roll_treasure", { cr: 4, characterIds: [hero.id], reason: "the ogre's purse", individual: true });
  assert.notEqual(purse.result.repeat, true);
  const later = await aiTurn()("roll_treasure", { cr: 4, characterIds: [hero.id], reason: "the ogre's chest" });
  assert.notEqual(later.result.repeat, true);
});

world.close();
finish();
