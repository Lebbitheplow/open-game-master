// The clause ledger (scripts/clauses/divine.json), run for the cleric's
// Forge, Grave, Order, Peace, Twilight and Arcana domains: every clause of
// those features that names this suite is a test (held) or a gap (the engine
// does not do what the words say). The scenes are in
// scripts/lib/sweep-clauses-divine-cleric-b.mjs.
import { runClauseSuite } from "./lib/sweep-clauses-divine.mjs";
import { CLERIC_B } from "./lib/sweep-clauses-divine-cleric-b.mjs";
import { RO_CLERIC_B } from "./lib/sweep-clauses-divine-ro-C-b.mjs";

await runClauseSuite("test-enforce-sweep-clauses-divine-cleric-b.mjs", { ...CLERIC_B, ...RO_CLERIC_B });
