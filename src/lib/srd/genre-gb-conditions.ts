// What the conditions the cc1113 genre-b pass's spends lay do, as rows of the
// condition registry (src/lib/srd/condition-effects.ts CONDITION_EFFECTS),
// kept apart from the earlier passes' tables for the reason
// authored-effects-genre-gb.ts is.
//
// Pure data, as the registry's other tables.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

// Last Ride of the Reaver (road warrior 15): "for 1 minute your speed
// doubles, Ram Speed deals +4d6, and you resist all damage". The speed is
// this row's; the dice and the resistance are the feature's authored effects,
// gated on the condition (authored-effects-genre-gb.ts).
export const LAST_RIDE = "last ride of the reaver";

export const GENRE_GB_CONDITION_EFFECTS: ConditionEffectRow[] = [
  { id: "last_ride_of_the_reaver", match: [LAST_RIDE], speedMultiplier: 2, summary: "Last Ride of the Reaver: speed doubled, Ram Speed deals 4d6 more, resistance to all damage, for 1 minute." },
];
