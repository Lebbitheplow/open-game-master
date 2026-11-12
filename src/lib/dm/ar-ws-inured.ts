// Inured to Undeath, where the stored hit point maximum follows a condition
// (src/lib/db/sheets.ts patchSheet): "your hit point maximum cannot be
// reduced". The rule and the list of doors are in ar-ws-inured-logic.ts.
//
// A drain is a condition on the sheet ("max hp reduced (-7)") that patchSheet
// turns into a lower maximum, whichever route laid it. On a holder the drain
// does not land: the sheet's drains stay exactly as they were, so nothing is
// lowered now and nothing is given back later that was never taken. A drain
// laid before the feature was gained stays until its own end.
//
// Called by patchSheet only. Pure.

import { MAX_HP_DRAIN, maxHpRiders, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { maxHpCannotFall } from "@/lib/dm/ar-ws-inured-logic";
import type { AuthoredSheet } from "@/lib/srd/authored-effects";

type Riders = { conditions: string[]; conditionMeta?: unknown };

// What to write over `next` so that no new drain lands on a holder: nothing
// for anybody else, and nothing when the patch lays no heavier drain.
export function keptFromDrain(existing: Riders, next: Riders & AuthoredSheet): Partial<{ conditions: string[]; conditionMeta: ConditionMetaMap }> {
  const before = maxHpRiders(existing.conditions, existing.conditionMeta as ConditionMetaMap).drain;
  const after = maxHpRiders(next.conditions, next.conditionMeta as ConditionMetaMap).drain;
  if (after <= before || !maxHpCannotFall(next)) {
    return {};
  }
  const isDrain = (name: string) => MAX_HP_DRAIN.test(name.trim());
  const meta = { ...((next.conditionMeta ?? {}) as ConditionMetaMap) };
  const old = (existing.conditionMeta ?? {}) as ConditionMetaMap;
  for (const name of next.conditions.filter(isDrain)) {
    delete meta[name];
  }
  const standing = existing.conditions.filter(isDrain);
  for (const name of standing) {
    if (old[name]) {
      meta[name] = old[name];
    }
  }
  return { conditions: [...next.conditions.filter((name) => !isDrain(name)), ...standing], conditionMeta: meta };
}
