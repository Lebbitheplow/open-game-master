// "Fill what's left" for a feat-shaped grant (src/app/characters/builder/
// fillFeatPicks.ts) and for a species' or background's free skills
// (quickBuild.ts skillOrderSparingClass), checked against the counters the
// save uses (feat-grants.ts featPicksOwed, feat-spells.ts featSpellsOwed):
//
//   - a shared pick over weapons (College of the Cat's grant as the pack read
//     it) is made, as the save counts it (pickSlots)
//   - Skilled's three skills or tools, Linguist's languages, Weapon Master's
//     weapons are made
//   - Magic Initiate's list, cantrips and spell, Ritual Caster's ritual
//     spells, Spell Sniper's attack cantrip and Elemental Adept's damage type
//     are made (the maintainer's decision R12, wave 1: the fill fills a
//     feat's taught spells and damage types too)
//   - a free skill pick spares the class's list while the class still picks:
//     SRD 5.1, Cleric: "Choose two from History, Insight, Medicine,
//     Persuasion, and Religion"
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { fillFeatPicks } = await import("../src/app/characters/builder/fillFeatPicks.ts");
const { skillOrderSparingClass } = await import("../src/app/characters/builder/quickBuild.ts");
const { featGrantSpec, featOwed } = await import("../src/lib/srd/feat-grants.ts");
const { authoredFeatDesc } = await import("../src/lib/srd/feat-effects.ts");
const { featSpellSpec } = await import("../src/lib/srd/feat-spells.ts");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { ALL_SKILLS } = await import("../src/lib/content/mechanics.ts");
const spellManifest = (await import("../src/lib/srd/manifest/spells.json", { with: { type: "json" } })).default;

let passed = 0;
const test = (name, run) => {
  run();
  passed += 1;
  console.log(`ok ${name}`);
};
const held = () => ({ skills: new Set(["athletics"]), languages: new Set(["common"]), tools: new Set(), weapons: new Set(["simple"]), spells: new Set(["fire bolt"]) });
const facts = { skillOrder: (have, from) => ALL_SKILLS.filter((skill) => from.includes(skill) && !have.has(skill)), abilities: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 }, classList: "wizard" };
const fill = (spec) => fillFeatPicks(spec, undefined, facts, held()) ?? {};

test("a shared pick over weapons is made, as the save counts it", () => {
  const spec = { ...featGrantSpec(""), any: 1, anyKinds: ["weapons"], weaponsFrom: ["Rapier", "Scimitar", "Longsword"] };
  const picks = fill(spec);
  assert.equal(featOwed("Grant", spec, picks), null, JSON.stringify(picks));
  assert.equal(picks.weapons?.length, 1);
});

for (const feat of ["Skilled", "Linguist", "Weapon Master", "Skill Expert"]) {
  test(`${feat}'s training is filled`, () => {
    const spec = featGrantSpec(authoredFeatDesc(feat) ?? "");
    const picks = fill(spec);
    assert.equal(featOwed(feat, spec, picks), null, JSON.stringify(picks));
  });
}

const RITUAL = new Set(spellManifest.spells.filter((spell) => spell.r).map((spell) => spell.n));
for (const feat of ["Magic Initiate", "Ritual Caster", "Spell Sniper", "Fey Touched", "Shadow Touched", "Elemental Adept"]) {
  test(`${feat}'s spells and damage type are filled`, () => {
    const desc = authoredFeatDesc(feat);
    assert.ok(desc, `no authored text for ${feat}`);
    const spec = featGrantSpec(desc);
    const picks = fill(spec);
    assert.equal(featOwed(feat, spec, picks), null, JSON.stringify(picks));
    const taught = featSpellSpec(desc);
    for (const name of picks.spells ?? []) {
      const row = checklistSpell(name);
      assert.equal(row?.level, taught.spellLevel, `${name} is not a level ${taught.spellLevel} spell`);
      if (taught.ritualBook) assert.ok(RITUAL.has(row.name), `${name} has no ritual tag`);
      if (taught.schools.length) assert.ok(taught.schools.includes(row.school), `${name} is ${row.school}`);
      const lists = picks.list ? [picks.list] : taught.lists;
      if (lists.length) assert.ok(row.classes.some((entry) => lists.includes(entry)), `${name} is not on ${lists.join(", ")}`);
    }
    for (const name of picks.cantrips ?? []) assert.equal(checklistSpell(name)?.level, 0, `${name} is not a cantrip`);
    assert.ok(!(picks.cantrips ?? []).includes("Fire Bolt"), "a cantrip the character holds was picked again");
  });
}

test("a free skill pick spares the cleric's list while the cleric still picks two", () => {
  const cleric = { from: ["history", "insight", "medicine", "persuasion", "religion"], count: 2 };
  const heldSkills = new Set(["insight", "religion"]);
  const order = facts.skillOrder(heldSkills, ALL_SKILLS);
  const lead = ["history", "medicine", "persuasion", ...order.filter((skill) => !cleric.from.includes(skill))];
  const spared = skillOrderSparingClass(lead, heldSkills, cleric, 0);
  // Three of the list are free and the cleric needs two: one may go early.
  const firstTwo = spared.slice(0, 2);
  assert.equal(firstTwo.filter((skill) => cleric.from.includes(skill)).length, 1, firstTwo.join(", "));
  // Once the cleric has picked, the order is as it was.
  assert.deepEqual(skillOrderSparingClass(lead, heldSkills, cleric, 2), lead);
});

console.log(`${passed} passed`);
