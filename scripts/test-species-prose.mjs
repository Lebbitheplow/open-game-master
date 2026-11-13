// A content pack species plays the rules its text states, not only the
// names of its traits.
//
// Every race row of the pack outside the bundled documents (Tome of Heroes'
// 40, Open5e's Stoor Halfling) is in fixtures/pack-species-rows.json, so the
// sweep runs without a pack. Before src/lib/content/species-prose-logic.ts
// these species reached the sheet as trait names only: a darakhul saw
// nothing in the dark, resisted no necrotic or poison damage, had no bite and
// no advantage against being charmed; a derro's 120 feet of darkvision and
// every "You have proficiency in the X skill" were lost. The table below is
// what each option's text states, read by hand, and each line is checked
// where an engine reads it: the board's darkvision, the damage engine's
// resistances, the roll engine's save advantages, set_condition's
// immunities, pc_attack's natural weapons, the board's swimming, the hit
// point bonus, the builder's skills, and the server's check of a new
// character (sheet-legality.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { packRaceOptions, speciesRulesOf } = await import("../src/lib/content/race-options.ts");
const { darkvisionTilesFromText } = await import("../src/lib/battlemap/los.ts");
const { pcResistances } = await import("../src/lib/dm/pc-defenses.ts");
const { traitSaveAdvantages, featureConditionImmunities } = await import("../src/lib/srd/trait-rules.ts");
const { racialNaturalWeapon } = await import("../src/lib/srd/racial-weapons.ts");
const { swimsFrom } = await import("../src/lib/battlemap/types.ts");
const { hpBonusPerLevel } = await import("../src/lib/srd/race-id.ts");
const { toolProficiencyBonus } = await import("../src/lib/dm/roll-riders.ts");

const { races } = JSON.parse(readFileSync(new URL("./fixtures/pack-species-rows.json", import.meta.url), "utf8"));
const options = packRaceOptions(races);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// What each text states. dv: darkvision in feet; resist: damage types;
// saves: what saves have advantage against; spellSaves: abilities whose
// saves against spells have advantage; disease: immune; weapon: [name,
// damage]; swim: a swimming speed; skills: granted outright; hp: per level.
const DARAKHUL = { dv: 60, resist: ["necrotic", "poison"], saves: ["charmed", "poisoned"], disease: true, weapon: ["bite", "1d4 piercing"] };
const GEARFORGED = { dv: 0, resist: ["poison"], saves: ["poisoned"], disease: true };
const MUSHROOMFOLK = { dv: 60, resist: ["poison"], saves: ["poisoned"], disease: true, skills: ["survival"] };
const DERRO = { dv: 120, spellSaves: ["con"] };
const DROW = { dv: 120, saves: ["charmed"], spellSaves: ["int", "wis", "cha"] };
const CATFOLK = { dv: 60, weapon: ["claws", "1d4 slashing"], skills: ["perception", "stealth"] };
const MINOTAUR = { dv: 60, weapon: ["horns", "1d6 piercing"] };
const with_ = (base, more) => ({ ...base, ...more, skills: [...(base.skills ?? []), ...(more.skills ?? [])], saves: [...(base.saves ?? []), ...(more.saves ?? [])], resist: [...(base.resist ?? []), ...(more.resist ?? [])] });
const STATED = {
  "derro-heritage": DARAKHUL, "dragonborn-heritage": DARAKHUL, "drow-heritage": DARAKHUL,
  "dwarf-heritage": with_(DARAKHUL, { hp: 1 }), "elfshadow-fey-heritage": with_(DARAKHUL, { skills: ["perception"] }),
  "gnome-heritage": DARAKHUL, "halfling-heritage": DARAKHUL, "humanhalf-elf-heritage": DARAKHUL, "kobold-heritage": DARAKHUL,
  ravenfolk: DARAKHUL, "tiefling-heritage": DARAKHUL, "trollkin-heritage": DARAKHUL,
  "dwarf-chassis": GEARFORGED, "gnome-chassis": GEARFORGED, "human-chassis": GEARFORGED, "kobold-chassis": GEARFORGED,
  "acid-cap": with_(MUSHROOMFOLK, { resist: ["acid"], skills: ["athletics"] }), favored: with_(MUSHROOMFOLK, { skills: ["persuasion"] }),
  morel: with_(MUSHROOMFOLK, { skills: ["stealth"] }),
  derro: DERRO, "far-touched": with_(DERRO, { saves: ["charmed", "frightened"] }), mutated: with_(DERRO, { skills: ["athletics"] }),
  uncorrupted: with_(DERRO, { resist: ["psychic"], skills: ["insight"] }),
  "toh-drow": DROW, delver: DROW, "fever-bit": with_(DROW, { resist: ["necrotic"], disease: true, saves: ["frightened"] }), purified: DROW,
  catfolk: CATFOLK, malkin: with_(CATFOLK, { skills: ["investigation"] }), pantheran: CATFOLK,
  minotaur: MINOTAUR, "bhain-kwai": with_(MINOTAUR, { swim: true }), boghaid: with_(MINOTAUR, { saves: ["cold"], skills: ["performance"] }),
  alseid: { dv: 60, skills: ["stealth"] },
  erina: { dv: 60, resist: ["poison"], saves: ["poisoned"], skills: ["perception"] },
  satarre: { dv: 60, resist: ["necrotic"], skills: ["arcana"] },
  // A shade is offered once per Living Origin.
  ...Object.fromEntries(["human", "dwarf", "elf", "halfling", "gnome", "half-elf", "half-orc", "dragonborn", "tiefling"].map((origin) => [`shade-${origin}-origin`, { dv: 60, resist: ["necrotic"], saves: ["poisoned"] }])),
  "stoor-halfling": { dv: 0, resist: ["poison"], saves: ["poisoned"] },
};

const features = (option) => option.traitNames.map((name) => ({ name, source: "race" }));
const hero = (option) => ({ race: option.id, features: features(option), class: "fighter", level: 1 });

test("every pack species is in the table: a new row is read by hand before this passes", () => {
  assert.deepEqual(options.map((option) => option.id).filter((id) => !STATED[id]).sort(), []);
  assert.deepEqual(Object.keys(STATED).filter((id) => !options.some((option) => option.id === id)).sort(), []);
});

test("every pack species' darkvision reaches the board's sight at its range", () => {
  const wrong = options.filter((option) => darkvisionTilesFromText(option.traitNames) * 5 !== STATED[option.id].dv)
    .map((option) => `${option.id}: ${darkvisionTilesFromText(option.traitNames) * 5} ft, its text ${STATED[option.id].dv}`);
  assert.deepEqual(wrong, []);
});

test("every damage a pack species' text resists reaches the damage engine", () => {
  const wrong = [];
  for (const option of options) {
    const held = pcResistances({ race: option.id, features: features(option) }).split(", ").filter(Boolean).sort();
    const want = [...new Set(STATED[option.id].resist ?? [])].sort();
    if (JSON.stringify(held) !== JSON.stringify(want)) wrong.push(`${option.id}: resists [${held}], its text [${want}]`);
  }
  assert.deepEqual(wrong, []);
});

test("every save a pack species' text gives advantage on is rolled with it, and no other", () => {
  const wrong = [];
  for (const option of options) {
    const stated = STATED[option.id];
    for (const against of [...new Set(stated.saves ?? [])]) {
      const ability = against === "poisoned" ? "con" : against === "cold" ? "dex" : "wis";
      if (!traitSaveAdvantages(hero(option), ability, { against }).length) wrong.push(`${option.id}: no advantage against ${against}`);
    }
    for (const ability of stated.spellSaves ?? []) {
      if (!traitSaveAdvantages(hero(option), ability, { magical: true }).length) wrong.push(`${option.id}: no advantage on ${ability} saves against spells`);
    }
    // A plain Strength save against nothing in particular stays plain.
    if (traitSaveAdvantages(hero(option), "str", {}).length) wrong.push(`${option.id}: advantage on a plain Strength save`);
  }
  assert.deepEqual(wrong, []);
});

test("a pack species immune to disease cannot be given a disease", () => {
  const wrong = options.filter((option) => featureConditionImmunities(hero(option)).conditions.some((entry) => entry.condition === "diseased") !== Boolean(STATED[option.id].disease))
    .map((option) => option.id);
  assert.deepEqual(wrong, []);
});

test("a pack species' natural weapon strikes with its own die and damage", () => {
  const wrong = [];
  for (const option of options) {
    const [name, damage] = STATED[option.id].weapon ?? [];
    const found = name ? racialNaturalWeapon(features(option), name) : null;
    if (name && found?.srd.damage !== damage) wrong.push(`${option.id}: ${name} ${found?.srd.damage ?? "none"}, its text ${damage}`);
  }
  assert.deepEqual(wrong, []);
});

test("a pack species' swimming speed, skills and extra hit points reach the sheet's readers", () => {
  const wrong = [];
  for (const option of options) {
    const stated = STATED[option.id];
    if (swimsFrom(undefined, features(option)) !== Boolean(stated.swim)) wrong.push(`${option.id}: swims ${!stated.swim}`);
    const missing = (stated.skills ?? []).filter((skill) => !(option.skills ?? []).includes(skill));
    if (missing.length) wrong.push(`${option.id}: no ${missing.join(", ")}`);
    if (hpBonusPerLevel(option.id, speciesRulesOf(option)) !== (stated.hp ?? 0)) wrong.push(`${option.id}: ${hpBonusPerLevel(option.id, speciesRulesOf(option))} hp a level`);
  }
  assert.deepEqual(wrong, []);
});

test("a pack species' picks and racial spells are what its text offers", () => {
  const pick = (id) => options.find((option) => option.id === id);
  assert.deepEqual(pick("pantheran").skillChoice, { count: 1, from: ["insight", "medicine", "nature", "survival"] });
  assert.deepEqual(pick("purified").skillChoice, { count: 2, from: ["history", "insight", "performance", "persuasion"] });
  assert.deepEqual(pick("satarre").skillChoice, { count: 1, from: ["history", "insight", "religion"] });
  assert.deepEqual(pick("boghaid").toolChoice, { count: 1, from: ["bagpipes", "drum", "horn", "shawm"] });
  assert.equal(pick("humanhalf-elf-heritage").skillChoice.count, 2);
  assert.equal(pick("humanhalf-elf-heritage").toolChoice.count, 1);
  assert.deepEqual(pick("delver").armor, ["light"]);
  assert.deepEqual(pick("dwarf-chassis").armor, ["light", "medium"]);
  const spells = (id) => pick(id).spells?.spells.map((row) => `${row.spell}@${row.level}`);
  assert.deepEqual(spells("far-touched"), ["Vicious Mockery@1", "Enthrall@3", "Fear@5"]);
  assert.deepEqual(spells("purified"), ["Poison Spray@1", "Suggestion@3", "Tongues@5"]);
  assert.deepEqual(spells("favored"), ["Spare the Dying@1", "Bless@3"]);
  assert.deepEqual(spells("derro-heritage"), ["True Strike@1"]);
  assert.equal(pick("purified").spells.ability, "int");
});

test("every pack species walks at the speed its text states", () => {
  // Tome of Heroes' drow prints "Your base walking speed is 30 feet." over a
  // speed field of 25; the text is the rule.
  const wrong = [];
  for (const option of options) {
    const row = races.find((entry) => entry.slug === option.slug);
    const parent = races.find((entry) => entry.slug === row.data.parent_slug);
    const stated = /\bwalking speed (?:is|of) (\d+) feet\b/i.exec(String(row.data.speed_desc ?? parent?.data.speed_desc ?? ""))?.[1];
    if (stated && option.speed !== Number(stated)) wrong.push(`${option.id}: ${option.speed} ft, its text ${stated}`);
  }
  assert.deepEqual(wrong, []);
});

// The server's check of a new character (sheet-legality.ts) stores what the
// builder made of the option: the lines as racial features, the training.
const { openBuilder } = await import("./lib/enforce-builder.mjs");
const { legalizeSheet } = await import("../src/lib/srd/sheet-legality.ts");
const { bundledPrices } = await import("../src/lib/srd/starting-wealth.ts");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { bundledSubclassName } = await import("../src/lib/srd/features.ts");
const builder = await openBuilder();
test("a darakhul of shadow fey heritage is stored with its darkvision, resistances, bite, save advantages and Perception", () => {
  const race = options.find((option) => option.id === "elfshadow-fey-heritage");
  const built = builder.build({
    race, class: "fighter", background: "soldier", level: 1, scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    chosenSkills: ["acrobatics", "survival"], stylePicks: ["defense"], bonusLanguages: ["Elvish"],
  });
  assert.equal(built.blocker, null, built.blocker?.message);
  const { sheet } = legalizeSheet(built.sheet, {
    door: "library", level: 1, hpMethod: "average", startingWealth: "equipment",
    classOf: (id) => builder.classes.find((entry) => entry.id === id) ?? null,
    race, background: builder.backgrounds.find((entry) => entry.id === "soldier") ?? null,
    baseline: null, abilityPool: null, wealthRoll: null, priceOf: bundledPrices, spellOf: checklistSpell, featOf: () => null,
    subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)), rollDie: () => 3,
  });
  const raceFeatures = sheet.features.filter((feature) => feature.source === "race").map((feature) => feature.name);
  for (const line of ["Darkvision 60 ft", "Necrotic Resistance", "Poison Resistance", "Disease Immunity", "Bite (1d4 piercing unarmed strike)", "Saves with advantage against charmed, poisoned", "Undead Resilience", "Supernatural Senses"]) {
    assert.ok(raceFeatures.includes(line), `stored without "${line}": ${raceFeatures.join(" | ")}`);
  }
  assert.ok(sheet.proficiencies.skills.includes("perception"), "Supernatural Senses' Perception");
});

// The weapons a pack species' text lets the player name: asked in the
// builder, held to the list by the server, and on the stored sheet.
const legal = (race, built) =>
  legalizeSheet(built.sheet, {
    door: "library", level: 1, hpMethod: "average", startingWealth: "equipment",
    classOf: (id) => builder.classes.find((entry) => entry.id === id) ?? null,
    race, background: builder.backgrounds.find((entry) => entry.id === "soldier") ?? null,
    baseline: null, abilityPool: null, wealthRoll: null, priceOf: bundledPrices, spellOf: checklistSpell, featOf: () => null,
    subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)), rollDie: () => 3,
  });
const wizardOf = (race, fields = {}) =>
  builder.build({
    race, class: "fighter", background: "soldier", level: 1, scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    chosenSkills: ["history", "perception"], stylePicks: ["defense"],
    bonusLanguages: race.languages.includes("Common") ? ["Elvish"] : ["Common"],
    racialAsi: race.asiChoice ? (race.asiChoice.from ?? ["str", "dex", "con", "int", "wis", "cha"]).filter((ability) => !race.asi?.[ability]).slice(0, race.asiChoice.count) : [],
    racialVariant: race.variants?.options[0]?.id ?? "", racialTool: race.toolChoice?.from[0] ?? "",
    racialSkills: ["insight", "medicine"].slice(0, race.skillChoice?.count ?? 0),
    // A race skill the soldier also gives is picked again in its place.
    repeatSkills: (race.skills ?? []).filter((skill) => ["athletics", "intimidation"].includes(skill)).map((_, index) => ["religion", "investigation"][index]),
    ...fields,
  });
test("a pack species that names martial weapons of the player's choice asks for them, and the sheet is trained in the ones picked", () => {
  const pick = (id) => options.find((option) => option.id === id);
  assert.deepEqual(["mutated", "dwarf-chassis", "delver"].map((id) => pick(id).weaponChoice?.count), [2, 2, 1]);
  assert.ok(pick("mutated").weaponChoice.from.includes("Longsword") && !pick("mutated").weaponChoice.from.includes("Dagger"), "the martial weapons, and only those");
  const race = pick("mutated");
  const unpicked = wizardOf(race);
  assert.equal(unpicked.blocker?.target, "racialWeapons", `the builder saved with the weapons unpicked: ${unpicked.blocker?.message}`);
  const built = wizardOf(race, { racialWeapons: ["Longsword", "Warhammer"] });
  assert.equal(built.blocker, null, built.blocker?.message);
  const verdict = legal(race, built);
  assert.deepEqual(verdict.problems, []);
  assert.deepEqual(verdict.sheet.racialChoices.weapons, ["Longsword", "Warhammer"]);
  for (const weapon of ["Longsword", "Warhammer"]) assert.ok(verdict.sheet.proficiencies.weapons.includes(weapon), `trained with the ${weapon}`);
  // A simple weapon is not one of the list; the server says so.
  const off = legal(race, { sheet: { ...built.sheet, racialChoices: { ...built.sheet.racialChoices, weapons: ["Dagger", "Longsword"] } } });
  assert.ok(off.problems.some((line) => /Dagger is not a weapon/.test(line)), off.problems.join(" | "));
});

const { sizeForRace, deriveAc } = await import("../src/lib/srd/index.ts");
test("the one pick a pack species' trait asks for is asked, and the option picked reaches the engine", () => {
  const pick = (id) => options.find((option) => option.id === id);
  // Mental Fortitude: one of three abilities, its saves against magic.
  const gnome = pick("gnome-chassis");
  assert.deepEqual(gnome.variants?.options.map((option) => option.id), ["intelligence", "wisdom", "charisma"]);
  const unpicked = wizardOf(gnome, { racialVariant: "" });
  assert.equal(unpicked.blocker?.target, "variant", "the builder saved a gnome chassis with no Mental Fortitude");
  const wise = legal(gnome, wizardOf(gnome, { racialVariant: "wisdom" }));
  assert.deepEqual(wise.problems, []);
  const names = wise.sheet.features.filter((feature) => feature.source === "race").map((feature) => feature.name);
  assert.ok(names.includes("Saves with advantage against spells (Wisdom)"), names.join(" | "));
  const held = { features: wise.sheet.features, class: "fighter", level: 1 };
  assert.deepEqual([traitSaveAdvantages(held, "wis", { magical: true }).length > 0, traitSaveAdvantages(held, "int", { magical: true }).length > 0], [true, false]);
  // Otherworldly Influence: a tentacle that strikes, or flesh that turns a blow.
  const mutated = pick("mutated");
  assert.deepEqual(mutated.variants?.options.map((option) => option.id), ["alien-appendage", "tainted-blood", "tenebrous-flesh"]);
  const raceFeatures = (variant) => legal(mutated, wizardOf(mutated, { racialVariant: variant, racialWeapons: ["Longsword", "Warhammer"] })).sheet.features;
  assert.equal(racialNaturalWeapon(raceFeatures("alien-appendage"), "tentacle")?.srd.damage, "1d4 bludgeoning");
  const ac = (features) => deriveAc({ abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, equipment: [], features, class: "fighter", level: 1, acOverride: false, proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] } });
  assert.equal(ac(raceFeatures("tenebrous-flesh")) - ac(raceFeatures("tainted-blood")), 1, `Tenebrous Flesh's +1 to Armor Class: ${raceFeatures("tenebrous-flesh").map((f) => f.name).join(" | ")}`);
  // Living Origin: a shade is offered as each people it was in life, at
  // that people's size and speed, speaking its tongue.
  assert.equal(pick("shade"), undefined, "a bare shade, with no origin");
  const halfling = pick("shade-halfling-origin");
  assert.deepEqual([halfling.size, halfling.speed, halfling.languages.includes("Halfling"), sizeForRace(halfling.id, speciesRulesOf(halfling))], ["Small", 25, true, "Small"]);
  assert.ok(halfling.traitNames.includes("Living Origin (Halfling)"));
  // A character stored on the bare shade keeps its row.
  assert.ok(packRaceOptions(races, ["shade"]).some((option) => option.id === "shade"));
});

test("a gearforged on a human chassis names two skills or tools in any mix and doubles one of them, skill or tool, and the sheet holds them", () => {
  const race = options.find((option) => option.id === "human-chassis");
  assert.deepEqual([race.trainingChoice, race.expertiseChoice], [{ count: 2 }, 1]);
  const unpicked = wizardOf(race);
  assert.equal(unpicked.blocker?.target, "racialTraining", `the builder saved with Adaptable Acumen unpicked: ${unpicked.blocker?.message}`);
  const built = wizardOf(race, { racialTraining: ["arcana", "thieves' tools"], racialExpertise: "arcana" });
  assert.equal(built.blocker, null, built.blocker?.message);
  const verdict = legal(race, built);
  assert.deepEqual(verdict.problems, []);
  const { skills, tools, expertise } = verdict.sheet.proficiencies;
  assert.deepEqual([skills.includes("arcana"), tools.includes("thieves' tools"), expertise.includes("arcana")], [true, true, true]);
  assert.deepEqual(verdict.sheet.racialChoices.training, ["arcana", "thieves' tools"]);
  // Expertise only in a skill held: History is the fighter's, Religion nobody's.
  const stray = legal(race, { sheet: { ...built.sheet, proficiencies: { ...built.sheet.proficiencies, expertise: ["religion"] } } });
  assert.ok(stray.problems.some((line) => /religion/.test(line)), stray.problems.join(" | "));
  // "Choose one of those skills or tools": the tool doubles on its checks.
  const tooled = wizardOf(race, { racialTraining: ["arcana", "thieves' tools"], racialExpertise: "thieves' tools" });
  assert.equal(tooled.blocker, null, tooled.blocker?.message);
  const toolVerdict = legal(race, tooled);
  assert.deepEqual(toolVerdict.problems, []);
  assert.ok(toolVerdict.sheet.proficiencies.expertise.includes("thieves' tools"), toolVerdict.sheet.proficiencies.expertise.join(" | "));
  assert.equal(toolProficiencyBonus(toolVerdict.sheet, "thieves' tools", 2)?.bonus, 4);
  // A tool the character does not hold is no expertise.
  const loose = legal(race, { sheet: { ...tooled.sheet, proficiencies: { ...tooled.sheet.proficiencies, expertise: ["smith's tools"] } } });
  assert.ok(loose.problems.some((line) => /smith's tools/.test(line)), loose.problems.join(" | "));
});

console.log(`test-species-prose: ${passed} passed`);
