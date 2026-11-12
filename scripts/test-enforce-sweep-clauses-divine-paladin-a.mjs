// The clause ledger (scripts/clauses/divine.json), run for the paladin's
// Oaths of the Ancients, Vengeance, Conquest and Redemption: every clause of
// those features that names this suite is a test (held) or a gap (the engine
// does not do what the words say). The scenes are in
// scripts/lib/sweep-clauses-divine-paladin-a.mjs.
import { runClauseSuite } from "./lib/sweep-clauses-divine.mjs";
import { PALADIN_A } from "./lib/sweep-clauses-divine-paladin-a.mjs";
import { RO_PALADIN_A } from "./lib/sweep-clauses-divine-ro-A.mjs";

await runClauseSuite("test-enforce-sweep-clauses-divine-paladin-a.mjs", { ...PALADIN_A, ...RO_PALADIN_A });
