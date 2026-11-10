// The cleric, paladin, druid, ranger and artificer subclass rows the gap
// study's second wave built (scripts/clauses/divine.json): each one a feature
// whose words state a number, a save, a refusal or who is affected, and whose
// spend before this moved its counter and left the rest to the GM. Resolved
// by src/lib/dm/authored-spend-effects.ts like every authored spend; a kind of
// this package's own lives in src/lib/dm/authored-spend-divine.ts.
//
// Only keys no other table holds: AUTHORED_TABLE spreads the tables into one,
// so a key repeated here would replace the older row whole.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_W2_DIVINE: Record<string, AuthoredEntry> = {
  // "An action reveals a creature's damage immunities, resistances and
  // vulnerabilities, a Wisdom-modifier number of times per long rest."
  "ranger::Hunter's Sense": {
    subclass: "Monster Slayer",
    counter: "sub_hunters_sense",
    spends: [{ name: "Hunter's Sense", pool: { id: "sub_hunters_sense" }, action: "action", does: { kind: "reveal_defenses", sight: true } }],
  },
};
