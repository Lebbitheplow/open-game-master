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
import { BORROWED_MARK, BORROWED_VARIANTS } from "@/lib/srd/borrowed-proficiency";

// The curse's name, as src/lib/dm/grave-curse.ts reads it (a dm module
// cannot be imported into the table).
const GRAVE_CURSE = "path to the grave";

const CHANNEL = { id: "channel_divinity" };

export const AUTHORED_DATA_W2_DIVINE: Record<string, AuthoredEntry> = {
  // "Gain proficiency with one skill or tool of your choice for 10 minutes."
  // The choice is the variant; the condition it lays is what the skill and
  // tool checks read (src/lib/srd/borrowed-proficiency.ts).
  "cleric::Channel Divinity: Knowledge of the Ages": {
    subclass: "Knowledge Domain",
    spends: [{ name: "Knowledge of the Ages", pool: CHANNEL, action: "action", does: { kind: "buff", condition: BORROWED_MARK, variants: BORROWED_VARIANTS, rounds: 100 } }],
  },
  // "An action curses a creature within 30 feet until the end of your next
  // turn: the next attack hit against it, it has vulnerability to all of that
  // attack's damage" (src/lib/dm/grave-curse.ts reads the curse).
  "cleric::Channel Divinity: Path to the Grave": {
    subclass: "Grave Domain",
    spends: [{ name: "Path to the Grave", pool: CHANNEL, action: "action", does: { kind: "buff", target: "enemy", condition: GRAVE_CURSE, rounds: 2, untilNextTurnEnds: true, rangeFt: 30 } }],
  },
  // "After a Divine Smite, hand out temporary hit points of 2d8 + paladin
  // level split among creatures within 30 feet": a bonus action.
  "paladin::Channel Divinity: Inspiring Smite": {
    subclass: "Oath of Glory",
    spends: [{ name: "Inspiring Smite", pool: CHANNEL, action: "bonus", does: { kind: "smite_temp_hp", formula: (level) => `2d8+${level}`, rangeFt: 30 } }],
  },
  // "An action reveals a creature's damage immunities, resistances and
  // vulnerabilities, a Wisdom-modifier number of times per long rest."
  "ranger::Hunter's Sense": {
    subclass: "Monster Slayer",
    counter: "sub_hunters_sense",
    spends: [{ name: "Hunter's Sense", pool: { id: "sub_hunters_sense" }, action: "action", does: { kind: "reveal_defenses", sight: true } }],
  },
};
