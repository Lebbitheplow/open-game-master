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
function test(name, fn) {
  fn();
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

test("a level 1 sorcerer knows 4 cantrips and 2 spells, and no more", () => {
  const fine = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation"], known: ["Magic Missile", "Shield"] });
  assert.deepEqual(spellListProblems(fine), []);
  const spells = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt"], known: ["Magic Missile", "Shield", "Sleep"] });
  assert.match(spellListProblems(spells)[0], /may hold 2 spells known; that list has 3/);
  const cantrips = sheet("sorcerer", 1, { ability: "cha", cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation", "Ray of Frost"], known: [] });
  assert.match(spellListProblems(cantrips)[0], /knows 4 cantrips; that list has 5/);
});

test("a level 1 cleric prepares Wisdom modifier + level, and the domain's spells are free", () => {
  // WIS 16 at level 1: four prepared. Life Domain adds Bless and Cure Wounds for free.
  const fine = sheet("cleric", 1, { ability: "wis", cantrips: ["Guidance", "Sacred Flame", "Thaumaturgy"], prepared: ["Bless", "Cure Wounds", "Healing Word", "Shield of Faith", "Guiding Bolt"] }, { subclass: "Life Domain" });
  assert.deepEqual(spellListProblems(fine), []);
  const over = sheet("cleric", 1, { ability: "wis", cantrips: ["Guidance"], prepared: ["Healing Word", "Shield of Faith", "Guiding Bolt", "Command", "Sanctuary"] });
  assert.match(spellListProblems(over)[0], /may hold 4 spells prepared; that list has 5/);
});

test("a wizard starts with six spells in the book at creation, any number after copying scrolls", () => {
  const book = ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Find Familiar", "Burning Hands"];
  const created = sheet("wizard", 1, { cantrips: ["Fire Bolt", "Light", "Mage Hand"], prepared: ["Magic Missile"], spellbook: book });
  assert.match(spellListProblems(created)[0], /starts with 6 spells in the spellbook; that book has 7/);
  assert.deepEqual(spellListProblems(created, { bookAllowance: false }), []);
});

test("a spell above the level the slots reach is refused, and a warlock's Arcanum is not", () => {
  const wizard = sheet("wizard", 1, { cantrips: ["Fire Bolt", "Light", "Mage Hand"], prepared: ["Fireball"], spellbook: ["Fireball"] });
  assert.match(spellListProblems(wizard)[0], /Fireball is a level 3 spell; a level 1 wizard casts up to level 1/);
  const warlock = sheet("warlock", 11, { ability: "cha", cantrips: ["Eldritch Blast", "Minor Illusion", "Prestidigitation", "Chill Touch"], known: ["Hex", "Armor of Agathys", "Hold Person", "Counterspell", "Banishment", "Hold Monster", "Circle of Death", "Fear", "Fly", "Dimension Door", "Scrying"] });
  assert.deepEqual(spellListProblems(warlock), []);
});

test("a level 1 paladin has no slots yet, so a spell on the list is refused", () => {
  const paladin = sheet("paladin", 1, { ability: "cha", prepared: ["Cure Wounds"] });
  assert.match(spellListProblems(paladin)[0], /no spell slots yet, so Cure Wounds cannot be on the list/);
  assert.deepEqual(spellListProblems(sheet("paladin", 2, { ability: "cha", prepared: ["Cure Wounds", "Bless"] })), []);
});

test("a non-caster and a sheet without spellcasting raise nothing", () => {
  assert.deepEqual(spellListProblems(sheet("fighter", 5, null)), []);
  assert.deepEqual(spellListProblems(sheet("rogue", 1, { known: [], prepared: [] })), []);
});

test("an artificer has cantrip and prepared caps from level 1", () => {
  assert.equal(suggestedCantripCount("artificer", 1, "artificer"), 2);
  assert.equal(suggestedCantripCount("artificer", 10, "artificer"), 3);
  // INT 16 at level 1: 3 + floor(1/2) = 3.
  assert.deepEqual(suggestedSpellCount("artificer", 1, 3), { label: "spells prepared", count: 3 });
  assert.deepEqual(suggestedSpellCount("artificer", 5, 3), { label: "spells prepared", count: 5 });
  assert.equal(cantripCapOf({ classId: "artificer", level: 1 }), 2);
  const over = sheet("artificer", 1, { cantrips: ["Mending", "Guidance", "Light"], prepared: ["Cure Wounds"] });
  assert.match(spellListProblems(over)[0], /knows 2 cantrips; that list has 3/);
});

test("a multiclassed sheet checks each caster class at its own level", () => {
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

// Mystic Arcanum (SRD 5.1, Warlock): "Choose one 6th-level spell from the
// warlock spell list as this arcanum", and a 7th, 8th and 9th at 13th, 15th
// and 17th level. The arcanum is the patron's secret beside the Spells Known
// column, which stops at 5th-level spells: a level 20 warlock knows fifteen
// spells and four arcana. The count used to take each arcanum out of the
// fifteen, so every arcanum cost the warlock a spell it knew.
{
  const { levelUpSpells } = await import("../src/lib/srd/level-up-spells.ts");
  const { checklistSpell, checklistSpellsOn } = await import("../src/lib/srd/spell-lists.ts");
  const { classSpellGrants } = await import("../src/lib/srd/class-spell-grants.ts");
  const prep = await import("../src/lib/srd/spell-prep.ts");
  const listOf = (spellLevel) => checklistSpellsOn("warlock").filter((spell) => spell.level === spellLevel).map((spell) => spell.name);
  const regular = (count) => [1, 2, 3, 4, 5].flatMap(listOf).slice(0, count);
  const ARCANA = { 11: [6], 13: [6, 7], 15: [6, 7, 8], 17: [6, 7, 8, 9] };
  const arcanaAt = (level) => ARCANA[Object.keys(ARCANA).map(Number).filter((at) => level >= at).pop()] ?? [];
  const KNOWN = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15];
  const cantrips = ["Eldritch Blast", "Minor Illusion", "Prestidigitation", "Chill Touch"];

  test("every warlock level holds its Spells Known column and one arcanum of each level it has earned, on top", () => {
    for (let level = 1; level <= 20; level += 1) {
      const known = [...regular(KNOWN[level - 1]), ...arcanaAt(level).map((spellLevel) => listOf(spellLevel)[0])];
      const problems = spellListProblems(sheet("warlock", level, { ability: "cha", cantrips: cantrips.slice(0, level >= 10 ? 4 : level >= 4 ? 3 : 2), known }));
      assert.deepEqual(problems, [], `a level ${level} warlock with ${KNOWN[level - 1]} spells known and ${arcanaAt(level).length} arcana`);
      assert.deepEqual(prep.mysticArcanumLevels({ classId: "warlock", level }), arcanaAt(level), `the arcana a level ${level} warlock holds on top of the count`);
      assert.equal(classSpellGrants({ classId: "warlock", level, features: [] }).extraSpells, 0, "the arcana are no spells known: the column is not raised for them");
    }
  });

  test("an arcanum is one spell of its level, and never stands in for a spell of 5th level or lower", () => {
    const twoSixth = sheet("warlock", 11, { ability: "cha", cantrips: cantrips.slice(0, 4), known: [...regular(10), ...listOf(6).slice(0, 2)] });
    assert.match(spellListProblems(twoSixth).join(" "), /Mystic Arcanum/);
    const noArcanum = sheet("warlock", 11, { ability: "cha", cantrips: cantrips.slice(0, 4), known: regular(12) });
    assert.match(spellListProblems(noArcanum)[0], /may hold 11 spells known/);
  });

  test("a level-up at 11th, 13th, 15th and 17th learns the column's new spell and the arcanum both", () => {
    const view = (level, known) => ({ classId: "warlock", ability: "cha", level, subclass: "", style: "known", known, prepared: [], cantrips: [], pending: [], spellbook: [] });
    const abilities = { str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 18 };
    for (const level of [11, 13, 15, 17]) {
      const before = [...regular(KNOWN[level - 2]), ...arcanaAt(level - 1).map((spellLevel) => listOf(spellLevel)[0])];
      const fresh = regular(KNOWN[level - 1]).filter((name) => !before.includes(name));
      const arcanum = listOf(Math.max(...arcanaAt(level)))[0];
      const picks = [...fresh, arcanum];
      const result = levelUpSpells({ before: view(level - 1, before), level, subclass: "", list: "warlock", firstLevel: false, abilities, freeCantrips: 0, spellOf: checklistSpell, picks: { kind: "picks", spells: picks } });
      assert.ok(!("error" in result), `warlock ${level}: ${picks.join(", ")}: ${result.error}`);
      const second = listOf(Math.max(...arcanaAt(level)))[1];
      const twice = levelUpSpells({ before: view(level - 1, before), level, subclass: "", list: "warlock", firstLevel: false, abilities, freeCantrips: 0, spellOf: checklistSpell, picks: { kind: "picks", spells: [arcanum, second] } });
      assert.ok("error" in twice, `warlock ${level} learned two arcana of one level: ${arcanum}, ${second}`);
    }
    assert.equal(prep.spellCapOf(view(20, []), abilities).count, 15, "the column itself is unchanged");
  });

  test("a content pack's 6th-level spell is an arcanum too, by the level the pack gives it", () => {
    const known = [...regular(11), "Astral Assembly Of The Test"];
    const held = sheet("warlock", 11, { ability: "cha", cantrips: cantrips.slice(0, 4), known });
    assert.deepEqual(spellListProblems(held, { spellLevelOf: (name) => (name === "Astral Assembly Of The Test" ? 6 : null) }), []);
    assert.match(spellListProblems(held).join(" "), /may hold 11 spells known/, "a name of no known level counts as a spell known");
  });

  const { arcanumSplit } = await import("../src/lib/srd/mystic-arcanum.ts");
  test("the level-up dialog reads the arcana held, the one picked and the levels still open", () => {
    const at15 = { classId: "warlock", level: 15 };
    const held = [...regular(13), listOf(6)[0], listOf(7)[0]];
    assert.deepEqual(arcanumSplit(at15, held), { arcanum: [listOf(6)[0], listOf(7)[0]], extra: [], open: [8] });
    assert.deepEqual(arcanumSplit(at15, [...held, listOf(7)[1]]).extra, [listOf(7)[1]], "a second 7th is no arcanum");
    assert.deepEqual(arcanumSplit({ classId: "sorcerer", level: 15 }, held), { arcanum: [], extra: [], open: [] }, "no arcanum outside the warlock");
  });
}

console.log(`\ntest-spell-list-problems: ${passed} tests passed.`);
