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
const { cantripCapOf, spellCapOf, maxSpellLevelOf } = await import("../src/lib/srd/spell-prep.ts");
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

finish();
