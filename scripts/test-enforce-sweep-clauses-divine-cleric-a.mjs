// The clause ledger (scripts/clauses/divine.json), run for the cleric's
// Knowledge, Light, Nature, Tempest, Trickery, War and Death domains: every
// clause of those features that names this suite is a test (held) or a gap
// (the engine does not do what the words say). The scenes are in
// scripts/lib/sweep-clauses-divine-cleric-a.mjs.
import { runClauseSuite } from "./lib/sweep-clauses-divine.mjs";
import { CLERIC_A } from "./lib/sweep-clauses-divine-cleric-a.mjs";
import { RO_CLERIC_A } from "./lib/sweep-clauses-divine-ro-C.mjs";

await runClauseSuite("test-enforce-sweep-clauses-divine-cleric-a.mjs", { ...CLERIC_A, ...RO_CLERIC_A });
