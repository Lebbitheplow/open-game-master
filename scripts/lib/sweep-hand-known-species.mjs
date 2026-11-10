// The rows of the Hand sweep that fail today: species. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-species": [
    ["P1|*|*|spell:thaumaturgy", "hand-silence-open"],
    ["P1|species drow|silenced|spell:faerie fire", "hand-silence-open"],
    ["P1|species goblin|fresh,action-spent,reaction-spent,silenced,foe-30ft,foe-100ft|basic:hide:bonus", "hand-hide-seen"],
    ["P1|species goblin|out-of-fight|basic:hide:bonus", "hand-hide-out-of-fight-retry"],
    ["P2|*|action-spent|feature:race_genasi_magic", "hand-counter-cost-not-charged"],
    ["P2|species changeling|action-spent|feature:sub_shapechanger", "hand-counter-cost-not-charged"],
    ["P2|species firbolg|action-spent|feature:race_firbolg_magic", "hand-counter-cost-not-charged"],
    ["P2|species goblin|action-spent|feature:race_fury_of_the_small", "hand-counter-cost-not-charged"],
    ["P3|*|*|feature:breath_weapon", "hand-counter-dice-not-rolled"],
    ["P4|*|*|feature:race_firbolg_magic", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:race_fury_of_the_small", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:race_genasi_magic", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_shapechanger", "hand-counter-cost-not-charged"],
    ["P7|*|*|basic:ready:left", "hand-ready-attack-left"],
  ],
};
