// The rows of the Hand sweep that fail today: fighter. See sweep-hand-known.mjs.
// WRITTEN by scripts/lib/sweep-hand-triage.mjs --known; do not edit by hand.
export const ROWS = {
  "test-enforce-sweep-hand-fighter": [
    ["P1|*|*|feature:indomitable", "hand-reroll-no-failed-save"],
    ["P1|*|*|feature:sub_psionic_recovery", "hand-feature-precondition-open"],
    ["P1|Eldritch Knight@20|fresh,action-spent,bonus-spent,prone,grappled,blinded,darkness,concentrating,foe-30ft,foe-100ft,foe-invisible,out-of-fight,failed-save|spell:shield", "hand-reaction-no-trigger"],
    ["P1|Psi Warrior@20|fresh,action-spent,bonus-spent,reaction-spent,prone,grappled,blinded,darkness,silenced,no-free-hand,foe-30ft,foe-100ft,foe-invisible|option:sub_psionic_energy:psionic-strike", "hand-feature-needs-target"],
    ["P1|Psi Warrior@20|fresh,bonus-spent,reaction-spent,prone,grappled,blinded,darkness,silenced,no-free-hand,foe-30ft,foe-100ft,foe-invisible|feature:authored:telekinetic-adept", "hand-feature-needs-target"],
    ["P1|Psi Warrior@20|out-of-fight|feature:authored:telekinetic-adept", "hand-fight-only-open-out-of-fight"],
    ["P1|Psi Warrior@20|out-of-fight|option:sub_psionic_energy:psionic-strike", "hand-fight-only-open-out-of-fight"],
    ["P2|Arcane Archer@20|action-spent|feature:sub_arcane_shot", "hand-counter-cost-not-charged"],
    ["P2|Echo Knight@20|action-spent|feature:sub_reclaim_potential", "hand-counter-cost-not-charged"],
    ["P2|Echo Knight@20|action-spent|feature:sub_unleash_incarnation", "hand-counter-cost-not-charged"],
    ["P2|Psi Warrior@20|bonus-spent|feature:sub_telekinetic_master", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_arcane_shot", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_reclaim_potential", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_telekinetic_master", "hand-counter-cost-not-charged"],
    ["P4|*|*|feature:sub_unleash_incarnation", "hand-counter-cost-not-charged"],
  ],
};
