// The picks a subclass feature opens (a Four Elements monk's disciplines, a
// Rune Knight's runes, a warlock's invocations beside them), held at
// creation to the rules the level-up and the owed picks already hold them to
// (src/lib/srd/options.ts optionReqProblem). Character creator audit, cc1113.
//
// Import order: enforce-world first (it points the database at a scratch
// directory), then the builder sweep, which drives the builder as a browser
// runs it and posts through the library door.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { openFillSweep } from "./lib/sweep-builder-fill.mjs";
import { doors } from "./lib/sweep-builder.mjs";

const { test, finish } = suite("test-enforce-subclass-picks");
const sweep = await openFillSweep();
const door = doors({ creation: sweep.libraryCreation });
const { optionFeatureName, optionsOfKind } = await import("../src/lib/srd/options.ts");
const { contentPackInstalled } = await import("../src/lib/content/db.ts");
const hasPack = contentPackInstalled();

// A character the builder fills at this level, with one pick of `kind`
// swapped for `option`: what the builder says of it, and what the server does.
async function swapped({ classId, subclass, level, kind, option }) {
  const { fields } = await sweep.library.fill(sweep.library.fresh({ level, classId, subclass }));
  const prefix = optionFeatureName(kind, "");
  const at = fields.optionPicks.findIndex((name) => name.startsWith(prefix));
  assert.ok(at >= 0, `the fill made no ${kind} pick for ${subclass || classId} ${level}`);
  const optionPicks = fields.optionPicks.map((name, index) => (index === at ? optionFeatureName(kind, option) : name));
  const built = sweep.library.derive({ ...fields, optionPicks });
  return { built, stored: await door.library(built) };
}

await test(
  "A05 A pick whose option needs a higher class level (a 3rd-level Four Elements monk's Breath of Winter, a 3rd-level Rune Knight's Storm Rune, a 2nd-level warlock's Ascendant Step) is shown as not yet open in the builder and refused at the save, as the level-up refuses it.",
  async () => {
    const problems = [];
    for (const row of [
      { classId: "monk", subclass: "Way of the Four Elements", level: 3, kind: "discipline", option: "Breath of Winter" },
      { classId: "fighter", subclass: "Rune Knight", level: 3, kind: "rune", option: "Storm Rune" },
      { classId: "warlock", subclass: "", level: 2, kind: "invocation", option: "Ascendant Step" },
      { classId: "artificer", subclass: "", level: 2, kind: "infusion", option: "Helm of Awareness" },
    ]) {
      const label = `${row.subclass || row.classId} ${row.level}: ${row.option}`;
      const { built, stored } = await swapped(row);
      const name = optionFeatureName(row.kind, row.option);
      if (!built.derived.optionUnmet?.[name]) problems.push(`${label} is offered as open in the builder`);
      if (stored.ok) problems.push(`${label} was stored`);
      else if (!new RegExp(row.option, "i").test(stored.error ?? "")) problems.push(`${label} was refused for another reason: ${stored.error}`);
    }
    assert.deepEqual(problems, []);
  },
);

await test("A05 Every subclass pick-list's option with a level prerequisite is closed below that level and open at it, in the builder.", async () => {
  const problems = [];
  for (const [classId, subclass, kind] of [
    ["monk", "Way of the Four Elements", "discipline"],
    ["fighter", "Rune Knight", "rune"],
  ]) {
    for (const option of optionsOfKind(kind).filter((entry) => /level \d+/i.test(entry.req ?? ""))) {
      const needs = Number(/level (\d+)/i.exec(option.req)[1]);
      for (const level of [needs - 1, needs]) {
        const { fields } = await sweep.library.fill(sweep.library.fresh({ level, classId, subclass }));
        const built = sweep.library.derive(fields);
        const name = optionFeatureName(kind, option.n);
        const chosen = fields.optionPicks.includes(name);
        const closed = Boolean(built.derived.optionUnmet?.[name]);
        if (level < needs && (chosen || !closed)) problems.push(`${subclass} ${level}: ${option.n} (${option.req}) is open`);
        if (level === needs && closed) problems.push(`${subclass} ${level}: ${option.n} (${option.req}) is still closed`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

const { openOptionSlots } = await import("../src/lib/srd/options.ts");
const { classFeaturesFor } = await import("../src/lib/srd/features.ts");

await test(
  "A06 A Way of the Four Elements monk learns Elemental Attunement and one other discipline: the builder, the owed picks and the save all keep a slot for it, and the fill takes it.",
  async () => {
    const problems = [];
    const at3 = (picks) =>
      openOptionSlots({
        classId: "monk",
        subclass: "Way of the Four Elements",
        level: 3,
        features: [...classFeaturesFor("monk", "Way of the Four Elements", 3), ...picks.map((name) => ({ name: optionFeatureName("discipline", name), source: "choice" }))],
      }).find((slot) => slot.kind === "discipline");
    const last = at3(["Fangs of the Fire Snake"]);
    if (last.options.map((option) => option.n).join() !== "Elemental Attunement") {
      problems.push(`with one other discipline chosen, the last pick offers ${last.options.length} options`);
    }
    if (at3([]).options.length < 2) problems.push("the first pick offers only Elemental Attunement");
    // The fill takes it.
    const { fields } = await sweep.library.fill(sweep.library.fresh({ level: 3, classId: "monk", subclass: "Way of the Four Elements" }));
    if (!fields.optionPicks.includes(optionFeatureName("discipline", "Elemental Attunement"))) problems.push(`the fill took ${fields.optionPicks.join(", ")}`);
    // The save refuses two others.
    const optionPicks = fields.optionPicks
      .filter((name) => !name.startsWith(optionFeatureName("discipline", "")))
      .concat([optionFeatureName("discipline", "Fangs of the Fire Snake"), optionFeatureName("discipline", "Water Whip")]);
    const stored = await door.library(sweep.library.derive({ ...fields, optionPicks }));
    if (stored.ok) problems.push("two disciplines without Elemental Attunement were stored");
    else if (!/Elemental Attunement/.test(stored.error ?? "")) problems.push(`refused for another reason: ${stored.error}`);
    assert.deepEqual(problems, []);
  },
);

await test("A07 The builder's spell step offers the spells a picked patron option adds: a Genie warlock's kind, an Animal Lords warlock's lord.", async () => {
  const problems = [];
  for (const [subclass, kind, option, spell] of [
    ["The Genie", "genie_kind", "Efreeti", "Burning Hands"],
    // Animal Lords is Tome of Heroes, a content-pack subclass.
    ...(hasPack ? [["Animal Lords", "animal_lord", "Toad King", "Fog Cloud"]] : []),
  ]) {
    const { fields } = await sweep.library.fill(sweep.library.fresh({ level: 1, classId: "warlock", subclass }));
    const optionPicks = [...fields.optionPicks.filter((name) => !name.startsWith(optionFeatureName(kind, ""))), optionFeatureName(kind, option)];
    const { derived } = sweep.library.derive({ ...fields, optionPicks });
    if (!(derived.spellWider?.spells ?? []).includes(spell)) problems.push(`${subclass} (${option}): the builder offers ${JSON.stringify(derived.spellWider?.spells)}`);
  }
  assert.deepEqual(problems, []);
});

await test("A08 A Smuggler rogue (Tome of Heroes) picks two wizard illusion or transmutation cantrips at 3rd level, a 1st-level one at 7th and a 2nd-level one at 13th; the builder asks, the save keeps them, and the engine casts them, the spells once a long rest without a slot.", async () => {
  // The Smuggler is a content-pack subclass (Tome of Heroes).
  if (!hasPack) {
    return;
  }
  const { spellHeldProblem, grantedCastOf } = await import("../src/lib/dm/cast-rules.ts");
  const { populateResources } = await import("../src/lib/srd/class-resources.ts");
  const { bundledSpellSchool } = await import("../src/lib/srd/spell-facts.ts");
  const { classFeaturesFor } = await import("../src/lib/srd/features.ts");
  const { packSubclassExtras } = await import("../src/lib/content/archetype-tables.ts");
  const extras = packSubclassExtras();
  const problems = [];
  const slotsAt = (level, picks = []) =>
    openOptionSlots({ classId: "rogue", subclass: "Smuggler", level, features: [...classFeaturesFor("rogue", "Smuggler", level, extras), ...picks.map((name) => ({ name, source: "choice" }))] });
  const totals = (level) => Object.fromEntries(slotsAt(level).filter((slot) => /legerdemain/i.test(slot.label)).map((slot) => [slot.label, slot.total]));
  const at3 = totals(3), at7 = totals(7), at13 = totals(13);
  if (Object.values(at3).join() !== "2") problems.push(`at 3rd level: ${JSON.stringify(at3)}`);
  if (Object.values(at7).join() !== "2,1") problems.push(`at 7th level: ${JSON.stringify(at7)}`);
  if (Object.values(at13).join() !== "2,1,1") problems.push(`at 13th level: ${JSON.stringify(at13)}`);
  for (const slot of slotsAt(13).filter((entry) => /legerdemain/i.test(entry.label))) {
    const off = slot.options.filter((option) => !["illusion", "transmutation"].includes(bundledSpellSchool(option.n) ?? ""));
    if (off.length) problems.push(`${slot.label} offers ${off.map((option) => option.n).join(", ")}`);
    if (slot.options.length < 2) problems.push(`${slot.label} offers ${slot.options.length} spells`);
  }
  // The builder fills them, and the library keeps them.
  const { fields } = await sweep.library.fill(sweep.library.fresh({ level: 7, classId: "rogue", subclass: "Smuggler" }));
  const legerdemain = fields.optionPicks.filter((name) => /^Legerdemain/.test(name));
  if (legerdemain.length !== 3) problems.push(`the fill made ${legerdemain.join(", ") || "no Legerdemain picks"}`);
  const stored = await door.library(sweep.library.derive(fields));
  if (!stored.ok) problems.push(`the save refused: ${stored.error}`);
  const kept = (stored.sheet?.features ?? []).filter((feature) => /^Legerdemain/.test(feature.name)).map((feature) => feature.name);
  if (kept.length !== 3) problems.push(`the stored sheet keeps ${kept.join(", ")}`);
  // The engine casts what was picked.
  const sheet = { name: "Smuggler", class: "rogue", subclass: "Smuggler", level: 7, classes: [], features: [...classFeaturesFor("rogue", "Smuggler", 7, extras), { name: "Legerdemain Cantrip: Minor Illusion", source: "choice" }, { name: "Legerdemain Spell: Disguise Self", source: "choice" }], spellcasting: null, resources: {} };
  for (const spell of ["Minor Illusion", "Disguise Self"]) {
    if (spellHeldProblem({ ...sheet, spellcasting: { ability: "int", cantrips: [], known: [], prepared: [], slots: {}, slotsUsed: {} } }, spell, null, { extras })) problems.push(`${spell} cannot be cast`);
  }
  const grant = grantedCastOf(sheet, "Disguise Self", null, extras);
  if (!grant?.counter) problems.push(`Disguise Self casts with no counter: ${JSON.stringify(grant)}`);
  const counters = populateResources(sheet.features, 7, {}, undefined, [{ id: "rogue", level: 7 }]);
  if (grant?.counter && counters[grant.counter]?.max !== 1) problems.push(`no once-a-rest counter for Disguise Self: ${JSON.stringify(counters)}`);
  // A rogue level trades the 1st-level spell for another of the list.
  const { levelUpChangeOffers, applyLevelUpChanges } = await import("../src/lib/srd/level-up-changes.ts");
  const facts = { classLevel: () => 8, cantrips: [] };
  const offer = levelUpChangeOffers(sheet, "rogue", facts).find((entry) => entry.froms?.includes("Legerdemain Spell: Disguise Self"));
  if (!offer?.options.includes("Legerdemain Spell: Silent Image")) problems.push(`the rogue level offers no trade: ${JSON.stringify(offer?.options?.slice(0, 5))}`);
  const traded = applyLevelUpChanges(sheet, "rogue", [{ from: "Legerdemain Spell: Disguise Self", to: "Legerdemain Spell: Silent Image" }], facts);
  if (!traded.features?.some((feature) => feature.name === "Legerdemain Spell: Silent Image")) problems.push(`the trade was not made: ${traded.error}`);
  assert.deepEqual(problems, []);
});

sweep.close();
finish();
