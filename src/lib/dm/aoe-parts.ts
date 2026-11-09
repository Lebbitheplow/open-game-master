// A blast of two damage types (SRD 5.1: Meteor Swarm's 20d6 fire and 20d6
// bludgeoning, Flame Strike's fire and radiant, Ice Storm's bludgeoning and
// cold). The spell's row names the second type (SpellMech.secondType); the
// last dice of the damage expression are that type and the rest the first,
// each rolled on its own and landing on its own so a creature resistant to
// fire halves only the fire. Pure: aoe-damage.ts rolls and applies.

import type { RollResult } from "@/lib/dice";

export type DamagePart = { amount: number; type?: string };

// The damage expression split in two ("20d6+20d6" -> "20d6", "20d6"), or
// null when the spell has one type or the expression has one dice term.
export function splitDamageExpression(expression: string, secondType: string | undefined): [string, string] | null {
  if (!secondType) {
    return null;
  }
  const match = /^(.+?)\s*\+\s*(\d+d\d+)\s*$/i.exec(expression.trim());
  return match && /\d+d\d+/i.test(match[1]) ? [match[1], match[2]] : null;
}

// What one creature takes of each part: all of it, half of each (rounded
// down, as each type's own damage), or none.
export function partsTaken(parts: DamagePart[], share: "full" | "half" | "none"): DamagePart[] {
  return parts.map((part) => ({
    ...part,
    amount: share === "full" ? part.amount : share === "half" ? Math.floor(part.amount / 2) : 0,
  }));
}

export const partsTotal = (parts: DamagePart[]) => parts.reduce((sum, part) => sum + part.amount, 0);

// One type's dice in a spell's one damage roll: the spell's own dice of that
// type and any rider's that joined them (Enhanced Bond's d8 on a spell's
// fire). `atMaximum`: dealt at the dice's maximum with no roll (Overchannel,
// Blight on a plant, Destructive Wrath on a spell's thunder alone).
export type SpellDicePart = { type: string; dice: string; atMaximum?: boolean };

// A dice expression's maximum: a floor ("3d6f2") or a reroll ("2d6r2") does
// not change it.
export function diceMaximum(expression: string): number {
  let total = 0;
  for (const term of expression.replace(/\s+/g, "").split(/(?=[+-])/).filter(Boolean)) {
    const sign = term.startsWith("-") ? -1 : 1;
    const dice = /^[+-]?(\d*)d(\d+)/i.exec(term);
    total += sign * (dice ? Number(dice[1] || 1) * Number(dice[2]) : Number(term.replace(/^[+-]/, "")) || 0);
  }
  return total;
}

const termCount = (expression: string) => expression.replace(/\s+/g, "").split(/(?=[+-])/).filter(Boolean).length;

// The expression the one roll card rolls: each part's dice in order, a part
// at its maximum written as that number, so only the other part's dice roll.
export function typedRollExpression(parts: SpellDicePart[]): string {
  return parts.map((part) => (part.atMaximum ? String(diceMaximum(part.dice)) : part.dice)).join("+");
}

// Each part's share of that roll, read by the terms' places (the roll keeps
// them in order), so two parts of the same dice never trade their faces. With
// no roll (every part at its maximum) each share is its maximum.
export function typedShares(outcome: Pick<RollResult, "terms"> | null, parts: SpellDicePart[]): number[] {
  let at = 0;
  return parts.map((part) => {
    if (!outcome) {
      return diceMaximum(part.dice);
    }
    const count = part.atMaximum ? 1 : termCount(part.dice);
    const share = outcome.terms.slice(at, at + count).reduce((sum, term) => sum + term.sign * (term.kind === "dice" ? term.subtotal : term.value), 0);
    at += count;
    return share;
  });
}
