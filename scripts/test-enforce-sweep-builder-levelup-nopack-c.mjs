// Builder sweep, part 2: every bundled class and subclass on a server without the content pack (part 3 of 3).
// Each is grown from level 1 to 20 through the level-up's own offer and
// PATCH, and set beside the same character made at 20
// (scripts/lib/sweep-builder-levelup.mjs says what a row is held to).
import "./lib/sweep-builder-nopack.mjs";
import "./lib/enforce-world.mjs";
import { expand, sweepRows } from "./lib/sweep-builder-rows.mjs";
import { openLevelSweep } from "./lib/sweep-builder-levelup.mjs";
import { levelRows } from "./lib/sweep-builder-levelup-rows.mjs";
import * as known from "./lib/sweep-builder-known-levelup.mjs";

const rows = sweepRows("test-enforce-sweep-builder-levelup-nopack-c", { KNOWN: expand(known.KNOWN_LEVELUP_NOPACK_C ?? []), SKIP: known.SKIP_LEVELUP_NOPACK_C ?? {} });
const sweep = await openLevelSweep();
await levelRows(rows, sweep, { prefix: "nopack-levelup", part: 2, parts: 3 });
sweep.close();
rows.finish();
