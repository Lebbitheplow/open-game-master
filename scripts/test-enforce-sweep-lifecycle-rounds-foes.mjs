// Lifecycle sweep, part 1 (endings in a fight), the spells cast at a foe: see
// scripts/test-enforce-sweep-lifecycle-rounds.mjs for the checks, and
// scripts/lib/sweep-lifecycle-rounds.mjs for their body.
//
// Here the fighter stands beside the foe, so a spell that lays an area
// (Web, Entangle, Black Tentacles) catches the fighter as their turn begins:
// "ends" and "fight end" also ask that what the area laid on the fighter is
// gone once the spell is.
import { hasPack } from "./lib/enforce-world.mjs";
import { runRounds } from "./lib/sweep-lifecycle-rounds.mjs";

await runRounds({
  name: "sweep-lifecycle-rounds-foes",
  part: "foes",
  SKIP: {},
  SUBSKIP: {
    "Flesh to Stone/lasts": "three failed saves turn the creature to stone inside the minute, by the spell's text: the restraint is replaced, not kept",
  },
  // Without the content pack Ravenous Void (an authored spell) keeps no
  // duration: the engine reads it from the pack's record of the spell, so
  // neither its concentration nor what it laid ends on time. With the pack
  // both do (scripts/test-enforce-sweep-lifecycle-conc.mjs records the same).
  KNOWN: hasPack
    ? {}
    : Object.fromEntries(["Ravenous Void/ends", "Ravenous Void/fight end"].map((id) => [id, {
        where: "the authored spell's duration is read from the pack's spell record, which a server with no pack does not have",
        severity: "low",
        note: "Only a server with no content pack: the apps and the Docker image carry it.",
      }])),
});
