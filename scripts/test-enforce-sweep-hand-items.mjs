// The Hand and the engine never disagree: a wizard with each item that casts a spell, each scroll and a Ring of Spell Storing, and only
// the cards it deals or changes (scripts/lib/sweep-hand-run.mjs has the properties).
import "./lib/enforce-world.mjs";
import { sweepSuite } from "./lib/sweep-hand-run.mjs";
import { KNOWN } from "./lib/sweep-hand-known.mjs";
import { EXTRA_STATES, ITEM_BASELINE, featBuilds, itemBuilds, speciesBuilds } from "./lib/sweep-hand-extras.mjs";

const builds = await itemBuilds();
if (itemBuilds.unreached.length) console.log(`  SKIP ${itemBuilds.unreached.length} item rows whose pattern this suite could not turn into a name: ${itemBuilds.unreached.join("; ")}`);
const NAME = "test-enforce-sweep-hand-items";
await sweepSuite(NAME, "items", KNOWN[NAME] ?? {}, { builds, baseline: ITEM_BASELINE, states: EXTRA_STATES });
