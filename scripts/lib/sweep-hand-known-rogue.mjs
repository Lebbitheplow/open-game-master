// The rows of the Hand sweep that fail today: rogue. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-rogue": [
    ["P1|*|*|feature:sub_psionic_recovery", "hand-feature-precondition-open"],
    ["P1|*|*|reaction:misdirection:hero", "hand-reaction-no-trigger"],
    ["P1|Arcane Trickster@20|fresh,action-spent,bonus-spent,prone,grappled,blinded,darkness,concentrating,foe-30ft,foe-100ft,foe-invisible,out-of-fight,failed-save|spell:shield", "hand-reaction-no-trigger"],
    ["P1|Arcane Trickster@20|out-of-fight|feature:sub_spell_thief", "hand-reaction-no-trigger"],
    ["P2|*|action-spent|feature:stroke_of_luck", "hand-counter-cost-not-charged"],
    ["P2|Phantom@20|action-spent|feature:sub_wails_from_the_grave", "hand-counter-cost-not-charged"],
    ["P2|Soulknife@20|action-spent|feature:sub_rend_mind", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:stroke_of_luck", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_rend_mind", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_wails_from_the_grave", "hand-counter-cost-not-charged"],
    ["P7|*|*|resource:sub_master_duelist", "hand-no-card-after-roll-counters"],
  ],
};
