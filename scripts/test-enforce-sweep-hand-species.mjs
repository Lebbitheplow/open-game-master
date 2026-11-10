// The Hand and the engine never disagree: a fighter of each species, and only
// the cards it deals or changes (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";
import { EXTRA_STATES, SPECIES_BASELINE, featBuilds, itemBuilds, speciesBuilds } from "./lib/sweep-hand-extras.mjs";

const builds = speciesBuilds();
const NAME = "test-enforce-sweep-hand-species";
await sweepSuite(NAME, "species", KNOWN[NAME] ?? {}, { builds, baseline: SPECIES_BASELINE, states: EXTRA_STATES });
