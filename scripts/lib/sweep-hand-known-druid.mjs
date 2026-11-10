// The rows of the Hand sweep that fail today: druid. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-druid-a": [
    ["P1|*|*|feature:wild_shape", "hand-wild-shape-no-form"],
    ["P2|Circle of Dreams@20|action-spent|feature:sub_walker_in_dreams", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_walker_in_dreams", "hand-counter-cost-not-charged"],
  ],
  "test-enforce-sweep-hand-druid-b": [
    ["P1|*|*|feature:wild_shape", "hand-wild-shape-no-form"],
    ["P1|Circle of Wildfire@20|out-of-fight|feature:sub_cauterizing_flames:heal", "hand-reaction-no-trigger"],
    ["P2|Circle of Stars@20|action-spent|feature:sub_star_map", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_star_map", "hand-counter-cost-not-charged"],
  ],
};
