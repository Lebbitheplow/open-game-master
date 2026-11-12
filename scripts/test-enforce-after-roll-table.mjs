// The after-the-roll table (src/lib/dm/after-roll-table.ts): one row per
// choice a character makes after a d20 lands, read by the card, the watch
// stop, the route enums and the client's types. This suite holds the table's
// own promises and the row it brought to the card (#907 brought Restore
// Balance too; by the ruling on issue #908 it is used before the roll):
//
//   Violent Attraction (Graviturgy 10): when a creature the wizard can see
//   within 60 feet hits with a weapon attack, a reaction adds 1d10 to its
//   damage. An ally's hit waits on the wizard's screen.
//
// Before this it was a Hand card played after the roll had landed: it spent
// the use and changed nothing.
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
  assert.deepEqual(Object.keys(table.WATCH_FEATURES), ["portent", "cosmic_omen", "restore_balance", "slayers_counter", "cloud_rune", "chronal_shift", "flash_of_genius", "favored_by_the_gods", "convergent_future", "bend_luck"]);
  // Portent, Cosmic Omen and Restore Balance go on the d20 before it is thrown.
  assert.deepEqual(Object.keys(table.WATCH_FEATURES).filter(table.armsBeforeRoll), ["portent", "cosmic_omen", "restore_balance"]);
  assert.deepEqual(table.SAVE_HELPS, ["flash_of_genius", "favored_by_the_gods"]);
  // The stop's own powers act at the stop; the watch rows are armed on the dice.
  assert.deepEqual(["portent", "slayers_counter", "cloud_rune", "chronal_shift"].map(table.answeredAtStop), [false, true, true, false]);
  assert.deepEqual(["portent", "slayers_counter", "cloud_rune", "chronal_shift", "bend_luck"].map(table.armsWatchRow), [false, false, false, true, true]);
  for (const row of table.AFTER_ROLL_ROWS) {
    assert.ok(row.cost !== "counter" || row.counter, `${row.id}: a counter row names its counter`);
    // Bend Luck asks for sight and no range: "another creature you can see".
    assert.ok(row.whose === "own" || row.rangeFt || row.sight, `${row.id}: another's roll needs a range or sight`);
    assert.ok(row.label && row.note, `${row.id}: the card's words`);
    assert.ok((row.effect === "own") === Boolean(row.module), `${row.id}: a row of its own names the module that offers and spends it`);
  }
  assert.deepEqual([...table.AFTER_ROLL_COUNTERS].sort(), ["art_flash_of_genius", "sub_favored_by_the_gods", "sub_master_duelist"]);
});

await test("The route refuses a choice no row names, and asks again for one a row names that is not on offer.", async () => {
  const enemy = await stage(ATTRACTION);
  await kit.swing(hero.id, enemy.id, [12]);
  const [pending] = open();
  assert.ok(pending, "the hit waits on the wizard");
  assert.equal((await press(hero, pending.id, { use: "no_such_feature" })).status, 400);
  assert.equal((await press(hero, pending.id, { use: "restore_balance" })).status, 400, "no row names it now");
  assert.equal((await press(hero, pending.id, { use: "lucky" })).status, 409);
  world.dice(4);
  await press(hero, pending.id, { keep: true });
  await press(helper, pending.id, { decline: true, by: helper.id });
  world.clearDice();
});

// Restore Balance is used before the roll (the maintainer's ruling on issue
// #908): scripts/test-enforce-before-roll.mjs runs it at the hold and the
// watch stop. The card no longer offers it after the dice.
await test("Restore Balance is no row of the card: a disadvantaged save or attack waits for nothing.", async () => {
  assert.ok(!table.AFTER_ROLL_IDS.includes("restore_balance"));
  const enemy = await stage(BALANCE, [5, 3], { conditions: ["poisoned"] });
  world.dice(15, 4);
  await save(hero.id, 12);
  world.clearDice();
  assert.equal(open().length, 0, "the save lands as thrown");
  await kit.swing(hero.id, enemy.id, [15, 3]);
  assert.equal(open().length, 0, "the attack lands as thrown");
  assert.equal(used("sub_restore_balance"), 0);
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
