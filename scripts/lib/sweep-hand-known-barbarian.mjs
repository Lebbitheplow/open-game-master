// The rows of the Hand sweep that fail today: barbarian. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-barbarian": [
    ["P1|*|*|feature:authored:fanatical-focus", "hand-reroll-no-failed-save"],
    ["P1|*|*|feature:authored:storm-aura", "hand-feature-precondition-open"],
    ["P1|*|fresh,bonus-spent,reaction-spent,prone,grappled,blinded,silenced,no-free-hand,raging,foe-30ft,foe-100ft,foe-invisible|basic:hide", "hand-hide-seen"],
    ["P1|*|no-free-hand|basic:grapple", "hand-grapple-no-free-hand"],
    ["P1|*|out-of-fight|basic:hide", "hand-hide-out-of-fight-retry"],
    ["P2|*|grappled|basic:dash", "hand-dash-speed-0"],
    ["P3|Path of the Berserker@20|raging|attack:longsword:frenzy", "hand-frenzy-card-no-rage"],
    ["P3|Path of the Zealot@20|raging|attack:dagger", "hand-rider-dice-omitted"],
    ["P3|Path of the Zealot@20|raging|attack:longsword", "hand-rider-dice-omitted"],
    ["P3|Path of the Zealot@20|raging|attack:unarmed strike", "hand-rider-dice-omitted"],
    ["P5|*|*|basic:help", "hand-help-range"],
    ["P5|*|foe-30ft|attack:dagger", "hand-thrown-long-range"],
    ["P6|*|foe-30ft|attack:dagger", "hand-thrown-long-range"],
    ["P7|*|*|basic:ready:left", "hand-ready-attack-left"],
  ],
};
