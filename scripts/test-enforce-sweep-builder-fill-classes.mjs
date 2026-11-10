// Builder sweep, part 1: every class the builder offers, filled by "Fill
// what's left" at levels 1, 5, 11 and 20, is a character the builder's gate
// and both of the server's doors take, with nothing held twice and nothing
// left owed (scripts/lib/sweep-builder-fill.mjs).
//
// The rows are the builder's own list as the server offers it: with the
// content pack that is the pack's classes and every setting's own; without
// it (test-enforce-sweep-builder-fill-nopack.mjs) the bundled ones.
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openFillSweep } from "./lib/sweep-builder-fill.mjs";
import { KNOWN_FILL_CLASSES, SKIP_FILL_CLASSES } from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-fill-classes", { KNOWN: expand(KNOWN_FILL_CLASSES), SKIP: SKIP_FILL_CLASSES });
const sweep = await openFillSweep();

for (const klass of sweep.library.classes) {
  for (const level of [1, 5, 11, 20]) {
    await rows.row(`fill:class:${klass.id}@${level}`, async () => {
      await sweep.fillAndSave({ level, classId: klass.id });
    });
  }
}

sweep.close();
rows.finish();
