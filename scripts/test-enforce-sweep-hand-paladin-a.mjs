// The Hand and the engine never disagree: every paladin (part 1 of 2 of its subclasses), every state,
// every card (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";

const NAME = "test-enforce-sweep-hand-paladin-a";
await sweepSuite(NAME, "paladin", KNOWN[NAME] ?? {}, { part: [0, 2] });
