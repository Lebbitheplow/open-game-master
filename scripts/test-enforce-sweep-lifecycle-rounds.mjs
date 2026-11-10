// Lifecycle sweep, part 1 (endings in a fight): a spell that lasts a round or
// a minute is there while its time runs and gone when it is over, whoever
// holds it, and a fight ending is no way to keep one.
//
// The table is the spell rows of scripts/lib/sweep-lifecycle-spells.mjs whose
// text prints a Duration of 1 round or 1 minute. Each is cast by the wizard
// on her turn (she is second in the order, after the fighter), at a dummy or
// on the fighter, and the order is walked with every save a 1:
//
//   lasts     a 1-minute spell is still there in its ninth round;
//   ends      it is gone, with the caster's concentration, two rounds past
//             its time (round 12 for a minute, round 3 for a round): the
//             slack is the engine's count at the round's turn, not the
//             caster's own turn;
//   fight end the fight ends and five minutes pass: nothing of it is left on
//             a hero.
//
// This file walks the spells laid on a hero; -rounds-foes.mjs the spells cast
// at a foe (the body of both: scripts/lib/sweep-lifecycle-rounds.mjs).
import "./lib/enforce-world.mjs";
import { runRounds } from "./lib/sweep-lifecycle-rounds.mjs";

await runRounds({
  name: "sweep-lifecycle-rounds",
  part: "buffs",
  // A row not walked, and why.
  SKIP: {
    "Feather Fall": "cast as a reaction to a fall: no door of this sweep stages one",
    Shapechange: "the caster herself becomes a beast; the polymorph suites hold its ending",
  },
  // One check of one row not made, and why.
  SUBSKIP: {},
  // Known today, by "Spell/check".
  KNOWN: {},
});
