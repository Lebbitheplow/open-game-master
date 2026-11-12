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
const rogue = hero("rogue", "Thief");
const watchers = hero("paladin", "Oath of the Watchers");
const everyone = [ancients, crown, conquest, vengeance, oathbreaker, nature, rogue, watchers];

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

// The other way round: Charm Animals and Plants and Dreadful Aspect take a
// creature that can see the user. A blinded one cannot, and none can see an
// invisible user unless a sense of its own reaches her.
await test("Charm Animals and Plants leaves a blinded beast out, and an invisible cleric charms only the beast whose blindsight reaches her.", async () => {
  const [unseen, seen] = await stage(nature);
  kit.setEnemy(seen.id, { conditions: ["blinded"], conditionMeta: {} });
  const charm = await channel(nature, "charm animals and plants", [2, 2]);
  assert.equal(charm.ok, true, charm.error);
  assert.ok(foe(unseen.id).conditions.includes("charmed"), "the invisible beast can still see the cleric");
  assert.equal(foe(seen.id).conditions.includes("charmed"), false, "the blinded beast was charmed");
  const [plain, bat] = await stage(nature, ["invisible"]);
  kit.setEnemy(bat.id, { stats: { ...foe(bat.id).stats, senses: { blindsight: 30 } } });
  const hidden = await channel(nature, "charm animals and plants", [2, 2]);
  assert.equal(hidden.ok, true, hidden.error);
  assert.ok(foe(bat.id).conditions.includes("charmed"), "blindsight reaches the invisible cleric");
  assert.equal(foe(plain.id).conditions.includes("charmed"), false, "a beast that cannot see the invisible cleric was charmed");
});

await test("Dreadful Aspect leaves out a blinded creature, which cannot see the oathbreaker.", async () => {
  const [unseen, seen] = await stage(oathbreaker);
  kit.setEnemy(seen.id, { conditions: ["blinded"], conditionMeta: {} });
  const fear = await channel(oathbreaker, "dreadful aspect", [2, 2]);
  assert.equal(fear.ok, true, fear.error);
  assert.ok(foe(unseen.id).conditions.includes("frightened"));
  assert.equal(foe(seen.id).conditions.includes("frightened"), false);
});

await test("Vow of Enmity is refused on an invisible creature, and spends nothing.", async () => {
  const [unseen, seen] = await stage(vengeance);
  const out = await channel(vengeance, "vow of enmity", [], { targetEnemyId: unseen.id });
  assert.equal(out.ok, false, "the invisible creature was vowed against");
  assert.match(String(out.error), /cannot see .*invisible.*Nothing was spent/);
  assert.equal(used(vengeance), 0);
  const vowed = await channel(vengeance, "vow of enmity", [], { targetEnemyId: seen.id });
  assert.equal(vowed.ok, true, vowed.error);
});

await test("Blindsight that reaches the goblin lets a blinded paladin take it with Nature's Wrath, invisible or not.", async () => {
  const before = world.sheet(ancients.id).features;
  world.patch(ancients.id, { features: [...before, { name: "Blindsight 10 ft", source: "race" }] });
  const [unseen] = await stage(ancients, ["blinded"]);
  const out = await channel(ancients, "nature's wrath", [2], { targetEnemyId: unseen.id });
  world.patch(ancients.id, { features: before });
  assert.equal(out.ok, true, out.error);
  assert.ok(foe(unseen.id).conditions.includes("restrained"));
});

// Reactions whose text says "an attacker that you can see" read the same
// conditions; the attack gives a hidden attacker away, so hiding does not count.
const enemyHits = async (enemy, faces) => {
  kit.freshRound();
  world.dice(...faces);
  const out = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: rogue.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.hit, true, "the attack missed");
};
const dodge = () => world.invoke("use_reaction", { characterId: rogue.id, feature: "Uncanny Dodge" });

await test("Uncanny Dodge is refused against an invisible attacker and while the rogue is blinded, and is used against a hidden one.", async () => {
  const [unseen, seen] = await stage(rogue);
  await enemyHits(unseen, [18, 18, 4]);
  const out = await dodge();
  assert.equal(out.ok, false, "Uncanny Dodge answered an invisible attacker");
  assert.match(String(out.error), /cannot see .*invisible.*Nothing was spent/);
  await enemyHits(seen, [18, 18, 4]);
  world.patch(rogue.id, { conditions: ["blinded"], conditionMeta: {} });
  const blind = await dodge();
  assert.equal(blind.ok, false, "a blinded rogue used Uncanny Dodge");
  assert.match(String(blind.error), /blinded/);
  world.patch(rogue.id, { conditions: [], conditionMeta: {} });
  kit.setEnemy(seen.id, { conditions: ["hidden"], conditionMeta: {} });
  const hidden = await dodge();
  assert.equal(hidden.ok, true, hidden.error);
});

// Watcher's Will: "up to a number of creatures equal to your Charisma
// modifier that you can see within 30 feet". It took the first allies in
// reach, seen or not.
await test("Watcher's Will leaves out an invisible ally, takes those the paladin sees, and refuses one named that it cannot see, spending nothing.", async () => {
  await stage(watchers);
  everyone.forEach((entry) => entry.id !== watchers.id && world.patch(entry.id, { conditions: [], conditionMeta: {} }));
  world.patch(ancients.id, { conditions: ["invisible"], conditionMeta: {} });
  const named = await channel(watchers, "watcher's will", [], { targetCharacterId: ancients.id });
  assert.equal(named.ok, false, "an invisible ally named for it was taken");
  assert.match(String(named.error), /cannot see .*invisible.*Nothing was spent/);
  assert.equal(used(watchers), 0);
  const out = await channel(watchers, "watcher's will", []);
  assert.equal(out.ok, true, out.error);
  const willed = (who) => world.sheet(who.id).conditions.includes("watcher's will");
  assert.equal(willed(ancients), false, "the invisible ally took Watcher's Will");
  assert.ok(willed(watchers), "the paladin takes it");
  assert.equal(everyone.filter((entry) => entry.id !== watchers.id && willed(entry)).length, 3, "three seen allies for a +3 Charisma");
  assert.match(JSON.stringify(out.result), /left out/);
  world.patch(ancients.id, { conditions: [], conditionMeta: {} });
});

// The Hand deals a reaction only for a creature its player sees, by the board
// view's `unseen` list: it reads the same conditions, so a blinded rogue is
// not offered a card the engine would refuse.
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
await test("A blinded rogue's board view lists the goblin beside her as unseen, so no Uncanny Dodge card is dealt for it.", async () => {
  const [, seen] = await stage(rogue);
  assert.equal(buildPlayerMapView(world.campaignId, world.owner.id).unseen.includes(seen.id), false, "seen in the open");
  world.patch(rogue.id, { conditions: ["blinded"], conditionMeta: {} });
  assert.ok(buildPlayerMapView(world.campaignId, world.owner.id).unseen.includes(seen.id), "a blinded rogue still sees the goblin");
  world.patch(rogue.id, { conditions: [], conditionMeta: {} });
});

finish();
