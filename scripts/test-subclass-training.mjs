// What a subclass trains its character in reaches the training the engines
// read (issue 251). A Life Domain cleric's sheet listed "Bonus Proficiency
// (heavy armor)" while proficiencies.armor had no heavy armor, so the chain
// mail its own kit offers counted as untrained and the cast guard refused
// every spell. The grants are applied where a character is made, edited,
// brought to a table, levelled and repaired at boot (src/lib/srd/
// subclass-training.ts).
import assert from "node:assert/strict";
import { hasPack } from "./lib/enforce-world.mjs";
import { openCreation, LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-subclass-training");

const training = await import("../src/lib/srd/subclass-training.ts");
const srd = await import("../src/lib/srd/index.ts");
const features = await import("../src/lib/srd/features.ts");
const { wearsUntrainedArmor } = await import("../src/lib/srd/armor.ts");
const { casterStateProblem } = await import("../src/lib/dm/cast-rules.ts");
const { buildLevelUp } = await import("../src/lib/srd/level-up.ts");
const { keyedFeatChoices } = await import("../src/lib/schemas/sheet.ts");

await test("Every entry of the training table names a real feature of a real subclass.", () => {
  const missing = training.trainingTableKeys().filter((key) => {
    const [classId, subclass, feature] = key.split("|");
    return !features.classFeaturesFor(classId, subclass, 20).some((entry) => entry.name.toLowerCase() === feature);
  });
  assert.deepEqual(missing, []);
});

await test("The grants arrive at the class level their feature does, and only then.", () => {
  // The subclass's own: a ranger's Favored Enemy language is its class's.
  const at = (classId, subclass, level) => training.subclassGrants([{ id: classId, subclass, level }]).filter((grant) => grant.subclass);
  assert.deepEqual(at("cleric", "Life Domain", 1).map((grant) => grant.spec.armor), [["heavy"]]);
  assert.equal(at("bard", "College of Lore", 2).length, 0, "Lore's skills come at bard 3");
  assert.equal(at("bard", "College of Lore", 3)[0].spec.skills, 3);
  assert.equal(at("ranger", "Gloom Stalker", 6).length, 0, "Iron Mind comes at ranger 7");
  assert.deepEqual(at("ranger", "Gloom Stalker", 7)[0].saves, { save: "wis", otherwise: ["int", "cha"] });
  const knowledge = at("cleric", "Knowledge Domain", 1)[0].spec;
  assert.deepEqual([knowledge.skills, knowledge.languages, knowledge.pickedExpertise], [2, 2, true]);
  assert.deepEqual(knowledge.skillsFrom, ["arcana", "history", "nature", "religion"]);
  const hexblade = at("warlock", "The Hexblade", 1)[0].spec;
  assert.deepEqual([hexblade.armor, hexblade.fixedWeapons], [["medium", "shields"], ["martial"]]);
  assert.equal(at("cleric", "Light Domain", 20).length, 0, "a subclass with no training grants none");
  // The Knowledge Domain's ten minutes and the Phantom's "after each rest"
  // are not lasting training.
  assert.equal(at("rogue", "Phantom", 20).length, 0);
});

await test("A feature's text grants its training when the subclass is a pack's or a workshop's.", () => {
  const storm = training.trainingFromText("Bonus Proficiency", "When you choose this domain at 1st level, you gain proficiency with heavy armor as well as with martial weapons.");
  assert.deepEqual([storm.armor, storm.fixedWeapons], [["heavy"], ["martial"]]);
  const terse = training.trainingFromText("Bonus Proficiencies (Oath of Ash)", "Proficiency with medium armor, shields and martial weapons.");
  assert.deepEqual([terse.armor.sort(), terse.fixedWeapons], [["medium", "shields"], ["martial"]]);
  const tools = training.trainingFromText("Bonus Proficiencies", "At 3rd level, you gain proficiency with thieves' tools and mason's tools.");
  assert.deepEqual(tools.fixedTools.sort(), ["mason's tools", "thieves' tools"]);
  assert.equal(training.trainingFromText("Channel Divinity: Knowledge", "Gain proficiency with one skill or tool of your choice for 10 minutes."), null);
  assert.equal(training.trainingFromText("Divine Strike", "Once per turn a weapon hit deals an extra 1d8 damage."), null, "only features named for training");
});

if (hasPack) {
  await test("The content pack's archetypes grant their training (Storm Domain, Tunnel Watcher).", async () => {
    const { packSubclassExtras } = await import("../src/lib/content/archetype-tables.ts");
    const extras = packSubclassExtras();
    const storm = training.subclassGrants([{ id: "cleric", subclass: "Storm Domain", level: 1 }], extras);
    assert.ok(storm.some((grant) => grant.spec.armor.includes("heavy") && grant.spec.fixedWeapons.includes("martial")), JSON.stringify(storm.map((grant) => grant.name)));
    const watcher = training.subclassGrants([{ id: "fighter", subclass: "Tunnel Watcher", level: 3 }], extras);
    assert.ok(watcher.some((grant) => grant.spec.fixedTools.includes("mason's tools")), JSON.stringify(watcher.map((grant) => grant.name)));
  });
}

// The reporter's character: a level 1 human acolyte Life Domain cleric with
// the kit's chain mail, made in the library and brought to a table.
const creation = await openCreation();
const CLERIC = {
  ...LEGAL_FIGHTER,
  name: "Sister Ama",
  race: "human",
  class: "cleric",
  subclass: "Life Domain",
  background: "acolyte",
  abilities: { str: 15, dex: 11, con: 14, int: 9, wis: 16, cha: 13 },
  maxHp: 10,
  ac: 18,
  hitDice: { die: "d8", total: 1, spent: 0 },
  proficiencies: {
    saves: ["wis", "cha"],
    skills: ["insight", "religion", "history", "medicine"],
    expertise: [],
    languages: ["Common", "Elvish", "Dwarvish", "Celestial"],
    tools: [],
    armor: ["light", "medium", "shields"],
    weapons: ["simple"],
  },
  equipment: [
    { name: "Mace", qty: 1 },
    { name: "Chain Mail", qty: 1 },
    { name: "Shield", qty: 1 },
  ],
  features: [],
  kitChoices: { options: [0, 2, 0, 0, 0], picks: [] },
  spellcasting: { ability: "wis", slots: { 1: { max: 2, used: 0 } }, prepared: ["Bless", "Cure Wounds", "Healing Word", "Guiding Bolt"], known: [], cantrips: ["Sacred Flame", "Guidance", "Light"] },
  portrait: PORTRAIT,
};

await test("A Life Domain cleric made in the library holds heavy armor, and casts in the kit's chain mail.", async () => {
  const made = await creation.throughLibrary(CLERIC, 1);
  assert.equal(made.status, 201, made.error);
  assert.ok(made.character.sheet.proficiencies.armor.includes("heavy"), "the library copy has no heavy armor");
  assert.ok(made.sheet.proficiencies.armor.includes("heavy"), "the table copy has no heavy armor");
  assert.ok(made.sheet.features.some((feature) => feature.name === "Bonus Proficiency (heavy armor)"));
  assert.equal(wearsUntrainedArmor(made.sheet), false, "the chain mail reads as untrained armor");
  assert.equal(casterStateProblem(made.sheet), null, "the cast guard still refuses the cleric");
  // Every other grant stays: the class's, the background's, the race's.
  for (const armor of ["light", "medium", "shields"]) {
    assert.ok(made.sheet.proficiencies.armor.includes(armor), armor);
  }
  assert.deepEqual(made.sheet.proficiencies.weapons, ["simple"]);
});

await test("Without the domain the same chain mail is still untrained armor, and the guard still says so.", async () => {
  const made = await creation.throughLibrary({ ...CLERIC, subclass: "Light Domain", kitChoices: { options: [0, 0, 0, 0, 0], picks: [] }, equipment: [{ name: "Mace", qty: 1 }, { name: "Shield", qty: 1 }] }, 1);
  assert.equal(made.status, 201, made.error);
  assert.ok(!made.sheet.proficiencies.armor.includes("heavy"));
  const inMail = { ...made.sheet, equipment: [...made.sheet.equipment, { name: "Chain Mail", qty: 1, equipped: true }] };
  assert.equal(wearsUntrainedArmor(inMail), true);
  assert.match(casterStateProblem(inMail)?.error ?? "", /not trained in/);
});

// A level 3 bard, standard array, made at the table.
const BARD = {
  ...LEGAL_FIGHTER,
  name: "Wren",
  race: "human",
  class: "bard",
  subclass: "College of Lore",
  background: "entertainer",
  abilities: { str: 9, dex: 15, con: 14, int: 11, wis: 13, cha: 16 },
  maxHp: 8 + 2 + 2 * (5 + 2),
  ac: 13,
  hitDice: { die: "d8", total: 3, spent: 0 },
  proficiencies: {
    saves: ["dex", "cha"],
    skills: ["acrobatics", "performance", "deception", "persuasion", "insight"],
    expertise: ["performance", "persuasion"],
    languages: ["Common", "Elvish"],
    tools: ["disguise kit", "lute", "drum", "flute", "lyre"],
    armor: ["light"],
    weapons: ["simple", "hand crossbow", "longsword", "rapier", "shortsword"],
  },
  equipment: [],
  features: [],
  spellcasting: null,
};

await test("A Lore bard made at level 3 names its three skills, and the server holds it to them.", async () => {
  const library = creation.libraryRoute;
  creation.world.signIn(creation.player);
  const without = await creation.call(library, "POST", { level: 3, sheet: BARD });
  assert.equal(without.status, 400);
  assert.match(without.json.error, /Bonus Proficiencies \(Lore\): pick 3 skills/);
  const withPicks = await creation.call(library, "POST", {
    level: 3,
    sheet: { ...BARD, featChoices: { "bonus proficiencies (lore)": { skills: ["arcana", "history", "stealth"] } } },
  });
  assert.equal(withPicks.status, 201, withPicks.json.error);
  const skills = withPicks.json.character.sheet.proficiencies.skills;
  for (const skill of ["arcana", "history", "stealth"]) {
    assert.ok(skills.includes(skill), `${skill} missing from ${skills.join(", ")}`);
  }
});

// Level-up, through the builder every level goes through.
const { classGrantsFor } = await import("../src/lib/characters/catalog.ts");
const levelContext = async (extra = {}) => ({
  hpMethod: "average",
  multiclassAllowed: true,
  classOf: classGrantsFor,
  racialCantrips: 0,
  spellOf: () => null,
  featOf: () => null,
  subclassOffered: () => true,
  rollDie: () => 1,
  ...extra,
});

const bardAt2 = {
  id: "s1", campaignId: "c1", userId: "u1", name: "Wren", race: "human", class: "bard", subclass: "", level: 2, xp: 900,
  background: "entertainer", classes: [], abilities: { str: 9, dex: 15, con: 14, int: 11, wis: 13, cha: 16 },
  maxHp: 17, currentHp: 17, tempHp: 0, ac: 13, speed: 30, hitDice: { die: "d8", total: 2, spent: 0 }, hitDicePools: null,
  proficiencies: { saves: ["dex", "cha"], skills: ["acrobatics", "performance", "deception"], expertise: [], languages: ["Common"], tools: [], armor: ["light"], weapons: ["simple"] },
  equipment: [], gold: 0, feats: [], features: features.populateFeatures([], "bard", "", "human", 2), spellcasting: null, conditions: [], conditionMeta: {}, resources: {},
};
const levelRequest = (extra = {}) => ({ level: 3, subclass: "College of Lore", maxHp: 22, currentHp: 22, hitDice: { die: "d8", total: 3, spent: 0 }, ...extra });

await test("A bard who takes College of Lore at level 3 is asked for the three skills, and gets them.", async () => {
  const context = await levelContext();
  const refused = buildLevelUp(bardAt2, levelRequest(), context);
  assert.ok("error" in refused);
  assert.match(refused.error, /Bonus Proficiencies \(Lore\): pick 3 skills/);
  const taken = buildLevelUp(bardAt2, levelRequest({ featChoices: keyedFeatChoices({ "Bonus Proficiencies (Lore)": { skills: ["arcana", "history", "stealth"] } }) }), context);
  assert.ok(!("error" in taken), taken.error);
  for (const skill of ["arcana", "history", "stealth", "acrobatics"]) {
    assert.ok(taken.patch.proficiencies.skills.includes(skill), skill);
  }
});

await test("A companion levelling into College of Lore takes its skills on its own.", async () => {
  const taken = buildLevelUp(bardAt2, levelRequest(), await levelContext({ autoPicks: true }));
  assert.ok(!("error" in taken), taken.error);
  assert.equal(taken.patch.proficiencies.skills.length, bardAt2.proficiencies.skills.length + 3);
});

await test("A wizard multiclassing into a Life Domain cleric gains heavy armor with the domain.", async () => {
  const wizard = {
    ...bardAt2, class: "wizard", classes: [], level: 2, abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 14, cha: 8 },
    proficiencies: { saves: ["int", "wis"], skills: ["arcana", "history"], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: ["dagger", "dart", "sling", "quarterstaff", "light crossbow"] },
    features: features.populateFeatures([], "wizard", "", "human", 2),
  };
  const taken = buildLevelUp(wizard, { level: 3, levelUpClass: "cleric", subclass: "Life Domain", maxHp: 20, currentHp: 20, hitDice: wizard.hitDice }, await levelContext());
  assert.ok(!("error" in taken), taken.error);
  const held = taken.patch.proficiencies.armor.map((entry) => entry.replace(/ armor$/, ""));
  for (const armor of ["light", "medium", "shields", "heavy"]) {
    assert.ok(held.includes(armor), `${armor}: ${taken.patch.proficiencies.armor.join(", ")}`);
  }
});

await test("A Gloom Stalker reaching 7 gains Wisdom saves, or Intelligence or Charisma when Wisdom is held.", async () => {
  const ranger = {
    ...bardAt2, class: "ranger", subclass: "Gloom Stalker", level: 6, xp: 23000,
    proficiencies: { ...bardAt2.proficiencies, saves: ["str", "dex"] },
    features: features.populateFeatures([], "ranger", "Gloom Stalker", "human", 6),
  };
  const taken = buildLevelUp(ranger, { level: 7, maxHp: 60, currentHp: 60, hitDice: { die: "d10", total: 7, spent: 0 } }, await levelContext());
  assert.ok(!("error" in taken), taken.error);
  assert.ok(taken.patch.proficiencies.saves.includes("wis"));
  const wise = { ...ranger, proficiencies: { ...ranger.proficiencies, saves: ["str", "wis"] }, abilities: { ...ranger.abilities, int: 8, cha: 16 } };
  const instead = buildLevelUp(wise, { level: 7, maxHp: 60, currentHp: 60, hitDice: { die: "d10", total: 7, spent: 0 } }, await levelContext());
  assert.ok(!("error" in instead), instead.error);
  assert.ok(instead.patch.proficiencies.saves.includes("cha"), "the better of Intelligence and Charisma");
});

await test("A sheet stored before the fix gains its earned training, and keeps everything it held.", () => {
  const stored = {
    proficiencies: { saves: ["wis", "cha"], skills: ["insight"], expertise: [], languages: ["Common"], tools: ["herbalism kit"], armor: ["light", "medium", "shields"], weapons: ["simple", "Longsword"] },
  };
  const repaired = training.repairedTraining(stored, [{ id: "cleric", subclass: "Life Domain", level: 5 }]);
  assert.deepEqual(repaired.armor, ["light", "medium", "shields", "heavy"]);
  for (const kind of ["saves", "skills", "languages", "tools", "weapons"]) {
    assert.deepEqual(repaired[kind], stored.proficiencies[kind], kind);
  }
  assert.equal(training.repairedTraining({ proficiencies: repaired }, [{ id: "cleric", subclass: "Life Domain", level: 5 }]), null, "a repaired sheet is left alone");
  assert.equal(training.repairedTraining(stored, [{ id: "cleric", subclass: "Light Domain", level: 5 }]), null);
});

await test("The boot resync repairs a Life Domain cleric already in play, and a library character.", async () => {
  const world = creation.world;
  const hero = world.addHero({ name: "Old Cleric", class: "cleric", subclass: "Life Domain", level: 2 });
  const { getDatabase, resyncSheets } = await import("../src/lib/db/core.ts");
  const before = { saves: ["wis", "cha"], skills: [], expertise: [], languages: ["Common"], tools: [], armor: ["light", "medium", "shields"], weapons: ["simple"] };
  // A sheet from before the fix, as the database holds it.
  getDatabase().prepare(`UPDATE character_sheets SET proficiencies_json = ? WHERE id = ?`).run(JSON.stringify(before), hero.id);
  assert.ok(!world.sheet(hero.id).proficiencies.armor.includes("heavy"));
  const made = await creation.throughLibrary(CLERIC, 1);
  const row = getDatabase().prepare(`SELECT sheet_json FROM library_characters WHERE id = ?`).get(made.character.id);
  const stale = JSON.parse(row.sheet_json);
  stale.proficiencies.armor = ["light", "medium", "shields"];
  getDatabase().prepare(`UPDATE library_characters SET sheet_json = ? WHERE id = ?`).run(JSON.stringify(stale), made.character.id);
  resyncSheets(getDatabase());
  assert.deepEqual(world.sheet(hero.id).proficiencies.armor, ["light", "medium", "shields", "heavy"]);
  assert.deepEqual(world.sheet(hero.id).proficiencies.weapons, ["simple"], "nothing else changed");
  const repaired = JSON.parse(getDatabase().prepare(`SELECT sheet_json FROM library_characters WHERE id = ?`).get(made.character.id).sheet_json);
  assert.ok(repaired.proficiencies.armor.includes("heavy"), "the library character was not repaired");
});

await test("A03 A subclass language given 'or another if you already know it' becomes a pick of another for a character who speaks it (Path of the Giant's Giant, a Drakewarden's Draconic).", async () => {
  const subclassesJson = (await import("../src/lib/srd/subclasses.json", { with: { type: "json" } })).default;
  const problems = [];
  let walked = 0;
  for (const [classId, entries] of Object.entries(subclassesJson.classes)) {
    for (const entry of entries) {
      for (const [level, rows] of Object.entries(entry.levels)) {
        for (const row of rows) {
          const named = /\b(?:learn|speak, read and write)\s+(?:to speak, read and write\s+)?([A-Z][a-z]+),? or another language if you already (?:know|speak) it/.exec(row.d);
          if (!named) continue;
          walked += 1;
          const grants = training.subclassGrants([{ id: classId, subclass: entry.name, level: Number(level) }]).filter((grant) => grant.name === row.n);
          const settled = training.grantsForHeldTraining(grants, { skills: [], languages: ["Common", named[1]] });
          const spec = settled[0]?.spec;
          if (!spec || spec.fixedLanguages.includes(named[1]) || spec.languages !== 1) {
            problems.push(`${entry.name}: ${row.n} gives ${named[1]} again to one who speaks it`);
          }
        }
      }
    }
  }
  assert.ok(walked >= 2, `only ${walked} such features were walked`);
  assert.deepEqual(problems, []);
});

// SRD 5.1, Backgrounds: a proficiency gained twice is a different one of the
// same kind instead. A Peace cleric whose class, background and race already
// gave Insight, Performance and Persuasion owed Implement of Peace's skill
// with nothing on its list left (the merged builder sweep found it on a pack
// species that trains Performance).
await test("A training pick whose whole list is held already is a pick of any skill.", () => {
  const grants = training.subclassGrants([{ id: "cleric", subclass: "Peace Domain", level: 1 }]).filter((grant) => grant.name === "Implement of Peace");
  assert.equal(grants.length, 1);
  const full = training.grantsForHeldTraining(grants, { skills: ["insight", "performance", "persuasion", "religion"] });
  assert.deepEqual(full[0].spec.skillsFrom, [], "every listed skill held: any skill");
  const open = training.grantsForHeldTraining(grants, { skills: ["insight", "religion"] });
  assert.deepEqual(open[0].spec.skillsFrom, ["insight", "performance", "persuasion"], "one still open: the list stands");
});

// Black Flag's Metallurgist (Juggernaut, Mechanist 11): "While wearing the
// armor from your Mystic Metal feature, you have proficiency in the Athletics
// skill." Athletics while the suit is on and not otherwise: the derived sheet
// adds the proficiency only in it and lists the training as conditional, and
// it never lands in proficiencies.skills, where it would hold out of armor.
await test("The Metallurgist's Athletics holds while its armor is worn, and only then.", () => {
  const { computeSheetDerived, proficiencyBonus } = srd;
  const sheet = (equipped) => ({
    class: "mechanist",
    subclass: "Metallurgist",
    level: 11,
    abilities: { str: 16, dex: 12, con: 14, int: 16, wis: 10, cha: 10 },
    proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: ["light", "medium", "heavy"], weapons: [] },
    features: [{ name: "Juggernaut", source: "class", classId: "mechanist" }],
    equipment: [{ name: "Chain Mail", qty: 1, equipped }],
    conditions: [],
  });
  const worn = computeSheetDerived(sheet(true));
  const bare = computeSheetDerived(sheet(false));
  assert.equal(worn.skills.athletics, 3 + proficiencyBonus(11), "in the suit: Strength and proficiency");
  assert.equal(bare.skills.athletics, 3, "out of it: Strength alone");
  const listed = (derived) => (derived.conditionalTraining ?? []).map((entry) => `${entry.skill}:${entry.by}:${entry.active}`);
  assert.deepEqual(listed(worn), ["athletics:Juggernaut:true"]);
  assert.deepEqual(listed(bare), ["athletics:Juggernaut:false"], "the sheet still lists the training, as conditional");
  assert.match(worn.conditionalTraining[0].while, /armor/i);
  const other = computeSheetDerived({ ...sheet(true), class: "fighter", features: [{ name: "Juggernaut", source: "class", classId: "fighter" }] });
  assert.equal(other.skills.athletics, 3, "another class's feature of the same name trains nothing");
});

creation.world.close();
finish();
