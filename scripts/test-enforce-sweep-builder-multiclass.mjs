// Builder sweep, part 3: a second class's picks reach a character whose
// first class is another.
//
// A pick a class feature opens (a dragon ancestor, a fighting style, a
// circle's land, a favored enemy, invocations, maneuvers, metamagic) is read
// from the whole sheet by the engines. PR #837 found it was offered only by a
// level-up of the same class on a single-class sheet. Here every class is
// taken as a second class by a 1st-level character of another, five levels
// of it through the level-up's own offer (?class=), with the subclass of that
// class whose feature opens a pick. A row is one pair, held to what the
// single-class walk is held to: every level offered is taken, nothing its
// offer listed is refused, nothing is owed afterwards, and the sheet holds
// both classes at their levels.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { assertClean, assertOffered, openLevelSweep } from "./lib/sweep-builder-levelup.mjs";
import { key } from "./lib/sweep-builder.mjs";
import * as known from "./lib/sweep-builder-known-workshop.mjs";

const rows = sweepRows("test-enforce-sweep-builder-multiclass", { KNOWN: expand(known.KNOWN_MULTICLASS ?? []), SKIP: known.SKIP_MULTICLASS ?? {} });
const sweep = await openLevelSweep();
const { subclassNamesFor, subclassLevelFor } = await import("../src/lib/srd/features.ts");
const { optionSlotsFor } = await import("../src/lib/srd/options.ts");
const { classListFor } = await import("../src/lib/srd/multiclass.ts");
void optionSlotsFor;

// The subclass of each class whose features open a pick of their own, where
// one does; the class's first otherwise.
const WITH_PICKS = {
  sorcerer: "Draconic Bloodline",
  fighter: "Battle Master",
  druid: "Circle of the Land",
  ranger: "Hunter",
  monk: "Way of the Four Elements",
  barbarian: "Path of the Totem Warrior",
};
const CORE = ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard", "artificer"];
const offered = new Set(sweep.sb.classes.map((klass) => klass.id));

for (const second of CORE.filter((id) => offered.has(id))) {
  const first = second === "fighter" ? "wizard" : "fighter";
  const subclass = subclassNamesFor(second).find((name) => key(name) === key(WITH_PICKS[second] ?? "")) ?? subclassNamesFor(second)[0];
  let walked = null;
  await rows.row(`multiclass:${first}+${second}/${subclass}`, async () => {
    const seated = await sweep.seat({ level: 1, classId: first });
    // Every score at 15: the pair is about the picks, not the prerequisites
    // (SRD 5.1, Multiclassing, Prerequisites: 13 in each class's abilities).
    sweep.world.patch(seated.id, { abilities: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } });
    const walk = await sweep.climb({ to: 6, classId: second, subclass });
    walked = walk;
    assertClean(walk, `${first} 1 then ${second} 1 to 5`);
    const classes = classListFor(walk.sheet);
    const held = classes.find((entry) => key(entry.id) === key(second));
    assert.equal(held?.level, 5, `the sheet's classes after the walk: ${JSON.stringify(classes)}`);
    if ((subclassLevelFor(second) ?? 3) <= 5) {
      assert.equal(key(held.subclass), key(subclass), `the second class's subclass after the walk: ${JSON.stringify(classes)}`);
    }
    // Every pick the walk's offers listed is on the sheet as a choice.
    const listed = walk.offers.flatMap((entry) => (entry.choices.featurePicks ?? []).map((slot) => slot.label));
    const choices = walk.sheet.features.filter((feature) => feature.source === "choice").map((feature) => feature.name);
    assert.ok(!listed.length || choices.length, `the offers listed ${listed.join(", ")} and the sheet holds no choice at all`);
  });
  // The offer against the PATCH, in a row of its own (as the single-class
  // walk keeps it), so a known refusal there hides nothing above.
  if (walked) {
    await rows.row(`multiclass-offer:${first}+${second}/${subclass}`, async () => assertOffered(walked, `${first} 1 then ${second} 1 to 5`));
  }
}

sweep.close();
rows.finish();
