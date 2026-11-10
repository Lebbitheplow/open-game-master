// The rows of the Hand sweep that fail today: items. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-items": [
    ["P1|*|*|spell:item:cloak of the bat:polymorph", "hand-polymorph-no-form"],
    ["P1|*|*|spell:item:wand of polymorph:polymorph", "hand-polymorph-no-form"],
    ["P1|*|silenced|spell:fire bolt", "hand-silence-open"],
    ["P1|*|silenced|spell:shocking grasp", "hand-silence-open"],
    ["P1|item Luck Blade|bonus-spent,reaction-spent,foe-100ft|spell:item:luck blade:wish", "hand-item-charges-unknown"],
    ["P3|*|*|spell:item:orb of dragonkind:cure wounds", "hand-item-heal-modifier"],
    ["P5|*|*|spell:item:cloak of the bat:polymorph:self", "hand-polymorph-no-form"],
    ["P5|*|*|spell:item:wand of polymorph:polymorph:self", "hand-polymorph-no-form"],
    ["P5|item Cloak of the Bat|foe-30ft|spell:item:cloak of the bat:polymorph", "hand-polymorph-no-form"],
    ["P5|item Trident of Fish Command|foe-30ft|attack:trident of fish command", "hand-thrown-long-range"],
    ["P5|item Wand of Polymorph|foe-30ft|spell:item:wand of polymorph:polymorph", "hand-polymorph-no-form"],
    ["P6|item Trident of Fish Command|foe-30ft|attack:trident of fish command", "hand-thrown-long-range"],
    ["P7|*|*|basic:ready:left", "hand-ready-attack-left"],
  ],
};
