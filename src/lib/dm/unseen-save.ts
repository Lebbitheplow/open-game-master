// A repeat save that comes only out of the source's sight. SRD 5.1, Fear: "If
// the creature ends its turn in a location where it doesn't have line of
// sight to you, the creature can make a Wisdom saving throw." On the board
// the line of sight decides (audit 2026-11-16, Y02). Off it nothing measures
// sight, so the save never came and a creature frightened by Fear fled for
// the whole minute. The ruling (Y13): off the board, it saves at the end of
// each of its turns after the first turn it spent fleeing. That first turn's
// end marks the hold (`turnEnded`), so the next one rolls.
// Read by condition-tick.ts for a creature and a character, and by
// pet-conditions.ts for a pet (Y18), which saved at every end of its owner's
// turn in plain sight of the caster.

import { getEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { bothOnBoard, unseenBecause, unseenByConditions, withinFeet, type Looker } from "@/lib/dm/authored-saves";
import { instancesOf, packInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";

// "held": no save at this turn's end. "first": no save either, and the hold
// is marked as past its first turn. null: the save is rolled.
export type UnseenHold = "held" | "first" | null;

// Whose hold: a creature or a character by id, or a pet as it looks from its
// owner's square (authored-saves.ts Looker), whose id is that square's.
type Holder = string | Looker;

// A hold saved against only far from its source (Dreadful Aspect: a creature
// that ends its turn more than 30 feet away). Measured on the board as reach
// is (authored-saves.ts): off the board it counts as close, as the fear's
// reach did; a source no longer on the board is far.
// Or only out of its sight (Fear): held while the holder still sees the
// caster, by the board's line of sight and the conditions (a blinded holder,
// an invisible caster). Without the save at all, Fear held its whole minute
// whatever wall the creature fled behind. Off the board, from the end of its
// second turn; "first" marks the first.
export function saveHoldAtTurnEnd(encounterId: string, holder: Holder, instance: ConditionMeta | undefined): UnseenHold {
  if (!instance?.source) return null;
  const feet = instance.saveEnds?.beyondFeet;
  if (feet && withinFeet(encounterId, instance.source, typeof holder === "string" ? holder : holder.id, feet)) return "held";
  return instance.saveEnds?.unseen ? unseenSaveHold(encounterId, holder, instance) : null;
}

export function unseenSaveHold(encounterId: string, holderRef: Holder, instance: ConditionMeta): UnseenHold {
  const holder = typeof holderRef === "string" ? (getSheetById(holderRef) ?? getEnemy(holderRef)) : holderRef;
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
