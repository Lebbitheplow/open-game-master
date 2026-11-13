// Mummy rot, SRD 5.1 Mummy (and Mummy Lord), Rotting Fist: "it must succeed
// on a ... Constitution saving throw or be cursed with mummy rot. The cursed
// target can't regain hit points, and its hit point maximum decreases by 10
// (3d6) for every 24 hours that elapse. If the curse reduces the target's hit
// point maximum to 0, the target dies ... The curse lasts until removed by
// the remove curse spell or other magic."
//
// The curse is a condition on the sheet under a curse's name, so whatever
// ends curses ends it (Remove Curse, Greater Restoration's one curse:
// cure-spell.ts). Its meta keeps when it took hold (`rotFrom`, in-world
// minutes) and how much maximum it has eaten (`rotDrain`), which
// condition-logic.ts maxHpRiders counts with the other drains, so the
// maximum comes back whole when the curse is lifted. Pure; the clock's half
// is src/lib/dm/mummy-rot.ts.

export const MUMMY_ROT = "cursed (mummy rot)";
export const ROT_DICE = "3d6";
const DAY_MINUTES = 24 * 60;

export function holdsMummyRot(conditions: readonly string[]): boolean {
  return conditions.some((name) => name.trim().toLowerCase() === MUMMY_ROT);
}

// How many full days since the curse took hold end in (from, to]: one drop
// of the maximum for each.
export function rotDaysBetween(rotFrom: number, from: number, to: number): number {
  if (to <= from) {
    return 0;
  }
  const daysAt = (instant: number) => Math.floor(Math.max(0, instant - rotFrom) / DAY_MINUTES);
  return Math.max(0, daysAt(to) - daysAt(from));
}
