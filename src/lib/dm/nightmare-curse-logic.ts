// The rakshasa's curse (SRD 5.1, Rakshasa, Claw: "the target is cursed if it
// is a creature. The magical curse takes effect whenever the target takes a
// short or long rest, filling the target's thoughts with horrible images and
// dreams. The cursed target gains no benefit from finishing a short or long
// rest. The curse lasts until it is lifted by a remove curse spell or similar
// magic."). Read from the block by src/lib/bestiary/affliction-text.ts.
//
// A condition under a curse's name, so whatever ends curses ends it (Remove
// Curse, Greater Restoration's one curse: cure-spell.ts); the rests read it
// (rest-benefits.ts for a long rest and the days slept through, rest-tools.ts
// for a short one). Left a line for the GM, the cursed hero woke whole.
//
// Pure.

import { isConditionNamed } from "@/lib/srd/feature-names";

export const NIGHTMARE_CURSE = "cursed (nightmares)";

export function holdsNightmareCurse(conditions: readonly string[]): boolean {
  return conditions.some((name) => isConditionNamed(name, NIGHTMARE_CURSE));
}

// Why a cursed character gains nothing from the rest, for the result.
export const NIGHTMARE_REST = "cursed: horrible images and dreams, no benefit from finishing a rest";
