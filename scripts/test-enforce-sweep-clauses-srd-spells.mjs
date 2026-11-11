// The clause ledger's probes for what a caster's lists may hold and how they
// change (SRD 5.1, each class's Spellcasting or Pact Magic): a new spell's
// level, the one spell replaced on a level, a wizard's book, what a prepared
// caster readies and when. The clause text and the verdict live in
// scripts/clauses/srd-classes.json; this file holds how each is staged.
//
// A level is taken through the level-up's own check
// (src/lib/srd/level-up-spells.ts), a preparation through the sheet's route.
import "./lib/enforce-world.mjs";
import { runOrSurvey } from "./lib/sweep-clauses-srd-survey.mjs";
import { assert, clauseRig, slots } from "./lib/sweep-clauses-srd-rig.mjs";

const rig = await clauseRig();
const { levelUpSpells } = await import("../src/lib/srd/level-up-spells.ts");
const prep = await import("../src/lib/srd/spell-prep.ts");
const { checklistSpell, checklistSpellsOn } = await import("../src/lib/srd/spell-lists.ts");
const { spellSlotsFor } = await import("../src/lib/srd/index.ts");

const ABILITIES = { str: 10, dex: 14, con: 14, int: 16, wis: 16, cha: 16 };
const ABILITY = { bard: "cha", ranger: "wis", sorcerer: "cha", warlock: "cha", wizard: "int", druid: "wis" };
// The class's own spells of one level, by name.
const listOf = (classId, level) => checklistSpellsOn(classId).filter((spell) => spell.level === level).map((spell) => spell.name);
const classesOf = (name) => checklistSpell(name)?.classes ?? [];
const view = (classId, level, lists = {}) => ({
  classId, ability: ABILITY[classId], level, subclass: "", style: prep.spellStyleFor(classId),
  known: [], prepared: [], cantrips: [], pending: [], spellbook: [], ...lists,
});
const levelUp = (classId, level, before, picks, extra = {}) =>
  levelUpSpells({ before, level, subclass: "", list: classId, firstLevel: false, abilities: ABILITIES, freeCantrips: 0, spellOf: checklistSpell, picks, ...extra });
const topAt = (classId, level) => Math.max(0, ...Object.keys(spellSlotsFor(classId, level)).map(Number));
const P = {};

// ---- the casters who know their spells ----

// The level each is taken to, where the Spells Known column adds one and the
// class has a slot level it did not have room above.
const KNOWN = { bard: 3, ranger: 5, sorcerer: 3, warlock: 5 };

for (const [classId, level] of Object.entries(KNOWN)) {
  const top = topAt(classId, level);
  // What the class knows the level before: as many 1st-level spells as its column says.
  const knownBefore = () => {
    const cap = prep.spellCapOf(view(classId, level - 1), ABILITIES);
    return listOf(classId, 1).slice(0, cap.count);
  };
  const fresh = (spellLevel) => listOf(classId, spellLevel).find((name) => !knownBefore().includes(name));

  P[`spells.${classId}.new-spell-level`] = async () => {
    const before = view(classId, level - 1, { known: knownBefore() });
    assert.ok(fresh(top) && fresh(top + 1), `the staging: ${classId} spells of level ${top} and ${top + 1}`);
    const within = levelUp(classId, level, before, { kind: "picks", spells: [fresh(top)] });
    assert.ok(!("error" in within), `a level ${top} spell at ${classId} ${level}: ${within.error}`);
    const beyond = levelUp(classId, level, before, { kind: "picks", spells: [fresh(top + 1)] });
    assert.ok("error" in beyond, `a ${classId} of level ${level} learned a level ${top + 1} spell with slots only to level ${top}`);
  };

  P[`spells.${classId}.swap-one`] = async () => {
    const known = knownBefore();
    const before = view(classId, level - 1, { known });
    const taken = listOf(classId, 1).filter((name) => !known.includes(name));
    // The level's new spell, and one given up for another.
    const swap = levelUp(classId, level, before, { kind: "picks", spells: [fresh(top), taken[0]], forget: known[0] });
    assert.ok(!("error" in swap), `one spell replaced on the level: ${swap.error}`);
    assert.ok(!swap.view.known.includes(known[0]) && swap.view.known.includes(taken[0]), "the spell given up is gone and its replacement known");
    // Two given up.
    const two = levelUp(classId, level, before, { kind: "lists", lists: { known: [...known.slice(2), fresh(top), taken[0], taken[1]], prepared: [], cantrips: [] } });
    assert.ok("error" in two, "two spells were replaced on one level");
    // The replacement is held to the class's list and its slots.
    const other = checklistSpellsOn(classId === "bard" ? "wizard" : "bard").find((spell) => spell.level === 1 && !classesOf(spell.name).includes(classId));
    assert.ok(other, "the staging: a 1st-level spell off the class's list");
    const offList = levelUp(classId, level, before, { kind: "picks", spells: [fresh(top), other.name], forget: known[0] });
    assert.ok("error" in offList, `the replacement was ${other.name}, off the ${classId} list`);
    const tooHigh = levelUp(classId, level, before, { kind: "picks", spells: [fresh(top), fresh(top + 1)], forget: known[0] });
    assert.ok("error" in tooHigh, `the replacement was a level ${top + 1} spell`);
  };
}

// ---- the wizard's book ----

P["spells.wizard.first-book"] = async () => {
  const first = listOf("wizard", 1);
  const start = (spells) => levelUp("wizard", 1, view("wizard", 0), { kind: "picks", spells }, { firstLevel: true });
  const six = start(first.slice(0, 6));
  assert.ok(!("error" in six), six.error);
  assert.equal(prep.spellbookOf(six.view).length, 6, "six 1st-level spells in a new wizard's book");
  assert.ok("error" in start(first.slice(0, 7)), "a seventh spell was written in the first book");
  assert.ok("error" in start([...first.slice(0, 5), listOf("wizard", 2)[0]]), "a 2nd-level spell was written in a 1st-level wizard's book");
  // Cantrips are fixed in the mind, not written in the book.
  const cantrips = listOf("wizard", 0).slice(0, 3);
  const withCantrips = start([...first.slice(0, 6), ...cantrips]);
  assert.ok(!("error" in withCantrips), withCantrips.error);
  assert.deepEqual(prep.spellbookOf(withCantrips.view).filter((name) => cantrips.includes(name)), [], "a cantrip was written in the spellbook");
  assert.deepEqual([...withCantrips.view.cantrips].sort(), [...cantrips].sort());
};

P["spells.wizard.two-a-level"] = async () => {
  const book = listOf("wizard", 1).slice(0, 6);
  const more = listOf("wizard", 1).slice(6, 9);
  const before = view("wizard", 2, { spellbook: book, prepared: book.slice(0, 4) });
  const two = levelUp("wizard", 3, before, { kind: "picks", spells: [more[0], listOf("wizard", 2)[0]] });
  assert.ok(!("error" in two), two.error);
  assert.equal(prep.spellbookOf(two.view).length, 8, "two spells added to the book for the level");
  assert.ok("error" in levelUp("wizard", 3, before, { kind: "picks", spells: more }), "three spells were added to the book for one level");
  // "of a level for which you have spell slots": 2nd at 3rd level, not 3rd.
  assert.ok("error" in levelUp("wizard", 3, before, { kind: "picks", spells: [more[0], listOf("wizard", 3)[0]] }), "a 3rd-level spell was added at wizard level 3");
};

// A preparation through the sheet's own route, as the player makes it.
async function prepare(t, who, action, spell) {
  const route = await t.world.route("campaigns/[campaignId]/sheet/spells");
  t.world.signIn(t.world.owner);
  const response = await route.POST(
    new Request("http://odm.test/spells", { method: "POST", body: JSON.stringify({ action, spell, sheetId: who.id }) }),
    { params: Promise.resolve({ campaignId: t.world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

P["spells.wizard.prepares-from-book"] = async () => {
  const t = await rig.table();
  const [inBook, alsoInBook, notInBook] = listOf("wizard", 1);
  const high = listOf("wizard", 3)[0];
  const who = t.hero({
    class: "wizard", level: 3, abilities: { int: 16 },
    spellcasting: { ability: "int", slots: slots(4, 2), prepared: [inBook], known: [], cantrips: [], spellbook: [inBook, alsoInBook, high] },
  });
  const outside = await prepare(t, who, "prepare", notInBook);
  assert.equal(outside.status, 400, `a spell that is not in the book was prepared: ${JSON.stringify(outside.body).slice(0, 160)}`);
  const beyond = await prepare(t, who, "prepare", high);
  assert.equal(beyond.status, 400, "a 3rd-level spell in the book was prepared by a 3rd-level wizard");
  const written = await prepare(t, who, "prepare", alsoInBook);
  assert.equal(written.status, 200, JSON.stringify(written.body).slice(0, 200));
};

for (const classId of ["wizard", "druid"]) {
  // "if you're a 3rd-level wizard, you have four 1st-level and two 2nd-level
  // spell slots": the table the example reads.
  P[`spells.${classId}.slots-example`] = async () => {
    assert.deepEqual(spellSlotsFor(classId, 3), { 1: 4, 2: 2 }, `a 3rd-level ${classId}'s slots`);
    assert.equal(topAt(classId, 3), 2);
  };

  // A new list is readied by the long rest, not before it.
  P[`spells.${classId}.long-rest-change`] = async () => {
    const t = await rig.table();
    const [held, wanted] = listOf(classId, 1);
    const who = t.hero({
      class: classId, level: 3, abilities: { [ABILITY[classId]]: 16 },
      spellcasting: { ability: ABILITY[classId], slots: slots(4, 2), prepared: [held], known: [], cantrips: [], ...(classId === "wizard" ? { spellbook: [held, wanted] } : {}) },
    });
    const asked = await prepare(t, who, "prepare", wanted);
    assert.equal(asked.status, 200, JSON.stringify(asked.body).slice(0, 200));
    assert.ok(!t.sheet(who).spellcasting.prepared.includes(wanted), "the spell was ready before any rest");
    assert.ok(prep.notReadyReason(t.sheet(who).spellcasting, wanted), "a spell waiting for the rest is castable");
    const rested = await t.rest("long");
    assert.equal(rested.ok, true, rested.error);
    assert.ok(t.sheet(who).spellcasting.prepared.includes(wanted), "the long rest did not ready the new list");
    assert.equal(prep.notReadyReason(t.sheet(who).spellcasting, wanted), null);
  };
}

P["spells.druid.prepares-from-list"] = async () => {
  const t = await rig.table();
  const [held, wanted] = listOf("druid", 1);
  const who = t.hero({ class: "druid", level: 3, abilities: { wis: 16 }, spellcasting: { ability: "wis", slots: slots(4, 2), prepared: [held], known: [], cantrips: [] } });
  const other = checklistSpellsOn("wizard").find((spell) => spell.level === 1 && !classesOf(spell.name).includes("druid"));
  const offList = await prepare(t, who, "prepare", other.name);
  assert.equal(offList.status, 400, `${other.name}, off the druid list, was prepared`);
  // "The spells must be of a level for which you have spell slots."
  const high = await prepare(t, who, "prepare", listOf("druid", 3)[0]);
  assert.equal(high.status, 400, "a 3rd-level spell was prepared by a 3rd-level druid");
  const fine = await prepare(t, who, "prepare", wanted);
  assert.equal(fine.status, 200, JSON.stringify(fine.body).slice(0, 200));
  const second = await prepare(t, who, "prepare", listOf("druid", 2)[0]);
  assert.equal(second.status, 200, JSON.stringify(second.body).slice(0, 200));
};

// ---- the Circle of the Land ----

P["spells.druid.land-bonus-cantrip"] = async () => {
  const cantrips = listOf("druid", 0);
  const before = view("druid", 1, { cantrips: cantrips.slice(0, 2), prepared: [listOf("druid", 1)[0]] });
  const land = levelUp("druid", 2, before, { kind: "picks", spells: [cantrips[2]] }, { subclass: "Circle of the Land" });
  assert.ok(!("error" in land), `the circle's additional cantrip at 2nd level: ${land.error}`);
  assert.equal(land.view.cantrips.length, 3);
  const two = levelUp("druid", 2, before, { kind: "picks", spells: [cantrips[2], cantrips[3]] }, { subclass: "Circle of the Land" });
  assert.ok("error" in two, "the circle taught two additional cantrips");
  const plain = levelUp("druid", 2, before, { kind: "picks", spells: [cantrips[2]] });
  assert.ok("error" in plain, "a druid of no circle learned a third cantrip at 2nd level");
};

P["spells.druid.circle-spells-ready"] = async () => {
  const t = await rig.table();
  const six = listOf("druid", 1).slice(0, 6);
  const who = t.hero({ class: "druid", level: 3, subclass: "Circle of the Land", abilities: { wis: 16 }, equipment: [{ name: "Component pouch", qty: 1 }], spellcasting: { ability: "wis", slots: slots(4, 2), prepared: six, known: [], cantrips: [] } });
  t.patch(who, { features: [...t.sheet(who).features, { name: "Circle Spells (Coast)", source: "choice" }] });
  assert.ok(!classesOf("Mirror Image").includes("druid"), "the staging: Mirror Image is not on the druid list");
  // Ready without a place on the list, which is already full (3 + WIS 3).
  const cast = await t.invoke("cast_buff", { characterId: who.id, spell: "Mirror Image", targetCharacterIds: [who.id] });
  assert.equal(cast.ok, true, `a Coast druid casts Mirror Image, never prepared: ${cast.error}`);
  assert.equal(t.sheet(who).spellcasting.slots["2"].used, 1, "the circle spell took a druid's 2nd-level slot");
  assert.equal(t.sheet(who).spellcasting.prepared.length, 6, "the circle spell took a place on the prepared list");
  const full = await prepare(t, who, "prepare", listOf("druid", 1)[6]);
  assert.equal(full.status, 400, "a seventh spell was prepared");
  // A druid of the forest has no Mirror Image.
  const t2 = await rig.table();
  const other = t2.hero({ class: "druid", level: 3, subclass: "Circle of the Land", abilities: { wis: 16 }, equipment: [{ name: "Component pouch", qty: 1 }], spellcasting: { ability: "wis", slots: slots(4, 2), prepared: six, known: [], cantrips: [] } });
  t2.patch(other, { features: [...t2.sheet(other).features, { name: "Circle Spells (Forest)", source: "choice" }] });
  const none = await t2.invoke("cast_buff", { characterId: other.id, spell: "Mirror Image", targetCharacterIds: [other.id] });
  assert.ok(none.error, "a Forest druid cast the Coast's Mirror Image");
};

await runOrSurvey("scripts/test-enforce-sweep-clauses-srd-spells.mjs", P);
