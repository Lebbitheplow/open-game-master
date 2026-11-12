// The Hand and the engine never disagree: every cleric (part 4 of 4 of its subclasses), every state,
// every card (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";

const NAME = "test-enforce-sweep-hand-cleric-d";
await sweepSuite(NAME, "cleric", KNOWN[NAME] ?? {}, { part: [3, 4] });
