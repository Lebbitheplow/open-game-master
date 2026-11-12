// The clause ledger of the dark-fantasy classes (scripts/clauses/genre-dark-fantasy.json),
// played: scripts/lib/sweep-clauses-genre-a.mjs says what is walked and how,
// the probes are in sweep-clauses-genre-a-probes.mjs and -named.mjs, and the
// ledger's own gap clauses are the known gaps.
import { runLedger } from "./lib/sweep-clauses-genre-a.mjs";
import { PROBES } from "./lib/sweep-clauses-genre-a-probes.mjs";
import { NAMED } from "./lib/sweep-clauses-genre-a-named.mjs";
import { borrowedHooks } from "./lib/sweep-clauses-genre-a-borrowed.mjs";

await runLedger("dark-fantasy", { ...PROBES, ...NAMED }, [borrowedHooks]);
