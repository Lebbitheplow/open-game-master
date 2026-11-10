// The rows of the Hand sweep that fail today: monk. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-monk": [
    ["P1|*|fresh,bonus-spent,reaction-spent,prone,grappled,blinded,silenced,no-free-hand,foe-30ft,foe-100ft,foe-invisible|basic:hide", "hand-hide-seen"],
    ["P1|*|no-free-hand|basic:grapple", "hand-grapple-no-free-hand"],
    ["P1|*|out-of-fight|basic:hide", "hand-hide-out-of-fight-retry"],
    ["P2|*|grappled|basic:dash", "hand-dash-speed-0"],
    ["P2|*|grappled|basic:dash:bonus", "hand-dash-speed-0"],
    ["P2|Way of the Ascendant Dragon@20|action-spent|feature:sub_breath_of_the_dragon", "hand-counter-cost-not-charged"],
    ["P2|Way of the Ascendant Dragon@20|action-spent|feature:sub_wings_unfurled", "hand-counter-cost-not-charged"],
    ["P3|*|*|feature:sub_breath_of_the_dragon", "hand-counter-dice-not-rolled"],
    ["P4|*|*|feature:sub_breath_of_the_dragon", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_wings_unfurled", "hand-counter-cost-not-charged"],
    ["P5|*|*|basic:help", "hand-help-range"],
    ["P5|*|foe-30ft|attack:dagger", "hand-thrown-long-range"],
    ["P6|*|foe-30ft|attack:dagger", "hand-thrown-long-range"],
    ["P7|*|*|basic:ready:left", "hand-ready-attack-left"],
  ],
};
