// The clause ledger (scripts/clauses/divine.json), run for the artificer's
// specialists and the cleric, paladin and ranger features the other divine
// suites do not stage: every clause of those features that names this suite
// is a test (held) or a gap (the engine does not do what the words say). The
// scenes are in scripts/lib/sweep-clauses-divine-extra.mjs.
import { runClauseSuite } from "./lib/sweep-clauses-divine.mjs";
import { EXTRA } from "./lib/sweep-clauses-divine-extra.mjs";
import { RO_EXTRA } from "./lib/sweep-clauses-divine-ro-C-extra.mjs";

await runClauseSuite("test-enforce-sweep-clauses-divine-extra.mjs", { ...EXTRA, ...RO_EXTRA });
