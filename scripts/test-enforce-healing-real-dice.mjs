// Healing dice are the roller's own (issue 902).
//
// A seat on physical dice is told it rolls its own dice inside the GM's
// moves (src/lib/dice/held-rolls.ts REAL_DICE_SCOPE). The d20s kept that
// promise through one door (src/lib/dm/character-roll.ts); healing dice were
// still thrown where they stood. A fighter with real dice on the table used
// Second Wind, the server rolled the d10, and the chronicle never showed the
// roll.
//
// Held here, by the console's door and the AI's:
//   - Second Wind, a potion, a healing spell and a Healer's kit wait for the
//     player who rolls them, heal by the dice that player enters, and leave
//     nothing behind while they wait (no hit points, no use spent);
//   - the one who rolls is the one whose feature, potion or spell it is,
//     whoever is healed;
//   - a seat on the server's dice is not asked, and a flat amount has nothing
//     to roll;
//   - the healing card joins the turn's cards, so the chronicle shows it;
//   - the table is told the card is answered once the dice are in. A call
//     held for a roll records the roll itself, and that record named no card:
//     the card stayed up, asking for dice already entered, for a d20 held by
//     the same door as well (a group check is the case here);
//   - one casting over a list of creatures is still thrown by the server
//     (src/lib/dm/heal-spell.ts says why);
//   - the issue's own table: an AI Game Master's fight, the Second Wind card
//     played from the Hand, the die entered, and the narration that follows
//     carrying the roll's card.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-healing-real-dice");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { dicePolicy: "real_allowed" } });
const ai = await aiEngine(world);
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { getDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { entryDice } = await import("../src/lib/dice.ts");
const { listEventsSince } = await import("../src/lib/events.ts");
const submitRoute = await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]");

const SLOTS = { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } };
const CASTING = { ability: "wis", slots: SLOTS, prepared: ["Cure Wounds", "Healing Word", "Mass Healing Word"], known: [], cantrips: [] };
const POUCH = [{ name: "Potion of Healing", qty: 2 }, { name: "Healer's kit", qty: 1 }];

const fighter = world.addHero({ name: "Brakk", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16, con: 10 }, proficiencies: TRAINED });
const cleric = world.addHero({
  name: "Mira", class: "cleric", level: 5, maxHp: 30, abilities: { wis: 16, con: 10 }, proficiencies: TRAINED,
  spellcasting: CASTING, equipment: POUCH, feats: ["Healer"],
});
const ward = world.addHero({ name: "Tam", class: "rogue", level: 3, maxHp: 30, abilities: { dex: 16, con: 10 }, proficiencies: TRAINED });
const monk = world.addHero({ name: "Moe", class: "monk", subclass: "open_hand", level: 6, maxHp: 40, abilities: { dex: 16, con: 10 }, proficiencies: TRAINED });
const BASE = Object.fromEntries([fighter, cleric, ward, monk].map((hero) => [hero.id, world.sheet(hero.id)]));

const pendingOf = (hero) => listOpenPendingRolls(world.campaignId).filter((entry) => entry.userId === hero.userId);
const rollsSince = (mark) => listRecentRolls(world.campaignId, 40).filter((roll) => !mark.has(roll.id));
const rollMark = () => new Set(listRecentRolls(world.campaignId, 40).map((roll) => roll.id));

// Everyone hurt and whole otherwise, nobody on physical dice, nothing waiting.
function reset() {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  for (const hero of [fighter, cleric, ward, monk]) {
    setMemberRealDice(world.campaignId, hero.userId, false);
    const base = BASE[hero.id];
    world.patch(hero.id, {
      currentHp: 5, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null,
      resources: base.resources, equipment: base.equipment, spellcasting: base.spellcasting,
    });
  }
  world.clearDice();
}

// Whether the table was told a card is answered since `seq`: by the roll that
// names it, or by the card itself coming round closed. A screen drops the
// card on either (useCampaignStream.ts), and on nothing else.
function cardClosed(campaignId, pendingId, seq) {
  return listEventsSince(campaignId, seq, 500).some((event) =>
    (event.type === "roll_result" && event.payload?.pendingRollId === pendingId) ||
    (event.type === "roll_pending" && event.payload?.pendingRoll?.id === pendingId && event.payload.pendingRoll.status !== "pending"));
}
const lastSeq = (campaignId) => listEventsSince(campaignId, 0, 5000).at(-1)?.seq ?? 0;

// The player types the faces of their own dice into the card.
async function enter(hero, pending, faces) {
  world.signIn({ id: hero.userId });
  assert.deepEqual(entryDice(pending.expression).length, faces.length, `${pending.expression} asks for ${faces.length} dice`);
  const seq = lastSeq(world.campaignId);
  const landed = await call(submitRoute, "POST", { dice: faces }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(landed.status, 200, `the dice were not taken: ${JSON.stringify(landed.json).slice(0, 200)}`);
  assert.ok(cardClosed(world.campaignId, pending.id, seq), "the table was not told the card is answered, so it stays up");
}

const DOORS = [
  ["the console", (name, args) => world.invoke(name, args)],
  ["the AI", (name, args) => (ai.fresh(), ai.invoke(name, args))],
];

for (const [door, invoke] of DOORS) {
  await test(`${door}: Second Wind waits for a fighter on physical dice and heals by the die they enter`, async () => {
    reset();
    setMemberRealDice(world.campaignId, fighter.userId, true);
    world.say("player", "I use my Second Wind.", world.sheet(fighter.id));
    const mark = rollMark();
    const out = await invoke("use_resource", { characterId: fighter.id, resource: "Second Wind" });
    assert.equal(out.ok, true, `refused: ${out.error}`);
    assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
    const [pending, ...more] = pendingOf(fighter);
    assert.ok(pending, "no roll card went to the fighter's seat");
    assert.equal(more.length, 0, "one card, not several");
    assert.equal(pending.parkedFor, "real_dice");
    assert.equal(pending.kind, "custom");
    assert.equal(pending.expression, "1d10+3");
    assert.match(pending.detail, /Second Wind/);
    // Nothing of the call stands while it waits.
    assert.equal(world.sheet(fighter.id).currentHp, 5, "healed before the dice were in");
    assert.equal(world.sheet(fighter.id).resources.second_wind.used, 0, "the use was spent before the dice were in");
    assert.equal(rollsSince(mark).length, 0, "the server threw the die");

    await enter(fighter, pending, [7]);
    assert.equal(world.sheet(fighter.id).currentHp, 15, "7 on the d10 and the fighter's level heal 10");
    assert.equal(world.sheet(fighter.id).resources.second_wind.used, 1);
    assert.equal(pendingOf(fighter).length, 0, "the card is answered");
    const rolls = rollsSince(mark);
    assert.equal(rolls.length, 1, `one roll on record, not ${rolls.length}`);
    assert.equal(rolls[0].total, 10);
    assert.equal(rolls[0].characterId, fighter.id);
  });

  await test(`${door}: a fighter on the server's dice is not asked, and the roll joins the turn's cards`, async () => {
    reset();
    world.say("player", "I use my Second Wind.", world.sheet(fighter.id));
    const mark = rollMark();
    world.dice(4);
    const out = await invoke("use_resource", { characterId: fighter.id, resource: "Second Wind" });
    assert.equal(out.ok, true, `refused: ${out.error}`);
    assert.equal(out.result.parked, undefined);
    assert.equal(out.result.healingRolled, 7);
    assert.equal(pendingOf(fighter).length, 0);
    assert.equal(world.sheet(fighter.id).currentHp, 12);
    const rolls = rollsSince(mark);
    assert.equal(rolls.length, 1);
    // The chronicle draws its dice cards from the turn's list.
    const turn = door === "the AI" ? ai.turn() : getDmTurn(out.turnId);
    assert.ok(turn.rollIds.includes(rolls[0].id), "the healing roll is not among the turn's cards");
  });
}

await test("a potion poured for someone else is rolled by the one who pours it", async () => {
  reset();
  setMemberRealDice(world.campaignId, cleric.userId, true);
  const out = await world.invoke("use_item", { characterId: cleric.id, item: "Potion of Healing", targetCharacterId: ward.id });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  assert.equal(pendingOf(ward).length, 0, "the one healed was asked to roll");
  const [pending] = pendingOf(cleric);
  assert.ok(pending, "no roll card went to the seat that poured the potion");
  assert.equal(pending.expression, "2d4+2");
  assert.match(pending.detail, /Potion of Healing on Tam/);
  assert.equal(world.sheet(ward.id).currentHp, 5);
  assert.equal(world.sheet(cleric.id).equipment.find((item) => item.name === "Potion of Healing").qty, 2, "the potion was spent before the dice were in");

  await enter(cleric, pending, [1, 2]);
  assert.equal(world.sheet(ward.id).currentHp, 10, "1 and 2 on the d4s and 2 heal 5");
  assert.equal(world.sheet(cleric.id).equipment.find((item) => item.name === "Potion of Healing").qty, 1, "one potion, once");
});

await test("a healing spell is rolled by its caster, and its slot is spent once", async () => {
  reset();
  setMemberRealDice(world.campaignId, cleric.userId, true);
  const mark = rollMark();
  const out = await world.invoke("heal", { characterId: ward.id, casterId: cleric.id, spell: "Cure Wounds", reason: "a hand on the wound" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const [pending] = pendingOf(cleric);
  assert.ok(pending, "no roll card went to the caster's seat");
  assert.equal(pending.expression, "1d8+3");
  assert.match(pending.detail, /Cure Wounds on Tam/);
  assert.equal(world.sheet(ward.id).currentHp, 5);
  assert.equal(world.sheet(cleric.id).spellcasting.slots[1].used, 0, "the slot was spent before the dice were in");

  await enter(cleric, pending, [5]);
  assert.equal(world.sheet(ward.id).currentHp, 13, "5 on the d8 and Wisdom's 3 heal 8");
  assert.equal(world.sheet(cleric.id).spellcasting.slots[1].used, 1, "one casting, one slot");
  const rolls = rollsSince(mark);
  assert.equal(rolls.length, 1, `one roll on record, not ${rolls.length}`);
  assert.equal(rolls[0].characterId, cleric.id, "the roll is the caster's");
});

await test("a Healer's kit use is rolled by the healer", async () => {
  reset();
  setMemberRealDice(world.campaignId, cleric.userId, true);
  const out = await world.invoke("use_item", { characterId: cleric.id, item: "Healer's kit", targetCharacterId: ward.id });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const [pending] = pendingOf(cleric);
  assert.ok(pending, "no roll card went to the healer's seat");
  assert.equal(pending.expression, "1d6+4+3");
  await enter(cleric, pending, [2]);
  assert.equal(world.sheet(ward.id).currentHp, 14, "2 on the d6, 4, and three Hit Dice heal 9");
});

await test("a d20 the same door holds closes its card too: a group check on physical dice", async () => {
  reset();
  setMemberRealDice(world.campaignId, fighter.userId, true);
  const out = await world.invoke("group_check", { skill: "stealth", dc: 12, characterIds: [fighter.id], reason: "creeping past the watch" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  const [pending] = pendingOf(fighter);
  assert.ok(pending, "no roll card went to the fighter's seat");
  await enter(fighter, pending, [15]);
  assert.equal(pendingOf(fighter).length, 0);
});

await test("a flat amount has nothing to roll, so a seat on physical dice is not asked", async () => {
  reset();
  setMemberRealDice(world.campaignId, monk.userId, true);
  const out = await world.invoke("use_resource", { characterId: monk.id, resource: "Wholeness of Body" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, undefined, "a card went out for a number with no die in it");
  assert.equal(pendingOf(monk).length, 0);
  assert.equal(world.sheet(monk.id).currentHp, 23, "three times the monk's level");
});

await test("one casting over a list of creatures is still thrown by the server, and spends one slot", async () => {
  reset();
  setMemberRealDice(world.campaignId, cleric.userId, true);
  const out = await world.invoke("heal", {
    casterId: cleric.id, spell: "Mass Healing Word", reason: "a word for the fallen",
    targets: [{ characterId: ward.id }, { characterId: fighter.id }],
  });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(pendingOf(cleric).length, 0, "a list's entry waited: it is run again alone and would pay for the casting twice");
  assert.ok(world.sheet(ward.id).currentHp > 5, "Tam was not healed");
  assert.ok(world.sheet(fighter.id).currentHp > 5, "Brakk was not healed");
  assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used, 1, "one casting, one slot");
});

world.close();

// ---- the issue's table -------------------------------------------------------

const table = await openWorld({ gameSettings: { dicePolicy: "real_allowed", ttsEnabled: false } });
const model = await fakeModel();
model.pointAt(table);
const kit = await combatKit(table);
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const brakk = table.addHero({ name: "Brakk", class: "fighter", level: 3, maxHp: 30, abilities: { str: 16, con: 10 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });

await test("an AI Game Master's turn: the Second Wind card waits for the die, and the narration carries its card", async () => {
  await kit.fight(1, { heroFaces: { [brakk.id]: 19 } });
  const [enemy] = table.enemies();
  kit.place(brakk.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(brakk.id);
  table.patch(brakk.id, { currentHp: 5 });
  setMemberRealDice(table.campaignId, brakk.userId, true);
  const story = "Brakk plants his feet, breathes once, and the ache in his ribs lets go.";
  model.script([reply({ text: story })]);
  const before = model.requests.length;
  const early = await model.turn(table, "Brakk uses Second Wind.", brakk.id, brakk.userId, { intent: { card: "feature", resourceId: "Second Wind" } });
  await settleQueue(table.campaignId);
  assert.equal(early, null, "the GM narrated before the die was in");
  assert.equal(model.requests.length, before, "the model was asked before the die was in");
  const [pending] = listOpenPendingRolls(table.campaignId).filter((entry) => entry.userId === brakk.userId);
  assert.ok(pending, "no roll card went to the fighter's seat");
  assert.equal(pending.expression, "1d10+3");
  assert.equal(table.sheet(brakk.id).currentHp, 5);

  table.signIn({ id: brakk.userId });
  const seq = lastSeq(table.campaignId);
  const landed = await call(submitRoute, "POST", { dice: [9] }, { campaignId: table.campaignId, pendingRollId: pending.id });
  assert.equal(landed.status, 200, `the die was not taken: ${JSON.stringify(landed.json).slice(0, 200)}`);
  assert.ok(cardClosed(table.campaignId, pending.id, seq), "the table was not told the card is answered, so it stays up");
  await settleQueue(table.campaignId);
  assert.equal(table.sheet(brakk.id).currentHp, 17, "9 on the d10 and the fighter's level heal 12");
  const roll = listRecentRolls(table.campaignId, 10).find((entry) => entry.kind === "custom" && /Second Wind/.test(entry.detail));
  assert.ok(roll, "the healing roll is not on record");
  assert.equal(roll.total, 12);
  const told = listRecentMessages(table.campaignId, 10).filter((entry) => entry.authorType === "dm").at(-1);
  assert.ok(told?.content.includes(story), `the GM did not narrate once the die was in: ${told?.content}`);
  assert.ok(told.content.includes(`[roll:${roll.id}]`), `the narration does not carry the healing roll's card: ${told.content}`);
});

model.close();
table.close();
finish();
