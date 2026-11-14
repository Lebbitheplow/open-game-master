// The starter one-shot (src/lib/starter/one-shot.ts) and its ready-made
// heroes (src/lib/starter/pregens.ts): every hero passes the same admission
// door as a player's character and arrives with gear, the one-shot campaign
// carries its premise and the DM's outline, and solo means one seat. Real
// throwaway database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-starter-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { advanceClock, getClock } = await import("../src/lib/db/clock.ts");
const { admitSheet } = await import("../src/lib/characters/admit.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createSheet, listSheets } = await import("../src/lib/db/sheets.ts");
const { createCharacter, listCharactersForUser } = await import("../src/lib/db/characters.ts");
const { PREGENS, pregenById, pregenSummaries } = await import("../src/lib/starter/pregens.ts");
const { findBackground, findClass, findRace } = await import("../src/lib/srd/index.ts");
const { STARTER_ONE_SHOT, createStarterCampaign } = await import("../src/lib/starter/one-shot.ts");
const { CALENDAR_PRESETS, MINUTES_PER_DAY, breakDown, dayPart, defaultClock, describeInstant, toInstant } = await import("../src/lib/dm/calendar.ts");

let failed = 0;
function test(name, run) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

const host = createUser("Host", "x");

test("the one-shot campaign carries its premise, its secret outline and a short length; solo is one seat", () => {
  const table = createStarterCampaign(host.id, { solo: false });
  assert.equal(table.title, STARTER_ONE_SHOT.title);
  assert.equal(table.maxPlayers, 5);
  assert.equal(table.startingLevel, 1);
  assert.equal(table.gameSettings.dmMode, "ai");
  assert.equal(table.gameSettings.campaignLength, "short");
  assert.equal(table.gameSettings.genre, "high_fantasy");
  const stored = getCampaignById(table.id);
  assert.ok(stored.dmOutline.includes("Aldo Merrin"), "the DM's outline is written");
  assert.ok(stored.description.includes("Marrow's Crossing"));
  assert.ok(!stored.description.includes("ghoul"), "the players' premise keeps the twist");
  const solo = createStarterCampaign(host.id, { solo: true });
  assert.equal(solo.maxPlayers, 1);
  // POST /api/starter passes this to the creator, who owns the table.
  assert.equal(solo.role, "owner");
});

// The premise says "you arrive at dusk", and the DM narrates the hour the
// clock shows; a campaign's clock otherwise opens at eight in the morning.
test("the one-shot's clock opens at dusk, as its premise does, on the day a campaign opens", () => {
  assert.match(STARTER_ONE_SHOT.description, /at dusk/);
  const table = getCampaignById(createStarterCampaign(host.id, { solo: true }).id);
  const now = breakDown(table.clock.calendar, table.clock.instant);
  assert.equal(now.hour, 18);
  assert.equal(now.minute, 0);
  assert.equal(dayPart(now.hour), "evening");
  const opening = defaultClock();
  assert.equal(Math.floor(table.clock.instant / MINUTES_PER_DAY), Math.floor(opening.instant / MINUTES_PER_DAY), "only the hour moved");
  assert.equal(table.clock.calendar.id, opening.calendar.id);
});

// A weekday named like an hour ("Midday, Greening 1 (19:00), evening") reads
// as the hour to players and to the model, and so does one that only
// contains it ("Dawnday", "Night's Rest").
test("no weekday of a built-in calendar contains a time of day", () => {
  const clockWords = ["midday", "noon", "midnight", "dawn", "dusk", "morning", "afternoon", "evening", "night"];
  for (const calendar of CALENDAR_PRESETS) {
    for (const weekday of calendar.weekdays) {
      const word = clockWords.find((clockWord) => weekday.toLowerCase().includes(clockWord));
      assert.equal(word, undefined, `${calendar.name}: ${weekday} contains "${word}"`);
    }
  }
});

// The turning year as code before the rename stored it: any clock that ever
// moved keeps a whole copy of its calendar in clock_json.
const LEGACY_TURNING_YEAR = {
  id: "seasons",
  name: "The turning year",
  months: [
    { name: "Deepwinter", days: 31 }, { name: "Frostmoon", days: 30 }, { name: "Thaw", days: 31 },
    { name: "Greening", days: 30 }, { name: "Bloom", days: 31 }, { name: "Seedfall", days: 30 },
    { name: "Highsun", days: 31 }, { name: "Longlight", days: 31 }, { name: "Firstharvest", days: 30 },
    { name: "Goldfall", days: 30 }, { name: "Leafturn", days: 30 }, { name: "Yearsend", days: 30 },
  ],
  weekdays: ["Firstday", "Seconday", "Midday", "Fourthday", "Fifthday", "Restday"],
  yearSuffix: "",
  epochYear: 1,
};

test("a campaign played before the rename reads Midweek on the same day and hour, and an edited calendar keeps its own names", () => {
  const played = createCampaign(host.id, { title: "Old table", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  const nineOClock = toInstant(LEGACY_TURNING_YEAR, { month: 4, day: 1, hour: 9 });
  const store = (id, calendar) =>
    getDatabase()
      .prepare(`UPDATE campaigns SET clock_json = ? WHERE id = ?`)
      .run(JSON.stringify({ calendar, instant: nineOClock, weather: null }), id);
  store(played.id, LEGACY_TURNING_YEAR);
  const clock = getCampaignById(played.id).clock;
  assert.equal(clock.instant, nineOClock);
  assert.equal(describeInstant(clock.calendar, clock.instant), "Midweek, Greening 1, year 1 (09:00), morning, spring");
  assert.equal(getClock(played.id).calendar.weekdays[2], "Midweek");
  // The next move of the clock stores the new name.
  advanceClock(played.id, 1, "hours");
  const row = getDatabase().prepare(`SELECT clock_json FROM campaigns WHERE id = ?`).get(played.id);
  assert.deepEqual(JSON.parse(row.clock_json).calendar.weekdays, CALENDAR_PRESETS[0].weekdays);

  const edited = createCampaign(host.id, { title: "Edited table", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  store(edited.id, { ...LEGACY_TURNING_YEAR, festivals: [{ month: 4, day: 1, name: "First Bloom" }] });
  assert.match(describeInstant(getCampaignById(edited.id).clock.calendar, nineOClock), /^Midday, Greening 1/);
});

test("every ready-made hero passes the table's admission door at level 1 and arrives armed", () => {
  const table = createStarterCampaign(host.id, { solo: false });
  assert.equal(PREGENS.length, 4);
  for (const pregen of PREGENS) {
    const player = createUser(`player-${pregen.id}`, "x");
    const input = createSheetSchema.parse(pregen.sheet);
    const admitted = admitSheet({ door: "table", level: 1, sheet: input, userId: player.id, campaign: table });
    assert.ok(admitted.ok, `${pregen.sheet.name}: ${admitted.ok ? "" : admitted.problems.join(" | ")}`);
    const sheet = admitted.sheet;
    assert.ok(sheet.equipment.length >= 8, `${sheet.name} carries a kit`);
    assert.ok(sheet.equipment.some((item) => /axe|sword|rapier|mace/i.test(item.name)), `${sheet.name} carries a weapon`);
    assert.ok(sheet.maxHp >= 10 && sheet.ac >= 14, `${sheet.name} hp ${sheet.maxHp} ac ${sheet.ac}`);
    // Seated the way the route seats it: a library copy and a table copy.
    const libraryCharacter = createCharacter(player.id, 1, sheet);
    createSheet(table.id, player.id, 1, sheet, libraryCharacter.id);
    admitted.settle();
    assert.equal(listCharactersForUser(player.id).length, 1);
  }
  assert.equal(listSheets(table.id).length, 4);
  const sera = listSheets(table.id).find((sheet) => sheet.name === "Sera");
  assert.equal(sera.spellcasting?.cantrips.length, 3);
  assert.ok(sera.spellcasting?.prepared.includes("Cure Wounds"));
});

// A ready-made hero is a finished level 1 character: the class's skill
// picks on top of the background's (a skill both give is picked again from
// the class's list, as the builder asks), and the languages the race and the
// background let a player choose. Brakk had the outlander's two skills and
// no barbarian ones, and all four spoke only Common.
test("every ready-made hero makes every choice its level 1 owes: class skills beside the background's, and its languages", () => {
  const table = createStarterCampaign(host.id, { solo: false });
  for (const pregen of PREGENS) {
    const player = createUser(`owing-${pregen.id}`, "x");
    const admitted = admitSheet({ door: "table", level: 1, sheet: createSheetSchema.parse(pregen.sheet), userId: player.id, campaign: table });
    assert.ok(admitted.ok, pregen.id);
    const sheet = admitted.sheet;
    const klass = findClass(sheet.class);
    const background = findBackground(sheet.background);
    const race = findRace(sheet.race);
    const fromBackground = new Set(background.skills);
    const classPicks = sheet.proficiencies.skills.filter((skill) => !fromBackground.has(skill) && klass.skillChoices.from.includes(skill));
    assert.ok(
      classPicks.length >= klass.skillChoices.count,
      `${sheet.name} has ${classPicks.length} of the ${klass.skillChoices.count} ${klass.name} skills beside the ${background.name}'s (${sheet.proficiencies.skills.join(", ")})`,
    );
    const owedLanguages = race.languages.length + (race.bonusLanguages ?? 0) + (background.languages ?? 0);
    const spoken = sheet.proficiencies.languages.filter((language) => !/thieves/i.test(language));
    assert.ok(spoken.length >= owedLanguages, `${sheet.name} speaks ${spoken.join(", ")}; the race and background give ${owedLanguages}`);
  }
});

test("the picker's summaries carry no sheet, and ids resolve", () => {
  const summaries = pregenSummaries();
  assert.deepEqual(summaries.map((hero) => hero.id), ["brakk", "kara", "vex", "sera"]);
  for (const hero of summaries) {
    assert.deepEqual(Object.keys(hero).sort(), ["blurb", "class", "id", "name", "race", "tagline"]);
  }
  assert.equal(pregenById("vex")?.sheet.class, "rogue");
  assert.equal(pregenById("nobody"), null);
});

removeTempDir(dir);
if (failed) {
  process.exit(1);
}
console.log("\nstarter checks passed");
