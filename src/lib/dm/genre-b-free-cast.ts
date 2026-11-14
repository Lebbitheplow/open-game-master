// The mystery, post-apocalyptic and steampunk features that let a spell be
// cast with no slot (WAVE2 D5): each spends its counter into a mark on the
// caster (src/lib/srd/authored-effects-genre-b.ts), and the cast guard
// (src/lib/dm/cast-guard.ts) reads the mark here before it plans a slot.
//
//   one cast of this level or lower, the mark spent by it:
//     Overpressure Valve, Power Cell Cache (1st; 3rd from Perpetual Motion
//     and Power Cell Cache (3rd)), Sublimation (3rd), The Examined Mind (5th),
//     Magnum Opus (6th), The Great Work (7th)
//   one cast of exactly this level, the spell the player chose:
//     Master Schematic (3rd), Prototype Rig (5th)
//   every cast of this level or lower for a minute, the mark kept:
//     Living Dynamo (3rd), The Next Step (3rd, with +2 AC), Reactor Heart (4th)
//
// A cantrip costs no slot anyway and takes no mark. A new slotless cast is a
// row of MARKS, never a check in the cast guard.
import { isConditionNamed } from "@/lib/srd/feature-names";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Mark = { condition: string; max: number; exact?: boolean; minute?: boolean };

export const MARKS: Mark[] = [
  { condition: "slotless cast (1st)", max: 1 },
  // Grief Made Strength (dirgesinger 3): the next dirge of 2nd level or lower.
  { condition: "slotless cast (2nd)", max: 2 },
  { condition: "slotless cast (3rd)", max: 3 },
  { condition: "slotless cast (5th)", max: 5 },
  { condition: "slotless cast (6th)", max: 6 },
  { condition: "slotless cast (7th)", max: 7 },
  { condition: "chosen cast (3rd)", max: 3, exact: true },
  { condition: "chosen cast (5th)", max: 5, exact: true },
  { condition: "slotless minute (3rd)", max: 3, minute: true },
  { condition: "slotless minute (4th)", max: 4, minute: true },
  { condition: "the next step", max: 3, minute: true },
];

export type GenreFreeCast = { condition: string; level: number; spent: boolean };

// The mark that pays for this cast: the spell's level (or the level the call
// names) within the mark's.
export function genreFreeCast(sheet: Pick<CharacterSheet, "conditions">, spellLevel: number | null | undefined, named: number | undefined): GenreFreeCast | null {
  const base = spellLevel ?? 0;
  if (base < 1) {
    return null;
  }
  const level = named ?? base;
  const held = MARKS.filter((mark) => sheet.conditions.some((entry) => isConditionNamed(entry, mark.condition)));
  const fits = held.filter((mark) => (mark.exact ? level === mark.max && base <= mark.max : level <= mark.max));
  // A minute's window first (its use is kept), else the smallest one-cast
  // mark that fits, so a larger mark is kept for a larger spell.
  const chosen = fits.reduce<Mark | null>((best, mark) => (!best || (mark.minute && !best.minute) || (Boolean(mark.minute) === Boolean(best.minute) && mark.max < best.max) ? mark : best), null);
  return chosen ? { condition: chosen.condition, level, spent: !chosen.minute } : null;
}
