// The enemy-turn backstop as a held step (src/lib/dm/backstop-calls.ts): a
// creature's turn the GM narrated and never played is played by the server
// after the narration, one creature at a time, and a d20 in it waits as a
// GM's enemy_attack waits. A watcher holding Portent is asked before the
// creature's attack roll; the pass stops there, the creatures after it stay
// due, the turn waits, and once the watcher answers the pass goes on from
// that creature, not from the start, with no model call.
//
// Portent (src/lib/srd/subclasses.json): "You can replace any attack roll,
// saving throw, or ability check made by you or a creature that you can see
// with one of these foretelling rolls. You must choose to do so before the
// roll."
import assert from "node:assert/strict";
import { call as routeCall } from "./lib/enforce-campaign.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";
import { openWorld } from "./lib/enforce-world.mjs";

process.env.DM_COMPACT_THRESHOLD ??= "1000000";
const { test, finish } = suite("test-backstop-held");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false, dicePolicy: "real_allowed" } });
const model = await fakeModel();
model.pointAt(world);
const kit = await combatKit(world);
const { listOpenPendingRolls, getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { saveEncounter } = await import("../src/lib/db/encounters.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { subscribe } = await import("../src/lib/events.ts");
const route = {
  submit: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
  watch: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"),
  toggle: await world.route("campaigns/[campaignId]/foresight"),
};

const seerUser = world.addUser("seer");
const karaUser = world.addUser("kara");
// The watcher's player is at the table: one who has left is not stopped for.
subscribe(world.campaignId, () => {}, seerUser.id);
const seer = world.addHero({ user: seerUser, name: "Seer", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 } });
const kara = world.addHero({ user: karaUser, name: "Kara", class: "fighter", level: 5, maxHp: 44, ac: 15, acOverride: true, abilities: { str: 16 }, proficiencies: TRAINED });

const stops = () => listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "watch");
const attacksBy = (enemy) => listRecentRolls(world.campaignId, 200).filter((roll) => roll.kind === "attack" && roll.attacker?.id === enemy.id);

// A fight with `count` goblins, every one of them due on a pass the model
// then narrates over without playing, and the seer watching with two
// foretelling rolls.
async function stage(count, { watch = true } = {}) {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  await kit.endFight();
  world.patch(seer.id, { currentHp: 30, conditions: [], conditionMeta: {}, features: [{ name: "Portent", source: "subclass" }], resources: { sub_portent: { max: 2, used: 0 } }, foretold: [17, 2], watchingEncounterId: null });
  world.patch(kara.id, { currentHp: 44, conditions: [], conditionMeta: {} });
  await kit.fight(count, { heroFaces: { [kara.id]: 19, [seer.id]: 12 } });
  const goblins = world.enemies();
  for (const goblin of goblins) kit.setEnemy(goblin.id, { maxHp: 400, currentHp: 400 });
  kit.place(kara.id, 5, 5);
  goblins.forEach((goblin, at) => kit.place(goblin.id, 4 + at * 2, 6));
  kit.place(seer.id, 5, 3);
  if (watch) {
    world.signIn(seerUser);
    const on = await routeCall(route.toggle, "POST", { on: true, characterId: seer.id }, { campaignId: world.campaignId });
    assert.equal(on.status, 200, JSON.stringify(on.json));
  }
  const encounter = world.encounter();
  saveEncounter({ ...encounter, turnIndex: encounter.order.findIndex((slot) => slot.enemyId === goblins[0].id), turnBudget: null, reactionsUsed: [], legendary: { ...encounter.legendary, due: goblins.map((goblin) => goblin.id), acted: null } });
  world.clearDice();
  return goblins;
}

async function narrateOver() {
  model.script([reply({ text: "The goblins snarl and press in." })]);
  world.say("system", "The goblins press in.");
  const asked = model.requests.length;
  await startDmTurn(world.campaignId);
  return { turnId: getLatestDmTurnId(world.campaignId), asked: model.requests.length - asked };
}

async function answer(stop, body) {
  world.signIn(seerUser);
  const out = await routeCall(route.watch, "POST", body, { campaignId: world.campaignId, pendingRollId: stop.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  await settleQueue(world.campaignId);
}

await test("a creature the backstop plays stops for the watcher before its attack roll, and its attack is the watcher's number once they answer", async () => {
  const [goblin] = await stage(1);
  const { turnId, asked } = await narrateOver();
  assert.equal(asked, 1, "the narration is the turn's one model call");
  const [stop] = stops();
  assert.ok(stop, "no watch stop: the backstop threw the creature's d20 with a Portent holder watching");
  assert.equal(attacksBy(goblin).length, 0, "the creature attacked before the watcher answered");
  assert.equal(getDmTurn(turnId).status, "awaiting_rolls", "the turn closed while its backstop waited");
  const before = model.requests.length;
  await answer(stop, { value: 2 });
  const [roll] = attacksBy(goblin);
  assert.ok(roll, "the creature never attacked once the watcher answered");
  assert.equal(roll.breakdown.terms.find((term) => term.sides === 20)?.dice?.[0]?.value, 2, `the foretold 2 is not the creature's d20: ${JSON.stringify(roll.breakdown.terms)}`);
  assert.equal(world.sheet(seer.id).foretold.length, 1, "the foretelling roll was not spent");
  assert.equal(getDmTurn(turnId).status, "done");
  assert.equal(model.requests.length, before, "the model was asked again after its narration");
  assert.deepEqual(world.encounter().legendary.due ?? [], [], "the creature is still due after its turn was played");
});

await test("the pass goes on from the creature that waited: the one before it attacks once, the one after it waits its own turn", async () => {
  const [first, second] = await stage(2);
  const { turnId } = await narrateOver();
  const [stop] = stops();
  assert.ok(stop, "the first creature did not stop for the watcher");
  assert.deepEqual(world.encounter().legendary.due, [first.id, second.id], "both creatures stay due while the first waits");
  await answer(stop, { pass: true });
  assert.equal(attacksBy(first).length >= 1, true, "the first creature never attacked");
  const firstSwings = attacksBy(first).length;
  const [next] = stops();
  assert.ok(next, "the second creature did not stop for the watcher, who still holds a foretelling roll");
  assert.equal(attacksBy(second).length, 0, "the second creature attacked before the watcher answered");
  assert.equal(getDmTurn(turnId).status, "awaiting_rolls");
  assert.deepEqual(world.encounter().legendary.due, [second.id], "only the second creature is still due");
  await answer(next, { pass: true });
  assert.equal(attacksBy(first).length, firstSwings, "the first creature attacked again when the pass went on: it started over");
  assert.ok(attacksBy(second).length >= 1, "the second creature never attacked");
  assert.equal(getDmTurn(turnId).status, "done");
  assert.equal(stops().length, 0);
});

await test("a save the creature forces on a seat on physical dice is theirs to roll: the pass waits for it, and the bite lands with their roll", async () => {
  const [goblin] = await stage(1, { watch: false });
  // A bite that cannot miss, and a poison save on the hit.
  kit.setEnemy(goblin.id, { stats: { ...kit.enemy(goblin.id).stats, attacks: [{ name: "Bite", toHit: 30, damage: "1d4", type: "piercing", onHit: { save: "con", dc: 11, damage: "2d6", damageType: "poison" } }] } });
  setMemberRealDice(world.campaignId, karaUser.id, true);
  try {
    // The creature's own dice are named before its turn is played, since its
    // d20 is thrown on either side of the seat's save as the queue runs: a 10
    // (no critical hit, which doubles the bite's die), then 2 on every damage
    // die (the bite's d4, the poison's 2d6). Left to chance, a natural 20 or
    // a 4 on a doubled bite read as the poison landing.
    world.clearDice();
    world.dice(10, 2, 2, 2);
    const { turnId } = await narrateOver();
    const [card] = listOpenPendingRolls(world.campaignId).filter((pending) => pending.characterId === kara.id);
    assert.ok(card, "the server threw the seat's save: no card waits for their dice");
    assert.equal(card.kind, "saving_throw", JSON.stringify(card));
    assert.equal(attacksBy(goblin).length, 0, "the bite stands on the table before its save is rolled");
    assert.equal(getDmTurn(turnId).status, "awaiting_rolls");
    const before = model.requests.length;
    const hp = world.sheet(kara.id).currentHp;
    world.signIn(karaUser);
    const out = await routeCall(route.submit, "POST", { dice: [20] }, { campaignId: world.campaignId, pendingRollId: card.id });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    await settleQueue(world.campaignId);
    world.clearDice();
    assert.equal(attacksBy(goblin).length, 1, "the creature's bite was not made once, with the save");
    assert.ok(world.sheet(kara.id).currentHp < hp, "the bite did not land");
    const lost = hp - world.sheet(kara.id).currentHp;
    assert.equal(lost, 2, `the bite's 2 and no poison on a save of 20: ${lost} lost; rolls ${JSON.stringify(listRecentRolls(world.campaignId, 6).map((roll) => [roll.kind, roll.breakdown?.natural ?? null, roll.total, roll.detail ?? roll.label ?? ""]))}`);
    assert.equal(getDmTurn(turnId).status, "done");
    assert.equal(model.requests.length, before, "the model was asked again after its narration");
  } finally {
    setMemberRealDice(world.campaignId, karaUser.id, false);
  }
});

await kit.endFight();
model.close();
world.close();
finish();
