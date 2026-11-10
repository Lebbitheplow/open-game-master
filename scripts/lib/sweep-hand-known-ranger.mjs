// The rows of the Hand sweep that fail today: ranger. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-ranger-a": [
  ],
  "test-enforce-sweep-hand-ranger-b": [
    ["P1|*|*|feature:sub_reflexive_resistance", "hand-reaction-no-trigger"],
    ["P1|Monster Slayer@20|out-of-fight|feature:sub_magic_users_nemesis", "hand-reaction-no-trigger"],
    ["P1|Swarmkeeper@20|fresh,action-spent,bonus-spent,reaction-spent,prone,grappled,blinded,darkness,silenced,no-free-hand,concentrating,foe-30ft,foe-100ft,foe-invisible|feature:authored:gathered-swarm", "hand-feature-needs-target"],
    ["P1|Swarmkeeper@20|out-of-fight|feature:authored:gathered-swarm", "hand-fight-only-open-out-of-fight"],
    ["P2|Fey Wanderer@20|action-spent|feature:sub_fey_reinforcements", "hand-counter-cost-not-charged"],
    ["P2|Fey Wanderer@20|action-spent|feature:sub_misty_wanderer", "hand-counter-cost-not-charged"],
    ["P3|*|*|feature:sub_drakes_breath", "hand-counter-dice-not-rolled"],
    ["P4|*|*|feature:sub_fey_reinforcements", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_misty_wanderer", "hand-counter-cost-not-charged"],
  ],
};
