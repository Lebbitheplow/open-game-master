// The rows of the Hand sweep that fail today: rogue. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-rogue": [
    ["P1|*|*|feature:sub_psionic_recovery", "hand-feature-precondition-open"],
    ["P1|*|*|reaction:misdirection:hero", "hand-reaction-no-trigger"],
  ],
};
