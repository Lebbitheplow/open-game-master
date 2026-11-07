// "Each creature of your choice": the creatures an area feature takes, when
// the call names them (Order's Demand, Champion Challenge, Conquering Presence, Dreadful Aspect).
// targetEnemyIds names them; a lone targetEnemyId names one, for a caller that
// sees only that argument (the compact tool set leaves targetEnemyIds off).
// Every creature in reach when none is named. A name outside the area, or a
// choice the feature does not offer, is refused before anything is spent.
//
// Pure: callers pass the creatures already in reach, and how a reference (an
// id or a name) resolves to a creature's id.

import type { EncounterEnemy } from "@/lib/db/encounters";
import type { ToolError } from "@/lib/dm/tool-errors";

export function chosenTargets(
  name: string,
  offersChoice: boolean,
  inReach: EncounterEnemy[],
  call: { targetEnemyIds?: string[]; targetEnemyId?: string },
  resolve: (ref: string) => string | null,
): EncounterEnemy[] | ToolError {
  const refs = call.targetEnemyIds?.length ? call.targetEnemyIds : offersChoice && call.targetEnemyId ? [call.targetEnemyId] : [];
  if (!refs.length) {
    return inReach;
  }
  if (!offersChoice) {
    return { error: `${name} takes every creature in reach, not a chosen few: leave targetEnemyIds out. Nothing was spent.`, retry: true };
  }
  const ids = refs.map((ref) => resolve(ref) ?? ref);
  const outside = refs.filter((_, at) => !inReach.some((enemy) => enemy.id === ids[at]));
  if (outside.length) {
    const open = inReach.map((enemy) => `${enemy.displayName} (${enemy.id})`).join(", ");
    return { error: `${name} cannot take ${outside.join(", ")}: it reaches only ${open}. Nothing was spent.`, retry: true };
  }
  return inReach.filter((enemy) => ids.includes(enemy.id));
}
