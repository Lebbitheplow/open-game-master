// The clause ledger (scripts/clauses/divine.json), run for the ranger's
// archetypes (Beast Master, Gloom Stalker, Horizon Walker, Monster Slayer,
// Fey Wanderer, Swarmkeeper, Drakewarden): every clause of those features
// that names this suite is a test (held) or a gap (the engine does not do
// what the words say). The scenes are in
// scripts/lib/sweep-clauses-divine-ranger.mjs.
import { runClauseSuite } from "./lib/sweep-clauses-divine.mjs";
import { RANGER } from "./lib/sweep-clauses-divine-ranger.mjs";
import { RO_RANGER_B } from "./lib/sweep-clauses-divine-ro-B-ranger.mjs";

await runClauseSuite("test-enforce-sweep-clauses-divine-ranger.mjs", { ...RANGER, ...RO_RANGER_B });
