// A reaction another character spends on the card a roll waits on
// (src/lib/dm/after-roll-logic.ts):
//
//   War God's Blessing (War Domain 6): +10 to an attack roll by a creature within
//   30 feet, for the cleric's reaction and a use of Channel Divinity.
//   Flash of Genius (Artificer 7): the artificer's Intelligence modifier on a
//   check or save by them or a creature within 30 feet, for their reaction.
//
// Before this both spent the use from the Hand and changed nothing.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-ally-reaction-on-roll");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getRoll } = await import("../src/lib/db/rolls.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { markReactionUsed } = await import("../src/lib/dm/turn-budget.ts");
const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");

// A fifth-level fighter: +6 to hit with the longsword. The goblin's AC is 15.
const hero = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 10 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
const helper = world.addHero({ class: "cleric", level: 6, maxHp: 44, abilities: { int: 16 }, proficiencies: TRAINED });
const BLESSING = { features: [{ name: "Channel Divinity: War God's Blessing", description: "" }], resources: { channel_divinity: { max: 2, used: 0 } } };
const FLASH = { features: [{ name: "Flash of Genius", description: "" }], resources: { art_flash_of_genius: { max: 3, used: 0 } } };

async function stage(patch = BLESSING, helperAt = [5, 3]) {
  await kit.endFight();
  world.patch(hero.id, { currentHp: 44, conditions: [] });
  world.patch(helper.id, { currentHp: 44, conditions: [], ...patch });
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [helper.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 15 });
  kit.place(hero.id, 5, 5);
  kit.place(helper.id, ...helperAt);
  kit.place(enemy.id, 5, 6);
  return enemy;
}
const open = () => listOpenPendingRolls(world.campaignId);
const offered = () => (open()[0]?.thrown?.options ?? []).map((option) => option.id);
const press = (who, id, body) => {
  world.signIn({ id: world.sheet(who.id).userId });
  return call(route, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
const channel = () => world.sheet(helper.id).resources.channel_divinity.used;
// The helper's player is at the table: a roll does not wait on an absent one
// (chronal-shift.ts playerAtTable).
const { subscribe } = await import("../src/lib/events.ts");
let helperHere = subscribe(world.campaignId, () => {}, world.sheet(helper.id).userId);
const revert = await world.route("campaigns/[campaignId]/audit/revert-turn");

await test("A miss the 10 turns waits on the cleric, who adds it and lands the hit, spending the use and the reaction.", async () => {
  const enemy = await stage();
  await kit.swing(hero.id, enemy.id, [5]);
  assert.deepEqual(offered(), ["war_gods_blessing"]);
  assert.equal(open()[0].thrown.options[0].by, helper.id);
  assert.equal(channel(), 0);
  const [pending] = open();
  world.dice(4);
  const out = await press(helper, pending.id, { use: "war_gods_blessing", by: helper.id });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, 21);
  assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
  assert.equal(channel(), 1);
  assert.match(getPendingRoll(pending.id).combatNote, /used War God's Blessing/);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7);
  const again = await kit.swing(hero.id, enemy.id, [5, 2]);
  assert.ok(again);
  assert.equal(open().length, 0, "the reaction is gone for this round");
});

await test("The roller cannot press it for the cleric. Keeping the roll still leaves the cleric's choice, and letting it stand lands the miss.", async () => {
  const enemy = await stage();
  await kit.swing(hero.id, enemy.id, [5]);
  const [pending] = open();
  const refused = await press(hero, pending.id, { use: "war_gods_blessing" });
  assert.equal(refused.status, 409);
  const named = await press(hero, pending.id, { use: "war_gods_blessing", by: helper.id });
  assert.equal(named.status, 403);
  assert.equal(channel(), 0);
  const kept = await press(hero, pending.id, { keep: true });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.equal(getPendingRoll(pending.id).status, "pending", "the roll waits on the cleric");
  assert.deepEqual(offered(), ["war_gods_blessing"]);
  const left = await press(helper, pending.id, { decline: true, by: helper.id });
  assert.equal(left.status, 200, JSON.stringify(left.json));
  assert.match(getPendingRoll(pending.id).combatNote, /MISS/);
  assert.equal(channel(), 0);
});

await test("Nothing waits beyond 30 feet, on a miss by more than 10, on a natural 1, or with the cleric's reaction spent.", async () => {
  const far = await stage(BLESSING, [5, 12]);
  kit.place(far.id, 5, 6);
  await kit.swing(hero.id, far.id, [5]);
  assert.equal(open().length, 0, "beyond 30 feet");
  const armored = await stage();
  kit.setEnemy(armored.id, { ac: 30 });
  await kit.swing(hero.id, armored.id, [5]);
  assert.equal(open().length, 0, "11 + 10 never reaches AC 30");
  const nat1 = await stage();
  await kit.swing(hero.id, nat1.id, [1]);
  assert.equal(open().length, 0, "a natural 1 misses whatever is added");
  const spent = await stage();
  markReactionUsed(world.encounter(), helper.id);
  await kit.swing(hero.id, spent.id, [5]);
  assert.equal(open().length, 0, "the reaction is gone");
});

await test("The cleric's own attack does not offer it: the feature names another creature.", async () => {
  world.patch(helper.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  const enemy = await stage();
  kit.place(helper.id, 5, 7);
  await kit.swing(helper.id, enemy.id, [5, 5]);
  assert.ok(!offered().includes("war_gods_blessing"));
  for (const pending of open()) await press(helper, pending.id, { keep: true });
});

await test("Flash of Genius: a failed save by an ally waits on the artificer, who adds their Intelligence modifier.", async () => {
  await kit.endFight();
  world.patch(helper.id, { conditions: [], ...FLASH });
  world.patch(hero.id, { conditions: [] });
  const roll = (characterId, kind, dc) => world.invoke("request_roll", { characterId, kind, ability: "wis", dc, reason: "the gate" });
  world.dice(9);
  await roll(hero.id, "saving_throw", 11);
  world.clearDice();
  assert.deepEqual(offered(), ["flash_of_genius"]);
  const [pending] = open();
  const before = pending.thrown.outcome.total;
  const out = await press(helper, pending.id, { use: "flash_of_genius", by: helper.id });
  assert.match(getPendingRoll(pending.id).combatNote ?? "", /used Flash of Genius/);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, before + 3);
  assert.equal(world.sheet(helper.id).resources.art_flash_of_genius.used, 1);
});

await test("Flash of Genius on the artificer's own roll, and not where the modifier cannot carry it.", async () => {
  await kit.endFight();
  world.patch(helper.id, { conditions: [], ...FLASH });
  const roll = (characterId, dc) => world.invoke("request_roll", { characterId, kind: "ability_check", ability: "wis", dc, reason: "the gate" });
  world.dice(9);
  await roll(helper.id, 11);
  world.clearDice();
  assert.deepEqual(offered(), ["flash_of_genius"]);
  await press(helper, open()[0].id, { use: "flash_of_genius" });
  world.dice(2);
  await roll(helper.id, 25);
  world.clearDice();
  assert.equal(open().length, 0, "3 never carries it");
});

await test("In a fight Flash of Genius needs the ally in sight, and War God's Blessing does not.", async () => {
  world.patch(helper.id, { ...BLESSING });
  const enemy = await stage();
  world.patch(hero.id, { conditions: ["invisible"] });
  await kit.swing(hero.id, enemy.id, [2, 2]);
  assert.ok(offered().includes("war_gods_blessing"), "the blessing asks only for 30 feet");
  for (const pending of open()) await press(hero, pending.id, { keep: true }), await press(helper, pending.id, { decline: true, by: helper.id });
  await stage(FLASH);
  world.patch(hero.id, { conditions: ["invisible"] });
  world.dice(9);
  await world.invoke("request_roll", { characterId: hero.id, kind: "saving_throw", ability: "wis", dc: 11, reason: "the gate" });
  world.clearDice();
  assert.ok(!offered().includes("flash_of_genius"), "the artificer cannot see them");
  for (const pending of open()) await press(hero, pending.id, { keep: true });
  world.patch(hero.id, { conditions: [] });
});

await test("A helper whose player has left the table is not waited on, for either, and the roller's miss or failure stands at once.", async () => {
  helperHere();
  try {
    const enemy = await stage();
    await kit.swing(hero.id, enemy.id, [5]);
    assert.equal(open().length, 0, "the miss lands: nobody else is online, so no clock would have ended the wait");
    assert.equal(channel(), 0);
    await kit.endFight();
    world.patch(helper.id, { conditions: [], ...FLASH });
    world.dice(9);
    await world.invoke("request_roll", { characterId: hero.id, kind: "saving_throw", ability: "wis", dc: 11, reason: "the gate" });
    world.clearDice();
    assert.equal(open().length, 0, "the failed save lands");
    assert.equal(world.sheet(helper.id).resources.art_flash_of_genius.used, 0);
  } finally {
    helperHere = subscribe(world.campaignId, () => {}, world.sheet(helper.id).userId);
  }
});

await test("Reverting the turn gives War God's Blessing's use and the cleric's reaction back.", async () => {
  world.patch(helper.id, { ...BLESSING });
  const enemy = await stage();
  await kit.swing(hero.id, enemy.id, [5]);
  const [pending] = open();
  assert.ok(pending?.turnId, "the miss waits on a turn");
  world.dice(4);
  const out = await press(helper, pending.id, { use: "war_gods_blessing", by: helper.id });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(channel(), 1);
  assert.ok(world.encounter().reactionsUsed.includes(helper.id));
  world.signIn(world.owner);
  const undone = await call(revert, "POST", { turnId: pending.turnId, confirm: true }, { campaignId: world.campaignId });
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  assert.equal(channel(), 0, "the use is back");
  assert.ok(!world.encounter().reactionsUsed.includes(helper.id), "and the reaction");
});

await test("A Flash of Genius whose artificer's reaction is spent is not offered, and one helper holding two choices is asked once.", async () => {
  await stage(FLASH);
  markReactionUsed(world.encounter(), helper.id);
  world.dice(9);
  await world.invoke("request_roll", { characterId: hero.id, kind: "saving_throw", ability: "wis", dc: 11, reason: "the gate" });
  world.clearDice();
  assert.equal(open().length, 0, "the reaction is gone");
  await kit.endFight();
  const both = { features: [...FLASH.features, { name: "Chronal Shift", description: "" }], resources: { ...FLASH.resources, sub_chronal_shift: { max: 2, used: 0 } } };
  world.patch(helper.id, { conditions: [], ...both });
  world.dice(9);
  await world.invoke("request_roll", { characterId: hero.id, kind: "saving_throw", ability: "wis", dc: 11, reason: "the gate" });
  world.clearDice();
  const [pending] = open();
  assert.deepEqual(pending.thrown.options.map((option) => [option.id, option.by]).sort(), [["chronal_shift", helper.id], ["flash_of_genius", helper.id]]);
  // The same 9 again: the save still fails, and Flash of Genius would carry
  // it, but the artificer has answered this roll.
  world.dice(9);
  const shifted = await press(helper, pending.id, { use: "chronal_shift", by: helper.id });
  world.clearDice();
  assert.equal(shifted.status, 200, JSON.stringify(shifted.json));
  assert.equal(getPendingRoll(pending.id).status !== "pending", true, "nothing more is offered to the same helper");
  assert.equal(world.sheet(helper.id).resources.art_flash_of_genius.used, 0);
  world.dice(9);
  await world.invoke("request_roll", { characterId: hero.id, kind: "saving_throw", ability: "wis", dc: 11, reason: "the gate" });
  world.clearDice();
  const [again] = open();
  const left = await press(helper, again.id, { decline: true, by: helper.id });
  assert.equal(left.status, 200, JSON.stringify(left.json));
  assert.equal(getPendingRoll(again.id).status !== "pending", true, "one Let it stand answers both");
});

// "You can use your reaction to add your Intelligence modifier to the roll"
// (Artificer 7): the modifier goes on the roll, so it is spent where a roll
// waits (this card, or the stop before a roll that cannot wait for an
// artificer watching the fight) and never by a call that names no roll. This
// suite pinned the bare spend, which took the use and added nothing.
await test("Neither is a card in the Hand, and a bare use_resource spend of Flash of Genius is refused with nothing spent.", async () => {
  await kit.endFight();
  world.patch(helper.id, { features: [...BLESSING.features, ...FLASH.features], resources: { ...BLESSING.resources, ...FLASH.resources } });
  const names = deriveHand(world.sheet(helper.id), FRESH_TURN, {}).map((card) => card.name);
  for (const name of ["War God's Blessing", "Flash of Genius"]) {
    assert.ok(!names.includes(name), name);
  }
  const out = await world.invoke("use_resource", { characterId: helper.id, resource: "Flash of Genius" });
  assert.equal(out.ok, false, "a bare spend of Flash of Genius was taken");
  assert.equal(world.sheet(helper.id).resources.art_flash_of_genius.used, 0);
});

// A save a creature forces is the player's own roll (character-roll.ts): it
// waits on the artificer's card before the damage lands, so nothing has to
// be given back afterwards.
await test("Flash of Genius: a save a creature forces on an ally waits on the artificer before its damage lands.", async () => {
  const enemy = await stage(FLASH);
  kit.setEnemy(enemy.id, { stats: { spells: ["Sacred Flame"] } });
  const order = world.encounter();
  const { saveEncounter } = await import("../src/lib/db/encounters.ts");
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.enemyId === enemy.id), turnBudget: null, reactionsUsed: [] });
  // A 10 on the die with Dexterity +0: 10 against DC 12, and +3 makes it 13.
  world.dice(10, 6);
  await world.invoke("cast_at_player", { characterId: hero.id, spell: "Sacred Flame", saveAbility: "dex", dc: 12, damage: "1d8", damageType: "radiant", casterEnemyId: enemy.id });
  assert.deepEqual(offered(), ["flash_of_genius"], "the forced save did not wait on the artificer");
  assert.equal(world.sheet(hero.id).currentHp, 44, "the damage landed before the artificer answered");
  const [pending] = open();
  const out = await press(helper, pending.id, { use: "flash_of_genius", by: helper.id });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(world.sheet(hero.id).currentHp, 44, "a save made good by Flash of Genius still cost its damage");
  assert.equal(world.sheet(helper.id).resources.art_flash_of_genius.used, 1);
});

world.close();
finish();
