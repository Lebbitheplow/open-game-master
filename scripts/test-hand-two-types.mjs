// A spell of two damage types names both in the Hand. The engine splits Ice
// Storm's damage into bludgeoning and cold (src/lib/dm/aoe-parts.ts), but the
// card read "2d8+4d6 bludgeoning", the aim bar's Type row said bludgeoning and
// searching "cold" did not find it. Pinned here: the three SRD spells on the
// card, the aim bar and in search, dice the engine will not split, a workshop
// spell's own second type, and a one-type spell reading as it always did.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { previewRows } = await import("../src/lib/battlemap/hand-play.ts");
const { filterCards, NO_FILTER } = await import("../src/lib/battlemap/hand-groups.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
  passed += 1;
}

const sheet = (prepared = ["Ice Storm", "Flame Strike", "Meteor Swarm", "Fireball"]) => ({
  id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
  name: "Kael", race: "human", class: "wizard", subclass: "", background: "", alignment: "", gender: "",
  level: 17, xp: 0,
  abilities: { str: 10, dex: 14, con: 14, int: 18, wis: 14, cha: 12 },
  maxHp: 80, currentHp: 80, tempHp: 0, ac: 12, acOverride: false, speed: 30,
  hitDice: { die: "d6", total: 17, spent: 0 }, classes: [], hitDicePools: null,
  proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] },
  equipment: [], gold: 0, copper: 0, feats: [], features: [],
  spellcasting: { ability: "int", saveDc: 17, attackBonus: 9, slots: { 3: { max: 3, used: 0 }, 4: { max: 3, used: 0 }, 5: { max: 2, used: 0 }, 9: { max: 1, used: 0 } }, known: [], prepared, cantrips: [] },
  conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
  deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
  isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
});

const cards = deriveHand(sheet(), FRESH_TURN, {});
const card = (name) => {
  const held = cards.find((entry) => entry.name === name);
  assert.ok(held, `${name} is in the Hand`);
  return held;
};
const typeRow = (entry) => previewRows(entry, null, {}).find((row) => row.key === "Type")?.value;
const found = (query) => filterCards(cards, { ...NO_FILTER, query }).map((entry) => entry.name);

test("each die on the card names its own type", () => {
  assert.equal(card("Ice Storm").dice, "2d8 bludgeoning + 4d6 cold, DEX save");
  assert.equal(card("Flame Strike").dice, "4d6 fire + 4d6 radiant, DEX save");
  assert.equal(card("Meteor Swarm").dice, "20d6 fire + 20d6 bludgeoning, DEX save");
});

test("the dice the preview averages stay one expression", () => {
  assert.equal(card("Ice Storm").damage, "2d8+4d6");
  assert.equal(card("Ice Storm").damageType, "bludgeoning");
});

test("the aim bar's Type row names both", () => {
  assert.equal(typeRow(card("Ice Storm")), "bludgeoning and cold");
  assert.equal(typeRow(card("Flame Strike")), "fire and radiant");
  assert.equal(typeRow(card("Meteor Swarm")), "fire and bludgeoning");
});

test("searching either type finds the spell", () => {
  for (const query of ["bludgeoning", "cold"]) assert.ok(found(query).includes("Ice Storm"), query);
  for (const query of ["fire", "radiant"]) assert.ok(found(query).includes("Flame Strike"), query);
  for (const query of ["fire", "bludgeoning"]) assert.ok(found(query).includes("Meteor Swarm"), query);
  assert.ok(!found("cold").includes("Flame Strike"));
});

test("search reads the second type from the card, not only its dice line", () => {
  const bare = { ...card("Ice Storm"), dice: "" };
  assert.equal(filterCards([bare], { ...NO_FILTER, query: "cold" }).length, 1);
});

const brew = (mech) =>
  deriveHand(sheet(["Twin Bolt"]), FRESH_TURN, {
    spells: {
      "twin bolt": { level: 3, school: "evocation", castingTime: "1 action", range: "60 feet", concentration: false, desc: "A bolt of two colours.", higherLevel: "", mech },
    },
  }).find((entry) => entry.name === "Twin Bolt");
const twoTypes = { resolution: "save", save: "dex", halfOnSave: true, damageType: "acid", secondType: "thunder", area: true };

test("a workshop spell's own second type reads the same", () => {
  const twin = brew({ ...twoTypes, dice: { base: "3d6+2d8" } });
  assert.equal(twin.dice, "3d6 acid + 2d8 thunder, DEX save");
  assert.equal(typeRow(twin), "acid and thunder");
});

test("dice the engine will not split still name both types", () => {
  const twin = brew({ ...twoTypes, dice: { base: "6d6" } });
  assert.equal(twin.dice, "6d6 acid and thunder, DEX save");
  assert.equal(typeRow(twin), "acid and thunder");
});

test("a one-type spell reads exactly as before", () => {
  const fireball = card("Fireball");
  assert.equal(fireball.dice, "8d6 fire, DEX save");
  assert.equal(typeRow(fireball), "fire");
  assert.equal("secondType" in fireball, false);
  assert.ok(!found("cold").includes("Fireball"));
});

// What the cast tools add to the damage, beside the type it lands as
// (src/lib/srd/spell-damage-riders.ts): the card said only the spell's dice.
const sorcerer = (features) => ({
  ...sheet(["Ice Storm", "Fireball"]),
  class: "sorcerer",
  subclass: "Draconic Bloodline",
  abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 18 },
  spellcasting: { ...sheet().spellcasting, ability: "cha", prepared: [], known: ["Ice Storm", "Fireball"] },
  features,
});
const handOf = (owner) => deriveHand(owner, FRESH_TURN, {});
test("a cold dragon's sorcerer sees Elemental Affinity's Charisma beside Ice Storm's cold, and not on a fire spell", () => {
  const cold = handOf(sorcerer([{ name: "Dragon Ancestor: White", source: "choice", level: 1 }, { name: "Elemental Affinity", source: "class", level: 6 }]));
  assert.equal(cold.find((entry) => entry.name === "Ice Storm").dice, "2d8 bludgeoning + 4d6+4 cold, DEX save");
  assert.equal(cold.find((entry) => entry.name === "Ice Storm").damage, "2d8+4d6+4");
  assert.equal(cold.find((entry) => entry.name === "Fireball").dice, "8d6 fire, DEX save");
});
test("a red dragon's sees it on the fire, and an evoker's Intelligence rides the first type", () => {
  const red = handOf(sorcerer([{ name: "Dragon Ancestor: Red", source: "choice", level: 1 }, { name: "Elemental Affinity", source: "class", level: 6 }]));
  assert.equal(red.find((entry) => entry.name === "Fireball").dice, "8d6+4 fire, DEX save");
  const evoker = deriveHand({ ...sheet(), subclass: "School of Evocation", features: [{ name: "Empowered Evocation", source: "class", level: 10 }] }, FRESH_TURN, {});
  assert.equal(evoker.find((entry) => entry.name === "Ice Storm").dice, "2d8+4 bludgeoning + 4d6 cold, DEX save");
});

console.log(`${passed} two-type card checks passed`);
