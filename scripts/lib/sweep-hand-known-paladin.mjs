// The rows of the Hand sweep that fail today: paladin. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-paladin-a": [
    ["P5|*|*|option:channel_divinity:abjure-enemy", "hand-sight-required-open"],
    ["P5|*|*|option:channel_divinity:conquering-presence", "hand-sight-required-open"],
    ["P5|*|*|option:channel_divinity:vow-of-enmity", "hand-sight-required-open"],
  ],
  "test-enforce-sweep-hand-paladin-b": [
    ["P1|Oath of the Crown@20|blinded|feature:authored:champion-challenge", "hand-sight-required-open"],
    ["P5|*|*|option:channel_divinity:control-undead", "hand-sight-required-open"],
  ],
};
