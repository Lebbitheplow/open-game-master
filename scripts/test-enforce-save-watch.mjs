// Flash of Genius and Favored by the Gods at the watch stop
// (src/lib/dm/foresight.ts, chronal-shift.ts takeSaveHelp). A save the server
// throws inside a call (a hazard at one character, an area, an enemy's hit
// with a poison rider) never waits on a card, so the GM spent these through
// use_resource and narrated a bonus no die carried. Now a watching player
// says "if it fails" at the stop, and the save takes the bonus:
//
//   Flash of Genius (Artificer 7): "when you or another creature you can see
//   within 30 feet of you makes an ability check or a saving throw, you can
//   use your reaction to add your Intelligence modifier to the roll."
//   Favored by the Gods (Divine Soul 1): "If you fail a saving throw or miss
//   with an attack roll, you can roll 2d4 and add it to the total."
//
// Dice forced; every check reads a sheet, a stop, a stored roll or the line
// the model was told.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-save-watch");
const world = await openWorld({ campaign: { maxPlayers: 12 }, gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { listOpenPendingRolls, publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { subscribe } = await import("../src/lib/events.ts");
const route = {
  watch: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"),
  toggle: await world.route("campaigns/[campaignId]/foresight"),
};

const allyUser = world.addUser("kara");
const artUser = world.addUser("ines");
const solUser = world.addUser("sol");
const ABILITIES = { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 };
// CON 14: the fighter's CON save is +2.
const ally = world.addHero({ user: allyUser, name: "Kara", class: "fighter", level: 5, maxHp: 44, proficiencies: TRAINED, abilities: ABILITIES, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
// Intelligence 16: Flash of Genius adds 3.
const artificer = world.addHero({ user: artUser, name: "Ines", class: "artificer", level: 7, maxHp: 40, abilities: { ...ABILITIES, int: 16 } });
const sorcerer = world.addHero({ user: solUser, name: "Sol", class: "sorcerer", subclass: "Divine Soul", level: 5, maxHp: 30, abilities: { ...ABILITIES, con: 10, cha: 16 } });
const FLASH = "art_flash_of_genius";
const FAVORED = "sub_favored_by_the_gods";
const reset = () => {
  world.patch(artificer.id, { currentHp: 40, conditions: [], conditionMeta: {}, watchingEncounterId: null, features: [{ name: "Flash of Genius", description: "" }], resources: { [FLASH]: { max: 3, used: 0 } } });
  world.patch(sorcerer.id, { currentHp: 30, conditions: [], conditionMeta: {}, watchingEncounterId: null, features: [{ name: "Favored by the Gods", description: "" }], resources: { [FAVORED]: { max: 1, used: 0 } } });
  world.patch(ally.id, { currentHp: 44, conditions: [], conditionMeta: {} });
  const encounter = world.encounter();
  if (encounter) saveEncounter({ ...encounter, reactionsUsed: [] });
};
const flashUsed = () => world.sheet(artificer.id).resources[FLASH].used;
const favoredUsed = () => world.sheet(sorcerer.id).resources[FAVORED].used;
// Their players are at the table: a watcher who has left is not stopped for.
let artHere = subscribe(world.campaignId, () => {}, artUser.id);
subscribe(world.campaignId, () => {}, solUser.id);

const open = () => listOpenPendingRolls(world.campaignId);
const stops = () => open().filter((pending) => pending.parkedFor === "watch");
const answer = (id, body, user = artUser) => {
  world.signIn(user);
  return call(route.watch, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
const toggle = (user, characterId, on = true) => {
  world.signIn(user);
  return call(route.toggle, "POST", { on, characterId }, { campaignId: world.campaignId });
};
let goblin;
let goblin2;
const enemyTurn = (calls, tail = "It is done.") => {
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.enemyId === goblin.id);
  saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [goblin.id], acted: null } });
  model.script([reply({ calls }), reply({ text: tail })]);
  world.say("system", "The goblins press in.");
  return startDmTurn(world.campaignId);
};
const toldLast = () => JSON.parse(model.requests.at(-1).messages.filter((message) => message.role === "tool").at(-1).content);
const lastSave = (characterId = ally.id) =>
  listRecentRolls(world.campaignId, 200)
    .filter((roll) => roll.kind === "saving_throw" && roll.characterId === characterId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
const needle = (characterId, dc = 10) => modelCall("cast_at_player", { characterId, source: "a poison needle", saveAbility: "con", dc, damage: "1d4", damageType: "poison" });

await test("An artificer and a divine soul can watch the fight; a fighter holding neither cannot.", async () => {
  await kit.fight(2, { heroFaces: { [ally.id]: 19, [artificer.id]: 15, [sorcerer.id]: 14 } });
  [goblin, goblin2] = world.enemies();
  reset();
  kit.place(ally.id, 5, 5);
  kit.place(artificer.id, 5, 3);
  kit.place(sorcerer.id, 8, 8);
  kit.place(goblin.id, 6, 5);
  kit.place(goblin2.id, 12, 12);
  assert.equal((await toggle(allyUser, ally.id)).status, 409, "a fighter holds none of them");
  assert.equal((await toggle(artUser, artificer.id)).status, 200);
  assert.ok(world.sheet(artificer.id).watchingEncounterId);
});

await test("An ally's save against a hazard stops for Flash of Genius; 'if it fails' adds the Intelligence modifier to the failed save, and the use and the reaction are paid.", async () => {
  await enemyTurn([needle(ally.id)], "The needle bites.");
  const [stop] = stops();
  assert.ok(stop, "the save stops for the artificer");
  const shown = publicPendingRoll(stop).watch;
  assert.equal(shown.power, "flash_of_genius");
  assert.deepEqual(shown.choices, [{ name: "Kara", when: "if it fails" }]);
  assert.equal((await answer(stop.id, { value: 3 })).status, 409, "a Flash of Genius stop takes no number");
  assert.equal((await answer(stop.id, { shift: true }, allyUser)).status, 403, "only the artificer's player");
  // 5 + 2 = 7 against DC 10: Intelligence +3 carries it.
  world.dice(5, 4);
  assert.equal((await answer(stop.id, { shift: true })).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave()?.total, 10, "the stored save carries the +3");
  assert.match(toldLast().savedWith ?? "", /Ines used Flash of Genius: Kara's save went from 7 to 10 against DC 10, and it succeeds/);
  assert.equal(flashUsed(), 1);
  assert.ok(world.encounter().reactionsUsed.includes(artificer.id), "the reaction is the artificer's, spent");
});

await test("A save the modifier cannot carry, or one that succeeds, spends nothing.", async () => {
  reset();
  world.patch(artificer.id, { watchingEncounterId: world.encounter().id });
  await enemyTurn([needle(ally.id, 20)]);
  world.dice(5, 4);
  await answer(stops()[0].id, { shift: true });
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave()?.total, 7, "7 + 3 never reaches DC 20");
  assert.equal(toldLast().savedWith, undefined);
  assert.equal(flashUsed(), 0);
  await enemyTurn([needle(ally.id)]);
  world.dice(15, 4);
  await answer(stops()[0].id, { shift: true });
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(flashUsed(), 0, "a success needs nothing");
  assert.ok(!world.encounter().reactionsUsed.includes(artificer.id));
});

await test("No stop for an ally out of sight or beyond 30 feet, with the reaction spent, or with the artificer's player away.", async () => {
  reset();
  world.patch(artificer.id, { watchingEncounterId: world.encounter().id });
  world.patch(ally.id, { conditions: ["invisible"] });
  await enemyTurn([needle(ally.id)]);
  await settleQueue(world.campaignId);
  assert.equal(stops().length, 0, "the artificer cannot see them");
  world.patch(ally.id, { conditions: [] });
  kit.place(artificer.id, 5, 12);
  await enemyTurn([needle(ally.id)]);
  await settleQueue(world.campaignId);
  assert.equal(stops().length, 0, "35 feet away");
  kit.place(artificer.id, 5, 3);
  artHere();
  try {
    await enemyTurn([needle(ally.id)]);
    await settleQueue(world.campaignId);
    assert.equal(stops().length, 0, "a watcher who has left the table is not stopped for");
  } finally {
    artHere = subscribe(world.campaignId, () => {}, artUser.id);
  }
  assert.equal(flashUsed(), 0);
});

await test("In an area the artificer answers only an ally's save: the goblin's is not on offer.", async () => {
  reset();
  world.patch(artificer.id, { watchingEncounterId: world.encounter().id });
  kit.setEnemy(goblin.id, { currentHp: 300, maxHp: 300 });
  await enemyTurn([modelCall("aoe_damage", { enemyIds: [goblin.id], characterIds: [ally.id], saveAbility: "con", dc: 12, damage: "1d4", damageType: "fire", halfOnSave: true })], "Embers fall.");
  const [stop] = stops();
  assert.ok(stop, "an area with an ally in it stops");
  assert.deepEqual(publicPendingRoll(stop).watch.choices, [{ name: "Kara", when: "if it fails" }]);
  await answer(stop.id, { pass: true });
  await settleQueue(world.campaignId);
  assert.equal(flashUsed(), 0, "Let it roll spends nothing");
});

await test("An enemy's hit with a poison rider stops for the save it may force, and Flash of Genius answers that save.", async () => {
  reset();
  world.patch(artificer.id, { watchingEncounterId: world.encounter().id });
  kit.setEnemy(goblin.id, { currentHp: 300, maxHp: 300, stats: { attacks: [{ name: "Venom Bite", toHit: 20, damage: "1", type: "piercing", reach: 5, mode: "melee", onHit: { save: "con", dc: 10, condition: "poisoned" } }] } });
  await enemyTurn([modelCall("enemy_attack", { enemyId: goblin.id, targetCharacterId: ally.id })], "The fangs sink in.");
  const [stop] = stops();
  assert.ok(stop, "the bite stops");
  assert.equal(publicPendingRoll(stop).watch.power, "flash_of_genius");
  // The bite hits (15 + 20), then the save: 5 + 2 = 7, and +3 makes 10.
  world.dice(15, 5);
  await answer(stop.id, { shift: true });
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave()?.total, 10);
  assert.ok(!world.sheet(ally.id).conditions.includes("poisoned"), "the save holds, so no poison");
  assert.equal(flashUsed(), 1);
});

await test("A divine soul's own failed save stops for Favored by the Gods: 2d4 is added, the use is paid, and no reaction is.", async () => {
  reset();
  // The artificer could answer Sol's save too, and is asked first: off here.
  assert.equal((await toggle(artUser, artificer.id, false)).status, 200);
  assert.equal((await toggle(solUser, sorcerer.id)).status, 200);
  await enemyTurn([needle(sorcerer.id)], "The needle bites.");
  const [stop] = stops();
  assert.ok(stop, "the sorcerer's own save stops");
  assert.equal(publicPendingRoll(stop).watch.power, "favored_by_the_gods");
  assert.deepEqual(publicPendingRoll(stop).watch.choices, [{ name: "Sol", when: "if it fails" }]);
  // A 2 fails DC 10 whatever Sol's CON; the 2d4 shows 4 and 4, 8 more.
  world.dice(2, 4, 4, 2);
  assert.equal((await answer(stop.id, { shift: true }, solUser)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  const [, before, after] = /Sol used Favored by the Gods: Sol's save went from (\d+) to (\d+) against DC 10/.exec(toldLast().savedWith ?? "") ?? [];
  assert.equal(Number(after) - Number(before), 8, toldLast().savedWith);
  assert.equal(lastSave(sorcerer.id)?.total, Number(after), "the stored save carries the 2d4");
  assert.equal(favoredUsed(), 1);
  assert.ok(!world.encounter().reactionsUsed.includes(sorcerer.id), "Favored by the Gods costs no reaction");
  // Spent: the next save does not stop for it.
  await enemyTurn([needle(sorcerer.id)]);
  await settleQueue(world.campaignId);
  assert.equal(stops().length, 0);
});

await test("A spent use is refused at the stop and costs nothing.", async () => {
  reset();
  assert.equal((await toggle(solUser, sorcerer.id, false)).status, 200);
  assert.equal((await toggle(artUser, artificer.id)).status, 200);
  await enemyTurn([needle(ally.id)]);
  const [stop] = stops();
  world.patch(artificer.id, { resources: { [FLASH]: { max: 3, used: 3 } } });
  const refused = await answer(stop.id, { shift: true });
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  await answer(stop.id, { pass: true });
  await settleQueue(world.campaignId);
  assert.equal(flashUsed(), 3);
});

// apply_hazard throws its saves through cast_at_player, and the stop never
// came for it (play-test 2026-11-09: a trap's save, with Favored by the Gods
// watching, went by with no stop).
await test("A trap the GM springs with apply_hazard stops for the save it throws; a fall, which throws none, does not.", async () => {
  reset();
  assert.equal((await toggle(artUser, artificer.id, false)).status, 200);
  assert.equal((await toggle(solUser, sorcerer.id)).status, 200);
  await enemyTurn([modelCall("apply_hazard", { type: "generic", characterIds: [sorcerer.id], saveAbility: "con", dc: 10, damage: "1d4", damageType: "poison", reason: "a poison needle trap" })], "The needle bites.");
  const [stop] = stops();
  assert.ok(stop, "the hazard's save stops");
  assert.match(stop.reason, /Sol is about to make a saving throw against a poison needle trap\./);
  assert.equal(publicPendingRoll(stop).watch.power, "favored_by_the_gods");
  assert.deepEqual(publicPendingRoll(stop).watch.choices, [{ name: "Sol", when: "if it fails" }]);
  world.dice(2, 4, 4, 2);
  assert.equal((await answer(stop.id, { shift: true }, solUser)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  const [, before, after] = /Sol used Favored by the Gods: Sol's save went from (\d+) to (\d+) against DC 10/.exec(toldLast().savedWith ?? "") ?? [];
  assert.equal(Number(after) - Number(before), 8, JSON.stringify(toldLast()));
  assert.equal(lastSave(sorcerer.id)?.total, Number(after), "the stored save carries the 2d4");
  assert.equal(favoredUsed(), 1);
  // A trap that catches two: Favored by the Gods answers only Sol's own save.
  reset();
  world.patch(sorcerer.id, { watchingEncounterId: world.encounter().id });
  await enemyTurn([modelCall("apply_hazard", { type: "trap", severity: "setback", characterIds: [ally.id, sorcerer.id] })], "Darts fly.");
  const [pair] = stops();
  assert.ok(pair, "a trap's saves stop");
  assert.match(pair.reason, /2 characters are about to make saving throws against a trap\./);
  assert.deepEqual(publicPendingRoll(pair).watch.choices, [{ name: "Sol", when: "if it fails" }]);
  await answer(pair.id, { pass: true }, solUser);
  await settleQueue(world.campaignId);
  assert.equal(favoredUsed(), 0, "Let it roll spends nothing");
  await enemyTurn([modelCall("apply_hazard", { type: "falling", feet: 20, characterIds: [sorcerer.id] })], "Sol falls.");
  await settleQueue(world.campaignId);
  assert.equal(stops().length, 0, "a fall throws no save");
});

// The hours of cold or heat roll their saves through endurance.ts, which
// neither stopped nor took what a stop armed.
await test("The cold's hourly saves stop too, and Favored by the Gods lands on the first hour's save that fails.", async () => {
  reset();
  world.patch(sorcerer.id, { watchingEncounterId: world.encounter().id });
  await enemyTurn([modelCall("apply_hazard", { type: "extreme_cold", hours: 1, characterIds: [sorcerer.id] })], "The wind cuts.");
  const [stop] = stops();
  assert.ok(stop, "the cold's save stops");
  assert.match(stop.reason, /Sol is about to make a saving throw against the cold\./);
  // 2 against DC 10; 2d4 of 8 carries it.
  world.dice(2, 4, 4);
  assert.equal((await answer(stop.id, { shift: true }, solUser)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave(sorcerer.id)?.total, 10, "the stored save carries the 2d4");
  assert.equal(favoredUsed(), 1);
  assert.ok(!world.sheet(sorcerer.id).conditions.some((name) => /exhaust/i.test(name)), "a save made costs no exhaustion");
});

// A hit on a concentrating character asks their concentration save inside
// enemy_attack, as a poison rider's save is: a card comes too late for it.
await test("An enemy's hit on a concentrating character stops for the concentration save.", async () => {
  reset();
  world.patch(sorcerer.id, { watchingEncounterId: world.encounter().id, concentratingOn: "Bless" });
  // A plain blow, with no rider of its own to stop for.
  kit.setEnemy(goblin.id, { stats: { attacks: [{ name: "Club", toHit: 20, damage: "5", type: "bludgeoning", reach: 5, mode: "melee" }] } });
  kit.place(sorcerer.id, 7, 5);
  await enemyTurn([modelCall("enemy_attack", { enemyId: goblin.id, targetCharacterId: sorcerer.id })], "The club lands.");
  const [stop] = stops();
  assert.ok(stop, "the hit's concentration save stops");
  assert.deepEqual(publicPendingRoll(stop).watch.choices, [{ name: "Sol", when: "if it fails" }]);
  // A hit of 5 (DC 10); the save of 2 fails, and 2d4 of 8 carries it.
  world.dice(18, 2, 4, 4);
  assert.equal((await answer(stop.id, { shift: true }, solUser)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(favoredUsed(), 1, JSON.stringify(toldLast()));
  assert.equal(world.sheet(sorcerer.id).concentratingOn, "Bless", `the 2d4 kept the concentration: ${JSON.stringify(toldLast())}`);
  world.patch(sorcerer.id, { concentratingOn: null });
  kit.place(sorcerer.id, 8, 8);
});

// Flash of Genius answers an ability check as well as a save, and a check a
// call throws (a group's check here) has no card of its own.
await test("An ally's check a call throws stops for Flash of Genius, which adds to it when it fails.", async () => {
  reset();
  assert.equal((await toggle(solUser, sorcerer.id, false)).status, 200);
  assert.equal((await toggle(artUser, artificer.id)).status, 200);
  await enemyTurn([modelCall("group_check", { characterIds: [ally.id], skill: "athletics", dc: 15, reason: "the wall" })], "Kara climbs.");
  const [stop] = stops();
  assert.ok(stop, "the check stops");
  assert.equal(publicPendingRoll(stop).watch.power, "flash_of_genius");
  // 9 + 3 (Strength) = 12 against DC 15: Intelligence +3 carries it.
  world.dice(9);
  assert.equal((await answer(stop.id, { shift: true })).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(flashUsed(), 1);
  assert.match(toldLast().savedWith ?? JSON.stringify(toldLast()), /Ines used Flash of Genius: Kara's check went from 12 to 15 against DC 15/);
});

// Bend Luck (Wild Magic 6) and Convergent Future (Chronurgy 14) answer another
// creature's roll "after the creature rolls but before any effects of the roll
// occur": a save a call throws has no card, so the stop asks before it
// (src/lib/dm/fate-turn.ts takeFate).
await test("A wild mage watches with Bend Luck: an ally's failed save takes 1d4 for 2 sorcery points and the reaction, and a chronurgist's Convergent Future makes it succeed for a level of exhaustion.", async () => {
  reset();
  assert.equal((await toggle(artUser, artificer.id, false)).status, 200);
  world.patch(sorcerer.id, { features: [{ name: "Bend Luck", description: "" }], resources: { sorcery_points: { max: 6, used: 0 } } });
  kit.place(sorcerer.id, 5, 4);
  assert.equal((await toggle(solUser, sorcerer.id)).status, 200);
  await enemyTurn([needle(ally.id)]);
  let [stop] = stops();
  assert.ok(stop, "the save stops for the sorcerer");
  assert.equal(publicPendingRoll(stop).watch.power, "bend_luck");
  assert.deepEqual(publicPendingRoll(stop).watch.choices, [{ name: "Kara", when: "if it fails" }]);
  // 5 + 2 = 7 against DC 10, and a d4 of 3 makes it 10.
  world.dice(5, 3, 4);
  assert.equal((await answer(stop.id, { shift: true }, solUser)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave()?.total, 10, "the stored save carries the d4");
  assert.match(toldLast().savedWith ?? JSON.stringify(toldLast()), /Sol used Bend Luck: Kara's save went from 7 to 10 against 10, and it succeeds/);
  assert.equal(world.sheet(sorcerer.id).resources.sorcery_points.used, 2);
  assert.ok(world.encounter().reactionsUsed.includes(sorcerer.id), "the reaction");
  // The same seat as a chronurgist with no Chronal Shift left.
  reset();
  world.patch(sorcerer.id, { features: [{ name: "Convergent Future", description: "" }], resources: {}, exhaustion: 0, watchingEncounterId: world.encounter().id });
  await enemyTurn([needle(ally.id, 30)]);
  [stop] = stops();
  assert.equal(publicPendingRoll(stop)?.watch.power, "convergent_future");
  world.dice(5, 4);
  assert.equal((await answer(stop.id, { shift: true }, solUser)).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(lastSave()?.total, 30, "the lowest number that succeeds");
  assert.equal(world.sheet(sorcerer.id).exhaustion, 1);
  assert.equal(toldLast().damage, 0, "a save made to succeed takes no poison");
});

model.close();
finish();
world.close();
