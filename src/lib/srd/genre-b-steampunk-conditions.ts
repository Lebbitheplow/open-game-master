// What the conditions the steampunk classes' fifth-round spends lay do, as
// rows of the condition registry (src/lib/srd/condition-effects.ts
// CONDITION_EFFECTS), kept apart from genre-b-conditions.ts for the reason
// authored-effects-genre-b-steampunk.ts is kept apart from its table.
//
// Pure data, as the registry's other tables.
import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

// Full Throttle's own condition (its row is genre-b-conditions.ts's) and the
// debt it leaves (src/lib/dm/genre-b-steampunk-ends.ts).
export const FULL_THROTTLE = "full throttle";
export const BOILER_STRAIN = "boiler strain";
// Galvanic Discharge's charge.
export const GALVANIC = "galvanic discharge";

export const GENRE_B_STEAMPUNK_CONDITION_EFFECTS: ConditionEffectRow[] = [
  { id: "boiler_strain", match: [BOILER_STRAIN], summary: "Boiler strain: when Full Throttle ends, however it ends, its holder takes 3d10 fire damage." },
  { id: "galvanic_discharge", match: [GALVANIC], summary: "Galvanic Discharge: the next creature that hits its holder with a melee attack takes 1d8 lightning damage, which spends the charge." },
];
