// Builder sweep, part 1: every background the builder offers, and each skill a background leaves to its player.
// (scripts/lib/sweep-builder-fill.mjs says what each row is held to).
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openFillSweep } from "./lib/sweep-builder-fill.mjs";
import { backgroundRows, speciesRows, subclassRows } from "./lib/sweep-builder-fill-rows.mjs";
import * as known from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-fill-backgrounds", { KNOWN: expand(known.KNOWN_FILL_BACKGROUNDS ?? []), SKIP: known.SKIP_FILL_BACKGROUNDS ?? {} });
const sweep = await openFillSweep();
await backgroundRows(rows, sweep);
sweep.close();
rows.finish();
