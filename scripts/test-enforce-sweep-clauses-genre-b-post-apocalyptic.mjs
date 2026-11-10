// The clause ledger of the post-apocalyptic classes (scripts/clauses/genre-post-apocalyptic.json), run:
// every sentence of every class and subclass feature in
// src/lib/classes/post-apocalyptic-features.json, held by a probe, recorded as a gap, or
// left to the GM with the reason written. scripts/lib/sweep-clauses-genre-b.mjs
// says how the ledger is walked; scripts/lib/sweep-clauses-genre-b-probes.mjs
// holds the probes.
import { runLedger } from "./lib/sweep-clauses-genre-b.mjs";

await runLedger("post-apocalyptic");
