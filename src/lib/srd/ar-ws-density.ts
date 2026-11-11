// Adjust Density's carrying capacity (Graviturgy Magic 2): "Halve or double a
// creature's or object's weight for a minute, changing its speed, carrying
// capacity and Strength checks."
//
// The text says the capacity changes and not which way. Ruling: it goes the
// way the Strength checks do. A creature whose weight is doubled has advantage
// on Strength checks and carries, pushes, drags and lifts twice as much; one
// whose weight is halved has disadvantage and carries half. The speed and the
// Strength rolls are the condition's own (authored-conditions.ts).
//
// Pure. Read by the one place a load is weighed against a capacity
// (src/lib/srd/encumbrance.ts encumbranceFor) and by the lift limits
// (src/lib/dm/load-rules.ts liftLimits); every caller hands in the creature's
// conditions as its `wearer`.

import { textKey } from "@/lib/language/text-logic";

export const DENSITY_LIGHTER = "adjusted density (lighter)";
export const DENSITY_HEAVIER = "adjusted density (heavier)";

// What the creature's carrying capacity is multiplied by: 2, 0.5 or 1.
export function densityCarryFactor(conditions: readonly string[] | undefined): number {
  const held = new Set((conditions ?? []).map((entry) => textKey(entry)));
  if (held.has(textKey(DENSITY_HEAVIER))) return 2;
  return held.has(textKey(DENSITY_LIGHTER)) ? 0.5 : 1;
}
