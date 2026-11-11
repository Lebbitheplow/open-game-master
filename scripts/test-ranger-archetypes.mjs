// The ranger archetype rules the divine ledger's second wave built, driven
// pure (scripts/clauses/divine.json holds the table runs): the attacks a
// turn's record adds (Dread Ambusher, Stalker's Flurry, Distant Strike), a
// cone's one opening (Drake's Breath), the companion's and the drake's
// records (Ranger's Companion, Bond of Fang and Scale, Perfected Bond), and
// a modifier on another ability's checks (Otherworldly Glamour).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { turnExtraAttacks, distantStrikeRefusal, ambushAttackDie } = await import("../src/lib/dm/turn-extra-attacks-logic.ts");
const { fitsOneCone } = await import("../src/lib/dm/cone-logic.ts");
const { buildPet, PET_DODGING } = await import("../src/lib/dm/pet-build.ts");
const { authoredCheckMod } = await import("../src/lib/srd/authored-check-mod.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  passed += 1;
}

const holder = (...names) => ({ name: "Vex", features: names.map((name) => ({ name })), feats: [] });
const turn = (...struck) => ({ struck });

test("Dread Ambusher adds an attack on the first round only, and its 1d8 rides the attack past the action's own", () => {
  const ranger = holder("Dread Ambusher");
  assert.equal(turnExtraAttacks(ranger, turn(), 1), 1);
  assert.equal(turnExtraAttacks(ranger, turn(), 2), 0);
  assert.equal(ambushAttackDie(ranger, 1, 0, 1), null, "the action's own first attack rides no 1d8");
  assert.equal(ambushAttackDie(ranger, 1, 1, 1), "1d8");
  assert.equal(ambushAttackDie(ranger, 2, 1, 1), null);
});

test("Stalker's Flurry gives one more attack after a miss, once a turn", () => {
  const ranger = holder("Stalker's Flurry");
  assert.equal(turnExtraAttacks(ranger, turn({ target: "Goblin", hit: true }), 2), 0);
  assert.equal(turnExtraAttacks(ranger, turn({ target: "Goblin", hit: false }), 2), 1);
  assert.equal(turnExtraAttacks(ranger, turn({ target: "Goblin", hit: false }, { target: "Goblin", hit: false }), 2), 1, "two misses still give one");
});

test("Distant Strike's attack comes after two creatures are attacked, and goes at a third", () => {
  const ranger = holder("Distant Strike");
  const one = turn({ target: "Goblin 1", hit: true }, { target: "Goblin 1", hit: true });
  const two = turn({ target: "Goblin 1", hit: true }, { target: "Goblin 2", hit: false });
  assert.equal(turnExtraAttacks(ranger, one, 2), 0);
  assert.equal(turnExtraAttacks(ranger, two, 2), 1);
  assert.match(distantStrikeRefusal(ranger, two, 2, 2, 2, "Goblin 1") ?? "", /third creature/);
  assert.equal(distantStrikeRefusal(ranger, two, 2, 2, 2, "Goblin 3"), null);
  assert.equal(distantStrikeRefusal(ranger, two, 2, 1, 2, "Goblin 1"), null, "the action's own second attack may go anywhere");
});

test("a cone holds creatures along one line and refuses two on opposite sides", () => {
  const origin = { x: 5, y: 5 };
  assert.equal(fitsOneCone(origin, [{ x: 5, y: 11 }, { x: 6, y: 10 }]), true);
  assert.equal(fitsOneCone(origin, [{ x: 5, y: 11 }, { x: 5, y: 0 }]), false);
  assert.equal(fitsOneCone(origin, [{ x: 5, y: 11 }, { x: 11, y: 5 }]), false, "a quarter turn apart is wider than a cone");
  assert.equal(fitsOneCone(origin, [{ x: 5, y: 11 }]), true);
});

const ranger = (level, subclass, features = []) => ({
  name: "Vex",
  class: "ranger",
  subclass,
  level,
  classes: [{ id: "ranger", level, subclass }],
  features: features.map((name) => ({ name })),
  feats: [],
  pets: [],
  spellcasting: null,
});

test("a companion's saves and skills carry the ranger's proficiency bonus, and it starts dodging", () => {
  const wolf = buildPet(ranger(3, "Beast Master"), { kind: "beast_companion", form: "wolf" }, { blockSkills: () => ({ perception: 3, stealth: 4 }) });
  assert.deepEqual(wolf.skills, { perception: 5, stealth: 6 });
  assert.equal(wolf.saves.dex, 2, "a wolf's DEX 15 with no save proficiency takes no bonus");
  assert.equal(wolf.size, "Medium");
  assert.deepEqual(wolf.conditions, [PET_DODGING]);
});

test("the drake grows wings and a size at 7th, and its bite's extra die is 2d6 at 15th", () => {
  const small = buildPet(ranger(3, "Drakewarden"), { kind: "drake", form: "drake", essence: "fire" });
  const grown = buildPet(ranger(7, "Drakewarden"), { kind: "drake", form: "drake", essence: "fire" });
  const great = buildPet(ranger(15, "Drakewarden"), { kind: "drake", form: "drake", essence: "fire" });
  assert.equal(small.size, "Small");
  assert.equal(small.fly, undefined);
  assert.deepEqual([grown.size, grown.fly], ["Medium", grown.speed]);
  assert.deepEqual(grown.attacks[0].riders, [{ dice: "1d6", type: "fire" }]);
  assert.equal(great.size, "Large");
  assert.deepEqual(great.attacks[0].riders, [{ dice: "2d6", type: "fire" }]);
});

test("Otherworldly Glamour adds Wisdom to Charisma checks and nothing else", () => {
  const sheet = { class: "ranger", subclass: "Fey Wanderer", level: 3, features: [{ name: "Otherworldly Glamour" }] };
  const mods = { str: 3, dex: 2, con: 2, int: 0, wis: 5, cha: 0 };
  assert.equal(authoredCheckMod(sheet, "cha", mods).bonus, 5);
  assert.equal(authoredCheckMod(sheet, "str", mods).bonus, 0);
  assert.equal(authoredCheckMod({ class: "ranger", subclass: "Hunter", level: 3, features: [] }, "cha", mods).bonus, 0);
});

console.log(`test-ranger-archetypes: ${passed} passed`);
