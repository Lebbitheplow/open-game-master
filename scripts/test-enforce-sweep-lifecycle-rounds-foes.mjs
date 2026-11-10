// Lifecycle sweep, part 1 (endings in a fight), the spells cast at a foe: see
// scripts/test-enforce-sweep-lifecycle-rounds.mjs for the checks, and
// scripts/lib/sweep-lifecycle-rounds.mjs for their body.
//
// Here the fighter stands beside the foe, so a spell that lays an area
// (Web, Entangle, Black Tentacles) catches the fighter as their turn begins:
// "ends" and "fight end" also ask that what the area laid on the fighter is
// gone once the spell is.
import "./lib/enforce-world.mjs";
import { runRounds } from "./lib/sweep-lifecycle-rounds.mjs";

await runRounds({
  name: "sweep-lifecycle-rounds-foes",
  part: "foes",
  SKIP: {},
  SUBSKIP: {
    "Flesh to Stone/lasts": "three failed saves turn the creature to stone inside the minute, by the spell's text: the restraint is replaced, not kept",
  },
  KNOWN: {},
});
