// The SRD 5.1 picks a class feature opens and nothing let a player make
// (issue #833), and the ones a character's levels earned and no level-up
// offered:
//
//   - Every open pick-list slot is owed (src/lib/srd/owed-picks-logic.ts):
//     a Draconic sorcerer saved before Dragon Ancestor was a pick, one whose
//     next level goes to another class, a level 20 hero. The sheet makes it
//     (POST /sheet/owed) through the level-up's legality.
//   - Dragon Ancestor: Draconic is spoken, a Charisma check with a dragon
//     doubles a proficiency it carries, "Dragon Ancestor (gold)" is the pick,
//     and the bare colours ("Red", "Gold") are no feature names.
//   - Favored Enemy (1st, 6th, 14th; a humanoid race is half a pick, with a
//     language each), Natural Explorer (1st, 6th, 10th), the Land druid's
//     terrain (2nd), Spell Mastery (18th) and Signature Spells (20th) from
//     the spellbook: offered at their levels and read by their engines.
//   - A paladin's and a ranger's Fighting Style offer their four styles.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-owed-picks");
const world = await openWorld();
const { owedChoices } = await import("../src/lib/srd/owed-choices.ts");
const { applyOwedPicks, owedPickSlots, owedPickLines } = await import("../src/lib/srd/owed-picks-logic.ts");
const options = await import("../src/lib/srd/options.ts");
const { openOptionSlots, optionSlotsFor, isOptionName, chosenOptions } = options;
const { isPublishedFeatureName, subclassSpellsFor, populateFeaturesForClasses } = await import("../src/lib/srd/features.ts");
const { dragonAncestorType } = await import("../src/lib/srd/spell-damage-riders.ts");
const { traitCheckRiders, favoredEnemies, heldCheckTraits } = await import("../src/lib/srd/check-traits.ts");
const { subclassGrants, applySubclassTraining } = await import("../src/lib/srd/subclass-training.ts");
const { engineReading } = await import("../src/lib/homebrew/species-choice-server.ts");
const { fightingStyleChoices } = await import("../src/lib/srd/feature-effects.ts");
const { classFeaturesFor } = await import("../src/lib/srd/features.ts");
const { masteredSpell } = await import("../src/lib/dm/cast-slot-choice.ts");
const { signatureCounter } = await import("../src/lib/dm/caster-features.ts");
const { featureChoices } = await import("../src/lib/battlemap/hand-subclass.ts");
const { joinChanges } = await import("../src/lib/characters/join-changes.ts");
const { hostOffers } = await import("../src/lib/use-capabilities.ts");
const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
const owedRoute = await world.route("campaigns/[campaignId]/sheet/owed");

const PROF = { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: [], weapons: [] };
const sheetOf = (overrides) => ({
  name: "Hero", race: "human", subclass: "", classes: [], feats: [], features: [], proficiencies: PROF, ...overrides,
});
const slotOf = (sheet, kind) => owedPickSlots(sheet).options.find((slot) => slot.kind === kind);

async function post(body, user = world.owner) {
  world.signIn(user);
  const request = new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const response = await owedRoute.POST(request, { params: Promise.resolve({ campaignId: world.campaignId }) });
  return { status: response.status, json: await response.json() };
}

// ---- owed: every open slot, wherever the level went ----

await test("A Draconic sorcerer with no dragon owes the pick, at 6th level, as the 1st level of a fighter, and at 20th; the sheet and the join say so.", () => {
  const old = sheetOf({ class: "sorcerer", subclass: "Draconic Bloodline", level: 6 });
  assert.ok(owedChoices(old).some((line) => /Dragon Ancestor/.test(line)), owedChoices(old).join(" | "));
  const split = sheetOf({ class: "sorcerer", level: 6, classes: [{ id: "sorcerer", subclass: "Draconic Bloodline", level: 1 }, { id: "fighter", subclass: "Champion", level: 5 }], features: [{ name: "Fighting Style: Defense", source: "choice" }] });
  assert.ok(slotOf(split, "dragon_ancestor"), "the pick of a class the level-ups no longer take");
  const twenty = sheetOf({ class: "sorcerer", subclass: "Draconic Bloodline", level: 20 });
  assert.equal(slotOf(twenty, "dragon_ancestor")?.remaining, 1, "a level 20 hero has no level-up left to offer it");
  const chosen = sheetOf({ class: "sorcerer", subclass: "Draconic Bloodline", level: 6, features: [{ name: "Dragon Ancestor: Red", source: "choice" }] });
  assert.ok(!owedChoices(chosen).some((line) => /Dragon Ancestor/.test(line)));
  const { owed } = joinChanges(old, 6, old, 6);
  assert.ok(owed.some((line) => /Dragon Ancestor/.test(line)), `the join confirmation: ${owed.join(" | ")}`);
});

await test("Choices owed says where each is made: the next level-up takes the class's own, a class feature's pick is made on the sheet; the join confirmation says the same.", async () => {
  const { owedChoiceGroups, owedChoicesSentences, joinOwedNote, joinOwedLeft } = await import("../src/lib/srd/owed-choices.ts");
  // A Draconic sorcerer 6 with no dragon and none of the class's skills.
  const both = sheetOf({
    class: "sorcerer",
    subclass: "Draconic Bloodline",
    level: 6,
    features: [{ name: "Metamagic: Quickened Spell", source: "choice" }, { name: "Metamagic: Twinned Spell", source: "choice" }],
  });
  const groups = owedChoiceGroups(both);
  assert.ok(groups.levelUp.some((line) => /Sorcerer skills/.test(line)), groups.levelUp.join(" | "));
  assert.ok(!groups.levelUp.some((line) => /Dragon Ancestor/.test(line)), "the dragon is no level-up's");
  assert.deepEqual(groups.onSheet, ["Dragon Ancestor: 1 to choose"]);
  const [forLevelUp, forSheet] = owedChoicesSentences(groups, "here");
  assert.match(forLevelUp, /Sorcerer skills\. The next level-up takes them\.$/);
  assert.doesNotMatch(forLevelUp, /Dragon Ancestor/);
  assert.equal(forSheet, "A class feature's picks, also owed: Dragon Ancestor: 1 to choose. Made below, now, without waiting for a level-up.");
  // The screenshot's case: only the dragon owed, on the player's own sheet.
  const onlyDragon = { levelUp: [], onSheet: groups.onSheet };
  assert.deepEqual(owedChoicesSentences(onlyDragon, "here"), ["Earned and not yet made: Dragon Ancestor: 1 to choose. Made below, now, without waiting for a level-up."]);
  assert.ok(!owedChoicesSentences(onlyDragon, "here").some((line) => /level-up takes/.test(line)), "nothing says a level-up takes a pick made here");
  assert.match(owedChoicesSentences(onlyDragon, "owner")[0], /Made on the player's own sheet, without waiting for a level-up\./);
  assert.match(owedChoicesSentences(onlyDragon, "level-up")[0], /Made when a level-up offers the choice\.$/);
  // The join confirmation.
  const { owed, owedOnSheet } = joinChanges(both, 6, both, 6);
  assert.deepEqual(owedOnSheet, ["Dragon Ancestor: 1 to choose"]);
  const note = joinOwedNote("Ysolde", owed, owedOnSheet);
  assert.match(note, /The first level-up at this table offers \d Sorcerer skills\. The rest \(Dragon Ancestor: 1 to choose\) are made on the character sheet under Choices owed once seated/);
  assert.doesNotMatch(note, /offers every one/);
  assert.match(joinOwedNote("Ysolde", ["Dragon Ancestor: 1 to choose"], ["Dragon Ancestor: 1 to choose"]), /Once seated, they are made on the character sheet under Choices owed, without waiting for a level-up/);
  assert.match(joinOwedNote("Ysolde", ["1 Ability Score Improvement"]), /offers every one/, "an older host's list stays the level-up's");
  assert.deepEqual(joinOwedLeft(owed, owedOnSheet), [
    `Left for the first level-up: ${groups.levelUp.join("; ")}.`,
    "Made on the character sheet once seated: Dragon Ancestor: 1 to choose.",
  ]);
});

await test("Every pick-list is owed the same way: a warlock's invocations, a fighter's style, a ranger's enemy, a Land druid's terrain.", () => {
  const lines = (sheet) => owedPickLines(sheet).join(" | ");
  assert.match(lines(sheetOf({ class: "warlock", subclass: "The Fiend", level: 2 })), /Eldritch Invocation: 2 to choose/);
  assert.match(lines(sheetOf({ class: "fighter", level: 1 })), /a fighting style/);
  assert.match(lines(sheetOf({ class: "ranger", level: 1 })), /Favored Enemy: 1 to choose/);
  assert.match(lines(sheetOf({ class: "druid", subclass: "Circle of the Land", level: 2 })), /Circle of the Land terrain/);
});

await test("The sheet's owed pick is made through the route and held to the slots: a second dragon, another class's list and another player's sheet are refused.", async () => {
  const sorcerer = world.addHero({ class: "sorcerer", subclass: "Draconic Bloodline", level: 6 });
  const made = await post({ characterId: sorcerer.id, features: ["Dragon Ancestor: Gold"] });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const stored = world.sheet(sorcerer.id);
  assert.ok(stored.features.some((feature) => feature.name === "Dragon Ancestor: Gold" && feature.source === "choice"));
  assert.equal(dragonAncestorType(stored), "fire", "Elemental Affinity reads it");
  assert.ok(!owedChoices(stored).some((line) => /Dragon Ancestor/.test(line)), "no longer owed");
  const again = await post({ characterId: sorcerer.id, features: ["Dragon Ancestor: Red"] });
  assert.equal(again.status, 400, "one dragon");
  const other = await post({ characterId: sorcerer.id, features: ["Favored Enemy: Undead"] });
  assert.equal(other.status, 400, "a ranger's list");
  assert.match(other.json.error, /owes no favored enemy/);
  const stranger = world.addUser("stranger");
  const theirs = await post({ characterId: sorcerer.id, features: ["Metamagic: Quickened Spell"] }, stranger);
  assert.equal(theirs.status, 404);
  const metamagic = await post({ characterId: sorcerer.id, features: ["Metamagic: Quickened Spell", "Metamagic: Twinned Spell"] });
  assert.equal(metamagic.status, 200, JSON.stringify(metamagic.json));
  const third = await post({ characterId: sorcerer.id, features: ["Metamagic: Careful Spell"] });
  assert.equal(third.status, 400, "a sorcerer 6 knows two");
});

await test("An older host offers no owed picks: the sheet's picker waits for the flag.", () => {
  assert.equal(SERVER_FEATURES.owedPicks, true);
  assert.equal(hostOffers({ features: {} }, "owedPicks"), false);
  assert.equal(hostOffers({ features: { owedPicks: true } }, "owedPicks"), true);
});

// ---- Dragon Ancestor ----

await test("Dragon Ancestor: the sorcerer speaks Draconic, and a Charisma check with a dragon doubles a proficiency it carries.", () => {
  const [grant] = subclassGrants([{ id: "sorcerer", subclass: "Draconic Bloodline", level: 1 }]).filter((entry) => entry.name === "Dragon Ancestor");
  assert.ok(grant, "Dragon Ancestor trains the sorcerer");
  const trained = applySubclassTraining({ proficiencies: PROF, grants: [grant], choices: {}, strict: true });
  assert.ok(trained.proficiencies.languages.includes("Draconic"));
  const sorcerer = { class: "sorcerer", level: 6, features: [{ name: "Dragon Ancestor: Silver" }] };
  const check = (input) => traitCheckRiders(sorcerer, { ability: "cha", skill: "persuasion", proficiencyBonus: 3, proficient: true, ...input }).bonus;
  assert.equal(check({ creature: "dragon" }), 3, "doubled with a dragon");
  assert.equal(check({ creature: "dragon", proficient: false }), 0, "only when proficiency applies");
  assert.equal(check({ creature: "giant" }), 0);
  assert.equal(traitCheckRiders({ class: "sorcerer", level: 6, features: [] }, { ability: "cha", proficiencyBonus: 3, proficient: true, creature: "dragon" }).bonus, 0);
});

await test("The dragon a sheet records: 'Dragon Ancestor (gold)' is the pick, 'Draconic Bloodline (Red)' is none, and a bare colour is no feature name.", () => {
  const [slot] = openOptionSlots({ classId: "sorcerer", subclass: "Draconic Bloodline", level: 1, features: [{ name: "Dragon Ancestor (gold)" }] }).filter((entry) => entry.kind === "dragon_ancestor");
  assert.equal(slot.remaining, 0, "no second dragon");
  assert.equal(dragonAncestorType({ features: [{ name: "Draconic Bloodline (Red)" }] }), null);
  for (const colour of ["Red", "Gold", "Forest", "Undead", "Shield"]) {
    assert.equal(isOptionName(colour), false, colour);
    assert.equal(isPublishedFeatureName(colour), false, colour);
    assert.equal(engineReading(colour), null, `a species choice labelled ${colour}`);
  }
  assert.equal(isOptionName("Agonizing Blast"), true, "an invocation's bare name still is");
  assert.equal(isOptionName("Dragon Ancestor: Red"), true);
});

// ---- the ranger, the Land druid, the wizard ----

await test("Favored Enemy: one at 1st, two at 6th, three at 14th; two humanoid races make one; the check riders read the picks.", () => {
  assert.deepEqual([1, 5, 6, 13, 14].map((level) => optionSlotsFor("ranger", "", level, "favored_enemy")), [1, 1, 2, 2, 3]);
  const [half] = openOptionSlots({ classId: "ranger", subclass: "", level: 1, features: [{ name: "Favored Enemy: Orcs" }] }).filter((slot) => slot.kind === "favored_enemy");
  assert.equal(half.remaining, 0.5, "one race is half a pick");
  assert.ok(options.slotTakes(half, { half: true }) && !options.slotTakes(half, {}), "the half left takes a race, not a type");
  const kept = populateFeaturesForClasses(
    [{ name: "Favored Enemy: Orcs", source: "choice" }, { name: "Favored Enemy: Gnolls", source: "choice" }, { name: "Favored Enemy: Undead", source: "choice" }],
    [{ id: "ranger", subclass: "", level: 1 }],
    "human",
  );
  assert.deepEqual(chosenOptions(kept, "favored_enemy"), ["Orcs", "Gnolls"], "the pair fills the 1st-level pick");
  assert.deepEqual(favoredEnemies({ features: kept }), ["orcs", "gnolls"]);
  const tracker = { class: "ranger", level: 1, features: [{ name: "Favored Enemy: Undead" }] };
  assert.equal(traitCheckRiders(tracker, { skill: "survival", about: "tracking", creature: "undead", proficiencyBonus: 2, proficient: true }).advantage.length, 1);
});

await test("A ranger's Favored Enemy teaches a language; one left out is owed, and the sheet makes it.", async () => {
  const ranger = sheetOf({ class: "ranger", level: 1 });
  assert.ok(owedPickLines(ranger).some((line) => /Favored Enemy language: a language/.test(line)));
  const applied = applyOwedPicks(ranger, { featChoices: { "Favored Enemy language": { languages: ["Orc"] } } });
  assert.equal(applied.ok, true, applied.error);
  assert.ok(applied.proficiencies.languages.includes("Orc"));
  const known = applyOwedPicks(ranger, { featChoices: { "Favored Enemy language": { languages: ["Common"] } } });
  assert.equal(known.ok, false, "a language already spoken");
});

await test("Natural Explorer: one terrain at 1st, two at 6th, three at 10th, read as the favored terrain.", () => {
  assert.deepEqual([1, 6, 9, 10].map((level) => optionSlotsFor("ranger", "", level, "favored_terrain")), [1, 2, 2, 3]);
  const traits = heldCheckTraits({ class: "ranger", level: 1, features: [{ name: "Natural Explorer: Forest" }] });
  assert.ok(traits.some((trait) => trait.terrains?.includes("forest")));
});

await test("A Land druid's terrain is offered at 2nd level, and the pick brings its circle spells and settles the sheet's choice.", () => {
  assert.equal(optionSlotsFor("druid", "Circle of the Land", 2, "land_circle"), 1);
  assert.equal(optionSlotsFor("druid", "Circle of the Moon", 2, "land_circle"), 0);
  const features = [{ name: "Circle Spells", source: "class" }, { name: "Circle Spells: Forest", source: "choice" }];
  assert.ok(subclassSpellsFor("druid", "Circle of the Land", 3, undefined, features).includes("Barkskin"));
  const [choice] = featureChoices({ class: "druid", subclass: "Circle of the Land", level: 3, features: features.map((feature) => ({ ...feature, classId: "druid" })), conditions: [], classes: [] });
  assert.equal(choice?.chosen, "forest", "the sheet's in-play picker reads it as chosen");
});

await test("Spell Mastery (18) and Signature Spells (20) pick spells of their level from the spellbook, read as the engines read them.", () => {
  const book = ["Shield", "Misty Step", "Fireball", "Counterspell", "Magic Missile"];
  const slots = openOptionSlots({ classId: "wizard", subclass: "", level: 20, features: [], spellbook: book });
  const names = (kind) => slots.find((slot) => slot.kind === kind)?.options.map((option) => option.n);
  assert.deepEqual(names("spell_mastery_1")?.sort(), ["Magic Missile", "Shield"]);
  assert.deepEqual(names("spell_mastery_2"), ["Misty Step"]);
  assert.deepEqual(names("signature_spell")?.sort(), ["Counterspell", "Fireball"]);
  assert.equal(slots.find((slot) => slot.kind === "signature_spell").total, 2);
  assert.equal(optionSlotsFor("wizard", "", 17, "spell_mastery_1"), 0);
  const wizard = sheetOf({ class: "wizard", level: 18, spellcasting: { ability: "int", slots: {}, known: [], prepared: book, cantrips: [], spellbook: book } });
  assert.equal(applyOwedPicks(wizard, { features: ["Spell Mastery: Sleep"] }).ok, false, "a spell not in the book");
  const made = applyOwedPicks(wizard, { features: ["Spell Mastery: Shield", "Spell Mastery: Misty Step"] });
  assert.equal(made.ok, true, made.error);
  assert.ok(masteredSpell({ ...wizard, features: made.features }, new Set(["shield"])));
  const sig = { features: [{ name: "Signature Spells: Fireball" }, { name: "Signature Spells: Counterspell" }], resources: { signature_spell_1: { max: 1, used: 0 }, signature_spell_2: { max: 1, used: 0 } } };
  assert.equal(signatureCounter(sig, { name: "Counterspell", level: 3 }, undefined), "signature_spell_2", "the second pick's counter");
});

// ---- fighting styles ----

await test("A paladin's and a ranger's Fighting Style offer their four SRD styles; a fighter's all six. The sheet and the regrant hold to it.", () => {
  const styles = (classId) => fightingStyleChoices(classFeaturesFor(classId, "", 2), classId).map((style) => style.id).sort();
  assert.deepEqual(styles("paladin"), ["defense", "dueling", "great_weapon_fighting", "protection"]);
  assert.deepEqual(styles("ranger"), ["archery", "defense", "dueling", "two_weapon_fighting"]);
  assert.equal(styles("fighter").length, 6);
  const paladin = sheetOf({ class: "paladin", level: 2 });
  assert.equal(applyOwedPicks(paladin, { features: ["Fighting Style: Archery"] }).ok, false);
  assert.equal(applyOwedPicks(paladin, { features: ["Fighting Style: Protection"] }).ok, true);
  // A style the sheet already holds stays through a regrant, even one the
  // class's list would not offer now (a paladin saved with Archery before the
  // lists were the class's): the lists hold new picks, never strip a sheet.
  const kept = populateFeaturesForClasses([{ name: "Fighting Style: Archery", source: "choice" }], [{ id: "paladin", subclass: "", level: 2 }], "human");
  assert.ok(kept.some((feature) => feature.name === "Fighting Style: Archery"), "the regrant dropped a held style");
  const split = [{ id: "paladin", subclass: "", level: 2 }, { id: "ranger", subclass: "", level: 2 }];
  const two = (a, b) => populateFeaturesForClasses([{ name: `Fighting Style: ${a}`, source: "choice" }, { name: `Fighting Style: ${b}`, source: "choice" }], split, "human")
    .filter((feature) => feature.name.startsWith("Fighting Style:")).map((feature) => feature.name);
  assert.deepEqual(two("Archery", "Protection"), ["Fighting Style: Archery", "Fighting Style: Protection"]);
  assert.deepEqual(two("Archery", "Two-Weapon Fighting"), ["Fighting Style: Archery", "Fighting Style: Two-Weapon Fighting"], "two held styles, one slot each");
  // A new pick is held to each class's list: the paladin 2 / ranger 2 with
  // Archery owes the paladin's style, and the ranger's Two-Weapon Fighting
  // does not fill it.
  const both = sheetOf({ class: "paladin", level: 4, classes: [{ id: "paladin", subclass: "", level: 2 }, { id: "ranger", subclass: "", level: 2 }] });
  assert.equal(owedPickSlots(both).styles.count, 2, "each class's Fighting Style is a slot");
  const multi = sheetOf({ class: "paladin", level: 4, classes: [{ id: "paladin", subclass: "", level: 2 }, { id: "ranger", subclass: "", level: 2 }], features: [{ name: "Fighting Style: Archery", source: "choice" }] });
  assert.equal(applyOwedPicks(multi, { features: ["Fighting Style: Two-Weapon Fighting"] }).ok, false, "a second ranger style for the paladin's slot");
  assert.equal(applyOwedPicks(multi, { features: ["Fighting Style: Protection"] }).ok, true);
});

await test("Every pick-list wears a painted icon: its own option's, or its kind's (no new art, issue #833).", async () => {
  const { iconCandidates } = await import("../src/lib/icons.ts");
  const kinds = Object.keys((await import("../src/lib/srd/options.json", { with: { type: "json" } })).default.kinds);
  const bare = kinds.filter((kind) => !iconCandidates({ kind: "option", key: `${kind}-nothing painted`, family: `option-${kind}` }).length);
  assert.deepEqual(bare, []);
});

world.close?.();
finish();
