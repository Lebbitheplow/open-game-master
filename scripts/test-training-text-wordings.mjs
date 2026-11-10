// What a pack subclass's feature text trains its character in
// (src/lib/srd/subclass-training.ts trainingFromText, src/lib/srd/
// feat-grant-text.ts featGrantSpec), one wording at a time, each quoted from
// the pack. A feature of any name is read where a sentence gives
// proficiency; a clause that asks whether the character is proficient is a
// condition, never a grant; "either A or B" offers both; "the A, B, or C
// skill" is one pick.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { trainingFromText } = await import("../src/lib/srd/subclass-training.ts");
const { featGrantSpec } = await import("../src/lib/srd/feat-grant-text.ts");

let passed = 0;
const test = (name, run) => {
  run();
  passed += 1;
  console.log(`ok ${name}`);
};
const read = (name, text) => {
  const spec = trainingFromText(name, text);
  assert.ok(spec, `${name}: nothing read from "${text}"`);
  return spec;
};

test("Oral Tradition (Path of the Herald) grants History and Performance", () => {
  const spec = read("Oral Tradition", "When you adopt this path at 3rd level, you gain proficiency in History and Performance. If you already have proficiency in one of these skills, your proficiency bonus is doubled for ability checks you make using that skill.");
  assert.deepEqual(spec.fixedSkills, ["history", "performance"]);
  assert.equal(spec.skills, 0);
});

test("College of Investigation: Insight, and two of six", () => {
  const spec = read("Bonus Proficiencies", "When you join the College of Investigation at 3rd level, you gain proficiency in the Insight skill and in two of the following skills of your choice: Acrobatics, Deception, Investigation, Performance, Sleight of Hand, or Stealth.");
  assert.deepEqual(spec.fixedSkills, ["insight"]);
  assert.equal(spec.skills, 2);
  assert.deepEqual(spec.skillsFrom, ["acrobatics", "deception", "investigation", "performance", "sleight_of_hand", "stealth"]);
});

test("College of Shadows: Stealth, and two other skills", () => {
  const spec = read("Bonus Proficiencies", "When you join the College of Shadows at 3rd level, you gain proficiency in Stealth and in two other skills of your choice.");
  assert.deepEqual(spec.fixedSkills, ["stealth"]);
  assert.equal(spec.skills, 2);
  assert.deepEqual(spec.skillsFrom, []);
});

test("College of the Cat: Acrobatics, Stealth and thieves' tools, and no weapon to pick", () => {
  const spec = read("Bonus Proficiencies", "When you join the College of the Cat at 3rd level, you gain proficiency with the Acrobatics and Stealth skills and with thieves' tools if you don't already have them. In addition, if you're proficient with a simple or martial melee weapon, you can use it as a spellcasting focus for your bard spells.");
  assert.deepEqual(spec.fixedSkills, ["acrobatics", "stealth"]);
  assert.deepEqual(spec.fixedTools, ["thieves' tools"]);
  assert.equal(spec.any, 0, JSON.stringify(spec.anyKinds));
  assert.equal(spec.weapons, 0);
});

test("Portal Domain: heavy armor, Arcana, and either of two tools", () => {
  const spec = read("Bonus Proficiencies", "When you choose this domain at 1st level, you gain proficiency with heavy armor and either cartographer's tools or navigator's tools (your choice). In addition, you gain proficiency in the Arcana skill.");
  assert.deepEqual(spec.armor, ["heavy"]);
  assert.deepEqual(spec.fixedSkills, ["arcana"]);
  assert.equal(spec.tools, 1);
  assert.deepEqual([...spec.toolsFrom].sort(), ["cartographer's tools", "navigator's tools"]);
});

test("Circle of Bees and the Chaplain: one skill of those named", () => {
  const bees = read("Bee Bond", "When you choose this circle at 2nd level, you gain proficiency in the Acrobatics or Stealth skill (your choice), and you can speak and understand Bee Dance.");
  assert.equal(bees.skills, 1);
  assert.deepEqual(bees.skillsFrom, ["acrobatics", "stealth"]);
  assert.deepEqual(bees.fixedSkills, []);
  const chaplain = read("Student of Faith", "When you choose this archetype at 3rd level, you gain proficiency in the Insight, Medicine, or Religion skill (your choice).");
  assert.equal(chaplain.skills, 1);
  assert.deepEqual(chaplain.skillsFrom, ["insight", "medicine", "religion"]);
});

test("a Sapper's four tools and a Smuggler's either-or", () => {
  const sapper = read("Combat Engineer", "When you select this archetype at 3rd level, you gain proficiency in alchemist's supplies, carpenter's tools, mason's tools, and tinker's tools.");
  assert.deepEqual([...sapper.fixedTools].sort(), ["alchemist's supplies", "carpenter's tools", "mason's tools", "tinker's tools"]);
  const smuggler = read("Dab-handed Dealer", "When you choose this archetype at 3rd level, you gain proficiency with vehicles (land and water) and with your choice of either the disguise kit or navigator-s tools.");
  assert.equal(smuggler.tools, 1);
  assert.deepEqual([...smuggler.toolsFrom].sort(), ["disguise kit", "navigator's tools"]);
});

test("Serpent Domain: Deception and a poisoner's kit, never every martial weapon", () => {
  const spec = read("Envenomed", "In addition, you gain proficiency in the Deception skill, with a poisoner's kit, and with martial weapons that have the Finesse property.");
  assert.deepEqual(spec.fixedSkills, ["deception"]);
  assert.ok(spec.fixedTools.includes("poisoner's kit"));
  assert.ok(!spec.fixedWeapons.includes("martial"), JSON.stringify(spec.fixedWeapons));
});

test("weapons named outright, and \"you have proficiency\"", () => {
  const vermin = read("The Unseen", "When you choose this domain at 1st level, you gain proficiency with shortswords and hand crossbows. You also gain proficiency in Stealth and Survival.");
  assert.deepEqual([...vermin.fixedWeapons].sort(), ["Hand Crossbow", "Shortsword"]);
  assert.deepEqual(vermin.fixedSkills, ["stealth", "survival"]);
  const grave = read("Gravebinder Lore", "In addition, you have proficiency in the Religion skill if you don't already have it, and you have advantage on Intelligence (Religion) checks.");
  assert.deepEqual(grave.fixedSkills, ["religion"]);
});

test("a feature that only asks, or lasts a while, trains nothing", () => {
  assert.equal(trainingFromText("Keen Eye", "If you have proficiency in Perception, you add double your proficiency bonus to it."), null);
  assert.equal(trainingFromText("Borrowed Knowledge", "As an action, you gain proficiency in one skill of your choice for 1 hour."), null);
});

test("a feat's own reading is unchanged: Skilled, Linguist, Weapon Master", () => {
  assert.equal(featGrantSpec("You gain proficiency in any combination of three skills or tools of your choice.").any, 3);
  assert.equal(featGrantSpec("You learn three languages of your choice.").languages, 3);
  assert.equal(featGrantSpec("You gain proficiency with four weapons of your choice.").weapons, 4);
});

console.log(`${passed} passed`);
