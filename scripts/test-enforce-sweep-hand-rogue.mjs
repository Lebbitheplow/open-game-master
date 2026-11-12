// The Hand and the engine never disagree: every rogue, every state,
// every card (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";

const NAME = "test-enforce-sweep-hand-rogue";
await sweepSuite(NAME, "rogue", KNOWN[NAME] ?? {});
