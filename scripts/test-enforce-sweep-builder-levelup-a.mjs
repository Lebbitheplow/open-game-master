// Builder sweep, part 2: every class and subclass the builder offers with the content pack (part 1 of 4).
// Each is grown from level 1 to 20 through the level-up's own offer and
// PATCH, and set beside the same character made at 20
// (scripts/lib/sweep-builder-levelup.mjs says what a row is held to).
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openLevelSweep } from "./lib/sweep-builder-levelup.mjs";
import { levelRows } from "./lib/sweep-builder-levelup-rows.mjs";
import * as known from "./lib/sweep-builder-known-levelup.mjs";

const rows = sweepRows("test-enforce-sweep-builder-levelup-a", { KNOWN: expand(known.KNOWN_LEVELUP_A ?? []), SKIP: known.SKIP_LEVELUP_A ?? {} });
const sweep = await openLevelSweep();
await levelRows(rows, sweep, { part: 0, parts: 4 });
sweep.close();
rows.finish();
