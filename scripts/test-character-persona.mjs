// A character's personality: one trait, one ideal, one bond and one flaw,
// the four short lines every 2014 background suggests (SRD 5.1's Acolyte
// carries its own tables; the Player's Handbook's do too). The character
// creator audit of 2026-11-13 found the builder asked for none of them.
//
//   the builder offers the chosen background's suggestions for each (a pack
//   background's own tables, read from its text; the bundled thirteen's
//   written for ODM; any other background a general list) and a line of the
//   player's own; the four ride to the library and the table, survive an
//   edit, are the owner's to change in play, sync back with the backstory,
//   and the GM reads them every turn beside the backstory.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-character-persona");

const world = await openWorld();
const builder = await openBuilder();
const { createSheetSchema, patchSheetSchema, PERSONA_ENTRY_MAX } = await import("../src/lib/schemas/sheet.ts");
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const characters = await import("../src/lib/db/characters.ts");
const persona = await import("../src/lib/backgrounds/persona-logic.ts");
const srd = await import("../src/lib/srd/index.ts");
const { CUSTOM_BACKGROUNDS } = await import("../src/lib/backgrounds/index.ts");
const { contentPackInstalled } = await import("../src/lib/content/db.ts");
const { listBackgrounds } = await import("../src/lib/content/index.ts");
const { mergedBackgroundOptions } = await import("../src/lib/characters/options.ts");

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const MIRA = {
  trait: "I hum old hymns when I am nervous.",
  ideal: "Mercy. Everyone deserves one more chance.",
  bond: "The temple that raised me burned, and I will rebuild it.",
  flaw: "I trust anyone who shares my faith, far too quickly.",
};

async function patchSheet(user, body) {
  const route = await world.route("campaigns/[campaignId]/sheet");
  world.signIn(user);
  const response = await route.PATCH(
    new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

await test("the sheet holds the four lines, each optional and as long as the field allows", () => {
  assert.equal(PERSONA_ENTRY_MAX, 300);
  const hero = world.addHero({ name: "Plain" });
  const base = world.sheet(hero.id);
  // A sheet written before the field reads as none.
  assert.equal(createSheetSchema.parse({ ...base, persona: undefined }).persona, undefined);
  assert.deepEqual(createSheetSchema.parse({ ...base, persona: { trait: "  Calm.  " } }).persona, { trait: "Calm.", ideal: "", bond: "", flaw: "" });
  assert.equal(createSheetSchema.safeParse({ ...base, persona: { flaw: "x".repeat(301) } }).success, false);
  assert.equal(patchSheetSchema.safeParse({ persona: MIRA }).success, true);
});

await test("every background offers suggestions for all four: its own for the bundled thirteen, a general list for the rest", () => {
  for (const background of srd.SRD_BACKGROUNDS) {
    const offered = persona.personaSuggestionsFor(background);
    assert.equal(offered.fromBackground, true, background.id);
    for (const key of persona.PERSONA_KEYS) {
      assert.ok(offered.lists[key].length >= 4, `${background.id} ${key}: ${offered.lists[key].length}`);
      for (const line of offered.lists[key]) {
        assert.ok(line.length > 8 && line.length <= PERSONA_ENTRY_MAX, `${background.id} ${key}: ${line}`);
        assert.ok(!line.includes("—"), `${background.id} ${key} has an em dash`);
      }
      assert.equal(new Set(offered.lists[key]).size, offered.lists[key].length, `${background.id} ${key} repeats a line`);
    }
  }
  for (const background of CUSTOM_BACKGROUNDS) {
    const offered = persona.personaSuggestionsFor(background);
    for (const key of persona.PERSONA_KEYS) {
      assert.ok(offered.lists[key].length >= 6, `${background.id} ${key}`);
    }
  }
  assert.equal(persona.personaSuggestionsFor(null).fromBackground, false);
});

await test("a pack background's own suggested tables are read from its text", () => {
  const table = [
    "Court servants keep to themselves.",
    "",
    "| d8 | Personality Trait |",
    "|---|---|",
    "| 1 | I fold my hands when I listen. |",
    "| 2 | I notice every spill. |",
    "",
    "| d6 | Ideal |",
    "|---|---|",
    "| 1 | Discretion. A secret kept is a debt paid. (Lawful) |",
    "",
    "| d6 | Bond |",
    "|----|----|",
    "| 1 | My old master still writes to me. |",
    "",
    "| d6 | Flaw |",
    "|---|---|",
    "| 1 | I cannot stand to be ignored. |",
  ].join("\n");
  const read = persona.parseSuggestedCharacteristics(table);
  assert.deepEqual(read, {
    trait: ["I fold my hands when I listen.", "I notice every spill."],
    ideal: ["Discretion. A secret kept is a debt paid. (Lawful)"],
    bond: ["My old master still writes to me."],
    flaw: ["I cannot stand to be ignored."],
  });
  assert.equal(persona.parseSuggestedCharacteristics("### Artisan Mementos\n\n1. A hammer."), null);
  if (!contentPackInstalled()) {
    return;
  }
  const options = mergedBackgroundOptions(listBackgrounds({ limit: 200 })).filter((option) => option.documentSlug);
  const withTables = options.filter((option) => option.persona);
  assert.ok(withTables.length >= 15, `${withTables.length} pack backgrounds with tables`);
  for (const option of withTables) {
    const offered = persona.personaSuggestionsFor(option);
    assert.equal(offered.fromBackground, true, option.id);
    for (const key of persona.PERSONA_KEYS) {
      assert.ok(offered.lists[key].length >= 1, `${option.id} ${key}`);
      for (const line of offered.lists[key]) {
        assert.ok(line.length <= PERSONA_ENTRY_MAX && !/^\|/.test(line) && !/\|\s*$/.test(line), `${option.id} ${key}: ${line}`);
      }
    }
  }
});

const BOOK = ["Sleep", "Shield", "Identify", "Detect Magic", "Feather Fall", "Charm Person"];
const acolyteWizard = (fields = {}) =>
  builder.build({
    race: "dragonborn",
    class: "wizard",
    background: "acolyte",
    scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    chosenSkills: ["arcana", "history"],
    bonusLanguages: ["Giant", "Sylvan"],
    cantrips: ["Light", "Mage Hand", "Fire Bolt"],
    spells: BOOK,
    bookPrepared: BOOK.slice(0, 3),
    racialAncestry: "red",
    ...fields,
  });

await test("the builder sends the four lines, blank ones left out, and the library and the table keep them", async () => {
  const built = acolyteWizard({ persona: { ...MIRA, flaw: "   " } });
  assert.equal(built.blocker, null, built.blocker?.message);
  assert.deepEqual(built.sheet.persona, { ...MIRA, flaw: "" });
  // A blank panel is fine and sends nothing.
  assert.equal(acolyteWizard().sheet.persona, undefined);
  const player = world.addUser("persona-player");
  const made = characters.createCharacter(player.id, 1, createSheetSchema.parse({ ...built.sheet, portrait: { url: "/uploads/enforce-creation.png" } }));
  assert.deepEqual(characters.getCharacter(made.id).sheet.persona, { ...MIRA, flaw: "" });
  const copy = characters.instantiateIntoCampaign(made.id, world.campaignId, player.id, 1);
  assert.ok(copy && !("error" in copy), JSON.stringify(copy));
  const seated = world.sheets().find((sheet) => sheet.libraryCharacterId === made.id);
  assert.deepEqual(seated.persona, { ...MIRA, flaw: "" });
});

await test("the owner changes the four lines in play, nobody else does, and they go home with the backstory", async () => {
  const owner = world.addUser("mira-player");
  const mira = world.addHero({ name: "Mira", user: owner });
  const changed = await patchSheet(owner, { characterId: mira.id, persona: MIRA });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  assert.deepEqual(world.sheet(mira.id).persona, MIRA);
  const other = world.addUser("other");
  const refused = await patchSheet(other, { characterId: mira.id, persona: { ...MIRA, flaw: "Cowardice." } });
  assert.equal(refused.status, 404);
  assert.deepEqual(world.sheet(mira.id).persona, MIRA);
  // A library character's copy carries the change home, as the backstory does.
  const keeper = world.addUser("keeper");
  const input = createSheetSchema.parse({ ...world.sheet(mira.id), name: "Wren", persona: MIRA });
  const wren = characters.createCharacter(keeper.id, 1, input);
  characters.instantiateIntoCampaign(wren.id, world.campaignId, keeper.id, 1);
  const seated = world.sheets().find((sheet) => sheet.libraryCharacterId === wren.id);
  world.patch(seated.id, { persona: { ...MIRA, bond: "I owe the ferryman my life." } });
  characters.syncProgressToLibrary(seated.id);
  assert.equal(characters.getCharacter(wren.id).sheet.persona.bond, "I owe the ferryman my life.");
});

await test("the GM reads them every turn beside the backstory, and a blank panel says nothing", () => {
  const hero = world.addHero({ name: "Tamsin" });
  world.patch(hero.id, { persona: MIRA });
  const line = describeSheet(world.sheet(hero.id), "owner", false, {});
  assert.match(line, /Personality: trait "I hum old hymns when I am nervous\."; ideal "Mercy\. Everyone deserves one more chance\."; bond "The temple that raised me burned, and I will rebuild it\."; flaw "I trust anyone who shares my faith, far too quickly\."/);
  world.patch(hero.id, { persona: { trait: "", ideal: "Freedom.", bond: "", flaw: "" } });
  assert.match(describeSheet(world.sheet(hero.id), "owner", false, {}), /Personality: ideal "Freedom\."\n|Personality: ideal "Freedom\."$/m);
  world.patch(hero.id, { persona: { trait: "", ideal: "", bond: "", flaw: "" } });
  assert.doesNotMatch(describeSheet(world.sheet(hero.id), "owner", false, {}), /Personality:/);
});

await test("the builder asks on the Identity step, the sheet shows them and its owner edits them, on hosts that keep them", async () => {
  const step = read("src/app/characters/builder/steps/IdentityStep.tsx");
  assert.match(step, /<PersonalityFields/);
  assert.match(step, /title="Personality \(optional\)"/);
  assert.match(read("src/app/characters/builder/submit.ts"), /persona: personaOrNothing\(state\.persona\)/);
  assert.match(read("src/app/characters/builder/useBuilderState.ts"), /useState<Persona>\(initial\?\.persona \?\? EMPTY_PERSONA\)/);
  assert.match(read("src/app/campaigns/[campaignId]/CharacterSheetDialog.tsx"), /<SheetPersonality sheet=\{sheet\} mine=\{mine\}/);
  assert.match(read("src/app/characters/[characterId]/SheetSections.tsx"), /<PersonaLines persona=\{sheet\.persona\}/);
  const fields = read("src/app/characters/builder/PersonalityFields.tsx");
  // Labelled for screen readers, finger-sized, a line of one's own.
  assert.match(fields, /aria-label=\{`\$\{PERSONA_LABELS\[key\]\}, in your own words`\}/);
  assert.match(fields, /min-h-10/);
  assert.match(fields, /Write my own/);
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  assert.equal(SERVER_FEATURES.persona, true);
  assert.match(step, /const asksPersona = hostOffers\(useCapabilities\(\), "persona"\);/);
});

finish();
