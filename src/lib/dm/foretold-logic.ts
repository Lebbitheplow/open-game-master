// Portent (School of Divination): the numbers a wizard rolled at the end of a
// long rest, kept until they replace a d20 before it is thrown. The counter
// (authored-resources.json) says how many are left, and any of the many paths
// that spend a counter may have moved it, so the numbers still usable are read
// through it. Pure but for the throw at the rest.

import { rollExpression, type RollResult } from "@/lib/dice";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const PORTENT = "sub_portent";

export function foretoldLeft(sheet: Pick<CharacterSheet, "resources" | "foretold">): number[] {
  const state = sheet.resources?.[PORTENT];
  return state ? (sheet.foretold ?? []).slice(0, Math.max(0, state.max - state.used)) : [];
}

export function rollForetold(count: number): number[] {
  return Array.from({ length: count }, () => rollExpression("1d20").total);
}

// The sheet's numbers with one of them gone.
export function foretoldWithout(numbers: readonly number[], value: number): number[] {
  const at = numbers.indexOf(value);
  return at < 0 ? [...numbers] : [...numbers.slice(0, at), ...numbers.slice(at + 1)];
}

// One d20 for the number to stand on: advantage and disadvantage have no second
// die to choose once the number replaces the roll.
export function singleD20Expression(expression: string): string {
  return expression.replace(/\s+/g, "").replace(/^\d+d20(k[hl]\d+)?/, "1d20");
}

// The roll with the foretold number on its d20; null when it has no d20.
export function withForetoldD20(outcome: RollResult, value: number): RollResult | null {
  const lead = outcome.terms[0];
  if (lead?.kind !== "dice" || lead.sides !== 20) {
    return null;
  }
  const rest = { ...outcome };
  delete rest.crit;
  return {
    ...rest,
    total: outcome.total - lead.subtotal + value,
    terms: [{ ...lead, dice: [{ sides: 20, value, kept: true }], subtotal: value }, ...outcome.terms.slice(1)],
    natural: value,
    ...(value === 20 ? { crit: "nat20" as const } : value === 1 ? { crit: "nat1" as const } : {}),
  };
}
