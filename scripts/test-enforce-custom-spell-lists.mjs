// A workshop class may cast from a spell list of its own, picked from the
// SRD's spells and the table's homebrew, instead of borrowing a published
// class's (issue #833); a workshop subclass may add spells to its class's
// list, as a warlock patron does; and every place that asks "is this spell
// on this caster's list" gives one answer (src/lib/classes/class-spell-list.ts,
// src/lib/srd/spell-prep.ts spellOnCasterList): the creation check, a
// level-up, the GM's learn_spell, the sheet's prepare, the searches the
// builder and the spell book read, quick build and AI companions.
//
// The bugs it carries the tests for, each of which failed before:
// - a search offered every homebrew spell to every class and level, and the
//   sheet's prepare took any of them as on the list;
// - learn_spell let any caster learn a homebrew spell that named no class,
//   and refused a spell tagged with a workshop class to that class;
// - a casting workshop class always borrowed a published list ("wizard");
// - companions and the builder's supply read the bundled checklist alone;
// - a copied pack or artificer class always borrowed the wizard's list.
import assert from "node:assert/strict";
import { openCreation, LEGAL_WIZARD, PORTRAIT } from "./lib/enforce-creation.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-custom-spell-lists");

const { workshopClassId, normalizeClassData } = await import("../src/lib/homebrew/class-data.ts");
const { findCustomClass, spellClassFor } = await import("../src/lib/classes/index.ts");
const { searchSpells } = await import("../src/lib/content/index.ts");
const { checklistSpellsOn } = await import("../src/lib/srd/spell-lists.ts");
const { spellStyleFor } = await import("../src/lib/srd/spell-prep.ts");
const { subclassExpandedSpellsFor } = await import("../src/lib/srd/features.ts");
const { subclassExtrasForTable } = await import("../src/lib/db/subclass-extras.ts");

const table = await openCreation({ campaign: { maxPlayers: 8 } });
const { world } = table;
const homebrew = await world.route("homebrew");
const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
const spellsRoute = await world.route("campaigns/[campaignId]/sheet/spells");

async function brew(kind, name, data) {
  world.signIn(world.owner);
  const response = await homebrew.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ kind, name, data }) }));
  return { status: response.status, body: await response.json() };
}

async function call(mod, method, userId, body) {
  world.signIn({ id: userId });
  const request = new Request("http://test/", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const response = await mod[method](request, { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, json: await response.json() };
}

const SPELL = { desc: "A spell of the table's own.", school: "evocation", casting_time: "1 action", range: "60 feet", components: "V, S", duration: "Instantaneous" };

// A class's numbers, a wizard's training, so the creation check reads only
// the spells (LEGAL_WIZARD's sheet holds to them).
const CLASS_BASE = {
  desc: "A caster of the table's own.",
  hitDie: 6,
  saves: ["int", "wis"],
  skillChoices: { count: 2, from: ["investigation", "insight", "religion", "medicine"] },
  armor: [],
  weapons: ["daggers", "darts", "slings", "quarterstaffs", "light crossbows"],
  tools: [],
  spellAbility: "int",
  subclassLevel: 1,
  levels: {},
};

// The table's homebrew spells: one the Runesmith's list names, one tagged
// with the druid, one that names no class and is on no list.
const emberLance = await brew("spell", "Ember Lance", { ...SPELL, level: 1, classes: [] });
const groveSong = await brew("spell", "Grove Song", { ...SPELL, level: 1, classes: ["druid"] });
const straySpark = await brew("spell", "Stray Spark", { ...SPELL, level: 1, classes: [] });

const RUNE_LIST = ["Fire Bolt", "Light", "Mage Hand", "Shield", "Magic Missile", "Cure Wounds", "Detect Magic", "Ember Lance"];
const runesmith = await brew("class", "Runesmith", { ...CLASS_BASE, casterType: "full", spellListFrom: "custom", spellList: RUNE_LIST, spellStyle: "prepared" });
const runeId = runesmith.body.entry ? workshopClassId(runesmith.body.entry.id) : "";
// A half caster with its own list that learns its spells, as a ranger does.
const chanter = await brew("class", "Chanter", {
  ...CLASS_BASE,
  casterType: "half",
  spellListFrom: "custom",
  spellList: ["Cure Wounds", "Bless", "Shield of Faith", "Healing Word", "Sanctuary"],
  spellStyle: "known",
});
const chantId = chanter.body.entry ? workshopClassId(chanter.body.entry.id) : "";
// A pact caster on the warlock's list, as every workshop caster was before.
const hexer = await brew("class", "Hexer", { ...CLASS_BASE, casterType: "pact", spellListFrom: "warlock", spellAbility: "cha" });
const hexId = hexer.body.entry ? workshopClassId(hexer.body.entry.id) : "";

// Homebrew tagged with the workshop classes themselves.
const runeflare = await brew("spell", "Runeflare", { ...SPELL, level: 0, classes: [runeId] });
const gloomshot = await brew("spell", "Gloomshot", { ...SPELL, level: 1, classes: [hexId] });
// A subclass of the Runesmith that adds Burning Hands to its list.
const emberCircle = await brew("archetype", "Ember Circle", { desc: "", classSlug: runeId, levels: { 1: [{ n: "Kindled", d: "Fire answers you." }] }, expanded: { 1: ["Burning Hands"] } });

const authors = [world.owner.id];

// A level 1 Runesmith, LEGAL_WIZARD's numbers on the Runesmith's list.
function runeSheet(spellcasting, extra = {}) {
  return {
    ...LEGAL_WIZARD,
    name: "Odda",
    class: runeId,
    portrait: PORTRAIT,
    spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, known: [], ...spellcasting },
    ...extra,
  };
}

await test("the workshop keeps every entry the suite needs", () => {
  for (const [label, made] of Object.entries({ emberLance, groveSong, straySpark, runesmith, chanter, hexer, runeflare, gloomshot, emberCircle })) {
    assert.equal(made.status, 201, `${label}: ${JSON.stringify(made.body)}`);
  }
});

// ---- the class's data ----

await test("a class with a list of its own keeps its spells and how it holds them; a borrowed list keeps neither", () => {
  const own = normalizeClassData({ ...CLASS_BASE, casterType: "full", spellListFrom: "custom", spellList: ["Shield", "Shield", " Light "], spellStyle: "known" });
  assert.ok("data" in own, JSON.stringify(own));
  assert.deepEqual([own.data.spellListFrom, own.data.spellList, own.data.spellStyle], ["custom", ["Shield", "Light"], "known"]);
  const borrowed = normalizeClassData({ ...CLASS_BASE, casterType: "full", spellListFrom: "cleric", spellList: ["Shield"], spellStyle: "known" });
  assert.equal(borrowed.data.spellListFrom, "cleric");
  assert.equal("spellList" in borrowed.data, false, "a borrowed list kept a list of its own");
  // A pact caster learns, as the warlock does, whatever the draft said.
  const pact = normalizeClassData({ ...CLASS_BASE, casterType: "pact", spellListFrom: "custom", spellList: ["Hex"], spellStyle: "prepared" });
  assert.equal(pact.data.spellStyle, "known");
});

await test("a list of its own with no spells on it is refused, in plain words", async () => {
  const empty = await brew("class", "Hollow", { ...CLASS_BASE, casterType: "full", spellListFrom: "custom", spellList: [] });
  assert.equal(empty.status, 400, JSON.stringify(empty.body));
  assert.match(empty.body.error ?? "", /at least one spell/);
});

await test("the class casts from its own list, counted as the caster that holds spells the same way", async () => {
  const { spellRulesClassFor } = await import("../src/lib/classes/index.ts");
  assert.equal(spellClassFor(runeId), runeId, "the Runesmith borrowed a list");
  assert.deepEqual(findCustomClass(runeId).customSpells, RUNE_LIST);
  assert.equal(spellRulesClassFor(runeId), "cleric");
  assert.equal(spellStyleFor(runeId), "prepared");
  assert.equal(spellRulesClassFor(chantId), "ranger");
  assert.equal(spellStyleFor(chantId), "known");
  // A borrowed list is counted by its own class, as before.
  assert.equal(spellClassFor(hexId), "warlock");
  assert.equal(spellRulesClassFor(hexId), "warlock");
});

// ---- the searches ----

await test("a search for a class's spells holds the table's homebrew to that class and level", () => {
  const wizard = searchSpells({ classSlug: "wizard", userIds: authors, limit: 200 }).map((row) => row.name);
  assert.equal(wizard.includes("Grove Song"), false, "a druid's homebrew spell was offered to a wizard");
  assert.equal(wizard.includes("Stray Spark"), false, "a homebrew spell that names no class was offered to a wizard");
  const druid = searchSpells({ classSlug: "druid", userIds: authors, limit: 200 }).map((row) => row.name);
  assert.ok(druid.includes("Grove Song"), druid.join(", "));
  const cantrips = searchSpells({ classSlug: "druid", level: 0, userIds: authors, limit: 200 }).map((row) => row.name);
  assert.equal(cantrips.includes("Grove Song"), false, "a 1st level homebrew spell answered a cantrip search");
});

await test("a search for a workshop class answers its own list and the homebrew tagged with it", () => {
  const rune = searchSpells({ classSlug: runeId, userIds: authors, limit: 200 }).map((row) => row.name);
  for (const name of ["Ember Lance", "Runeflare"]) assert.ok(rune.includes(name), `${name} missing: ${rune.join(", ")}`);
  for (const name of ["Stray Spark", "Grove Song", "Gloomshot"]) assert.equal(rune.includes(name), false, `${name} offered to the Runesmith`);
  const hex = searchSpells({ classSlug: hexId, userIds: authors, limit: 200 }).map((row) => row.name);
  assert.ok(hex.includes("Gloomshot"), "a spell tagged with a borrowing workshop class is not on its list");
});

await test("the bundled checklist answers for a workshop class: its own list, or the one it borrows", () => {
  const rune = checklistSpellsOn(runeId).map((spell) => spell.name).sort();
  assert.deepEqual(rune, RUNE_LIST.filter((name) => name !== "Ember Lance").sort());
  assert.deepEqual(checklistSpellsOn(hexId), checklistSpellsOn("warlock"));
});

await test("the pool companions choose from carries the table's homebrew on the list", async () => {
  const { classSpellPool } = await import("../src/lib/content/index.ts");
  const pool = classSpellPool(runeId, authors).map((spell) => spell.name);
  for (const name of ["Fire Bolt", "Cure Wounds", "Ember Lance", "Runeflare"]) assert.ok(pool.includes(name), `${name} missing: ${pool.join(", ")}`);
  assert.equal(pool.includes("Stray Spark"), false);
  assert.equal(pool.includes("Sleep"), false, "a wizard spell off the Runesmith's list");
});

// ---- the creation check ----

const LEGAL_RUNE = { prepared: ["Shield", "Magic Missile", "Cure Wounds", "Ember Lance"], cantrips: ["Fire Bolt", "Light", "Runeflare"] };

await test("a Runesmith is made with spells from its own list, SRD and homebrew", async () => {
  const made = await table.atTable(runeSheet(LEGAL_RUNE));
  assert.equal(made.status, 201, made.error ?? "");
  assert.deepEqual(made.sheet.spellcasting.prepared, LEGAL_RUNE.prepared);
});

await test("a spell off the Runesmith's list is refused at creation, a wizard's or an untagged homebrew one", async () => {
  for (const name of ["Sleep", "Stray Spark"]) {
    const made = await table.atTable(runeSheet({ ...LEGAL_RUNE, prepared: ["Shield", name] }));
    assert.equal(made.status >= 400, true, `${name} was taken`);
    assert.match(made.error ?? "", new RegExp(`${name}.*Runesmith`), made.error ?? "");
  }
});

await test("the counts follow the chosen way of holding spells: a cleric's three cantrips and Intelligence + level prepared", async () => {
  const cantrips = await table.atTable(runeSheet({ ...LEGAL_RUNE, cantrips: ["Fire Bolt", "Light", "Mage Hand", "Runeflare"] }));
  assert.equal(cantrips.status >= 400, true, "four cantrips at 1st level were taken");
  const prepared = await table.atTable(runeSheet({ ...LEGAL_RUNE, prepared: [...LEGAL_RUNE.prepared, "Detect Magic"] }));
  assert.equal(prepared.status >= 400, true, "five spells prepared at 1st level with Intelligence 16 were taken");
});

await test("a subclass's additions join the class's list from their level, and only with the subclass", async () => {
  const extras = subclassExtrasForTable(world.campaignId, world.owner.id);
  assert.deepEqual(subclassExpandedSpellsFor(runeId, "Ember Circle", 1, extras), ["Burning Hands"]);
  const without = await table.atTable(runeSheet({ ...LEGAL_RUNE, prepared: ["Shield", "Burning Hands"] }));
  assert.equal(without.status >= 400, true, "Burning Hands was taken without the subclass");
  const withIt = await table.atTable(runeSheet({ ...LEGAL_RUNE, prepared: ["Shield", "Burning Hands"] }, { subclass: "Ember Circle" }));
  assert.equal(withIt.status, 201, withIt.error ?? "");
});

await test("a third caster's subclass may add to its list too, and its additions sit outside the two schools", async () => {
  const sub = await brew("archetype", "Hexknight", {
    desc: "",
    classSlug: "fighter",
    castingProfile: "eldritch-knight",
    levels: { 3: [{ n: "Runed Guard", d: "Your blade remembers." }] },
    expanded: { 3: ["Bless"] },
  });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const { judgeSpellcasting } = await import("../src/lib/srd/legality/spells.ts");
  const { classGrantsFor, spellFactsFor } = await import("../src/lib/characters/catalog.ts");
  const extras = subclassExtrasForTable(world.campaignId, world.owner.id);
  const judge = (subclass, known) =>
    judgeSpellcasting({
      sent: { ability: "int", slots: {}, known, prepared: [], cantrips: ["Fire Bolt", "Light"] },
      classes: [{ id: "fighter", level: 3, subclass }],
      classOf: (id) => classGrantsFor(id, authors),
      subclassExtras: extras,
      abilities: { str: 16, dex: 12, con: 14, int: 14, wis: 10, cha: 8 },
      spellOf: (name) => spellFactsFor(name, authors),
      judgeLists: true,
      bookAllowance: true,
    }).problems;
  // Bless is an enchantment from the cleric's list: the subclass's own pick.
  assert.deepEqual(judge("Hexknight", ["Shield", "Magic Missile", "Bless"]), []);
  // The Eldritch Knight's own list and schools hold for anything else.
  assert.ok(judge("Hexknight", ["Shield", "Magic Missile", "Sanctuary"]).length > 0, "Sanctuary was taken by an Eldritch Knight");
});

await test("a borrowed list is held exactly as before: the warlock's spells, and the homebrew tagged with the class", async () => {
  const hexSheet = (known) => ({
    ...LEGAL_WIZARD,
    name: "Morrow",
    class: hexId,
    portrait: PORTRAIT,
    racialChoices: { asi: [], skills: [], cantrips: ["Prestidigitation"], tool: "" },
    spellcasting: { ability: "cha", slots: { 1: { max: 1, used: 0 } }, known, prepared: [], cantrips: ["Eldritch Blast", "Minor Illusion"] },
  });
  const legal = await table.atTable(hexSheet(["Hex", "Gloomshot"]));
  assert.equal(legal.status, 201, legal.error ?? "");
  const off = await table.atTable(hexSheet(["Hex", "Cure Wounds"]));
  assert.equal(off.status >= 400, true, "a cleric spell was taken by a warlock-list class");
});

// ---- in play ----

const runeHero = (level, lists, extra = {}) =>
  world.addHero({
    name: "Thane",
    class: runeId,
    level,
    abilities: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: [], ...lists },
    ...extra,
  });

await test("the GM's learn_spell teaches a spell on the list and refuses one off it, an untagged homebrew spell included", async () => {
  const hero = runeHero(3, { prepared: ["Shield"], cantrips: ["Fire Bolt", "Light"] });
  const ok = await world.invoke("learn_spell", { characterId: hero.id, spell: "Cure Wounds", action: "add" });
  assert.equal(ok.ok, true, ok.error);
  const off = await world.invoke("learn_spell", { characterId: hero.id, spell: "Sleep", action: "add" });
  assert.equal(off.refused, "rules", JSON.stringify(off));
  assert.match(off.error, /Runesmith spell list/);
  const stray = await world.invoke("learn_spell", { characterId: hero.id, spell: "Stray Spark", action: "add" });
  assert.equal(stray.refused, "rules", `a homebrew spell that names no class was taught: ${JSON.stringify(stray)}`);
  const own = await world.invoke("learn_spell", { characterId: hero.id, spell: "Runeflare", action: "add" });
  assert.equal(own.ok, true, own.error);
});

await test("learn_spell teaches a spell tagged with a borrowing workshop class to that class", async () => {
  const hero = world.addHero({
    name: "Sable",
    class: hexId,
    level: 3,
    abilities: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 16 },
    spellcasting: { ability: "cha", slots: { 2: { max: 2, used: 0 } }, known: ["Hex"], prepared: [], cantrips: ["Eldritch Blast"] },
  });
  const out = await world.invoke("learn_spell", { characterId: hero.id, spell: "Gloomshot", action: "add" });
  assert.equal(out.ok, true, JSON.stringify(out));
});

await test("the sheet prepares a spell on the list, and refuses a homebrew spell off it", async () => {
  const hero = runeHero(3, { prepared: ["Shield"], cantrips: ["Fire Bolt", "Light"] });
  const on = await call(spellsRoute, "POST", hero.userId, { action: "prepare", spell: "Ember Lance", sheetId: hero.id });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  for (const name of ["Stray Spark", "Grove Song", "Sleep"]) {
    const off = await call(spellsRoute, "POST", hero.userId, { action: "prepare", spell: name, sheetId: hero.id });
    assert.equal(off.status, 400, `${name} was prepared: ${JSON.stringify(off.json)}`);
  }
});

await test("a level-up adds a spell on the list and refuses one off it", async () => {
  const levelUp = async (added) => {
    const hero = runeHero(2, { prepared: ["Shield", "Magic Missile"], cantrips: ["Fire Bolt", "Light", "Mage Hand"] });
    world.patch(hero.id, { xp: 900 });
    const before = world.sheet(hero.id);
    const out = await call(sheetRoute, "PATCH", hero.userId, {
      level: 3,
      spellcasting: { ...before.spellcasting, prepared: [...before.spellcasting.prepared, added] },
    });
    return { out, after: world.sheet(hero.id) };
  };
  const on = await levelUp("Cure Wounds");
  assert.equal(on.out.status, 200, JSON.stringify(on.out.json));
  assert.ok(on.after.spellcasting.prepared.includes("Cure Wounds"));
  const off = await levelUp("Sleep");
  assert.equal(off.out.status >= 400, true, "Sleep was taken at a Runesmith's level-up");
  assert.match(off.out.json.error ?? "", /Sleep is not on the Runesmith spell list/);
});

await test("an AI companion of the class takes its spells from the class's own list", async () => {
  const out = await world.invoke("add_companion", { name: "Pell", class: runeId, level: 3, race: "human", gender: "Female", personality: "Patient and exact.", kind: "party" });
  assert.equal(out.ok, true, JSON.stringify(out));
  const companion = world.sheets().find((sheet) => sheet.name === "Pell");
  const names = [...(companion.spellcasting?.cantrips ?? []), ...(companion.spellcasting?.prepared ?? []), ...(companion.spellcasting?.known ?? [])];
  assert.ok(names.length > 0, "the companion has no spells");
  const list = new Set([...RUNE_LIST, "Runeflare"]);
  for (const name of names) assert.ok(list.has(name), `${name} is off the Runesmith's list`);
  // And it levels as a Runesmith, its new picks from the same list.
  const { autoLevelCompanion } = await import("../src/lib/dm/companion-level.ts");
  world.patch(companion.id, { xp: 2700 });
  autoLevelCompanion(world.campaign(), companion.id);
  const after = world.sheet(companion.id);
  assert.equal(after.level, 4, `the companion stayed at level ${after.level}`);
  const held = [...(after.spellcasting?.cantrips ?? []), ...(after.spellcasting?.prepared ?? []), ...(after.spellcasting?.known ?? [])];
  for (const name of held) assert.ok(list.has(name), `${name} is off the Runesmith's list after a level`);
});

// ---- the builder ----

await test("the builder searches and counts the class by its own list", async () => {
  const { builderCasting, builderSpellAdvice } = await import("../src/app/characters/builder/casting.ts");
  const klass = findCustomClass(runeId);
  const casting = builderCasting(klass, "", 1);
  assert.deepEqual([casting.list, casting.rules, casting.cantripCap], [runeId, "cleric", 3]);
  const advice = builderSpellAdvice(casting, klass, "", 1, LEGAL_WIZARD.abilities);
  assert.deepEqual([advice.label, advice.count], ["spells prepared", 4]);
  const { spellOnSavedList, withPoolSupply } = await import("../src/app/characters/builder/spellSupply.ts");
  assert.equal(spellOnSavedList("Shield", { third: false, spellClass: runeId }), true);
  assert.equal(spellOnSavedList("Sleep", { third: false, spellClass: runeId }), false);
  // A list of the table's own spells is supplied by the pool, not the
  // checklist alone.
  const derived = {
    spellSupply: { cantrips: 0, spells: 0 },
    maxSpellLevel: 1,
    racialCantrips: [],
    featSpells: { cantrips: [], spells: [] },
    subclassSpells: [],
    casterDesks: [{ lead: true, spellSupply: { cantrips: 0, spells: 0 } }],
  };
  const grown = withPoolSupply(derived, [{ name: "Runeflare", level: 0 }, { name: "Ember Lance", level: 1 }]);
  assert.deepEqual(grown.casterDesks[0].spellSupply, { cantrips: 1, spells: 1 });
});

await test("a half caster that learns its spells is counted as a ranger: two known at 2nd level", async () => {
  const { spellCapOf } = await import("../src/lib/srd/spell-prep.ts");
  const view = { classId: chantId, ability: "int", level: 2, subclass: "", style: "known", known: [], prepared: [], cantrips: [], pending: [], spellbook: [] };
  assert.deepEqual(spellCapOf(view, LEGAL_WIZARD.abilities), { label: "spells known", count: 2 });
});

// ---- copies ----

await test("a copied class with a list no SRD class has keeps that list, not the wizard's", async () => {
  const { bundledClassTable } = await import("../src/lib/workshop/class-catalog.ts");
  const artificer = bundledClassTable("artificer");
  assert.ok(artificer, "the bundled artificer could not be copied");
  assert.equal(artificer.spellListFrom, "custom", JSON.stringify(artificer.spellListFrom));
  assert.deepEqual(artificer.spellList, checklistSpellsOn("artificer").map((spell) => spell.name));
  assert.equal(bundledClassTable("cleric").spellListFrom, "cleric");
  // (A content pack's own caster is scripts/test-custom-spell-lists-pack.mjs,
  // on a pack of its own.)
});

await test("a copy reads a class's spells only when its list is its own, not for every caster a search lists", async () => {
  const { bundledClassTable } = await import("../src/lib/workshop/class-catalog.ts");
  const asked = [];
  const spy = (classId) => {
    asked.push(classId);
    return checklistSpellsOn(classId).map((spell) => spell.name);
  };
  for (const classId of ["cleric", "wizard", "paladin", "warlock", "fighter"]) bundledClassTable(classId, spy);
  assert.deepEqual(asked, [], `the spells of ${asked.join(", ")} were read for a published list`);
  bundledClassTable("artificer", spy);
  assert.deepEqual(asked, ["artificer"]);
});

// ---- the search's pages ----
// (Whose list a search may read is scripts/test-custom-spell-lists-pack.mjs:
// it shows only through the pack's rows.)

await test("a search pages the table's own spells with the pack's, so a pager ends", () => {
  const all = searchSpells({ classSlug: runeId, userIds: authors, limit: 200 }).map((row) => row.name);
  assert.ok(all.length >= 2, all.join(", "));
  const first = searchSpells({ classSlug: runeId, userIds: authors, limit: 1, offset: 0 }).map((row) => row.name);
  const second = searchSpells({ classSlug: runeId, userIds: authors, limit: 1, offset: 1 }).map((row) => row.name);
  assert.equal(first.length, 1, `a page of one held ${first.join(", ")}`);
  assert.equal(second.length, 1, `a page of one held ${second.join(", ")}`);
  assert.notEqual(first[0], second[0], "the second page repeated the first");
  const past = searchSpells({ classSlug: runeId, userIds: authors, limit: 200, offset: all.length });
  assert.deepEqual(past, [], "a page past the end still held the table's own spells");
});

await test("a lite search answers names and levels without each spell's text", async () => {
  const content = await world.route("content/[kind]");
  world.signIn(world.owner);
  const ask = async (extra) => {
    const response = await content.GET(new Request(`http://test/api/content/spells?q=ember${extra}`), { params: Promise.resolve({ kind: "spells" }) });
    return (await response.json()).results ?? [];
  };
  const full = await ask("");
  assert.ok(full.some((row) => row.data?.desc), "the full answer carries the text");
  const lite = await ask("&lite=1");
  assert.ok(lite.length > 0 && lite.length === full.length, `lite answered ${lite.length} of ${full.length}`);
  for (const row of lite) {
    assert.equal(row.data?.desc, undefined, `${row.name} came with its text`);
    assert.equal(typeof row.level, "number");
  }
});

// ---- bundles and character files ----

await test("a spell tagged with a workshop class travels with it, and is on the class's list where it lands", async () => {
  const { characterFileShelf, landCharacterFile } = await import("../src/lib/db/character-file.ts");
  const hero = runeHero(1, { prepared: ["Shield"], cantrips: ["Fire Bolt", "Light", "Runeflare"] });
  const file = characterFileShelf(world.owner.id, world.sheet(hero.id));
  const tagged = file.homebrew.find((entry) => entry.kind === "spell" && entry.name === "Runeflare");
  assert.ok(tagged, `the tagged cantrip was left out: ${file.homebrew.map((entry) => entry.name).join(", ")}`);
  assert.deepEqual(tagged.data.classes, ["homebrew:@class:Runesmith"], "the tag kept this server's id");
  const importer = world.addUser("importer");
  const landed = landCharacterFile(importer.id, { name: "Odda", sheet: file.sheet, homebrew: file.homebrew });
  const { listHomebrew } = await import("../src/lib/db/homebrew.ts");
  const herClass = listHomebrew(importer.id, "class").find((entry) => entry.name === "Runesmith");
  assert.ok(herClass, "the class did not land");
  const herSpell = listHomebrew(importer.id, "spell").find((entry) => entry.name === "Runeflare");
  assert.deepEqual(herSpell.data.classes, [workshopClassId(herClass.id)], "the tag does not name the class as it is here");
  assert.equal(landed.sheet.class, workshopClassId(herClass.id));
  const { spellOnListKey } = await import("../src/lib/classes/class-spell-list.ts");
  assert.equal(spellOnListKey(workshopClassId(herClass.id), { name: "Runeflare", classes: herSpell.data.classes }), true);
});

// ---- renames and limits ----

await test("a homebrew spell renamed is renamed on the class's own list and a subclass's additions", async () => {
  const entryRoute = await world.route("homebrew/[id]");
  const renameSpell = async (from, to) => {
    world.signIn(world.owner);
    const id = (from === "Ember Lance" ? emberLance : groveSong).body.entry.id;
    const response = await entryRoute.PATCH(new Request("http://test/", { method: "PATCH", body: JSON.stringify({ name: to }) }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  };
  await renameSpell("Ember Lance", "Ember Spear");
  const { listHomebrew } = await import("../src/lib/db/homebrew.ts");
  const rune = listHomebrew(world.owner.id, "class").find((entry) => entry.name === "Runesmith");
  assert.ok(rune.data.spellList.includes("Ember Spear"), rune.data.spellList.join(", "));
  assert.equal(rune.data.spellList.includes("Ember Lance"), false);
  // The registry follows the kept entry: the class's own list answers to
  // the new name.
  assert.ok(findCustomClass(runeId).customSpells.includes("Ember Spear"));
  const withExpanded = await brew("archetype", "Grove Pact", { desc: "", classSlug: runeId, levels: {}, expanded: { 1: ["Grove Song"] } });
  assert.equal(withExpanded.status, 201, JSON.stringify(withExpanded.body));
  await renameSpell("Grove Song", "Grove Hymn");
  const pact = listHomebrew(world.owner.id, "archetype").find((entry) => entry.name === "Grove Pact");
  assert.deepEqual(pact.data.expanded, { 1: ["Grove Hymn"] });
});

await test("a list past what a list keeps is refused by name, not cut", async () => {
  const many = Array.from({ length: 401 }, (_, index) => `Spell ${index}`);
  const over = await brew("class", "Overfull", { ...CLASS_BASE, casterType: "full", spellListFrom: "custom", spellList: many });
  assert.equal(over.status, 400, JSON.stringify(over.body));
  assert.match(JSON.stringify(over.body), /keeps 400 at most/);
  const levels = await brew("archetype", "Crowded", { desc: "", classSlug: runeId, levels: {}, expanded: { 1: ["Bless", "Shield", "Sleep", "Light", "Fire Bolt", "Mage Hand", "Command"] } });
  assert.equal(levels.status, 400, JSON.stringify(levels.body));
});

await test("a renamed spell is renamed on a co-author's class at the table too", async () => {
  const { setAssistantDm, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
  const coAuthor = world.addUser("co-gm");
  assert.ok(!("error" in joinByInviteCode(coAuthor.id, world.campaign().inviteCode)), "the co-GM could not join");
  assert.equal(setAssistantDm(world.campaignId, coAuthor.id), true);
  world.signIn(coAuthor);
  const response = await homebrew.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ kind: "class", name: "Ashwright", data: { ...CLASS_BASE, casterType: "full", spellListFrom: "custom", spellList: ["Ember Spear", "Shield"] } }) }));
  const made = await response.json();
  assert.equal(response.status, 201, JSON.stringify(made));
  const entryRoute = await world.route("homebrew/[id]");
  world.signIn(world.owner);
  const renamed = await entryRoute.PATCH(new Request("http://test/", { method: "PATCH", body: JSON.stringify({ name: "Ember Pike" }) }), { params: Promise.resolve({ id: emberLance.body.entry.id }) });
  assert.equal(renamed.status, 200);
  const { listHomebrew } = await import("../src/lib/db/homebrew.ts");
  const theirs = listHomebrew(coAuthor.id, "class").find((entry) => entry.name === "Ashwright");
  assert.deepEqual(theirs.data.spellList, ["Ember Pike", "Shield"]);
  assert.ok(findCustomClass(workshopClassId(made.entry.id)).customSpells.includes("Ember Pike"));
});

await test("a list keeps each spell once by its name key, and counts it once against the cap", async () => {
  const kept = normalizeClassData({ ...CLASS_BASE, casterType: "full", spellListFrom: "custom", spellList: ["Shield", "shield", " SHIELD ", "Light"] });
  assert.deepEqual(kept.data.spellList, ["Shield", "Light"]);
  const many = [...Array.from({ length: 400 }, (_, index) => `Spell ${index}`), "spell 0"];
  const atCap = await brew("class", "Brimful", { ...CLASS_BASE, casterType: "full", spellListFrom: "custom", spellList: many });
  assert.equal(atCap.status, 201, JSON.stringify(atCap.body));
});

// ---- an older host ----

await test("the editor's new controls wait for a host that keeps them", async () => {
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  const { hostOffers } = await import("../src/lib/use-capabilities.ts");
  assert.equal(SERVER_FEATURES.customSpellLists, true);
  assert.equal(hostOffers({ features: { afterRollChoice: true } }, "customSpellLists"), false, "an older host was offered a list of its own");
  assert.equal(hostOffers({ features: { customSpellLists: true } }, "customSpellLists"), true);
});

finish();
