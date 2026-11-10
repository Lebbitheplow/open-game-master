// The rows of the Hand sweep that fail today: bard. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-bard-a": [
    ["P1|*|fresh,bonus-spent,reaction-spent,prone,grappled,blinded,darkness,concentrating,foe-invisible,out-of-fight|spell:polymorph", "hand-polymorph-no-form"],
    ["P1|College of Swords@20|fresh,action-spent,bonus-spent,reaction-spent,prone,grappled,blinded,darkness,silenced,no-free-hand,concentrating,foe-30ft,foe-100ft,foe-invisible|feature:authored:blade-flourish", "hand-feature-needs-target"],
    ["P1|College of Swords@20|out-of-fight|feature:authored:blade-flourish", "hand-fight-only-open-out-of-fight"],
    ["P2|College of Glamour@20|action-spent|feature:sub_enthralling_performance", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_enthralling_performance", "hand-counter-cost-not-charged"],
    ["P5|*|*|feature:bardic_inspiration:self", "hand-self-chip-other-than-you"],
    ["P5|*|*|spell:polymorph:self", "hand-polymorph-no-form"],
    ["P5|*|foe-30ft|spell:polymorph", "hand-polymorph-no-form"],
  ],
  "test-enforce-sweep-hand-bard-b": [
    ["P1|*|fresh,bonus-spent,reaction-spent,prone,grappled,blinded,darkness,concentrating,foe-invisible,out-of-fight|spell:polymorph", "hand-polymorph-no-form"],
    ["P1|College of Eloquence@20|out-of-fight|feature:sub_infectious_inspiration", "hand-reaction-no-trigger"],
    ["P2|College of Spirits@20|action-spent|feature:sub_spirit_session", "hand-counter-cost-not-charged"],
    ["P2|College of Whispers@20|action-spent|feature:sub_words_of_terror", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_spirit_session", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_words_of_terror", "hand-counter-cost-not-charged"],
    ["P5|*|*|feature:bardic_inspiration:self", "hand-self-chip-other-than-you"],
    ["P5|*|*|spell:polymorph:self", "hand-polymorph-no-form"],
    ["P5|*|foe-30ft|spell:polymorph", "hand-polymorph-no-form"],
  ],
};
