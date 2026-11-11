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
import { favoredTerrains } from "@/lib/srd/check-traits";

const ATTACKED_WITH = "attacked-with:";

const withKey = (enemyId: string, weapon: string) => `${ATTACKED_WITH}${enemyId}:${textKey(weapon)}`;

export function markAttackedWith(budget: TurnBudget, enemyId: string, weapon: string): TurnBudget {
  const key = withKey(enemyId, weapon);
  return budget.oncePerTurn.includes(key) ? budget : { ...budget, oncePerTurn: [...budget.oncePerTurn, key] };
}

export function attackedWith(budget: TurnBudget, enemyId: string, weapon: string): boolean {
  return budget.oncePerTurn.includes(withKey(enemyId, weapon));
}

// ---- Natural Explorer on the road ----
//
// SRD 5.1, ranger, Natural Explorer: "While traveling for an hour or more in
// your favored terrain, you gain the following benefits: Difficult terrain
// doesn't slow your group's travel. ... If you are traveling alone, you can
// move stealthily at a normal pace." The land is the one the travel call or
// the check names (travel `land`, request_roll `terrain`).

type Explorer = { id?: string; name: string; features?: ReadonlyArray<{ name: string }> };

// The line for a leg whose difficult ground costs the group nothing, or null:
// a traveller holds the land as a favored terrain and the leg is an hour or
// more.
export function naturalExplorerGuide(travellers: readonly Explorer[], land: string | undefined, terrain: string, hours: number): string | null {
  if (!land || terrain !== "difficult" || hours < 1) {
    return null;
  }
  const guide = travellers.find((sheet) => favoredTerrains({ features: [...(sheet.features ?? [])] }).some((entry) => entry === land));
  return guide ? `Natural Explorer: the ${land} is ${guide.name}'s favored terrain, so its difficult ground does not slow the group.` : null;
}

// Whether this roller moves stealthily at a normal pace: the last stretch
// marched was theirs alone, and the check is made in their favored terrain.
export function stealthyAlone(roller: Explorer | null, terrain: string | undefined, marched: ReadonlyArray<{ end: number; ids: string[] }>): boolean {
  if (!roller?.id || !terrain || !favoredTerrains({ features: [...(roller.features ?? [])] }).some((entry) => entry === terrain)) {
    return false;
  }
  const last = [...marched].sort((a, b) => b.end - a.end)[0];
  return Boolean(last && last.ids.length === 1 && last.ids[0] === roller.id);
}
