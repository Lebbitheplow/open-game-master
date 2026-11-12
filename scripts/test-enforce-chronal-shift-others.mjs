// Chronal Shift on another creature's roll. "After you or a creature you can
// see within 30 feet of you makes an attack roll, an ability check, or a
// saving throw, you can use your reaction to force that creature to reroll.
// You make this decision after you see whether the roll succeeds or fails.
// The target must use the result of the second roll." The wizard's own roll
// and a hit on an ally had their answers (test-enforce-chronal-shift.mjs);
// anyone else's check or save was the model's to narrate after use_resource.
// Now a player ally's failing roll waits on the wizard's own screen, and a
// roll the server makes inside a call is answered at the watch stop before it.
//
// Dice forced; every check reads a sheet, a card, a stored roll or a refusal.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-enforce-chronal-shift-others");
const world = await openWorld({ campaign: { maxPlayers: 12 }, gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { getPendingRoll, listOpenPendingRolls, publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { getRoll, listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { armShift, disarmShift } = await import("../src/lib/dm/chronal-shift.ts");
const { rollEnemySave } = await import("../src/lib/dm/forced-save.ts");
const route = {
  choice: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll"),
  watch: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"),
  toggle: await world.route("campaigns/[campaignId]/foresight"),
};

const allyUser = world.addUser("kara");
const wizUser = world.addUser("tova");
const ally = world.addHero({
  user: allyUser, name: "Kara", class: "fighter", level: 5, maxHp: 44, proficiencies: TRAINED,
  abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 10 }, equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
const wizard = world.addHero({
  user: wizUser, name: "Tova", class: "wizard", subclass: "Chronurgy Magic", level: 5, maxHp: 30,
  abilities: { str: 10, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
});
// The wizard's player is at the table: a roll does not wait on an absent
// one (chronal-shift.ts playerAtTable).
const { subscribe } = await import("../src/lib/events.ts");
let wizardHere = subscribe(world.campaignId, () => {}, wizUser.id);
const COUNTER = "sub_chronal_shift";
const used = () => world.sheet(wizard.id).resources[COUNTER].used;
const open = () => listOpenPendingRolls(world.campaignId);
const reset = (patch = {}) => {
  const resources = world.sheet(wizard.id).resources;
  world.patch(wizard.id, { currentHp: 30, conditions: [], conditionMeta: {}, watchingEncounterId: null, resources: { ...resources, [COUNTER]: { ...resources[COUNTER], used: 0 } }, ...patch });
  world.patch(ally.id, { currentHp: 44, conditions: [], conditionMeta: {}, feats: [] });
};
const choose = (id, body, user) => {
  world.signIn(user);
  return call(route.choice, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
const check = async (args = {}) => (await world.invoke("request_roll", { characterId: ally.id, kind: "ability_check", ability: "str", dc: 15, reason: "the gate", ...args })).result ?? {};

await test("An ally's failing check waits on the wizard, who makes them roll it again on their own screen; the new roll stands and the use is spent.", async () => {
  await kit.endFight();
  reset();
  world.dice(3);
  const out = await check();
  world.clearDice();
  assert.equal(out.parked, true, JSON.stringify(out));
  const [pending] = open();
  assert.deepEqual(pending.thrown.options.map((option) => [option.id, option.by]), [["chronal_shift", wizard.id]]);
  assert.match(pending.thrown.options[0].label, /make Kara roll again/);
  const stolen = await choose(pending.id, { use: "chronal_shift", by: wizard.id }, allyUser);
  assert.equal(stolen.status, 403, "only the wizard's player spends it");
  assert.equal((await choose(pending.id, { use: "chronal_shift" }, allyUser)).status, 409, "not the roller's own to spend");
  world.dice(18);
  const shifted = await choose(pending.id, { use: "chronal_shift", by: wizard.id }, wizUser);
  world.clearDice();
  assert.equal(shifted.status, 200, JSON.stringify(shifted.json));
  assert.equal(open().length, 0, "the new roll succeeds: nothing left to decide");
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, 21, "18 + 3: the second roll stands");
  assert.match(getPendingRoll(pending.id).combatNote, /Tova used Chronal Shift: Kara rolled again \(6 became 21\)/);
  assert.equal(used(), 1);
});

await test("The roll waits on the wizard after its roller keeps it; letting it stand lands it, and nothing is spent.", async () => {
  reset();
  world.dice(3);
  await check();
  world.clearDice();
  const [pending] = open();
  const kept = await choose(pending.id, { keep: true }, allyUser);
  assert.equal(kept.status, 200);
  const waiting = getPendingRoll(pending.id);
  assert.equal(waiting.status, "pending", "the wizard still decides");
  assert.equal(waiting.thrown.kept, true);
  assert.ok(waiting.thrown.options.every((option) => option.by === wizard.id));
  assert.equal((await choose(pending.id, { decline: true, by: wizard.id }, allyUser)).status, 403, "the roller cannot decline for the wizard");
  const left = await choose(pending.id, { decline: true, by: wizard.id }, wizUser);
  assert.equal(left.status, 200, JSON.stringify(left.json));
  assert.equal(open().length, 0);
  assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, 6);
  assert.equal(used(), 0);
});

await test("No wait on a success, on a roll with no DC, with both uses spent, or a reaction already taken.", async () => {
  reset();
  world.dice(19);
  assert.notEqual((await check()).parked, true, "a success");
  world.dice(3);
  assert.notEqual((await check({ dc: undefined })).parked, true, "no DC: the wizard cannot see whether it failed");
  reset();
  const resources = world.sheet(wizard.id).resources;
  world.patch(wizard.id, { resources: { ...resources, [COUNTER]: { ...resources[COUNTER], used: 2 } } });
  world.dice(3);
  assert.notEqual((await check()).parked, true, "no use left");
  world.clearDice();
  assert.equal(open().length, 0);
});

await test("A wizard whose player has left the table is not waited on: the ally's failure stands at once, and nothing is spent.", async () => {
  reset();
  wizardHere();
  try {
    world.dice(3);
    const out = await check();
    world.clearDice();
    assert.notEqual(out.parked, true, JSON.stringify(out));
    assert.equal(open().length, 0, "no wait on an absent player, with no clock to end it");
    assert.equal(used(), 0);
  } finally {
    wizardHere = subscribe(world.campaignId, () => {}, wizUser.id);
  }
});

await test("In a fight the 30 feet and the reaction count: a wizard too far, or whose reaction is spent, gets no offer.", async () => {
  reset();
  await kit.fight(1, { heroFaces: { [ally.id]: 19, [wizard.id]: 2 } });
  const [enemy] = world.enemies();
  kit.place(ally.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.place(wizard.id, 5, 12);
  world.dice(3);
  assert.notEqual((await check()).parked, true, "35 feet away");
  kit.place(wizard.id, 5, 11);
  world.dice(3);
  const near = await check();
  world.clearDice();
  assert.equal(near.parked, true, "30 feet reaches");
  await choose(open()[0].id, { decline: true, by: wizard.id }, wizUser);
  saveEncounter({ ...world.encounter(), reactionsUsed: [wizard.id] });
  world.dice(3);
  assert.notEqual((await check()).parked, true, "the reaction is spent");
  world.clearDice();
  saveEncounter({ ...world.encounter(), reactionsUsed: [] });
});

await test("An ally's missed attack waits on the wizard; the reroll that hits deals the blow and takes the wizard's reaction.", async () => {
  reset();
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [ally.id]: 19, [wizard.id]: 2 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400, currentHp: 400, ac: 15 });
  kit.place(ally.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.place(wizard.id, 5, 3);
  assert.equal(kit.current().characterId, ally.id);
  const swing = await kit.swing(ally.id, enemy.id, [5]);
  assert.equal(swing.ok, true, swing.error);
  const [pending] = open();
  assert.ok(pending, "the miss waits");
  assert.equal(pending.kind, "attack");
  assert.deepEqual(pending.thrown.options.map((option) => option.by), [wizard.id]);
  world.dice(14, 5);
  const shifted = await choose(pending.id, { use: "chronal_shift", by: wizard.id }, wizUser);
  world.clearDice();
  assert.equal(shifted.status, 200, JSON.stringify(shifted.json));
  assert.equal(kit.enemy(enemy.id).currentHp, 400 - 8, "14 + 6 hits AC 15: 5 + 3 slashing");
  // The model reads who changed the roll beside the attack's own note: the
  // hit's note used to replace it (pending-roll-land.ts).
  assert.match(getPendingRoll(pending.id).combatNote ?? "", /Tova used Chronal Shift: Kara rolled again \(11 became 20\)/);
  assert.match(getPendingRoll(pending.id).combatNote ?? "", /HIT/);
  assert.equal(used(), 1);
  assert.ok(world.encounter().reactionsUsed.includes(wizard.id), "the reaction is the wizard's, spent");
});

// ---- the watch stop, for a roll the server makes inside a call ----

const stops = () => open().filter((pending) => pending.parkedFor === "watch");
const answer = (id, body, user = wizUser) => {
  world.signIn(user);
  return call(route.watch, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
const toggle = (on) => {
  world.signIn(wizUser);
  return call(route.toggle, "POST", { on, characterId: wizard.id }, { campaignId: world.campaignId });
};
let goblin;
let goblin2;
const turnOf = (enemy) => {
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.enemyId === enemy.id);
  saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [enemy.id], acted: null } });
};
const enemyTurn = (calls, tail = "It is done.") => {
  turnOf(goblin);
  model.script([reply({ calls }), reply({ text: tail })]);
  world.say("system", "The goblins press in.");
  return startDmTurn(world.campaignId);
};
const toldLast = () => JSON.parse(model.requests.at(-1).messages.filter((message) => message.role === "tool").at(-1).content);

await test("A Chronurgy wizard with no Portent can watch the fight; one with neither cannot.", async () => {
  reset();
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [ally.id]: 19, [wizard.id]: 15 } });
  [goblin, goblin2] = world.enemies();
  kit.place(ally.id, 5, 5);
  kit.place(goblin.id, 6, 5);
  kit.place(goblin2.id, 5, 6);
  kit.place(wizard.id, 5, 3);
  const refused = await (async () => {
    world.signIn(allyUser);
    return call(route.toggle, "POST", { on: true, characterId: ally.id }, { campaignId: world.campaignId });
  })();
  assert.equal(refused.status, 409, "a fighter holds neither");
  assert.equal((await toggle(true)).status, 200);
  assert.ok(world.sheet(wizard.id).watchingEncounterId);
});

await test("An ally's save against a hazard stops; 'if it fails' rolls the failure again, the second roll stands, and the use and reaction are paid.", async () => {
  await enemyTurn([modelCall("cast_at_player", { characterId: ally.id, source: "a poison needle", saveAbility: "con", dc: 12, damage: "1d4", damageType: "poison" })], "The needle bites.");
  const [stop] = stops();
  assert.ok(stop, "the save stops for the watcher");
  const shown = publicPendingRoll(stop).watch;
  assert.equal(shown.power, "chronal_shift");
  assert.deepEqual(shown.choices, [{ name: "Kara", when: "if it fails" }]);
  assert.equal((await answer(stop.id, { value: 3 })).status, 409, "a Chronal Shift stop takes no number");
  world.dice(2, 18, 4);
  assert.equal((await answer(stop.id, { shift: true })).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  const saves = listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "saving_throw");
  assert.equal(saves.at(-1)?.breakdown.natural, 18, "the stored save is the second roll");
  assert.match(toldLast().chronalShift ?? "", /Tova used Chronal Shift: Kara rolled the save again, 20 against DC 12/);
  assert.equal(used(), 1);
  assert.ok(world.encounter().reactionsUsed.includes(wizard.id));
});

await test("A roll that goes the wizard's way is not rolled again, and nothing is spent.", async () => {
  reset({ watchingEncounterId: world.encounter().id });
  await enemyTurn([modelCall("cast_at_player", { characterId: ally.id, source: "a poison needle", saveAbility: "con", dc: 12, damage: "1d4", damageType: "poison" })]);
  const [stop] = stops();
  world.dice(18);
  await answer(stop.id, { shift: true });
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(toldLast().chronalShift, undefined);
  assert.equal(used(), 0);
});

await test("An enemy's attack never stops for Chronal Shift: the reaction card answers a hit.", async () => {
  reset({ watchingEncounterId: world.encounter().id });
  world.dice(10, 4);
  await enemyTurn([modelCall("enemy_attack", { enemyId: goblin.id, targetCharacterId: ally.id })]);
  world.clearDice();
  await settleQueue(world.campaignId);
  assert.equal(stops().length, 0);
});

await test("In an area the wizard picks whose save: 'if it succeeds' for a foe, and only that creature's roll is answered.", async () => {
  reset({ watchingEncounterId: world.encounter().id });
  kit.setEnemy(goblin.id, { currentHp: 300, maxHp: 300 });
  kit.setEnemy(goblin2.id, { currentHp: 300, maxHp: 300 });
  await enemyTurn([modelCall("aoe_damage", { enemyIds: [goblin.id, goblin2.id], saveAbility: "dex", dc: 1, damage: "1d4", damageType: "fire", halfOnSave: true })], "Embers fall.");
  const [stop] = stops();
  assert.ok(stop, "an area stops");
  assert.deepEqual(publicPendingRoll(stop).watch.choices, [{ name: goblin.displayName, when: "if it succeeds" }, { name: goblin2.displayName, when: "if it succeeds" }]);
  assert.equal((await answer(stop.id, { shift: true })).status, 400, "whose roll is asked first");
  assert.equal((await answer(stop.id, { shift: true, choice: 1 })).status, 200);
  await settleQueue(world.campaignId);
  // DC 1: every save succeeds, so the chosen goblin's is rolled again.
  assert.match(toldLast().chronalShift ?? "", new RegExp(`${goblin2.displayName} rolled the save again`));
  assert.equal(used(), 1);
});

// The save a monk's hit asks of the creature hit is thrown inside pc_attack
// (pc-attack-riders.ts): the wizard may answer it there, as a foe's save.
await test("A swing with Stunning Strike offers the creature's save against the stun.", async () => {
  reset({ watchingEncounterId: world.encounter().id });
  await enemyTurn([modelCall("pc_attack", { characterId: ally.id, attacks: [{ targetEnemyId: goblin.id, stunningStrike: true }] })], "Kara strikes.");
  const [stop] = stops();
  assert.ok(stop, "the swing stops");
  assert.ok(publicPendingRoll(stop).watch.choices.some((choice) => choice.name === goblin.displayName && choice.when === "if it succeeds"), JSON.stringify(publicPendingRoll(stop).watch.choices));
  await answer(stop.id, { pass: true });
  await settleQueue(world.campaignId);
  assert.equal(used(), 0);
});

// A contest's sides have no DC of their own: whether one went the wizard's
// way is known once both have landed (contest-roll.ts contestShift).
await test("A grapple's contest: the creature's side that won is rolled again, and the new roll stands.", async () => {
  reset({ watchingEncounterId: world.encounter().id });
  kit.setEnemy(goblin.id, { conditions: [], conditionMeta: {} });
  const order = world.encounter();
  saveEncounter({ ...order, turnIndex: order.order.findIndex((entry) => entry.characterId === ally.id), turnBudget: null, reactionsUsed: [] });
  model.script([reply({ calls: [modelCall("take_action", { characterId: ally.id, action: "grapple", targetEnemyId: goblin.id })] }), reply({ text: "Kara grabs." })]);
  await model.turn(world, "I grab the goblin.", ally.id, allyUser.id);
  const [stop] = stops();
  assert.ok(stop, "the contest stops");
  const choices = publicPendingRoll(stop).watch.choices;
  const at = choices.findIndex((choice) => choice.name === goblin.displayName);
  assert.equal(choices[at]?.when, "if it succeeds", JSON.stringify(choices));
  // Kara 2, the goblin 18 and wins; rolled again, 1.
  world.dice(2, 18, 1);
  assert.equal((await answer(stop.id, { shift: true, choice: at })).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.match(toldLast().chronalShift ?? JSON.stringify(toldLast()), /rolled its side of the contest again, \d+ became \d+/);
  assert.equal(used(), 1);
  kit.setEnemy(goblin.id, { conditions: [], conditionMeta: {} });
  world.patch(ally.id, { conditions: [], conditionMeta: {} });
});

// A death save the pointer move rolls (turn-hold.ts) takes what its stop
// armed: a death save is a saving throw.
await test("A death save takes an armed Chronal Shift: an ally's failure is rolled again, and the new roll stands.", async () => {
  reset();
  saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  world.patch(ally.id, { currentHp: 0, conditions: ["unconscious"], conditionMeta: {}, deathSaves: { successes: 0, failures: 0 } });
  armShift(world.campaignId, { wizardId: wizard.id, rolls: [{ tag: { roller: "hero", kind: "death_save", who: ally.name }, reverse: "failure" }] });
  world.dice(4, 15);
  const { rollDeathSave } = await import("../src/lib/dm/death.ts");
  rollDeathSave(world.campaign(), ally.id);
  world.clearDice();
  const line = disarmShift(world.campaignId);
  assert.match(line ?? "", /rolled the death save again, 15/);
  assert.equal(world.sheet(ally.id).deathSaves?.successes, 1, "the 15 stands: a success");
  assert.equal(used(), 1);
  world.patch(ally.id, { currentHp: 44, conditions: [], conditionMeta: {}, deathSaves: null });
});

await test("At the save itself: a foe's success is rolled again and the second roll stands; a failure is left alone.", () => {
  reset();
  saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  const tag = { roller: "enemy", kind: "save", who: goblin.displayName };
  armShift(world.campaignId, { wizardId: wizard.id, rolls: [{ tag, reverse: "success" }] });
  world.dice(18, 2);
  const save = rollEnemySave(world.campaignId, kit.enemy(goblin.id), "dex", 10, {});
  world.clearDice();
  const line = disarmShift(world.campaignId);
  assert.equal(save.success, false, JSON.stringify(save));
  assert.match(line ?? "", /rolled the save again/);
  assert.ok(save.notes.some((note) => /Chronal Shift: rolled again/.test(note)));
  assert.equal(used(), 1);
  reset();
  saveEncounter({ ...world.encounter(), reactionsUsed: [] });
  armShift(world.campaignId, { wizardId: wizard.id, rolls: [{ tag, reverse: "success" }] });
  world.dice(2);
  const failed = rollEnemySave(world.campaignId, kit.enemy(goblin.id), "dex", 10, {});
  world.clearDice();
  assert.equal(disarmShift(world.campaignId), null);
  assert.equal(failed.success, false);
  assert.equal(used(), 0, "a failure is what the wizard wanted: nothing spent");
});

// ---- one account playing the roller and the wizard (play-test 2026-11-09) ----

const { setMemberActiveCharacter, updateGameSettings } = await import("../src/lib/db/campaigns.ts");
const twin = world.addHero({
  user: allyUser, name: "Ines", class: "wizard", subclass: "Chronurgy Magic", level: 5, maxHp: 30,
  abilities: { str: 10, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
});
const twinUsed = () => world.sheet(twin.id).resources[COUNTER].used;

await test("A wizard the roller's own account plays is answered by the roller's keep: the roll lands at once, nothing spent, though nobody else is online to start a clock.", async () => {
  await kit.endFight();
  reset();
  wizardHere();
  const rollerHere = subscribe(world.campaignId, () => {}, allyUser.id);
  try {
    world.dice(3);
    assert.equal((await check()).parked, true);
    world.clearDice();
    const [pending] = open();
    assert.deepEqual(pending.thrown.options.map((option) => option.by), [twin.id], "the twin's shift, on the roller's own card");
    assert.equal(pending.thrown.deadline, undefined, "nobody else online: no clock");
    const kept = await choose(pending.id, { keep: true }, allyUser);
    assert.equal(kept.status, 200, JSON.stringify(kept.json));
    assert.equal(open().length, 0, "the keep was the twin's answer too: nothing waits on a card with nothing left to press");
    assert.equal(getRoll(getPendingRoll(pending.id).rollId).total, 6);
    assert.equal(twinUsed(), 0);
  } finally {
    rollerHere();
    wizardHere = subscribe(world.campaignId, () => {}, wizUser.id);
  }
});

await test("With another player's wizard beside the twin, the keep answers for the twin and the roll waits on the other wizard alone.", async () => {
  reset();
  const rollerHere = subscribe(world.campaignId, () => {}, allyUser.id);
  try {
    world.dice(3);
    await check();
    world.clearDice();
    const [pending] = open();
    assert.deepEqual(pending.thrown.options.map((option) => option.by).sort(), [twin.id, wizard.id].sort());
    assert.equal((await choose(pending.id, { keep: true }, allyUser)).status, 200);
    const waiting = getPendingRoll(pending.id);
    assert.equal(waiting.status, "pending");
    assert.deepEqual(waiting.thrown.options.map((option) => option.by), [wizard.id], "only the other player's wizard is still asked");
    assert.deepEqual(waiting.thrown.declined, [twin.id]);
    assert.ok(waiting.thrown.deadline, "someone else is online: the clock runs");
    assert.equal((await choose(pending.id, { decline: true, by: wizard.id }, wizUser)).status, 200);
    assert.equal(open().length, 0);
    assert.equal(twinUsed() + used(), 0);
  } finally {
    rollerHere();
  }
});

await test("At a table that fields one character per player, a wizard waiting on the bench answers nobody's roll and watches no fight.", async () => {
  reset();
  wizardHere();
  const rollerHere = subscribe(world.campaignId, () => {}, allyUser.id);
  updateGameSettings(world.campaignId, { multiCharacter: "one_active" });
  setMemberActiveCharacter(world.campaignId, allyUser.id, ally.id);
  try {
    world.dice(3);
    const out = await check();
    world.clearDice();
    assert.notEqual(out.parked, true, `the benched twin is not offered: ${JSON.stringify(open().map((pending) => pending.thrown?.options))}`);
    assert.equal(open().length, 0);
    // In a fight: the twin set to watch while every character was fielded,
    // then benched, stops a hazard's save on the fighter for nobody; fielded
    // again, the same save stops for the twin.
    updateGameSettings(world.campaignId, { multiCharacter: "all_active" });
    await kit.fight(1, { heroFaces: { [ally.id]: 19, [twin.id]: 15, [wizard.id]: 2 } });
    [goblin] = world.enemies();
    kit.place(ally.id, 5, 5);
    kit.place(goblin.id, 6, 5);
    kit.place(twin.id, 5, 3);
    world.signIn(allyUser);
    assert.equal((await call(route.toggle, "POST", { on: true, characterId: twin.id }, { campaignId: world.campaignId })).status, 200);
    updateGameSettings(world.campaignId, { multiCharacter: "one_active" });
    const needle = [modelCall("cast_at_player", { characterId: ally.id, source: "a poison needle", saveAbility: "con", dc: 12, damage: "1d4", damageType: "poison" })];
    await enemyTurn(needle);
    await settleQueue(world.campaignId);
    assert.equal(stops().length, 0, "the benched twin's watch stops nothing");
    updateGameSettings(world.campaignId, { multiCharacter: "all_active" });
    await enemyTurn(needle);
    const [stop] = stops();
    assert.equal(stop?.characterId, twin.id, "fielded, the twin's watch stops the save");
    await answer(stop.id, { pass: true }, allyUser);
    await settleQueue(world.campaignId);
    assert.equal(twinUsed(), 0);
  } finally {
    world.signIn(allyUser);
    await call(route.toggle, "POST", { on: false, characterId: twin.id }, { campaignId: world.campaignId });
    updateGameSettings(world.campaignId, { multiCharacter: "off" });
    rollerHere();
    wizardHere = subscribe(world.campaignId, () => {}, wizUser.id);
  }
});

model.close();
finish();
world.close();
