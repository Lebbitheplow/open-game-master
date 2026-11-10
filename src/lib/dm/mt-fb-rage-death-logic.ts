// Rage Beyond Death (Path of the Zealot, 14th level): "While you rage, having
// 0 hit points doesn't knock you unconscious. You still make death saving
// throws and suffer the usual effects of taking damage at 0 hit points, but if
// you would die from failed death saves you don't die until your rage ends,
// and then only if you still have 0 hit points."
//
// The death engine dropped every character at 0 hit points: a raging zealot
// fell unconscious, the fall ended the rage, and a third failed save killed
// them. The rule now is one mark on the sheet, RAGING_ON, laid in place of
// unconscious and prone as the raging zealot drops (death.ts), read wherever
// "up at 0 hit points" is asked (vitals-logic.ts holdsOn: the turn order,
// can-act.ts, the conditions others see) and ended with the rage like every
// condition laid "until the rage ends" (rage-bound.ts), where the fall or the
// death held off lands (mt-fb-rage-death.ts). Pure: death.ts and pc-damage.ts
// read it without a cycle.
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { DeathTrack } from "@/lib/dm/death-logic";
import { RAGING_ON } from "@/lib/dm/vitals-logic";
import { RAGING } from "@/lib/srd/class-resources";
import { holdsFeature, isConditionNamed } from "@/lib/srd/feature-names";

type Zealot = { id: string; features?: ReadonlyArray<{ name: string }>; conditions: string[]; conditionMeta?: unknown };

// Raging, and holding the feature: this character stays up at 0 hit points.
export function ragesBeyondDeath(sheet: Pick<Zealot, "features" | "conditions">): boolean {
  return holdsFeature(sheet, "Rage Beyond Death") && sheet.conditions.some((entry) => isConditionNamed(entry, RAGING));
}

// What the drop to 0 writes on them in place of unconscious and prone.
export function ragingOnConditions(sheet: Zealot): { conditions: string[]; conditionMeta: ConditionMetaMap } {
  return {
    conditions: [...sheet.conditions.filter((entry) => !isConditionNamed(entry, RAGING_ON)), RAGING_ON],
    conditionMeta: { ...((sheet.conditionMeta as ConditionMetaMap | undefined) ?? {}), [RAGING_ON]: { whileRagingOf: sheet.id, source: sheet.id } },
  };
}

// A track that reached death while its owner rages on: the three failures
// stand, and the death waits for the rage to end. Null when nothing is held.
export function heldDeath<T extends DeathTrack>(sheet: Pick<Zealot, "features" | "conditions">, track: T): T | null {
  return track.dead && ragesBeyondDeath(sheet) ? { ...track, dead: false } : null;
}
