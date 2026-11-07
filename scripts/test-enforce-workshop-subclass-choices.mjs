// A workshop subclass's own choices (issue #833): "custom subclasses could
// offer similar selectable options, such as bloodlines, elemental
// affinities, or other subclass-specific choices." Before, a workshop
// subclass could only open the SRD's pick-lists by borrowing a published
// feature's name, and a pick of the author's own was dropped by every check
// (only options.json named picks).
//
//   - The workshop keeps a subclass's choices, each held to its limits and
//     refused by name, and refuses a label the engines would read as a
//     feature of their own ("Elemental Affinity").
//   - The builder offers the choice, the server refuses an option the
//     choice does not offer, and the pick is kept as "Bloodline (Storm)"
//     with what the option grants written beside it.
//   - The level-up offers it at its level; an old sheet owes it, and the
//     sheet's owed picks make it (POST /sheet/owed).
//   - Elemental Affinity, borrowed, adds Charisma to a spell of the chosen
//     element and its sorcery point resists that element.
//   - The option's resistance, skill, language and spells apply; an edit to
//     another option takes them off; a subclass without choices is as it was.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";
import { patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-enforce-workshop-subclass-choices");
const { world, call, libraryRoute } = await openCreation({ campaign: { maxPlayers: 16 } });
const builder = await openBuilder();
const homebrewRoute = await world.route("homebrew");
const characterRoute = await world.route("characters/[characterId]");
const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
const owedRoute = await world.route("campaigns/[campaignId]/sheet/owed");
const { subclassExtrasForTable } = await import("../src/lib/db/subclass-extras.ts");
const { registerBrowserSubclassExtras } = await import("../src/lib/srd/subclass-tables.ts");
const { extraSubclassOf } = await import("../src/lib/srd/subclass-tables.ts");
const { subclassSpellsFor, populateFeaturesForClasses } = await import("../src/lib/srd/features.ts");
const { subclassFindings } = await import("../src/lib/rulesets/validate-options.ts");
const { pcResistances } = await import("../src/lib/dm/pc-defenses.ts");
const { spellDamageRiders } = await import("../src/lib/srd/spell-damage-riders.ts");
const { owedPickSlots, owedPickLines } = await import("../src/lib/srd/owed-picks-logic.ts");
const { levelUpOptions } = await import("../src/lib/srd/level-up-options.ts");
const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
const { hostOffers } = await import("../src/lib/use-capabilities.ts");
const { describeFeature } = await import("../src/lib/help/index.ts");
const { buildDmMessages } = await import("../src/lib/dm/prompt.ts");
const { listMembers } = await import("../src/lib/db/campaigns.ts");
const { homebrewDataRefs, renameHomebrewDataRefs } = await import("../src/lib/homebrew/data-refs.ts");
const { markAffinityCast } = await import("../src/lib/dm/affinity-cast.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");

const owner = world.owner;
const STORM = {
  name: "Storm",
  description: "Thunder in the blood.",
  damageType: "lightning",
  resistances: ["lightning"],
  skills: ["nature"],
  languages: ["Primordial"],
  spells: { 3: ["Shatter"] },
};
const FROST = { name: "Frost", damageType: "cold", resistances: ["cold"] };
const stormBlooded = (choices) => ({
  desc: "Sorcerers whose blood remembers a storm.",
  classSlug: "sorcerer",
  levels: {
    1: [{ n: "Stormborn", d: "The air crackles when you are angry." }],
    6: [{ n: "Elemental Affinity", d: "Add your Charisma modifier to one damage roll of a spell of your bloodline's damage type." }],
  },
  choices,
});
const BLOODLINE = { label: "Bloodline", level: 1, options: [STORM, FROST] };

async function brew(name, data) {
  world.signIn(owner);
  return call(homebrewRoute, "POST", { kind: "archetype", name, data });
}

// The table's subclasses as the server reads them, and as the builder's
// browser registers them (useBuilderOptions, the campaign snapshot).
const extras = () => subclassExtrasForTable(world.campaignId, owner.id);
// Registered for one browser-side check and cleared after it: left filled,
// a later server-path check read the browser's registry and passed without
// the table's extras (issue #833 review).
function inBrowser(fn) {
  const previous = globalThis.window;
  globalThis.window = globalThis.window ?? {};
  const tables = extras();
  try {
    for (const [classId, list] of Object.entries(tables)) registerBrowserSubclassExtras(classId, list);
    return fn();
  } finally {
    for (const classId of Object.keys(tables)) registerBrowserSubclassExtras(classId, []);
    if (previous === undefined) delete globalThis.window;
  }
}

const names = (sheet) => (sheet.features ?? []).map((feature) => feature.name);
// Each on a player of its own, who makes the picks.
let seats = 0;
function hero(overrides) {
  seats += 1;
  const user = world.addUser(`storm-player-${seats}`);
  const sheet = world.addHero({ class: "sorcerer", subclass: "Storm-Blooded", abilities: { cha: 16 }, user, ...overrides });
  return { ...sheet, user };
}

// ---- the workshop ----

await test("The workshop keeps a subclass's choice, ids made from the options' names; a choice past its limits, or one the engines would read as their own, is refused by name.", async () => {
  const saved = await brew("Storm-Blooded", stormBlooded([BLOODLINE]));
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  const [choice] = saved.json.entry.data.choices;
  assert.equal(choice.label, "Bloodline");
  assert.equal(choice.level, 1);
  assert.deepEqual(choice.options.map((option) => option.id), ["storm", "frost"]);
  assert.deepEqual(choice.options[0].spells, { 3: ["Shatter"] });
  const lonely = await brew("Lone Blood", stormBlooded([{ ...BLOODLINE, options: [STORM] }]));
  assert.equal(lonely.status, 400);
  assert.match(lonely.json.error, /"Bloodline" holds 2 to 16 options; it has 1/);
  const unknown = await brew("Odd Blood", stormBlooded([{ ...BLOODLINE, options: [STORM, { name: "Ooze", damageType: "slime" }] }]));
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.error, /"Ooze"'s damage type is one the table knows/);
  const clash = await brew("Borrowed Blood", stormBlooded([{ ...BLOODLINE, label: "Elemental Affinity" }]));
  assert.equal(clash.status, 400);
  assert.match(clash.json.error, /would read the choice's label, "Elemental Affinity"/);
  const bracket = await brew("Bracket Blood", stormBlooded([{ ...BLOODLINE, label: "Blood (Old)" }]));
  assert.equal(bracket.status, 400, "a label with brackets would read as a pick of its own");
});

await test("A subclass without choices is as it was: no choices kept, its features granted as before.", async () => {
  const plain = await brew("Ember-Touched", { ...stormBlooded(undefined), choices: undefined });
  assert.equal(plain.status, 201, JSON.stringify(plain.json));
  assert.equal("choices" in plain.json.entry.data, false);
  const ember = hero({ subclass: "Ember-Touched", level: 6 });
  assert.ok(names(world.sheet(ember.id)).includes("Elemental Affinity"));
  assert.equal(owedPickSlots(world.sheet(ember.id), { extras: extras() }).choices.length, 0);
  assert.equal(extraSubclassOf({ name: "Ember-Touched", source: "homebrew", data: plain.json.entry.data }).choices, undefined);
});

await test("The choice's option spells are named for a rename and a bundle, as the subclass's own are.", () => {
  const data = stormBlooded([BLOODLINE]);
  assert.deepEqual(homebrewDataRefs("archetype", data).spell, ["Shatter"]);
});

// With custom spell lists (PR #839) a subclass also holds `expanded`, the
// spells it adds to its class's list: a rename and "only what this workshop
// uses" follow all three tables at once (issue #833).
await test("A subclass's refs hold its always-prepared spells, its expanded list and each choice option's spells, and a rename reaches all three.", () => {
  const data = {
    classSlug: "sorcerer",
    spells: { 1: ["Thunderwave"] },
    expanded: { 3: ["Gust of Wind"] },
    choices: [{ id: "bloodline", label: "Bloodline", level: 1, options: [{ id: "storm", name: "Storm", spells: { 1: ["Shatter"] } }] }],
  };
  assert.deepEqual(homebrewDataRefs("archetype", data).spell.sort(), ["Gust of Wind", "Shatter", "Thunderwave"]);
  const rename = (kind, name) => (kind === "spell" ? `${name} (renamed)` : name);
  const { data: renamed, changed } = renameHomebrewDataRefs("archetype", data, rename);
  assert.ok(changed);
  assert.deepEqual(renamed.spells, { 1: ["Thunderwave (renamed)"] });
  assert.deepEqual(renamed.expanded, { 3: ["Gust of Wind (renamed)"] });
  assert.deepEqual(renamed.choices[0].options[0].spells, { 1: ["Shatter (renamed)"] });
});

await test("The workshop's checker says when an option's element is read by nothing the subclass holds.", () => {
  const without = { ...stormBlooded([BLOODLINE]), levels: { 1: [{ n: "Stormborn", d: "" }] } };
  assert.ok(subclassFindings(without).some((finding) => /element is words for the GM/.test(finding.text)));
  assert.ok(!subclassFindings(stormBlooded([BLOODLINE])).some((finding) => /element is words/.test(finding.text)), "Elemental Affinity reads it");
});

// ---- the builder and creation ----

await test("The builder offers the choice and keeps the pick; the payload sends it as a choice feature.", () => inBrowser(() => {
  const sorcerer = builder.classes.find((entry) => entry.id === "sorcerer");
  const built = builder.build({ race: "human", class: sorcerer, background: "sage", level: 1, subclass: "Storm-Blooded" });
  const slot = built.derived.subclassChoiceSlots.find((entry) => entry.label === "Bloodline");
  assert.ok(slot, "the builder offers the Bloodline");
  assert.deepEqual(slot.options.map((option) => option.name), ["Storm", "Frost"]);
  const blocks = builder.submit.callingBlocks(sorcerer, built.state, built.derived).map((entry) => entry.message);
  assert.ok(blocks.some((message) => /Pick your Bloodline \(Storm-Blooded\)/.test(message)), `a choice left open stops the builder: ${blocks.join(" | ")}`);
  const picked = builder.build({ race: "human", class: sorcerer, background: "sage", level: 1, subclass: "Storm-Blooded", optionPicks: ["Bloodline (Storm)"] });
  assert.equal(picked.derived.subclassChoiceSlots[0].chosen?.name, "Storm");
  assert.ok(picked.sheet.features.some((feature) => feature.name === "Bloodline (Storm)" && feature.source === "choice"));
}));

// A level 1 human sorcerer on a pick, built by the builder's own code.
function built(pick, more = {}) {
  return inBrowser(() => builtNow(pick, more));
}
function builtNow(pick, more) {
  const sorcerer = builder.classes.find((entry) => entry.id === "sorcerer");
  const result = builder.build({
    race: "human",
    class: sorcerer,
    background: "sage",
    level: 1,
    subclass: more.subclass ?? "Storm-Blooded",
    scores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    chosenSkills: ["arcana", "insight"],
    bonusLanguages: ["Elvish", "Dwarvish", "Giant"],
    cantrips: ["Fire Bolt", "Light", "Mage Hand", "Shocking Grasp"],
    spells: ["Magic Missile", "Shield"],
    optionPicks: [pick],
    ...more,
  });
  return { ...result.sheet, portrait: { url: "/uploads/enforce-creation.png" } };
}

let made;

await test("The server refuses an option the choice does not offer, and keeps one it does with what it grants.", async () => {
  world.signIn(owner);
  const odd = built("Bloodline (Storm)");
  odd.features = odd.features.map((feature) => (feature.name === "Bloodline (Storm)" ? { ...feature, name: "Bloodline (Thunder)" } : feature));
  const refused = await call(libraryRoute, "POST", { level: 1, sheet: odd });
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.match(JSON.stringify(refused.json), /Thunder.*is not one of Storm-Blooded's Bloodline options/);
  const response = await call(libraryRoute, "POST", { level: 1, sheet: built("Bloodline (Storm)") });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  made = response.json.character;
  const sheet = made.sheet;
  assert.ok(sheet.features.some((feature) => feature.name === "Bloodline (Storm)" && feature.source === "choice"), names(sheet).join(", "));
  assert.ok(names(sheet).includes("Lightning Resistance"));
  assert.ok(names(sheet).includes("Bloodline damage type: Lightning"));
  assert.match(pcResistances(sheet) ?? "", /lightning/);
  assert.ok(sheet.proficiencies.languages.includes("Primordial"), sheet.proficiencies.languages.join(", "));
  assert.ok(sheet.proficiencies.skills.includes("nature"), sheet.proficiencies.skills.join(", "));
});

await test("An edit to Frost takes off what Storm gave: no lightning, no Primordial, no Nature, and resists cold instead.", async () => {
  world.signIn(owner);
  const edited = await call(characterRoute, "PATCH", { level: 1, sheet: built("Bloodline (Frost)") }, { characterId: made.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const sheet = edited.json.character.sheet;
  assert.ok(names(sheet).includes("Bloodline (Frost)"));
  assert.ok(!names(sheet).includes("Bloodline (Storm)"));
  assert.ok(!names(sheet).includes("Lightning Resistance"), names(sheet).join(", "));
  assert.ok(names(sheet).includes("Cold Resistance"));
  assert.ok(names(sheet).includes("Bloodline damage type: Cold"));
  assert.ok(!sheet.proficiencies.languages.includes("Primordial"), sheet.proficiencies.languages.join(", "));
  assert.ok(!sheet.proficiencies.skills.includes("nature"), sheet.proficiencies.skills.join(", "));
});

// ---- the table ----

await test("The pick's spells come at their class level, always prepared; a second pick of the same choice is not kept.", () => {
  const features = [{ name: "Bloodline (Storm)", source: "choice" }];
  assert.deepEqual(subclassSpellsFor("sorcerer", "Storm-Blooded", 2, extras(), features), []);
  assert.deepEqual(subclassSpellsFor("sorcerer", "Storm-Blooded", 3, extras(), features), ["Shatter"]);
  const kept = populateFeaturesForClasses(
    [{ name: "Bloodline (Storm)", source: "choice" }, { name: "Bloodline (Frost)", source: "choice" }],
    [{ id: "sorcerer", subclass: "Storm-Blooded", level: 3 }],
    "human",
    [],
    extras(),
  ).map((feature) => feature.name);
  assert.ok(kept.includes("Bloodline (Storm)") && !kept.includes("Bloodline (Frost)"), kept.join(", "));
  assert.ok(!kept.includes("Cold Resistance"));
  const moved = populateFeaturesForClasses(features.map((feature) => ({ ...feature })), [{ id: "sorcerer", subclass: "Wild Magic", level: 3 }], "human", [], extras());
  assert.ok(!moved.some((feature) => feature.name === "Bloodline (Storm)" || feature.name === "Lightning Resistance"), "another subclass keeps no pick of this one");
});

await test("Elemental Affinity, borrowed, adds Charisma to a spell of the chosen element and nothing to another.", () => {
  const sorcerer = hero({ level: 6, features: [{ name: "Bloodline (Storm)", source: "choice" }] });
  const sheet = world.sheet(sorcerer.id);
  assert.ok(names(sheet).includes("Elemental Affinity"));
  assert.equal(spellDamageRiders(sheet, { damageType: "lightning", level: 1 }).flat, 3);
  assert.equal(spellDamageRiders(sheet, { damageType: "fire", level: 1 }).flat, 0);
});

await test("Elemental Affinity's sorcery point resists the chosen element, and says where it came from.", async () => {
  const sorcerer = hero({ level: 6, features: [{ name: "Bloodline (Storm)", source: "choice" }] });
  // The point is spent as a spell of the element is cast: the cast tools
  // note it (src/lib/dm/affinity-cast.ts), reading the chosen element too.
  markAffinityCast(world.campaign(), world.sheet(sorcerer.id), "fire");
  assert.ok(!world.sheet(sorcerer.id).conditions.some((condition) => /affinity cast/.test(condition)), "a fire spell is not the bloodline's");
  markAffinityCast(world.campaign(), world.sheet(sorcerer.id), "lightning");
  assert.ok(world.sheet(sorcerer.id).conditions.includes("affinity cast (lightning)"), "a lightning spell is noted");
  const out = await world.invoke("use_resource", { characterId: sorcerer.id, resource: "Elemental Affinity" });
  assert.equal(out.ok, true, out.error);
  assert.match(JSON.stringify(out), /their Bloodline \(lightning\)/);
  const resisting = world.sheet(sorcerer.id);
  assert.ok(resisting.conditions.includes("elemental affinity (lightning)"), resisting.conditions.join(", "));
});

await test("The level-up offers the choice at its level when the sheet holds none, takes it, and refuses an option it does not offer.", async () => {
  const sorcerer = hero({ level: 1, maxHp: 8 });
  await world.invoke("award_xp", { characterIds: [sorcerer.id], amount: 300, reason: "earned in play" });
  const before = world.sheet(sorcerer.id);
  const options = levelUpOptions(before, { hpMethod: "average", multiclassAllowed: true, subclassesOf: () => [], freeCantrips: 0, subclassExtras: extras() });
  const pick = options.choices?.featurePicks?.find((entry) => /Bloodline/.test(entry.label));
  assert.ok(pick, JSON.stringify(options.choices?.featurePicks));
  assert.deepEqual(pick.options, ["Bloodline (Storm)", "Bloodline (Frost)"]);
  const level = (features) => patchSheetAs(world, sheetRoute, sorcerer.user, { level: 2, features });
  const refused = await level([{ name: "Bloodline (Thunder)", source: "choice" }]);
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.match(refused.json.error, /Thunder.*is not one of Storm-Blooded's Bloodline options/);
  const taken = await level([{ name: "Bloodline (Frost)", source: "choice" }]);
  assert.equal(taken.status, 200, JSON.stringify(taken.json));
  const after = world.sheet(sorcerer.id);
  assert.equal(after.level, 2);
  assert.ok(names(after).includes("Bloodline (Frost)") && names(after).includes("Cold Resistance"), names(after).join(", "));
});

await test("An old sheet owes the choice; the sheet's owed picks make it, with its training, and refuse an option it does not offer.", async () => {
  const sorcerer = hero({ level: 6 });
  const old = world.sheet(sorcerer.id);
  assert.ok(owedPickLines(old, { extras: extras() }).some((line) => /Storm-Blooded's Bloodline: 1 to choose/.test(line)), owedPickLines(old, { extras: extras() }).join(" | "));
  const post = async (features) => {
    world.signIn(sorcerer.user);
    const response = await owedRoute.POST(
      new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: sorcerer.id, features }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    return { status: response.status, json: await response.json() };
  };
  const odd = await post(["Bloodline (Thunder)"]);
  assert.equal(odd.status, 400, JSON.stringify(odd.json));
  const made = await post(["Bloodline (Storm)"]);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const stored = world.sheet(sorcerer.id);
  assert.ok(names(stored).includes("Bloodline (Storm)") && names(stored).includes("Lightning Resistance"), names(stored).join(", "));
  assert.ok(stored.proficiencies.languages.includes("Primordial"));
  assert.ok(stored.proficiencies.skills.includes("nature"));
  assert.equal(owedPickSlots(stored, { extras: extras() }).choices.length, 0, "no longer owed");
  const again = await post(["Bloodline (Frost)"]);
  assert.equal(again.status, 400, "one pick");
});

await test("The help and the GM's prompt say what the pick gives.", () => {
  inBrowser(() => assert.match(describeFeature("sorcerer", "Storm-Blooded", "Bloodline (Storm)") ?? "", /Thunder in the blood\..*lightning is its element.*resists lightning damage/));
  assert.match(describeFeature("sorcerer", "Storm-Blooded", "Bloodline damage type: Lightning") ?? "", /Bloodline chosen: lightning\. Elemental Affinity/);
  const sorcerer = hero({ level: 3, features: [{ name: "Bloodline (Storm)", source: "choice" }] });
  const sheet = world.sheet(sorcerer.id);
  const text = buildDmMessages({ campaign: world.campaign(), members: listMembers(world.campaignId), sheets: [sheet], encounter: null, recentRolls: [], storySummary: "" }, [])[0].content;
  assert.match(text, /Bloodline \(Storm\) \(Thunder in the blood\./);
});

await test("An older host offers no editor for the choices: the section waits for the flag.", () => {
  assert.equal(SERVER_FEATURES.subclassChoices, true);
  assert.equal(hostOffers({ features: {} }, "subclassChoices"), false);
  assert.equal(hostOffers({ features: { subclassChoices: true } }, "subclassChoices"), true);
});


// ---- review fixes (issue #833 review) ----

const homebrewEntry = await world.route("homebrew/[id]");
const { isMechanicalFeature } = await import("../src/lib/srd/legality/features.ts");
const { chosenElementType } = await import("../src/lib/srd/dragon-ancestor.ts");
const { subclassChoiceSlots } = await import("../src/lib/srd/subclass-choice-picks.ts");
const { browserSubclassExtras } = await import("../src/lib/srd/subclass-tables.ts");
const { joinChanges } = await import("../src/lib/characters/join-changes.ts");
const { owedChoiceGroups } = await import("../src/lib/srd/owed-choices.ts");

const SQUALL = { name: "Squall", damageType: "lightning", resistances: ["lightning"], skills: ["nature"], languages: ["Primordial"] };
const HUSH = { name: "Hush", resistances: ["cold"] };
const gale = (options) => stormBlooded([{ label: "Gift", level: 1, options }]);
let galeEntry;
let galeHero;
let hushHero;

await test("A pick keeps its choice's and option's ids, and an author's rename keeps the pick, its grants and its training.", async () => {
  const saved = await brew("Gale-Blooded", gale([SQUALL, HUSH]));
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  galeEntry = saved.json.entry;
  assert.equal(galeEntry.data.choices[0].id, "gift", "the choice keeps an id made from its label");
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built("Gift (Squall)", { subclass: "Gale-Blooded" }) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  galeHero = made.json.character;
  const pick = galeHero.sheet.features.find((feature) => feature.name === "Gift (Squall)");
  assert.equal(pick?.optionId, "gift/squall", "the pick holds the ids");
  // Squall renamed Tempest, its id kept.
  const renamed = structuredClone(galeEntry.data);
  renamed.choices[0].options[0].name = "Tempest";
  const patched = await call(homebrewEntry, "PATCH", { data: renamed }, { id: galeEntry.id });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  const regranted = populateFeaturesForClasses(galeHero.sheet.features, [{ id: "sorcerer", subclass: "Gale-Blooded", level: 1 }], "human", [], extras()).map((feature) => feature.name);
  assert.ok(regranted.includes("Gift (Tempest)") && regranted.includes("Lightning Resistance") && regranted.includes("Gift damage type: Lightning"), regranted.join(", "));
  assert.equal(owedPickSlots(galeHero.sheet, { extras: extras() }).choices.length, 0, "not owed again");
  // An edit from a builder that still names Squall keeps the pick.
  // As the builder reopens the stored character: the pick by its name, and
  // the ids its stored copy keeps (useBuilderState pickIds).
  const edited = await call(characterRoute, "PATCH", { level: 1, sheet: built("Gift (Squall)", { subclass: "Gale-Blooded", pickIds: { [textKey("Gift (Squall)")]: "gift/squall" } }) }, { characterId: galeHero.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const sheet = edited.json.character.sheet;
  assert.ok(names(sheet).includes("Gift (Tempest)") && names(sheet).includes("Lightning Resistance"), names(sheet).join(", "));
  assert.ok(sheet.proficiencies.skills.includes("nature") && sheet.proficiencies.languages.includes("Primordial"));
});

await test("An option the author deletes leaves nothing behind at the next edit: its skill and language go with it.", async () => {
  const pruned = structuredClone(galeEntry.data);
  pruned.choices[0].options = [{ name: "Breeze", resistances: ["thunder"] }, { name: "Calm" }];
  const patched = await call(homebrewEntry, "PATCH", { data: pruned }, { id: galeEntry.id });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  world.signIn(owner);
  const edited = await call(characterRoute, "PATCH", { level: 1, sheet: built("Gift (Breeze)", { subclass: "Gale-Blooded" }) }, { characterId: galeHero.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const sheet = edited.json.character.sheet;
  assert.ok(names(sheet).includes("Gift (Breeze)") && names(sheet).includes("Thunder Resistance"), names(sheet).join(", "));
  assert.ok(!names(sheet).includes("Lightning Resistance"));
  assert.ok(!sheet.proficiencies.skills.includes("nature"), sheet.proficiencies.skills.join(", "));
  assert.ok(!sheet.proficiencies.languages.includes("Primordial"), sheet.proficiencies.languages.join(", "));
});

await test("A stored pick gone stale (its option deleted) never refuses a level: the level is taken and the pick is owed again.", async () => {
  const hushed = await brew("Hush-Blooded", stormBlooded([{ label: "Gift", level: 1, options: [HUSH, { name: "Gust", resistances: ["thunder"] }] }]));
  assert.equal(hushed.status, 201, JSON.stringify(hushed.json));
  hushHero = hero({ subclass: "Hush-Blooded", level: 1, features: [{ name: "Gift (Hush)", source: "choice" }] });
  const gone = structuredClone(hushed.json.entry.data);
  gone.choices[0].options = [{ name: "Gust", resistances: ["thunder"] }, { name: "Calm" }];
  const patched = await call(homebrewEntry, "PATCH", { data: gone }, { id: hushed.json.entry.id });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  await world.invoke("award_xp", { characterIds: [hushHero.id], amount: 300, reason: "earned in play" });
  const taken = await patchSheetAs(world, sheetRoute, hushHero.user, { level: 2 });
  assert.equal(taken.status, 200, JSON.stringify(taken.json));
  const after = world.sheet(hushHero.id);
  assert.equal(after.level, 2);
  assert.ok(!names(after).includes("Gift (Hush)") && !names(after).includes("Cold Resistance"), names(after).join(", "));
  assert.equal(owedPickSlots(after, { extras: extras() }).choices.length, 1, "owed again");
});

await test("A file cannot forge a pick or an element: only the regrant's class feature is an element, only a choice feature a pick, and the element line is a feature the engines run.", () => {
  assert.equal(isMechanicalFeature("Bloodline damage type: Fire"), true, "a story element line is refused at the import door");
  const forged = { class: "sorcerer", subclass: "Storm-Blooded", features: [{ name: "Elemental Affinity", source: "class", classId: "sorcerer" }, { name: "Bloodline damage type: Fire", source: "story" }] };
  assert.equal(chosenElementType(forged), null);
  const [slot] = subclassChoiceSlots([{ id: "sorcerer", subclass: "Storm-Blooded", level: 1 }], [{ name: "Bloodline (Storm)", source: "story" }], extras());
  assert.equal(slot.chosen, null, "a story feature is no pick");
});

await test("Elemental Affinity reads the element of the subclass that grants it: the SRD's Draconic Bloodline only its dragon; and a subclass names an element in one choice only.", async () => {
  const split = {
    class: "sorcerer",
    subclass: "Draconic Bloodline",
    classes: [{ id: "sorcerer", subclass: "Draconic Bloodline", level: 6 }, { id: "warlock", subclass: "Ember Pact", level: 1 }],
    features: [
      { name: "Elemental Affinity", source: "class", classId: "sorcerer" },
      { name: "Pact damage type: Fire", source: "class", classId: "warlock" },
    ],
  };
  assert.equal(chosenElementType(split), null, "no dragon chosen: the warlock's element is not the sorcerer's");
  assert.equal(chosenElementType({ ...split, features: [...split.features, { name: "Dragon Ancestor: Silver", source: "choice" }] }), "cold");
  const two = await brew("Twice-Blooded", stormBlooded([BLOODLINE, { label: "Heart", level: 3, options: [{ name: "Ember", damageType: "fire" }, { name: "Ash" }] }]));
  assert.equal(two.status, 400);
  assert.match(two.json.error, /name an element in one choice only/);
});

await test("At the owed route an option's language spoken already becomes another language.", async () => {
  const speaker = hero({ level: 6, proficiencies: { saves: [], skills: [], expertise: [], languages: ["Common", "Primordial"], tools: [], armor: [], weapons: [] } });
  world.signIn(speaker.user);
  const response = await owedRoute.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: speaker.id, features: ["Bloodline (Storm)"] }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const languages = world.sheet(speaker.id).proficiencies.languages;
  assert.equal(languages.length, 3, `Primordial again is another language: ${languages.join(", ")}`);
});

await test("In the builder a class skill the option also gives asks for another, and a swap keeps the player's own class skill and takes the replacement off.", async () => {
  const lore = await brew("Lore-Blooded", stormBlooded([{ label: "Lineage", level: 1, options: [{ name: "Scholar", skills: ["arcana"] }, { name: "Wild" }] }]));
  assert.equal(lore.status, 201, JSON.stringify(lore.json));
  const make = (pick, featChoices) => built(pick, { subclass: "Lore-Blooded", background: "acolyte", chosenSkills: ["arcana", "deception"], featChoices });
  const asked = inBrowser(() => {
    const sorcerer = builder.classes.find((entry) => entry.id === "sorcerer");
    const open = builder.build({ race: "human", class: sorcerer, background: "acolyte", level: 1, subclass: "Lore-Blooded", chosenSkills: ["arcana", "deception"], optionPicks: ["Lineage (Scholar)"] });
    return open.derived.subclassTraining.find((grant) => grant.name === "Lineage");
  });
  assert.equal(asked?.spec.skills, 1, "Arcana held already: one skill of the player's choice");
  world.signIn(owner);
  const madeLore = await call(libraryRoute, "POST", { level: 1, sheet: make("Lineage (Scholar)", { lineage: { skills: ["history"] } }) });
  assert.equal(madeLore.status, 201, JSON.stringify(madeLore.json));
  assert.ok(madeLore.json.character.sheet.proficiencies.skills.includes("history"));
  const swapped = await call(characterRoute, "PATCH", { level: 1, sheet: make("Lineage (Wild)", {}) }, { characterId: madeLore.json.character.id });
  assert.equal(swapped.status, 200, JSON.stringify(swapped.json));
  const skills = swapped.json.character.sheet.proficiencies.skills;
  assert.ok(skills.includes("arcana"), `the class skill stays: ${skills.join(", ")}`);
  assert.ok(!skills.includes("history"), `the replacement goes with the option: ${skills.join(", ")}`);
});

await test("The join confirmation lists a workshop choice owed, read with the table's subclasses.", () => {
  const old = world.sheet(hero({ level: 6 }).id);
  const { owed, owedOnSheet } = joinChanges(old, 6, old, 6, { extras: extras(), campaignId: world.campaignId });
  assert.ok(owed.some((line) => /Storm-Blooded's Bloodline/.test(line)), owed.join(" | "));
  // Made on the character sheet once seated, as a class feature's picks are.
  assert.ok((owedOnSheet ?? []).some((line) => /Storm-Blooded's Bloodline/.test(line)), (owedOnSheet ?? []).join(" | "));
  const groups = owedChoiceGroups(old, { extras: extras() });
  assert.ok(groups.onSheet.some((line) => /Storm-Blooded's Bloodline/.test(line)) && !groups.levelUp.some((line) => /Bloodline/.test(line)));
});

await test("The browser's registry is empty again after a browser-side check, so the server's checks read the table's extras.", () => {
  inBrowser(() => assert.ok((browserSubclassExtras().sorcerer ?? []).length > 0));
  assert.equal((browserSubclassExtras().sorcerer ?? []).length, 0);
});

world.close?.();
finish();
