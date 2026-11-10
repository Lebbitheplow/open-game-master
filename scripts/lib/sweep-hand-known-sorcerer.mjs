// The rows of the Hand sweep that fail today: sorcerer. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-sorcerer-a": [
    ["P1|*|*|feature:sub_unearthly_recovery", "hand-feature-precondition-open"],
    ["P1|Draconic Bloodline@20|out-of-fight|feature:draconic_presence", "hand-fight-only-open-out-of-fight"],
    ["P7|*|*|resource:sub_favored_by_the_gods", "hand-no-card-after-roll-counters"],
  ],
  "test-enforce-sweep-hand-sorcerer-b": [
    ["P2|Lunar Sorcery@20|action-spent|feature:sub_lunar_boons", "hand-counter-cost-not-charged"],
    ["P2|Lunar Sorcery@20|action-spent|feature:sub_lunar_free_cast", "hand-counter-cost-not-charged"],
    ["P2|Lunar Sorcery@20|bonus-spent|feature:sub_waxing_and_waning", "hand-counter-cost-not-charged"],
    ["P3|*|*|feature:sub_warping_implosion", "hand-counter-dice-not-rolled"],
    ["P4|*|*|feature:sub_lunar_boons", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_lunar_free_cast", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_waxing_and_waning", "hand-counter-cost-not-charged"],
  ],
};
