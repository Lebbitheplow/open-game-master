// The character creator's spells, audited class by class and spell by spell
// (the creator completeness audit, 2026-11-13): every spell a caster's book
// prints is one the player can pick, every count the class table gives is the
// count the builder, the saved sheet and the level-up hold, and no feature's
// spell is lost or counted twice.
//
// Pure: the spell lists, the counts and the checks are read straight from
// the modules the builder and the server share. With the content pack
// installed the pack's served rows are checked too; without it that half is
// skipped and the bundled checklist answers alone.
import assert from "node:assert/strict";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-creator-spells");
const { checklistSpell, checklistSpellsOn } = await import("../src/lib/srd/spell-lists.ts");
const { spellOnListKey } = await import("../src/lib/classes/class-spell-list.ts");
const { cantripCapOf, spellCapOf, maxSpellLevelOf, spellListProblems, casterViewsOf } = await import("../src/lib/srd/spell-prep.ts");
const { levelUpSpells } = await import("../src/lib/srd/level-up-spells.ts");
const { bundledSpellSupply } = await import("../src/app/characters/builder/spellSupply.ts");
const { bundledSpellFacts } = await import("../src/lib/srd/spell-facts.ts");
const { allPackSpells } = await import("../src/lib/content/index.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const { spellMechFor, parseSpellMech, authoredSpellRow } = await import("../src/lib/srd/spell-mechanics.ts");
const { conditionEffectsFor } = await import("../src/lib/srd/condition-effects.ts");

const packRows = allPackSpells();
const packRow = (name) => packRows.find((row) => textKey(row.name) === textKey(name)) ?? null;

// ---- P03: four popular spells answered by another book's namesake ----
//
// Xanathar's Frostbite and Thunderclap are cantrips, Catapult a 1st level
// spell and Power Word Pain a 7th. No open document carries them, but Deep
// Magic prints different spells under the same four names, and the checklist
// had copied those rows' numbers: a sorcerer looking for the Frostbite
// cantrip was offered a 5th level spell, and a wizard's Catapult was a 6th.
// ODM restates the four (src/lib/srd/authored-spells.json), which outrank
// any third party row of the same name.
const NAMESAKES = [
  { name: "Frostbite", level: 0, school: "evocation", classes: ["artificer", "druid", "sorcerer", "warlock", "wizard"] },
  { name: "Thunderclap", level: 0, school: "evocation", classes: ["artificer", "bard", "druid", "sorcerer", "warlock", "wizard"] },
  { name: "Catapult", level: 1, school: "transmutation", classes: ["artificer", "sorcerer", "wizard"] },
  { name: "Power Word Pain", level: 7, school: "enchantment", classes: ["sorcerer", "warlock", "wizard"] },
];

await test("P03: Frostbite, Thunderclap, Catapult and Power Word Pain are the spells players know by those names", () => {
  const wrong = [];
  for (const want of NAMESAKES) {
    const listed = checklistSpell(want.name);
    const facts = bundledSpellFacts(want.name);
    const said = (where, level, school, classes) => {
      const got = { level, school, classes: [...(classes ?? [])].map((entry) => entry.toLowerCase()).sort() };
      if (got.level !== want.level || (school !== undefined && got.school !== want.school) || got.classes.join() !== want.classes.join()) {
        wrong.push(`${want.name} (${where}): level ${got.level}, ${got.school}, ${got.classes.join("/")}`);
      }
    };
    said("checklist", listed?.level, listed?.school, listed?.classes);
    said("engine", facts?.level, undefined, facts?.classes);
    const row = packRow(want.name);
    if (packRows.length) {
      said(`pack ${row?.documentSlug}`, row?.level, row?.school, row?.classes);
    }
  }
  assert.deepEqual(wrong, []);
});

await test("P03: the four resolve in play as their own spells: the save, the damage and Power Word Pain's hold", () => {
  const mechOf = (name) => spellMechFor([name]) ?? parseSpellMech({ desc: authoredSpellRow(name)?.desc ?? "", higherLevel: authoredSpellRow(name)?.higher_level ?? "" });
  const brief = (name) => {
    const mech = mechOf(name);
    return [mech?.resolution, mech?.save, mech?.damageType ?? mech?.condition?.name ?? null].join(" ");
  };
  assert.deepEqual(
    NAMESAKES.map((want) => `${want.name}: ${brief(want.name)}`),
    ["Frostbite: save con cold", "Thunderclap: save con thunder", "Catapult: save dex bludgeoning", "Power Word Pain: save con racked with pain"],
  );
  assert.equal(mechOf("Power Word Pain").condition.hpAtMost, 100);
  const pain = conditionEffectsFor("racked with pain");
  assert.ok(pain?.attackDisadvantage && pain.speedSet === 10, "racked with pain slows and spoils attacks");
  assert.ok(!pain.disadvantageOn.some((entry) => entry.kind === "save" && entry.ability === "con"), "its Constitution saves are untouched");
});

// ---- P01: the artificer's spell list ----
//
// ODM offers the artificer beside the SRD twelve (src/lib/srd/classes.json)
// and plays it as its book prints it: a prepared caster of the artificer
// list. The checklist named the artificer on only the 24 spells the later
// books added, so a level 1 artificer could pick neither Cure Wounds nor Fire
// Bolt nor Mage Hand, with or without the content pack, and a level 3 one
// could not fill the prepared spells its table gives. The list, by level, as
// the artificer's book prints it (names only):
const ARTIFICER_LIST = {
  0: [
    "Acid Splash", "Booming Blade", "Create Bonfire", "Dancing Lights", "Fire Bolt", "Frostbite", "Green-Flame Blade",
    "Guidance", "Light", "Lightning Lure", "Mage Hand", "Magic Stone", "Mending", "Message", "Poison Spray",
    "Prestidigitation", "Ray of Frost", "Resistance", "Shocking Grasp", "Spare the Dying", "Sword Burst", "Thorn Whip",
    "Thunderclap",
  ],
  1: [
    "Absorb Elements", "Alarm", "Catapult", "Cure Wounds", "Detect Magic", "Disguise Self", "Expeditious Retreat",
    "Faerie Fire", "False Life", "Feather Fall", "Grease", "Identify", "Jump", "Longstrider", "Purify Food and Drink",
    "Sanctuary", "Snare", "Tasha's Caustic Brew",
  ],
  2: [
    "Aid", "Alter Self", "Arcane Lock", "Blur", "Continual Flame", "Darkvision", "Enhance Ability", "Enlarge/Reduce",
    "Heat Metal", "Invisibility", "Lesser Restoration", "Levitate", "Magic Mouth", "Magic Weapon",
    "Protection from Poison", "Pyrotechnics", "Rope Trick", "See Invisibility", "Skywrite", "Spider Climb", "Web",
  ],
  3: [
    "Blink", "Catnap", "Create Food and Water", "Dispel Magic", "Elemental Weapon", "Flame Arrows", "Fly",
    "Glyph of Warding", "Haste", "Intellect Fortress", "Protection from Energy", "Revivify", "Tiny Servant",
    "Water Breathing", "Water Walk",
  ],
  4: [
    "Arcane Eye", "Elemental Bane", "Fabricate", "Freedom of Movement", "Leomund's Secret Chest",
    "Mordenkainen's Faithful Hound", "Mordenkainen's Private Sanctum", "Otiluke's Resilient Sphere", "Stone Shape",
    "Stoneskin", "Summon Construct",
  ],
  5: ["Animate Objects", "Bigby's Hand", "Creation", "Greater Restoration", "Skill Empowerment", "Transmute Rock", "Wall of Stone"],
};
const ARTIFICER_ROWS = Object.entries(ARTIFICER_LIST).flatMap(([level, names]) => names.map((name) => ({ name, level: Number(level) })));

await test("P01: every spell on the artificer's list is on the artificer list the checklist offers, at its level", () => {
  const offered = new Map(checklistSpellsOn("artificer").map((spell) => [textKey(spell.name), spell.level]));
  const missing = ARTIFICER_ROWS.filter((row) => {
    const name = checklistSpell(row.name)?.name ?? row.name;
    return offered.get(textKey(name)) !== row.level;
  }).map((row) => `${row.name} (${row.level})`);
  assert.deepEqual(missing, []);
});

await test("P01: with the content pack, the artificer's search offers every spell of its list", () => {
  if (!packRows.length) {
    return;
  }
  const missing = ARTIFICER_ROWS.filter((row) => {
    const served = packRows.find(
      (entry) => [entry.name, ...entry.aliases].some((name) => textKey(name) === textKey(row.name)),
    );
    return !served || served.level !== row.level || !spellOnListKey("artificer", served);
  }).map((row) => `${row.name} (${row.level})`);
  assert.deepEqual(missing, []);
});

await test("P01: an artificer at every level has a list long enough for its cantrips and prepared spells", () => {
  const short = [];
  for (let level = 1; level <= 20; level += 1) {
    const view = { classId: "artificer", level, subclass: "", ability: "int", style: "prepared", known: [], prepared: [], cantrips: [], pending: [], spellbook: [] };
    const supply = bundledSpellSupply({ spellClass: "artificer", maxSpellLevel: maxSpellLevelOf(view), wider: { spells: [], lists: [] }, free: [] });
    const cantrips = cantripCapOf(view) ?? 0;
    const prepared = spellCapOf(view, { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 })?.count ?? 0;
    if (supply.cantrips < cantrips || supply.spells < prepared) {
      short.push(`level ${level}: ${supply.cantrips}/${cantrips} cantrips, ${supply.spells}/${prepared} spells`);
    }
  }
  assert.deepEqual(short, []);
});

// ---- P02: a warlock's Mystic Arcanum ----
//
// SRD 5.1, Warlock: at 11th level "choose one 6th-level spell from the
// warlock spell list as this arcanum", and one 7th, 8th and 9th at 13th, 15th
// and 17th. The Spells Known column stops at 5th level spells and does not
// hold them. The creation check and the level-up counted the arcanum as a
// spell known (a warlock reaching 11th gave up the level's new spell to take
// it) and let two spells of one arcanum level in.
const WARLOCK_KNOWN = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15];
const WARLOCK_SPELLS = [
  "Hex", "Armor of Agathys", "Hellish Rebuke", "Charm Person", "Comprehend Languages", "Expeditious Retreat",
  "Protection from Evil and Good", "Unseen Servant", "Witch Bolt", "Hold Person", "Misty Step", "Darkness",
  "Invisibility", "Mirror Image", "Counterspell", "Fly", "Banishment", "Dimension Door", "Hold Monster", "Scrying",
];
const ARCANA = { 6: "Circle of Death", 7: "Etherealness", 8: "Demiplane", 9: "Foresight" };
const warlockAbilities = { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 18 };
const warlockSheet = (level, known) => ({
  class: "warlock",
  level,
  subclass: "The Fiend",
  abilities: warlockAbilities,
  features: [],
  spellcasting: { ability: "cha", known, prepared: [], cantrips: ["Eldritch Blast", "Minor Illusion", "Mage Hand", "Prestidigitation"].slice(0, level >= 10 ? 4 : level >= 4 ? 3 : 2) },
});
const arcanaAt = (level) => Object.entries(ARCANA).filter(([spellLevel]) => level >= 11 + 2 * (Number(spellLevel) - 6)).map(([, name]) => name);

await test("P02: a warlock at every level 11 to 20 holds its whole Spells Known column and one arcanum of each level reached", () => {
  const problems = [];
  for (let level = 1; level <= 20; level += 1) {
    const sheet = warlockSheet(level, [...WARLOCK_SPELLS.slice(0, WARLOCK_KNOWN[level - 1]), ...arcanaAt(level)]);
    problems.push(...spellListProblems(sheet, { bookAllowance: true }).map((line) => `level ${level}: ${line}`));
  }
  assert.deepEqual(problems, []);
});

await test("P02: a second spell of an arcanum level is refused at creation, and one past the arcana reached too", () => {
  const two = spellListProblems(warlockSheet(13, [...WARLOCK_SPELLS.slice(0, 10), "Circle of Death", "True Seeing"]));
  assert.ok(two.some((line) => /Mystic Arcanum/.test(line) && /True Seeing/.test(line)), JSON.stringify(two));
  const early = spellListProblems(warlockSheet(11, [...WARLOCK_SPELLS.slice(0, 11), "Etherealness"]));
  assert.ok(early.some((line) => /Etherealness/.test(line)), JSON.stringify(early));
});

await test("P02: each arcanum level-up takes the level's new spell and its arcanum, and refuses a second arcanum", () => {
  const steps = [];
  for (const level of [11, 13, 15, 17]) {
    const before = casterViewsOf(warlockSheet(level - 1, [...WARLOCK_SPELLS.slice(0, WARLOCK_KNOWN[level - 2]), ...arcanaAt(level - 1)]))[0];
    const fresh = WARLOCK_SPELLS[WARLOCK_KNOWN[level - 2]];
    const arcanum = arcanaAt(level).at(-1);
    const result = levelUpSpells({
      before,
      level,
      subclass: "The Fiend",
      list: "warlock",
      firstLevel: false,
      abilities: warlockAbilities,
      freeCantrips: 0,
      spellOf: bundledSpellFacts,
      picks: { kind: "picks", spells: [fresh, arcanum].filter(Boolean) },
    });
    steps.push(`${level}: ${"error" in result ? result.error : "ok"}`);
  }
  assert.deepEqual(steps, ["11: ok", "13: ok", "15: ok", "17: ok"]);
  const before = casterViewsOf(warlockSheet(10, WARLOCK_SPELLS.slice(0, 10)))[0];
  const twice = levelUpSpells({
    before,
    level: 11,
    subclass: "The Fiend",
    list: "warlock",
    firstLevel: false,
    abilities: warlockAbilities,
    freeCantrips: 0,
    spellOf: bundledSpellFacts,
    picks: { kind: "picks", spells: ["Circle of Death", "True Seeing"], forget: "Hex" },
  });
  assert.match("error" in twice ? twice.error : "taken", /Mystic Arcanum/);
});

// ---- P04: the Arcane Trickster's Mage Hand ----
//
// The Arcane Trickster's Spellcasting: "You learn three cantrips: mage hand
// and two other cantrips of your choice from the wizard spell list"; Mage
// Hand Legerdemain and Versatile Trickster both work through that hand. The
// builder, the creation check and the level-up all took any three wizard
// cantrips, so a trickster could be saved without the hand its features use.
const trickster = (level, cantrips, known = ["Disguise Self", "Charm Person", "Sleep"]) => ({
  class: "rogue",
  level,
  subclass: "Arcane Trickster",
  abilities: { str: 10, dex: 16, con: 12, int: 16, wis: 10, cha: 10 },
  features: [],
  spellcasting: { ability: "int", known, prepared: [], cantrips },
});

await test("P04: an Arcane Trickster's full cantrip list holds Mage Hand, at creation and at the level that brings it", () => {
  const without = spellListProblems(trickster(3, ["Minor Illusion", "Friends", "Fire Bolt"]));
  assert.ok(without.some((line) => /Mage Hand/.test(line)), JSON.stringify(without));
  assert.deepEqual(spellListProblems(trickster(3, ["Mage Hand", "Minor Illusion", "Friends"])), []);
  assert.deepEqual(spellListProblems(trickster(3, ["Minor Illusion"])), [], "a list with room left for it is not refused");
  const knight = { ...trickster(3, ["Fire Bolt", "Light"], ["Shield", "Magic Missile", "Thunderwave"]), class: "fighter", subclass: "Eldritch Knight" };
  assert.deepEqual(spellListProblems(knight), [], "an Eldritch Knight names no cantrip");
  const rogue = casterViewsOf({ ...trickster(2, []), subclass: "" })[0] ?? { classId: "rogue", ability: "int", level: 2, subclass: "", style: "known", known: [], prepared: [], cantrips: [], pending: [], spellbook: [] };
  const up = (cantrips) =>
    levelUpSpells({
      before: { ...rogue, subclass: "", known: [], prepared: [], cantrips: [] },
      level: 3,
      subclass: "Arcane Trickster",
      list: "wizard",
      firstLevel: false,
      abilities: trickster(3, []).abilities,
      freeCantrips: 0,
      spellOf: bundledSpellFacts,
      picks: { kind: "picks", spells: [...cantrips, "Disguise Self", "Charm Person", "Sleep"] },
    });
  const refused = up(["Minor Illusion", "Friends", "Fire Bolt"]);
  assert.match("error" in refused ? refused.error : "taken", /Mage Hand/);
  const taken = up(["Mage Hand", "Minor Illusion", "Friends"]);
  assert.ok(!("error" in taken), "error" in taken ? taken.error : "");
});

// ---- P05: a subclass's own cantrips ----
//
// The Light Domain's Bonus Cantrip ("you gain the light cantrip"), the
// Celestial patron's light and sacred flame and Lunar Sorcery's sacred flame
// are known on top of the class's Cantrips Known. The creation check counted
// them in it, and the level-up filed them with the prepared or known spells,
// so a Light cleric holding three cleric cantrips and light was refused.
const withSubclass = (klass, subclass, level, ability, cantrips, known, prepared) => ({
  class: klass, subclass, level, abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 16, cha: 16 }, features: [],
  spellcasting: { ability, cantrips, known, prepared },
});

await test("P05: a subclass's cantrips sit on top of the class's at creation and are filed as cantrips at a level-up", () => {
  const sheets = [
    withSubclass("cleric", "Light Domain", 1, "wis", ["Sacred Flame", "Guidance", "Thaumaturgy", "Light"], [], ["Bless", "Cure Wounds", "Shield of Faith", "Healing Word", "Burning Hands", "Faerie Fire"]),
    withSubclass("warlock", "The Celestial", 1, "cha", ["Eldritch Blast", "Minor Illusion", "Light", "Sacred Flame"], ["Hex", "Cure Wounds"], []),
    withSubclass("sorcerer", "Lunar Sorcery", 1, "cha", ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation", "Sacred Flame"], ["Magic Missile", "Sleep"], []),
  ];
  assert.deepEqual(sheets.flatMap((sheet) => spellListProblems(sheet).map((line) => `${sheet.subclass}: ${line}`)), []);
  const fresh = { classId: "cleric", ability: "wis", level: 0, subclass: "", style: "prepared", known: [], prepared: [], cantrips: [], pending: [], spellbook: [] };
  const first = levelUpSpells({
    before: fresh, level: 1, subclass: "Light Domain", list: "cleric", firstLevel: true, abilities: sheets[0].abilities, freeCantrips: 0,
    spellOf: bundledSpellFacts, picks: { kind: "picks", spells: ["Sacred Flame", "Guidance", "Thaumaturgy", "Bless"] },
  });
  assert.ok(!("error" in first), "error" in first ? first.error : "");
  assert.ok(first.view.cantrips.includes("Light") && !first.view.prepared.includes("Light"), JSON.stringify(first.view));
  const celestial = levelUpSpells({
    before: { ...fresh, classId: "warlock", ability: "cha", style: "known" }, level: 1, subclass: "The Celestial", list: "warlock", firstLevel: true,
    abilities: sheets[1].abilities, freeCantrips: 0, spellOf: bundledSpellFacts, picks: { kind: "picks", spells: ["Eldritch Blast", "Minor Illusion", "Hex", "Cure Wounds"] },
  });
  assert.ok(!("error" in celestial), "error" in celestial ? celestial.error : "");
  assert.deepEqual([...celestial.view.cantrips].sort(), ["Eldritch Blast", "Light", "Minor Illusion", "Sacred Flame"]);
});

finish();
