// The rows of the Hand sweep that fail today: wizard. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-wizard-a": [
    ["P2|School of Divination@20|action-spent|feature:sub_portent", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_portent", "hand-counter-cost-not-charged"],
  ],
  "test-enforce-sweep-hand-wizard-b": [
    ["P1|School of Necromancy@20|blinded|feature:authored:command-undead", "hand-sight-required-open"],
    ["P2|School of Transmutation@20|action-spent|feature:sub_shapechanger", "hand-counter-cost-not-charged"],
    ["P2|War Magic@20|action-spent|feature:sub_power_surge", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_power_surge", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_shapechanger", "hand-counter-cost-not-charged"],
    ["P5|*|*|feature:authored:command-undead", "hand-sight-required-open"],
  ],
  "test-enforce-sweep-hand-wizard-c": [
    ["P2|Chronurgy Magic@20|action-spent|feature:sub_arcane_abeyance", "hand-counter-cost-not-charged"],
    ["P2|Order of Scribes@20|action-spent|feature:sub_manifest_mind_casts", "hand-counter-cost-not-charged"],
    ["P3|*|*|feature:sub_event_horizon", "hand-counter-dice-not-rolled"],
    ["P4|*|*|feature:sub_arcane_abeyance", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_manifest_mind_casts", "hand-counter-cost-not-charged"],
  ],
};
