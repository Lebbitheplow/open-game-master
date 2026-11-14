// The horror classes' features wired in the cc1113 genre-c completeness pass
// (ids GH..): each case fails without its mechanism, and the clause ledger
// (scripts/clauses/genre-horror.json) points here for the clauses it holds.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { clausesRig } from "./lib/sweep-clauses-genre-b-probes.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const { focusProblem } = await load("lib/dm/cast-materials.ts");
const { bundledSpellFacts } = await load("lib/srd/spell-facts.ts");
const { classSpellGrants, offListProblems } = await load("lib/srd/class-spell-grants.ts");
const { mysticArcanumTop } = await load("lib/srd/spell-prep.ts");
const { marginaliaProblem } = await load("lib/srd/genre-gh-horror-spells.ts");

const { test, finish } = suite("test-genre-gh-horror");
const rig = await clausesRig();
const { world, kit } = rig;
const feature = (classId, name, level) => ({ classId, name, level, key: `${classId}::${name}` });
const run = async (name, body) => {
  try {
    await test(name, body);
  } finally {
    await kit.endFight();
    rig.reset();
  }
};

// ---- GH01: the horror casters' focus ----

const caster = (classId, feature, equipment) => ({ name: "Caster", class: classId, classes: [], features: [{ name: feature }], equipment });
const focusCases = [
  ["exorcist", "Liturgy", "Bless", [{ name: "Holy Symbol", qty: 1 }], [{ name: "Ritual Kit", qty: 1 }], [{ name: "Wand", qty: 1 }]],
  ["occultist", "Pact of the Page", "Hex", [{ name: "Grimoire", qty: 1 }], [{ name: "Spellbook", qty: 1 }], [{ name: "Holy Symbol", qty: 1 }]],
  ["parapsychologist", "Applied Theory", "Mage Armor", [{ name: "Field Instruments", qty: 1 }], [{ name: "Field Instruments", qty: 1 }], [{ name: "Holy Symbol", qty: 1 }]],
];
for (const [classId, feature, spell, focus, other, wrong] of focusCases) {
  await test(`${feature}: a ${classId}'s material spell needs the focus the feature names (or a pouch), and another class's focus is refused`, () => {
    const facts = bundledSpellFacts(spell);
    assert.ok(facts?.material, `${spell} has no material component`);
    assert.equal(focusProblem(caster(classId, feature, focus), facts), null, `${feature}: ${focus[0].name} was refused`);
    assert.equal(focusProblem(caster(classId, feature, other), facts), null, `${feature}: ${other[0].name} was refused`);
    assert.equal(focusProblem(caster(classId, feature, [{ name: "Component Pouch", qty: 1 }]), facts), null, `${feature}: a component pouch was refused`);
    assert.match(focusProblem(caster(classId, feature, wrong), facts)?.error ?? "accepted", new RegExp(feature), `${feature}: ${wrong[0].name} served as the focus`);
  });
}

// ---- GH02: Hunted Instincts ----

await run("Hunted Instincts: an apostate rolls initiative with advantage while a cultist is in the fight, and not against goblins or without the feature", async () => {
  const row = feature("apostate", "Hunted Instincts", 7);
  const hero = rig.holder(row);
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  assert.doesNotMatch(rig.initiative(hero), /2d20/, "advantage on initiative against goblins");
  await kit.endFight();
  await world.beginFight([{ monster: "cultist", count: 1 }]);
  assert.equal(world.enemies()[0]?.slug, "cultist", "the fight holds no cultist");
  const { on, off } = await rig.both(hero, row, async () => rig.initiative(hero));
  assert.match(on, /2d20/, `initiative ${on} with a cultist present`);
  assert.doesNotMatch(off, /2d20/, "advantage without the feature");
});

// ---- GH03: spells past the list and past the slots ----

const offList = (grants, strays) => offListProblems({ grants, allowedBefore: grants.anyList, kept: 0, strays, list: "warlock", label: "level 10 occultist" });

await test("Marginalia: a 10th-level occultist holds two rituals from any list on top of their spells known, and a non-ritual off the list is refused", () => {
  const grants = classSpellGrants({ classId: "occultist", level: 10, features: [{ name: "Marginalia" }] });
  assert.equal(grants.anyList, 2, "Marginalia's picks");
  assert.equal(grants.extraSpells, 2, "the picks sit on top of the spells known");
  assert.deepEqual(offList(grants, [{ name: "Detect Magic", cantrip: false, ritual: true }, { name: "Alarm", cantrip: false, ritual: true }]), []);
  assert.equal(offList(grants, [{ name: "Fireball", cantrip: false, ritual: false }]).length, 1, "a non-ritual off the list was taken");
  assert.equal(classSpellGrants({ classId: "occultist", level: 9 }).anyList, 0, "Marginalia before 10th level");
});

await test("Marginalia: a spell it brought is cast as a ritual only, and a warlock spell is cast as ever", () => {
  const sheet = { name: "Inkwell", class: "occultist", classes: [], features: [{ name: "Marginalia" }] };
  assert.match(marginaliaProblem(sheet, bundledSpellFacts("Detect Magic"), false) ?? "cast", /ritual only/);
  assert.equal(marginaliaProblem(sheet, bundledSpellFacts("Detect Magic"), true), null);
  assert.equal(marginaliaProblem(sheet, bundledSpellFacts("Hex"), false), null);
});

await test("Unified Theory: a 17th-level parapsychologist holds three spells from any list, cast as the class's own", () => {
  const grants = classSpellGrants({ classId: "parapsychologist", level: 17, features: [{ name: "Unified Theory" }] });
  assert.equal(grants.anyList, 3);
  assert.deepEqual(offListProblems({ grants, allowedBefore: 3, kept: 0, strays: [{ name: "Bless", cantrip: false }, { name: "Cure Wounds", cantrip: false }, { name: "Hex", cantrip: false }], list: "wizard", label: "parapsychologist" }), []);
  assert.equal(classSpellGrants({ classId: "parapsychologist", level: 16 }).anyList, 0);
});

await test("Apocrypha and Seventh Seal: an occultist's list reaches a 6th-level spell at 13th and a 7th-level one at 17th, and no further", () => {
  assert.deepEqual([12, 13, 16, 17, 20].map((level) => mysticArcanumTop("occultist", level)), [0, 6, 6, 7, 7]);
});

rig.world.close();
finish();
