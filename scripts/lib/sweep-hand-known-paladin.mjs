// The rows of the Hand sweep that fail today: paladin. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-paladin-a": [
    ["P1|Oath of Conquest@20|blinded|option:channel_divinity:conquering-presence", "hand-sight-required-open"],
    ["P1|Oath of Devotion@20|foe-100ft|option:channel_divinity:turn-the-unholy", "hand-feature-nobody-in-reach"],
    ["P1|Oath of Devotion@20|out-of-fight|option:channel_divinity:turn-the-unholy", "hand-fight-only-open-out-of-fight"],
    ["P1|Oath of the Ancients@20|blinded|feature:authored:nature-s-wrath", "hand-sight-required-open"],
    ["P1|Oath of the Ancients@20|foe-100ft|option:channel_divinity:turn-the-faithless", "hand-feature-nobody-in-reach"],
    ["P1|Oath of the Ancients@20|out-of-fight|option:channel_divinity:turn-the-faithless", "hand-fight-only-open-out-of-fight"],
    ["P1|Oath of Vengeance@20|blinded|option:channel_divinity:abjure-enemy", "hand-sight-required-open"],
    ["P1|Oath of Vengeance@20|blinded|option:channel_divinity:vow-of-enmity", "hand-sight-required-open"],
    ["P5|*|*|feature:authored:nature-s-wrath", "hand-sight-required-open"],
    ["P5|*|*|option:channel_divinity:abjure-enemy", "hand-sight-required-open"],
    ["P5|*|*|option:channel_divinity:conquering-presence", "hand-sight-required-open"],
    ["P5|*|*|option:channel_divinity:vow-of-enmity", "hand-sight-required-open"],
  ],
  "test-enforce-sweep-hand-paladin-b": [
    ["P1|Oath of the Crown@20|blinded|feature:authored:champion-challenge", "hand-sight-required-open"],
    ["P1|Oath of the Crown@20|foe-100ft|feature:authored:turn-the-tide", "hand-feature-nobody-in-reach"],
    ["P1|Oath of the Watchers@20|foe-100ft|option:channel_divinity:abjure-the-extraplanar", "hand-feature-nobody-in-reach"],
    ["P1|Oath of the Watchers@20|out-of-fight|option:channel_divinity:abjure-the-extraplanar", "hand-fight-only-open-out-of-fight"],
    ["P1|Oathbreaker@20|blinded|option:channel_divinity:control-undead", "hand-sight-required-open"],
    ["P5|*|*|feature:authored:champion-challenge", "hand-sight-required-open"],
    ["P5|*|*|option:channel_divinity:control-undead", "hand-sight-required-open"],
  ],
};
