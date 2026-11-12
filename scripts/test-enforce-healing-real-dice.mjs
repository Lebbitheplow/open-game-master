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
//   - one casting over a list of creatures is one call: its caster is asked
//     for each creature's roll in turn, and the slot is spent once. The list
//     used to be a call for each creature sharing one payment in memory, and
//     a roll that held one of them ran it again alone, paying twice, so the
//     server threw a list's dice (src/lib/dm/mutations.ts healList). A list
//     that sends its own dice is still a call for each, thrown by the server;
//   - dice entered at the table are on record as physical and are not thrown
//     again on the stage; dice the server rolls for the seat are not marked;
//   - the issue's own table: an AI Game Master's fight, the Second Wind card
//     played from the Hand, the die entered, and the narration that follows
//     carrying the roll's card.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine, call as modelCall, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

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
// The dice of a subclass's own healing, a maneuver's and a spell's temporary
// hit points: thrown by another helper (roll-card.ts), so they were still the
// server's once Second Wind was not.
const crown = world.addHero({ name: "Oren", class: "paladin", subclass: "Oath of the Crown", level: 9, maxHp: 30, abilities: { str: 16, cha: 16, con: 10 }, proficiencies: TRAINED });
const peace = world.addHero({ name: "Pia", class: "cleric", subclass: "Peace Domain", level: 9, maxHp: 30, abilities: { wis: 16, con: 10 }, proficiencies: TRAINED });
const master = world.addHero({
  name: "Rolf", class: "fighter", subclass: "Battle Master", level: 5, maxHp: 30, abilities: { str: 16, cha: 14, con: 10 }, proficiencies: TRAINED,
  features: [{ name: "Maneuver: Rally", source: "choice" }],
});
const mage = world.addHero({
  name: "Wim", class: "wizard", level: 3, maxHp: 30, abilities: { int: 16, con: 10 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["False Life"], known: [], cantrips: [] },
});
const HEROES = [fighter, cleric, ward, monk, crown, peace, master, mage];
const BASE = Object.fromEntries(HEROES.map((hero) => [hero.id, world.sheet(hero.id)]));

const pendingOf = (hero) => listOpenPendingRolls(world.campaignId).filter((entry) => entry.userId === hero.userId);
const rollsSince = (mark) => listRecentRolls(world.campaignId, 40).filter((roll) => !mark.has(roll.id));
const rollMark = () => new Set(listRecentRolls(world.campaignId, 40).map((roll) => roll.id));

// Everyone hurt and whole otherwise, nobody on physical dice, nothing waiting.
function reset() {
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(world.campaignId);
  for (const hero of HEROES) {
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
// What the table was told of a roll since `seq`: its source says whether the
// stage throws a die for it.
const announced = (campaignId, seq, rollId) =>
  listEventsSince(campaignId, seq, 500).find((event) => event.type === "roll_result" && event.payload?.roll?.id === rollId)?.payload;

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

    const seq = lastSeq(world.campaignId);
    await enter(fighter, pending, [7]);
    assert.equal(world.sheet(fighter.id).currentHp, 15, "7 on the d10 and the fighter's level heal 10");
    assert.equal(world.sheet(fighter.id).resources.second_wind.used, 1);
    assert.equal(pendingOf(fighter).length, 0, "the card is answered");
    const rolls = rollsSince(mark);
    assert.equal(rolls.length, 1, `one roll on record, not ${rolls.length}`);
    assert.equal(rolls[0].total, 10);
    assert.equal(rolls[0].characterId, fighter.id);
    // The die was rolled on a real table: the record says so, and the stage
    // does not throw it again.
    assert.match(rolls[0].detail, /\(physical\)$/, `the record does not say the die was the player's own: ${rolls[0].detail}`);
    assert.equal(announced(world.campaignId, seq, rolls[0].id)?.source, "physical", "the table was told to throw a die the player had already rolled");
  });

  await test(`${door}: one casting over a list of creatures asks its caster for each creature's roll in turn, and spends one slot`, async () => {
    reset();
    setMemberRealDice(world.campaignId, cleric.userId, true);
    const mark = rollMark();
    const out = await invoke("heal", {
      casterId: cleric.id, spell: "Mass Healing Word", reason: "a word for the fallen",
      targets: [{ characterId: ward.id }, { characterId: fighter.id }],
    });
    assert.equal(out.ok, true, `refused: ${out.error}`);
    assert.equal(out.result.parked, true, `the casting did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
    const [first, ...more] = pendingOf(cleric);
    assert.ok(first, "no roll card went to the caster's seat");
    assert.equal(more.length, 0, "one card at a time");
    assert.equal(first.expression, "1d4+3");
    assert.match(first.detail, /Mass Healing Word on Tam/);
    assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used, 0, "the slot was spent before the dice were in");

    await enter(cleric, first, [1]);
    assert.equal(rollsSince(mark).length, 0, "the first roll went on record before the casting finished");
    const [second, ...extra] = pendingOf(cleric);
    assert.ok(second, "the second creature's roll did not come to the caster's seat");
    assert.equal(extra.length, 0);
    assert.match(second.detail, /Mass Healing Word on Brakk/);
    assert.equal(world.sheet(ward.id).currentHp, 5, "nobody is healed until the casting can finish");
    assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used, 0, "the slot was spent before every die was in");

    await enter(cleric, second, [4]);
    assert.equal(world.sheet(ward.id).currentHp, 9, "1 on the d4 and Wisdom's 3");
    assert.equal(world.sheet(fighter.id).currentHp, 12, "4 on the d4 and Wisdom's 3");
    assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used, 1, "one casting, one slot");
    assert.equal(pendingOf(cleric).length, 0);
    const rolls = rollsSince(mark);
    assert.deepEqual(rolls.map((roll) => roll.total).sort((a, b) => a - b), [4, 7], `each roll on record once: ${rolls.map((roll) => `${roll.detail} = ${roll.total}`).join("; ")}`);
    assert.ok(rolls.every((roll) => roll.characterId === cleric.id), "the rolls are the caster's");
  });

  await test(`${door}: one casting over a list of creatures, for a caster on the server's dice: every creature healed, one slot, one answer for each`, async () => {
    reset();
    world.dice(2, 3);
    const out = await invoke("heal", {
      casterId: cleric.id, spell: "Mass Healing Word", reason: "a word for the fallen",
      targets: [{ characterId: ward.id }, { characterId: "Brakk" }],
    });
    assert.equal(out.ok, true, `refused: ${out.error}`);
    assert.equal(out.result.parked, undefined);
    assert.equal(out.result.targets?.length, 2, `one answer for each creature: ${JSON.stringify(out.result).slice(0, 200)}`);
    assert.equal(world.sheet(ward.id).currentHp, 10);
    assert.equal(world.sheet(fighter.id).currentHp, 11, "a creature named by its name is healed as one named by its id");
    assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used, 1, "one casting, one slot");
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

await test("a call that waits on two players records each roll once", async () => {
  reset();
  setMemberRealDice(world.campaignId, fighter.userId, true);
  setMemberRealDice(world.campaignId, ward.userId, true);
  const mark = rollMark();
  const out = await world.invoke("group_check", { skill: "stealth", dc: 12, characterIds: [fighter.id, ward.id], reason: "creeping past the watch" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  const [first] = [...pendingOf(fighter), ...pendingOf(ward)];
  assert.ok(first, "no roll card went out");
  const firstHero = first.userId === fighter.userId ? fighter : ward;
  const secondHero = firstHero === fighter ? ward : fighter;
  // The call waits again, on the second player: the first roll is kept with
  // it, and was recorded here and again by the run that finished.
  await enter(firstHero, first, [15]);
  assert.equal(rollsSince(mark).length, 0, "the first roll went on record before its call finished");
  const [second] = pendingOf(secondHero);
  assert.ok(second, "no roll card went to the second player");
  await enter(secondHero, second, [4]);
  const rolls = rollsSince(mark).filter((roll) => roll.kind === "skill_check");
  assert.deepEqual(rolls.map((roll) => roll.characterId).sort(), [fighter.id, ward.id].sort(), `one roll each: ${rolls.map((roll) => `${roll.detail} = ${roll.total}`).join("; ")}`);
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

await test("a casting that refuses one creature of its list heals the others, and says which was refused", async () => {
  reset();
  world.patch(fighter.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  world.dice(2);
  const out = await world.invoke("heal", {
    casterId: cleric.id, spell: "Mass Healing Word", reason: "a word for the fallen",
    targets: [{ characterId: ward.id }, { characterId: fighter.id }],
  });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(world.sheet(ward.id).currentHp, 10);
  assert.match(String(out.result.partial), /Entry 2 of 2 refused/);
  assert.match(String(out.result.targets?.[1]?.error), /DEAD/);
  assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used, 1, "one casting, one slot");
});

await test("a healing roll the player lets the server make is not marked as their own dice", async () => {
  reset();
  setMemberRealDice(world.campaignId, fighter.userId, true);
  const mark = rollMark();
  const out = await world.invoke("use_resource", { characterId: fighter.id, resource: "Second Wind" });
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const [pending] = pendingOf(fighter);
  world.signIn({ id: fighter.userId });
  const seq = lastSeq(world.campaignId);
  const landed = await call(submitRoute, "POST", { fallback: "digital" }, { campaignId: world.campaignId, pendingRollId: pending.id });
  assert.equal(landed.status, 200, JSON.stringify(landed.json).slice(0, 200));
  const [roll] = rollsSince(mark);
  assert.ok(roll, "the healing roll is not on record");
  assert.doesNotMatch(roll.detail, /physical/);
  assert.equal(announced(world.campaignId, seq, roll.id)?.source, "digital");
});

await test("a list that sends its own dice is still a call for each creature, thrown by the server, and spends one slot", async () => {
  reset();
  setMemberRealDice(world.campaignId, cleric.userId, true);
  const out = await world.invoke("heal", {
    casterId: cleric.id, spell: "Mass Healing Word", reason: "a word for the fallen",
    targets: [{ characterId: ward.id, dice: "1d4" }, { characterId: fighter.id, dice: "1d4" }],
  });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(pendingOf(cleric).length, 0, "a split list's entry waited: it is run again alone and would pay for the casting twice");
  assert.ok(world.sheet(ward.id).currentHp > 5, "Tam was not healed");
  assert.ok(world.sheet(fighter.id).currentHp > 5, "Brakk was not healed");
  assert.equal(world.sheet(cleric.id).spellcasting.slots[3].used, 1, "one casting, one slot");
});

await test("a subclass feature that heals several is rolled once, by its holder: Turn the Tide", async () => {
  reset();
  setMemberRealDice(world.campaignId, crown.userId, true);
  const mark = rollMark();
  const out = await world.invoke("use_resource", { characterId: crown.id, resource: "Channel Divinity", variant: "turn the tide" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const [pending, ...more] = pendingOf(crown);
  assert.ok(pending, "no roll card went to the paladin's seat");
  assert.equal(more.length, 0, "one roll shared out is one card");
  assert.equal(pending.expression, "1d6+3");
  assert.match(pending.detail, /Turn the Tide: healing/);
  assert.equal(world.sheet(ward.id).currentHp, 5);
  assert.equal(world.sheet(crown.id).resources.channel_divinity.used, 0, "the use was spent before the die was in");

  await enter(crown, pending, [4]);
  assert.equal(world.sheet(ward.id).currentHp, 12, "4 on the d6 and Charisma's 3 heal 7");
  assert.equal(world.sheet(fighter.id).currentHp, 12);
  assert.equal(world.sheet(crown.id).resources.channel_divinity.used, 1);
  const rolls = rollsSince(mark);
  assert.equal(rolls.length, 1, `one roll on record, not ${rolls.length}`);
  assert.equal(rolls[0].characterId, crown.id, "the roll is the paladin's");
});

await test("a feature that rolls for each creature asks for one roll after another, each on record once: Balm of Peace", async () => {
  reset();
  // Two creatures hurt, so two rolls.
  for (const hero of HEROES) {
    world.patch(hero.id, { currentHp: hero.id === ward.id || hero.id === fighter.id ? 5 : BASE[hero.id].maxHp });
  }
  setMemberRealDice(world.campaignId, peace.userId, true);
  const mark = rollMark();
  const out = await world.invoke("use_resource", { characterId: peace.id, resource: "Channel Divinity", variant: "balm of peace" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const [first, ...more] = pendingOf(peace);
  assert.ok(first, "no roll card went to the cleric's seat");
  assert.equal(more.length, 0, "one card at a time");
  assert.equal(first.expression, "2d6+3");
  assert.match(first.detail, /Balm of Peace: healing on (Tam|Brakk)/);

  await enter(peace, first, [1, 1]);
  const [second, ...extra] = pendingOf(peace);
  assert.ok(second, "the second creature's roll did not come to the cleric's seat");
  assert.equal(extra.length, 0);
  assert.notEqual(second.detail, first.detail, "the second card is for the other creature");
  assert.equal(world.sheet(peace.id).resources.channel_divinity.used, 0, "the use was spent before every die was in");
  assert.equal(world.sheet(ward.id).currentHp + world.sheet(fighter.id).currentHp, 10, "nobody is healed until the call can finish");

  await enter(peace, second, [6, 6]);
  assert.deepEqual([world.sheet(ward.id).currentHp, world.sheet(fighter.id).currentHp].sort((a, b) => a - b), [10, 20], "2 + 3 for one, 12 + 3 for the other");
  assert.equal(world.sheet(peace.id).resources.channel_divinity.used, 1, "one use");
  assert.equal(pendingOf(peace).length, 0);
  const rolls = rollsSince(mark);
  assert.deepEqual(rolls.map((roll) => roll.total).sort((a, b) => a - b), [5, 15], `each roll on record once: ${rolls.map((roll) => `${roll.detail} = ${roll.total}`).join("; ")}`);
  assert.ok(rolls.every((roll) => roll.characterId === peace.id), "the rolls are the cleric's");
});

await test("a maneuver's temporary hit points are rolled by the fighter who spends the die: Rally", async () => {
  reset();
  setMemberRealDice(world.campaignId, master.userId, true);
  const mark = rollMark();
  const out = await world.invoke("use_resource", { characterId: master.id, resource: "Superiority Dice", variant: "rally", targetCharacterId: ward.id });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  assert.equal(pendingOf(ward).length, 0, "the one steadied was asked to roll");
  const [pending] = pendingOf(master);
  assert.ok(pending, "no roll card went to the fighter's seat");
  assert.equal(pending.expression, "1d8+2");
  assert.equal(world.sheet(ward.id).tempHp, 0);

  await enter(master, pending, [5]);
  assert.equal(world.sheet(ward.id).tempHp, 7, "5 on the d8 and Charisma's 2");
  const rolls = rollsSince(mark);
  assert.equal(rolls.length, 1, `one roll on record, not ${rolls.length}`);
  // The chronicle draws its dice cards from the turn's list: Rally's card was
  // pushed onto a copy of the turn and never reached it.
  assert.ok(getDmTurn(out.turnId).rollIds.includes(rolls[0].id), "Rally's roll is not among the turn's cards");
});

await test("a spell's temporary hit points are rolled by its caster: False Life", async () => {
  reset();
  setMemberRealDice(world.campaignId, mage.userId, true);
  const out = await world.invoke("cast_buff", { characterId: mage.id, spell: "False Life" });
  assert.equal(out.ok, true, `refused: ${out.error}`);
  assert.equal(out.result.parked, true, `the call did not wait: ${JSON.stringify(out.result).slice(0, 200)}`);
  const [pending] = pendingOf(mage);
  assert.ok(pending, "no roll card went to the wizard's seat");
  // The spell's 4 is added to the die by the cast.
  assert.equal(pending.expression, "1d4");
  assert.equal(world.sheet(mage.id).spellcasting.slots[1].used, 0, "the slot was spent before the die was in");

  await enter(mage, pending, [3]);
  assert.equal(world.sheet(mage.id).tempHp, 7, "3 on the d4 and 4");
  assert.equal(world.sheet(mage.id).spellcasting.slots[1].used, 1, "one casting, one slot");
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

// The model's own turn loop is the third door (src/lib/dm/turn.ts
// resolveModelCall): it answers one held card for each tool call, so a list
// that was a call for each creature could never have had its rolls answered.
const mira = table.addHero({
  name: "Mira", class: "cleric", level: 5, maxHp: 30, abilities: { wis: 16, con: 10 }, proficiencies: TRAINED, spellcasting: CASTING,
});
const tam = table.addHero({ name: "Tam", class: "rogue", level: 3, maxHp: 30, abilities: { dex: 16, con: 10 }, proficiencies: TRAINED });

await test("an AI Game Master's turn: one casting over two creatures waits for each roll, spends one slot, and is narrated once", async () => {
  await table.invoke("end_encounter", { outcome: "victory", reason: "the fight is over" });
  getDatabase().prepare("DELETE FROM pending_rolls WHERE campaign_id = ?").run(table.campaignId);
  setMemberRealDice(table.campaignId, brakk.userId, false);
  setMemberRealDice(table.campaignId, mira.userId, true);
  table.patch(brakk.id, { currentHp: 5 });
  table.patch(tam.id, { currentHp: 5 });
  const story = "Mira speaks one word, and it reaches them both.";
  model.script([
    reply({ calls: [modelCall("heal", { casterId: mira.id, spell: "Mass Healing Word", reason: "a word for the fallen", targets: [{ characterId: tam.id }, { characterId: brakk.id }] })] }),
    reply({ text: story }),
  ]);
  const early = await model.turn(table, "Mira casts Mass Healing Word on Tam and Brakk.", mira.id, mira.userId);
  await settleQueue(table.campaignId);
  assert.equal(early, null, "the GM narrated before the dice were in");
  const mine = () => listOpenPendingRolls(table.campaignId).filter((entry) => entry.userId === mira.userId);
  const [first, ...more] = mine();
  assert.ok(first, "no roll card went to the caster's seat");
  assert.equal(more.length, 0, "one card at a time");
  assert.equal(table.sheet(mira.id).spellcasting.slots[3].used, 0, "the slot was spent before the dice were in");

  table.signIn({ id: mira.userId });
  let landed = await call(submitRoute, "POST", { dice: [2] }, { campaignId: table.campaignId, pendingRollId: first.id });
  assert.equal(landed.status, 200, `the die was not taken: ${JSON.stringify(landed.json).slice(0, 200)}`);
  await settleQueue(table.campaignId);
  const [second] = mine();
  assert.ok(second, "the second creature's roll did not come to the caster's seat");
  assert.notEqual(second.id, first.id);
  assert.equal(table.sheet(tam.id).currentHp, 5, "nobody is healed until the casting can finish");

  landed = await call(submitRoute, "POST", { dice: [3] }, { campaignId: table.campaignId, pendingRollId: second.id });
  assert.equal(landed.status, 200, `the die was not taken: ${JSON.stringify(landed.json).slice(0, 200)}`);
  await settleQueue(table.campaignId);
  assert.equal(table.sheet(tam.id).currentHp, 10, "2 on the d4 and Wisdom's 3");
  assert.equal(table.sheet(brakk.id).currentHp, 11, "3 on the d4 and Wisdom's 3");
  assert.equal(table.sheet(mira.id).spellcasting.slots[3].used, 1, "one casting, one slot");
  const told = listRecentMessages(table.campaignId, 10).filter((entry) => entry.authorType === "dm").at(-1);
  assert.ok(told?.content.includes(story), `the GM did not narrate once the dice were in: ${told?.content}`);
});

model.close();
table.close();
finish();
