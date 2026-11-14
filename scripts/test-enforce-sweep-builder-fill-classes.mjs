// Builder sweep, part 1: every class the builder offers, filled by "Fill
// what's left" at levels 1, 5, 11 and 20, is a character the builder's gate
// and both of the server's doors take, with nothing held twice and nothing
// left owed (scripts/lib/sweep-builder-fill.mjs).
//
// The rows are the builder's own list as the server offers it: with the
// content pack that is the pack's classes and every setting's own; without
// it (test-enforce-sweep-builder-fill-nopack.mjs) the bundled ones.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openFillSweep } from "./lib/sweep-builder-fill.mjs";
import { KNOWN_FILL_CLASSES, SKIP_FILL_CLASSES } from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-fill-classes", { KNOWN: expand(KNOWN_FILL_CLASSES), SKIP: SKIP_FILL_CLASSES });
const sweep = await openFillSweep();

// A content pack's own class (Black Flag's Mechanist) lists its features
// with the levels they arrive at; each must be on the sheet from its level,
// and the subclass from the level of the feature that asks for one. Before
// src/lib/classes/pack-class-registry.ts a Mechanist held none of them.
const { getContentDb } = await import("../src/lib/content/db.ts");
const NOTES = /^(?:proficiency bonus|proficiencies|equipment|starting equipment|ability score improvements?|improvement|hit points)$/i;
function packRowFeatures(classId) {
  const row = getContentDb()?.prepare("SELECT data_json FROM classes WHERE slug = ?").get(classId);
  if (!row) return null;
  const listed = (JSON.parse(row.data_json).features ?? []).flatMap((feature) => {
    const levels = (feature.levels ?? []).map(Number).filter((level) => level >= 1 && level <= 20);
    const desc = String(feature.desc ?? "").trim();
    return levels.length && desc && !/^\[column data\]$/i.test(desc) && !NOTES.test(feature.name) ? [{ name: feature.name, level: Math.min(...levels) }] : [];
  });
  return listed.length ? listed : null;
}
const BUNDLED = new Set(["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard", "artificer"]);

for (const klass of sweep.library.classes) {
  const packFeatures = BUNDLED.has(klass.id) ? null : packRowFeatures(klass.id);
  for (const level of [1, 5, 11, 20]) {
    await rows.row(`fill:class:${klass.id}@${level}`, async () => {
      const { stored } = await sweep.fillAndSave({ level, classId: klass.id });
      if (!packFeatures) return;
      const held = new Set((stored.sheet.features ?? []).map((feature) => feature.name.toLowerCase()));
      const missing = packFeatures.filter((feature) => feature.level <= level && !held.has(feature.name.toLowerCase()));
      assert.deepEqual(missing.map((feature) => `${feature.name} (${feature.level})`), [], `a level ${level} ${klass.id} holds every feature its pack row lists by then`);
      const step = packFeatures.find((feature) => /\b(?:subclass|archetype)$/i.test(feature.name));
      if (step && level >= step.level) {
        assert.ok(stored.sheet.subclass, `a level ${level} ${klass.id} chose its subclass at ${step.level}`);
      }
    });
  }
}

sweep.close();
rows.finish();
