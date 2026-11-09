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
const { coverFor } = await import("../src/lib/dm/attack-spatial.ts");
const { healCasterHalf } = await import("../src/lib/dm/spell-attack-riders.ts");
const { regainHitPoints } = await import("../src/lib/dm/regain.ts");

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
const life = hero("cleric", "Life Domain");
// Twilight Shroud comes at 17th level.
const shroud = world.addHero({
  user: world.owner, class: "cleric", subclass: "Twilight Domain", level: 17, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
  abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
});
const everyone = [crown, peace, twilight, near, beside, far, life, shroud];

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
    assert.equal(/A subclass effect\. In a fight, name the option/.test(JSON.stringify(out.result)), false, `${name} is resolved, not handed back as the pool's reminder`);
  }
});

// ---- found in review: the walk, the heal rules, the sanctuary's end, the shroud ----

await test("Balm of Peace walks one path: of two allies 30 feet off in opposite directions it reaches one, and the cleric's token ends beside them with the turn's movement untouched.", async () => {
  await stage(peace, { [near.id]: 40, [beside.id]: 40 });
  kit.place(peace.id, 8, 8);
  kit.place(near.id, 8, 2);
  kit.place(beside.id, 8, 14);
  const out = await channel(peace, "balm of peace", [6, 6, 6, 6]);
  assert.equal(out.ok, true, out.error);
  const healed = [near, beside].filter((who) => hpOf(who) > 40);
  assert.equal(healed.length, 1, "one walk of 30 feet cannot come within 5 feet of both");
  const at = kit.token(peace.id);
  const by = kit.token(healed[0].id);
  assert.ok(Math.max(Math.abs(at.x - by.x), Math.abs(at.y - by.y)) <= 1, `the cleric ends beside ${healed[0].name} (${at.x},${at.y})`);
  assert.equal(at.movedThisRound, 0, "the walk is the feature's, not the turn's movement");
});

await test("Turn the Tide leaves out a character Chill Touch grips or who is deafened; with nobody else hurt, nothing is spent.", async () => {
  for (const condition of ["chill touch", "deafened"]) {
    await stage(crown, { [near.id]: 20 });
    world.patch(near.id, { conditions: [condition], conditionMeta: { [condition]: { rounds: 10 } } });
    const out = await channel(crown, "turn the tide", [4]);
    assert.equal(out.ok, false, condition);
    assert.equal(used(crown), 0, condition);
    assert.equal(hpOf(near), 20, condition);
  }
});

await test("Preserve Life passes over a character Chill Touch grips and heals the next.", async () => {
  await stage(life, { [near.id]: 10, [beside.id]: 10 });
  world.patch(near.id, { conditions: ["chill touch"], conditionMeta: { "chill touch": { rounds: 10 } } });
  const out = await channel(life, "preserve life", []);
  assert.equal(out.ok, true, out.error);
  assert.equal(hpOf(near), 10, "gripped");
  assert.equal(hpOf(beside), 50, "healed up to half");
});

await test("Twilight Sanctuary ends when its cleric is incapacitated: stunned for a round, the sphere does not come back.", async () => {
  await stage(twilight);
  await channel(twilight, "twilight sanctuary", []);
  const encounterId = world.encounter().id;
  world.patch(twilight.id, { conditions: [...world.sheet(twilight.id).conditions, "stunned"] });
  endTurns(world.campaign(), encounterId, [near.id]);
  assert.equal(world.sheet(twilight.id).conditions.includes("twilight sanctuary"), false, "ended");
  world.patch(twilight.id, { conditions: world.sheet(twilight.id).conditions.filter((entry) => entry !== "stunned") });
  world.dice(3);
  endTurns(world.campaign(), encounterId, [beside.id]);
  world.clearDice();
  assert.equal(world.sheet(beside.id).tempHp, 0);
});

await test("Twilight Shroud gives the cleric and allies in the sanctuary half cover, and nobody outside it, with the cleric stunned, or below 17th level.", async () => {
  await stage(shroud);
  const [enemy] = world.enemies();
  kit.place(enemy.id, 12, 6);
  const encounterId = world.encounter().id;
  const lay = (who) => world.patch(who.id, { conditions: ["twilight sanctuary"], conditionMeta: { "twilight sanctuary": { rounds: 10 } } });
  assert.equal(coverFor(encounterId, enemy.id, near.id), 0, "no sanctuary");
  lay(shroud);
  assert.equal(coverFor(encounterId, enemy.id, near.id), 2, "an ally inside");
  assert.equal(coverFor(encounterId, enemy.id, shroud.id), 2, "the cleric");
  assert.equal(coverFor(encounterId, enemy.id, far.id), 0, "45 feet off");
  world.patch(shroud.id, { conditions: ["twilight sanctuary", "stunned"] });
  assert.equal(coverFor(encounterId, enemy.id, near.id), 0, "the cleric stunned");
  world.patch(shroud.id, { conditions: [], conditionMeta: {} });
  kit.place(twilight.id, 5, 5);
  kit.place(shroud.id, 0, 17);
  lay(twilight);
  assert.equal(coverFor(encounterId, enemy.id, near.id), 0, "a 9th-level cleric has no shroud");
});

await test("Vampiric Touch's half of the damage is healing like any other: a caster Chill Touch grips regains none of it.", async () => {
  await stage(near, { [near.id]: 50 });
  world.patch(near.id, { conditions: ["chill touch"], conditionMeta: { "chill touch": { rounds: 10 } } });
  assert.equal(healCasterHalf(world.campaign(), near.id, 20, "Vampiric Touch"), null);
  assert.equal(hpOf(near), 50, "gripped");
  world.patch(near.id, { conditions: [], conditionMeta: {} });
  assert.match(String(healCasterHalf(world.campaign(), near.id, 20, "Vampiric Touch")), /regains 10 hit points/);
  assert.equal(hpOf(near), 60);
});

// ---- regain.ts: a beast form and exhaustion ----

await test("Healing a druid in a beast form heals the beast, never past its maximum, and leaves the druid's own hit points alone.", async () => {
  await stage(crown);
  world.patch(near.id, { currentHp: 100, wildShape: { form: "Brown Bear", beastHp: 10, beastMaxHp: 34, beastAc: 11 } });
  assert.equal(regainHitPoints(world.campaign(), null, world.sheet(near.id), 15, "test"), 15);
  assert.equal(world.sheet(near.id).wildShape.beastHp, 25);
  assert.equal(hpOf(near), 100, "the druid's own hit points");
  assert.equal(regainHitPoints(world.campaign(), null, world.sheet(near.id), 50, "test"), 9, "up to the beast's 34");
  assert.equal(world.sheet(near.id).wildShape.beastHp, 34);
  world.patch(near.id, { wildShape: null });
});

await test("Turn the Tide reads a beast form's hit points: a bear at 10 of 34 is healed though the druid's own are full, and a druid low but in a whole bear is not.", async () => {
  await stage(crown);
  world.patch(near.id, { currentHp: 100, wildShape: { form: "Brown Bear", beastHp: 10, beastMaxHp: 34, beastAc: 11 } });
  world.patch(beside.id, { currentHp: 20, wildShape: { form: "Brown Bear", beastHp: 34, beastMaxHp: 34, beastAc: 11 } });
  const out = await channel(crown, "turn the tide", [4]);
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(near.id).wildShape.beastHp, 17, "the bear regains 1d6 + 3");
  assert.equal(hpOf(near), 100);
  assert.equal(world.sheet(beside.id).wildShape.beastHp, 34);
  assert.equal(hpOf(beside), 20, "the druid's own hit points wait for the form to end");
  world.patch(near.id, { wildShape: null });
  world.patch(beside.id, { wildShape: null });
});

await test("Exhaustion 4 halves the most healing can bring: 30 points heal a 100-hit-point character at 40 only to 50.", async () => {
  await stage(crown);
  world.patch(near.id, { currentHp: 40, exhaustion: 4 });
  assert.equal(regainHitPoints(world.campaign(), null, world.sheet(near.id), 30, "test"), 10);
  assert.equal(hpOf(near), 50);
  world.patch(near.id, { currentHp: 100, exhaustion: 0 });
});

finish();
