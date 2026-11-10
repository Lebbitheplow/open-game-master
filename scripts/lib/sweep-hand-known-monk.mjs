// The rows of the Hand sweep that fail today: monk. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-monk": [
    ["P2|Way of the Ascendant Dragon@20|action-spent|feature:sub_breath_of_the_dragon", "hand-counter-cost-not-charged"],
    ["P2|Way of the Ascendant Dragon@20|action-spent|feature:sub_wings_unfurled", "hand-counter-cost-not-charged"],
    ["P3|*|*|feature:sub_breath_of_the_dragon", "hand-counter-dice-not-rolled"],
    ["P4|*|*|feature:sub_breath_of_the_dragon", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_wings_unfurled", "hand-counter-cost-not-charged"],
  ],
};
