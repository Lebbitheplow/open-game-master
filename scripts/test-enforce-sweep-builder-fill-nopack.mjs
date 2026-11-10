// Builder sweep, part 1: the same rows on a server without the content pack: every bundled class, subclass, species and background.
// (scripts/lib/sweep-builder-fill.mjs says what each row is held to).
import "./lib/sweep-builder-nopack.mjs";
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openFillSweep } from "./lib/sweep-builder-fill.mjs";
import { backgroundRows, speciesRows, subclassRows } from "./lib/sweep-builder-fill-rows.mjs";
import * as known from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-fill-nopack", { KNOWN: expand(known.KNOWN_FILL_NOPACK ?? []), SKIP: known.SKIP_FILL_NOPACK ?? {} });
const sweep = await openFillSweep();
for (const klass of sweep.library.classes) {
  for (const level of [1, 5, 11, 20]) {
    await rows.row(`nopack:class:${klass.id}@${level}`, async () => {
      await sweep.fillAndSave({ level, classId: klass.id });
    });
  }
}
await subclassRows(rows, sweep, { prefix: "nopack" });
await speciesRows(rows, sweep, { prefix: "nopack" });
await backgroundRows(rows, sweep, { prefix: "nopack" });
sweep.close();
rows.finish();
