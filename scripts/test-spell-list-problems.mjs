// The server's answer to "may this sheet hold these spells?", asked at
// creation and edit (POST/PUT /api/characters, the campaign sheet routes,
// companions/create) and at level-up.
//
// The rule this file guards: the 5e spell tables are enforced where the sheet
// is saved, not only where it is built. Before this the builder held every
// class to its counts and the server saved whatever arrived (issue #37).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { spellListProblems, cantripCapOf } = await import("../src/lib/srd/spell-prep.ts");
const { suggestedCantripCount, suggestedSpellCount } = await import("../src/lib/content/mechanics.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const abilities = { str: 10, dex: 14, con: 14, int: 16, wis: 16, cha: 16 };

function sheet(klass, level, casting, extra = {}) {
  return {
    class: klass,
    level,
    subclass: "",
    classes: [],
    abilities,
    spellcasting: casting
      ? { ability: casting.ability ?? "int", slots: {}, known: [], prepared: [], cantrips: [], ...casting }
      : null,
    ...extra,
  };
}

await test("a level 1 sorcerer knows 4 cantrips and 2 spells, and no more", () => {
  const fine = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation"], known: ["Magic Missile", "Shield"] });
  assert.deepEqual(spellListProblems(fine), []);
  const spells = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt"], known: ["Magic Missile", "Shield", "Sleep"] });
  assert.match(spellListProblems(spells)[0], /may hold 2 spells known; that list has 3/);
  const cantrips = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation", "Ray of Frost"], known: [] });
  assert.match(spellListProblems(cantrips)[0], /knows 4 cantrips; that list has 5/);
});

await test("a level 1 cleric prepares Wisdom modifier + level, and the domain's spells are free", () => {
  // WIS 16 at level 1: four prepared. Life Domain adds Bless and Cure Wounds for free.
  const fine = sheet("cleric", 1, { ability: "wis", cantrips: ["Guidance", "Sacred Flame", "Thaumaturgy"], prepared: ["Bless", "Cure Wounds", "Healing Word", "Shield of Faith", "Guiding Bolt"] }, { subclass: "Life Domain" });
  assert.deepEqual(spellListProblems(fine), []);
  const over = sheet("cleric", 1, { ability: "wis", cantrips: ["Guidance"], prepared: ["Healing Word", "Shield of Faith", "Guiding Bolt", "Command", "Sanctuary"] });
  assert.match(spellListProblems(over)[0], /may hold 4 spells prepared; that list has 5/);
});

await test("a wizard starts with six spells in the book at creation, any number after copying scrolls", () => {
  const book = ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Find Familiar", "Burning Hands"];
  const created = sheet("wizard", 1, { cantrips: ["Fire Bolt", "Light", "Mage Hand"], prepared: ["Magic Missile"], spellbook: book });
  assert.match(spellListProblems(created)[0], /starts with 6 spells in the spellbook; that book has 7/);
  assert.deepEqual(spellListProblems(created, { bookAllowance: false }), []);
});

await test("a spell above the level the slots reach is refused, and a warlock's Arcanum is not", () => {
  const wizard = sheet("wizard", 1, { cantrips: ["Fire Bolt", "Light", "Mage Hand"], prepared: ["Fireball"], spellbook: ["Fireball"] });
  assert.match(spellListProblems(wizard)[0], /Fireball is a level 3 spell; a level 1 wizard casts up to level 1/);
  const warlock = sheet("warlock", 11, { ability: "cha", cantrips: ["Eldritch Blast", "Minor Illusion", "Prestidigitation", "Chill Touch"], known: ["Hex", "Armor of Agathys", "Hold Person", "Counterspell", "Banishment", "Hold Monster", "Circle of Death", "Fear", "Fly", "Dimension Door", "Scrying"] });
  assert.deepEqual(spellListProblems(warlock), []);
});

// A setting pact caster (Grave Knight, Occultist) reads the warlock's tables
// for its pact slots, which stop at 5th level, and holds no Mystic Arcanum:
// it never learns a 6th to 9th level spell. Issue #833 let every class on the
// warlock's tables reach past its slots; only a class with an arcanum does.
await test("a setting pact caster without a Mystic Arcanum stops at 5th level spells", async () => {
  const known = ["Hex", "Armor of Agathys", "Hold Person", "Counterspell", "Banishment", "Hold Monster", "Circle of Death", "Fear", "Fly", "Dimension Door", "Scrying"];
  const pact = sheet("grave_knight", 17, { ability: "cha", cantrips: ["Eldritch Blast", "Minor Illusion", "Prestidigitation", "Chill Touch"], known });
  assert.match(spellListProblems(pact).join(" "), /Circle of Death is a level 6 spell/, "grave_knight: a 6th level spell is refused");
  // The occultist's own Apocrypha (13th) and Seventh Seal (17th) teach one
  // 6th and one 7th level warlock spell (src/lib/srd/genre-gh-horror-spells.ts),
  // and nothing reaches 8th.
  const occultist = (more) => sheet("occultist", 17, { ability: "int", cantrips: ["Eldritch Blast", "Minor Illusion", "Prestidigitation", "Chill Touch"], known: [...known, ...more] });
  assert.doesNotMatch(spellListProblems(occultist([])).join(" "), /Circle of Death is a level 6 spell/, "occultist: Apocrypha's 6th level spell is refused");
  assert.match(spellListProblems(occultist(["Power Word Stun"])).join(" "), /Power Word Stun is a level 8 spell/, "occultist: an 8th level spell is taken");
  // The warlock's own Arcanum still reaches 6th at 11.
  assert.deepEqual(spellListProblems(sheet("warlock", 11, { ability: "cha", cantrips: ["Eldritch Blast", "Minor Illusion", "Prestidigitation", "Chill Touch"], known })), []);
  const { mysticArcanumTop } = await import("../src/lib/srd/spell-prep.ts");
  assert.equal(mysticArcanumTop("warlock", 17), 9);
  assert.equal(mysticArcanumTop("occultist", 17), 7);
  assert.equal(mysticArcanumTop("grave_knight", 17), 0);
  assert.equal(mysticArcanumTop("grave_knight", 20), 0);
  // The level-up preview offers no more than the slots either.
  const { casterPreview } = await import("../src/app/campaigns/[campaignId]/level-up-preview.ts");
  assert.equal(casterPreview({ classId: "grave_knight", subclass: "", level: 17, abilitiesAfter: abilities }).maxLevel, 5);
  // The occultist's level-up offers Seventh Seal's 7th level spell.
  assert.equal(casterPreview({ classId: "occultist", subclass: "", level: 17, abilitiesAfter: abilities }).maxLevel, 7);
  assert.equal(casterPreview({ classId: "warlock", subclass: "", level: 17, abilitiesAfter: abilities }).maxLevel, 9);
});

await test("a level 1 paladin has no slots yet, so a spell on the list is refused", () => {
  const paladin = sheet("paladin", 1, { ability: "cha", prepared: ["Cure Wounds"] });
  assert.match(spellListProblems(paladin)[0], /no spell slots yet, so Cure Wounds cannot be on the list/);
  assert.deepEqual(spellListProblems(sheet("paladin", 2, { ability: "cha", prepared: ["Cure Wounds", "Bless"] })), []);
});

await test("a non-caster and a sheet without spellcasting raise nothing", () => {
  assert.deepEqual(spellListProblems(sheet("fighter", 5, null)), []);
  assert.deepEqual(spellListProblems(sheet("rogue", 1, { known: [], prepared: [] })), []);
});

await test("an artificer has cantrip and prepared caps from level 1", () => {
  assert.equal(suggestedCantripCount("artificer", 1, "artificer"), 2);
  assert.equal(suggestedCantripCount("artificer", 10, "artificer"), 3);
  // INT 16 at level 1: 3 + floor(1/2) = 3.
  assert.deepEqual(suggestedSpellCount("artificer", 1, 3), { label: "spells prepared", count: 3 });
  assert.deepEqual(suggestedSpellCount("artificer", 5, 3), { label: "spells prepared", count: 5 });
  assert.equal(cantripCapOf({ classId: "artificer", level: 1 }), 2);
  const over = sheet("artificer", 1, { cantrips: ["Mending", "Guidance", "Light"], prepared: ["Cure Wounds"] });
  assert.match(spellListProblems(over)[0], /knows 2 cantrips; that list has 3/);
});

await test("a multiclassed sheet checks each caster class at its own level", () => {
  const multi = sheet("wizard", 6, {
    casters: [
      { classId: "wizard", ability: "int", cantrips: ["Fire Bolt", "Light", "Mage Hand"], prepared: ["Magic Missile"], spellbook: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Find Familiar", "Misty Step", "Web", "Fireball", "Counterspell"] },
      { classId: "cleric", ability: "wis", cantrips: ["Guidance", "Sacred Flame", "Thaumaturgy", "Light"], prepared: ["Bless"] },
    ],
  }, { classes: [{ id: "wizard", subclass: "", level: 5 }, { id: "cleric", subclass: "", level: 1 }] });
  const problems = spellListProblems(multi, { bookAllowance: false });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /level 1 cleric knows 3 cantrips; that list has 4/);
});

console.log(`\ntest-spell-list-problems: ${passed} tests passed.`);
