// The clause ledger (scripts/clauses/divine.json), run for the druid's
// circles (Moon, Dreams, Shepherd, Spores, Stars, Wildfire): every clause of
// those features that names this suite is a test (held) or a gap (the engine
// does not do what the words say). The scenes are in
// scripts/lib/sweep-clauses-divine-druid.mjs.
import { runClauseSuite } from "./lib/sweep-clauses-divine.mjs";
import { DRUID } from "./lib/sweep-clauses-divine-druid.mjs";

await runClauseSuite("test-enforce-sweep-clauses-divine-druid.mjs", DRUID);
