// The rows of the Hand sweep that fail today: feats. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-feats-a": [
    ["P1|feat Lucky|fresh,action-spent,bonus-spent,silenced,foe-30ft,foe-100ft,out-of-fight,failed-save|feature:luck_points", "hand-reaction-no-trigger"],
    ["P2|feat Inspiring Leader|action-spent|feature:inspiring_leader", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:inspiring_leader", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:luck_points", "hand-counter-cost-not-charged"],
  ],
  "test-enforce-sweep-hand-feats-b": [
  ],
};
