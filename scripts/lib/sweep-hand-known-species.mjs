// The rows of the Hand sweep that fail today: species. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-species": [
    ["P1|species tiefling|failed-save|spell:hellish rebuke", "hand-hellish-rebuke-save-damage"],
    ["P1|species tiefling|fresh,action-spent,bonus-spent|spell:hellish rebuke", "hand-reaction-no-trigger"],
    ["P2|*|action-spent|feature:race_genasi_magic", "hand-counter-cost-not-charged"],
    ["P2|species changeling|action-spent|feature:sub_shapechanger", "hand-counter-cost-not-charged"],
    ["P2|species firbolg|action-spent|feature:race_firbolg_magic", "hand-counter-cost-not-charged"],
    ["P2|species goblin|action-spent|feature:race_fury_of_the_small", "hand-counter-cost-not-charged"],
    ["P3|*|*|feature:breath_weapon", "hand-counter-dice-not-rolled"],
    ["P4|*|*|feature:race_firbolg_magic", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:race_fury_of_the_small", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:race_genasi_magic", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_shapechanger", "hand-counter-cost-not-charged"],
    ["P5|species tiefling|foe-30ft|spell:hellish rebuke", "hand-reaction-no-trigger-aim"],
  ],
};
