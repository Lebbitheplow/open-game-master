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

sweep.close();
finish();
