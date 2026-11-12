// The "spends" sweep over the authored spends: every use_resource the subclass layer resolves.
// scripts/lib/sweep-spends.mjs says what is walked and how; the codes and the
// file each points at are in scripts/lib/sweep-spends-run.mjs; what is seen
// today, row by row, is in scripts/lib/sweep-spends-known.mjs.
import { runSweep } from "./lib/sweep-spends-run.mjs";

await runSweep("authored");
