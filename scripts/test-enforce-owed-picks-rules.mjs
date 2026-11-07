// The owed picks held to every rule the level-up keeps (issue #833 review):
//
//   - The table's workshop subclasses and feats: a workshop sorcerer origin
//     that borrows Dragon Ancestor owes the dragon on the server too, and
//     making it keeps the origin's own features; a workshop copy of Martial
//     Adept keeps its maneuvers when another pick is made.
//   - The spellbook is the book and what is prepared or waiting from it
//     (spell-prep.ts spellbookOf); an empty book offers no spell to master,
//     on the sheet as at a save.
//   - An option's prerequisite (an invocation's level, pact boon, cantrip),
//     on the sheet and at the level-up.
//   - A fighting style the sheet holds stays; a new one is held to its
//     class's list at the level-up.
//   - Only a living character makes picks; old "Favored Enemy Improvement"
//     and singular picks count; the agents are told where the picks are made.
import assert from "node:assert/strict";
import { openTable } from "./lib/enforce-multiclass.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-owed-picks-rules");
const table = await openTable();
const { world } = table;
const { applyOwedPicks, owedPickSlots } = await import("../src/lib/srd/owed-picks-logic.ts");
const { chosenOptions, openOptionSlots } = await import("../src/lib/srd/options.ts");
const owedRoute = await world.route("campaigns/[campaignId]/sheet/owed");
const homebrew = await world.route("homebrew");

async function post(body, user = world.owner) {
  world.signIn(user);
  const request = new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const response = await owedRoute.POST(request, { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, json: await response.json() };
}

async function brew(kind, name, data) {
  world.signIn(world.owner);
  const response = await homebrew.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ kind, name, data }) }));
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.entry;
}

const PROF = { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [] };
const sheetOf = (overrides) => ({ name: "Hero", race: "human", subclass: "", classes: [], feats: [], features: [], proficiencies: PROF, ...overrides });

// ---- the table's workshop ----

await test("A workshop origin that borrows Dragon Ancestor owes the dragon on the server, and making the pick keeps the origin's own features.", async () => {
  await brew("archetype", "Wyrmblood", {
    desc: "",
    classSlug: "sorcerer",
    levels: { 1: [{ n: "Dragon Ancestor", d: "Your dragon." }], 6: [{ n: "Wyrm Scales", d: "Scales of your sire." }] },
  });
  const hero = table.hero({ class: "sorcerer", subclass: "Wyrmblood", level: 6, proficiencies: TRAINED });
  assert.ok(world.sheet(hero.id).features.some((feature) => feature.name === "Wyrm Scales"), "the origin's feature to begin with");
  const made = await post({ characterId: hero.id, features: ["Dragon Ancestor: Silver"] });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const names = world.sheet(hero.id).features.map((feature) => feature.name);
  assert.ok(names.includes("Dragon Ancestor: Silver"), names.join(", "));
  assert.ok(names.includes("Wyrm Scales"), `the regrant stripped the workshop origin: ${names.join(", ")}`);
});

await test("A workshop copy of Martial Adept keeps its two maneuvers when another owed pick is made.", async () => {
  await brew("feat", "Drill Form", { desc: "You learn two maneuvers and gain a superiority die.", prerequisite: "", runsAs: "Martial Adept" });
  const hero = table.hero({
    class: "fighter",
    subclass: "Champion",
    level: 4,
    proficiencies: TRAINED,
    feats: ["Drill Form"],
    features: [{ name: "Maneuver: Riposte", source: "choice" }, { name: "Maneuver: Parry", source: "choice" }],
  });
  world.patch(hero.id, { features: [...world.sheet(hero.id).features.filter((feature) => !feature.name.startsWith("Fighting Style:")), { name: "Maneuver: Riposte", source: "choice" }, { name: "Maneuver: Parry", source: "choice" }] });
  const made = await post({ characterId: hero.id, features: ["Fighting Style: Defense"] });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const names = world.sheet(hero.id).features.map((feature) => feature.name);
  assert.ok(names.includes("Maneuver: Riposte") && names.includes("Maneuver: Parry"), `the maneuvers were pruned: ${names.join(", ")}`);
});

// ---- the spellbook ----

await test("The spellbook is the book and what is prepared from it, and an empty book offers no spell to master.", () => {
  const wizard = sheetOf({ class: "wizard", level: 18, spellcasting: { ability: "int", slots: {}, known: [], prepared: ["Shield", "Misty Step"], cantrips: [], spellbook: [] } });
  const offered = owedPickSlots(wizard).options.find((slot) => slot.kind === "spell_mastery_1")?.options.map((option) => option.n);
  assert.deepEqual(offered, ["Shield"]);
  assert.equal(applyOwedPicks(wizard, { features: ["Spell Mastery: Shield"] }).ok, true);
  const bare = sheetOf({ class: "wizard", level: 18, spellcasting: { ability: "int", slots: {}, known: [], prepared: [], cantrips: [], spellbook: [] } });
  const [slot] = openOptionSlots({ classId: "wizard", subclass: "", level: 18, features: [], spellbook: [] }).filter((entry) => entry.kind === "spell_mastery_1");
  assert.deepEqual(slot.options, [], "an empty book offers nothing");
  assert.equal(applyOwedPicks(bare, { features: ["Spell Mastery: Shield"] }).ok, false, "and the sheet takes nothing from it");
});

// ---- prerequisites ----

await test("An invocation's prerequisite holds on the sheet: its warlock level, its pact boon, its cantrip.", () => {
  const warlock = (level, features = [], cantrips = []) =>
    sheetOf({ class: "warlock", subclass: "The Fiend", level, features, spellcasting: { ability: "cha", slots: {}, known: [], prepared: [], cantrips } });
  const blade = applyOwedPicks(warlock(2), { features: ["Invocation: Thirsting Blade"] });
  assert.equal(blade.ok, false);
  assert.match(blade.error, /warlock level 5/);
  const noPact = applyOwedPicks(warlock(5, [{ name: "Pact Boon: Pact of the Chain", source: "choice" }]), { features: ["Invocation: Thirsting Blade"] });
  assert.match(noPact.error ?? "", /Pact of the Blade/);
  assert.equal(applyOwedPicks(warlock(2), { features: ["Invocation: Agonizing Blast"] }).ok, false, "no Eldritch Blast");
  assert.equal(applyOwedPicks(warlock(2, [], ["Eldritch Blast"]), { features: ["Invocation: Agonizing Blast"] }).ok, true);
});

await test("The level-up holds an invocation's prerequisite too.", async () => {
  table.hero({ class: "warlock", subclass: "The Fiend", level: 1, proficiencies: TRAINED, xp: 300 });
  const out = await table.levelUp("warlock", { features: [{ name: "Invocation: Thirsting Blade", source: "choice" }] });
  assert.ok(out.status >= 400, `the level-up took it: ${out.status}`);
  assert.match(out.error ?? "", /warlock level 5/);
});

// ---- fighting styles ----

await test("A paladin's saved Archery stays through a level-up; a new Archery at the level-up is refused.", async () => {
  const kept = table.hero({ class: "paladin", level: 2, proficiencies: TRAINED, xp: 900 });
  world.patch(kept.id, { features: [...world.sheet(kept.id).features, { name: "Fighting Style: Archery", source: "choice" }] });
  const up = await table.levelUp("paladin");
  assert.equal(up.status, 200, up.error);
  assert.ok(world.sheet(kept.id).features.some((feature) => feature.name === "Fighting Style: Archery"), "the held style was dropped");
  table.hero({ class: "paladin", level: 1, proficiencies: TRAINED, xp: 300 });
  const fresh = await table.levelUp("paladin", { features: [{ name: "Fighting Style: Archery", source: "choice" }] });
  assert.ok(fresh.status >= 400, `a new paladin Archery was taken: ${fresh.status}`);
});

await test("A new character's fighting style is held to its class's list: a paladin's Archery is refused, Defense passes, and a wizard's stray style is left for the regrant to drop.", async () => {
  const { legalizeSheet } = await import("../src/lib/srd/sheet-legality.ts");
  const options = await import("../src/lib/characters/options.ts");
  const { bundledPrices } = await import("../src/lib/srd/starting-wealth.ts");
  const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
  const { bundledSubclassName } = await import("../src/lib/srd/features.ts");
  const classes = options.srdClassOptions();
  const races = options.srdRaceOptions();
  const backgrounds = options.srdBackgroundOptions();
  const problems = (cls, style) => {
    const sheet = {
      name: "Brakka", race: "human", class: cls, subclass: "", background: "soldier", alignment: "N", gender: "", appearance: "",
      abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 }, maxHp: 1, ac: 16, acOverride: false, speed: 30,
      hitDice: { die: "d10", total: 2, spent: 0 }, classes: [], hitDicePools: null,
      proficiencies: { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [] },
      equipment: [], gold: 10, copper: 0, feats: [], features: [{ name: `Fighting Style: ${style}`, source: "choice" }],
      asiChoices: [], spellcasting: null, portrait: null, notes: "", backstory: "",
    };
    const race = races.find((entry) => entry.id === sheet.race);
    return legalizeSheet(sheet, {
      door: "table", level: 2, hpMethod: "average", startingWealth: "equipment",
      classOf: (id) => classes.find((entry) => entry.id === id) ?? null,
      race: race ? { ...race, feats: 0 } : null,
      background: backgrounds.find((entry) => entry.id === sheet.background) ?? null,
      baseline: null, abilityPool: null, wealthRoll: null, priceOf: bundledPrices, spellOf: checklistSpell,
      featOf: () => null, subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)), rollDie: () => 3,
    }).problems.filter((problem) => /fighting style/i.test(problem));
  };
  assert.equal(problems("paladin", "Archery").length, 1, "a paladin's Archery");
  assert.deepEqual(problems("paladin", "Defense"), []);
  assert.deepEqual(problems("wizard", "Archery"), [], "no slot: the regrant drops it");
});

// ---- the rest ----

await test("A dead character makes no picks.", async () => {
  const hero = table.hero({ class: "sorcerer", subclass: "Draconic Bloodline", level: 6, proficiencies: TRAINED });
  world.patch(hero.id, { deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const out = await post({ characterId: hero.id, features: ["Dragon Ancestor: Red"] });
  assert.equal(out.status, 404);
});

await test("Old picks the readers accept count toward the slot: a Favored Enemy Improvement, a singular race.", () => {
  assert.deepEqual(chosenOptions([{ name: "Favored Enemy Improvement: fiends" }], "favored_enemy"), ["Fiends"]);
  assert.deepEqual(chosenOptions([{ name: "Favored Enemy: orc, gnoll" }], "favored_enemy"), ["Orcs", "Gnolls"]);
  assert.deepEqual(chosenOptions([{ name: "Natural Explorer Improvement (swamp)" }], "favored_terrain"), ["Swamp"]);
  const ranger = sheetOf({ class: "ranger", level: 6, features: [{ name: "Favored Enemy: undead", source: "choice" }, { name: "Favored Enemy Improvement: fiends", source: "choice" }] });
  assert.equal(owedPickSlots(ranger).options.find((slot) => slot.kind === "favored_enemy"), undefined, "both picks counted");
});

await test("The agent's level-up tool says where a class feature's owed pick is made.", async () => {
  const source = (await import("node:fs")).readFileSync(new URL("../src/lib/agents/workbench.ts", import.meta.url), "utf8");
  assert.match(source, /made on the character sheet's Choices owed/);
});

world.close?.();
finish();
