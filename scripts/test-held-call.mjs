// A tool call held for a player's roll (src/lib/dm/held-call.ts) lands the
// way it would have on the server's dice, with the player's roll in it.
//
// The sweeps (test-enforce-sweep-dice-sites, -turn, -afterroll) prove that a
// check, a contest or a forced save parks a card instead of throwing the
// seat's d20. This suite answers the cards and checks what the call then did:
// the attitude a persuasion moved, the group check the model was told of, the
// save a luck point turned, and a die the first run threw for somebody else
// coming out the same when the call runs again.
import assert from "node:assert/strict";
import { call as routeCall } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

process.env.DM_COMPACT_THRESHOLD ??= "1000000";
const { test, finish } = suite("test-held-call");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed", ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getPendingRoll, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { getNpcByName } = await import("../src/lib/db/npcs.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const submit = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");
const choose = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/after-roll");

const hero = world.addHero({ name: "Seat", class: "bard", level: 5, maxHp: 40, abilities: { cha: 16, str: 10 }, proficiencies: TRAINED });
const ally = world.addHero({ name: "Pal", class: "fighter", level: 5, maxHp: 40, abilities: { str: 10 }, proficiencies: TRAINED });
const lucky = world.addHero({ name: "Lu", class: "fighter", level: 5, maxHp: 40, abilities: { dex: 10 }, feats: ["Lucky"] });

function reset() {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  setMemberRealDice(world.campaignId, hero.userId, false);
  world.clearDice();
  for (const sheet of [hero, ally, lucky]) world.patch(sheet.id, { currentHp: 40, conditions: [], conditionMeta: {} });
  world.patch(lucky.id, { resources: { ...world.sheet(lucky.id).resources, luck_points: { max: 3, used: 0 } } });
}
const parkedFor = (userId) => listOpenPendingRolls(world.campaignId).filter((pending) => pending.userId === userId);
async function enter(pending, faces) {
  world.signIn({ id: pending.userId });
  const out = await routeCall(submit, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  return out.json;
}

await test("a persuasion parked for physical dice moves the person once the face is entered, and not before", async () => {
  reset();
  await world.invoke("set_npc", { name: "Mira", attitude: "indifferent" });
  setMemberRealDice(world.campaignId, hero.userId, true);
  const out = await world.invoke("social_check", { characterId: hero.id, npc: "Mira", approach: "persuade", reason: "the cellar" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.parked, true, JSON.stringify(out.result));
  assert.equal(getNpcByName(world.campaignId, "Mira").attitude, "indifferent", "nothing moved before the roll");
  const [card] = parkedFor(hero.userId);
  assert.ok(card?.carry?.call, "the card holds the call");
  assert.equal(card.kind, "skill_check");
  await enter(card, [20]);
  assert.notEqual(getNpcByName(world.campaignId, "Mira").attitude, "indifferent", "a 20 sways her once the roll lands");
  const landed = getPendingRoll(card.id);
  assert.equal(landed.status, "submitted");
  const roll = listRecentRolls(world.campaignId, 5).find((entry) => entry.id === landed.rollId);
  assert.equal(roll?.breakdown.natural, 20, "the stored roll is the face entered");
  assert.match(landed.carry.answer ?? "", /attitude/, "what the call answered is kept for the turn");
});

await test("a die the first run threw for another character comes out the same when the call runs again", async () => {
  reset();
  setMemberRealDice(world.campaignId, hero.userId, true);
  // Pal rolls first, on the server's dice: 17. Seat parks.
  world.dice(17);
  const out = await world.invoke("group_check", { skill: "athletics", dc: 10, characterIds: [ally.id, hero.id], reason: "the wall" });
  assert.equal(out.result?.parked, true, JSON.stringify(out));
  assert.equal(listRecentRolls(world.campaignId, 10).filter((roll) => roll.characterId === ally.id && /group/.test(roll.detail)).length, 0, "the first run's roll was taken back with it");
  world.clearDice();
  await enter(parkedFor(hero.userId)[0], [3]);
  const pal = listRecentRolls(world.campaignId, 10).find((roll) => roll.characterId === ally.id && /group/.test(roll.detail));
  assert.equal(pal?.breakdown.natural, 17, `Pal's die was thrown again: ${JSON.stringify(pal?.breakdown)}`);
  const seat = listRecentRolls(world.campaignId, 10).find((roll) => roll.characterId === hero.id && /group/.test(roll.detail));
  assert.equal(seat?.breakdown.natural, 3);
});

await test("a forced save a luck point turns lands as the save it became", async () => {
  reset();
  world.dice(2);
  const out = await world.invoke("cast_at_player", { characterId: lucky.id, saveAbility: "dex", dc: 15, damage: "20", damageType: "fire", halfOnSave: true, source: "a gout of flame" });
  assert.equal(out.result?.parked, true, JSON.stringify(out));
  assert.equal(world.sheet(lucky.id).currentHp, 40, "nothing lands while the choice waits");
  const [card] = parkedFor(lucky.userId);
  assert.ok(card.thrown?.options.some((option) => option.id === "lucky"));
  world.signIn({ id: lucky.userId });
  world.dice(19);
  const spent = await routeCall(choose, "POST", { use: "lucky" }, { campaignId: world.campaignId, pendingRollId: card.id });
  assert.equal(spent.status, 200, JSON.stringify(spent.json));
  const picked = await routeCall(choose, "POST", { die: 1 }, { campaignId: world.campaignId, pendingRollId: card.id });
  assert.equal(picked.status, 200, JSON.stringify(picked.json));
  assert.equal(world.sheet(lucky.id).currentHp, 30, "a made save takes half of 20");
  assert.equal(world.sheet(lucky.id).resources.luck_points.used, 1, "one luck point, spent once");
});

await test("an AI turn's group check waits on the seat's physical die and hands the model the group's result", async () => {
  reset();
  setMemberRealDice(world.campaignId, hero.userId, true);
  const asked = call("group_check", { skill: "athletics", dc: 12, characterIds: [hero.id], reason: "over the wall" });
  model.script([reply({ calls: [asked] }), reply({ text: "Over the wall you go." })]);
  await model.turn(world, "I climb over the wall.", hero.id, hero.userId);
  await settleQueue(world.campaignId);
  const [card] = parkedFor(hero.userId);
  assert.ok(card?.carry?.call, "the turn parked on the seat's card");
  assert.equal(card.toolCallId, asked.id);
  await enter(card, [18]);
  await settleQueue(world.campaignId);
  const told = model.requests.at(-1)?.messages.find((message) => message.role === "tool" && message.tool_call_id === asked.id)?.content ?? "";
  assert.match(String(told), /"passed":true/, `the model reads the group's result: ${String(told).slice(0, 300)}`);
});

await test("at a table a person runs, a creature's attack from the console stops for a wizard's Portent, and the number lands on its d20 once answered", async () => {
  reset();
  const { combatKit } = await import("./lib/enforce-combat.mjs");
  const { setDmMode } = await import("../src/lib/db/campaigns.ts");
  const { subscribe } = await import("../src/lib/events.ts");
  const kit = await combatKit(world);
  const seer = world.addHero({ name: "Seer", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 } });
  world.patch(seer.id, { features: [{ name: "Portent", source: "subclass" }], resources: { sub_portent: { max: 2, used: 0 } }, foretold: [17, 3] });
  subscribe(world.campaignId, () => {}, seer.userId);
  await kit.fight(1, { heroFaces: { [seer.id]: 18, [hero.id]: 15, [ally.id]: 14, [lucky.id]: 13 } });
  const [goblin] = world.enemies();
  kit.place(ally.id, 5, 5);
  kit.place(goblin.id, 5, 6);
  kit.place(seer.id, 5, 2);
  setDmMode(world.campaignId, "human", world.owner.id);
  try {
    world.signIn({ id: seer.userId });
    const on = await routeCall(await world.route("campaigns/[campaignId]/foresight"), "POST", { on: true, characterId: seer.id }, { campaignId: world.campaignId });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    kit.freshRound?.();
    const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: ally.id });
    assert.equal(swing.result?.parked, true, JSON.stringify(swing));
    const [stop] = listOpenPendingRolls(world.campaignId).filter((pending) => pending.parkedFor === "watch");
    assert.ok(stop, "the console's attack stops for the watcher");
    const attacks = () => listRecentRolls(world.campaignId, 50).filter((roll) => roll.kind === "attack" && roll.attacker?.id === goblin.id);
    const before = attacks().length;
    world.signIn({ id: seer.userId });
    const answered = await routeCall(await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]/watch"), "POST", { value: 3 }, { campaignId: world.campaignId, pendingRollId: stop.id });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    await settleQueue(world.campaignId);
    const landed = attacks();
    assert.equal(landed.length, before + 1, "the held attack ran on the answer");
    assert.equal(landed[0].breakdown.natural, 3, "its d20 shows the foretold 3");
    assert.deepEqual(world.sheet(seer.id).foretold, [17], "the 3 was paid for");
  } finally {
    setDmMode(world.campaignId, "ai", world.owner.id);
    await kit.endFight();
  }
});

model.close();
world.close();
finish();
