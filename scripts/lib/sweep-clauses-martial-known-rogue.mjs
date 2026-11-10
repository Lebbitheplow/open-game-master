// The rogue clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-rogue.mjs).
const ROWS2 = "src/lib/srd/authored-effects-data2.ts";
const ROWS4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
  "death-strike-double": {
    severity: "high", kind: "rule-missing",
    where: `${ROWS4} rogue::Death Strike (narrated: "A hit on a surprised creature: it makes a Constitution save (DC 8 + Dexterity + proficiency) or takes double damage, which the GM applies after the hit.")`,
    note: "A 17th-level Assassin's critical hit on a surprised creature deals 43 and nothing more: no save is rolled and nothing is doubled. The capstone of the subclass is a sentence for the GM.",
    fix: "On a hit against a creature in surprisedIds, roll its CON save against 8 + DEX + proficiency and double the hit's damage on a failure (src/lib/dm/pc-attack-damage.ts).",
    files: ["src/lib/dm/pc-attack-damage.ts", ROWS4],
  },
  "fancy-footwork": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS4} rogue::Fancy Footwork (narrated: "A creature the rogue attacked in melee this turn makes no opportunity attack against them: the GM withholds it.")`,
    note: "The creature the swashbuckler just attacked takes its opportunity attack as they walk away on the board.",
    fix: "Record melee targets of the turn; the opportunity attack check (move route) skips them for a holder.",
    files: ["src/lib/dm/opportunity-attacks.ts", ROWS4],
  },
  "ear-for-deceit-lies-only": {
    severity: "low", kind: "rule-wrong",
    where: `${ROWS2} rogue::Ear for Deceit (fx check_floor, note: "Only on an Insight check to tell whether a creature lies; the GM keeps to that.")`,
    note: "Every Insight check is floored at 8, reading a crowd's mood as much as a lie; request_roll's about has no value for a lie, so the GM cannot say which.",
    fix: "An about value for telling a lie, and the floor gated on it.",
    files: [ROWS2, "src/lib/dm/roll-tools.ts"],
  },
  "steady-eye-half-speed": {
    severity: "low", kind: "rule-wrong",
    where: `${ROWS2} rogue::Steady Eye (fx check_adv, note: "The engine does not measure the half-speed move; the GM withholds it after a longer one.")`,
    note: "After walking its whole 30 feet the rogue's Perception check is still rolled with advantage.",
    fix: "Gate the advantage on the token's movedThisRound at most half the speed.",
    files: [ROWS2, "src/lib/dm/roll-tools.ts"],
  },
  "sudden-strike-second-sneak": {
    severity: "medium", kind: "rule-missing",
    where: `${ROWS2} rogue::Sudden Strike (fx bonus_attack, note: "A second Sneak Attack on another creature is the GM's to allow.")`,
    note: "The bonus-action hit on a second creature, an ally beside it, carries no Sneak Attack dice.",
    fix: "Allow Sneak Attack twice a turn for a holder, the second against a different creature (src/lib/dm/pc-attack-damage.ts).",
    files: ["src/lib/dm/pc-attack-damage.ts", ROWS2],
  },
};

export const SKIP = {};
