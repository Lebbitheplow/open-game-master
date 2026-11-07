// Spells a species gives, at the edges the first pass of issue #833 left
// (the review of its pull request): the reaction card, two free casts of one
// spell, an author's later edits reaching the characters already at a table,
// a feat's ability beside a racial feat, the dice of a free cast, the
// ability of a spell the class holds too, a bundle's spells, the GM's line,
// and the spell picker on a server with no content pack.
//
//   - a tiefling fighter's Hellish Rebuke reaction card is open with its
//     free use, at 3d10, and a tiefling warlock who knows the spell answers
//     with the free use, not a slot;
//   - a Topaz fighter with Fey Touched casts misty step spending one free
//     use, the feat's, never the ancestry's as well;
//   - an author who raises Detect Thoughts to three uses back on a short
//     rest, renames the option and the choice, and adds a spell reaches the
//     seated character at once; a sheet missing its counter casts at the
//     spell's own count; a species purged for good takes its counters away;
//   - a variant human's racial Fey Touched (+Charisma) leaves a later Magic
//     Initiate (cleric) on Wisdom;
//   - a free cast's damage card rolls at the level it is cast at;
//   - a wizard who prepared Misty Step casts the free use with
//     Charisma, and the class's casting with Intelligence once it is spent;
//   - a bundle's species is held to the importer's catalog;
//   - the GM's line leaves out a spell a class list already shows;
//   - the species' spell picker asks for the SRD's spells, which a server
//     with no content pack answers.
import assert from "node:assert/strict";
import fs from "node:fs";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation, PORTRAIT } from "./lib/enforce-creation.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-species-spell-uses");
const { world, call, libraryRoute, characters } = await openCreation();
const builder = await openBuilder();
const homebrewRoute = await world.route("homebrew");
const homebrewEntry = await world.route("homebrew/[id]");
const contentRoute = await world.route("content/[kind]");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { withSpeciesVariant } = await import("../src/lib/content/species-variants.ts");
const { innateSpellsFor } = await import("../src/lib/srd/racial-grants.ts");
const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const { spellSaveDcFor } = await import("../src/lib/srd/index.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { listHomebrew } = await import("../src/lib/db/homebrew.ts");

const owner = world.owner;
const TOPAZ = { name: "Topaz", spells: { ability: "cha", spells: [{ spell: "Mage Hand", level: 1 }, { spell: "Detect Thoughts", level: 3 }, { spell: "Misty Step", level: 5 }] } };
const CELESTIAL = { name: "Celestial", spells: { ability: "wis", spells: [{ spell: "Light", level: 1 }] } };
const halfDragon = (options, label = "Draconic ancestry") => ({
  desc: "Folk with a dragon close in the family.",
  size: "Medium",
  speed: { walk: 30 },
  asi: [{ attributes: ["Strength"], value: 2 }],
  languages: ["Common", "Draconic"],
  traits: "**_Scaled Hide._** Your scales turn the first blow of a fight.",
  variants: { label, options },
});
const FIGHTER = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const WIZARD = { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 };

async function brew(name, data) {
  world.signIn(owner);
  return call(homebrewRoute, "POST", { kind: "race", name, data });
}
const raceOf = (entry) => {
  const id = `homebrew:${entry.id}`;
  return packRaceOptions([{ slug: id, name: entry.name, documentSlug: "homebrew", document: "Homebrew", data: entry.data }], [id])[0];
};
function built(entry, variant, klass = "fighter") {
  const wizard = klass === "wizard";
  const result = builder.build({
    race: withSpeciesVariant(raceOf(entry), variant),
    class: klass,
    background: "soldier",
    scores: wizard ? WIZARD : FIGHTER,
    chosenSkills: wizard ? ["arcana", "history"] : ["acrobatics", "perception"],
    ...(wizard
      ? { cantrips: ["Fire Bolt", "Ray of Frost", "Prestidigitation"], spells: ["Magic Missile", "Shield", "Sleep", "Burning Hands", "Thunderwave", "Detect Thoughts"], bookPrepared: ["Magic Missile", "Shield", "Sleep"] }
      : { stylePicks: ["defense"] }),
    racialVariant: variant,
  });
  assert.equal(result.blocker, null, result.blocker?.message);
  return { ...result.sheet, portrait: PORTRAIT };
}
async function made(entry, variant, klass) {
  world.signIn(owner);
  const out = await call(libraryRoute, "POST", { level: 1, sheet: built(entry, variant, klass) });
  assert.equal(out.status, 201, JSON.stringify(out.json));
  return out.json.character;
}
const seat = (table, character, level, extra = {}) => {
  const admitted = characters.admitLibraryCharacter(character, table.campaign(), owner.id, level);
  assert.equal(admitted.ok, true, admitted.problems?.join(" | "));
  return table.addHero({ ...admitted.sheet, level, equipment: [...admitted.sheet.equipment, { name: "Component pouch", qty: 1 }], ...extra });
};
const cast = (table, sheet, spell, extra = {}) => table.invoke("use_spell_slot", { characterId: sheet.id, spell, ...extra });

const saved = await brew("Half-Dragon", halfDragon([TOPAZ, CELESTIAL]));
assert.equal(saved.status, 201, JSON.stringify(saved.json));
const species = saved.json.entry;

// ---- the reaction card ----

const arena = await openWorld({ campaign: { maxPlayers: 20 } });
const kit = await combatKit(arena);
const hero = (extra) =>
  arena.addHero({
    user: arena.owner, level: 3, maxHp: 60, ac: 12, acOverride: true, proficiencies: TRAINED,
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 14 },
    portrait: { url: "/uploads/test.png" }, equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Component pouch", qty: 1 }],
    ...extra,
  });
async function struck(who) {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [who.id]: 3 } });
  const [enemy] = arena.enemies();
  kit.setEnemy(enemy.id, { maxHp: 300, currentHp: 300 });
  kit.place(who.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  arena.dice(15, 3);
  const out = await arena.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: who.id });
  arena.clearDice();
  assert.equal(out.ok, true, out.error);
  const hits = activePublicEncounter(arena.campaignId)?.lastHits ?? [];
  const card = reactionCards(arena.sheet(who.id), { ...FRESH_TURN, myTurn: false }, hits, arena.sheets()).find((entry) => entry.name === "Hellish Rebuke");
  return { enemy, card };
}

await test("a tiefling fighter's Hellish Rebuke card is open with Infernal Legacy's use, at 3d10, and the reaction spends that use", async () => {
  const fighter = hero({ race: "tiefling", class: "fighter" });
  const { enemy, card } = await struck(fighter);
  assert.ok(card, "no Hellish Rebuke card");
  assert.equal(card.disabled, null, card.disabled);
  assert.equal(card.resource, "Free 1/1");
  assert.match(card.rules, /3d10 fire/);
  assert.equal(card.intent.slotLevel, null);
  const out = await arena.invoke("use_reaction", { characterId: fighter.id, feature: "Hellish Rebuke", targetEnemyId: enemy.id });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(arena.sheet(fighter.id).resources.racial_hellish_rebuke, { max: 1, used: 1 });
});

await test("a tiefling warlock who knows Hellish Rebuke answers with the free use, not a slot", async () => {
  const warlock = hero({ race: "tiefling", class: "warlock", spellcasting: { ability: "cha", slots: { 2: { max: 2, used: 0 } }, prepared: [], known: ["Hellish Rebuke"], cantrips: [] } });
  const { enemy, card } = await struck(warlock);
  assert.ok(card, "no Hellish Rebuke card");
  assert.equal(card.resource, "Free 1/1");
  assert.equal(card.intent.slotLevel, null, "the card sent a slot level, so the cast spent a slot");
  const out = await arena.invoke("use_reaction", { characterId: warlock.id, feature: "Hellish Rebuke", targetEnemyId: enemy.id, ...(card.intent.slotLevel ? { level: card.intent.slotLevel } : {}) });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(arena.sheet(warlock.id).resources.racial_hellish_rebuke, { max: 1, used: 1 });
  assert.equal(arena.sheet(warlock.id).spellcasting.slots["2"].used, 0, "a slot was spent beside the free use");
});
await kit.endFight();

// ---- two free casts of one spell ----

let table = await openWorld();

await test("a Topaz fighter with Fey Touched casts misty step with one free use, never both", async () => {
  const fighter = seat(table, await made(species, "topaz"), 5, { name: "Gleam" });
  const sheet = table.sheet(fighter.id);
  table.patch(fighter.id, {
    feats: ["Fey Touched"],
    features: [...sheet.features, { name: "Free cast: Misty Step (Fey Touched)", source: "story" }],
  });
  const before = table.sheet(fighter.id).resources;
  assert.deepEqual(before.free_cast_misty_step, { max: 1, used: 0 });
  assert.deepEqual(before.racial_misty_step, { max: 1, used: 0 });
  const out = await cast(table, fighter, "Misty Step");
  assert.equal(out.ok, true, out.error);
  const after = table.sheet(fighter.id).resources;
  assert.equal(after.free_cast_misty_step.used + after.racial_misty_step.used, 1, `two uses for one casting: ${JSON.stringify(after)}`);
  const again = await cast(table, fighter, "Misty Step");
  assert.equal(again.ok, true, again.error);
  const last = table.sheet(fighter.id).resources;
  assert.equal(last.free_cast_misty_step.used + last.racial_misty_step.used, 2);
});

// ---- an author's later edits ----

let seated;
await test("an author's new count, rest, names and spell reach the seated character at once", async () => {
  table = await openWorld();
  seated = seat(table, await made(species, "topaz"), 5, { name: "Ember" });
  assert.deepEqual(table.sheet(seated.id).resources.racial_detect_thoughts, { max: 1, used: 0 });
  world.signIn(owner);
  const [topaz, celestial] = species.data.variants.options;
  const changed = {
    ...topaz,
    name: "Golden",
    spells: { ...topaz.spells, spells: [...topaz.spells.spells.map((row) => (row.spell === "Detect Thoughts" ? { ...row, uses: 3, rest: "short" } : row)), { spell: "Shield", level: 1 }] },
  };
  const edited = await call(homebrewEntry, "PATCH", { data: { ...species.data, variants: { label: "Dragon blood", options: [changed, celestial] } } }, { id: species.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const sheet = table.sheet(seated.id);
  assert.deepEqual(innateSpellsFor(sheet.race, sheet.level, undefined, { features: sheet.features }).map((spell) => spell.name), ["Mage Hand", "Detect Thoughts", "Misty Step", "Shield"]);
  assert.deepEqual(sheet.resources.racial_short_detect_thoughts, { max: 3, used: 0 });
  assert.equal(sheet.resources.racial_detect_thoughts, undefined, "the long-rest counter was left behind");
  assert.deepEqual(sheet.resources.racial_shield, { max: 1, used: 0 });
  assert.equal(deriveHand(sheet).find((card) => card.name === "Detect Thoughts")?.resource, "Free 3/3");
});

await test("a sheet missing its counter casts at the spell's own count and writes it so", async () => {
  const sheet = table.sheet(seated.id);
  const rest = Object.fromEntries(Object.entries(sheet.resources).filter(([id]) => id !== "racial_short_detect_thoughts"));
  table.patch(seated.id, { resources: rest });
  assert.equal(deriveHand(table.sheet(seated.id)).find((card) => card.name === "Detect Thoughts")?.resource, "Free 3/3", "a missing counter read as at will");
  const out = await cast(table, seated, "Detect Thoughts");
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(table.sheet(seated.id).resources.racial_short_detect_thoughts, { max: 3, used: 1 });
});

await test("a species purged for good takes its spells' counters off the seated sheet", async () => {
  world.signIn(owner);
  const gone = await brew("Ashkin", halfDragon([TOPAZ, CELESTIAL]));
  assert.equal(gone.status, 201);
  const ashen = seat(table, await made(gone.json.entry, "topaz"), 5, { name: "Cinder" });
  assert.ok(table.sheet(ashen.id).resources.racial_misty_step);
  const removed = await homebrewEntry.DELETE(new Request(`http://test/?purge=1`, { method: "DELETE" }), { params: Promise.resolve({ id: gone.json.entry.id }) });
  assert.equal(removed.status, 200);
  assert.deepEqual(Object.keys(table.sheet(ashen.id).resources).filter((id) => id.startsWith("racial_")), []);
});

// ---- a feat's ability beside a racial feat ----

await test("a variant human's racial Fey Touched (+Charisma) leaves a later Magic Initiate (cleric) on Wisdom", () => {
  const sheet = {
    name: "Ilsa", race: "variant_human", class: "fighter", level: 4, classes: [], subclass: "",
    abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 14, cha: 13 },
    proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] },
    equipment: [], features: [{ name: "Free cast: Misty Step (Fey Touched)", source: "story" }],
    feats: ["Fey Touched", "Magic Initiate"],
    featChoices: { "magic initiate": { list: "cleric", cantrips: ["Guidance", "Light"], spells: ["Bless"] } },
    asiChoices: [{ mode: "feat", feat: "Magic Initiate" }],
    racialChoices: { featAbility: "cha" },
    spellcasting: { ability: "wis", slots: {}, cantrips: ["Guidance", "Light"], known: ["Bless", "Misty Step"], prepared: [] },
    conditions: [],
  };
  // 8 + proficiency 2 + Wisdom 14 (+2); Charisma 13 is +1.
  assert.equal(spellSaveDcFor(sheet, "Bless"), 12);
  assert.equal(spellSaveDcFor(sheet, "Misty Step"), 11);
});

// ---- a free cast's dice, and the ability of a spell the class holds ----

await test("a tiefling fighter's free hellish rebuke card rolls 3d10, the level Infernal Legacy casts it at", async () => {
  const bench = await openWorld();
  const fighter = bench.addHero({ name: "Brand", race: "tiefling", class: "fighter", level: 3, abilities: { cha: 14 } });
  const card = deriveHand(bench.sheet(fighter.id)).find((entry) => entry.name === "Hellish Rebuke");
  assert.ok(card, "no Hellish Rebuke card");
  assert.equal(card.damage, "3d10");
});

await test("a Topaz wizard who prepared Misty Step casts the free use with Charisma, then the class's with Intelligence", async () => {
  const bench = await openWorld();
  const sage = seat(bench, await made(species, "topaz", "wizard"), 5, { name: "Quill" });
  const casting = bench.sheet(sage.id).spellcasting;
  bench.patch(sage.id, { spellcasting: { ...casting, prepared: [...casting.prepared, "Misty Step"], spellbook: [...(casting.spellbook ?? []), "Misty Step"] } });
  // Charisma 10 (+0) while the use is left: 8 + 3 + 0.
  assert.equal(spellSaveDcFor(bench.sheet(sage.id), "Misty Step"), 11);
  assert.equal((await cast(bench, sage, "Misty Step")).ok, true);
  assert.equal(bench.sheet(sage.id).spellcasting.slots["2"].used, 0, "the free use spent a slot");
  // Intelligence 15 (+2) for the class's casting: 8 + 3 + 2.
  assert.equal(spellSaveDcFor(bench.sheet(sage.id), "Misty Step"), 13);
});

// ---- a bundle's spells ----

await test("a bundle's species is held to the importer's catalog: an unknown spell is refused, a hand-edited level corrected", async () => {
  const pregen = { ...characters.getCharacter((await made(species, "topaz")).id).sheet, name: "Cinder" };
  const workshop = createWorkshop(owner.id, { title: "Dragon Hills" });
  characters.createCharacter(owner.id, 1, pregen, "pc", workshop.id);
  const exported = exportWorkshopBundle(workshop.id, { name: "Dragon Hills", blurb: "A test adventure.", inspiredBy: "Original work", shelf: "all" });
  assert.ok(!("error" in exported), exported.error);
  const bundle = readBundle(JSON.stringify(exported.bundle)).bundle;
  const withSpells = (rows) => ({
    ...bundle,
    homebrew: bundle.homebrew.map((entry) =>
      entry.kind === "race" ? { ...entry, data: { ...entry.data, variants: { ...entry.data.variants, options: entry.data.variants.options.map((option, at) => (at === 0 ? { ...option, spells: { ability: "cha", spells: rows } } : option)) } } } : entry,
    ),
  });
  const unknown = importWorkshopBundle(world.addUser("unknown").id, withSpells([{ spell: "Breath of Unmaking", level: 1 }]));
  assert.ok(unknown.shelf.refused.some((line) => /"Breath of Unmaking" is not a spell this server knows/.test(line)), JSON.stringify(unknown.shelf.refused));
  const fixer = world.addUser("fixer");
  importWorkshopBundle(fixer.id, withSpells([{ spell: "Mage Hand", level: 1, circle: 3, uses: 2 }]));
  const arrived = listHomebrew(fixer.id, "race").find((entry) => entry.name === "Half-Dragon");
  assert.deepEqual(arrived.data.variants.options[0].spells.spells, [{ spell: "Mage Hand", level: 1, circle: 0 }]);
});

// ---- the GM's line ----

await test("the GM's line leaves out a spell a class list already shows: a tiefling wizard's thaumaturgy", async () => {
  const bench = await openWorld();
  const wizard = bench.addHero({
    name: "Vex", race: "tiefling", class: "wizard", level: 3, abilities: { int: 16, cha: 14 },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, prepared: ["Shield"], known: [], cantrips: ["Thaumaturgy", "Fire Bolt"] },
  });
  const line = describeSheet(bench.sheet(wizard.id), "the owner", false).split("\n").find((entry) => /Species spells|Spells from their species/.test(entry)) ?? "";
  assert.match(line, /Hellish Rebuke/);
  assert.doesNotMatch(line, /Thaumaturgy/);
});

// ---- the picker on a bare server ----

await test("the species' spell picker asks for the SRD's spells, which a server with no content pack answers", async () => {
  const source = fs.readFileSync(new URL("../src/app/workshop/homebrew/SpeciesSpellFields.tsx", import.meta.url), "utf8");
  assert.match(source, /const SRD_SPELLS = \{ srd: "1" \};[\s\S]*extraParams=\{SRD_SPELLS\}/);
  world.signIn(owner);
  const response = await contentRoute.GET(new Request("http://test/api/content/spells?q=mage%20hand&srd=1"), { params: Promise.resolve({ kind: "spells" }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok((body.results ?? []).some((row) => row.name === "Mage Hand"), `no Mage Hand among ${JSON.stringify((body.results ?? []).map((row) => row.name))}`);
});


// A workshop subclass choice's option spells (PR #840) sit right below the
// subclass's own spell picker, which offers the SRD's spells with no pack
// (PR #839): the option's picker asks for them too (issue #833).
await test("a workshop subclass choice option's spell picker asks for the SRD's spells as well", () => {
  const source = fs.readFileSync(new URL("../src/app/workshop/homebrew/SubclassChoiceFields.tsx", import.meta.url), "utf8");
  assert.match(source, /const SRD_SPELLS = \{ srd: "1" \};[\s\S]*kind="spells"[\s\S]*extraParams=\{SRD_SPELLS\}/);
});

finish();
