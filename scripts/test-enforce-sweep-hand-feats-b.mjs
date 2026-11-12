// The Hand and the engine never disagree: a fighter with each feat, and only
// the cards it deals or changes (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";
import { EXTRA_STATES, FEAT_BASELINE, featBuilds, itemBuilds, speciesBuilds } from "./lib/sweep-hand-extras.mjs";

const all = featBuilds();
const builds = all.slice(Math.ceil(all.length / 2));
const NAME = "test-enforce-sweep-hand-feats-b";
await sweepSuite(NAME, "feats", KNOWN[NAME] ?? {}, { builds, baseline: FEAT_BASELINE, states: EXTRA_STATES });
