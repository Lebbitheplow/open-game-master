// The clause ledger's probes for the picks a class's table counts out
// (SRD 5.1): a bard's second pair of Expertise and their Magical Secrets, a
// sorcerer's Metamagic options, a warlock's invocations and arcana. The
// clause text and the verdict live in scripts/clauses/srd-classes.json; this
// file holds how each is staged.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const options = await import("../src/lib/srd/options.ts");
const features = await import("../src/lib/srd/features.ts");
const { classSpellGrants } = await import("../src/lib/srd/class-spell-grants.ts");
const { levelUpSpells } = await import("../src/lib/srd/level-up-spells.ts");
const prep = await import("../src/lib/srd/spell-prep.ts");
const { checklistSpell, checklistSpellsOn } = await import("../src/lib/srd/spell-lists.ts");

const ABILITIES = { str: 10, dex: 14, con: 14, int: 16, wis: 16, cha: 16 };
const listOf = (classId, level) => checklistSpellsOn(classId).filter((spell) => spell.level === level).map((spell) => spell.name);
const classesOf = (name) => checklistSpell(name)?.classes ?? [];
const view = (classId, level, lists = {}) => ({
  classId, ability: "cha", level, subclass: "", style: prep.spellStyleFor(classId),
  known: [], prepared: [], cantrips: [], pending: [], spellbook: [], ...lists,
});
const levelUp = (classId, level, before, spells, forget) =>
  levelUpSpells({ before, level, subclass: "", list: classId, firstLevel: false, abilities: ABILITIES, freeCantrips: 0, spellOf: checklistSpell, picks: { kind: "picks", spells, ...(forget ? { forget } : {}) } });
// The spells a class knows at a level, filled from its lowest levels.
const knownAt = (classId, level) => {
  const cap = prep.spellCapOf(view(classId, level), ABILITIES).count;
  return [1, 2, 3, 4, 5].flatMap((spellLevel) => listOf(classId, spellLevel)).slice(0, cap);
};
const column = (count, levels) => Object.fromEntries(levels.map((level) => [level, count(level)]));
const P = {};

P["picks.bard.expertise"] = async () => {
  assert.deepEqual(column((level) => features.expertiseSlotsFor("bard", level), [2, 3, 9, 10, 20]), { 2: 0, 3: 2, 9: 2, 10: 4, 20: 4 }, "two skills at 3rd, another two at 10th");
  // The level-up's own count at 10th: two more than the pair already made.
  const { expertiseOpen } = await import("../src/app/campaigns/[campaignId]/level-up-preview.ts");
  const sheet = { class: "bard", level: 9, classes: [{ id: "bard", level: 9, subclass: "" }], proficiencies: { skills: ["perception", "persuasion", "stealth", "deception"], expertise: ["perception", "persuasion"] } };
  assert.equal(expertiseOpen(sheet, [{ id: "bard", level: 9, subclass: "" }]), 0, "the staging: nothing owed at 9th");
  assert.equal(expertiseOpen(sheet, [{ id: "bard", level: 10, subclass: "" }]), 2, "the second pair is owed at 10th");
};

P["picks.bard.magical-secrets"] = async () => {
  const secrets = (level) => classSpellGrants({ classId: "bard", level, subclass: "", features: [] }).anyList;
  assert.deepEqual(column(secrets, [9, 10, 13, 14, 17, 18]), { 9: 0, 10: 2, 13: 2, 14: 4, 17: 4, 18: 6 }, "two spells from any class at 10th, 14th and 18th");
  // At 14th the pair is taken from another class's list, at a level the bard casts.
  const known = knownAt("bard", 13);
  const other = (spellLevel) => checklistSpellsOn("wizard").filter((spell) => spell.level === spellLevel && !classesOf(spell.name).includes("bard")).map((spell) => spell.name);
  const taken = levelUp("bard", 14, view("bard", 13, { known }), [other(3)[0], other(7)[0]]);
  assert.ok(!("error" in taken), `two wizard spells as the 14th level secrets: ${taken.error}`);
  const beyond = levelUp("bard", 14, view("bard", 13, { known }), [other(3)[0], other(8)[0]]);
  assert.ok("error" in beyond, "an 8th-level spell was learned by a 14th-level bard");
};

P["picks.sorcerer.metamagic-count"] = async () => {
  assert.deepEqual(column((level) => options.optionSlotsFor("sorcerer", "", level, "metamagic"), [2, 3, 9, 10, 16, 17, 20]), { 2: 0, 3: 2, 9: 2, 10: 3, 16: 3, 17: 4, 20: 4 }, "two options at 3rd, another at 10th and at 17th");
};

P["picks.warlock.invocations-count"] = async () => {
  // The Invocations Known column of the Warlock table.
  const table = { 1: 0, 2: 2, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 5, 12: 6, 13: 6, 14: 6, 15: 7, 16: 7, 17: 7, 18: 8, 19: 8, 20: 8 };
  assert.deepEqual(column((level) => options.optionSlotsFor("warlock", "", level, "invocation"), Object.keys(table).map(Number)), table);
};

P["picks.warlock.mystic-arcanum"] = async () => {
  // One spell of the arcanum's level from the warlock list, at each level
  // that bestows one, and a cast of it for no slot once a long rest.
  for (const [level, arcanum] of [[11, 6], [13, 7], [15, 8], [17, 9]]) {
    const known = knownAt("warlock", level - 1);
    const before = view("warlock", level - 1, { known });
    const [pick] = listOf("warlock", arcanum);
    assert.ok(pick, `the staging: a level ${arcanum} warlock spell`);
    const taken = levelUp("warlock", level, before, [pick]);
    assert.ok(!("error" in taken), `the level ${arcanum} arcanum at warlock ${level}: ${taken.error}`);
    const early = levelUp("warlock", level - 1, view("warlock", level - 2, { known: knownAt("warlock", level - 2) }), [pick]);
    assert.ok("error" in early, `a level ${arcanum} spell was learned at warlock ${level - 1}`);
    const other = checklistSpellsOn("wizard").find((spell) => spell.level === arcanum && !classesOf(spell.name).includes("warlock"));
    assert.ok("error" in levelUp("warlock", level, before, [other.name]), `${other.name}, off the warlock list, was taken as the arcanum`);
    // "one" spell of that level: a second is not learned with the next level.
    const second = listOf("warlock", arcanum)[1];
    if (second && level < 20) {
      const again = levelUp("warlock", level + 1, view("warlock", level, { known: [...known, pick] }), [second]);
      assert.ok("error" in again, `a second level ${arcanum} spell (${second}) was learned at warlock ${level + 1}`);
    }
  }
  const t = await rig.table();
  const who = t.hero({ class: "warlock", level: 11 });
  assert.deepEqual(t.sheet(who).resources.mystic_arcanum_6, { max: 1, used: 0 }, "the 6th-level arcanum's one use at 11th");
  assert.equal(t.sheet(who).resources.mystic_arcanum_7, undefined, "a 7th-level arcanum before 13th");
  const elder = t.hero({ class: "warlock", level: 17 });
  assert.deepEqual([6, 7, 8, 9].map((arcanum) => t.sheet(elder).resources[`mystic_arcanum_${arcanum}`]?.max), [1, 1, 1, 1], "one arcanum of each level by 17th");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-picks.mjs", P);
