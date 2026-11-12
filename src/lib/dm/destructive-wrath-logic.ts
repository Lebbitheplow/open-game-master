// Destructive Wrath (Tempest Domain 2): "When you roll lightning or thunder
// damage, you can use your Channel Divinity to deal maximum damage, instead of
// rolling." Only the lightning and thunder dice are dealt at their maximum: the
// bludgeoning of a warhammer whose Divine Strike adds thunder, or a rider of
// another type on a lightning spell, is still rolled.
//
// An attack's damage is one expression whose typed riders are read back out of
// the rolled terms by damage-parts.ts damageParts. The dice here are given to
// their owner the same way (the riders claim their dice from the end, a
// critical's copy beside them, the extra critical dice trailing), so the dice
// written at their maximum are exactly the ones the landing counts as
// lightning or thunder. Before this the attack's first dice term was matched
// as text, and a rider with the same dice was maximized with it.
//
// Pure: the expression and riders in, the expression to roll out.

import type { TypedRider } from "@/lib/dm/damage-parts";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import { isConditionNamed, isNamed } from "@/lib/srd/feature-names";

export const DESTRUCTIVE_WRATH = "destructive wrath";

export const isWrathType = (type: string | undefined) => isNamed(type ?? "", "lightning", "thunder");

export const holdsDestructiveWrath = (sheet: Pick<CharacterSheet, "conditions">) =>
  (sheet.conditions ?? []).some((entry) => isConditionNamed(entry, DESTRUCTIVE_WRATH));

// The dice engine's grammar for a term of dice (src/lib/dice.ts TERM_PATTERN):
// a floor (Elemental Adept's f2) or a reroll leaves the top face where it was.
const DICE = /^(\d{1,3})d(\d{1,3})(?:k([hl])(\d{1,3}))?(?:r\d{1,3})?(?:f\d{1,3})?$/i;

// The most one term can show, or null for a number.
export function diceMaximum(body: string): number | null {
  const match = DICE.exec(body);
  if (!match) {
    return null;
  }
  const count = Number(match[1]);
  const kept = match[4] ? Math.min(count, Number(match[4])) : count;
  return kept * Number(match[2]);
}

// The most an expression can roll, floors and all ("2d8f2+3" is 19).
export function expressionMaximum(expression: string): number {
  return termsOf(expression).reduce((sum, term) => sum + term.sign * (diceMaximum(term.body) ?? (Number(term.body) || 0)), 0);
}

type Term = { sign: 1 | -1; body: string };

function termsOf(expression: string): Term[] {
  return (expression.replace(/\s+/g, "").match(/[+-]?[^+-]+/g) ?? []).map((raw) => ({
    sign: raw.startsWith("-") ? -1 : 1,
    body: raw.replace(/^[+-]/, ""),
  }));
}

const write = (terms: Term[]) => terms.map((term, index) => (term.sign < 0 ? "-" : index ? "+" : "") + term.body).join("");

const countAndSides = (body: string) => {
  const match = DICE.exec(body);
  return match ? { count: Number(match[1]), sides: Number(match[2]) } : null;
};

// Which rider each term belongs to (its index in `riders`), or null for the
// attack's own type: damageParts' reading, on the expression before it rolls.
function owners(terms: Term[], ownType: string, riders: TypedRider[], options: { crit: boolean; trailingTerms?: number }): Array<number | null> {
  const owner: Array<number | null> = terms.map(() => null);
  const last = terms.length - Math.max(0, options.trailingTerms ?? 0);
  const own = textKey(ownType);
  for (let at = riders.length - 1; at >= 0; at -= 1) {
    const rider = riders[at];
    const match = /^(\d+)d(\d+)(?:[+-]\d+)?$/i.exec(rider.dice.replace(/\s+/g, ""));
    const type = textKey(rider.type);
    if ((!match && rider.flat === undefined) || !type || type === own) {
      continue;
    }
    if (rider.flat !== undefined) {
      for (let index = last - 1; index >= 0; index -= 1) {
        const value = Number(terms[index].body);
        if (owner[index] === null && terms[index].sign === 1 && !countAndSides(terms[index].body) && (value === rider.flat || (options.crit && value === rider.flat * 2))) {
          owner[index] = at;
          break;
        }
      }
    }
    if (!match) {
      continue;
    }
    const count = Number(match[1]);
    const sides = Number(match[2]);
    let wanted = options.crit ? 2 : 1;
    for (let index = last - 1; index >= 0 && wanted > 0; index -= 1) {
      const dice = owner[index] === null ? countAndSides(terms[index].body) : null;
      if (!dice || dice.count !== count || dice.sides !== sides) {
        continue;
      }
      owner[index] = at;
      wanted -= 1;
      // Powerful Critical's copy: the dice's maximum straight after them.
      const next = terms[index + 1];
      if (wanted > 0 && next && owner[index + 1] === null && !countAndSides(next.body) && Number(next.body) === count * sides) {
        owner[index + 1] = at;
        wanted -= 1;
      }
    }
  }
  return owner;
}

export type WrathDice = {
  expression: string;
  riders: TypedRider[];
  // Nothing left to roll: real dice are not asked for.
  noDice: boolean;
};

// The attack's lightning and thunder dice written as their maximum, or null
// when it rolls none. Its own dice become numbers in place (the own type is
// whatever the riders do not claim); a lightning or thunder rider becomes one
// number, carried as a flat rider of its type so the landing still finds it.
export function attackWrathDice(expression: string, ownType: string, riders: TypedRider[], options: { crit: boolean; trailingTerms?: number }): WrathDice | null {
  const terms = termsOf(expression);
  const owner = owners(terms, ownType, riders, options);
  const ownMaxed = isWrathType(ownType);
  const sums = new Map<number, number>();
  // A term as written, or the place a maximized rider's one number goes.
  const out: Array<Term | number> = [];
  let maxed = false;
  terms.forEach((term, index) => {
    const at = owner[index];
    const top = diceMaximum(term.body);
    if (at === null) {
      maxed ||= ownMaxed && top !== null;
      out.push(ownMaxed && top !== null ? { sign: term.sign, body: String(top) } : term);
      return;
    }
    if (!isWrathType(riders[at].type) || riders[at].flat !== undefined) {
      out.push(term);
      return;
    }
    // The rider's dice, and a Powerful Critical copy, gather in one number
    // where its first die stood.
    const value = term.sign * (top ?? (Number(term.body) || 0));
    maxed ||= top !== null;
    if (!sums.has(at)) {
      out.push(at);
    }
    sums.set(at, (sums.get(at) ?? 0) + value);
  });
  if (!maxed) {
    return null;
  }
  const written = out.map((term): Term => (typeof term === "number" ? { sign: 1, body: String(sums.get(term) ?? 0) } : term));
  return {
    expression: write(written),
    riders: riders.map((rider, at) => (sums.has(at) ? { dice: "", type: rider.type, flat: sums.get(at)! } : rider)),
    noDice: written.every((term) => diceMaximum(term.body) === null),
  };
}

// Whether a hit with this record would roll lightning or thunder dice: the
// attack's own type, or a rider of those types (Divine Strike's thunder).
export function rollsWrathDice(damageExpression: string, damageType: string | undefined, riders: TypedRider[] | undefined): boolean {
  return attackWrathDice(damageExpression, damageType ?? "", riders ?? [], { crit: false }) !== null;
}
