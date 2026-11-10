// The Hunter's picks that read more than their own swing (SRD 5.1, Ranger
// Archetypes, Hunter).
//
// Horde Breaker: "you can make another attack with the same weapon against a
// different creature that is within 5 feet of the original target". The turn
// budget already keeps who was attacked ("attacked:<enemyId>"); the weapon
// each was attacked with is kept beside it here, so the extra attack can be
// held to the weapon of the attack it follows. Every weapon attack a Horde
// Breaker makes on their own turn goes through markAttackedWith
// (pc-attack-spend.ts), and the option's gate reads attackedWith
// (pc-attack-options.ts).
//
// Pure.

import type { TurnBudget } from "@/lib/dm/action-budget";
import { textKey } from "@/lib/language/text-logic";

const ATTACKED_WITH = "attacked-with:";

const withKey = (enemyId: string, weapon: string) => `${ATTACKED_WITH}${enemyId}:${textKey(weapon)}`;

export function markAttackedWith(budget: TurnBudget, enemyId: string, weapon: string): TurnBudget {
  const key = withKey(enemyId, weapon);
  return budget.oncePerTurn.includes(key) ? budget : { ...budget, oncePerTurn: [...budget.oncePerTurn, key] };
}

export function attackedWith(budget: TurnBudget, enemyId: string, weapon: string): boolean {
  return budget.oncePerTurn.includes(withKey(enemyId, weapon));
}
