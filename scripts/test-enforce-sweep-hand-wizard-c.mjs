// The Hand and the engine never disagree: every wizard (part 3 of 3 of its subclasses), every state,
// every card (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";

const NAME = "test-enforce-sweep-hand-wizard-c";
await sweepSuite(NAME, "wizard", KNOWN[NAME] ?? {}, { part: [2, 3] });
