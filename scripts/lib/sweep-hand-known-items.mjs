// The rows of the Hand sweep that fail today: items. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-items": [
    ["P1|*|*|spell:item:cloak of the bat:polymorph", "hand-polymorph-no-form"],
    ["P1|*|*|spell:item:wand of polymorph:polymorph", "hand-polymorph-no-form"],
    ["P1|item Luck Blade|bonus-spent,reaction-spent,foe-100ft|spell:item:luck blade:wish", "hand-item-charges-unknown"],
    ["P5|*|*|spell:item:cloak of the bat:polymorph:self", "hand-polymorph-no-form"],
    ["P5|*|*|spell:item:wand of polymorph:polymorph:self", "hand-polymorph-no-form"],
    ["P5|item Cloak of Arachnida|foe-100ft|spell:item:cloak of arachnida:web", "hand-aoe-range-unchecked"],
    ["P5|item Cloak of the Bat|foe-30ft|spell:item:cloak of the bat:polymorph", "hand-polymorph-no-form"],
    ["P5|item Staff of the Magi|foe-100ft|spell:item:staff of the magi:flaming sphere", "hand-aoe-range-unchecked"],
    ["P5|item Staff of the Magi|foe-100ft|spell:item:staff of the magi:web", "hand-aoe-range-unchecked"],
    ["P5|item Wand of Polymorph|foe-30ft|spell:item:wand of polymorph:polymorph", "hand-polymorph-no-form"],
    ["P5|item Wand of Web|foe-100ft|spell:item:wand of web:web", "hand-aoe-range-unchecked"],
    ["P5|scroll Web|foe-100ft|spell:item:spell scroll web:web", "hand-aoe-range-unchecked"],
  ],
};
