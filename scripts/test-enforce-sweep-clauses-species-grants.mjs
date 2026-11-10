// The clause ledger's probes for what a lineage of src/lib/srd/races.json
// grants at creation, run through the server's own check of a new character
// (src/lib/srd/sheet-legality.ts legalizeSheet) on a sheet the builder made
// (scripts/lib/enforce-builder.mjs): the fixed ability increases, languages,
// skills, weapons, armor and tools reach the stored sheet, the walking speed
// is the row's, the size is the one the engine reads (src/lib/srd/index.ts
// sizeForRace), and darkvision is the range the board lights by
// (src/lib/battlemap/view.ts sheetDarkvisionTiles).
// The darkvision probes read a hero the sheet door stored (src/lib/db/sheets.ts
// createSheet grants the racial traits the board reads).
//
// scripts/clauses/species.json names each probe, "species.<id>.grants" and
// "species.<id>.darkvision".
import { register } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { openBuilder } = await import("./lib/enforce-builder.mjs");
const { legalizeSheet } = await import("../src/lib/srd/sheet-legality.ts");
const { bundledPrices } = await import("../src/lib/srd/starting-wealth.ts");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { bundledSubclassName } = await import("../src/lib/srd/features.ts");
const { sizeForRace } = await import("../src/lib/srd/index.ts");
const { sheetDarkvisionTiles } = await import("../src/lib/battlemap/view.ts");

const RACES = JSON.parse(fs.readFileSync(new URL("../src/lib/srd/races.json", import.meta.url), "utf8")).races;
const builder = await openBuilder();
const { classes, races, backgrounds } = builder;
const SCORES = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const rig = await clauseRig();
const table = await rig.table({ campaign: { maxPlayers: 60 } });

// A fighter 1 soldier of the lineage, as the builder sends it, through the
// server's check.
const START = { class: "fighter", background: "soldier", level: 1, scores: SCORES, stylePicks: ["defense"] };
function made(raceId, picks = null) {
  const built = builder.build({ race: raceId, ...START, chosenSkills: picks ? ["acrobatics", "animal_handling"] : ["perception", "survival"], ...(picks ?? {}) });
  if (picks) assert.equal(built.blocker, null, `with every pick made the builder still refuses: ${built.blocker?.message}`);
  const race = races.find((entry) => entry.id === raceId);
  assert.ok(race, `the builder offers no ${raceId}`);
  return legalizeSheet(built.sheet, {
    door: "library",
    level: 1,
    hpMethod: "average",
    startingWealth: "equipment",
    classOf: (id) => classes.find((entry) => entry.id === id) ?? null,
    race,
    background: backgrounds.find((entry) => entry.id === "soldier") ?? null,
    baseline: null,
    abilityPool: null,
    wealthRoll: null,
    priceOf: bundledPrices,
    spellOf: checklistSpell,
    featOf: () => null,
    subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)),
    rollDie: () => 3,
  }).sheet;
}

const lower = (list) => (list ?? []).map((entry) => String(entry).toLowerCase());
const missing = (wanted, held) => lower(wanted).filter((entry) => !lower(held).includes(entry));
// The darkvision a row's traits state, in feet: "Darkvision 60 ft",
// "Superior Darkvision 120 ft".
const darkvisionFeet = (row) => {
  const trait = row.traits.find((entry) => /darkvision \d+ ft/i.test(entry));
  return trait ? Number(/(\d+) ft/.exec(trait)[1]) : 0;
};

// The picks a lineage leaves to its player, made from its own lists: the
// first tool offered, skills from its list (or two no class or background
// here grants), a language, the increases on two abilities, a wizard
// cantrip, a red dragon.
function picksFor(row) {
  const picks = {};
  if (row.toolChoice) picks.racialTool = row.toolChoice.from[0];
  // Never one the fighter's picks or the soldier's training already hold.
  const taken = ["acrobatics", "animal_handling", "athletics", "intimidation"];
  if (row.skillChoice) picks.racialSkills = (row.skillChoice.from ?? ["arcana", "history", "religion"]).filter((skill) => !taken.includes(skill)).slice(0, row.skillChoice.count);
  // A lineage that also takes a feat (Variant Human) is staged elsewhere:
  // its feat pick is the builder's feat section, not a lineage field.
  if (row.traits.some((trait) => /feat of your choice/i.test(trait))) return null;
  if (row.bonusLanguages) picks.bonusLanguages = ["Giant", "Sylvan"].slice(0, row.bonusLanguages);
  if (row.asiChoice) picks.racialAsi = ["int", "wis", "dex"].filter((ability) => !row.asi?.[ability]).slice(0, row.asiChoice.count);
  if (row.cantripChoice) picks.racialCantrips = ["Fire Bolt"].slice(0, row.cantripChoice.count);
  if (row.ancestryChoice) picks.racialAncestry = "red";
  return Object.keys(picks).length ? picks : null;
}

const P = {};
for (const row of RACES) {
  P[`species.${row.id}.grants`] = () => {
    const sheet = made(row.id);
    const asi = Object.fromEntries(Object.entries(SCORES).map(([ability, score]) => [ability, score + (row.asi?.[ability] ?? 0)]));
    const wrong = {
      abilities: Object.entries(asi).filter(([ability, score]) => sheet.abilities[ability] !== score).map(([ability, score]) => `${ability} ${sheet.abilities[ability]} (wanted ${score})`),
      languages: missing(row.languages.filter((language) => !/of your choice/i.test(language)), sheet.proficiencies.languages),
      skills: missing(row.skills, sheet.proficiencies.skills),
      weapons: missing(row.weapons, sheet.proficiencies.weapons),
      armor: missing(row.armor, sheet.proficiencies.armor),
      tools: missing(row.tools, sheet.proficiencies.tools),
      speed: sheet.speed === row.speed ? [] : [`${sheet.speed} (wanted ${row.speed})`],
      size: sizeForRace(row.id) === row.size ? [] : [`${sizeForRace(row.id)} (wanted ${row.size})`],
    };
    const failed = Object.entries(wrong).filter(([, list]) => list.length);
    assert.deepEqual(failed, [], `${row.name}: what the stored sheet carries against the row`);
  };
  const picks = picksFor(row);
  if (picks) {
    // Unpicked, the builder will not save; picked, the server's sheet
    // carries each pick.
    P[`species.${row.id}.choices`] = () => {
      const bare = builder.build({ race: row.id, ...START, chosenSkills: ["acrobatics", "animal_handling"] });
      assert.notEqual(bare.blocker, null, `${row.name}: the builder saves with the lineage's picks unmade`);
      const sheet = made(row.id, picks);
      const wrong = {
        tool: picks.racialTool ? missing([picks.racialTool], sheet.proficiencies.tools) : [],
        skills: missing(picks.racialSkills, sheet.proficiencies.skills),
        languages: missing(picks.bonusLanguages, sheet.proficiencies.languages),
        asi: (picks.racialAsi ?? []).filter((ability) => sheet.abilities[ability] !== SCORES[ability] + row.asiChoice.amount),
        cantrip: picks.racialCantrips ? missing(picks.racialCantrips.map((name) => `Racial cantrip: ${name}`), sheet.features.map((feature) => feature.name)) : [],
        ancestry: picks.racialAncestry && sheet.racialChoices?.ancestry !== picks.racialAncestry ? [String(sheet.racialChoices?.ancestry)] : [],
      };
      assert.deepEqual(Object.entries(wrong).filter(([, list]) => list.length), [], `${row.name}: the picks on the stored sheet`);
    };
  }
  const feet = darkvisionFeet(row);
  if (feet) {
    // A hero of the lineage as the sheet door stores it (its racial traits
    // granted), read by the board's sight.
    P[`species.${row.id}.darkvision`] = () => {
      const who = table.hero({ class: "fighter", level: 1, race: row.id, equipment: [] });
      assert.equal(sheetDarkvisionTiles(table.sheet(who)) * 5, feet, `${row.name}: darkvision on the board`);
    };
  }
}

// Variant Human: two increases of the player's choice, a language, a skill,
// and the feat, which is picked in the builder's feat section (not a lineage
// field): with any of them unmade the builder will not save, and made, the
// server's sheet carries each.
P["species.variant_human.choices"] = () => {
  const picks = { racialSkills: ["arcana"], bonusLanguages: ["Giant"], racialAsi: ["int", "wis"], feats: ["Alert"] };
  const start = { race: "variant_human", ...START, chosenSkills: ["acrobatics", "animal_handling"] };
  const refused = Object.fromEntries(
    Object.keys(picks).map((left) => [left, builder.build({ ...start, ...picks, [left]: [] }).blocker !== null]),
  );
  assert.deepEqual(refused, { racialSkills: true, bonusLanguages: true, racialAsi: true, feats: true }, "Human (Variant): the builder saves with one of the lineage's picks unmade");
  const sheet = made("variant_human", picks);
  const wrong = {
    skill: missing(picks.racialSkills, sheet.proficiencies.skills),
    language: missing(picks.bonusLanguages, sheet.proficiencies.languages),
    asi: picks.racialAsi.filter((ability) => sheet.abilities[ability] !== SCORES[ability] + 1),
    others: ["str", "dex", "con", "cha"].filter((ability) => sheet.abilities[ability] !== SCORES[ability]),
    feat: missing(picks.feats, sheet.feats),
  };
  assert.deepEqual(Object.entries(wrong).filter(([, list]) => list.length), [], `Human (Variant): the picks on the stored sheet: ${JSON.stringify(wrong)}`);
};

// Dragonborn: the ancestry the builder's pick wrote (a red dragon), spent
// and struck through the table. SRD 5.1, Breath Weapon: 2d6 (3d6 at 6th
// level), DC 8 + Constitution modifier + proficiency bonus, the ancestry's
// damage type and save, once a short or long rest; Damage Resistance: "You
// have resistance to the damage type associated with your draconic
// ancestry."
function dragonborn(level, ancestry = "red") {
  const legal = made("dragonborn", { racialAncestry: ancestry });
  return table.hero({ class: "fighter", level, race: "dragonborn", equipment: [], maxHp: 60, abilities: { con: 14 }, racialChoices: legal.racialChoices, features: legal.features.filter((feature) => feature.source === "race") });
}
P["species.dragonborn.breath"] = async () => {
  const seen = [];
  for (const level of [1, 6]) {
    const who = dragonborn(level);
    const first = await table.use(who, "Breath Weapon");
    const again = await table.use(who, "Breath Weapon");
    seen.push([first.result?.damage, first.result?.dc, first.result?.type, first.result?.saveAbility, table.used(who, "breath_weapon"), again.ok]);
  }
  // Constitution 14 (+2), proficiency +2 at 1st and +3 at 6th.
  assert.deepEqual(seen, [["2d6", 12, "fire", "dex", 1, false], ["3d6", 13, "fire", "dex", 1, false]], `Dragonborn: a red dragon's breath at 1st and 6th level, then a second with none left: ${JSON.stringify(seen)}`);
};
P["species.dragonborn.ancestry-resistance"] = async () => {
  const lost = {};
  for (const [ancestry, type] of [["red", "fire"], ["white", "cold"], ["green", "poison"]]) {
    const who = dragonborn(5, ancestry);
    const mine = await table.damage(who, 10, type);
    const hp = table.sheet(who).currentHp;
    const other = await table.damage(who, 10, type === "fire" ? "cold" : "fire");
    assert.deepEqual([mine.ok, other.ok], [true, true], mine.error ?? other.error);
    lost[ancestry] = [60 - hp, hp - table.sheet(who).currentHp];
  }
  assert.deepEqual(lost, { red: [5, 10], white: [5, 10], green: [5, 10] }, `Dragonborn: 10 damage of the ancestry's type, then 10 of another: ${JSON.stringify(lost)}`);
};

// The probes above by name, for the ledger's probe check (it finds a probe
// by its name in this file); the run holds the table to the list.
const NAMES = [
  "species.hill_dwarf.grants", "species.mountain_dwarf.grants", "species.high_elf.grants", "species.wood_elf.grants", "species.drow.grants",
  "species.lightfoot_halfling.grants", "species.stout_halfling.grants", "species.human.grants", "species.variant_human.grants",
  "species.dragonborn.grants", "species.rock_gnome.grants", "species.forest_gnome.grants", "species.deep_gnome.grants", "species.half_elf.grants",
  "species.half_orc.grants", "species.tiefling.grants", "species.aasimar.grants", "species.goliath.grants", "species.firbolg.grants",
  "species.tabaxi.grants", "species.kenku.grants", "species.tortle.grants", "species.fire_genasi.grants", "species.water_genasi.grants",
  "species.air_genasi.grants", "species.earth_genasi.grants", "species.changeling.grants", "species.warforged.grants", "species.goblin.grants",
  "species.bugbear.grants", "species.lizardfolk.grants", "species.orc.grants", "species.hill_dwarf.darkvision", "species.mountain_dwarf.darkvision",
  "species.high_elf.darkvision", "species.wood_elf.darkvision", "species.drow.darkvision", "species.rock_gnome.darkvision",
  "species.forest_gnome.darkvision", "species.deep_gnome.darkvision", "species.half_elf.darkvision", "species.half_orc.darkvision",
  "species.tiefling.darkvision", "species.aasimar.darkvision", "species.tabaxi.darkvision", "species.fire_genasi.darkvision",
  "species.earth_genasi.darkvision", "species.goblin.darkvision", "species.bugbear.darkvision", "species.orc.darkvision",
  "species.hill_dwarf.choices", "species.mountain_dwarf.choices", "species.high_elf.choices", "species.human.choices", "species.dragonborn.choices",
  "species.half_elf.choices", "species.kenku.choices", "species.changeling.choices", "species.warforged.choices", "species.lizardfolk.choices", "species.orc.choices",
  "species.variant_human.choices", "species.dragonborn.breath", "species.dragonborn.ancestry-resistance",
];
assert.deepEqual(Object.keys(P).sort(), [...NAMES].sort(), "the table makes other probes than NAMES lists: a row of races.json was added or changed");

await runOrSurvey("scripts/test-enforce-sweep-clauses-species-grants.mjs", P);
