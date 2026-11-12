// Builder sweep, part 1: every subclass the builder offers (the first half), filled at the level it is chosen and at 20.
// (scripts/lib/sweep-builder-fill.mjs says what each row is held to).
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openFillSweep } from "./lib/sweep-builder-fill.mjs";
import { backgroundRows, speciesRows, subclassRows } from "./lib/sweep-builder-fill-rows.mjs";
import * as known from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-fill-subclasses-a", { KNOWN: expand(known.KNOWN_FILL_SUBCLASSES_A ?? []), SKIP: known.SKIP_FILL_SUBCLASSES_A ?? {} });
const sweep = await openFillSweep();
await subclassRows(rows, sweep, { part: 0 });
sweep.close();
rows.finish();
