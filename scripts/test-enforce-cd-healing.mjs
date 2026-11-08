// Three Channel Divinity options that heal spent the use and only printed
// their text for the GM: Turn the Tide, Balm of Peace and Twilight Sanctuary.
// Each is now a row of the authored table (src/lib/srd/authored-effects-channel.ts):
// the first two heal the characters in reach (heal_area), the third lays the
// sanctuary on the cleric, and a character ending a turn in it loses a charm or
// fear, or gains temporary hit points (turn_end_aura, src/lib/dm/authored-turns.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-cd-healing");
const world = await openWorld({ campaign: { maxPlayers: 16 } });
const kit = await combatKit(world);
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { directCardCall } = await import("../src/lib/dm/intent-logic.ts");
const { endTurns } = await import("../src/lib/dm/turn-end.ts");

// Level 9, every ability 16 (+3), 100 hit points.
const hero = (classId, subclass) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level: 9, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const crown = hero("paladin", "Oath of the Crown");
const peace = hero("cleric", "Peace Domain");
const twilight = hero("cleric", "Twilight Domain");
const near = hero("fighter", "Champion");
const beside = hero("fighter", "Champion");
const far = hero("fighter", "Champion");
const everyone = [crown, peace, twilight, near, beside, far];

// The holder at (5, 5); `near` 5 feet off, `beside` 25 feet off, `far` 45 feet
// off (35 feet is the Balm's reach at speed 30). Everyone's hit points as given.
async function stage(who, hp = {}) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: Object.fromEntries(everyone.map((entry) => [entry.id, entry.id === who.id ? 19 : 1])) });
  everyone.forEach((entry, at) => kit.place(entry.id, at, 0));
  kit.place(who.id, 5, 5);
  kit.place(near.id, 5, 6);
  kit.place(beside.id, 5, 10);
  kit.place(far.id, 5, 14);
  kit.place(world.enemies()[0].id, 19, 19);
  kit.giveTurn(who.id);
  for (const entry of everyone) {
    const { resources } = world.sheet(entry.id);
    world.patch(entry.id, {
      conditions: [], conditionMeta: {}, tempHp: 0, currentHp: hp[entry.id] ?? 100,
      ...(resources.channel_divinity ? { resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } } : {}),
    });
  }
}
const hpOf = (who) => world.sheet(who.id).currentHp;
const used = (who) => world.sheet(who.id).resources.channel_divinity.used;
const channel = async (who, variant, faces) => {
  world.dice(...faces);
  const out = await world.invoke("use_resource", { characterId: who.id, resource: "Channel Divinity", variant });
  world.clearDice();
  return out;
};

await test("Turn the Tide heals 1d6 + CHA to each character in 30 feet at or under half their hit points, as a bonus action.", async () => {
  await stage(crown, { [crown.id]: 50, [near.id]: 30, [beside.id]: 51, [far.id]: 20 });
  const out = await channel(crown, "turn the tide", [4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(hpOf(crown), 50 + 7, "the paladin at exactly half is healed");
  assert.equal(hpOf(near), 30 + 7);
  assert.equal(hpOf(beside), 51, "above half");
  assert.equal(hpOf(far), 20, "beyond 30 feet");
  assert.equal(used(crown), 1);
  assert.match(String(out.result.cost), /bonus action/);
});

await test("Turn the Tide raises a dying ally, and heals at least 1 hit point.", async () => {
  await stage(crown, { [near.id]: 0 });
  world.patch(crown.id, { abilities: { ...world.sheet(crown.id).abilities, cha: 4 } });
  // 1d6 - 3 on a 1 is still 1.
  const out = await channel(crown, "turn the tide", [1]);
  world.patch(crown.id, { abilities: { ...world.sheet(crown.id).abilities, cha: 16 } });
  assert.equal(out.ok, true, out.error);
  assert.equal(hpOf(near), 1);
});

await test("Turn the Tide with nobody at or under half is refused and spends nothing.", async () => {
  await stage(crown, { [near.id]: 60, [far.id]: 10 });
  const out = await channel(crown, "turn the tide", [4]);
  assert.equal(out.ok, false);
  assert.match(String(out.error), /Nothing was spent/);
  assert.equal(used(crown), 0);
  assert.equal(hpOf(far), 10);
});

await test("Balm of Peace rolls 2d6 + WIS for each other creature in the cleric's walk, and not for the cleric.", async () => {
  await stage(peace, { [peace.id]: 40, [near.id]: 40, [beside.id]: 40, [far.id]: 40 });
  const out = await channel(peace, "balm of peace", [1, 1, 6, 6]);
  assert.equal(out.ok, true, out.error);
  // One creature 2 + 3, the other 12 + 3: a roll each, whichever comes first.
  assert.deepEqual([hpOf(near) - 40, hpOf(beside) - 40].sort((a, b) => a - b), [5, 15]);
  assert.equal(hpOf(peace), 40, "the cleric heals others");
  assert.equal(hpOf(far), 40, "45 feet is beyond a 30-foot walk");
  assert.equal(used(peace), 1);
  assert.match(JSON.stringify(out.result), /opportunity attacks/);
});

await test("Balm of Peace with only the cleric hurt is refused and spends nothing.", async () => {
  await stage(peace, { [peace.id]: 10 });
  const out = await channel(peace, "balm of peace", [6, 6]);
  assert.equal(out.ok, false);
  assert.equal(used(peace), 0);
  assert.equal(hpOf(peace), 10);
});

await test("Twilight Sanctuary: a character ending a turn in 30 feet loses a fear, or gains 1d6 + cleric level temporary hit points.", async () => {
  await stage(twilight);
  const out = await channel(twilight, "twilight sanctuary", []);
  assert.equal(out.ok, true, out.error);
  assert.ok(world.sheet(twilight.id).conditions.includes("twilight sanctuary"));
  assert.equal(used(twilight), 1);
  world.patch(near.id, { conditions: ["frightened"], conditionMeta: { frightened: { rounds: 10 } } });
  const encounterId = world.encounter().id;
  world.dice(3, 3, 3, 3);
  endTurns(world.campaign(), encounterId, [near.id, beside.id, far.id, twilight.id]);
  world.clearDice();
  assert.equal(world.sheet(near.id).conditions.includes("frightened"), false, "the fear ends");
  assert.equal(world.sheet(near.id).tempHp, 0, "the fear ended instead");
  assert.equal(world.sheet(beside.id).tempHp, 3 + 9);
  assert.equal(world.sheet(twilight.id).tempHp, 3 + 9, "the cleric is in their own sphere");
  assert.equal(world.sheet(far.id).tempHp, 0, "beyond 30 feet");
});

await test("Twilight Sanctuary ends one charm of two, and gives nothing while the cleric is incapacitated.", async () => {
  await stage(twilight);
  await channel(twilight, "twilight sanctuary", []);
  world.patch(near.id, { conditions: ["charmed"], conditionMeta: { charmed: { source: "a", rounds: 10, others: [{ source: "b", rounds: 10 }] } } });
  const encounterId = world.encounter().id;
  endTurns(world.campaign(), encounterId, [near.id]);
  assert.ok(world.sheet(near.id).conditions.includes("charmed"), "the second charm holds");
  assert.equal(world.sheet(near.id).conditionMeta.charmed.others, undefined, "one instance left");
  world.patch(twilight.id, { conditions: [...world.sheet(twilight.id).conditions, "stunned"] });
  world.dice(3);
  endTurns(world.campaign(), encounterId, [beside.id]);
  world.clearDice();
  assert.equal(world.sheet(beside.id).tempHp, 0);
});

await test("Without the sanctuary, a turn's end gives no temporary hit points.", async () => {
  await stage(twilight);
  world.dice(3);
  endTurns(world.campaign(), world.encounter().id, [beside.id]);
  world.clearDice();
  assert.equal(world.sheet(beside.id).tempHp, 0);
});

await test("The Hand deals Turn the Tide and Balm of Peace as healing cards, and each card's call heals.", async () => {
  for (const [who, name, cost, dice] of [
    [crown, "Turn the Tide", "bonus", "heals 1d6+3"],
    [peace, "Balm of Peace", "action", "heals 2d6+3"],
    [twilight, "Twilight Sanctuary", "action", "twilight sanctuary"],
  ]) {
    const hand = deriveHand(world.sheet(who.id), FRESH_TURN, {}).filter((card) => card.name === name);
    assert.equal(hand.length, 1, name);
    assert.equal(hand[0].cost, cost, name);
    assert.equal(hand[0].dice, dice, name);
    await stage(who, { [near.id]: 20 });
    const call = directCardCall(hand[0].intent, who.id);
    assert.ok(call, `${name} plays with no model`);
    world.dice(2, 2, 2, 2);
    const out = await world.invoke(call.name, call.args);
    world.clearDice();
    assert.equal(out.ok, true, `${name}: ${out.error}`);
    assert.equal(used(who), 1, `${name} spends its use`);
    assert.equal(/Divine power channelled into a subclass effect/.test(JSON.stringify(out.result)), false, `${name} is resolved, not handed back as the pool's reminder`);
  }
});

finish();
