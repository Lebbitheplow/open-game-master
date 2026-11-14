// What the character creator's pick lists say, found looking at them on a
// phone and in the day and night themes (the cc1113 audit's browser pass,
// scripts/browser/scenarios/138-creator-*.mjs). Pure: no database.
//
//   - a tool reads as a name ("Smith's tools", not "smith's tools" or
//     "Smith'S Tools"), and a list of more than one kind of tool (a
//     warforged's 39) is sorted under the SRD's kinds;
//   - a species pick whose own fields grant nothing (an owlfolk's or rabbitfolk's Size, a
//     fairy's Fairy Magic ability: the species' rules read the pick itself)
//     is named alone, never "its words only", and every bundled species'
//     other picks still say what they give;
//   - a pick of spells (a Smuggler's Legerdemain cantrip) says the rule it
//     is picked under once, and each spell's info opens the spell itself.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { toolLabel, toolKind, toolPickOptions, KNOWN_TOOLS, MUSICAL_INSTRUMENTS } = await import("../src/lib/srd/tool-choices.ts");
const { variantGivesAnything, variantShort } = await import("../src/lib/content/species-variants.ts");
const { optionKindRule, optionPicksSpells, optionsOfKind } = await import("../src/lib/srd/options.ts");
const { describeContentEntry } = await import("../src/lib/help/index.ts");
const optionsJson = (await import("../src/lib/srd/options.json", { with: { type: "json" } })).default;
const races = (await import("../src/lib/srd/races.json", { with: { type: "json" } })).default.races;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("a tool reads as a name, its first letter raised and no letter after an apostrophe", () => {
  assert.equal(toolLabel("smith's tools"), "Smith's tools");
  assert.equal(toolLabel("thieves' tools"), "Thieves' tools");
  assert.equal(toolLabel("three-dragon ante set"), "Three-dragon ante set");
  for (const tool of KNOWN_TOOLS) {
    assert.match(toolLabel(tool), /^[A-Z]/, `${tool} starts with a capital`);
    assert.doesNotMatch(toolLabel(tool), /'[A-Z]/, `${tool} raises no letter after an apostrophe`);
  }
});

test("a warforged's 39 tools come sorted under the SRD's four kinds; an instrument list stays one list", () => {
  const all = toolPickOptions(KNOWN_TOOLS);
  assert.equal(all.length, 39);
  assert.deepEqual([...new Set(all.map((row) => row.group))], ["Artisan's tools", "Musical instruments", "Gaming sets", "Other tools"]);
  assert.equal(all.find((row) => row.value === "lute").group, "Musical instruments");
  assert.equal(toolKind("thieves' tools"), "Other tools");
  const satyr = toolPickOptions(MUSICAL_INSTRUMENTS);
  assert.ok(satyr.every((row) => !row.group), "one kind needs no heading");
  assert.equal(satyr[0].label, toolLabel(MUSICAL_INSTRUMENTS[0]));
});

test("a species pick that grants nothing of its own is named alone; every other bundled pick says what it gives", () => {
  const bare = [];
  for (const race of races) {
    for (const option of race.variants?.options ?? []) {
      if (variantGivesAnything(option)) {
        assert.notEqual(variantShort(option), "its words only", `${race.id} ${option.name}`);
      } else {
        bare.push(`${race.id}:${option.id}`);
      }
    }
  }
  assert.deepEqual(bare.sort(), ["fairy:cha", "fairy:int", "fairy:wis", "owlfolk:medium", "owlfolk:small", "rabbitfolk:medium", "rabbitfolk:small"]);
});

test("a kind that picks spells says its rule once and its options are spells; any other kind keeps its own words", () => {
  const spellKinds = Object.entries(optionsJson.kinds).filter(([, meta]) => meta.spellLevel !== undefined).map(([kind]) => kind);
  assert.ok(spellKinds.includes("legerdemain_cantrip"));
  for (const kind of spellKinds) {
    assert.ok(optionPicksSpells(kind), kind);
    assert.ok(optionKindRule(kind), `${kind} has its rule to say once`);
  }
  assert.ok(optionsOfKind("legerdemain_cantrip").some((option) => option.n === "Mending"));
  assert.equal(optionPicksSpells("invocation"), false);
  assert.equal(optionKindRule("invocation"), null);
});

test("a pack background's feature chip opens the feature, not the background's story with the feature at its foot", () => {
  const row = {
    name: "Crime Syndicate Member",
    desc: "Three paragraphs of how you came to the syndicate.",
    feature: "A Favor In Turn",
    feature_desc: "You can call in a favor from your contacts.",
  };
  const focused = describeContentEntry(row, "A Favor In Turn");
  assert.match(focused, /^\*\*Feature: A Favor In Turn\.\*\* You can call in a favor/);
  assert.doesNotMatch(focused, /Three paragraphs/);
  // The background itself, asked by its own name, still reads whole.
  assert.match(describeContentEntry(row, "Crime Syndicate Member"), /^Three paragraphs[\s\S]*Feature: A Favor In Turn/);
  assert.match(describeContentEntry(row), /^Three paragraphs/);
});

console.log(`${passed} passed`);
