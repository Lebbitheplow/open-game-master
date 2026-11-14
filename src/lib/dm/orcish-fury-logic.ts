// The die a character's latest weapon hit this turn rolled with, kept on the
// turn's budget so Orcish Fury spent through a bare use_resource (an agent
// seat or a companion, which has no card to choose it on) knows the creature,
// the die and the type to add (src/lib/dm/orcish-fury.ts). A later hit
// replaces it. Pure, so the attack path can write it without the spend's
// imports.
import type { TurnBudget } from "@/lib/dm/action-budget";

export type WeaponDie = NonNullable<TurnBudget["lastWeaponDie"]>;

// The die of a hit, or null when its damage has none (a flat 1 from an
// unarmed strike).
export function weaponDieOf(input: { enemyId: string | null | undefined; expression: string; type: string; crit: boolean; magical: boolean }): WeaponDie | null {
  const sides = Number(/\d*d(\d+)/.exec(input.expression)?.[1] ?? 0);
  if (!input.enemyId || !sides) {
    return null;
  }
  return { enemyId: input.enemyId, sides, type: input.type, crit: input.crit, magical: input.magical };
}
