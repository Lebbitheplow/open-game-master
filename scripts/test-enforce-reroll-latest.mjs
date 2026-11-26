// "The save last failed" is the latest one, and so is "their last check".
//
// A feature that rolls a roll again finds it among the table's recent rolls.
// That list comes oldest first (src/lib/db/rolls.ts listRecentRolls), and six
// rules took its first match: with two failed saves on record, Indomitable
// rolled the older one again, against a DC and an effect that were long over.
// Two more turned the list round by hand first. All eight ask one function
// now, latestRoll, and this suite holds each at its own door: an older roll
// and a newer one are put on record, and the rule must answer the newer.
//
// The rules:
//   - a failed save rolled again: Indomitable and the ally Bulwark brings
//     along (src/lib/dm/feature-spends.ts), Fanatical Focus
//     (src/lib/dm/authored-spend-more.ts rerollLastSave), Peer Review and
//     The Final Chapter (src/lib/dm/genre-gh-horror-plays.ts);
//   - a check rolled again: The Final Chapter, Grease the Wheels
//     (src/lib/dm/genre-a-cyberpunk-spends.ts grease) and the reroll Silver
//     Tongue makes (src/lib/dm/genre-cc-a-checks.ts rerollFailedCheck);
//   - a failed check read with its d20 as a 20: Stroke of Luck
//     (src/lib/dm/mt-srd-rogue.ts).
//
// The last case reads the source: no rule picks from the recent rolls by the
// list's first match. It sees a `.find` chained on the call; a list kept in a
// variable first is out of its sight.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-reroll-latest");
const world = await openWorld({ campaign: { maxPlayers: 8 } });

const { CUSTOM_CLASS_FEATURES } = await import("../src/lib/classes/index.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { latestRoll, listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { rollExpression } = await import("../src/lib/dice.ts");
const { rerollFailedCheck } = await import("../src/lib/dm/genre-cc-a-checks.ts");
const { recordRoll } = await import("../src/lib/dm/roll-record.ts");
const { checkParts, saveParts } = await import("../src/lib/roll-parts.ts");

const SCORES = { str: 10, dex: 8, con: 12, int: 10, wis: 18, cha: 16 };
const d20 = (face) => rollExpression("1d20", () => face);

// A roll on record as a site hands it to the door: a 2 on the die, so a save
// or a check against any DC here is a failed one unless the case says more.
const onRecord = (hero, kind, detail, parts, dc, more = {}) =>
  recordRoll({ campaignId: world.campaignId, characterId: hero.id, requestedBy: "dm", kind, detail, parts, dc, result: d20(2), ...more });
const failedSave = (hero, ability, dc) => onRecord(hero, "saving_throw", `${ability.toUpperCase()} save`, saveParts(ability), dc);
const failedCheck = (hero, skill, dc) => onRecord(hero, "skill_check", `${skill} check`, checkParts({ skill }), dc);
const forget = () => getDatabase().prepare("DELETE FROM rolls WHERE campaign_id = ?").run(world.campaignId);

function genreHero(classId, level, more = {}) {
  const table = CUSTOM_CLASS_FEATURES[classId];
  return world.addHero({ user: world.addUser(), name: classId, class: classId, subclass: level >= table.subclassLevel ? table.subclasses[0].name : "", level, abilities: SCORES, proficiencies: TRAINED, ...more });
}
const borin = world.addHero({ name: "Borin", class: "fighter", level: 5, abilities: SCORES, proficiencies: TRAINED });
const zealot = world.addHero({ user: world.addUser(), name: "Zeal", class: "barbarian", subclass: "Path of the Zealot", level: 6, abilities: SCORES, proficiencies: TRAINED });
const marshal = world.addHero({ user: world.addUser(), name: "Marsh", class: "fighter", subclass: "Banneret", level: 18, abilities: SCORES, proficiencies: TRAINED });
const rogue = world.addHero({ user: world.addUser(), name: "Rook", class: "rogue", level: 20, abilities: SCORES, proficiencies: TRAINED });
const fixer = genreHero("fixer", 1);
const reader = genreHero("parapsychologist", 6);
const occultist = genreHero("occultist", 18);
// Fanatical Focus is once a rage.
assert.equal((await world.invoke("use_resource", { characterId: zealot.id, resource: "Rage" })).ok, true, "the zealot does not rage");
assert.ok(world.sheet(rogue.id).resources?.stroke_of_luck, "a rogue of 20 levels holds no Stroke of Luck");

const spend = (hero, resource, args = {}) => world.invoke("use_resource", { characterId: hero.id, resource, ...args });

// Each hero as they stand before any case, put back before each one: a use
// spent on one case, or a condition a reroll left, must not refuse the next.
const rested = [borin, zealot, marshal, rogue, fixer, reader, occultist].map((hero) => {
  const { resources, conditions, conditionMeta } = world.sheet(hero.id);
  return [hero.id, { resources, conditions, conditionMeta }];
});
function fresh() {
  forget();
  for (const [id, was] of rested) {
    world.patch(id, was);
  }
}

// What a spend rolled for a character beyond what the case laid: each roll as
// what its own fields say it was made with, and the DC it was rolled against.
async function rolledAfter(of, lay, act) {
  fresh();
  const laid = lay().map((roll) => roll.id);
  const out = await act();
  assert.equal(out.ok, true, out.error);
  const made = listRecentRolls(world.campaignId, 20).filter((roll) => roll.characterId === of.id && !laid.includes(roll.id));
  return { out, made: made.map((roll) => `${roll.parts?.used?.key} vs DC ${roll.dc}`) };
}

// ---- the lookup itself ----

await test("the latest of the recent rolls that fits is the one stored last, and nothing is found where none fits", () => {
  forget();
  const [older, newer] = [failedSave(borin, "dex", 11), failedSave(borin, "wis", 15)];
  failedCheck(borin, "athletics", 12);
  const save = (roll) => roll.kind === "saving_throw";
  assert.equal(listRecentRolls(world.campaignId, 60).find(save)?.id, older.id, "the list no longer comes oldest first: this suite's cases show nothing");
  assert.equal(latestRoll(world.campaignId, 60, save)?.id, newer.id);
  assert.equal(latestRoll(world.campaignId, 60, (roll) => roll.kind === "attack"), null);
});

// ---- a failed save rolled again ----

// An old failed save against DC 11, then a Wisdom save failed against DC 15:
// the reroll is the Wisdom save's. Peer Review rerolls an Intelligence,
// Wisdom or Charisma save only, so its older save is one of those too.
for (const [name, of, older, act] of [
  ["Indomitable", marshal, "dex", () => spend(marshal, "Indomitable")],
  ["Fanatical Focus", zealot, "dex", () => spend(zealot, "Fanatical Focus")],
  ["Peer Review", borin, "int", () => spend(reader, "Peer Review", { targetCharacterId: borin.id })],
  ["The Final Chapter", occultist, "dex", () => spend(occultist, "The Final Chapter")],
]) {
  await test(`${name} rolls again the save failed last, a Wisdom save against DC 15, and not the ${older.toUpperCase()} save failed before it`, async () => {
    const { made } = await rolledAfter(of, () => [failedSave(of, older, 11), failedSave(of, "wis", 15)], act);
    assert.deepEqual(made, ["wis vs DC 15"]);
  });
}

await test("The Final Chapter rolls again the save made last though it was a success: its reroll stands either way", async () => {
  const { made } = await rolledAfter(occultist, () => [failedSave(occultist, "dex", 11), onRecord(occultist, "saving_throw", "WIS save", saveParts("wis"), 15, { result: d20(19) })], () => spend(occultist, "The Final Chapter"));
  assert.deepEqual(made, ["wis vs DC 15"]);
});

await test("Bulwark brings along the ally who failed the fighter's save last, and not one who failed such a save before", async () => {
  // Two allies failed a Wisdom save against DC 15, the zealot long before.
  const lay = () => [failedSave(zealot, "wis", 15), failedSave(borin, "wis", 15), failedSave(marshal, "wis", 15)];
  const { out, made } = await rolledAfter(borin, lay, () => spend(marshal, "Indomitable"));
  assert.match(out.result.bulwark ?? "", /^Bulwark: Borin rerolls/);
  assert.deepEqual(made, ["wis vs DC 15"]);
});

// ---- a check rolled again ----

await test("The Final Chapter rolls again the check made last, a Persuasion check against DC 14, and not the Athletics check before it", async () => {
  const { made } = await rolledAfter(occultist, () => [failedCheck(occultist, "athletics", 12), failedCheck(occultist, "persuasion", 14)], () => spend(occultist, "The Final Chapter"));
  assert.deepEqual(made, ["persuasion vs DC 14"]);
});

await test("Grease the Wheels rolls again the check failed last, a Deception check against DC 14, and not the Persuasion check failed before it", async () => {
  const { made } = await rolledAfter(fixer, () => [failedCheck(fixer, "persuasion", 12), failedCheck(fixer, "deception", 14)], () => spend(fixer, "Grease the Wheels"));
  assert.deepEqual(made, ["deception vs DC 14"]);
});

await test("Silver Tongue's reroll is of the check failed last, a Deception check against DC 14, and not the Persuasion check failed before it", async () => {
  const act = () => {
    const out = rerollFailedCheck(world.campaign(), world.sheet(borin.id), "Silver Tongue", ["deception", "persuasion"]);
    return "error" in out ? { ok: false, error: out.error } : { ok: true, result: out.result };
  };
  const { made } = await rolledAfter(borin, () => [failedCheck(borin, "persuasion", 12), failedCheck(borin, "deception", 14)], act);
  assert.deepEqual(made, ["deception vs DC 14"]);
});

// ---- a failed check read with its d20 as a 20 ----

await test("Stroke of Luck turns the check failed last, against DC 14, and not a check failed before it", async () => {
  const { out, made } = await rolledAfter(rogue, () => [failedCheck(rogue, "athletics", 12), failedCheck(rogue, "stealth", 14)], () => spend(rogue, "Stroke of Luck"));
  assert.equal(out.result.check?.dc, 14, JSON.stringify(out.result));
  assert.equal(out.result.check?.detail, "stealth check");
  assert.deepEqual(made, [], "Stroke of Luck rolls nothing: it reads the die as a 20");
});

await test("Stroke of Luck does not turn an old failed check once the rogue has made a check since", async () => {
  fresh();
  failedCheck(rogue, "athletics", 12);
  onRecord(rogue, "skill_check", "stealth check", checkParts({ skill: "stealth" }), 14, { result: d20(19) });
  // What the counter's own path does with the call is not this case's business.
  const out = await spend(rogue, "Stroke of Luck");
  assert.equal(out.result?.check, undefined, "the old failed check was turned");
});

// ---- no rule takes the list's first match ----

const SRC = join(fileURLToPath(new URL("..", import.meta.url)), "src");
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

await test("no rule picks a roll from the recent rolls with find: the list's first match is its oldest, and latestRoll answers the latest", () => {
  const FIRST_MATCH = /listRecentRolls\([^()]*\)(?:\s*\.reverse\(\))?\s*\.find\(/;
  const found = sources(SRC).filter((path) => FIRST_MATCH.test(readFileSync(path, "utf8"))).map((path) => path.slice(SRC.length + 1).replaceAll("\\", "/"));
  assert.deepEqual(found, []);
});

world.close();
finish();
