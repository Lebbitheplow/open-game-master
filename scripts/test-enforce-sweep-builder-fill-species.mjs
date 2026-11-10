// Builder sweep, part 1: every species the builder offers, under a martial class at 1 and a caster at 5, and each option a species leaves to its player.
// (scripts/lib/sweep-builder-fill.mjs says what each row is held to).
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openFillSweep } from "./lib/sweep-builder-fill.mjs";
import { backgroundRows, speciesRows, subclassRows } from "./lib/sweep-builder-fill-rows.mjs";
import * as known from "./lib/sweep-builder-known.mjs";

const rows = sweepRows("test-enforce-sweep-builder-fill-species", { KNOWN: expand(known.KNOWN_FILL_SPECIES ?? []), SKIP: known.SKIP_FILL_SPECIES ?? {} });
const sweep = await openFillSweep();
await speciesRows(rows, sweep);
sweep.close();
rows.finish();
