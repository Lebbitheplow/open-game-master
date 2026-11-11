// The rogue clauses the engine does not hold today, by probe id
// (scripts/test-enforce-sweep-clauses-martial-rogue.mjs).
const ROWS2 = "src/lib/srd/authored-effects-data2.ts";
const ROWS4 = "src/lib/srd/authored-effects-data4.ts";

export const KNOWN = {
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
};

export const SKIP = {};
