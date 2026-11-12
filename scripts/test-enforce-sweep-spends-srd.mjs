// The "spends" sweep over the counters of the SRD classes themselves, the species and the feats.
// scripts/lib/sweep-spends.mjs says what is walked and how; the codes and the
// file each points at are in scripts/lib/sweep-spends-run.mjs; what is seen
// today, row by row, is in scripts/lib/sweep-spends-known.mjs.
import { runSweep } from "./lib/sweep-spends-run.mjs";

await runSweep("srd");
