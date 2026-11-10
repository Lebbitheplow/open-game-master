// The rows of the Hand sweep that fail today: barbarian. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-barbarian": [
    ["P1|*|*|feature:authored:fanatical-focus", "hand-reroll-no-failed-save"],
    ["P1|*|*|feature:authored:storm-aura", "hand-feature-precondition-open"],
    ["P1|*|raging|feature:rage", "hand-feature-precondition-open"],
    ["P2|*|grappled|basic:dash", "hand-dash-speed-0"],
    ["P2|Path of the Ancestral Guardian@20|action-spent|feature:sub_consult_the_spirits", "hand-counter-cost-not-charged"],
    ["P2|Path of the Beast@20|action-spent|feature:sub_infectious_fury", "hand-counter-cost-not-charged"],
    ["P3|*|*|feature:sub_infectious_fury", "hand-counter-dice-not-rolled"],
    ["P4|*|*|feature:sub_consult_the_spirits", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_infectious_fury", "hand-counter-cost-not-charged"],
    ["P5|*|*|basic:help", "hand-help-range"],
  ],
};
