// The Hand and the engine never disagree: every bard (part 1 of 2 of its subclasses), every state,
// every card (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";

const NAME = "test-enforce-sweep-hand-bard-a";
await sweepSuite(NAME, "bard", KNOWN[NAME] ?? {}, { part: [0, 2] });
