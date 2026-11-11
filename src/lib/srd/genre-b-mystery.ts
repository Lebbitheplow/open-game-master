// The mystery classes' features read from the sheet alone (WAVE2 D5: the
// genre text is the rule), for the engines and the Hand alike. Pure: no
// database.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { holdsGenreFeature } from "@/lib/srd/genre-b-combat";

type Uses = Record<string, { max: number; used: number }>;
type Holder = Pick<CharacterSheet, "class" | "features" | "resources"> & Partial<Pick<CharacterSheet, "classes">>;

export const VANISH = "mystery_vanish";

// Vanish (grifter, 18th level): "Hide as a bonus action even in plain sight,
// 3/long rest". With a use left a watcher's clear view refuses no Hide
// (src/lib/dm/hide-traits.ts hideRefusal), and a Hide made in plain sight
// spends a use, whichever part of the turn pays for it
// (src/lib/dm/combat-actions.ts hide).
export function vanishesInPlainSight(sheet: Holder): boolean {
  const state = (sheet.resources as Uses | undefined)?.[VANISH];
  return holdsGenreFeature(sheet, "grifter", "Vanish") && Boolean(state && state.used < state.max);
}

// The counters with one Vanish use spent, for a Hide in plain sight the
// bonus-action route did not already charge.
export function spendVanish(resources: Uses | undefined, usedBefore: number): Uses | null {
  const state = resources?.[VANISH];
  if (!resources || !state || state.used > usedBefore || state.used >= state.max) {
    return null;
  }
  return { ...resources, [VANISH]: { max: state.max, used: state.used + 1 } };
}
