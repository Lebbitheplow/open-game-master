// Slayer's Counter at the stop before the save (src/lib/dm/slayers-counter.ts,
// foresight.ts): "A reaction attacks your prey when it forces a save on you,
// and a hit means the save automatically succeeds" (Monster Slayer 15).
// The reaction acts before the save is rolled: when the creature under the
// ranger's Slayer's Prey is about to force a save on them, the server stops
// for the ranger's player; the attack is made first, a hit makes the save
// succeed with no roll (so its damage never lands), a miss leaves it to be
// rolled. Before this the reaction answered a save already failed and gave
// back what the failure had cost.
// Dice forced; every check reads a sheet, a stop, a stored roll or the line
// the model was told.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-slayers-counter-stop");
const world = await openWorld({ campaign: { maxPlayers: 12 }, gameSettings: { ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { listOpenPendingRolls, publicPendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { subscribe } = await import("../src/lib/events.ts");
const watch = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch");

const user = world.addUser("rook");
// Strength 16 and proficiency +5: the longsword is +8 to hit. Dexterity +0.
const ranger = world.addHero({ user, name: "Rook", class: "ranger", subclass: "Monster Slayer", level: 15, maxHp: 100, proficiencies: TRAINED, abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
// Their player is at the table: nobody is stopped for an absent one.
subscribe(world.campaignId, () => {}, user.id);

let prey;
let other;
const stage = async () => {
  await kit.endFight();
  await kit.fight(2, { heroFaces: { [ranger.id]: 19 } });
  [prey, other] = world.enemies();
  for (const enemy of [prey, other]) kit.setEnemy(enemy.id, { maxHp: 200, currentHp: 200, ac: 12, stats: { spells: ["Sacred Flame"] } });
  kit.place(ranger.id, 5, 5);
  kit.place(prey.id, 5, 6);
  kit.place(other.id, 6, 5);
  world.patch(ranger.id, {
    currentHp: 100,
    features: [{ name: "Slayer's Prey", description: "" }, { name: "Slayer's Counter", description: "" }],
    conditions: ["slayer's prey"],
    conditionMeta: { "slayer's prey": { quarry: prey.id } },
  });
};
const stops = () => listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "watch");
const answer = (id, body) => {
  world.signIn(user);
  return call(watch, "POST", body, { campaignId: world.campaignId, pendingRollId: id });
};
// The creature's own turn: it casts Sacred Flame at the ranger (a Dexterity
// save against DC 25 or 1d8 radiant, nothing on a success).
const flame = (caster) => {
  const encounter = world.encounter();
  const place = encounter.order.findIndex((entry) => entry.enemyId === caster.id);
  saveEncounter({ ...encounter, turnIndex: place, turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: [caster.id], acted: null } });
  model.script([reply({ calls: [modelCall("cast_at_player", { characterId: ranger.id, spell: "Sacred Flame", saveAbility: "dex", dc: 25, damage: "1d8", damageType: "radiant", casterEnemyId: caster.id })] }), reply({ text: "The flame falls." })]);
  world.say("system", "The creature raises a hand.");
  return startDmTurn(world.campaignId);
};
const toldLast = () => JSON.parse(model.requests.at(-1).messages.filter((message) => message.role === "tool").at(-1).content);
const savesRolled = () => listRecentRolls(world.campaignId, 200).filter((roll) => roll.kind === "saving_throw" && roll.characterId === ranger.id).length;
const hp = () => world.sheet(ranger.id).currentHp;
const reacted = () => world.encounter().reactionsUsed.includes(ranger.id);

await test("The prey's spell stops for the ranger before the save is rolled; the attack hits, and the save succeeds with no roll and no damage.", async () => {
  await stage();
  const before = savesRolled();
  await flame(prey);
  const [stop] = stops();
  assert.ok(stop, "the save the prey forces did not stop for the ranger");
  assert.equal(publicPendingRoll(stop).watch.power, "slayers_counter");
  assert.equal(hp(), 100, "the spell landed before the ranger was asked");
  // The attack: 15 + 8 hits AC 12, and 1d8 + 3.
  world.dice(15, 4);
  assert.equal((await answer(stop.id, { shift: true })).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.ok(kit.enemy(prey.id).currentHp < 200, "the reaction's attack dealt nothing");
  assert.equal(hp(), 100, "a save made by Slayer's Counter still cost its damage");
  assert.equal(savesRolled(), before, "a save that succeeds automatically was rolled");
  assert.equal(reacted(), true, "the reaction is spent");
  assert.match(toldLast().savedWith ?? "", /Rook used Slayer's Counter: the attack hit/);
  assert.ok(!world.sheet(ranger.id).conditions.includes("slayer's counter"), "the mark outlived the save it answered");
});

await test("A miss leaves the save to be rolled, and the reaction is spent all the same.", async () => {
  await stage();
  const before = savesRolled();
  await flame(prey);
  // The attack: 2 + 8 misses AC 12. The save: 3 against DC 25, and 6 radiant.
  world.dice(2, 3, 6);
  assert.equal((await answer(stops()[0].id, { shift: true })).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(kit.enemy(prey.id).currentHp, 200);
  assert.equal(savesRolled(), before + 1, "the save was not rolled after a miss");
  assert.equal(hp(), 94);
  assert.equal(reacted(), true);
});

await test("Letting it roll spends nothing; a creature that is not the prey stops nobody.", async () => {
  await stage();
  await flame(prey);
  world.dice(3, 6);
  assert.equal((await answer(stops()[0].id, { pass: true })).status, 200);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(hp(), 94);
  assert.equal(reacted(), false, "a pass took the reaction");
  await stage();
  world.dice(3, 6);
  await flame(other);
  await settleQueue(world.campaignId);
  world.clearDice();
  assert.equal(stops().length, 0, "a save forced by another creature stopped for Slayer's Counter");
  assert.equal(hp(), 94);
});

await test("After the save has landed the reaction is refused for a player the stop reaches.", async () => {
  await stage();
  await flame(prey);
  world.dice(3, 6);
  await answer(stops()[0].id, { pass: true });
  await settleQueue(world.campaignId);
  world.clearDice();
  const late = await world.invoke("use_reaction", { characterId: ranger.id, feature: "Slayer's Counter", targetEnemyId: prey.id });
  assert.equal(late.ok, false, "the reaction answered a save already rolled");
  assert.match(String(late.error), /before the save is rolled/);
  assert.equal(reacted(), false);
  assert.equal(hp(), 94);
});

model.close();
finish();
world.close();
