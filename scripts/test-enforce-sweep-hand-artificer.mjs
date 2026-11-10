// The Hand and the engine never disagree: every artificer, every state,
// every card (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";

const NAME = "test-enforce-sweep-hand-artificer";
await sweepSuite(NAME, "artificer", KNOWN[NAME] ?? {});
