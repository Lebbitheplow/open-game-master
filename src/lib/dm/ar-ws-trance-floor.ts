// Trance of Order (Clockwork Soul 14): "For a minute, attacks against you
// cannot have advantage and you treat any d20 of 9 or lower as a 10 on
// attacks, checks and saves". The spend laid the condition "trance of order"
// and only the first half was read (enemy-swing-odds.ts): the sorcerer's own
// d20 landed as it fell.
//
// The floor is written into the roll's expression as the dice grammar's floor
// suffix ("1d20f10", src/lib/dice.ts: a kept face below 10 counts as 10, the
// face that fell still shown on the card), so a face entered from physical
// dice is floored by the same expression. With advantage or disadvantage the
// kept die is the one raised, which lands where flooring both dice would.
// A natural 1 treated as a 10 is no longer a 1: an attack roll of it is not
// an automatic miss and a death save of it is one success, not two failures.
//
// Who calls it: every expression of a character's own d20 is built at one of
// three doors, and each floors it here:
// - rolls.ts resolveRollExpression (a check, a save, initiative, a death
//   save, an attack request_roll names for a character);
// - character-roll.ts rollCharacterD20 (an attack another tool throws: an
//   opportunity attack, a blow at an object);
// - pc-attack-resolve.ts strikeToHit (pc_attack, on the server's dice and on
//   the player's).
// A new door that builds a character's d20 expression itself floors it with
// tranceFloored too.
//
// Pure: no database.

import type { RollArgs } from "@/lib/dm/roll-args";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const TRANCE_OF_ORDER = "trance of order";
const TRANCE_FLOOR = 10;

// The leading d20 term with its keep and reroll suffixes, and the floor it
// already carries (Reliable Talent's, Indomitable Might's).
const LEADING_D20 = /^(\d+d20(?:k[hl]\d+)?(?:r\d+)?)(?:f(\d+))?/i;

type Tranced = { conditions?: readonly string[] } | null | undefined;

// The lowest a d20 the character throws for an attack, a check or a save may
// count as: 10 while the trance holds, else 0.
export function tranceFloor(sheet: Tranced): number {
  return (sheet?.conditions ?? []).some((entry) => isConditionNamed(entry, TRANCE_OF_ORDER)) ? TRANCE_FLOOR : 0;
}

// The expression with a floor under its leading d20, keeping a higher floor
// it already has. An expression that leads with no d20 (damage) is unchanged.
export function withD20Floor(expression: string, floor: number): string {
  if (floor <= 1) {
    return expression;
  }
  return expression.replace(LEADING_D20, (_whole, term: string, had: string | undefined) => `${term}f${Math.max(floor, Number(had ?? 0))}`);
}

// A character's attack, check or save expression as the trance leaves it.
export function tranceFloored(sheet: Tranced, expression: string): string {
  return withD20Floor(expression, tranceFloor(sheet));
}

const TRANCE_NOTE = "Trance of Order: a d20 of 9 or lower counts as 10";

// What resolveRollExpression answers, floored: the kinds that are a d20 of
// the character's own (never damage or a custom roll), with the note the
// roll's card shows.
export function tranceResolved<T extends object>(sheet: Tranced, kind: RollArgs["kind"], resolved: T): T {
  if (kind === "damage" || kind === "custom" || !("expression" in resolved) || typeof resolved.expression !== "string") {
    return resolved;
  }
  const expression = tranceFloored(sheet, resolved.expression);
  if (expression === resolved.expression) {
    return resolved;
  }
  const notes = "conditionNotes" in resolved && Array.isArray(resolved.conditionNotes) ? (resolved.conditionNotes as string[]) : [];
  return { ...resolved, expression, conditionNotes: [...notes, TRANCE_NOTE] };
}
