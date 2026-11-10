// The after-the-roll table (src/lib/dm/after-roll-table.ts): one row per
// choice a character makes after a d20 lands, read by the card, the watch
// stop, the route enums and the client's types. This suite holds the table's
// own promises and the two rows it brought to the card:
//
//   Restore Balance (Clockwork Soul 1): a reaction cancels advantage or
//   disadvantage on a roll within 60 feet. On the card, after the dice, a
//   roll with disadvantage counts its first d20, as if the second had never
//   been rolled; offered on the sorcerer's own roll or an ally's in sight.
//   Violent Attraction (Graviturgy 10): when a creature the wizard can see
//   within 60 feet hits with a weapon attack, a reaction adds 1d10 to its
//   damage. An ally's hit waits on the wizard's screen.
//
// Before this both were Hand cards played after the roll had landed: they
// spent the use and changed nothing.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-after-roll-table");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getRoll, listRecentRolls } = await import("../src/lib/db/rolls.ts");
const table = await import("../src/lib/dm/after-roll-table.ts");
const route = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");

// A fifth-level fighter: +6 to hit with the longsword (1d8 + 3). The goblin's AC is 15.
const hero = world.addHero({ class: "fighter", level: 5, maxHp: 44, abilities: { str: 16, dex: 10, wis: 10 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
const helper = world.addHero({ class: "wizard", level: 10, maxHp: 44, abilities: { int: 16, wis: 10 }, proficiencies: TRAINED });
const BALANCE = { features: [{ name: "Restore Balance", description: "" }], resources: { sub_restore_balance: { max: 2, used: 0 } } };
const ATTRACTION = { features: [{ name: "Violent Attraction", description: "" }], resources: { sub_violent_attraction: { max: 3, used: 0 } } };

async function stage(patch, helperAt = [5, 3], heroPatch = {}) {
  await kit.endFight();
  world.patch(hero.id, { currentHp: 44, conditions: [], ...heroPatch });
  world.patch(helper.id, { currentHp: 44, conditions: [], features: [], resources: {}, ...patch });
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
const used = (id) => world.sheet(helper.id).resources[id].used;
// listRecentRolls lists the newest last.
const lastDamage = () => listRecentRolls(world.campaignId, 10).filter((roll) => roll.kind === "damage").at(-1);
const reacted = () => world.encounter()?.reactionsUsed.includes(helper.id) ?? false;
const save = (characterId, dc, advantage = "disadvantage") => world.invoke("request_roll", { characterId, kind: "saving_throw", ability: "wis", dc, advantage, reason: "the gate" });
// The helper's player is at the table: a roll does not wait on an absent one
// (chronal-shift.ts playerAtTable).
const { subscribe } = await import("../src/lib/events.ts");
subscribe(world.campaignId, () => {}, world.sheet(helper.id).userId);

await test("The table owns the card's choices, the route's enum and the watch stop's powers.", () => {
  const ids = table.AFTER_ROLL_ROWS.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "one row per choice");
  assert.deepEqual(table.AFTER_ROLL_IDS, ids);
  assert.deepEqual(Object.keys(table.WATCH_FEATURES), ["portent", "chronal_shift", "flash_of_genius", "favored_by_the_gods"]);
  assert.deepEqual(table.SAVE_HELPS, ["flash_of_genius", "favored_by_the_gods"]);
  for (const row of table.AFTER_ROLL_ROWS) {
    assert.ok(row.cost !== "counter" || row.counter, `${row.id}: a counter row names its counter`);
    assert.ok(row.whose === "own" || row.rangeFt, `${row.id}: another's roll needs a range`);
    assert.ok(row.label && row.note, `${row.id}: the card's words`);
  }
  assert.deepEqual([...table.AFTER_ROLL_COUNTERS].sort(), ["art_flash_of_genius", "sub_favored_by_the_gods", "sub_master_duelist"]);
});

await test("The route refuses a choice no row names, and asks again for one a row names that is not on offer.", async () => {
  await stage(BALANCE);
  world.dice(15, 4);
  await save(hero.id, 12);
  world.clearDice();
  const [pending] = open();
  assert.equal((await press(hero, pending.id, { use: "no_such_feature" })).status, 400);
  assert.equal((await press(hero, pending.id, { use: "violent_attraction" })).status, 409);
  await press(hero, pending.id, { keep: true });
  await press(helper, pending.id, { decline: true, by: helper.id });
});

await test("Restore Balance on an ally's save with disadvantage: the first d20 counts, for the sorcerer's use and reaction.", async () => {
  await stage(BALANCE);
  world.dice(15, 4);
  await save(hero.id, 12);
  world.clearDice();
  assert.deepEqual(offered(), ["restore_balance"]);
  const [pending] = open();
  assert.equal(pending.thrown.options[0].by, helper.id);
  assert.match(pending.thrown.options[0].label, /without disadvantage/);
  const before = pending.thrown.outcome.total;
  assert.equal(used("sub_restore_balance"), 0, "nothing is spent until they choose");
  const out = await press(helper, pending.id, { use: "restore_balance", by: helper.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, before - 4 + 15);
  assert.equal(used("sub_restore_balance"), 1);
  assert.ok(reacted(), "the reaction is spent");
  assert.match(getPendingRoll(pending.id).combatNote ?? "", /used Restore Balance/);
});

await test("Restore Balance waits for nothing where the first die is the low one, on advantage, beyond 60 feet, or with the reaction spent.", async () => {
  await stage(BALANCE);
  world.dice(4, 15);
  await save(hero.id, 12);
  world.clearDice();
  assert.equal(open().length, 0, "the first die is the one already kept");
  world.dice(4, 3);
  await save(hero.id, 12, "advantage");
  world.clearDice();
  assert.equal(open().length, 0, "cancelling an ally's advantage helps nobody");
  await stage(BALANCE, [5, 18]);
  world.dice(15, 4);
  await save(hero.id, 12);
  world.clearDice();
  assert.equal(open().length, 0, "beyond 60 feet");
  await stage(BALANCE);
  const { markReactionUsed } = await import("../src/lib/dm/turn-budget.ts");
  markReactionUsed(world.encounter(), helper.id);
  world.dice(15, 4);
  await save(hero.id, 12);
  world.clearDice();
  assert.equal(open().length, 0, "the reaction is gone");
});

await test("Restore Balance on the sorcerer's own save with disadvantage.", async () => {
  await stage(BALANCE);
  world.dice(16, 2);
  await save(helper.id, 12);
  world.clearDice();
  assert.deepEqual(offered(), ["restore_balance"]);
  const [pending] = open();
  assert.equal(pending.thrown.options[0].by, undefined, "the roller's own");
  const before = pending.thrown.outcome.total;
  const out = await press(helper, pending.id, { use: "restore_balance" });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, before - 2 + 16);
  assert.equal(used("sub_restore_balance"), 1);
});

await test("Restore Balance on a poisoned ally's attack: the first d20 turns the miss into a hit.", async () => {
  const enemy = await stage(BALANCE, [5, 3], { conditions: ["poisoned"] });
  // 3 + 6 = 9 misses AC 15 with disadvantage; the first die, 15 + 6 = 21, hits.
  await kit.swing(hero.id, enemy.id, [15, 3]);
  assert.deepEqual(offered(), ["restore_balance"]);
  const [pending] = open();
  world.dice(4);
  const out = await press(helper, pending.id, { use: "restore_balance", by: helper.id });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, 21);
  assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7);
});

await test("Violent Attraction: an ally's weapon hit waits on the wizard, who adds 1d10 to its damage for a use and the reaction.", async () => {
  const enemy = await stage(ATTRACTION);
  await kit.swing(hero.id, enemy.id, [12]);
  assert.deepEqual(offered(), ["violent_attraction"]);
  const [pending] = open();
  assert.equal(pending.thrown.options[0].by, helper.id);
  assert.equal(used("sub_violent_attraction"), 0, "nothing is spent until the hit stands");
  // The longsword's 1d8 shows 4 (+3), the 1d10 shows 6.
  world.dice(4, 6);
  const out = await press(helper, pending.id, { use: "violent_attraction", by: helper.id });
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.match(getPendingRoll(pending.id).combatNote, /HIT/);
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 13);
  assert.match(lastDamage().expression, /\+1d10$/, "the wizard's die rides the weapon's damage");
  assert.equal(used("sub_violent_attraction"), 1);
  assert.ok(reacted(), "the reaction is spent");
});

await test("Violent Attraction left alone: the wizard lets it stand and the hit deals what it would have.", async () => {
  const enemy = await stage(ATTRACTION);
  await kit.swing(hero.id, enemy.id, [12]);
  const [pending] = open();
  const kept = await press(hero, pending.id, { keep: true });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.equal(getPendingRoll(pending.id).status, "pending", "the hit waits on the wizard");
  world.dice(4);
  const left = await press(helper, pending.id, { decline: true, by: helper.id });
  world.clearDice();
  assert.equal(left.status, 200, JSON.stringify(left.json));
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 7);
  assert.doesNotMatch(lastDamage().expression, /\+1d10$/);
  assert.equal(used("sub_violent_attraction"), 0);
});

await test("Violent Attraction waits for nothing on a miss, beyond 60 feet, or with no use left.", async () => {
  const missed = await stage(ATTRACTION);
  await kit.swing(hero.id, missed.id, [3, 4]);
  assert.equal(open().length, 0, "a miss");
  const far = await stage(ATTRACTION, [5, 18]);
  await kit.swing(hero.id, far.id, [12, 4]);
  assert.equal(open().length, 0, "beyond 60 feet");
  const spent = await stage({ ...ATTRACTION, resources: { sub_violent_attraction: { max: 3, used: 3 } } });
  await kit.swing(hero.id, spent.id, [12, 4]);
  assert.equal(open().length, 0, "no use left");
});

finish();
