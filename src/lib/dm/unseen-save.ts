// A repeat save that comes only out of the source's sight. SRD 5.1, Fear: "If
// the creature ends its turn in a location where it doesn't have line of
// sight to you, the creature can make a Wisdom saving throw." On the board
// the line of sight decides (audit 2026-11-16, Y02). Off it nothing measures
// sight, so the save never came and a creature frightened by Fear fled for
// the whole minute. The ruling (Y13): off the board, it saves at the end of
// each of its turns after the first turn it spent fleeing. That first turn's
// end marks the hold (`turnEnded`), so the next one rolls.
// Read by condition-tick.ts heldClose, for a creature and a character alike.

import { getEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { bothOnBoard, unseenBecause, unseenByConditions } from "@/lib/dm/authored-saves";
import { instancesOf, packInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";

// "held": no save at this turn's end. "first": no save either, and the hold
// is marked as past its first turn. null: the save is rolled.
export type UnseenHold = "held" | "first" | null;

export function unseenSaveHold(encounterId: string, holderId: string, instance: ConditionMeta): UnseenHold {
  const holder = getSheetById(holderId) ?? getEnemy(holderId);
  const source = instance.source ? (getSheetById(instance.source) ?? getEnemy(instance.source)) : null;
  if (!holder || !source) {
    return null;
  }
  if (bothOnBoard(encounterId, holder.id, source.id)) {
    return unseenBecause(encounterId, holder, source) ? null : "held";
  }
  // A blinded holder or an invisible caster is out of sight off the board too.
  if (unseenByConditions(encounterId, holder, source, {})) {
    return null;
  }
  return instance.turnEnded ? null : "first";
}

// The condition's instances that `matches` picks, marked as past their
// holder's first turn. Pure.
export function markTurnEnded(meta: ConditionMetaMap, name: string, matches: (instance: ConditionMeta) => boolean): ConditionMetaMap {
  const entry = meta[name];
  const packed = entry ? packInstances(instancesOf(entry).map((instance) => (matches(instance) ? { ...instance, turnEnded: true } : instance))) : undefined;
  return packed ? { ...meta, [name]: packed } : meta;
}
