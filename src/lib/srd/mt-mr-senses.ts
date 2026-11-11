// The senses a monk's subclass gives (wave 2, part mr), which no feature
// name spells out the way src/lib/srd/senses.ts reads one: "Blindsight: you
// can perceive your surroundings without sight to 10 feet" (Ascendant
// Aspect), and Astral Sight, "you see normally in darkness, magical or not,
// to 120 feet" while the visage is summoned (Visage of the Astral Self),
// which is the sight Devil's Sight gives. Both were the GM's to remember: an
// invisible creature beside the dragon monk was attacked at disadvantage,
// and the astral monk was blind in a Darkness spell.
//
// Pure. Every reader of a character's senses merges it: the attack's
// (src/lib/dm/attack-light.ts characterSenses) and the board view's
// (src/lib/battlemap/view.ts sheetSenses).

import { hasCondition, heldAuthored, type AuthoredSheet } from "@/lib/srd/authored-effects";
import type { Senses } from "@/lib/srd/senses";

const tiles = (feet: number) => Math.floor(feet / 5);

export function mrSensesOver(sheet: AuthoredSheet, senses: Senses): Senses {
  const held = heldAuthored(sheet);
  const blindsight = held.some((row) => row.key === "monk::Ascendant Aspect") ? tiles(10) : 0;
  const astralSight = held.some((row) => row.key === "monk::Visage of the Astral Self") && hasCondition(sheet, "visage of the astral self") ? tiles(120) : 0;
  if (!blindsight && !astralSight) {
    return senses;
  }
  return { ...senses, blindsight: Math.max(senses.blindsight, blindsight), devilsSight: Math.max(senses.devilsSight, astralSight) };
}
