// Saving Face, Lucky Footwork and Bountiful Luck at the watch stop
// (src/lib/dm/lineage-watch.ts, foresight.ts). They were offered only on the
// card a player's own roll waits on, so a save the server throws inside a
// call that no card waits on passed them by. Now a watching player says "if
// it fails" at the stop, and the roll site takes it as it lands:
//
//   Bountiful Luck (a halfling's feat): an ally in sight within 30 feet rolls
//   a 1 on the d20, and the halfling's reaction lets them roll it again.
//   Saving Face (hobgoblin): a failed save gains +1 for each ally the
//   hobgoblin sees within 30 feet, once a short rest.
//   Lucky Footwork (rabbitfolk): a failed Dexterity save gains 1d4 for the
//   reaction.
//
// Dice forced; every check reads a sheet, a stop or a stored roll.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-lineage-watch");
const world = await openWorld({ campaign: { maxPlayers: 12 }, gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { listOpenPendingRolls, publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { BOUNTIFUL_LUCK_LENT } = await import("../src/lib/srd/feature-effects.ts");
const { setSheetWatching } = await import("../src/lib/db/sheets.ts");
const route = {
  watch: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"),
  toggle: await world.route("campaigns/[campaignId]/foresight"),
};

const users = { kara: world.addUser("kara"), pip: world.addUser("pip"), hob: world.addUser("hob"), bun: world.addUser("bun") };
// Every save here is +2 or +0: CON 14 and DEX 10, no save proficiency (wizards).
const ABILITIES = { str: 10, dex: 10, con: 14, int: 14, wis: 10, cha: 10 };
const hero = (user, name, race, extra = {}) => world.addHero({ user, name, class: "wizard", race, level: 5, maxHp: 40, proficiencies: TRAINED, abilities: ABILITIES, ...extra });
const kara = hero(users.kara, "Kara", "human");
const pip = hero(users.pip, "Pip", "halfling");
const hob = hero(users.hob, "Hob", "hobgoblin");
const bun = hero(users.bun, "Bun", "rabbitfolk");
const reset = () => {
  world.patch(pip.id, { currentHp: 40, conditions: [], conditionMeta: {}, feats: ["Bountiful Luck"] });
  world.patch(hob.id, { currentHp: 40, conditions: [], conditionMeta: {}, features: [{ name: "Saving Face", source: "race" }], resources: { race_saving_face: { max: 1, used: 0 } } });
  world.patch(bun.id, { currentHp: 40, conditions: [], conditionMeta: {}, features: [{ name: "Lucky Footwork", source: "race" }] });
  world.patch(kara.id, { currentHp: 40, conditions: [], conditionMeta: {} });
  // One watcher at a time: a sheet patch leaves the watch as it was.
  for (const sheet of [pip, hob, bun]) setSheetWatching(sheet.id, null);
  const encounter = world.encounter();
  if (encounter) saveEncounter({ ...encounter, reactionsUsed: [] });
};
for (const user of Object.values(users)) subscribe(world.campaignId, () => {}, user.id);

const stops = () => listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "watch");
const answer = (id, user) => {
  world.signIn(user);
  return call(route.watch, "POST", { shift: true }, { campaignId: world.campaignId, pendingRollId: id });
};
const watch = (user, characterId) => {
  world.signIn(user);
  return call(route.toggle, "POST", { on: true, characterId }, { campaignId: world.campaignId });
};
let goblin;
const enemyTurn = (calls, tail = "It is done.") => {
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.enemyId === goblin.id);
  saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [goblin.id], acted: null } });
  model.script([reply({ calls }), reply({ text: tail })]);
  world.say("system", "The goblins press in.");
  return startDmTurn(world.campaignId);
};
const lastSave = (characterId) =>
  listRecentRolls(world.campaignId, 200)
    .filter((roll) => roll.kind === "saving_throw" && roll.characterId === characterId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
const needle = (characterId, saveAbility = "con", dc = 10) => modelCall("cast_at_player", { characterId, source: "a poison needle", saveAbility, dc, damage: "1d4", damageType: "poison" });
const reacted = (sheet) => world.encounter().reactionsUsed.includes(sheet.id);

await test("A halfling with Bountiful Luck, a hobgoblin and a rabbitfolk can watch the fight.", async () => {
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [pip.id]: 15, [hob.id]: 14, [bun.id]: 13 } });
  [goblin] = world.enemies();
  reset();
  kit.place(kara.id, 5, 5);
  kit.place(pip.id, 5, 3);
  kit.place(hob.id, 4, 4);
  kit.place(bun.id, 18, 12);
  kit.place(goblin.id, 6, 5);
  for (const [user, sheet] of [[users.pip, pip], [users.hob, hob], [users.bun, bun]]) {
    assert.equal((await watch(user, sheet.id)).status, 200, `${sheet.name} has something the watch stop answers with`);
  }
  reset();
});

await test("An ally's save on a 1 stops for Bountiful Luck: 'if it fails' rolls the 1 again, the new roll stands, and the halfling's reaction is spent with their Lucky set aside.", async () => {
  setSheetWatching(pip.id, world.encounter().id);
  await enemyTurn([needle(kara.id)], "The needle bites.");
  const [stop] = stops();
  assert.ok(stop, "Kara's save stops for Pip");
  const shown = publicPendingRoll(stop).watch;
  assert.equal(shown.power, "bountiful_luck");
  assert.deepEqual(shown.choices, [{ name: "Kara", when: "if it fails" }]);
  // A 1 (+2: 3) against DC 10, rolled again as a 15: 17.
  world.dice(1, 15, 4);
  assert.equal((await answer(stop.id, users.pip)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave(kara.id)?.total, 17, "the stored save is the new roll");
  assert.ok(reacted(pip), "the reaction is Pip's, spent");
  assert.ok(world.sheet(pip.id).conditions.includes(BOUNTIFUL_LUCK_LENT), "Pip's own Lucky waits out their next turn");
});

await test("A save that fails on another face, or one that succeeds, spends nothing of Bountiful Luck.", async () => {
  reset();
  setSheetWatching(pip.id, world.encounter().id);
  await enemyTurn([needle(kara.id)]);
  world.dice(5, 4);
  await answer(stops()[0].id, users.pip);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave(kara.id)?.total, 7, "a 5 is not a 1");
  assert.equal(reacted(pip), false);
});

await test("A hobgoblin's own failed save stops for Saving Face: +1 for each of the two allies in sight within 30 feet, and the use is paid.", async () => {
  reset();
  setSheetWatching(hob.id, world.encounter().id);
  await enemyTurn([needle(hob.id, "con", 11)], "The needle bites.");
  const [stop] = stops();
  assert.ok(stop, "Hob's own save stops for Saving Face");
  assert.equal(publicPendingRoll(stop).watch.power, "saving_face");
  // 7 + 2 = 9 against DC 11: Kara and Pip in sight, +2.
  world.dice(7, 4);
  assert.equal((await answer(stop.id, users.hob)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave(hob.id)?.total, 11, "the stored save carries the +2");
  assert.equal(world.sheet(hob.id).resources.race_saving_face.used, 1);
});

await test("A rabbitfolk's own failed Dexterity save stops for Lucky Footwork: 1d4 is added for the reaction; a Constitution save is not answered.", async () => {
  reset();
  setSheetWatching(bun.id, world.encounter().id);
  kit.place(bun.id, 7, 7);
  await enemyTurn([needle(bun.id, "dex")], "The needle bites.");
  const [stop] = stops();
  assert.ok(stop, "Bun's own save stops for Lucky Footwork");
  assert.equal(publicPendingRoll(stop).watch.power, "lucky_footwork");
  // 7 + 0 against DC 10, and a d4 of 3.
  world.dice(7, 3, 4);
  assert.equal((await answer(stop.id, users.bun)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave(bun.id)?.total, 10, "the stored save carries the d4");
  assert.ok(reacted(bun), "the reaction is spent");
  reset();
  setSheetWatching(bun.id, world.encounter().id);
  await enemyTurn([needle(bun.id, "con")]);
  const con = stops()[0];
  if (con) {
    world.dice(5, 3, 4);
    await answer(con.id, users.bun);
    await settleQueue(world.campaignId);
    world.clearDice();
  }
  assert.equal(lastSave(bun.id)?.total, 7, "a Constitution save takes no d4");
  assert.equal(reacted(bun), false);
});

await finish();
