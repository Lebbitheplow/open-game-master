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
export const BRAND_CONDITIONS = [BRAND, BRAND_TWIN, SECOND_BRAND];

export const PURGING_FLAME = "purging flame";
export const JUDGMENT_SHOT = "judgment shot";
// Lance the Wound: "the target cannot regain HP until your next turn"
// (src/lib/dm/vitals-logic.ts regainBlockedBy reads it).
export const LANCED = "lanced wound";

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
  { id: "immolate_the_sin", match: ["immolate the sin"], summary: "Immolate the Sin: for a minute the penitent burns in gray flame, +2d8 fire on their attacks and immune to fire." },
];
