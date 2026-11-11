// The clause ledger's probes for the artificer (ODM's class: its features
// are the glosses of src/lib/help/srd-features.json). The clause text and
// the verdict live in scripts/clauses/srd-classes.json; this file holds how
// each clause that names it is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, slots, feature } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const prep = await import("../src/lib/srd/spell-prep.ts");
const items = await import("../src/lib/srd/magic-items.ts");
const P = {};

const artificer = (t, level, extra = {}) =>
  t.hero({
    class: "artificer", level, abilities: { int: 18, ...(extra.abilities ?? {}) },
    spellcasting: { ability: "int", slots: slots(4, 3, 3), prepared: ["Cure Wounds"], known: ["Cure Wounds"], cantrips: [] },
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "abilities")),
  });

// "which list you learn from, how many spells you can have ready, and the
// slots you spend to cast them."
P["artificer.spellcasting"] = async () => {
  const { srd } = rig;
  const view = (level) => ({ classId: "artificer", level, subclass: "", ability: "int" });
  // The slots: an artificer casts from 1st level, half a full caster's
  // progression rounded up.
  const table = { 1: { 1: 2 }, 3: { 1: 3 }, 5: { 1: 4, 2: 2 }, 9: { 1: 4, 2: 3, 3: 2 }, 13: { 1: 4, 2: 3, 3: 3, 4: 1 }, 17: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, 20: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 } };
  for (const [level, wanted] of Object.entries(table)) {
    const got = Object.fromEntries(Object.entries(srd.spellSlotsFor("artificer", Number(level))).filter(([, count]) => count > 0).map(([slot, count]) => [Number(slot), count]));
    assert.deepEqual(got, wanted, `artificer ${level}`);
  }
  // How many are ready: the Intelligence modifier and half the level, one at least.
  for (const [score, level, count] of [[18, 5, 6], [16, 2, 4], [8, 1, 1], [20, 20, 15]]) {
    assert.equal(prep.spellCapOf(view(level), { str: 10, dex: 10, con: 10, int: score, wis: 10, cha: 10 })?.count, count, `artificer ${level} with Intelligence ${score}`);
  }
  // The list: a spell of the artificer's list is theirs to ready, a wizard's
  // alone is not.
  assert.equal(prep.spellOnCasterList(view(5), { name: "Cure Wounds", classes: ["artificer", "cleric"] }), true);
  assert.equal(prep.spellOnCasterList(view(5), { name: "Fireball", classes: ["sorcerer", "wizard"] }), false, "a spell off the artificer's list is on it");
  // A ready spell spends a slot; one not ready is not cast.
  const t = await rig.table();
  const who = artificer(t, 5);
  const cast = await t.invoke("use_spell_slot", { characterId: who.id, level: 1, spell: "Cure Wounds" });
  assert.equal(cast.ok, true, cast.error);
  assert.equal(t.sheet(who).spellcasting.slots["1"].used, 1, "the cast spent no slot");
  const unready = await t.invoke("use_spell_slot", { characterId: who.id, level: 1, spell: "Faerie Fire" });
  assert.equal(unready.ok, false, "an artificer cast a spell they have not readied");
};

P["artificer.magical-tinkering.count"] = async () => {
  const t = await rig.table();
  // Intelligence 14: two objects.
  const who = artificer(t, 1, { abilities: { int: 14 } });
  t.patch(who, { features: [...t.sheet(who).features.filter((entry) => entry.name !== "Magical Tinkering"), feature("Magical Tinkering")] });
  const tinker = (variant) => t.use(who, "Magical Tinkering", variant ? { variant } : {});
  assert.equal((await tinker()).ok, true);
  assert.equal((await tinker()).ok, true);
  assert.equal(t.has(who, "tinkered objects (2)"), true, `two objects are counted: ${JSON.stringify(t.sheet(who).conditions)}`);
  const third = await tinker();
  assert.match(String(third.error), /Intelligence modifier/, "a third object at Intelligence modifier +2");
  assert.equal((await tinker("end")).ok, true);
  assert.equal(t.has(who, "tinkered objects (1)"), true);
  assert.equal((await tinker()).ok, true, "an ended object freed no room");
  // Intelligence 8: one at least.
  const dull = artificer(t, 1, { abilities: { int: 8 } });
  t.patch(dull, { features: [...t.sheet(dull).features.filter((entry) => entry.name !== "Magical Tinkering"), feature("Magical Tinkering")] });
  assert.equal((await t.use(dull, "Magical Tinkering")).ok, true, "an artificer with a negative modifier has none");
  assert.match(String((await t.use(dull, "Magical Tinkering")).error), /Intelligence modifier/);
};

// "you ignore all class, race, spell and level requirements on using them"
P["artificer.magic-item-savant.requirements"] = async () => {
  const rule = (attunedBy) => ({ attunedBy: { text: "someone else", ...attunedBy } });
  const savant = { class: "artificer", level: 14, race: "Human", features: [] };
  const adept = { class: "artificer", level: 13, race: "Human", features: [] };
  for (const [what, def] of [["class", rule({ classes: ["paladin"] })], ["race", rule({ race: "dwarf" })]]) {
    assert.equal(items.mayAttune(def, adept), false, `the staging: a 13th level artificer meets no ${what} requirement`);
    assert.equal(items.mayAttune(def, savant), true, `a 14th level artificer is held to an item's ${what} requirement`);
  }
  const caster = rule({ spellcaster: true });
  assert.equal(items.mayAttune(caster, { class: "fighter", level: 14, features: [] }), false, "the staging: a fighter is no spellcaster");
  assert.equal(items.mayAttune(caster, { classes: [{ id: "fighter", level: 2 }, { id: "artificer", level: 14 }], features: [] }), true, "a 14th level artificer is held to an item's spell requirement");
  // On the sheet: the attunement goes through.
  const t = await rig.table();
  const who = artificer(t, 14, { equipment: [{ name: "Holy Avenger", qty: 1, equipped: true }] });
  const fighter = t.hero({ class: "fighter", level: 14, name: "Edda", equipment: [{ name: "Holy Avenger", qty: 1, equipped: true }] });
  const row = (sheet) => t.sheet(sheet).equipment.find((item) => item.name === "Holy Avenger");
  assert.notEqual(items.attunementProblem(row(fighter), [], t.sheet(fighter)), null, "the staging: a Holy Avenger asks for a paladin");
  assert.equal(items.attunementProblem(row(who), [], t.sheet(who)), null, "a 14th level artificer cannot attune to a paladin's sword");
};

// "You gain +1 to every saving throw per attuned magic item"
P["artificer.soul-of-artifice.saves"] = async () => {
  const t = await rig.table();
  const gear = [
    { name: "Cloak of Elvenkind", qty: 1, equipped: true, attuned: true },
    { name: "Boots of Elvenkind", qty: 1, equipped: true },
    { name: "Winged Boots", qty: 1, equipped: false, attuned: true },
  ];
  const who = artificer(t, 20, { equipment: gear });
  const lesser = artificer(t, 19, { equipment: gear, name: "Fenn" });
  const saves = (sheet) => t.derived(sheet).saves;
  const plain = saves(lesser);
  const soul = saves(who);
  for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
    // Two attuned items: +2 on every save (the proficiency bonus is +6 at both levels).
    assert.equal(soul[ability] - plain[ability], 2, `${ability}: ${soul[ability]} against ${plain[ability]} with two attuned items`);
  }
  t.patch(who, { equipment: gear.map((item) => ({ ...item, attuned: false })) });
  assert.equal(saves(who).wis, plain.wis, "the bonus stood with no item attuned");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-artificer.mjs", P);
