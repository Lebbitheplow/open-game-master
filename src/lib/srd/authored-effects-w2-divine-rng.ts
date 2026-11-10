// The ranger archetype rows the gap study's second wave built for the divine
// ledger (scripts/clauses/divine.json): features whose words state a number
// the engine now plays. Resolved by the readers each effect kind names
// (src/lib/srd/authored-coverage.ts).
//
// Only keys no other table holds: AUTHORED_TABLE spreads the tables into one,
// so a key repeated here would replace the older row whole.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_W2_DIVINE_RNG: Record<string, AuthoredEntry> = {
  // "Add your Wisdom modifier to Charisma checks" (the skill it trains is
  // src/lib/srd/subclass-training.ts's).
  "ranger::Otherworldly Glamour": {
    subclass: "Fey Wanderer",
    effects: [{ kind: "check_ability_mod", checks: ["cha"], ability: "wis" }],
  },
  // "Cast etherealness as a bonus action for one turn, once per short or
  // long rest" (src/lib/dm/authored-spend-divine-rng.ts thisTurn).
  // "A bonus action grants a 10-foot flying speed for a minute": the
  // counter lays "flying (writhing tide)" (authored-resources.json), which the
  // board flies at 10 feet (src/lib/battlemap/types.ts flyingSpeedOf) and the
  // derived speeds read here.
  "ranger::Writhing Tide": {
    subclass: "Swarmkeeper",
    effects: [{ kind: "move", fly: 10, gate: { condition: "flying (writhing tide)" } }],
  },
  "ranger::Ethereal Step": {
    subclass: "Horizon Walker",
    counter: "sub_ethereal_step",
    spends: [{ name: "Ethereal Step", pool: { id: "sub_ethereal_step" }, action: "bonus", does: { kind: "this_turn", condition: "ethereal" } }],
  },
};
