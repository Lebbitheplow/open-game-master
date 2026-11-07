// Spells on a workshop species and on each option of its player's choice
// (issue #833), run by the one path the SRD's racial spells take, and the
// racial-spell bugs found on the way.
//
// The issue's own example: a Half-Dragon whose player picks a draconic
// ancestry. Topaz knows Mage Hand at 1st level, Detect Thoughts at 3rd and
// Misty Step at 5th (Charisma); Celestial knows Light (Wisdom); Green knows
// Disguise Self, twice a short rest, which the character's own spell slots
// can also cast.
//
// Through the real routes and a real database:
//   the workshop keeps the rows, named as the catalog names them with each
//   spell's own level, and refuses a spell it does not know or a list past
//   its limit;
//   a Topaz character made in the builder enters play with Mage Hand only,
//   gains Detect Thoughts at 3rd and Misty Step at 5th, casts them with
//   Charisma through the cast tools, once a long rest each, and the rest
//   brings them back; the Hand deals them as spell cards and the GM's
//   prompt lists them;
//   a Green wizard casts Disguise Self twice free, then with a slot, and the
//   short rest brings the free uses back; Topaz's Detect Thoughts, which no
//   slot casts, is refused once spent though the wizard holds slots;
//   an edit to Celestial takes Topaz's spells away and gives Light;
//   a species with no spells, and an SRD tiefling, play as before;
//   a published species copied in the workshop keeps its spells;
// and the bugs: darkness was cast as a 1st-level spell; a free racial cast
// of a spell the class also held was never offered, a slot always paid; a cantrip was told
// from a levelled spell by the level it arrives at; a race's cantrip that
// arrives at 3rd level never reached a caster's list at a level-up; a
// racial spell of 1st level or higher had no spell card; a racial grant had
// no slot fallback; every racial counter held one use back on a long rest;
// and a feat's or a grant's spellcasting ability was ignored for its DC.
import assert from "node:assert/strict";
import { suite, abilityMod, proficiencyBonus } from "./lib/enforce-harness.mjs";
import { openCreation, PORTRAIT } from "./lib/enforce-creation.mjs";
import { openWorld, heroInput } from "./lib/enforce-world.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-species-spells");
const { world, call, libraryRoute, characters } = await openCreation();
const builder = await openBuilder();
const homebrewRoute = await world.route("homebrew");
const characterRoute = await world.route("characters/[characterId]");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { withSpeciesVariant, variantSummary } = await import("../src/lib/content/species-variants.ts");
const { innateSpellsFor, innateCantripsFor } = await import("../src/lib/srd/racial-grants.ts");
const { grantedCastsOf } = await import("../src/lib/srd/granted-casts.ts");
const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const { spellSaveDcFor } = await import("../src/lib/srd/index.ts");
const { resourceDef } = await import("../src/lib/srd/class-resources.ts");
const { speciesSpellsShown } = await import("../src/lib/srd/species-spell-view.ts");
const { raceMechanicsOf } = await import("../src/lib/workshop/catalog-mechanics.ts");
const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
const { hostOffers } = await import("../src/lib/use-capabilities.ts");

const owner = world.owner;
const TOPAZ = {
  name: "Topaz",
  description: "Golden scales and a mind that listens.",
  // Typed as a player would: the catalog names it.
  spells: { ability: "cha", spells: [{ spell: "mage hand", level: 1, uses: 3 }, { spell: "Detect Thoughts", level: 3 }, { spell: "Misty Step", level: 5 }] },
};
const CELESTIAL = { name: "Celestial", spells: { ability: "wis", spells: [{ spell: "Light", level: 1 }] } };
const GREEN = { name: "Green", spells: { ability: "cha", spells: [{ spell: "Disguise Self", level: 1, uses: 2, rest: "short", slots: true }] } };
const halfDragon = (options) => ({
  desc: "Folk with a dragon close in the family.",
  size: "Medium",
  speed: { walk: 30 },
  asi: [{ attributes: ["Strength"], value: 2 }],
  languages: ["Common", "Draconic"],
  traits: "**_Scaled Hide._** Your scales turn the first blow of a fight.",
  variants: { label: "Draconic ancestry", options },
});
// A fighter's scores and a wizard's, Charisma low against Intelligence so a
// Charisma DC is told from the class's.
const FIGHTER = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const WIZARD = { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 };
const names = (sheet) => (sheet.features ?? []).map((feature) => feature.name);
const innate = (sheet) => innateSpellsFor(sheet.race, sheet.level, undefined, { variant: sheet.racialChoices?.variant, features: sheet.features });

async function brew(name, data) {
  world.signIn(owner);
  return call(homebrewRoute, "POST", { kind: "race", name, data });
}

function raceOf(entry) {
  const id = `homebrew:${entry.id}`;
  return packRaceOptions([{ slug: id, name: entry.name, documentSlug: "homebrew", document: "Homebrew", data: entry.data }], [id])[0];
}

function built(entry, variant, klass = "fighter") {
  const wizard = klass === "wizard";
  const result = builder.build({
    race: withSpeciesVariant(raceOf(entry), variant),
    class: klass,
    background: "soldier",
    scores: wizard ? WIZARD : FIGHTER,
    chosenSkills: wizard ? ["arcana", "history"] : ["acrobatics", "perception"],
    ...(wizard
      ? { cantrips: ["Fire Bolt", "Ray of Frost", "Prestidigitation"], spells: ["Magic Missile", "Shield", "Sleep", "Burning Hands", "Thunderwave", "Mage Armor"], bookPrepared: ["Magic Missile", "Shield", "Sleep"] }
      : { stylePicks: ["defense"] }),
    racialVariant: variant,
  });
  assert.equal(result.blocker, null, result.blocker?.message);
  return { ...result.sheet, portrait: PORTRAIT };
}

let species;
let topaz;

await test("the workshop keeps each option's spells, named as the catalog names them with their own level; a cantrip's uses are dropped", async () => {
  const saved = await brew("Half-Dragon", halfDragon([TOPAZ, CELESTIAL, GREEN]));
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  species = saved.json.entry;
  const [topazRow, celestial, green] = species.data.variants.options;
  assert.deepEqual(topazRow.spells, {
    ability: "cha",
    spells: [
      { spell: "Mage Hand", level: 1, circle: 0 },
      { spell: "Detect Thoughts", level: 3, circle: 2 },
      { spell: "Misty Step", level: 5, circle: 2 },
    ],
  });
  assert.deepEqual(celestial.spells, { ability: "wis", spells: [{ spell: "Light", level: 1, circle: 0 }] });
  assert.deepEqual(green.spells.spells, [{ spell: "Disguise Self", level: 1, circle: 1, uses: 2, rest: "short", slots: true }]);
  assert.match(variantSummary(topazRow), /spells: Mage Hand \(cantrip\); Detect Thoughts from 3rd level, once a long rest; Misty Step from 5th level, once a long rest \(Charisma\)/);
});

await test("a spell the catalog does not know, nine spells, and a use count past five are refused by name", async () => {
  const unknown = await brew("Mistkin", halfDragon([{ name: "Fog", spells: { ability: "cha", spells: [{ spell: "Breath of Unmaking", level: 1 }] } }, CELESTIAL]));
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.error, /"Fog": "Breath of Unmaking" is not a spell this server knows; pick it from the spell list\./);
  const crowded = await brew("Crowdkin", { ...halfDragon([TOPAZ, CELESTIAL]), spells: { ability: "int", spells: ["Light", "Mage Hand", "Message", "Minor Illusion", "Prestidigitation", "Thaumaturgy", "Guidance", "Resistance", "Spare the Dying"].map((spell) => ({ spell, level: 1 })) } });
  assert.equal(crowded.status, 400);
  assert.match(crowded.json.error, /The species gives 9 spells; it gives 8 at most\./);
  const greedy = await brew("Greedkin", halfDragon([{ name: "Gold", spells: { ability: "cha", spells: [{ spell: "Shield", level: 1, uses: 6 }] } }, CELESTIAL]));
  assert.equal(greedy.status, 400);
  assert.match(greedy.json.error, /Shield is cast 1 to 5 times without a slot between rests\./);
});

await test("a Topaz fighter made in the builder enters play with Mage Hand only, dealt in the Hand with no Spellcasting of its own", async () => {
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built(species, "topaz") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  topaz = made.json.character;
  assert.ok(names(topaz.sheet).includes("Draconic ancestry (Topaz)"));
  assert.deepEqual(innate({ ...topaz.sheet, level: 1 }).map((spell) => spell.name), ["Mage Hand"]);
  assert.deepEqual(innate({ ...topaz.sheet, level: 5 }).map((spell) => spell.name), ["Mage Hand", "Detect Thoughts", "Misty Step"]);
  // An option's cantrip is read from the option, never copied into a list.
  assert.equal(topaz.sheet.spellcasting, null);
});

let table;
let hero;
const seat = (sheet, level, extra = {}) => {
  const admitted = characters.admitLibraryCharacter(sheet, table.campaign(), owner.id, level);
  assert.equal(admitted.ok, true, admitted.problems?.join(" | "));
  // A component pouch, as a caster's kit holds one: Detect Thoughts asks for
  // a copper piece, whoever casts it.
  return table.addHero({ ...admitted.sheet, level, equipment: [...admitted.sheet.equipment, { name: "Component pouch", qty: 1 }], ...extra });
};
const cast = (sheet, spell, extra = {}, at = table) => at.invoke("use_spell_slot", { characterId: sheet.id, spell, ...extra });

await test("at 1st level the table holds no counter and casts Mage Hand at will; Detect Thoughts is not theirs yet", async () => {
  table = await openWorld();
  hero = seat(characters.getCharacter(topaz.id), 1, { name: "Ember" });
  assert.deepEqual(Object.keys(table.sheet(hero.id).resources).filter((id) => id.startsWith("racial_")), []);
  const hand = deriveHand(table.sheet(hero.id)).map((card) => card.name);
  assert.ok(hand.includes("Mage Hand"), `no Mage Hand card: ${hand.join(", ")}`);
  const out = await cast(hero, "Mage Hand");
  assert.equal(out.ok, true, out.error);
  const early = await cast(hero, "Detect Thoughts");
  assert.equal(early.ok, false, "Detect Thoughts was cast at 1st level");
});

// A level reached in play, by the path every level change takes
// (src/lib/db/sheets.ts patchSheet, src/lib/srd/level-change.ts).
function levelTo(sheet, level) {
  table.patch(sheet.id, { level });
  return table.sheet(sheet.id);
}

await test("at 3rd level Detect Thoughts arrives: one use a long rest, cast with Charisma as a 2nd-level spell, a spell card in the Hand, and back after a long rest", async () => {
  levelTo(hero, 2);
  const third = levelTo(hero, 3);
  assert.deepEqual(third.resources.racial_detect_thoughts, { max: 1, used: 0 });
  const card = deriveHand(third).find((entry) => entry.name === "Detect Thoughts");
  assert.ok(card, "no Detect Thoughts card");
  assert.equal(card.resource, "Free 1/1");
  assert.match(card.description, /No slot: 1 of 1 free uses left until a long rest\./);
  // 8 + proficiency 2 + Charisma 8 (-1): the option's ability.
  assert.equal(spellSaveDcFor(third, "Detect Thoughts"), 9);
  assert.match(describeSheet(third, "the owner", false), /Species spells \(no slot, spell tools spend them\): Mage Hand \(at will CHA DC 9\); Detect Thoughts \(L2, 1\/1 per long rest CHA DC 9\)/);
  const out = await cast(hero, "Detect Thoughts");
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.slotLevel, 2);
  assert.deepEqual(table.sheet(hero.id).resources.racial_detect_thoughts, { max: 1, used: 1 });
  const again = await cast(hero, "Detect Thoughts");
  assert.equal(again.ok, false);
  assert.match(again.error, /casts Detect Thoughts through Draconic ancestry \(Topaz\) once, and again after a long rest; that use is spent\./);
  const spent = deriveHand(table.sheet(hero.id)).find((entry) => entry.name === "Detect Thoughts");
  assert.ok(spent.disabled, "a spent Detect Thoughts card was playable");
  assert.ok(!deriveHand(table.sheet(hero.id)).some((entry) => entry.id === "feature:racial_detect_thoughts"), "the counter was dealt as a feature card beside the spell");
  const rested = await table.invoke("take_rest", { kind: "long", characterIds: [hero.id] });
  assert.equal(rested.ok, true, rested.error);
  assert.deepEqual(table.sheet(hero.id).resources.racial_detect_thoughts, { max: 1, used: 0 });
});

await test("at 5th level Misty Step arrives beside it, and both are cast", async () => {
  levelTo(hero, 4);
  const fifth = levelTo(hero, 5);
  assert.deepEqual(innate(fifth).map((spell) => spell.name), ["Mage Hand", "Detect Thoughts", "Misty Step"]);
  assert.deepEqual(fifth.resources.racial_misty_step, { max: 1, used: 0 });
  const out = await cast(hero, "Misty Step");
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(table.sheet(hero.id).resources.racial_misty_step, { max: 1, used: 1 });
});

await test("a Green wizard casts Disguise Self twice free, then from a slot, and the short rest brings the free uses back", async () => {
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built(species, "green", "wizard") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const green = seat(made.json.character, 1, { name: "Moss" });
  assert.deepEqual(table.sheet(green.id).resources.racial_short_disguise_self, { max: 2, used: 0 });
  assert.equal(resourceDef("racial_short_disguise_self").recharge, "short");
  for (const used of [1, 2]) {
    const out = await cast(green, "Disguise Self");
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(table.sheet(green.id).resources.racial_short_disguise_self, { max: 2, used });
    assert.equal(table.sheet(green.id).spellcasting.slots["1"].used, 0, "a free use spent a slot");
  }
  const paid = await cast(green, "Disguise Self");
  assert.equal(paid.ok, true, paid.error);
  assert.equal(table.sheet(green.id).spellcasting.slots["1"].used, 1, "the third cast spent no slot");
  const rested = await table.invoke("take_rest", { kind: "short", characterIds: [green.id] });
  assert.equal(rested.ok, true, rested.error);
  assert.deepEqual(table.sheet(green.id).resources.racial_short_disguise_self, { max: 2, used: 0 });
});

await test("a Topaz wizard's Detect Thoughts, which no slot casts, is refused once spent though the wizard holds 2nd-level slots, with Charisma for its DC", async () => {
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built(species, "topaz", "wizard") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const sage = seat(made.json.character, 3, { name: "Sage" });
  const sheet = table.sheet(sage.id);
  assert.ok(sheet.spellcasting.slots["2"].max > 0, "setup: no 2nd-level slots");
  // Charisma 10 (+0), not Intelligence 15 (+2).
  assert.equal(spellSaveDcFor(sheet, "Detect Thoughts"), 8 + proficiencyBonus(3) + abilityMod(10));
  assert.equal((await cast(sage, "Detect Thoughts")).ok, true);
  const again = await cast(sage, "Detect Thoughts", { level: 2 });
  assert.equal(again.ok, false, "a spent Detect Thoughts was cast from a slot");
  assert.equal(table.sheet(sage.id).spellcasting.slots["2"].used, 0);
});

await test("bug: a wizard who also prepared Misty Step casts it first with the Topaz use, then from a slot", async () => {
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built(species, "topaz", "wizard") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const sage = seat(made.json.character, 5, { name: "Quill" });
  const casting = table.sheet(sage.id).spellcasting;
  table.patch(sage.id, { spellcasting: { ...casting, prepared: [...casting.prepared, "Misty Step"], spellbook: [...(casting.spellbook ?? []), "Misty Step"] } });
  assert.deepEqual(table.sheet(sage.id).resources.racial_misty_step, { max: 1, used: 0 });
  const free = await cast(sage, "Misty Step");
  assert.equal(free.ok, true, free.error);
  assert.deepEqual(table.sheet(sage.id).resources.racial_misty_step, { max: 1, used: 1 });
  assert.equal(table.sheet(sage.id).spellcasting.slots["2"].used, 0, "the free use spent a slot as well");
  const paid = await cast(sage, "Misty Step", { level: 2 });
  assert.equal(paid.ok, true, paid.error);
  assert.equal(table.sheet(sage.id).spellcasting.slots["2"].used, 1, "the second casting spent no slot");
});

await test("an edit to Celestial takes Topaz's spells away and gives Light; old Topaz counters do not stay", async () => {
  world.signIn(owner);
  const edited = await call(characterRoute, "PATCH", { level: 1, sheet: built(species, "celestial") }, { characterId: topaz.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const sheet = edited.json.character.sheet;
  assert.ok(names(sheet).includes("Draconic ancestry (Celestial)"));
  assert.deepEqual(innate({ ...sheet, level: 5 }).map((spell) => spell.name), ["Light"]);
  // At the table, read from the record the option wrote, not the pick.
  const seated = seat(edited.json.character, 5, { name: "Halo" });
  const atTable = table.sheet(seated.id);
  assert.deepEqual(innateSpellsFor(atTable.race, atTable.level, undefined, { features: atTable.features }).map((spell) => spell.name), ["Light"]);
  assert.deepEqual(Object.keys(atTable.resources).filter((id) => id.startsWith("racial_")), []);
  assert.deepEqual(grantedCastsOf(atTable).map((grant) => [grant.spell, grant.ability]), [["Light", "wis"]]);
});

await test("a species with no spells, and the SRD tiefling, play as they did", async () => {
  const plain = await brew("Scalekin", halfDragon([{ name: "Ashen", resistances: ["fire"] }, { name: "Mirrorscale", resistances: ["psychic"] }]));
  assert.equal(plain.status, 201, JSON.stringify(plain.json));
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built(plain.json.entry, "ashen") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  table = await openWorld();
  const ashen = seat(made.json.character, 5, { name: "Cinder" });
  assert.deepEqual(innate(table.sheet(ashen.id)), []);
  assert.deepEqual(Object.keys(table.sheet(ashen.id).resources).filter((id) => id.startsWith("racial_")), []);
  assert.match(describeSheet(table.sheet(ashen.id), "the owner", false), /Spellcasting: none \(cannot cast any spells\)/);
  const tiefling = table.addHero({ name: "Ash", race: "tiefling", class: "fighter", level: 3 });
  assert.deepEqual(table.sheet(tiefling.id).resources.racial_hellish_rebuke, { max: 1, used: 0 });
  assert.equal(table.sheet(tiefling.id).resources.racial_darkness, undefined);
});

await test("bug: darkness is a 2nd-level spell and was cast as a 1st; the tiefling's free darkness is cast at 2nd", async () => {
  const darkness = innateSpellsFor("tiefling", 5).find((spell) => spell.name === "Darkness");
  assert.equal(darkness.castAt, 2);
  assert.equal(innateSpellsFor("drow", 5).find((spell) => spell.name === "Darkness").castAt, 2);
  assert.equal(innateSpellsFor("tiefling", 3).find((spell) => spell.name === "Hellish Rebuke").castAt, 2);
  const bench = await openWorld();
  const tiefling = bench.addHero({ name: "Umbra", race: "tiefling", class: "fighter", level: 5, abilities: { cha: 14 }, equipment: [{ name: "Component pouch", qty: 1 }] });
  const out = await cast(tiefling, "Darkness", {}, bench);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.slotLevel, 2);
  assert.doesNotMatch(resourceDef("racial_darkness").guidance, /1st-level/);
});

await test("bug: a levelled spell is told from a cantrip by its own level, not by the level it arrives at", async () => {
  const saved = await brew("Veilkin", { ...halfDragon([CELESTIAL, { name: "Dusk", resistances: ["necrotic"] }]), spells: { ability: "int", spells: [{ spell: "Disguise Self", level: 1 }, { spell: "Minor Illusion", level: 3 }] } });
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  const id = `homebrew:${saved.json.entry.id}`;
  const rules = { traitNames: [], spells: saved.json.entry.data.spells };
  const [disguise, illusion] = innateSpellsFor(id, 3, rules);
  assert.equal(disguise.castAt, 1, "Disguise Self, arriving at 1st level, was read as a cantrip");
  assert.equal(disguise.counterId, "racial_disguise_self");
  assert.equal(illusion.castAt, 0);
  assert.deepEqual(innateCantripsFor(id, 3, rules), ["Minor Illusion"]);
});

await test("bug: a race's cantrip that arrives at 3rd level reaches a wizard's cantrip list at the level-up", async () => {
  const saved = await brew("Lanternfolk", { ...halfDragon([CELESTIAL, { name: "Dusk", resistances: ["necrotic"] }]), spells: { ability: "int", spells: [{ spell: "Dancing Lights", level: 3 }] } });
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built(saved.json.entry, "dusk", "wizard") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  table = await openWorld();
  const lantern = seat(made.json.character, 1, { name: "Wick" });
  assert.ok(!table.sheet(lantern.id).spellcasting.cantrips.includes("Dancing Lights"));
  levelTo(lantern, 2);
  const third = levelTo(lantern, 3);
  assert.ok(third.spellcasting.cantrips.includes("Dancing Lights"), `Dancing Lights never reached the list: ${third.spellcasting.cantrips.join(", ")}`);
});

await test("bug: a tiefling fighter's hellish rebuke is a spell card that spends its use, and shows on the sheet's spells", async () => {
  const bench = await openWorld();
  const tiefling = bench.addHero({ name: "Brand", race: "tiefling", class: "fighter", level: 3, abilities: { cha: 14 } });
  const sheet = bench.sheet(tiefling.id);
  const hand = deriveHand(sheet);
  const rebuke = hand.find((card) => card.name === "Hellish Rebuke");
  assert.ok(rebuke, `no Hellish Rebuke card: ${hand.map((card) => card.name).join(", ")}`);
  assert.equal(rebuke.resource, "Free 1/1");
  assert.ok(!hand.some((card) => card.id === "feature:racial_hellish_rebuke"), "the counter was a narrative feature card");
  assert.deepEqual(speciesSpellsShown(sheet).map((entry) => [entry.name, entry.level, entry.note]), [
    ["Thaumaturgy", 0, "Cantrip, at will · Charisma"],
    ["Hellish Rebuke", 1, "As a level 2 spell, once a long rest (1 left) · Charisma"],
  ]);
});

await test("bug: a feat's spell is cast with the feat's ability: Fey Touched's misty step on a wizard who raised Wisdom", () => {
  const sheet = {
    ...heroInput({ class: "wizard", abilities: { int: 16, wis: 13 } }),
    level: 4,
    spellcasting: { ability: "int", slots: {}, cantrips: [], known: [], prepared: ["Misty Step", "Sleep"] },
    feats: ["Fey Touched"],
    features: [{ name: "Free cast: Misty Step (Fey Touched)", source: "story" }],
    featChoices: { "fey touched": { spells: ["Sleep"] } },
    asiChoices: [{ mode: "feat", feat: "Fey Touched", ability: "wis" }],
  };
  // 8 + proficiency 2 + Wisdom 13 (+1), not Intelligence 16 (+3).
  assert.equal(spellSaveDcFor(sheet, "Misty Step"), 11);
  assert.equal(spellSaveDcFor(sheet, "Sleep"), 11);
});

await test("a published species copied in the workshop keeps its spells in its own rows", () => {
  const copy = raceMechanicsOf({ slug: "tiefling", name: "Tiefling", documentSlug: "wotc-srd", data: {} });
  assert.deepEqual(copy?.spells, {
    ability: "cha",
    spells: [
      { spell: "Thaumaturgy", level: 1, circle: 0 },
      { spell: "Hellish Rebuke", level: 3, circle: 1, castAt: 2 },
      { spell: "Darkness", level: 5, circle: 2 },
    ],
  });
});

await test("the editor's spell rows wait for a host that keeps them", () => {
  assert.equal(SERVER_FEATURES.speciesSpells, true);
  assert.equal(hostOffers({ features: {} }, "speciesSpells"), false);
  assert.equal(hostOffers({ features: { speciesSpells: true } }, "speciesSpells"), true);
});

finish();
