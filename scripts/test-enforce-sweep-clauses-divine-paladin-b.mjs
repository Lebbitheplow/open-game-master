// The clause ledger (scripts/clauses/divine.json), run for the paladin's
// Oaths of Glory, the Watchers and the Crown, and the Oathbreaker: every
// clause of those features that names this suite is a test (held) or a gap
// (the engine does not do what the words say). The scenes are in
// scripts/lib/sweep-clauses-divine-paladin-b.mjs.
import { runClauseSuite } from "./lib/sweep-clauses-divine.mjs";
import { PALADIN_B } from "./lib/sweep-clauses-divine-paladin-b.mjs";
import { RO_PALADIN_B } from "./lib/sweep-clauses-divine-ro-A-b.mjs";

await runClauseSuite("test-enforce-sweep-clauses-divine-paladin-b.mjs", { ...PALADIN_B, ...RO_PALADIN_B });
