// Gap sweep, package `dice`, part 2, the feats: every feat of
// src/lib/srd/authored-feats.json on a heavy blade, a finesse blade, a hammer
// and a bow, each on a hit, a critical and a miss, on the four dice paths
// scripts/test-enforce-sweep-dice-paths.mjs describes.
import { runPaths } from "./lib/sweep-dice-paths.mjs";

await runPaths("test-enforce-sweep-dice-paths-feats", ["feat"]);
