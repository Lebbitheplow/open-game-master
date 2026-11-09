// Nine Channel Divinity options spent the use and changed nothing. Each is now a
// row of the authored table (src/lib/srd/authored-effects-channel.ts), reached by
// its own name, in variant, or after the pool's name, and a refusal spends nothing.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-channel-table");
const world = await openWorld({ campaign: { maxPlayers: 16 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { AUTHORED_DATA_CHANNEL } = await import("../src/lib/srd/authored-effects-channel.ts");
const { channelOptions } = await import("../src/lib/dm/option-costs.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const { conditionEffectsFor } = await import("../src/lib/srd/condition-effects.ts");
const { authoredCheckTraits } = await import("../src/lib/srd/authored-effects.ts");
const { saveModFor } = await import("../src/lib/bestiary/enemy-numbers.ts");

const hero = (classId, subclass) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level: 9, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const light = hero("cleric", "Light Domain");
const nature = hero("cleric", "Nature Domain");
const trickery = hero("cleric", "Trickery Domain");
const order = hero("cleric", "Order Domain");
const ancients = hero("paladin", "Oath of the Ancients");
const redemption = hero("paladin", "Oath of Redemption");
const glory = hero("paladin", "Oath of Glory");
const watchers = hero("paladin", "Oath of the Watchers");
const crown = hero("paladin", "Oath of the Crown");
// The healing rows' holders (scripts/test-enforce-cd-healing.mjs tests them).
const peace = hero("cleric", "Peace Domain");
const twilight = hero("cleric", "Twilight Domain");
const everyone = [light, nature, trickery, order, ancients, redemption, glory, watchers, crown, peace, twilight];

// Two foes beside the hero and one out of 30 feet, of the types given.
async function stage(who, types = ["beast", "fiend", "beast"]) {
  await kit.endFight();
  await kit.fight(3, { heroFaces: Object.fromEntries(everyone.map((entry) => [entry.id, entry.id === who.id ? 19 : 1])) });
  const foes = world.enemies();
  foes.forEach((foe, at) => kit.setEnemy(foe.id, { maxHp: 300, currentHp: 300, stats: { ...foe.stats, type: types[at] } }));
  everyone.forEach((entry, at) => kit.place(entry.id, at, 0));
  kit.place(who.id, 5, 5);
  kit.place(foes[0].id, 5, 6);
  kit.place(foes[1].id, 6, 6);
  kit.place(foes[2].id, 19, 19);
  kit.giveTurn(who.id);
  for (const entry of everyone) {
    const { resources } = world.sheet(entry.id);
    world.patch(entry.id, { conditions: [], conditionMeta: {}, resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } });
  }
  return world.enemies();
}
const used = (who) => world.sheet(who.id).resources.channel_divinity.used;
const foe = (id) => world.enemies().find((entry) => entry.id === id);
const channel = async (who, variant, faces, more = {}) => {
  world.dice(...faces);
  const out = await world.invoke("use_resource", { characterId: who.id, resource: "Channel Divinity", variant, ...more });
  world.clearDice();
  return out;
};

await test("Radiance of the Dawn: one roll, full on a failed Constitution save, half on a success, nothing beyond 30 feet.", async () => {
  const [near, beside, far] = await stage(light);
  // The damage first (2d10: 5 + 5, + 9), then each creature's save.
  const out = await channel(light, "radiance of the dawn", [5, 5, 2, 19]);
  assert.equal(out.ok, true, out.error);
  assert.equal(foe(near.id).currentHp, 300 - 19);
  assert.equal(foe(beside.id).currentHp, 300 - 9);
  assert.equal(foe(far.id).currentHp, 300);
  assert.equal(used(light), 1);
});

await test("Radiance of the Dawn leaves a creature behind a wall, total cover from the cleric, untouched.", async () => {
  const [near, beside] = await stage(light);
  // A wall row between the cleric (5, 5) and a foe moved to (5, 8), 15 feet off.
  kit.openField(Array.from({ length: 20 }, (_, x) => [x, 7, "#"]));
  kit.place(near.id, 5, 8);
  const out = await channel(light, "radiance of the dawn", [5, 5, 2, 2]);
  assert.equal(out.ok, true, out.error);
  assert.equal(foe(near.id).currentHp, 300, "behind the wall");
  assert.equal(foe(beside.id).currentHp, 300 - 19, "in the open");
});

await test("Charm Animals and Plants charms the beast that fails, and leaves the fiend alone.", async () => {
  const [beast, fiend] = await stage(nature);
  const out = await channel(nature, "charm animals and plants", [2]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(beast.id).conditions.includes("charmed"));
  assert.equal(foe(beast.id).conditionMeta.charmed.source ?? foe(beast.id).conditionMeta.charmed.instances?.[0]?.source, nature.id);
  assert.equal(foe(fiend.id).conditions.includes("charmed"), false);
});

await test("Charm Animals and Plants with no beast or plant in reach is refused, and spends nothing.", async () => {
  await stage(nature, ["fiend", "fiend", "beast"]);
  const out = await channel(nature, "charm animals and plants", [2]);
  assert.equal(out.ok, false);
  assert.match(String(out.error), /Nothing was spent/);
  assert.equal(used(nature), 0);
});

await test("Order's Demand charms every foe in reach that fails until the end of the cleric's next turn, or damage.", async () => {
  const [near, beside, far] = await stage(order);
  const out = await channel(order, "order's demand", [2, 19]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(near.id).conditions.includes("charmed"));
  assert.equal(foe(beside.id).conditions.includes("charmed"), false);
  assert.equal(foe(far.id).conditions.includes("charmed"), false);
  const meta = foe(near.id).conditionMeta.charmed;
  assert.equal(meta.untilTurnEndOf, order.id);
  assert.equal(meta.endsOnDamage, true);
  assert.match(JSON.stringify(out.result), /drop what it is holding/);
});

await test("Cloak of Shadows makes the cleric invisible until their next turn ends, and an attack ends it.", async () => {
  const [near] = await stage(trickery);
  const out = await channel(trickery, "cloak of shadows", []);
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(trickery.id).conditions.includes("invisible"));
  assert.equal(world.sheet(trickery.id).conditionMeta.invisible.untilTurnEndOf, trickery.id);
  kit.freshTurn();
  await kit.swing(trickery.id, near.id, [15, 15, 4, 4, 4, 4]);
  assert.equal(world.sheet(trickery.id).conditions.includes("invisible"), false);
});

await test("Cloak of Shadows lasts through the turn it is used and the cleric's next turn, and ends with that turn.", async () => {
  await stage(trickery);
  const out = await channel(trickery, "cloak of shadows", []);
  assert.equal(out.ok, true, out.error);
  // The turn clock itself (src/lib/dm/turn-end.ts): the turn it is used in
  // ends, the next one begins and ends.
  const { beginTurns, endTurns } = await import("../src/lib/dm/turn-end.ts");
  const encounterId = world.encounter().id;
  endTurns(world.campaign(), encounterId, [trickery.id]);
  assert.ok(world.sheet(trickery.id).conditions.includes("invisible"), "still invisible after the turn it was used");
  beginTurns(world.campaign(), encounterId, [trickery.id]);
  assert.ok(world.sheet(trickery.id).conditions.includes("invisible"), "invisible through the next turn");
  endTurns(world.campaign(), encounterId, [trickery.id]);
  assert.equal(world.sheet(trickery.id).conditions.includes("invisible"), false, "gone when that turn ends");
});

await test("Out of a fight, an area option is paid for and left to the GM's story.", async () => {
  await kit.endFight();
  const { resources } = world.sheet(nature.id);
  world.patch(nature.id, { resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } });
  const out = await world.invoke("use_resource", { characterId: nature.id, resource: "Charm Animals and Plants" });
  assert.equal(out.ok, true, out.error);
  assert.match(JSON.stringify(out.result), /no fight/);
  assert.equal(used(nature), 1);
});

await test("Nature's Wrath restrains a creature within 10 feet on a failed save, which it rolls with its better of Strength and Dexterity.", async () => {
  const [near, , far] = await stage(ancients);
  kit.setEnemy(near.id, { stats: { ...foe(near.id).stats, saveMods: { dex: 9, str: -4 } } });
  assert.ok(saveModFor(foe(near.id).stats, "dex") > saveModFor(foe(near.id).stats, "str"), "the set-up gives it the better Dexterity");
  const out = await channel(ancients, "nature's wrath", [2], { targetEnemyId: near.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(near.id).conditions.includes("restrained"));
  assert.equal(foe(near.id).conditionMeta.restrained.saveEnds.ability, "dex");
  const refused = await channel(ancients, "nature's wrath", [2], { targetEnemyId: far.id });
  assert.equal(refused.ok, false);
  assert.equal(used(ancients), 1);
});

await test("Nature's Wrath's save to break free is the creature's pick each time: restrained, it rolls Strength, not Dexterity at disadvantage.", async () => {
  const [near] = await stage(ancients);
  // Dexterity is a shade better on the first save; restrained, Strength is the
  // likelier of the two (Dexterity saves are then at disadvantage).
  kit.setEnemy(near.id, { stats: { ...foe(near.id).stats, saveMods: { dex: 9, str: 8 } } });
  const out = await channel(ancients, "nature's wrath", [2], { targetEnemyId: near.id });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(foe(near.id).conditionMeta.restrained.saveEnds, { ability: "dex", dc: 15, or: "str" });
  const { conditionNote } = await import("../src/lib/battlemap/condition-notes.ts");
  assert.match(JSON.stringify(conditionNote("restrained", foe(near.id).conditionMeta.restrained, () => null, near.id)), /DEX or STR 15/);
  // Its turn ends: a 7 is 15 on Strength and frees it; Dexterity at
  // disadvantage would keep the 1 and hold it.
  const { endTurnSaves } = await import("../src/lib/dm/condition-tick.ts");
  world.dice(7, 1);
  endTurnSaves(world.campaign(), world.encounter(), [near.id]);
  world.clearDice();
  assert.equal(foe(near.id).conditions.includes("restrained"), false, "free on Strength");
});

await test("Emissary of Peace is a bonus action that adds 5 to Persuasion checks, and only those.", async () => {
  await stage(redemption);
  const out = await channel(redemption, "emissary of peace", []);
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(redemption.id).conditions.includes("emissary of peace"));
  assert.match(JSON.stringify(out.result), /bonus action/);
  assert.deepEqual(conditionEffectsFor("emissary of peace").skillBonus, { skill: "persuasion", bonus: 5 });
});

await test("Peerless Athlete gives advantage on Athletics and Acrobatics only while it lasts.", async () => {
  await stage(glory);
  const has = (skill) => authoredCheckTraits(world.sheet(glory.id)).some((entry) => entry.skills?.includes(skill));
  assert.equal(has("athletics"), false);
  const out = await channel(glory, "peerless athlete", []);
  assert.equal(out.ok, true, out.error);
  assert.equal(has("athletics"), true);
  assert.equal(has("acrobatics"), true);
});

await test("Watcher's Will reaches the paladin and their Charisma modifier in allies within 30 feet, and gives advantage on mental saves.", async () => {
  await stage(watchers);
  for (const [at, entry] of [light, nature, trickery, order, ancients].entries()) kit.place(entry.id, 4, 3 + at);
  const out = await channel(watchers, "watcher's will", []);
  assert.equal(out.ok, true, out.error);
  const blessed = everyone.filter((entry) => world.sheet(entry.id).conditions.includes("watcher's will"));
  assert.ok(blessed.some((entry) => entry.id === watchers.id));
  assert.equal(blessed.length, 4, "the paladin and +3 Charisma in allies");
  assert.ok(conditionEffectsFor("watcher's will").advantageOn.some((entry) => entry.kind === "save" && entry.ability === "wis"));
});

await test("Champion Challenge marks the foes in reach that fail, as a bonus action.", async () => {
  const [near, beside, far] = await stage(crown);
  const out = await channel(crown, "champion challenge", [2, 19]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(near.id).conditions.includes("champion challenge"));
  assert.equal(foe(beside.id).conditions.includes("champion challenge"), false);
  assert.equal(foe(far.id).conditions.includes("champion challenge"), false);
});

// Champion Challenge has no count of rounds: it ends when the paladin is
// incapacitated or dies, or the creature is more than 30 feet away (SCAG, Oath of
// the Crown). Checked as each turn ends (src/lib/dm/condition-leash.ts).
async function challenged() {
  const [near, beside] = await stage(crown);
  const out = await channel(crown, "champion challenge", [2, 2]);
  assert.equal(out.ok, true, out.error);
  return [near, beside];
}
const held = (id) => foe(id).conditions.includes("champion challenge");
const turnEnds = async () => {
  const { endTurns } = await import("../src/lib/dm/turn-end.ts");
  endTurns(world.campaign(), world.encounter().id, [crown.id]);
};

await test("Champion Challenge counts no rounds, and holds through a turn's end while the paladin stands within 30 feet.", async () => {
  const [near] = await challenged();
  const meta = foe(near.id).conditionMeta["champion challenge"];
  assert.equal(meta.rounds, undefined, "no count of rounds");
  assert.equal(meta.leashFeet, 30);
  kit.place(near.id, 5, 11);
  await turnEnds();
  assert.ok(held(near.id), "30 feet away still holds");
});

await test("Champion Challenge ends on a creature more than 30 feet away, and only on that one.", async () => {
  const [near, beside] = await challenged();
  kit.place(near.id, 5, 12);
  await turnEnds();
  assert.equal(held(near.id), false, "35 feet away is let go");
  assert.ok(held(beside.id), "the one beside the paladin stays challenged");
});

await test("Champion Challenge ends when the paladin is incapacitated.", async () => {
  const [near, beside] = await challenged();
  world.patch(crown.id, { conditions: ["stunned"], conditionMeta: { stunned: { rounds: 1 } } });
  await turnEnds();
  assert.equal(held(near.id), false);
  assert.equal(held(beside.id), false);
});

await test("Champion Challenge ends when the paladin drops to 0 hit points.", async () => {
  const [near] = await challenged();
  world.patch(crown.id, { currentHp: 0 });
  await turnEnds();
  assert.equal(held(near.id), false);
  world.patch(crown.id, { currentHp: 100 });
});

await test("A row is reached by its own name, by variant, and after the pool's name, and a spent pool refuses all three.", async () => {
  await stage(glory);
  const forms = [{ resource: "Peerless Athlete" }, { resource: "Channel Divinity", variant: "peerless athlete" }, { resource: "Channel Divinity: Peerless Athlete" }];
  for (const form of forms) {
    kit.giveTurn(glory.id);
    world.patch(glory.id, { conditions: [], conditionMeta: {} });
    kit.freshTurn();
    const { resources } = world.sheet(glory.id);
    world.patch(glory.id, { resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } });
    const out = await world.invoke("use_resource", { characterId: glory.id, ...form });
    assert.equal(out.ok, true, `${JSON.stringify(form)}: ${out.error}`);
    assert.ok(world.sheet(glory.id).conditions.includes("peerless athlete"), JSON.stringify(form));
    const dry = await world.invoke("use_resource", { characterId: glory.id, ...form });
    assert.equal(dry.ok, false, JSON.stringify(form));
  }
});

await test("An option another subclass holds deals no damage from this sheet's use.", async () => {
  await stage(glory);
  world.dice(5, 5, 2, 2);
  await world.invoke("use_resource", { characterId: glory.id, resource: "Channel Divinity", variant: "radiance of the dawn" });
  world.clearDice();
  assert.equal(world.enemies().every((entry) => entry.currentHp === 300), true);
});

await test("An option's name under another pool does not reach the row.", async () => {
  await stage(glory);
  await world.invoke("use_resource", { characterId: glory.id, resource: "Divine Sense", variant: "peerless athlete" });
  assert.equal(world.sheet(glory.id).conditions.includes("peerless athlete"), false);
  assert.equal(used(glory), 0);
});

await test("The Hand deals each row once, with its cost and aim, and the card's call reaches the row.", async () => {
  for (const [who, name, cost, target] of [
    [light, "Radiance of the Dawn", "action", "none"],
    [ancients, "Nature's Wrath", "action", "enemy"],
    [glory, "Peerless Athlete", "bonus", "self"],
    [crown, "Champion Challenge", "bonus", "enemy"],
  ]) {
    const hand = deriveHand(world.sheet(who.id), FRESH_TURN, {}).filter((card) => card.name === name);
    assert.equal(hand.length, 1, name);
    assert.equal(hand[0].cost, cost, name);
    assert.equal(hand[0].target, target, name);
    // Played with no model: the card's own call, sent as it is, reaches the row.
    const [near] = await stage(who);
    const call = directCardCall({ ...hand[0].intent, ...(target === "enemy" ? { targetKind: "enemy", targetId: near.id } : {}) }, who.id);
    assert.ok(call, `${name} plays with no model`);
    world.dice(2, 2, 2, 2);
    const out = await world.invoke(call.name, call.args);
    world.clearDice();
    assert.equal(out.ok, true, `${name}: ${out.error}`);
    assert.equal(used(who), 1, `${name} spends its use`);
    assert.equal(/A subclass effect\. In a fight, name the option/.test(JSON.stringify(out.result)), false, `${name} is resolved, not handed back as the pool's reminder`);
  }
});

await test("Every row's action matches the option's cost, and names an option its subclass holds.", async () => {
  const words = { action: "action", bonus: "bonus", none: "none" };
  for (const [key, entry] of Object.entries(AUTHORED_DATA_CHANNEL)) {
    const who = everyone.find((one) => world.sheet(one.id).subclass === entry.subclass);
    assert.ok(who, key);
    const held = channelOptions(world.sheet(who.id)).find((option) => option.name === entry.spends[0].name);
    assert.ok(held, `${key} is not held by ${entry.subclass}`);
    assert.equal(entry.spends[0].action, words[held.cost], key);
  }
});

finish();
