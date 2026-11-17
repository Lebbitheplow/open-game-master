// Sword of Wounding (SRD 5.1): "Hit points lost to this weapon's damage can
// be regained only through a short or long rest, rather than by
// regeneration, magic, or any other means." The hit points the blade took
// (its hits and its wounds' bleeding, sword-wounding.ts) are held on the
// creature as one mark; every way a creature regains hit points stops short
// of them (monster-abilities.ts enemyHpCap). A creature that had the blade's
// hit points back at its next Regeneration lost nothing to it.
//
// Pure: the cap's module reads it with no database.

import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { isConditionNamed } from "@/lib/srd/feature-names";

export const WOUND_LOSS = "unhealing wounds";

// The hit points the mark holds back from healing.
export function woundHeldHp(enemy: { conditions: string[]; conditionMeta?: ConditionMetaMap }): number {
  const name = enemy.conditions.find((entry) => isConditionNamed(entry, WOUND_LOSS));
  return name ? Math.max(0, enemy.conditionMeta?.[name]?.heldHp ?? 0) : 0;
}
