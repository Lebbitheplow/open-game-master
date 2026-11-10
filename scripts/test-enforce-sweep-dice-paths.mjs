// Gap sweep, package `dice`, part 2: one attack, every dice path.
//
// scripts/test-enforce-real-dice-parity.mjs lists a dozen rules by hand and
// runs each on the server's dice and on entered dice. This suite generates
// the list from the tables the engine already has, and runs each row on four
// paths with the same faces on the dice:
//
//   server    the seat is on the server's dice: pc_attack throws everything
//   entered   physical dice: the to-hit and the damage are typed on the cards
//   digital   physical dice, and "Roll digitally" pressed on each card
//   held      "hold my rolls": each card is let go and the server throws it
//
// The rows: every feat (src/lib/srd/authored-feats.json) on four weapons,
// every SRD weapon, every Battle Master maneuver (src/lib/srd/options.ts),
// every attack-roll spell the spell tables know, and the options of the
// pc_attack form, each on a hit, a critical and a miss. The property: the
// table is left the same on all four paths (the creature, the attacker's
// sheet, the turn's marks and budget, the turn's record of the swing). Rows
// that differ today are in KNOWN.
//
// The faces: every d20 a character throws shows the row's face, every d20 a
// creature throws shows 1 (so a rider's save fails and its condition lands),
// and every other die shows 3. A reroll therefore rerolls into the same
// face: what this suite sees is how MANY dice a path asks for, which numbers
// it adds, and what it does around them, not which die a feat rerolls (the
// hand-listed suite holds those).
import { runPaths } from "./lib/sweep-dice-paths.mjs";

await runPaths("test-enforce-sweep-dice-paths", ["weapon", "maneuver", "spell", "option"]);
