// Nature's Wrath takes "a creature you can see", but the engine asked only the
// board's line of sight: an invisible goblin 5 feet away was taken, the Channel
// Divinity spent and a save rolled. A creature the paladin cannot see because it
// is invisible or hidden, or because the paladin is blinded, is now refused before
// anything is spent, as are the other options whose text says "you can see"
// (Champion Challenge, Conquering Presence, Abjure Enemy). Those that take a
// creature "that can see you" (Charm Animals and Plants, Dreadful Aspect) still
// take an invisible one.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-channel-unseen");
const world = await openWorld({ campaign: { maxPlayers: 12 } });
const kit = await combatKit(world);

const hero = (classId, subclass) =>
  world.addHero({
    user: world.owner, class: classId, subclass, level: 9, maxHp: 100, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 16, con: 16, int: 16, wis: 16, cha: 16 }, portrait: { url: "/uploads/test.png" },
  });
const ancients = hero("paladin", "Oath of the Ancients");
const crown = hero("paladin", "Oath of the Crown");
const conquest = hero("paladin", "Oath of Conquest");
const vengeance = hero("paladin", "Oath of Vengeance");
const oathbreaker = hero("paladin", "Oathbreaker");
const nature = hero("cleric", "Nature Domain");
const everyone = [ancients, crown, conquest, vengeance, oathbreaker, nature];

// Two beasts beside the hero, the first of them invisible, in the open: the
// board's line of sight reaches both.
async function stage(who, heroConditions = []) {
  await kit.endFight();
  await kit.fight(2, { heroFaces: Object.fromEntries(everyone.map((entry) => [entry.id, entry.id === who.id ? 19 : 1])) });
  const foes = world.enemies();
  foes.forEach((foe) => kit.setEnemy(foe.id, { maxHp: 300, currentHp: 300, stats: { ...foe.stats, type: "beast", speed: "30 ft." } }));
  everyone.forEach((entry, at) => kit.place(entry.id, at, 0));
  kit.place(who.id, 5, 5);
  kit.place(foes[0].id, 5, 6);
  kit.place(foes[1].id, 6, 6);
  kit.setEnemy(foes[0].id, { conditions: ["invisible"], conditionMeta: {} });
  kit.giveTurn(who.id);
  const { resources } = world.sheet(who.id);
  world.patch(who.id, { conditions: heroConditions, conditionMeta: {}, resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } });
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

await test("Nature's Wrath is refused on an invisible goblin 5 feet away, and spends nothing.", async () => {
  const [unseen, seen] = await stage(ancients);
  const out = await channel(ancients, "nature's wrath", [2], { targetEnemyId: unseen.id });
  assert.equal(out.ok, false, "the invisible creature is taken");
  assert.equal(out.refused, "rules");
  assert.match(String(out.error), /cannot see .*invisible.*Nothing was spent/);
  assert.equal(used(ancients), 0);
  assert.equal(foe(unseen.id).conditions.includes("restrained"), false);
  // The one beside it, seen, is taken: the refusal is the invisibility's.
  const taken = await channel(ancients, "nature's wrath", [2], { targetEnemyId: seen.id });
  assert.equal(taken.ok, true, taken.error);
  assert.ok(foe(seen.id).conditions.includes("restrained"));
  assert.equal(used(ancients), 1);
});

await test("Nature's Wrath is refused on a hidden creature too.", async () => {
  const [, seen] = await stage(ancients);
  kit.setEnemy(seen.id, { conditions: ["hidden"], conditionMeta: {} });
  const out = await channel(ancients, "nature's wrath", [2], { targetEnemyId: seen.id });
  assert.equal(out.ok, false);
  assert.match(String(out.error), /hidden/);
  assert.equal(used(ancients), 0);
});

await test("A blinded paladin's Nature's Wrath is refused on any creature, and spends nothing.", async () => {
  const [, seen] = await stage(ancients, ["blinded"]);
  const out = await channel(ancients, "nature's wrath", [2], { targetEnemyId: seen.id });
  assert.equal(out.ok, false);
  assert.match(String(out.error), /blinded/);
  assert.equal(used(ancients), 0);
  assert.equal(foe(seen.id).conditions.includes("restrained"), false);
});

await test("See Invisibility lets the paladin take the invisible goblin.", async () => {
  const [unseen] = await stage(ancients, ["see invisibility"]);
  const out = await channel(ancients, "nature's wrath", [2], { targetEnemyId: unseen.id });
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(unseen.id).conditions.includes("restrained"));
});

await test("Champion Challenge takes the beast the paladin can see and leaves the invisible one.", async () => {
  const [unseen, seen] = await stage(crown);
  const out = await channel(crown, "champion challenge", [2, 2]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(seen.id).conditions.includes("champion challenge"));
  assert.equal(foe(unseen.id).conditions.includes("champion challenge"), false);
});

await test("Conquering Presence frightens the beast the paladin can see and leaves the invisible one.", async () => {
  const [unseen, seen] = await stage(conquest);
  const out = await channel(conquest, "conquering presence", [2, 2]);
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(seen.id).conditions.includes("frightened"));
  assert.equal(foe(unseen.id).conditions.includes("frightened"), false);
});

await test("Abjure Enemy is refused on an invisible creature, and spends nothing.", async () => {
  const [unseen] = await stage(vengeance);
  const out = await channel(vengeance, "abjure enemy", [2], { targetEnemyId: unseen.id });
  assert.equal(out.ok, false);
  assert.match(String(out.error), /cannot see .*invisible.*not spent/);
  assert.equal(used(vengeance), 0);
  assert.equal(foe(unseen.id).conditions.includes("frightened"), false);
});

await test("Dreadful Aspect and Charm Animals and Plants still take the invisible beast, which can see the user.", async () => {
  const [unseen] = await stage(oathbreaker);
  const fear = await channel(oathbreaker, "dreadful aspect", [2, 2]);
  assert.equal(fear.ok, true, fear.error);
  assert.ok(foe(unseen.id).conditions.includes("frightened"));
  const [beast] = await stage(nature);
  const charm = await channel(nature, "charm animals and plants", [2, 2]);
  assert.equal(charm.ok, true, charm.error);
  assert.ok(foe(beast.id).conditions.includes("charmed"));
});

finish();
