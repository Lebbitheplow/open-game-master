// The horror classes' features wired in the cc1113 genre-c completeness pass
// (ids GH..): each case fails without its mechanism, and the clause ledger
// (scripts/clauses/genre-horror.json) points here for the clauses it holds.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const SRC = new URL("../src/", import.meta.url);
const load = (file) => import(new URL(file, SRC).href);
const { focusProblem } = await load("lib/dm/cast-materials.ts");
const { bundledSpellFacts } = await load("lib/srd/spell-facts.ts");

const { test, finish } = suite("test-genre-gh-horror");

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

finish();
