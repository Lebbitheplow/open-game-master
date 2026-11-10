// The rows of the Hand sweep that fail today: cleric. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-cleric-a": [
    ["P1|*|foe-100ft|option:channel_divinity:turn-undead", "hand-feature-nobody-in-reach"],
    ["P1|*|out-of-fight|option:channel_divinity:turn-undead", "hand-fight-only-open-out-of-fight"],
    ["P1|Life Domain@20|foe-100ft|option:channel_divinity:preserve-life", "hand-feature-nobody-in-reach"],
    ["P1|Light Domain@20|foe-100ft|feature:authored:radiance-of-the-dawn", "hand-feature-nobody-in-reach"],
    ["P1|Nature Domain@20|foe-100ft|feature:authored:charm-animals-and-plants", "hand-feature-nobody-in-reach"],
    ["P2|Knowledge Domain@20|action-spent|feature:sub_visions_of_the_past", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_visions_of_the_past", "hand-counter-cost-not-charged"],
  ],
  "test-enforce-sweep-hand-cleric-b": [
    ["P1|*|foe-100ft|option:channel_divinity:turn-undead", "hand-feature-nobody-in-reach"],
    ["P1|*|out-of-fight|option:channel_divinity:turn-undead", "hand-fight-only-open-out-of-fight"],
    ["P1|Trickery Domain@20|fresh,bonus-spent,reaction-spent,prone,grappled,blinded,darkness,no-free-hand,concentrating,foe-invisible,out-of-fight|spell:polymorph", "hand-polymorph-no-form"],
    ["P5|*|*|spell:polymorph:self", "hand-polymorph-no-form"],
    ["P5|Trickery Domain@20|foe-30ft|spell:polymorph", "hand-polymorph-no-form"],
  ],
  "test-enforce-sweep-hand-cleric-c": [
    ["P1|*|foe-100ft|option:channel_divinity:turn-undead", "hand-feature-nobody-in-reach"],
    ["P1|*|out-of-fight|option:channel_divinity:turn-undead", "hand-fight-only-open-out-of-fight"],
    ["P1|Order Domain@20|fresh,prone,grappled,blinded,darkness,silenced,no-free-hand,foe-30ft,foe-100ft,foe-invisible,out-of-fight|feature:sub_embodiment_of_the_law", "hand-feature-precondition-open"],
    ["P1|Peace Domain@20|foe-100ft|feature:authored:balm-of-peace", "hand-feature-nobody-in-reach"],
    ["P2|Order Domain@20|bonus-spent|feature:sub_embodiment_of_the_law", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_embodiment_of_the_law", "hand-counter-cost-not-charged"],
  ],
  "test-enforce-sweep-hand-cleric-d": [
    ["P1|*|foe-100ft|option:channel_divinity:turn-undead", "hand-feature-nobody-in-reach"],
    ["P1|*|out-of-fight|option:channel_divinity:turn-undead", "hand-fight-only-open-out-of-fight"],
  ],
};
