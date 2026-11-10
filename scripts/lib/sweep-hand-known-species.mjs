// The rows of the Hand sweep that fail today: species. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-species": [
    ["P1|*|*|spell:thaumaturgy", "hand-silence-open"],
    ["P1|species drow|silenced|spell:faerie fire", "hand-silence-open"],
    ["P1|species goblin|fresh,action-spent,reaction-spent,silenced,foe-30ft,foe-100ft|basic:hide:bonus", "hand-hide-seen"],
    ["P1|species goblin|out-of-fight|basic:hide:bonus", "hand-hide-out-of-fight-retry"],
    ["P1|species tiefling|failed-save|spell:hellish rebuke", "hand-hellish-rebuke-save-damage"],
    ["P1|species tiefling|fresh,action-spent,bonus-spent|spell:hellish rebuke", "hand-reaction-no-trigger"],
    ["P1|species tiefling|silenced|spell:hellish rebuke", "hand-silence-open"],
    ["P5|species tiefling|foe-30ft|spell:hellish rebuke", "hand-reaction-no-trigger-aim"],
    ["P7|*|*|basic:ready:left", "hand-ready-attack-left"],
  ],
};
