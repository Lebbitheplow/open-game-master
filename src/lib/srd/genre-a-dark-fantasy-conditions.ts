// The conditions the dark fantasy classes' spends lay, as rows of the condition
// effects registry (src/lib/srd/genre-a-conditions.ts spreads them): each is the
// record the readers hold for as long as the feature lasts.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

// Twin Brand (11th): "Maintain two Hunter's Brands at once; brand damage rises
// to +1d8". The first brand is written "hunter's brand (1d8)", the second
// "second brand (1d8)", each naming its creature in its meta (quarry), so a hit
// on either creature carries its own die (src/lib/dm/attack-marks.ts).
export const BRAND = "hunter's brand";
export const BRAND_TWIN = "hunter's brand (1d8)";
export const SECOND_BRAND = "second brand (1d8)";
// The Flame That Judges: "every enemy within 30 ft is branded at once", each
// brand written "judged (<creature>)" with its creature in the meta.
export const JUDGED = "judged";
export const BRAND_CONDITIONS = [BRAND, BRAND_TWIN, SECOND_BRAND, JUDGED];

export const PURGING_FLAME = "purging flame";
export const JUDGMENT_SHOT = "judgment shot";
// Lance the Wound: "the target cannot regain HP until your next turn"
// (src/lib/dm/vitals-logic.ts regainBlockedBy reads it).
export const LANCED = "lanced wound";
// Threnody: "deal half damage on their next attack" (src/lib/dm/genre-a-dark-fantasy-wards.ts).
export const THRENODY = "threnody";
// The Last Rose: "your next attack is an automatic critical if it hits"
// (src/lib/dm/genre-a-dark-fantasy-edges.ts).
export const LAST_ROSE = "the last rose";

export const DARK_FANTASY_CONDITIONS: ConditionEffectRow[] = [
  {
    id: "hunters_brand_twin",
    match: [BRAND_TWIN],
    summary: "Hunter's Brand (Twin Brand): +1d8 radiant on attacks against the branded creature, until it dies or the hunter rests.",
    onHitDice: { dice: "1d8", type: "radiant" },
    marksTarget: true,
  },
  {
    id: "second_brand",
    match: ["second brand"],
    summary: "Second brand (Twin Brand): +1d8 radiant on attacks against the second branded creature, until it dies or the hunter rests.",
    onHitDice: { dice: "1d8", type: "radiant" },
    marksTarget: true,
  },
  // Dirge of Sorrow: "subtracts 1d4 from its next attack roll"; Dirge of Ruin:
  // "the penalty applies to attacks and saves", both until that attack.
  { id: "dirge_of_sorrow", match: ["dirge of sorrow"], summary: "Dirge of Sorrow: -1d4 on its next attack roll.", attackPenaltyDie: "1d4", consumedBy: "attack" },
  { id: "dirge_of_ruin", match: ["dirge of ruin"], summary: "Dirge of Ruin: -1d4 on its attack rolls and saves, until its next attack roll.", attackPenaltyDie: "1d4", savePenaltyDie: "1d4", consumedBy: "attack" },
  // Purging Flame: the brand's creature, named in the meta (quarry), takes
  // 2d10 radiant from the next hit on it, which spends the flame.
  { id: "purging_flame", match: [PURGING_FLAME], summary: "Purging Flame: the next hit on the branded creature deals +2d10 radiant.", onHitDice: { dice: "2d10", type: "radiant" }, marksTarget: true, consumedBy: "hit" },
  { id: "judgment_shot", match: [JUDGMENT_SHOT], summary: "Judgment Shot: the next ranged attack on the branded creature is a critical hit if it hits." },
  { id: "lanced_wound", match: [LANCED], summary: "Lanced wound: it cannot regain hit points until the plague doctor's next turn." },
  // Blood Offering: "one attack this turn becomes an automatic hit if the roll
  // would miss by 3 or less", which is +3 on that roll for hitting (a critical
  // is the d20's alone), spent by the attack.
  { id: "blood_offering", match: ["blood offering"], summary: "Blood Offering: the penitent's next attack this turn hits if it would miss by 3 or less.", paramAttackBonus: true, consumedBy: "attack" },
  // Mortified Flesh: the hit points paid, added to the next attack's damage,
  // spent by that attack hit or miss. One row per amount, "mortified flesh (N)".
  ...Array.from({ length: 24 }, (_, at): ConditionEffectRow => ({
    id: `mortified_flesh_${at + 1}`,
    match: [`mortified flesh (${at + 1})`],
    summary: `Mortified Flesh: +${at + 1} damage on the penitent's next attack.`,
    onHitDice: { dice: String(at + 1), type: "" },
    consumedBy: "attack",
  })),
  { id: "the_last_rose", match: [LAST_ROSE], summary: "The Last Rose: the grave knight's next attack is a critical hit if it hits." },
  { id: "threnody", match: [THRENODY], summary: "Threnody: its next attack that lands deals half damage." },
  { id: "judged", match: [JUDGED], summary: "Judged (The Flame That Judges): +1d8 radiant on attacks against this branded creature, until it dies or the hunter rests.", onHitDice: { dice: "1d8", type: "radiant" }, marksTarget: true },
  { id: "immolate_the_sin", match: ["immolate the sin"], summary: "Immolate the Sin: for a minute the penitent burns in gray flame, +2d8 fire on their attacks and immune to fire." },
];
