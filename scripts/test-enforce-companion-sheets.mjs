// A companion's sheet, made and levelled by the engine.
//
// A companion has no player and no dialog: the engine makes its choices
// (src/lib/srd/companion-build.ts) and the rules judge them as they judge a
// player's (src/lib/dm/companion-level.ts). So a companion's sheet is held
// to what a player's is:
//   the Ability Score Improvements its class has earned, by CLASS table
//   (SRD 5.1: fighter 4, 6, 8, 12, 14, 16, 19; rogue 4, 8, 10, 12, 16, 19;
//   everyone else 4, 8, 12, 16, 19), no score above 20;
//   hit points by the table's method, a Constitution that rose counted for
//   every level held;
//   armor class from the armor it wears;
//   for a caster, cantrips and spells from the class's own list, no more of
//   them than the class's tables give, none above the slots it has, and a
//   list that grows with the levels.
//
// Companions are recruited as guests: a lasting companion queues a portrait
// render, which a test has no business starting.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";
import { XP_BY_LEVEL } from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-companion-sheets");
const { spellListProblems, spellbookAllowance } = await import("../src/lib/srd/spell-prep.ts");
const { subclassSpellsFor } = await import("../src/lib/srd/features.ts");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { deriveAc } = await import("../src/lib/srd/index.ts");
const build = await import("../src/lib/srd/companion-build.ts");

const total = (scores) => Object.values(scores).reduce((sum, score) => sum + score, 0);
const ASI_LEVELS = {
  fighter: [4, 6, 8, 12, 14, 16, 19],
  rogue: [4, 8, 10, 12, 16, 19],
};
const earned = (classId, level) =>
  (ASI_LEVELS[classId] ?? [4, 8, 12, 16, 19]).filter((at) => level >= at).length;

async function table(settings = {}) {
  const world = await openWorld({ gameSettings: settings });
  world.addHero({ class: "fighter", level: 1, maxHp: 12 });
  return world;
}

async function recruit(world, classId, extra = {}) {
  const joined = await world.invoke("add_companion", {
    gender: "Unknown",
    name: `The ${classId}`,
    class: classId,
    race: "human",
    level: 1,
    personality: "Dry, loyal, counts the exits.",
    kind: "guest",
    ...extra,
  });
  assert.equal(joined.ok, true, joined.error);
  return { id: joined.result.characterId, note: joined.result.note };
}

async function raiseTo(world, id, level) {
  let owed = XP_BY_LEVEL[level - 1] - world.sheet(id).xp;
  while (owed > 0) {
    const amount = Math.min(20000, owed);
    const awarded = await world.invoke("award_xp", { characterIds: [id], amount, reason: "x" });
    assert.equal(awarded.ok, true, awarded.error);
    owed -= amount;
  }
  return world.sheet(id);
}

// What is wrong with a caster's lists, by the tables and by the class's list.
function listProblems(sheet, list) {
  const problems = spellListProblems(sheet, { bookAllowance: true });
  const casting = sheet.spellcasting;
  // A subclass's always-prepared spells (a paladin's oath spells) are the
  // class's own for this character, on its list or not.
  const granted = new Set(subclassSpellsFor(sheet.class, sheet.subclass ?? "", sheet.level));
  for (const name of casting.cantrips ?? []) {
    const spell = checklistSpell(name);
    if (!spell || spell.level !== 0 || !spell.classes.includes(list)) {
      problems.push(`${name} is not a ${list} cantrip`);
    }
  }
  for (const name of [...casting.known, ...casting.prepared, ...(casting.spellbook ?? [])]) {
    const spell = checklistSpell(name);
    if (granted.has(name)) {
      continue;
    }
    if (!spell || spell.level < 1 || !spell.classes.includes(list)) {
      problems.push(`${name} is not a ${list} spell`);
    }
  }
  return problems;
}

// ---- the choices, pure ----

await test("an improvement is two points: to one score with room, or split when the best score stands at 19", () => {
  const scores = { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 };
  const priority = ["str", "con", "dex", "wis", "cha", "int"];
  assert.deepEqual(build.companionImprovements(scores, priority, 2), [
    { mode: "plus2", ability: "str" },
    { mode: "plus2", ability: "str" },
  ]);
  assert.deepEqual(build.companionImprovements({ ...scores, str: 19 }, priority, 1), [
    { mode: "plus1x2", abilities: ["str", "con"] },
  ]);
  assert.deepEqual(build.companionImprovements({ ...scores, str: 20 }, priority, 1), [
    { mode: "plus2", ability: "con" },
  ]);
  const full = { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 };
  assert.deepEqual(build.companionImprovements(full, priority, 3), []);
  assert.deepEqual(build.companionImprovements({ ...full, cha: 19 }, priority, 3), []);
});

// ---- improvements ----

for (const classId of ["fighter", "rogue", "cleric"]) {
  await test(`a ${classId} companion takes each improvement at the ${classId}'s own levels, and no score passes 20`, async () => {
    const world = await table();
    const { id } = await recruit(world, classId);
    const first = world.sheet(id);
    let taken = 0;
    for (let level = 2; level <= 20; level += 1) {
      const before = world.sheet(id);
      const after = await raiseTo(world, id, level);
      assert.equal(after.level, level);
      const gained = total(after.abilities) - total(before.abilities) + 2 * (after.feats.length - before.feats.length);
      const due = earned(classId, level) - earned(classId, level - 1);
      assert.equal(gained, 2 * due, `level ${level}: ${gained} points, the ${classId} table gives ${2 * due}`);
      taken += due;
      assert.ok(Math.max(...Object.values(after.abilities)) <= 20, `level ${level}: a score above 20`);
    }
    assert.equal(total(world.sheet(id).abilities), total(first.abilities) + 2 * taken);
  });
}

await test("a companion's hit points follow a Constitution that rose, for every level it holds", async () => {
  const world = await table();
  const { id } = await recruit(world, "wizard");
  // Intelligence reaches 20 with the improvements of 4th and 8th level; the
  // one at 12th goes to Constitution, and the hit points of all twelve
  // levels are counted with it.
  const sheet = await raiseTo(world, id, 12);
  assert.equal(sheet.abilities.int, 20);
  const con = abilityMod(sheet.abilities.con);
  assert.equal(sheet.maxHp, 6 + con + 11 * (4 + con));
});

await test("a companion recruited at a level above the first holds that level's improvements and hit points", async () => {
  const world = await table();
  const { id } = await recruit(world, "fighter", { level: 8 });
  const sheet = world.sheet(id);
  assert.equal(sheet.level, 8);
  // Standard array with the human's +1 to each is 78 points; a fighter of
  // 8th level has improved three times.
  assert.equal(total(sheet.abilities), 78 + 6);
  assert.ok(Math.max(...Object.values(sheet.abilities)) <= 20);
  const con = abilityMod(sheet.abilities.con);
  assert.equal(sheet.maxHp, 10 + con + 7 * (6 + con));
  // Nothing more is owed at the next level, which gives none.
  const next = await raiseTo(world, id, 9);
  assert.equal(total(next.abilities), total(sheet.abilities));
});

await test("a companion at a table that takes the die's maximum has the maximum", async () => {
  const world = await table({ hpMethod: "max" });
  const { id } = await recruit(world, "fighter", { level: 3 });
  const made = world.sheet(id);
  const con = abilityMod(made.abilities.con);
  assert.equal(made.maxHp, 3 * (10 + con));
  const next = await raiseTo(world, id, 4);
  assert.equal(next.maxHp, 4 * (10 + abilityMod(next.abilities.con)));
});

await test("a companion's armor class is what its armor gives, and follows its scores", async () => {
  const world = await table();
  const { id } = await recruit(world, "rogue");
  const made = world.sheet(id);
  assert.equal(made.acOverride, false);
  assert.equal(made.ac, deriveAc(made));
  // Leather, and a Dexterity of 16: 11 + 3.
  assert.equal(made.ac, 11 + abilityMod(made.abilities.dex));
  const later = await raiseTo(world, id, 4);
  assert.equal(later.abilities.dex, made.abilities.dex + 2);
  assert.equal(later.ac, 11 + abilityMod(later.abilities.dex));
});

await test("a companion at 0 hit points takes its level once it is back on its feet", async () => {
  const world = await table();
  const { id } = await recruit(world, "fighter");
  world.patch(id, { currentHp: 0 });
  await world.invoke("award_xp", { characterIds: [id], amount: 300, reason: "x" });
  assert.equal(world.sheet(id).level, 1);
  world.patch(id, { currentHp: 5 });
  await world.invoke("award_xp", { characterIds: [id], amount: 1, reason: "x" });
  assert.equal(world.sheet(id).level, 2);
});

// ---- spells ----

const CASTERS = [
  { classId: "wizard", list: "wizard" },
  { classId: "cleric", list: "cleric" },
  { classId: "sorcerer", list: "sorcerer" },
  { classId: "bard", list: "bard" },
  { classId: "druid", list: "druid" },
  { classId: "warlock", list: "warlock" },
];

for (const { classId, list } of CASTERS) {
  await test(`a ${classId} companion's spell list is legal at every level and grows with them`, async () => {
    const world = await table();
    const { id } = await recruit(world, classId);
    const problems = [];
    let held = 0;
    for (let level = 1; level <= 20; level += 1) {
      const sheet = level === 1 ? world.sheet(id) : await raiseTo(world, id, level);
      const casting = sheet.spellcasting;
      assert.ok(casting, `a level ${level} ${classId} holds no spellcasting`);
      problems.push(...listProblems(sheet, list).map((problem) => `L${level} ${problem}`));
      const names = new Set(
        [...(casting.cantrips ?? []), ...casting.known, ...casting.prepared, ...(casting.spellbook ?? [])].map(
          (name) => name.toLowerCase(),
        ),
      );
      assert.ok(names.size >= held, `level ${level}: the list shrank from ${held} to ${names.size}`);
      if (level === 1) {
        assert.ok((casting.cantrips ?? []).length > 0, "a 1st level caster knows cantrips");
        assert.ok(names.size > (casting.cantrips ?? []).length, "a 1st level caster holds spells");
      }
      held = names.size;
    }
    assert.deepEqual(problems, []);
    assert.ok(held >= 15, `a level 20 ${classId} holds ${held} spells and cantrips`);
  });
}

await test("a wizard companion writes six spells at 1st level and two for every level after", async () => {
  const world = await table();
  const { id } = await recruit(world, "wizard");
  for (let level = 1; level <= 6; level += 1) {
    const sheet = level === 1 ? world.sheet(id) : await raiseTo(world, id, level);
    assert.equal(sheet.spellcasting.spellbook.length, spellbookAllowance(level), `level ${level}`);
    for (const name of sheet.spellcasting.prepared) {
      assert.ok(sheet.spellcasting.spellbook.includes(name), `${name} is prepared and not in the book`);
    }
  }
});

await test("a half caster companion learns its first spells when its class begins to cast", async () => {
  const world = await table();
  const { id } = await recruit(world, "paladin");
  assert.deepEqual(world.sheet(id).spellcasting?.prepared ?? [], []);
  const second = await raiseTo(world, id, 2);
  assert.ok(second.spellcasting.prepared.length > 0, "a paladin of 2nd level prepares spells");
  assert.deepEqual(listProblems(second, "paladin"), []);
  assert.deepEqual(listProblems(await raiseTo(world, id, 9), "paladin"), []);
});

await test("the spells a recruiter names are taken when the class may hold them, and passed over when not", async () => {
  const world = await table();
  const { id, note } = await recruit(world, "wizard", {
    spells: ["Magic Missile", "Fire Bolt", "Fireball", "Cure Wounds", "Wish", "Made Up Spell"],
  });
  const casting = world.sheet(id).spellcasting;
  assert.ok(casting.spellbook.includes("Magic Missile"));
  assert.ok(casting.cantrips.includes("Fire Bolt"));
  for (const refused of ["Fireball", "Cure Wounds", "Wish", "Made Up Spell"]) {
    const everywhere = [...casting.cantrips, ...casting.known, ...casting.prepared, ...casting.spellbook];
    assert.ok(!everywhere.includes(refused), `${refused} is on a 1st level wizard's sheet`);
    assert.ok(note.includes(refused), `the recruiter is not told ${refused} was left off`);
  }
  assert.deepEqual(listProblems(world.sheet(id), "wizard"), []);
});

await test("a companion recruited as a caster of 5th level holds a whole legal list", async () => {
  const world = await table();
  const { id } = await recruit(world, "cleric", { level: 5 });
  const sheet = world.sheet(id);
  assert.deepEqual(listProblems(sheet, "cleric"), []);
  // Wisdom 15 + 1, raised by the improvement of 4th level: 18, so +4, and
  // five levels: nine prepared, beside the Life Domain's six, which a cleric
  // always has prepared and which count against nothing (SRD 5.1).
  assert.equal(sheet.abilities.wis, 18);
  assert.equal(sheet.subclass, "Life Domain");
  const domain = new Set(subclassSpellsFor("cleric", "Life Domain", 5));
  assert.equal(domain.size, 6);
  const chosen = sheet.spellcasting.prepared.filter((name) => !domain.has(name));
  assert.equal(chosen.length, 9);
  assert.ok([...domain].every((name) => sheet.spellcasting.prepared.includes(name)), "a domain spell is missing");
  const levels = new Set(chosen.map((name) => checklistSpell(name).level));
  assert.deepEqual([...levels].sort(), [1, 2, 3]);
  assert.equal(sheet.spellcasting.cantrips.length, 4);
});

// ---- the classes of other settings ----

await test("every setting class makes a companion, and the companion levels", async () => {
  const { genreClassIds } = await import("../src/lib/classes/index.ts");
  const failures = [];
  for (const genre of ["cyberpunk", "dark_fantasy", "horror", "mystery", "post_apocalyptic", "steampunk"]) {
    const world = await table({ genre, maxGuests: 3 });
    for (const classId of genreClassIds(genre)) {
      const joined = await world.invoke("add_companion", {
        gender: "Unknown",
        name: `The ${classId}`,
        class: classId,
        race: "human",
        level: 3,
        personality: "Quiet.",
        kind: "guest",
      });
      if (!joined.ok || joined.result?.error) {
        failures.push(`${genre} ${classId}: ${joined.error ?? joined.result.error}`);
        continue;
      }
      const id = joined.result.characterId;
      const leveled = await raiseTo(world, id, 5);
      if (leveled.level !== 5 || total(leveled.abilities) !== total(world.sheet(id).abilities)) {
        failures.push(`${genre} ${classId}: level ${leveled.level} after the experience for 5th`);
      }
      if (total(leveled.abilities) !== 78 + 2) {
        failures.push(`${genre} ${classId}: ${total(leveled.abilities)} ability points at 5th level`);
      }
      const gone = await world.invoke("dismiss_companion", { characterId: id });
      if (!gone.ok) {
        failures.push(`${genre} ${classId}: ${gone.error}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

// SRD 5.1, Dragonborn: the ancestry is a choice among ten dragons. The engine
// chooses for a companion by rolling on that table, unless the one
// recruiting names it.
await test("an engine-made dragonborn's ancestry is rolled on the SRD's table, or the one the recruiter names", async () => {
  const grants = await import("../src/lib/srd/racial-grants.ts");
  const rolled = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((face) => grants.rollDraconicAncestry(() => face).id);
  assert.deepEqual(rolled, grants.DRACONIC_ANCESTRY_IDS, "each face of the d10 is one dragon");
  const ancestryOf = (world, id) =>
    world.sheet(id).features.filter((feature) => /^draconic ancestry:/i.test(feature.name)).map((feature) => feature.name);

  const green = await table();
  green.clearDice();
  green.dice(7);
  const { id: rolledId } = await recruit(green, "fighter", { race: "dragonborn" });
  green.clearDice();
  assert.equal(ancestryOf(green, rolledId).length, 1);
  assert.match(ancestryOf(green, rolledId)[0], /^Draconic Ancestry: Green/);

  const silver = await table();
  const { id: namedId } = await recruit(silver, "fighter", { race: "dragonborn", ancestry: "silver" });
  assert.match(ancestryOf(silver, namedId)[0], /^Draconic Ancestry: Silver/);
});

// A companion's training is chosen as a player would choose it: a background
// (SRD 5.1, Backgrounds: two skills of its own), then the class's skills from
// the class's list, none the background already gave, the best for its
// scores first; a race's open picks the same way. Whoever recruits it may
// name the background and the skills.
await test("a companion's skills suit its scores, and the background is chosen by them too", () => {
  const rogue = { str: 10, dex: 15, con: 14, int: 12, wis: 13, cha: 8 };
  const from = ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleight_of_hand", "stealth"];
  const picks = build.companionSkillPicks({ from, count: 4, abilities: rogue, taken: ["stealth"] });
  assert.deepEqual(picks, ["acrobatics", "sleight_of_hand", "perception", "insight"]);
  assert.deepEqual(
    build.companionSkillPicks({ from, count: 4, abilities: rogue, taken: [], wanted: ["Persuasion", "Arcana", "nonsense"] }).slice(0, 2),
    ["persuasion", "stealth"],
  );
  const backgrounds = [
    { id: "sage", skills: ["arcana", "history"] },
    { id: "urchin", skills: ["sleight_of_hand", "stealth"] },
    { id: "soldier", skills: ["athletics", "intimidation"] },
  ];
  assert.equal(build.companionBackground(backgrounds, rogue).id, "urchin");
  assert.equal(build.companionBackground(backgrounds, { ...rogue, int: 16, dex: 10 }).id, "sage");
  assert.deepEqual(build.companionExpertisePicks(["insight", "stealth", "deception"], rogue, ["stealth"], 1), ["insight"]);
});

const SKILL_COUNT = { rogue: 4, bard: 3, ranger: 3, fighter: 2, wizard: 2, cleric: 2 };

await test("a recruited companion has a background, its class's count of skills beside it, and no repeats", async () => {
  const world = await table({ maxGuests: 6 });
  for (const classId of Object.keys(SKILL_COUNT)) {
    const { id } = await recruit(world, classId);
    const sheet = world.sheet(id);
    assert.notEqual(sheet.background, "", `${classId} has no background`);
    const skills = sheet.proficiencies.skills;
    assert.equal(new Set(skills).size, skills.length, `${classId}: ${skills.join(", ")}`);
    assert.equal(skills.length, SKILL_COUNT[classId] + 2, `${classId}: ${skills.join(", ")}`);
    await world.invoke("dismiss_companion", { characterId: id });
  }
});

await test("the background and skills a recruiter names are kept, a skill off the list is passed over with a note, and an unknown background is refused with the options", async () => {
  const world = await table();
  const { id, note } = await recruit(world, "fighter", { background: "Sailor", skills: ["Intimidation", "Arcana"] });
  const sheet = world.sheet(id);
  assert.equal(sheet.background, "sailor");
  assert.ok(sheet.proficiencies.skills.includes("intimidation"));
  assert.ok(!sheet.proficiencies.skills.includes("arcana"));
  assert.match(note, /Arcana is not among the skills/);
  const refused = await world.invoke("add_companion", {
    gender: "Unknown", name: "Other", class: "fighter", personality: "Quiet.", kind: "guest", background: "Astronaut",
  });
  assert.match(refused.error ?? refused.result?.error ?? "", /"Astronaut" is not a background this table offers\. Call add_companion again with one of: .*Soldier/);
});

await test("a half-elf companion takes the two skills its race leaves to it", async () => {
  const world = await table();
  const { id } = await recruit(world, "fighter", { race: "half-elf" });
  assert.equal(world.sheet(id).proficiencies.skills.length, 2 + 2 + 2);
});

// SRD 5.1, Rogue: Expertise at 1st and 6th level; Bard: at 3rd and 10th. Two
// proficient skills each time.
await test("a rogue or bard companion places the expertise its class has given, at recruitment and as it levels", async () => {
  const world = await table({ maxGuests: 6 });
  const check = (sheet, count) => {
    const expertise = sheet.proficiencies.expertise;
    assert.equal(expertise.length, count, `${sheet.class} ${sheet.level}: ${expertise.join(", ")}`);
    for (const skill of expertise) {
      assert.ok(sheet.proficiencies.skills.includes(skill), `${skill} is not among ${sheet.proficiencies.skills.join(", ")}`);
    }
  };
  const { id: rogue } = await recruit(world, "rogue");
  check(world.sheet(rogue), 2);
  check(await raiseTo(world, rogue, 6), 4);
  await world.invoke("dismiss_companion", { characterId: rogue });
  const { id: bard } = await recruit(world, "bard");
  check(world.sheet(bard), 0);
  check(await raiseTo(world, bard, 3), 2);
  check(await raiseTo(world, bard, 9), 2);
  check(await raiseTo(world, bard, 10), 4);
  await world.invoke("dismiss_companion", { characterId: bard });
  const { id: seasoned } = await recruit(world, "rogue", { name: "Seasoned", level: 6 });
  check(world.sheet(seasoned), 4);
  await world.invoke("dismiss_companion", { characterId: seasoned });
  const { id: lore } = await recruit(world, "bard", { name: "Lore", level: 10 });
  check(world.sheet(lore), 4);
  await world.invoke("dismiss_companion", { characterId: lore });
  const { id: fighter } = await recruit(world, "fighter");
  check(await raiseTo(world, fighter, 4), 0);
});

await test("a companion an older build left without expertise places it at its next level", async () => {
  const world = await table();
  const { id } = await recruit(world, "rogue");
  const made = world.sheet(id);
  world.patch(id, { proficiencies: { ...made.proficiencies, expertise: [] } });
  assert.deepEqual(world.sheet(id).proficiencies.expertise, []);
  assert.equal((await raiseTo(world, id, 2)).proficiencies.expertise.length, 2);
});

finish();
